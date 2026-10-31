// Cuota de los créditos en Presupuestos y cruce automático de sus pagos.
// Un crédito con presupuesto (budget_category_id) espera cada mes su cuota. Si llega automáticamente un pago
// (correo, SMS o notificación) que se parece a esa cuota, se convierte en el pago del crédito:
//  · monto: ±5 % de la cuota estimada o del presupuesto,
//  · fecha: entre 15 días antes y 7 días después del día de pago (hay quien paga con la quincena anterior),
//  · texto: menciona el nombre del crédito, el banco o sus últimos 4 dígitos.

import type { Account, CategoryBudgetRow, CategoryLimit, Transaction } from "@/lib/types";
import { words } from "@/lib/ingest/match";
import { budgetVersionAt, type SpendingRow } from "./budget";
import { nextCuota, suggestSplit } from "./credit";
import { responsibleOf, toBudgetCategories } from "./derive";
import { periodFor, type PeriodSettings } from "./periods";

export const AMOUNT_TOLERANCE = 0.05;
const DAYS_BEFORE_DUE = 15;
const DAYS_AFTER_DUE = 7;
/** Una transferencia al crédito a menos de estos días quiere decir que esa cuota ya se pagó. */
const ALREADY_PAID_DAYS = 20;
const LOOKBACK_DAYS = 60;
const CASH_KINDS = ["DEPOSIT", "WALLET", "CASH"];

const dayMs = 86_400_000;
const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const dayDiff = (a: string, b: string) => Math.round((toMs(a) - toMs(b)) / dayMs);

