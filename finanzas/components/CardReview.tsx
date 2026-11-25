"use client";

import { useState } from "react";
import { FileUp } from "lucide-react";
import { CardStatementPdf } from "@/components/CardStatementPdf";
import { ReviewRow, type RowSummary } from "@/components/ReviewRow";
import { StatementImport } from "@/components/StatementImport";
import type { Account, ReconcilingItem } from "@/lib/types";

const isDoc = (f: File) => f.type === "application/pdf" || f.type.startsWith("image/") || /\.(pdf|jpe?g|png|webp|heic|heif)$/i.test(f.name);
const ACCEPT = ".csv,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf,.pdf,image/*";

/**
 * Revisar la tarjeta contra el banco en UN solo paso: se sube el extracto una vez (PDF o foto) y quedan tres filas,
 * Deuda, Movimientos y Cuotas, cada una con una línea de resumen. El detalle solo se abre al tocar la fila.
 * También acepta Excel o CSV: ese archivo solo trae movimientos, así que revisa los movimientos y las filas Deuda y Cuotas piden el PDF.
 */

export function CardReview({ account, month, onBalance, carryOver }: { account: Account; month: string; onBalance: (v: number) => void; carryOver?: ReconcilingItem[] }) {
  // `from`: dónde se subió. Quien lo subió ya lo está leyendo; los demás lo leen al enterarse.
  const [file, setFile] = useState<{ file: File; from: "bar" | "moves" } | null>(null);
  const [movesOpen, setMovesOpen] = useState(false);
  const [moves, setMoves] = useState<RowSummary | null>(null);
  const sheet = !!file && !isDoc(file.file);
  const movesRow = moves ?? { text: "Sube el extracto para revisarlo", tone: "idle" as const };

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-surface p-3">
      <div className="space-y-0.5">
        <h3 className="text-sm font-semibold">Revisar la tarjeta contra el banco</h3>
        <p className="text-xs text-muted">Sube el extracto una sola vez (PDF o foto): reviso la deuda, los movimientos y las cuotas. Con Excel o CSV reviso solo los movimientos. El PDF o la foto se envía a la IA para leerlo; nada del extracto se guarda.</p>
      </div>
      <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-surface-2">
        <FileUp size={16} /> {file ? `Cambiar el extracto (${file.file.name.slice(0, 24)})` : "Subir el extracto (PDF, foto, Excel o CSV)"}
        <input type="file" accept={ACCEPT} className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile({ file: f, from: "bar" }); e.target.value = ""; }} />
      </label>
      <div className="flex flex-col gap-2">
        <CardStatementPdf key={sheet ? `sheet-${file!.file.name}-${file!.file.lastModified}` : "doc"} rows crossCheck account={account} month={month} onBalance={onBalance}
          incoming={file && isDoc(file.file) ? file.file : null} idleNote={sheet ? "El Excel o CSV no trae la deuda ni las cuotas: sube el PDF o una foto para revisarlas" : undefined} />
        <ReviewRow order={2} title="Movimientos" status={movesRow.text} tone={movesRow.tone} onClick={() => setMovesOpen(true)} />
      </div>
      <StatementImport hideButton open={movesOpen} onOpenChange={setMovesOpen} account={account} month={month} onBalance={onBalance}
        carryOver={carryOver} onSummary={setMoves}
        incoming={file && file.from !== "moves" ? file.file : null} onFile={(f) => setFile({ file: f, from: "moves" })} />
    </section>
  );
}
