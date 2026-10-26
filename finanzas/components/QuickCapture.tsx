"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parsePhrase, type CaptureOption, type CaptureResult } from "@/lib/capture/phrase";
import { todayBogota } from "@/lib/finance/periods";

// Registrar por voz o con la foto de un recibo: llena el formulario y la persona revisa antes de guardar.
// La voz la transcribe el navegador; la frase (o la foto) la lee Gemini en el servidor. Sin conexión, la frase
// se lee en el celular con reglas simples. La foto no se guarda.

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function speechCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Reduce la foto (máx. 1600 px, JPEG) para enviarla rápido. */
async function shrink(file: File): Promise<{ data: string; mime: string }> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const url = canvas.toDataURL("image/jpeg", 0.82);
    return { data: url.slice(url.indexOf(",") + 1), mime: "image/jpeg" };
  } catch {
    // El navegador no pudo abrirla (ej. HEIC): se envía tal cual
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { data: btoa(bin), mime: file.type || "image/jpeg" };
  }
}

export function QuickCapture({
  accounts, categories, incomeCategories, offline, onResult,
}: {
  accounts: CaptureOption[];
  categories: CaptureOption[];
  incomeCategories: CaptureOption[];
  offline: boolean;
  onResult: (r: CaptureResult, source: "voice" | "photo") => void;
}) {
  const [mode, setMode] = useState<"idle" | "listening" | "typing">("idle");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"voice" | "photo" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const finalText = useRef("");
  const lastHeard = useRef("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [canListen, setCanListen] = useState(false);

  useEffect(() => {
    setCanListen(!!speechCtor());
    return () => rec.current?.stop();
  }, []);

  const ctx = () => ({ today: todayBogota(), accounts, categories, incomeCategories });

  async function ask(body: Record<string, unknown>): Promise<CaptureResult | null> {
    const res = await fetch("/api/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, ...ctx() }),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: CaptureResult; error?: string } | null;
    if (!res.ok || !json?.ok) throw new Error(json?.error ?? `Error ${res.status}`);
    return json.result ?? null;
  }

  async function interpret(phrase: string) {
    const said = phrase.trim();
    if (!said) {
      setNote("No escuché nada. Intenta de nuevo o escríbelo.");
      return;
    }
    setBusy("voice");
    setNote(null);
    const local = parsePhrase(said, ctx());
    let result = local;
    let fromGemini = false;
    if (!offline) {
      try {
        const g = await ask({ text: said });
        if (g && (g.amount || g.description)) {
          // Gemini manda; lo que no traiga lo completa la lectura local
          result = { ...local, ...Object.fromEntries(Object.entries(g).filter(([, v]) => v != null && v !== "")) };
          fromGemini = true;
        }
      } catch {
        // Sin Gemini: queda la lectura local
      }
    }
    setBusy(null);
    setMode("idle");
    setText("");
    onResult(result, "voice");
    setNote(result.amount
      ? `“${said}”${fromGemini ? "" : " · leído sin internet"}. Revisa los datos antes de guardar.`
      : `“${said}”. No encontré el monto: escríbelo abajo.`);
  }

  function listen() {
    const Ctor = speechCtor();
    if (!Ctor) {
      setMode("typing");
      return;
    }
    setNote(null);
    finalText.current = "";
    lastHeard.current = "";
    setText("");
    const r = new Ctor();
    r.lang = "es-CO";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText.current += res[0].transcript;
        else interim += res[0].transcript;
      }
      lastHeard.current = (finalText.current + " " + interim).trim();
      setText(lastHeard.current);
    };
    r.onerror = (e) => {
      rec.current = null;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setNote("El navegador no tiene permiso para usar el micrófono. Puedes escribir la frase (o dictarla con el teclado).");
      } else if (e.error === "network") {
        setNote("Dictar necesita internet en este celular. Escribe la frase (o usa el micrófono del teclado).");
      } else if (e.error !== "aborted" && e.error !== "no-speech") {
        setNote("No pude escuchar. Escribe la frase.");
      }
      setMode("typing");
    };
    r.onend = () => {
      if (rec.current !== r) return;
      rec.current = null;
      const heard = finalText.current.trim() || lastHeard.current;
      if (heard) void interpret(heard);
      else setMode("typing");
    };
    rec.current = r;
    setMode("listening");
    try {
      r.start();
    } catch {
      rec.current = null;
      setMode("typing");
    }
  }

  function stop() {
    rec.current?.stop();
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    if (offline) {
      setNote("Leer la foto necesita internet. Escribe los datos o inténtalo cuando vuelva la conexión.");
      return;
    }
    setBusy("photo");
    setNote(null);
    try {
      const img = await shrink(file);
      const r = await ask({ image: img.data, mime: img.mime });
      if (!r || (!r.amount && !r.description)) {
        setNote("No pude leer el recibo. Intenta con una foto más cerca y con buena luz.");
      } else {
        onResult({ kind: "EXPENSE", ...r }, "photo");
        setNote(r.amount ? "Leí el recibo. Revisa el monto, la fecha y la categoría antes de guardar." : "No encontré el total: escríbelo abajo.");
      }
    } catch (e) {
      setNote(`No pude leer el recibo: ${(e as Error).message}`);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      {mode === "idle" && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={listen} disabled={!!busy}>
            {busy === "voice" ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}
            {busy === "voice" ? "Leyendo…" : canListen ? "Dictar" : "Escribir frase"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={!!busy}>
            {busy === "photo" ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
            {busy === "photo" ? "Leyendo…" : "Foto del recibo"}
          </Button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => void onPhoto(e.target.files?.[0])} aria-label="Foto del recibo" />
        </div>
      )}

      {mode === "listening" && (
        <div className="flex items-center gap-3 rounded-2xl bg-olive-soft px-3 py-2.5">
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-olive opacity-60" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-olive" />
          </span>
          <p className="min-w-0 flex-1 text-sm">{text || "Te escucho… ej. “gasté 45 mil en el Éxito con Nequi”"}</p>
          <Button size="sm" variant="secondary" onClick={stop} aria-label="Terminar"><Square size={14} /> Listo</Button>
        </div>
      )}

      {mode === "typing" && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void interpret(text); }}>
          <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="ej. almuerzo 32 mil con Nequi ayer"
            aria-label="Frase del movimiento" />
          <Button type="submit" size="sm" className="h-12" disabled={!text.trim() || !!busy}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : "Leer"}
          </Button>
          <Button size="sm" variant="ghost" className="h-12" onClick={() => { setMode("idle"); setText(""); }}>Cancelar</Button>
        </form>
      )}

      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  );
}
