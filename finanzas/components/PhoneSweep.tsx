"use client";

// Parte del celular del primer barrido: SMS y notificaciones desde el inicio del periodo.
// MacroDroid solo captura lo que llega desde que se instala; lo anterior se sube aquí:
//  · SMS: la copia .xml de la app "SMS Backup & Restore" (se leen en el celular y solo se envían los bancarios).
//  · Notificaciones: Android no guarda las viejas, así que se pegan los avisos (copiados del banco o de la app).

import { useRef, useState } from "react";
import { Bell, MessageSquareText, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { parsePasted, parseSmsBackup, type PhoneItem } from "@/lib/ingest/phoneSweep";
import { todayBogota } from "@/lib/finance/periods";

type Tally = { ACCEPTED: number; MERGED: number; IGNORED: number; DUPLICATE: number; UNRECOGNIZED: number; errors: number };

function summary(t: Tally): string {
  const parts = [
    t.ACCEPTED && `${t.ACCEPTED} quedaron en Por revisar`,
    t.MERGED && `${t.MERGED} ya estaban y se unieron`,
    t.DUPLICATE && `${t.DUPLICATE} ya se habían subido`,
    t.IGNORED && `${t.IGNORED} no eran movimientos`,
    t.UNRECOGNIZED && `${t.UNRECOGNIZED} no se reconocieron (quedan en Captura automática → Avisos sin reconocer)`,
    t.errors && `${t.errors} fallaron por conexión: vuelve a subirlos, no se duplican`,
  ].filter(Boolean);
  return parts.length ? `Listo: ${parts.join("; ")}.` : "No había nada que enviar.";
}

export function PhoneSweep({ desde, disabled }: { desde: string; disabled: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [sms, setSms] = useState<{ items: PhoneItem[]; total: number; name: string } | null>(null);
  const [pasted, setPasted] = useState("");
  const [pasteDay, setPasteDay] = useState(todayBogota());
  const [pasteChannel, setPasteChannel] = useState<PhoneItem["channel"]>("ANDROID_NOTIFICATION");
  const [pasteSource, setPasteSource] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pickFile(f: File | undefined) {
    setError(null);
    setResult(null);
    if (!f) return;
    try {
      const parsed = parseSmsBackup(await f.text(), desde);
      if (parsed.total === 0 && !/<sms\b/i.test(await f.slice(0, 200_000).text())) {
        setSms(null);
        return setError("Ese archivo no parece una copia de SMS. Usa el .xml que crea “SMS Backup & Restore”.");
      }
      setSms({ ...parsed, name: f.name });
    } catch {
      setError("No se pudo leer el archivo.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function send(items: PhoneItem[], after?: () => void) {
    if (items.length === 0 || progress) return;
    setError(null);
    setResult(null);
    setProgress({ done: 0, total: items.length });
    const t: Tally = { ACCEPTED: 0, MERGED: 0, IGNORED: 0, DUPLICATE: 0, UNRECOGNIZED: 0, errors: 0 };
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      try {
        const res = await fetch("/api/ingest/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: it.channel, source: it.source, text: it.text, received_at: it.receivedAt, external_id: it.externalId }),
        });
        const data = (await res.json()) as { ok: boolean; result?: keyof Tally; error?: string };
        if (!data.ok) {
          t.errors++;
          if (res.status === 401 || res.status === 400) setError(data.error ?? "No se pudo enviar");
        } else if (data.result && data.result in t) t[data.result]++;
        else t.UNRECOGNIZED++;
      } catch {
        t.errors++;
      }
      setProgress({ done: i + 1, total: items.length });
    }
    setProgress(null);
    setResult(summary(t));
    after?.();
  }

  const pastedItems = pasted.trim() ? parsePasted(pasted, pasteDay, pasteChannel, pasteSource) : [];
  const busy = !!progress;

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <p className="text-sm font-semibold">SMS y notificaciones del celular</p>
      <p className="text-xs text-muted">
        MacroDroid solo captura lo que llega desde que lo instalaste. Lo de antes, desde el {desde.slice(8, 10)}/{desde.slice(5, 7)}, súbelo aquí: entra igual que lo automático y lo repetido no se duplica.
      </p>

      <div className="space-y-2 rounded-xl bg-surface p-3">
        <p className="flex items-center gap-1.5 text-sm font-medium"><MessageSquareText size={15} /> SMS</p>
        <p className="text-xs text-muted">
          Instala <strong>SMS Backup &amp; Restore</strong> (Play Store) → <strong>Crear copia de seguridad</strong> → solo Mensajes, guárdala en el teléfono → elige aquí el archivo .xml.
          Se lee en tu celular y solo se envían los SMS de bancos (números cortos con montos); los de personas no salen del teléfono.
        </p>
        <input ref={fileRef} type="file" accept=".xml,text/xml,application/xml" className="hidden" onChange={(e) => void pickFile(e.target.files?.[0])} />
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy || disabled}><Upload size={15} /> Elegir copia de SMS</Button>
        {sms && (
          <>
            <p className="text-sm">
              {sms.name}: {sms.total} SMS recibidos desde el inicio, <strong>{sms.items.length} {sms.items.length === 1 ? "parece bancario" : "parecen bancarios"}</strong>.
            </p>
            {sms.items.length > 0 && (
              <Button size="sm" onClick={() => void send(sms.items, () => setSms(null))} disabled={busy || disabled}>
                Enviar {sms.items.length} SMS
              </Button>
            )}
          </>
        )}
      </div>

      <div className="space-y-2 rounded-xl bg-surface p-3">
        <p className="flex items-center gap-1.5 text-sm font-medium"><Bell size={15} /> Notificaciones o avisos pegados</p>
        <p className="text-xs text-muted">
          Android no guarda las notificaciones viejas. Copia el texto de cada aviso (del historial de la app del banco, de un correo o un chat) y pégalo aquí, separando cada uno con una línea en blanco. Todos quedan con la fecha que elijas, salvo que el aviso traiga la suya.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Select value={pasteChannel} onChange={(e) => setPasteChannel(e.target.value as PhoneItem["channel"])} aria-label="Tipo de aviso">
            <option value="ANDROID_NOTIFICATION">Notificación</option>
            <option value="ANDROID_SMS">SMS</option>
          </Select>
          <Input type="date" value={pasteDay} min={desde} max={todayBogota()} onChange={(e) => setPasteDay(e.target.value)} aria-label="Fecha de los avisos" />
        </div>
        <Input value={pasteSource} onChange={(e) => setPasteSource(e.target.value)} placeholder="App o banco (ej. Nequi, Bancolombia)" aria-label="App o banco" />
        <textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          rows={5}
          placeholder={"Compraste $45.000 en Éxito con tu tarjeta *1234\n\nRecibiste $120.000 de Ana"}
          className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-base text-text outline-none placeholder:text-muted/70 focus:border-olive focus:ring-2 focus:ring-olive-soft"
        />
        <Button size="sm" onClick={() => void send(pastedItems, () => setPasted(""))} disabled={busy || disabled || pastedItems.length === 0 || pasteDay < desde}>
          Enviar {pastedItems.length || ""} {pastedItems.length === 1 ? "aviso" : "avisos"}
        </Button>
      </div>

      {progress && <p className="text-sm">Enviando {progress.done} de {progress.total}…</p>}
      {result && <p className="text-sm text-olive">{result}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
