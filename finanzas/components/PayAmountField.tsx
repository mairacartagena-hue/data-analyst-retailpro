"use client";

// Monto de un pago de una deuda: todo, o un abono (una parte) que deja el resto pendiente.

import { AmountInput } from "@/components/AmountInput";
import { Segmented } from "@/components/ui/segmented";
import { formatCop, parseCop } from "@/lib/finance/money";

export type PayMode = "ALL" | "PART";

/** Valida el monto: devuelve un mensaje o null. */
export function payAmountError(amount: string, total: number): string | null {
  const n = parseCop(amount) ?? 0;
  if (n <= 0) return "Escribe cuánto abonas.";
  if (n > total) return `La deuda es de ${formatCop(total)}: no puedes abonar más.`;
  return null;
}

export function PayAmountField({ total, mode, onModeChange, amount, onAmountChange, allLabel = "Pagar todo", partLabel = "Abonar" }: {
  total: number;
  mode: PayMode;
  onModeChange: (m: PayMode) => void;
  amount: string;
  onAmountChange: (v: string) => void;
  allLabel?: string;
  partLabel?: string;
}) {
  const n = parseCop(amount) ?? 0;
  const left = total - n;
  return (
    <div className="space-y-3">
      <Segmented value={mode} onChange={(m) => {
        onModeChange(m);
        onAmountChange(m === "ALL" ? String(total) : "");
      }} options={[
        { value: "ALL", label: allLabel },
        { value: "PART", label: partLabel },
      ]} />
      {mode === "ALL" ? (
        <p className="num text-center font-display text-4xl">{formatCop(total)}</p>
      ) : (
        <>
          <AmountInput large autoFocus value={amount} onChange={onAmountChange} placeholder="¿Cuánto?" />
          <p className="px-1 text-sm text-muted">
            {n <= 0
              ? `Debe ${formatCop(total)} en total. Escribe la parte que se paga; el resto queda pendiente.`
              : left > 0
              ? <>Queda pendiente <strong className="num text-text">{formatCop(left)}</strong>.</>
              : left === 0
              ? "Con esto queda a paz y salvo."
              : <span className="text-danger">Es más que la deuda ({formatCop(total)}).</span>}
          </p>
        </>
      )}
    </div>
  );
}
