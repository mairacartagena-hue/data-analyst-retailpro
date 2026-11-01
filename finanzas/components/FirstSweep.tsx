"use client";

// Primer barrido de la captura automática: trae los correos bancarios desde el inicio del mes (o del periodo) hasta hoy.
// La app no lee Gmail: deja el pedido y el Apps Script de la persona lo toma en su siguiente revisión (cada 5 minutos).
// Los SMS y notificaciones de esas fechas se suben desde el celular (PhoneSweep).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { History } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { Button } from "@/components/ui/button";
import { periodFor, todayBogota } from "@/lib/finance/periods";
import { errMsg } from "@/lib/utils";
import { PhoneSweep } from "@/components/PhoneSweep";

interface Backfill {
  from_date: string;
  requested_at: string;
  done_at: string | null;
  sent: number | null; // correos que envió el script (null: versión vieja del script, no lo informa)
  label_found: boolean | null; // false: en Gmail no existe la etiqueta que usa el script
}

function dia(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("es-CO", { day: "numeric", month: "long", timeZone: "UTC" });
}

/** Qué pasó en el último barrido: lo que el script informó, sin dar por bueno uno que no encontró nada. */
function SweepResult({ row }: { row: Backfill }) {
  const cuando = `desde el ${dia(row.from_date)}, terminado el ${dia(row.done_at ?? row.requested_at)}`;
  if (row.label_found === false) {
    return (
      <p className="text-sm text-danger">
        El barrido terminó ({cuando}) pero <strong>no encontró la etiqueta</strong> en tu Gmail. En el script, <code>ETIQUETA</code> debe ser idéntica al nombre
        de tu etiqueta (por ejemplo <code>Bancos</code>). Corrígela, ejecuta <strong>instalar</strong> y repite el barrido.
      </p>
    );
  }
  if (row.sent === 0) {
    return (
      <p className="text-sm text-danger">
        El barrido terminó ({cuando}) pero <strong>no había correos para enviar</strong> en esa etiqueta. Gmail solo etiqueta los correos nuevos: al crear el filtro
        marca “Aplicar también el filtro a las conversaciones coincidentes”, o aplica la etiqueta a mano a los correos viejos, y repite el barrido.
      </p>
    );
  }
  return <p className="text-sm">Último barrido: {cuando}{row.sent != null ? ` · ${row.sent} ${row.sent === 1 ? "correo enviado" : "correos enviados"}` : ""}.</p>;
}

export function FirstSweep({ disabled }: { disabled: boolean }) {
  const { supabase, me, settings } = useFinance();
  const [row, setRow] = useState<Backfill | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Desde el inicio del periodo guardado: el mensual con su día de inicio (o el quincenal vigente)
  const desde = periodFor(settings, todayBogota()).start;
  const unidad = settings.cycle === "MONTHLY" ? "mes" : "periodo";
  const pending = !!row && !row.done_at;

  const load = useCallback(async () => {
    const { data } = await supabase.from("ingest_backfills").select("from_date, requested_at, done_at, sent, label_found").eq("user_id", me.user_id).maybeSingle();
    setRow((data as Backfill | null) ?? null);
  }, [supabase, me.user_id]);

  useEffect(() => { void load(); }, [load]);
  // Mientras esperan al Apps Script, se revisa si ya terminó
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => void load(), 20_000);
    return () => clearInterval(t);
  }, [pending, load]);

  async function request() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("request_ingest_backfill", { p_from: desde });
    setBusy(false);
    if (error) return setError(errMsg(error));
    await load();
  }

  return (
    <div className="space-y-2 rounded-2xl bg-surface-2 p-3">
      <p className="text-sm font-semibold">Primer barrido</p>
      <p className="text-xs text-muted">
        Trae tus movimientos desde el inicio del {unidad} ({dia(desde)}) hasta hoy: los correos bancarios de Gmail y, más abajo, los SMS y notificaciones del celular.
        Lo que llegue queda en “Por revisar” en el inicio.
      </p>
      <p className="text-sm font-semibold">Correos de Gmail</p>
      {pending ? (
        <p className="text-sm">
          Pedido desde el {dia(row.from_date)}. Tu Apps Script de Gmail lo toma en máximo 5 minutos y trae los correos; esta pantalla se actualiza sola.
        </p>
      ) : (
        <>
          {row?.done_at && <SweepResult row={row} />}
          <Button variant="outline" onClick={request} disabled={busy || disabled}>
            <History size={16} /> {busy ? "Pidiendo…" : row ? "Repetir el barrido" : `Traer movimientos desde el inicio del ${unidad}`}
          </Button>
          {disabled && <p className="text-xs text-muted">Guarda primero los cambios de periodo para que el barrido use la fecha nueva.</p>}
        </>
      )}
      {error && (
        <p className="text-sm text-danger">
          {error}{/token/i.test(error) && <> · <Link href="/captura" className="underline">Ir a Captura automática</Link></>}
        </p>
      )}
      <PhoneSweep desde={desde} disabled={disabled} />
    </div>
  );
}
