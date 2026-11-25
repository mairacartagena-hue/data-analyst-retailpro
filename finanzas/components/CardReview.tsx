"use client";

import { useState } from "react";
import { FileUp } from "lucide-react";
import { CardStatementPdf } from "@/components/CardStatementPdf";
import { ReviewRow, type RowSummary } from "@/components/ReviewRow";
import { StatementImport } from "@/components/StatementImport";
import type { Account, ReconcilingItem } from "@/lib/types";

/**
 * Revisar la tarjeta contra el banco en UN solo paso: se sube el extracto una vez (PDF o foto) y quedan tres filas,
 * Deuda, Movimientos y Cuotas, cada una con una línea de resumen. El detalle solo se abre al tocar la fila.
 * (Quien tenga Excel o CSV lo elige dentro de la fila Movimientos.)
 */
export function CardReview({ account, month, onBalance, carryOver }: { account: Account; month: string; onBalance: (v: number) => void; carryOver?: ReconcilingItem[] }) {
  // `from`: dónde se subió. Quien lo subió ya lo está leyendo; los demás lo leen al enterarse.
  const [file, setFile] = useState<{ file: File; from: "bar" | "moves" } | null>(null);
  const [movesOpen, setMovesOpen] = useState(false);
  const [moves, setMoves] = useState<RowSummary | null>(null);
  const movesRow = moves ?? { text: "Sube el extracto o toca para elegir un Excel o CSV", tone: "idle" as const };

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-surface p-3">
      <div className="space-y-0.5">
        <h3 className="text-sm font-semibold">Revisar la tarjeta contra el banco</h3>
        <p className="text-xs text-muted">Sube el extracto una sola vez (PDF o foto): reviso la deuda, los movimientos y las cuotas. La IA lo lee y nada del extracto se guarda.</p>
      </div>
      <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-surface-2">
        <FileUp size={16} /> {file ? `Cambiar el extracto (${file.file.name.slice(0, 24)})` : "Subir el extracto (PDF o foto)"}
        <input type="file" accept="application/pdf,image/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile({ file: f, from: "bar" }); e.target.value = ""; }} />
      </label>
      <div className="flex flex-col gap-2">
        <CardStatementPdf rows crossCheck account={account} month={month} onBalance={onBalance} incoming={file?.file ?? null} />
        <ReviewRow order={2} title="Movimientos" status={movesRow.text} tone={movesRow.tone} onClick={() => setMovesOpen(true)} />
      </div>
      <StatementImport hideButton open={movesOpen} onOpenChange={setMovesOpen} account={account} month={month} onBalance={onBalance}
        carryOver={carryOver} onSummary={setMoves}
        incoming={file && file.from !== "moves" ? file.file : null} onFile={(f) => setFile({ file: f, from: "moves" })} />
    </section>
  );
}
