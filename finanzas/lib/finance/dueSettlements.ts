// Vencimientos de créditos y tarjetas pagados con un valor distinto a la cuota. Al pagar, la app pregunta qué pasó:
//  · Pagó menos → abono o pago parcial (PARTIAL: el resto sigue por pagar) o la cuota era menor (LOWER: el vencimiento
//    queda pagado, la diferencia sigue en el saldo de la deuda y el presupuesto se ajusta a lo pagado).
//  · Pagó más → abono a capital (EXTRA_CAPITAL: baja la deuda, el presupuesto solo cuenta la cuota) o la cuota era
//    mayor (HIGHER: todo es cuota y el presupuesto se ajusta a lo pagado).

import type { Account, DueSettlement, DueSettlementMode } from "@/lib/types";
import type { SpendingRow } from "./budget";
import type { Period } from "./periods";

/** Diferencias de hasta $1.000 se toman como iguales (redondeos del banco). */
export const DUE_TOLERANCE = 1000;

/** ¿El pago es distinto a la cuota del vencimiento? */
export function dueDiffers(expected: number, paid: number): boolean {
  return expected > 0 && paid > 0 && Math.abs(paid - expected) > DUE_TOLERANCE;
}

export function settlementFor(list: DueSettlement[] | undefined, accountId: string, due: string): DueSettlement | undefined {
  return (list ?? []).find((s) => s.account_id === accountId && s.due_date === due);
}

/** El vencimiento quedó pagado aunque el valor no fuera el de la cuota (todo menos un abono parcial). */
export function settledAsPaid(s: DueSettlement | undefined): boolean {
  return !!s && s.mode !== "PARTIAL";
}

/** Opciones que se le muestran a la persona según pagó menos o más que la cuota. */
export function dueOptions(expected: number, paid: number): { mode: DueSettlementMode; title: string; detail: string }[] {
  const diff = Math.abs(paid - expected);
  const cop = (n: number) => `$ ${Math.round(n).toLocaleString("es-CO")}`;
  return paid < expected
    ? [
      { mode: "PARTIAL", title: "Abono o pago parcial", detail: `Quedan ${cop(diff)} por pagar de este vencimiento.` },
      { mode: "LOWER", title: "La cuota era menor", detail: `El vencimiento queda pagado. Los ${cop(diff)} siguen en el saldo de la deuda y el presupuesto se ajusta a lo pagado.` },
    ]
    : [
      { mode: "EXTRA_CAPITAL", title: "Abono a capital", detail: `Los ${cop(diff)} de más bajan la deuda. El presupuesto solo cuenta la cuota.` },
      { mode: "HIGHER", title: "La cuota era mayor", detail: `Todo es cuota y el presupuesto se ajusta a lo pagado (${cop(paid)}).` },
    ];
}

/**
 * Ajustes al presupuesto de los créditos y tarjetas en el periodo:
 *  · budget: cambia lo asignado a quien paga (LOWER baja a lo pagado; HIGHER sube a lo pagado).
 *  · rows: lo ejecutado (EXTRA_CAPITAL descuenta el abono a capital: solo cuenta la cuota).
 */
export function dueBudgetAdjustments(
  list: DueSettlement[] | undefined,
  accounts: Pick<Account, "id" | "budget_category_id">[],
  period: Pick<Period, "start" | "end">,
): { budget: { categoryId: string; userId: string; amount: number }[]; rows: SpendingRow[] } {
  const budget: { categoryId: string; userId: string; amount: number }[] = [];
  const rows: SpendingRow[] = [];
  for (const s of list ?? []) {
    const categoryId = accounts.find((a) => a.id === s.account_id)?.budget_category_id;
    if (!categoryId) continue;
    const diff = Number(s.paid) - Number(s.expected);
    if (s.mode === "EXTRA_CAPITAL" && diff > 0) {
      rows.push({ categoryId, responsibleUserId: s.payer_user_id, occurredOn: s.due_date, total: -diff, scope: "HOUSEHOLD" });
    }
    if ((s.mode === "LOWER" && diff < 0) || (s.mode === "HIGHER" && diff > 0)) {
      if (s.due_date >= period.start && s.due_date <= period.end) budget.push({ categoryId, userId: s.payer_user_id, amount: diff });
    }
  }
  return { budget, rows };
}

/** Fecha de pago a la que corresponde un pago hecho el día `date` (desde 10 días después del pago anterior). */
export function dueForPayment(dueDay: number, date: string): string {
  const at = (y: number, m: number) => {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(dueDay, last)).padStart(2, "0")}`;
  };
  const [y, m] = date.split("-").map(Number);
  const here = at(y, m);
  const daysLate = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${here}T00:00:00Z`)) / 86_400_000);
  return daysLate > 10 ? (m === 12 ? at(y + 1, 1) : at(y, m + 1)) : here;
}
