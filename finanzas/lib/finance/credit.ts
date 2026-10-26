// Créditos con saldo (hipoteca, libre inversión): cuota, reparto de cada pago y cuota estimada.
// Cada pago se divide en capital (baja la deuda, no es gasto), intereses y costos (seguros, otros: son gastos).

import { monthlyRate } from "./installments";

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
