// Compromisos y próximos vencimientos: pagos previstos (una vez o cada mes).
// Un vencimiento está pagado cuando hay un movimiento enlazado a él (scheduled_payment_id + scheduled_for), o cuando
// se registró por Movimientos un gasto que se le parece (misma categoría y espacio, monto ±5 %, cerca de la fecha):
// así no hay que marcarlo a mano. También lo paga una transferencia a un crédito o tarjeta cuyo presupuesto es de esa categoría. Mientras no se pague cuenta como comprometido, y al pagarlo pasa a gastado.

import type { ScheduledPayment, Space, Transaction } from "@/lib/types";
import type { Period } from "./periods";

export interface Occurrence {
  payment: ScheduledPayment;
  due: string; // YYYY-MM-DD
  paid: Transaction | null;
  overdue: boolean;
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1..12
}

/** Fechas de vencimiento de un compromiso entre `from` y `to` (inclusive). */
export function dueDatesBetween(p: ScheduledPayment, from: string, to: string): string[] {
  const lo = p.start_date > from ? p.start_date : from;
  const hi = p.end_date && p.end_date < to ? p.end_date : to;
  if (lo > hi) return [];
  if (p.frequency === "ONCE") return p.due_date && p.due_date >= lo && p.due_date <= hi ? [p.due_date] : [];
  if (!p.day_of_month) return [];
  const out: string[] = [];
  let y = Number(lo.slice(0, 4));
  let m = Number(lo.slice(5, 7));
  for (let i = 0; i < 240; i++) {
    const d = Math.min(p.day_of_month, lastDayOfMonth(y, m));
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (iso > hi) break;
    if (iso >= lo) out.push(iso);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

export const MATCH_TOLERANCE = 0.05;
const DAYS_BEFORE_DUE = 15;
const DAYS_AFTER_DUE = 7;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
const near = (x: number, target: number) => target > 0 && Math.abs(x - target) / target <= MATCH_TOLERANCE;

/** Lo que un movimiento puso en la categoría del vencimiento, si se parece a su monto (o a la parte de uno, si es compartido). */
function matchAmount(p: ScheduledPayment, t: Transaction, transferCats: Map<string, string>): number {
  // Pago de un crédito o tarjeta con presupuesto en la categoría del vencimiento: la transferencia es el pago
  if (t.kind === "TRANSFER" && t.to_account_id && p.category_id && transferCats.get(t.to_account_id) === p.category_id) {
    if (t.status === "PENDING_REVIEW" || t.scheduled_payment_id) return 0;
    if (p.scope === "PERSONAL" && t.payer_user_id !== p.owner_user_id) return 0;
    const targets = [p.amount, Number(p.share_a ?? 0), Number(p.share_b ?? 0)];
    return targets.some((x) => near(t.amount, x)) ? t.amount : 0;
  }
  if (t.kind !== "EXPENSE" && t.kind !== "DEBT_PAYMENT") return 0;
  if (t.status === "PENDING_REVIEW" || t.scheduled_payment_id || t.scope !== p.scope) return 0;
  if (p.scope === "PERSONAL" && t.payer_user_id !== p.owner_user_id) return 0;
  const inCat = t.splits.filter((x) => x.category_id === p.category_id).reduce((a, x) => a + x.amount, 0);
  const targets = [p.amount, Number(p.share_a ?? 0), Number(p.share_b ?? 0)];
  return targets.some((x) => near(inCat, x)) ? inCat : 0;
}

/** Vencimientos del periodo (activos), con su pago si ya se registró. Ordenados por fecha. */
export function occurrencesIn(
  payments: ScheduledPayment[], txs: Transaction[], period: Pick<Period, "start" | "end">, today: string,
  /** Créditos y tarjetas con presupuesto (cuenta → categoría): una transferencia a ellos paga el vencimiento de esa categoría. */
  transferCats: Map<string, string> = new Map(),
): Occurrence[] {
  const paidBy = new Map<string, Transaction>();
  for (const t of txs) {
    if (t.scheduled_payment_id && t.scheduled_for) paidBy.set(`${t.scheduled_payment_id}|${t.scheduled_for}`, t);
  }
  const out: Occurrence[] = [];
  for (const p of payments) {
    if (!p.active) continue;
    for (const due of dueDatesBetween(p, period.start, period.end)) {
      const paid = paidBy.get(`${p.id}|${due}`) ?? null;
      out.push({ payment: p, due, paid, overdue: false });
    }
  }
  out.sort((a, b) => a.due.localeCompare(b.due) || a.payment.name.localeCompare(b.payment.name, "es"));

  // Cruce automático con lo registrado por Movimientos: cada movimiento paga un solo vencimiento (el más antiguo que le sirva);
  // un compartido queda pagado cuando entre los movimientos de cada uno se completa el monto.
  const used = new Set<string>();
  for (const o of out) {
    if (o.paid || !o.payment.category_id) continue;
    const found: Transaction[] = [];
    let sum = 0;
    for (const t of txs) {
      if (used.has(t.id)) continue;
      const diff = dayDiff(t.occurred_on, o.due);
      if (diff < -DAYS_BEFORE_DUE || diff > DAYS_AFTER_DUE) continue;
      const amount = matchAmount(o.payment, t, transferCats);
      if (amount <= 0) continue;
      found.push(t);
      sum += amount;
      if (sum >= o.payment.amount * (1 - MATCH_TOLERANCE)) break;
    }
    if (found.length > 0 && sum >= o.payment.amount * (1 - MATCH_TOLERANCE)) {
      for (const t of found) used.add(t.id);
      o.paid = found[0];
    }
  }
  for (const o of out) o.overdue = !o.paid && o.due < today;
  return out;
}

/** Total comprometido (sin pagar) de un conjunto de vencimientos. */
export function committedTotal(occ: Occurrence[]): number {
  return occ.reduce((a, o) => a + (o.paid ? 0 : o.payment.amount), 0);
}

/** Vencimientos de un espacio: los del hogar, o los personales de una persona. */
export function occurrencesOfSpace(occ: Occurrence[], space: Space, ownerId?: string): Occurrence[] {
  return occ.filter((o) => o.payment.scope === space && (space === "HOUSEHOLD" || o.payment.owner_user_id === ownerId));
}
