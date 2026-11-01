// Deuda anterior de una tarjeta de crédito: lo que ya se debía cuando se registró la tarjeta en la app.
// Se compone del saldo al corte (lo que se paga en la próxima fecha de pago) y de las compras a cuotas del extracto
// (cada corte factura una cuota). Las compras nuevas ya cuentan en su categoría al comprarlas, así que el
// presupuesto de la tarjeta solo cuenta la parte de cada pago que cubre esa deuda anterior (nunca dos veces).

import type { CardStatementItem, Transaction } from "@/lib/types";
import { billingDue } from "./installments";
import { periodFor, type PeriodSettings } from "./periods";

export interface LegacyCuota {
  /** Corte del extracto que factura esta parte. */
  cut: string;
  /** Fecha de pago. */
  due: string;
  /** Capital que se paga ese día. */
  amount: number;
  /** El saldo al corte con el que se registró la tarjeta (no una cuota de compra diferida). */
  statement?: boolean;
}

type CardLike = {
  id: string;
  kind?: string;
  statement_day?: number | null;
  due_day?: number | null;
  opening_at?: string | null;
  opening_balance?: number | null;
};

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const dayOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(Math.min(d, lastDay(y, m)))}`;

/** Fecha (Colombia) del saldo inicial de la cuenta. */
export function openingDay(openingAt: string): string {
  return new Date(Date.parse(openingAt) - 5 * 3_600_000).toISOString().slice(0, 10);
}

/** Último corte (día `statementDay`) antes de `iso`. */
export function cutBefore(statementDay: number, iso: string): string {
  let [y, m] = iso.split("-").map(Number);
  let c = dayOf(y, m, statementDay);
  if (c >= iso) {
    if (m === 1) { y--; m = 12; } else m--;
    c = dayOf(y, m, statementDay);
  }
  return c;
}

/** Corte `k` meses después de `cut` (mismo día de corte). */
function cutPlus(statementDay: number, cut: string, k: number): string {
  const [y, m] = cut.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + k, 1));
  return dayOf(d.getUTCFullYear(), d.getUTCMonth() + 1, statementDay);
}

/**
 * Plan de la deuda anterior: el saldo al corte (deuda inicial − saldo diferido de las compras del extracto) en el pago
 * de ese extracto, y una cuota de capital de cada compra diferida por cada corte siguiente. Sin día de corte, de pago
 * o sin deuda inicial, vacío.
 */
export function legacySchedule(card: CardLike, items: CardStatementItem[]): LegacyCuota[] {
  const debt = Math.max(0, -Number(card.opening_balance ?? 0));
  if (!card.statement_day || !card.due_day || !card.opening_at || debt <= 0) return [];
  const sd = card.statement_day;
  const dd = card.due_day;
  const open = openingDay(card.opening_at);
  const mine = items.filter((i) => i.account_id === card.id && i.installments - i.paid_installments > 0 && i.remaining_balance > 0);
  const deferred = mine.reduce((a, i) => a + i.remaining_balance, 0);
  const out: LegacyCuota[] = [];
  const firstCut = cutBefore(sd, open);
  const statement = Math.max(0, debt - deferred);
  if (statement > 0) out.push({ cut: firstCut, due: billingDue(sd, dd, firstCut), amount: statement, statement: true });
  const byCut = new Map<string, number>();
  for (const it of mine) {
    const left = it.installments - it.paid_installments;
    const part = Math.round(it.remaining_balance / left);
    let bal = it.remaining_balance;
    for (let k = 0; k < left && bal > 0; k++) {
      const capital = k === left - 1 ? bal : Math.min(bal, part);
      bal -= capital;
      const cut = cutPlus(sd, firstCut, k + 1);
      byCut.set(cut, (byCut.get(cut) ?? 0) + capital);
    }
  }
  for (const [cut, amount] of [...byCut.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out.push({ cut, due: billingDue(sd, dd, cut), amount });
  }
  return out;
}

/** Tarjetas con presupuesto: id de la tarjeta → categoría de su presupuesto. */
export function cardBudgetMap(accounts: { id: string; kind: string; budget_category_id?: string | null; archived?: boolean }[]): Map<string, string> {
  return new Map(accounts
    .filter((a) => a.kind === "CREDIT_CARD" && a.budget_category_id && !a.archived)
    .map((a) => [a.id, a.budget_category_id as string]));
}

export interface CardPaymentPortion {
  categoryId: string;
  /** Parte del pago que cubre la deuda anterior (cuenta en el presupuesto de la tarjeta). */
  amount: number;
}

/**
 * Parte de cada pago a una tarjeta con presupuesto que cubre su deuda anterior. Un pago cubre primero lo ya
 * facturado de esa deuda (lo de los cortes anteriores a la fecha del pago) que falte; el resto paga compras
 * nuevas, que ya contaron en su categoría.
 */
export function cardPaymentPortions(
  accounts: (CardLike & { kind: string; budget_category_id?: string | null; archived?: boolean })[],
  txs: Transaction[],
  items: CardStatementItem[],
): Map<string, CardPaymentPortion> {
  const out = new Map<string, CardPaymentPortion>();
  for (const card of accounts) {
    if (card.kind !== "CREDIT_CARD" || !card.budget_category_id || card.archived || !card.opening_at) continue;
    const plan = legacySchedule(card, items);
    if (plan.length === 0) continue;
    const open = openingDay(card.opening_at);
    const payments = txs
      .filter((t) => t.kind === "TRANSFER" && t.to_account_id === card.id && t.status !== "PENDING_REVIEW" && t.occurred_on >= open)
      .sort((a, b) => a.occurred_on.localeCompare(b.occurred_on) || a.id.localeCompare(b.id));
    let covered = 0;
    for (const t of payments) {
      const billed = plan.filter((c) => c.cut < t.occurred_on).reduce((a, c) => a + c.amount, 0);
      const portion = Math.max(0, Math.min(t.amount, billed - covered));
      if (portion <= 0) continue;
      covered += portion;
      out.set(t.id, { categoryId: card.budget_category_id, amount: portion });
    }
  }
  return out;
}

/**
 * Montos del presupuesto de la tarjeta por periodo, desde el periodo de `today`: lo que vence de la deuda anterior en
 * cada periodo. Se juntan los periodos seguidos con el mismo monto y al final queda en 0 (la deuda anterior se acabó).
 */
export function cardBudgetVersions(card: CardLike, items: CardStatementItem[], settings: PeriodSettings, today: string): { valid_from: string; amount: number }[] {
  const plan = legacySchedule(card, items);
  const current = periodFor(settings, today);
  const byPeriod = new Map<string, number>();
  for (const c of plan) {
    const start = c.due < current.start ? current.start : periodFor(settings, c.due).start; // lo vencido sin pagar va en el periodo actual
    byPeriod.set(start, (byPeriod.get(start) ?? 0) + c.amount);
  }
  const out: { valid_from: string; amount: number }[] = [];
  let p = current;
  const last = [...byPeriod.keys()].sort().at(-1);
  for (let i = 0; i < 120 && last && p.start <= last; i++) {
    const amount = byPeriod.get(p.start) ?? 0;
    if (out.length === 0 || out[out.length - 1].amount !== amount) out.push({ valid_from: p.start, amount });
    const next = new Date(Date.parse(`${p.end}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    p = periodFor(settings, next);
  }
  if (out.length > 0 && out[out.length - 1].amount !== 0) out.push({ valid_from: p.start, amount: 0 });
  return out;
}
