// Metas de ahorro: avance con los aportes (los retiros restan) y lo que falta apartar en el periodo.

import type { SavingsContribution, SavingsGoal } from "@/lib/types";
import type { Period } from "./periods";

export interface GoalProgress {
  saved: number;
  remaining: number;
  ratio: number; // 0..1
  /** Aporte mensual que haría falta para llegar a la fecha objetivo (null si no hay fecha). */
  neededPerMonth: number | null;
}

function monthsUntil(today: string, target: string): number {
  const [y1, m1] = today.split("-").map(Number);
  const [y2, m2] = target.split("-").map(Number);
  return Math.max(1, (y2 - y1) * 12 + (m2 - m1));
}

export function goalProgress(goal: SavingsGoal, contributions: SavingsContribution[], today: string): GoalProgress {
  const saved = contributions.filter((c) => c.goal_id === goal.id).reduce((a, c) => a + c.amount, 0);
  const remaining = Math.max(0, goal.target_amount - saved);
  return {
    saved,
    remaining,
    ratio: goal.target_amount > 0 ? Math.min(1, Math.max(0, saved / goal.target_amount)) : 0,
    neededPerMonth: goal.target_date && remaining > 0 ? Math.ceil(remaining / monthsUntil(today, goal.target_date)) : null,
  };
}

/**
 * Ahorros programados pendientes de una persona en el periodo (para el Saldo Seguro):
 * en sus metas activas con aporte por periodo, lo que aún no ha aportado ella misma.
 */
/** Lo que falta aportar este periodo en cada meta activa con aporte por periodo (solo las que tienen algo pendiente). */
export function pendingSavingsByGoal(userId: string, goals: SavingsGoal[], contributions: SavingsContribution[], period: Pick<Period, "start" | "end">): { goal: SavingsGoal; pending: number }[] {
  const out: { goal: SavingsGoal; pending: number }[] = [];
  for (const g of goals) {
    if (g.status !== "ACTIVE" || g.owner_user_id !== userId || !g.planned_amount) continue;
    const done = contributions
      .filter((c) => c.goal_id === g.id && c.user_id === userId && c.occurred_on >= period.start && c.occurred_on <= period.end)
      .reduce((a, c) => a + c.amount, 0);
    const left = Math.min(g.planned_amount - done, g.target_amount - contributions.filter((c) => c.goal_id === g.id).reduce((a, c) => a + c.amount, 0));
    if (left > 0) out.push({ goal: g, pending: left });
  }
  return out;
}

export function pendingSavingsFor(userId: string, goals: SavingsGoal[], contributions: SavingsContribution[], period: Pick<Period, "start" | "end">): number {
  return pendingSavingsByGoal(userId, goals, contributions, period).reduce((a, x) => a + x.pending, 0);
}
