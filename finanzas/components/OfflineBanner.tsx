"use client";

import { useState } from "react";
import { CloudOff, RefreshCw, Trash2 } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { queuedSummary } from "@/lib/offline/queue";
import { formatCop } from "@/lib/finance/money";
import { formatDay } from "@/lib/finance/periods";
import { TX_KIND_LABEL, type TxKind } from "@/lib/types";
import { Button } from "@/components/ui/button";

/** Sin conexión o con movimientos guardados en el celular que aún no se envían. */
export function OfflineBanner() {
  const { offline, snapshotAt, queue, flushQueue, discardQueued } = useFinance();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  if (!offline && queue.length === 0) return null;

  const rejected = queue.filter((q) => q.error).length;
  const time = snapshotAt ? new Date(snapshotAt).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : null;

  return (
    <div className="mx-4 mt-3 rounded-2xl bg-warning-soft px-3 py-2.5 text-sm" role="status">
      <div className="flex items-start gap-2">
        <CloudOff size={18} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          {offline ? (
            <p>
              <strong>Sin conexión.</strong>{time ? ` Ves los datos del ${time}.` : ""} Puedes registrar movimientos nuevos: se envían solos cuando vuelva internet.
            </p>
          ) : (
            <p>Hay movimientos guardados en este celular por enviar.</p>
          )}
          {queue.length > 0 && (
            <button className="mt-1 font-semibold underline" onClick={() => setOpen((v) => !v)}>
              {queue.length === 1 ? "1 movimiento por enviar" : `${queue.length} movimientos por enviar`}
              {rejected > 0 ? ` (${rejected} con error)` : ""}
            </button>
          )}
        </div>
      </div>

      {open && queue.length > 0 && (
        <div className="mt-2 space-y-2">
          <ul className="divide-y divide-border rounded-xl bg-surface">
            {queue.map((q) => {
              const s = queuedSummary(q);
              return (
                <li key={q.client_id} className="flex items-start gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{s.description || TX_KIND_LABEL[s.kind as TxKind] || "Movimiento"}</p>
                    <p className="text-xs text-muted">{formatCop(s.amount)}{s.date ? ` · ${formatDay(s.date)}` : ""}</p>
                    {q.error && <p className="text-xs text-danger">No se pudo guardar: {q.error}</p>}
                  </div>
                  <button aria-label="Descartar" className="p-1 text-muted"
                    onClick={() => { if (confirm("¿Descartar este movimiento? No se va a registrar.")) void discardQueued(q.client_id); }}>
                    <Trash2 size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
          <Button size="sm" variant="outline" disabled={sending}
            onClick={async () => { setSending(true); try { await flushQueue(true); } finally { setSending(false); } }}>
            <RefreshCw size={14} className={sending ? "animate-spin" : ""} /> Enviar ahora
          </Button>
        </div>
      )}
    </div>
  );
}
