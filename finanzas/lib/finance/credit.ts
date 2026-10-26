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

/** Datos del crédito que definen su cuota. */
export interface CreditTerms {
  interest_rate_ea?: number | null;
  term_months?: number | null;
  opening_at?: string | null;
  monthly_costs?: number | null;
  due_day?: number | null;
  paid_installments?: number | null;
  paid_installments_on?: string | null;
  /** Cuota fija del extracto (capital + intereses, sin seguros). */
  installment_amount?: number | null;
}

/** Días de pago (due_day) entre `after` (sin incluir) y `until` (incluido). */
function dueDaysBetween(dueDay: number, after: string, until: string): number {
  if (until <= after) return 0;
  let [y, m] = after.split("-").map(Number);
  let n = 0;
  for (let i = 0; i < 1200; i++) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const d = `${y}-${String(m).padStart(2, "0")}-${String(Math.min(dueDay, last)).padStart(2, "0")}`;
    if (d > until) break;
    if (d > after) n++;
    if (m === 12) { y++; m = 1; } else m++;
  }
  return n;
}

/**
 * Cuotas pagadas hasta hoy. Si la persona dijo en qué cuota iba, se parte de ahí y se suma cada día de pago que
 * pasó desde esa fecha. Si no, se cuentan los meses desde el saldo inicial (como antes). null sin plazo.
 */
export function installmentsPaid(a: CreditTerms, today: string): number | null {
  const term = Math.round(Number(a.term_months ?? 0));
  if (term <= 0) return null;
  if (a.paid_installments != null && a.paid_installments_on) {
    const passed = a.due_day ? dueDaysBetween(a.due_day, a.paid_installments_on, today) : term - remainingMonths(term, a.paid_installments_on, today);
    return Math.min(term, a.paid_installments + passed);
  }
  return term - remainingMonths(term, a.opening_at, today);
}

/** Cuotas que faltan por pagar (mínimo 1 mientras haya deuda). */
export function remainingInstallments(a: CreditTerms, today: string): number {
  const term = Math.max(1, Math.round(Number(a.term_months ?? 0)));
  const paid = installmentsPaid(a, today);
  return Math.max(1, term - (paid ?? 0));
}

/** Parte del capital ya pagada: (valor inicial − lo que se debe) / valor inicial. null sin valor inicial. */
export function capitalPaidRatio(original: number | null | undefined, owed: number): number | null {
  if (!original || original <= 0) return null;
  return Math.min(1, Math.max(0, (original - owed) / original));
}

/** "Cuota 38 de 240": la próxima que toca pagar. null si no hay plazo. */
export function installmentLabel(a: CreditTerms, today: string): string | null {
  const paid = installmentsPaid(a, today);
  const term = Math.round(Number(a.term_months ?? 0));
  if (paid == null || term <= 0) return null;
  return paid >= term ? `${term} de ${term} cuotas pagadas` : `Cuota ${paid + 1} de ${term}`;
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
export function nextCuota(balance: number, a: CreditTerms, today: string): number {
  if (balance <= 0) return 0;
  // Cuota del extracto: intereses según la tasa y la diferencia a capital (la última no pasa de lo que se debe)
  if (a.installment_amount && a.installment_amount > 0) {
    const interest = Math.round(balance * monthlyRate(a.interest_rate_ea));
    return Math.round(Math.min(a.installment_amount, balance + interest)) + Math.round(a.monthly_costs ?? 0);
  }
  const n = remainingInstallments(a, today);
  return Math.round(annuityPayment(balance, monthlyRate(a.interest_rate_ea), n)) + Math.round(a.monthly_costs ?? 0);
}

/**
 * Lo que falta reservar de la cuota del crédito en el periodo. La cuota vence el día de pago (due_day); lo que se abona
 * al capital después del corte de su extracto y antes del siguiente corte (como dice el extracto: "los pagos hechos
 * luego de la fecha de corte aparecerán en el siguiente extracto") ya pagó esa cuota. Sin día de corte se usa un mes
 * antes del pago. Si se abonó menos del capital que trae la cuota, se reserva la parte proporcional que falta.
 * Sin día de pago se reserva la cuota completa, como antes. Con día de pago pero ninguno dentro del periodo, nada.
 */
export function creditReserve(
  account: CreditTerms & { id: string; statement_day?: number | null },
  balance: number,
  txs: Transaction[],
  period: Period,
  today: string,
): number {
  const owed = Math.max(0, -balance);
  const cuota = nextCuota(owed, account, today);
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
