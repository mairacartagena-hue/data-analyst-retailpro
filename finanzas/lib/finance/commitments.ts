// Compromisos y próximos vencimientos: pagos previstos (una vez o cada mes).
// Un vencimiento está pagado cuando hay un movimiento enlazado a él (scheduled_payment_id + scheduled_for);
// mientras no se pague cuenta como comprometido, y al pagarlo pasa a gastado (no se cuenta dos veces).

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

/** Vencimientos del periodo (activos), con su pago si ya se registró. Ordenados por fecha. */
export function occurrencesIn(payments: ScheduledPayment[], txs: Transaction[], period: Pick<Period, "start" | "end">, today: string): Occurrence[] {
  const paidBy = new Map<string, Transaction>();
  for (const t of txs) {
    if (t.scheduled_payment_id && t.scheduled_for) paidBy.set(`${t.scheduled_payment_id}|${t.scheduled_for}`, t);
  }
  const out: Occurrence[] = [];
  for (const p of payments) {
    if (!p.active) continue;
    for (const due of dueDatesBetween(p, period.start, period.end)) {
      const paid = paidBy.get(`${p.id}|${due}`) ?? null;
      out.push({ payment: p, due, paid, overdue: !paid && due < today });
    }
  }
  return out.sort((a, b) => a.due.localeCompare(b.due) || a.payment.name.localeCompare(b.payment.name, "es"));
}

/** Total comprometido (sin pagar) de un conjunto de vencimientos. */
export function committedTotal(occ: Occurrence[]): number {
  return occ.reduce((a, o) => a + (o.paid ? 0 : o.payment.amount), 0);
}

/** Vencimientos de un espacio: los del hogar, o los personales de una persona. */
export function occurrencesOfSpace(occ: Occurrence[], space: Space, ownerId?: string): Occurrence[] {
  return occ.filter((o) => o.payment.scope === space && (space === "HOUSEHOLD" || o.payment.owner_user_id === ownerId));
}
