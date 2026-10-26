// Compras a cuotas con tarjeta de crédito.
// - Presupuestos e informes: cada mes cuenta su cuota de capital (valor / cuotas), desde el mes de la compra.
// - Intereses (estimados): como cobran las tarjetas en Colombia, capital fijo por cuota e intereses sobre el
//   saldo que queda, con la tasa mensual equivalente a la efectiva anual de la tarjeta. A 1 cuota no hay intereses.
// - Saldo Seguro y aviso de pago: se aparta lo que toca pagar en el periodo, no toda la deuda.

import type { Transaction } from "@/lib/types";
import type { Period } from "./periods";

export const MAX_INSTALLMENTS = 48;

export function installmentsOf(t: Pick<Transaction, "kind" | "installments">): number {
  const n = Math.round(Number(t.installments ?? 1));
  return t.kind === "EXPENSE" && n > 1 ? Math.min(n, MAX_INSTALLMENTS) : 1;
}

/** Misma fecha k meses después (si el mes es más corto, el último día). */
export function addMonthsIso(iso: string, k: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + k, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** Reparte un valor en n partes enteras; el sobrante de pesos va en la primera. */
export function splitEven(amount: number, n: number): number[] {
  const base = Math.floor(amount / n);
  const out = Array.from({ length: n }, () => base);
  out[0] += amount - base * n;
  return out;
}

/** Tasa mensual equivalente a una efectiva anual en %: 28 → 0,0208. */
export function monthlyRate(eaPercent: number | null | undefined): number {
  const ea = Number(eaPercent ?? 0);
  return ea > 0 ? Math.pow(1 + ea / 100, 1 / 12) - 1 : 0;
}

export interface Installment {
  no: number;
  date: string;
  capital: number;
  interest: number;
  total: number;
}

/** Plan de pagos de una compra: capital fijo e intereses sobre el saldo pendiente. */
export function installmentPlan(amount: number, n: number, date: string, eaPercent?: number | null): Installment[] {
  const caps = splitEven(amount, n);
  const rate = n > 1 ? monthlyRate(eaPercent) : 0;
  let balance = amount;
  return caps.map((capital, i) => {
    const interest = Math.round(balance * rate);
    balance -= capital;
    return { no: i + 1, date: addMonthsIso(date, i), capital, interest, total: capital + interest };
  });
}

/**
 * Para presupuestos e informes: cada compra a cuotas se vuelve una copia por cuota (fecha corrida un mes por
 * cuota y valores divididos). Los demás movimientos pasan igual.
 */
export function expandInstallments(txs: Transaction[]): Transaction[] {
  const out: Transaction[] = [];
  for (const t of txs) {
    const n = installmentsOf(t);
    if (n === 1) {
      out.push(t);
      continue;
    }
    const amounts = splitEven(t.amount, n);
    const splitParts = t.splits.map((s) => splitEven(s.amount, n));
    for (let k = 0; k < n; k++) {
      out.push({
        ...t,
        occurred_on: addMonthsIso(t.occurred_on, k),
        amount: amounts[k],
        installment_no: k + 1,
        installment_of: t,
        splits: t.splits.map((s, j) => ({ ...s, id: `${s.id}#${k + 1}`, amount: splitParts[j][k] })),
      });
    }
  }
  return out;
}

export interface CardDue {
  /** Deuda total de la tarjeta. */
  debt: number;
  /** Capital de cuotas que vencen después del periodo (no se paga ahora). */
  laterCapital: number;
  /** Intereses estimados de las cuotas del periodo. */
  interest: number;
  /** Lo que toca pagar en el periodo: deuda − capital de cuotas futuras + intereses estimados. */
  due: number;
}

/** Lo que toca pagar de una tarjeta en el periodo, según sus compras a cuotas. */
export function cardDue(
  card: { id: string; interest_rate_ea?: number | null },
  balance: number,
  txs: Transaction[],
  period: Period,
): CardDue {
  const debt = Math.max(0, -balance);
  let laterCapital = 0;
  let interest = 0;
  for (const t of txs) {
    if (t.account_id !== card.id) continue;
    const n = installmentsOf(t);
    if (n === 1) continue;
    for (const c of installmentPlan(t.amount, n, t.occurred_on, card.interest_rate_ea)) {
      if (c.date > period.end) laterCapital += c.capital;
      else if (c.date >= period.start) interest += c.interest;
    }
  }
  const capitalNow = Math.max(0, debt - laterCapital);
  return { debt, laterCapital: Math.min(laterCapital, debt), interest: debt > 0 ? interest : 0, due: capitalNow + (debt > 0 ? interest : 0) };
}
