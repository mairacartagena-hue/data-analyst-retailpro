// Presupuesto por responsable: cuánto le toca a cada miembro en una categoría,
// cuánto lleva ejecutado, rollover entre periodos y excedente de partidas de montos fijos.

import { isWithin, periodFor, periodsBetween, shiftPeriod, type Period, type PeriodSettings } from "./periods";

export type Responsibility = "MEMBER_A_100" | "MEMBER_B_100" | "FIXED_AMOUNTS" | "PRIVATE";

export interface Members {
  a: string | null; // user_id del miembro A
  b: string | null; // user_id del miembro B
}

export interface BudgetVersion {
  validFrom: string;
  amount: number;
  fixedAmountA: number | null;
  fixedAmountB: number | null;
}

export interface BudgetCategory {
  id: string;
  responsibility: Responsibility;
  ownerUserId: string | null;
  rolloverEnabled: boolean;
  isHouseholdObligation: boolean;
  budgets: BudgetVersion[];
}

/** Ejecutado agregado por categoría, responsable y día (un reembolso resta). */
export interface SpendingRow {
  categoryId: string;
  responsibleUserId: string;
  occurredOn: string;
  total: number;
  /** Ámbito del movimiento: las barras compartidas solo suman lo del hogar. */
  scope?: "HOUSEHOLD" | "PERSONAL";
}

export interface AllocationStatus {
  userId: string;
  budget: number; // asignado en este periodo
  carry: number; // arrastre del periodo anterior (puede ser negativo)
  available: number; // budget + carry
  spent: number;
  remaining: number; // available - spent (negativo = sobregiro)
}

export type AlertLevel = "ok" | "warning" | "over";

export interface CategoryStatus {
  categoryId: string;
  totalAvailable: number;
  totalSpent: number;
  allocations: AllocationStatus[];
  spentByUser: Record<string, number>;
  ratio: number; // ejecutado / disponible
  level: AlertLevel;
}

export const WARNING_RATIO = 0.85;

/** Versión de presupuesto vigente al inicio del periodo. */
export function budgetVersionAt(budgets: BudgetVersion[], periodStart: string): BudgetVersion | null {
  let best: BudgetVersion | null = null;
  for (const b of budgets) {
    if (b.validFrom <= periodStart && (!best || b.validFrom > best.validFrom)) best = b;
  }
  return best;
}

/** Monto asignado a cada miembro según el tipo de responsabilidad. Nunca porcentajes. */
export function allocationFor(
  category: Pick<BudgetCategory, "responsibility" | "ownerUserId">,
  version: BudgetVersion | null,
  members: Members,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!version) return out;
  switch (category.responsibility) {
    case "MEMBER_A_100":
      if (members.a) out[members.a] = version.amount;
      break;
    case "MEMBER_B_100":
      if (members.b) out[members.b] = version.amount;
      break;
    case "FIXED_AMOUNTS":
      if (members.a) out[members.a] = version.fixedAmountA ?? 0;
      if (members.b) out[members.b] = version.fixedAmountB ?? 0;
      break;
    case "PRIVATE":
      if (category.ownerUserId) out[category.ownerUserId] = version.amount;
      break;
  }
  return out;
}

function spentInPeriod(rows: SpendingRow[], categoryId: string, period: Period): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.categoryId !== categoryId || !isWithin(r.occurredOn, period)) continue;
    out[r.responsibleUserId] = (out[r.responsibleUserId] ?? 0) + r.total;
  }
  return out;
}

/**
 * Arrastre acumulado al inicio de `period`. Con rollover pasan al siguiente periodo
 * tanto el sobrante como el sobregiro. Solo cuenta para quien tiene monto asignado.
 */