/** Día de pago `dueDay` del mes de `iso` desplazado `k` meses (ajustado al último día del mes). */
function dueIn(iso: string, k: number, dueDay: number): string {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + k, 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(dueDay, last)).padStart(2, "0")}`;
}

/** Fecha de vencimiento de la cuota que paga un movimiento de `iso`, o null si no cae cerca de ninguna. */
export function cuotaDueFor(iso: string, dueDay: number): string | null {
  for (const k of [0, 1, -1]) {
    const due = dueIn(iso, k, dueDay);
    const diff = dayDiff(iso, due);
    if (diff >= -DAYS_BEFORE_DUE && diff <= DAYS_AFTER_DUE) return due;
  }
  return null;
}

/** Cuota que se espera del crédito: la estimada y, si existe, el monto de su presupuesto. */
export function expectedCuotas(
  credit: Account, balance: number, today: string, limits: CategoryLimit[], budgets: CategoryBudgetRow[],
): number[] {
  const out = [nextCuota(Math.max(0, -balance), credit, today)];
  const limit = limits.find((l) => l.category_id === credit.budget_category_id && l.scope === "HOUSEHOLD");
  if (limit) {
    const v = budgetVersionAt(toBudgetCategories([limit], budgets)[0].budgets, today);
    if (v && v.amount > 0) out.push(v.amount);
  }
  return out.filter((x) => x > 0);
}

/**
 * Cuota mensual de los créditos con presupuesto: cada día de pago cuenta la cuota del presupuesto (el monto que se
 * puso), aunque el pago todavía no llegue. Desde el inicio de la primera versión del presupuesto hasta el periodo
 * actual. Si ya hay una transferencia al crédito que corresponde a esa cuota, la real manda y no se cuenta dos veces.
 */
export function expectedCreditRows(s: {
  accounts: Account[];
  transactions: Transaction[];
  limits: CategoryLimit[];
  budgets: CategoryBudgetRow[];
  settings: PeriodSettings;
}, today: string): SpendingRow[] {
  const end = periodFor(s.settings, today).end;
  const out: SpendingRow[] = [];
  for (const credit of s.accounts) {
    if ((credit.kind !== "CREDIT" && credit.kind !== "LOAN") || !credit.budget_category_id || credit.archived || !credit.due_day) continue;
    const limit = s.limits.find((l) => l.category_id === credit.budget_category_id && l.scope === "HOUSEHOLD");
    if (!limit) continue;
    const versions = toBudgetCategories([limit], s.budgets)[0].budgets;
    if (versions.length === 0) continue;
    const first = versions.reduce((m, v) => (v.validFrom < m ? v.validFrom : m), versions[0].validFrom);
    const paid = s.transactions.filter((t) => t.kind === "TRANSFER" && t.to_account_id === credit.id).map((t) => t.occurred_on);
    for (let k = 0; ; k++) {
      const due = dueIn(first, k, credit.due_day);
      if (due > end) break;
      if (due < first) continue;
      const amount = budgetVersionAt(versions, due)?.amount ?? 0;
      if (amount <= 0) continue;
      if (paid.some((d) => cuotaDueFor(d, credit.due_day!) === due)) continue;
      out.push({ categoryId: credit.budget_category_id, responsibleUserId: responsibleOf(credit), occurredOn: due, total: amount, scope: "HOUSEHOLD" });
    }
  }
  return out;
}

function mentionsCredit(t: Transaction, credit: Account): boolean {
  const text = [t.merchant_norm, t.merchant, t.description].filter(Boolean).join(" ");
  if (credit.last4 && text.includes(credit.last4)) return true;
  const target = words(text);
  for (const w of words([credit.name, credit.institution].filter(Boolean).join(" "))) if (target.has(w)) return true;
  return false;
}

export interface CreditPaymentMatch {
  transaction: Transaction;
  credit: Account;
  /** Intereses y seguros estimados del pago (gasto); el resto es capital. */
  charges: number;
  due: string;
}

/** Pagos que llegaron solos y corresponden a la cuota de un crédito con presupuesto (uno por crédito). */
export function findCreditPayments(s: {
  meId: string;
  accounts: Account[];
  balances: Record<string, number>;
  transactions: Transaction[];
  limits: CategoryLimit[];
  budgets: CategoryBudgetRow[];
}, today: string): CreditPaymentMatch[] {
  const credits = s.accounts.filter((a) => (a.kind === "CREDIT" || a.kind === "LOAN") && a.budget_category_id && !a.archived
    && a.owner_user_id === s.meId && a.due_day && s.balances[a.id] !== undefined && s.balances[a.id] < 0);
  if (credits.length === 0) return [];
  const cash = new Set(s.accounts.filter((a) => a.owner_user_id === s.meId && CASH_KINDS.includes(a.kind)).map((a) => a.id));
  const candidates = s.transactions.filter((t) => t.source !== "MANUAL" && t.payer_user_id === s.meId && t.created_by === s.meId
    && (t.kind === "EXPENSE" || t.kind === "DEBT_PAYMENT" || (t.kind === "TRANSFER" && !t.to_account_id))
    && !!t.account_id && cash.has(t.account_id) && t.splits.length <= 1 && !t.scheduled_payment_id
    && dayDiff(today, t.occurred_on) <= LOOKBACK_DAYS);

  const out: CreditPaymentMatch[] = [];
  const used = new Set<string>();
  for (const credit of credits) {
    const balance = s.balances[credit.id];
    const expected = expectedCuotas(credit, balance, today, s.limits, s.budgets);
    const paidOn = s.transactions.filter((t) => t.kind === "TRANSFER" && t.to_account_id === credit.id).map((t) => t.occurred_on);
    let best: { t: Transaction; due: string; gap: number } | null = null;
    for (const t of candidates) {
      if (used.has(t.id)) continue;
      const gap = Math.min(...expected.map((e) => Math.abs(t.amount - e) / e));
      if (gap > AMOUNT_TOLERANCE) continue;
      const due = cuotaDueFor(t.occurred_on, credit.due_day!);
      if (!due || !mentionsCredit(t, credit)) continue;
      if (paidOn.some((d) => Math.abs(dayDiff(d, t.occurred_on)) <= ALREADY_PAID_DAYS)) continue;
      if (!best || gap < best.gap) best = { t, due, gap };
    }
    if (!best) continue;
    used.add(best.t.id);
    const split = suggestSplit(Math.max(0, -balance), credit.interest_rate_ea, best.t.amount, credit.monthly_costs ?? 0);
    out.push({ transaction: best.t, credit, charges: Math.min(split.interest + split.costs, best.t.amount - 1), due: best.due });
  }
  return out;
}
