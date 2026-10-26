// Créditos con saldo (hipoteca, libre inversión): cuota, reparto de cada pago y cuota estimada.
// Cada pago se divide en capital (baja la deuda, no es gasto), intereses y costos (seguros, otros: son gastos).

import type { Account, Transaction } from "@/lib/types";
import { addMonthsIso, monthlyRate, statementsDueIn } from "./installments";
import type { Period } from "./periods";

/** Créditos con cuotas y préstamos: se muestran y concilian aparte de las cuentas y tarjetas. */
export function isCreditKind(kind: Account["kind"]): boolean {
  return kind === "CREDIT" || kind === "LOAN";
}

/** Cuota fija (sistema francés) para un saldo, una tasa mensual y n cuotas. */
export function annuityPayment(balance: number, monthly: number, n: number): number {
  if (balance <= 0 || n <= 0) return 0;
  if (monthly === 0) return balance / n;
  return (balance * monthly) / (1 - Math.pow(1 + monthly, -n));
}

/** Cuotas que faltan: plazo menos los meses desde el inicio del crédito (mínimo 1). */
export function remainingMonths(termMonths: number | null | undefined, openingAt: string | null | undefined, today: string): number {
  const term = Math.max(1, Math.round(Number(termMonths ?? 0)));
  if (!openingAt) return term;
  const [y0, m0] = openingAt.slice(0, 10).split("-").map(Number);
  const [y1, m1] = today.split("-").map(Number);
  const elapsed = Math.max(0, (y1 - y0) * 12 + (m1 - m0));
  return Math.max(1, term - elapsed);
}

export interface CreditSplit {
  /** Cuota total pagada. */
  total: number;
  interest: number;
  costs: number;
  capital: number;
}

/** Sugerencia del reparto de un pago: intereses sobre el saldo; el resto de la cuota baja el capital. */
export function suggestSplit(balance: number, eaPercent: number | null | undefined, total: number, costs: number): CreditSplit {
  const interest = Math.min(Math.max(0, Math.round(balance * monthlyRate(eaPercent))), total);
  const cost = Math.min(Math.max(0, Math.round(costs)), Math.max(0, total - interest));
  const capital = Math.max(0, total - interest - cost);
  return { total, interest, costs: cost, capital };
}

/** Cuota estimada del próximo pago (capital + intereses + costos) para reservar en el Saldo Seguro. */
export function nextCuota(balance: number, eaPercent: number | null | undefined, termMonths: number | null | undefined, openingAt: string | null | undefined, costs: number, today: string): number {
  if (balance <= 0) return 0;
  const n = remainingMonths(termMonths, openingAt, today);
  return Math.round(annuityPayment(balance, monthlyRate(eaPercent), n)) + Math.round(costs);
}

/**
 * Lo que falta reservar de la cuota del crédito en el periodo. La cuota vence el día de pago (due_day); lo que se abona
 * al capital después del corte de su extracto y antes del siguiente corte (como dice el extracto: "los pagos hechos
 * luego de la fecha de corte aparecerán en el siguiente extracto") ya pagó esa cuota. Sin día de corte se usa un mes
 * antes del pago. Si se abonó menos del capital que trae la cuota, se reserva la parte proporcional que falta.
 * Sin día de pago se reserva la cuota completa, como antes. Con día de pago pero ninguno dentro del periodo, nada.
 */
export function creditReserve(
  account: { id: string; interest_rate_ea?: number | null; term_months?: number | null; opening_at?: string | null; monthly_costs?: number | null; statement_day?: number | null; due_day?: number | null },
  balance: number,
  txs: Transaction[],
  period: Period,
  today: string,
): number {
  const owed = Math.max(0, -balance);
  const cuota = nextCuota(owed, account.interest_rate_ea, account.term_months, account.opening_at, account.monthly_costs ?? 0, today);
  if (cuota <= 0 || !account.due_day) return cuota;

  const dues = account.statement_day
    ? statementsDueIn(account.statement_day, account.due_day, period)
    : statementsDueIn(account.due_day, account.due_day, period).map((d) => ({ due: d.due, cut: addMonthsIso(d.due, -1) }));
  const interest = Math.round(owed * monthlyRate(account.interest_rate_ea));
  const expectedCapital = Math.max(1, cuota - interest - Math.round(account.monthly_costs ?? 0));

  let reserve = 0;
  for (const { cut } of dues) {
    const nextCut = addMonthsIso(cut, 1);
    const capitalPaid = txs
      .filter((t) => t.kind === "TRANSFER" && t.to_account_id === account.id && t.status !== "PENDING_REVIEW" && t.occurred_on > cut && t.occurred_on <= nextCut)
      .reduce((sum, t) => sum + t.amount, 0);
    reserve += Math.round(cuota * (1 - Math.min(1, capitalPaid / expectedCapital)));
  }
  return reserve;
}