export function carryInto(
  category: BudgetCategory,
  period: Period,
  rows: SpendingRow[],
  settings: PeriodSettings,
  members: Members,
): Record<string, number> {
  const carry: Record<string, number> = {};
  if (!category.rolloverEnabled || category.budgets.length === 0 || period.custom) return carry;

  const first = category.budgets.reduce((min, b) => (b.validFrom < min ? b.validFrom : min), category.budgets[0].validFrom);
  const previous = shiftPeriod(settings, period, -1);
  if (previous.start < periodFor(settings, first).start) return carry;

  for (const p of periodsBetween(settings, first, previous)) {
    const alloc = allocationFor(category, budgetVersionAt(category.budgets, p.start), members);
    const spent = spentInPeriod(rows, category.id, p);
    for (const [userId, budget] of Object.entries(alloc)) {
      carry[userId] = (carry[userId] ?? 0) + budget - (spent[userId] ?? 0);
    }
  }
  return carry;
}

/** Estado de una categoría en un periodo: disponible, ejecutado por miembro y alerta de tope. */
export function categoryStatus(
  category: BudgetCategory,
  period: Period,
  rows: SpendingRow[],
  settings: PeriodSettings,
  members: Members,
): CategoryStatus {
  const version = budgetVersionAt(category.budgets, period.start);
  const alloc = allocationFor(category, version, members);
  const carry = carryInto(category, period, rows, settings, members);
  const spentByUser = spentInPeriod(rows, category.id, period);

  const allocations: AllocationStatus[] = Object.entries(alloc).map(([userId, budget]) => {
    const c = carry[userId] ?? 0;
    const spent = spentByUser[userId] ?? 0;
    return { userId, budget, carry: c, available: budget + c, spent, remaining: budget + c - spent };
  });

  const totalAvailable = allocations.reduce((s, a) => s + a.available, 0);
  const totalSpent = Object.values(spentByUser).reduce((s, v) => s + v, 0);
  const ratio = totalAvailable > 0 ? totalSpent / totalAvailable : totalSpent > 0 ? Infinity : 0;
  const level: AlertLevel = ratio >= 1 && totalSpent > 0 ? "over" : ratio >= WARNING_RATIO ? "warning" : "ok";

  return { categoryId: category.id, totalAvailable, totalSpent, allocations, spentByUser, ratio, level };
}

export interface FixedExcessInput {
  amount: number; // monto del gasto nuevo en la partida
  payerAvailable: number; // parte fija del que paga (con arrastre)
  payerSpent: number; // lo que ya lleva ejecutado el que paga
  partnerAvailable: number;
  partnerSpent: number;
}

export interface FixedExcessResult {
  payerRemaining: number;
  partnerRemaining: number;
  excess: number; // cuánto supera el gasto la parte que le queda al que paga
  suggestedCharge: number; // propuesta para cobrar: el excedente hasta lo que le falta a la pareja
}

/**
 * Partidas FIXED_AMOUNTS: si quien paga se pasa de su parte fija, la app pregunta
 * si se le cobra el excedente a la pareja. Esta función calcula la propuesta.
 */
export function fixedAmountsExcess(input: FixedExcessInput): FixedExcessResult {
  const payerRemaining = Math.max(0, input.payerAvailable - input.payerSpent);
  const partnerRemaining = Math.max(0, input.partnerAvailable - input.partnerSpent);
  const excess = Math.max(0, input.amount - payerRemaining);
  return { payerRemaining, partnerRemaining, excess, suggestedCharge: Math.min(excess, partnerRemaining) };
}

/** Lo que le queda por cubrir al usuario en obligaciones del hogar (para el Saldo Seguro). */
export function pendingObligationsFor(userId: string, categories: BudgetCategory[], statuses: CategoryStatus[]): number {
  const byId = new Map(statuses.map((s) => [s.categoryId, s]));
  let total = 0;
  for (const c of categories) {
    if (!c.isHouseholdObligation) continue;
    const a = byId.get(c.id)?.allocations.find((x) => x.userId === userId);
    if (a) total += Math.max(0, a.remaining);
  }
  return total;
}
