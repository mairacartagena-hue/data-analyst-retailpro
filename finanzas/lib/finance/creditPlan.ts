// Ruta de pago de un crédito con cuotas (hipoteca, libre inversión): hasta cuándo se paga y cuánto
// cambian los intereses si se abona capital de más. Todo en pesos enteros. Los abonos extra se aplican
// completos a capital y la cuota fija se mantiene ("reducir plazo"). Los seguros y otros costos se
// toman constantes cada mes.

import { addMonthsIso, monthlyRate } from "./installments";
import { annuityPayment, remainingInstallments, type CreditTerms } from "./credit";

/** Tope de meses simulados (50 años): evita ciclos si la cuota no cubre los intereses. */
const MAX_MONTHS = 600;

export interface PlanInput {
  /** Capital que se debe hoy (positivo). */
  owed: number;
  /** Tasa efectiva anual en % (ej. 12.5). */
  eaPercent: number | null | undefined;
  /** Cuota fija de capital + intereses, sin seguros. */
  installment: number;
  /** Seguros y otros costos por mes. */
  costs: number;
  /** Fecha (AAAA-MM-DD) del próximo pago. */
  firstDue: string;
  /** Abono extra cada mes. */
  extraMonthly?: number;
  /** Abonos extra por mes calendario (1 a 12), ej. { 6: 3_000_000, 12: 3_000_000 }. */
  extraByMonth?: Record<number, number>;
}

export interface PlanRow {
  n: number;
  date: string;
  interest: number;
  capital: number;
  extra: number;
  costs: number;
  balance: number;
}

export interface Plan {
  rows: PlanRow[];
  /** Cuotas que faltan hasta saldar el crédito. */
  payments: number;
  /** Fecha del último pago (vacía si no se salda). */
  endDate: string;
  interest: number;
  costs: number;
  extras: number;
  /** false si la cuota no alcanza a bajar el capital (no se salda en 50 años). */
  amortizes: boolean;
}

/** Cuota fija de capital + intereses: la del extracto o, sin ella, la estimada con la tasa y las cuotas que faltan. */
export function planInstallment(owed: number, a: CreditTerms, today: string): number {
  if (owed <= 0) return 0;
  if (a.installment_amount && a.installment_amount > 0) return Math.round(a.installment_amount);
  return Math.round(annuityPayment(owed, monthlyRate(a.interest_rate_ea), remainingInstallments(a, today)));
}

/** Próxima fecha de pago después de hoy. Sin día de pago se usa el día de hoy. */
export function nextDueDate(dueDay: number | null | undefined, today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const day = dueDay && dueDay >= 1 && dueDay <= 31 ? dueDay : d;
  // El día de pago recortado al último día de ese mes (31 en febrero → 28 o 29)
  const inMonth = (year: number, month: number) => {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
  };
  const thisMonth = inMonth(y, m);
  if (thisMonth > today) return thisMonth;
  return m === 12 ? inMonth(y + 1, 1) : inMonth(y, m + 1);
}

/** Simula mes a mes hasta saldar el crédito. */
export function projectCredit(input: PlanInput): Plan {
  const rate = monthlyRate(input.eaPercent);
  const costs = Math.max(0, Math.round(input.costs));
  const rows: PlanRow[] = [];
  let balance = Math.max(0, Math.round(input.owed));
  let totInterest = 0;
  let totExtras = 0;

  for (let k = 0; balance > 0 && k < MAX_MONTHS; k++) {
    const date = addMonthsIso(input.firstDue, k);
    const month = Number(date.slice(5, 7));
    const interest = Math.round(balance * rate);
    const capital = Math.min(Math.max(0, input.installment - interest), balance);
    balance -= capital;
    const extra = Math.min(Math.max(0, (input.extraMonthly ?? 0) + (input.extraByMonth?.[month] ?? 0)), balance);
    balance -= extra;
    totInterest += interest;
    totExtras += extra;
    rows.push({ n: k + 1, date, interest, capital, extra, costs, balance });
  }

  const amortizes = balance <= 0;
  return {
    rows,
    payments: amortizes ? rows.length : 0,
    endDate: amortizes && rows.length > 0 ? rows[rows.length - 1].date : "",
    interest: totInterest,
    costs: costs * rows.length,
    extras: totExtras,
    amortizes,
  };
}

export interface PlanSavings {
  /** Cuotas que se ahorran frente al plan sin abonos. */
  monthsSaved: number;
  /** Intereses que se dejan de pagar. */
  interestSaved: number;
}

export function savingsVs(base: Plan, plan: Plan): PlanSavings {
  return {
    monthsSaved: base.amortizes && plan.amortizes ? base.payments - plan.payments : 0,
    interestSaved: base.amortizes && plan.amortizes ? base.interest - plan.interest : 0,
  };
}

export interface Milestone {
  /** Parte de la deuda de hoy que queda (0.75, 0.5, 0.25). */
  left: number;
  /** Saldo del hito. */
  balance: number;
  /** Primera fecha de pago con el saldo igual o por debajo del hito. */
  date: string;
}

/** Cuándo baja la deuda a 75 %, 50 % y 25 % de lo que se debe hoy. */
export function milestones(plan: Plan, owed: number, lefts: number[] = [0.75, 0.5, 0.25]): Milestone[] {
  return lefts.flatMap((left) => {
    const balance = Math.round(owed * left);
    const row = plan.rows.find((r) => r.balance <= balance);
    return row ? [{ left, balance, date: row.date }] : [];
  });
}

/** Saldo al cierre de cada año calendario (último pago del año). */
export function yearEndBalances(plan: Plan): { year: string; balance: number }[] {
  const byYear = new Map<string, number>();
  for (const r of plan.rows) byYear.set(r.date.slice(0, 4), r.balance);
  return [...byYear].map(([year, balance]) => ({ year, balance }));
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "2040-08-04" → "ago 2040". */
export function monthYear(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return `${MESES[m - 1]} ${y}`;
}
