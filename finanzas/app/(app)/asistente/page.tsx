"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, SendHorizontal, Sparkles, Trash2 } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildAiContext } from "@/lib/ai/context";
import { monthName, todayBogota } from "@/lib/finance/periods";
import { cn } from "@/lib/utils";

interface Turn {
  role: "user" | "model";
  text: string;
}

const STORE = "asistente-chat";

function suggestions(today: string): string[] {
  const m = Number(today.slice(5, 7)) - 1;
  const prev = monthName((m + 11) % 12, true);
  return [
    `Hazme un resumen de ${monthName(m, true)}: en qué gastamos más y cómo vamos con los presupuestos`,
    `¿En qué gastamos más en ${prev} comparado con el mes anterior?`,
    "¿Cuánto gastamos en mercado en los últimos 3 meses?",
    "¿Qué gastos podría recortar para ahorrar más?",
    "¿Cuánto me falta por pagar de mis créditos y cuándo termino?",
    "¿Cuáles son mis suscripciones o pagos que se repiten cada mes?",
  ];
}

export default function AsistentePage() {
  const state = useFinance();
  const today = todayBogota();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORE);
      if (saved) setTurns(JSON.parse(saved) as Turn[]);
    } catch {}
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(STORE, JSON.stringify(turns.slice(-20))); } catch {}
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    if (!navigator.onLine) return setError("Sin conexión: el asistente necesita internet.");
    setError(null);
    setText("");
    const history = turns.slice(-8);
    setTurns((t) => [...t, { role: "user", text: question }]);
    setBusy(true);
    try {
      const res = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history, context: buildAiContext(state, today) }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; answer?: string; error?: string };
      if (!body.ok || !body.answer) throw new Error(body.error ?? "No se pudo responder.");
      setTurns((t) => [...t, { role: "model", text: body.answer! }]);
    } catch (e) {
      setError((e as Error).message);
      setTurns((t) => t.slice(0, -1));
      setText(question);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-[calc(100dvh-80px)] flex-col px-4 pt-[calc(12px+env(safe-area-inset-top))]">
      <div className="flex items-center justify-between py-2">
        <div className="flex items-center gap-2">
          <Link href="/mas" aria-label="Volver" className="rounded-full p-2 text-muted hover:bg-surface-2"><ArrowLeft size={20} /></Link>
          <h1 className="font-display text-3xl">Asistente</h1>
        </div>
        {turns.length > 0 && (
          <button className="rounded-full p-2 text-muted hover:bg-surface-2" aria-label="Borrar conversación" onClick={() => { setTurns([]); setError(null); }}>
            <Trash2 size={18} />
          </button>
        )}
      </div>

      <div className="flex-1 space-y-3 pb-4">
        {turns.length === 0 && (
          <div className="space-y-3">
            <p className="flex items-start gap-2 rounded-2xl bg-wood-soft px-4 py-3 text-sm">
              <Sparkles size={18} className="mt-0.5 shrink-0 text-wood" />
              <span>Pregúntale a tus finanzas. Responde con lo que ves en la app (tus movimientos, los del hogar, presupuestos, cuentas y créditos). Lo privado de tu pareja no se envía.</span>
            </p>
            <div className="flex flex-col gap-2">
              {suggestions(today).map((s) => (
                <button key={s} onClick={() => ask(s)} className="rounded-2xl border border-border bg-surface px-3 py-2.5 text-left text-sm hover:bg-surface-2">{s}</button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={cn("max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed",
            t.role === "user" ? "ml-auto bg-olive text-on-olive" : "bg-surface-2")}>
            {t.text}
          </div>
        ))}
        {busy && <div className="w-24 animate-pulse rounded-2xl bg-surface-2 px-3.5 py-2.5 text-sm text-muted">Pensando…</div>}
        {error && <p className="text-sm text-danger">{error}</p>}
        <div ref={endRef} />
      </div>

      <form className="sticky bottom-[calc(76px+env(safe-area-inset-bottom))] flex gap-2 bg-bg py-2" onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe tu pregunta…" maxLength={500} aria-label="Pregunta" />
        <Button type="submit" size="icon" disabled={busy || !text.trim()} aria-label="Preguntar"><SendHorizontal size={18} /></Button>
      </form>
      <p className="pb-2 text-center text-[11px] text-muted">La IA puede equivocarse: confirma las cifras importantes en Informes o Movimientos.</p>
    </main>
  );
}
