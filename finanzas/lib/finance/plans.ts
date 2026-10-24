// Presupuestos con nombre: agrupan categorías (con sus subcategorías) del hogar o de una persona.
// Definiciones (iguales en toda la app):
//  · Gastado: gastos y pagos de deuda ya registrados en sus categorías, menos reembolsos.
//  · Comprometido: vencimientos previstos del periodo que aún no se pagan.
//  · Disponible: límite − gastado.
//  · Proyección de cierre: gastado + comprometido + el ritmo del gasto variable hasta el final del periodo.
// Cada parte de un movimiento cuenta una sola vez, aunque su categoría y su principal estén en el presupuesto.

import type { BudgetPlan, BudgetPlanCategory, Category, Transaction } from "@/lib/types";
import type { AlertLevel, SpendingRow } from "./budget";
import { committedTotal, type Occurrence } from "./commitments";
import { daysInPeriod, type Period } from "./periods";
import { consumptionSign, withDescendants } from "./spaces";

export interface PlanCategoryMetrics {
  categoryId: string;
  limit: number | null;
  spent: number;
}

export interface PlanMetrics {
  window: Period;
  spent: number;
  committed: number;
  available: number;
  projection: number;
  ratio: number;
  level: AlertLevel;
  /** La proyección pasa el límite (aunque todavía no se haya pasado). */
  projectedOver: boolean;
  byCategory: PlanCategoryMetrics[];
  occurrences: Occurrence[];
}

/** Rango que mide el presupuesto: el periodo elegido, o su rango fijo de fechas. */
export function planWindow(plan: BudgetPlan, period: Period): Period {
  if (plan.periodicity === "RANGE" && plan.end_date) return { start: plan.start_date, end: plan.end_date, custom: true };
  return period;
}

/** ¿El presupuesto aplica en el periodo? (no cerrado y con fechas que se cruzan) */
export function planAppliesTo(plan: BudgetPlan, period: Period): boolean {
  if (plan.status === "CLOSED") return false;
  return plan.start_date <= period.end && (!plan.end_date || plan.end_date >= period.start);
}

function days(from: string, to: string): number {
  return daysInPeriod({ start: from, end: to });
}

export function planMetrics(
  plan: BudgetPlan,
  planCategories: BudgetPlanCategory[],
  categories: Category[],
  txs: Transaction[],
  occurrences: Occurrence[],
  period: Period,
  today: string,
): PlanMetrics {
  const window = planWindow(plan, period);
  const own = planCategories.filter((c) => c.plan_id === plan.id);
  const included = withDescendants(categories, own.map((c) => c.category_id));
  const perCategory = new Map(own.map((c) => [c.category_id, withDescendants(categories, [c.category_id])]));

  // Qué partes cuentan: las del hogar para un presupuesto del hogar; para uno personal,
  // las partes personales a cargo de su dueño.
  const counts = (t: Transaction, responsible: string) =>
    plan.scope === "HOUSEHOLD" ? t.scope === "HOUSEHOLD" : t.scope === "PERSONAL" && responsible === plan.owner_user_id;

  let spent = 0;
  let scheduledPaid = 0;
  const catSpent = new Map<string, number>();
  for (const t of txs) {
    const sign = consumptionSign(t.kind);
    if (!sign || t.occurred_on < window.start || t.occurred_on > window.end) continue;
    for (const s of t.splits) {
      if (!s.category_id || !included.has(s.category_id) || !counts(t, s.responsible_user_id)) continue;
      const v = sign * s.amount;
      spent += v;
      if (t.scheduled_payment_id) scheduledPaid += v;
      for (const [id, set] of perCategory) if (set.has(s.category_id)) catSpent.set(id, (catSpent.get(id) ?? 0) + v);
    }
  }

  const occ = occurrences.filter((o) =>
    o.due >= window.start && o.due <= window.end &&
    o.payment.category_id != null && included.has(o.payment.category_id) &&
    o.payment.scope === plan.scope && (plan.scope === "HOUSEHOLD" || o.payment.owner_user_id === plan.owner_user_id));
  const committed = committedTotal(occ);

  let projection: number;
  if (today < window.start) projection = spent + committed;
  else if (today >= window.end) projection = spent + committed;
  else {
    const elapsed = days(window.start, today);
    const remaining = days(today, window.end) - 1;
    const variable = Math.max(0, spent - scheduledPaid);
    projection = spent + committed + Math.round((variable / elapsed) * remaining);
  }

  const amount = plan.amount;
  const ratio = amount > 0 ? spent / amount : spent > 0 ? Infinity : 0;
  const projectedOver = amount > 0 && projection > amount;
  let level: AlertLevel = "ok";
  if (plan.status !== "PAUSED") {
    if (spent > amount || (amount === 0 && spent > 0)) level = "over";
    else if (ratio * 100 >= plan.alert_pct || projectedOver) level = "warning";
  }

  return {
    window,
    spent,
    committed,
    available: amount - spent,
    projection,
    ratio,
    level,
    projectedOver,
    byCategory: own.map((c) => ({ categoryId: c.category_id, limit: c.amount, spent: catSpent.get(c.category_id) ?? 0 })),
    occurrences: occ,
  };
}

/**
 * Movimientos "resumen" a partir de los totales que comparte la pareja (sin detalle), para medir
 * sus presupuestos personales compartidos. Solo sirven para el cálculo; no se muestran.
 */
export function sharedAsTransactions(rows: SpendingRow[]): Transaction[] {
  return rows.map((r, i) => ({
    id: `compartido-${i}`, kind: r.total < 0 ? "REFUND" : "EXPENSE", status: "CONFIRMED", occurred_on: r.occurredOn,
    amount: Math.abs(r.total), description: null, merchant: null, account_id: null, to_account_id: null,
    payer_user_id: r.responsibleUserId, counterparty_user_id: null, is_shared: false, scope: "PERSONAL", creates_debt: false,
    source: "COMPARTIDO", tags: [], created_by: r.responsibleUserId, created_at: "",
    splits: [{ id: `compartido-${i}`, transaction_id: `compartido-${i}`, amount: Math.abs(r.total), category_id: r.categoryId,
      responsible_user_id: r.responsibleUserId, origin: "NORMAL", note: null }],
  }));
}
