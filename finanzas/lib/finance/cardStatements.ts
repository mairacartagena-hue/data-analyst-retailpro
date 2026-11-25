// Extractos de la tarjeta de crédito: cruce de lo que dice el banco con lo que proyecta la app.
//  · La cuota del mes (lo que la app proyecta pagar en la fecha de pago del extracto) contra el pago mínimo.
//  · La deuda de la app al día del corte contra la deuda total del extracto.

import type { Account, CardStatement, CardStatementItem, Transaction } from "@/lib/types";
import type { CardStatementPurchase } from "@/lib/capture/cardStatement";
import { accountStatement } from "./reconcile";
import { addDays } from "./periods";
import { billingCut, cutsBetween, installmentPlan, installmentsOf, isCardAdvance, matchedWithItems, payoffDates, projectCard, statementItemsAfter } from "./installments";

/** Diferencias de hasta $1.000 se toman como iguales (redondeos e intereses de centavos). */
export const STATEMENT_TOLERANCE = 1000;

const daysApart = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/** Deuda de la tarjeta según la app al final del día `date` (positiva). */
export function appDebtAt(account: Account, txs: Transaction[], date: string): number {
  const st = accountStatement(account, txs, { month: date.slice(0, 7), start: date, end: date });
  return Math.max(0, -st.closing);
}

/** Lo que la app proyecta pagar en el mes de `due` (sin descontar pagos ya hechos: se compara con el extracto tal cual). */
export function projectedFor(account: Account, txs: Transaction[], items: CardStatementItem[], due: string): number {
  const card = {
    id: account.id, interest_rate_ea: account.interest_rate_ea ?? null, statement_day: account.statement_day,
    due_day: account.due_day, opening_at: account.opening_at, opening_balance: account.opening_balance,
  };
  return projectCard(card, txs, due, 1, items.filter((i) => i.account_id === account.id), { ignorePayments: true })[0]?.total ?? 0;
}

export interface StatementCheck {
  /** Cuota proyectada por la app para la fecha de pago del extracto (null sin fecha de pago). */
  projected: number | null;
  /** Proyectado − pago mínimo (null si falta alguno). */
  minimumDiff: number | null;
  /** Deuda de la app al corte. */
  appDebt: number;
  /** Deuda de la app − deuda del extracto (null sin deuda del extracto). */
  debtDiff: number | null;
}

export function checkStatement(account: Account, txs: Transaction[], items: CardStatementItem[], st: CardStatement): StatementCheck {
  const projected = st.due_date ? projectedFor(account, txs, items, st.due_date) : null;
  const appDebt = appDebtAt(account, txs, st.cut_date);
  return {
    projected,
    minimumDiff: projected !== null && st.minimum_payment !== null ? Math.round(projected - st.minimum_payment) : null,
    appDebt,
    debtDiff: st.total_debt !== null ? Math.round(appDebt - st.total_debt) : null,
  };
}

/** ¿La diferencia se puede dar por cuadrada? */
export function squares(diff: number | null): boolean {
  return diff !== null && Math.abs(diff) <= STATEMENT_TOLERANCE;
}

type PurchaseLike = { description: string; purchaseDate: string; amount: number };

/** ¿La compra del extracto ya está en la tarjeta como compra del extracto? (mismo comercio y valor, o mismo valor y fecha) */
export function knownItem(p: PurchaseLike, items: CardStatementItem[], accountId: string): CardStatementItem | undefined {
  return items.find((i) => i.account_id === accountId && Math.abs(i.amount - p.amount) <= 1
    && (i.description.trim().toLowerCase() === p.description.trim().toLowerCase() || daysApart(i.purchase_date, p.purchaseDate) <= 1));
}

/** ¿La compra del extracto ya está registrada en la app? (misma tarjeta, mismo valor ±$1 y fecha ±1 día) Esa ya proyecta sus cuotas. */
export function registeredTx(p: PurchaseLike, txs: Transaction[], accountId: string): Transaction | undefined {
  return txs.find((t) => t.account_id === accountId && t.kind === "EXPENSE" && Math.abs(t.amount - p.amount) <= 1 && daysApart(t.occurred_on, p.purchaseDate) <= 1);
}

// ───────────────────── Cuotas: extracto vs. app ─────────────────────

/** Compra a cuotas tal como la lee el extracto. `paidInstallments` es el número de la cuota que se factura en ese extracto. */
export type ExtractPurchase = Pick<CardStatementPurchase, "description" | "purchaseDate" | "amount" | "installments" | "paidInstallments" | "remainingBalance">;

export type InstallmentVerdict = "OK" | "DIFFERS" | "ONLY_EXTRACT" | "ONLY_APP";
/** installments: total de cuotas · current: cuota que se factura en este extracto · balance: saldo diferido pendiente después de esa cuota. */
export type InstallmentField = "installments" | "current" | "balance";

export interface InstallmentDiff {
  field: InstallmentField;
  /** Lo que tiene o espera la app. */
  app: number;
  /** Lo que dice el extracto. */
  extract: number;
}

export interface InstallmentCheck {
  verdict: InstallmentVerdict;
  /** Compra del extracto (no hay en ONLY_APP). */
  purchase?: ExtractPurchase;
  /** Con qué se comparó: la compra del extracto ya guardada en la tarjeta (ITEM) o el movimiento de la app (APP). */
  source?: "APP" | "ITEM";
  tx?: Transaction;
  item?: CardStatementItem;
  diffs: InstallmentDiff[];
}

/** Cuota que se factura en el extracto que corta `cut` y saldo diferido que queda después, según el movimiento de la app. */
function expectedForTx(t: Transaction, sd: number | null, cut: string | null): { n: number; current: number | null; balance: number | null } {
  const n = installmentsOf(t);
  if (!sd || !cut) return { n, current: null, balance: null };
  const current = Math.min(n, cutsBetween(sd, addDays(billingCut(sd, t.occurred_on), -1), cut));
  const balance = installmentPlan(t.amount, n, t.occurred_on, null).slice(current).reduce((a, c) => a + c.capital, 0);
  return { n, current, balance };
}

/** Lo mismo para una compra del extracto que ya está guardada en la tarjeta: cada corte desde su extracto factura una cuota. */
function expectedForItem(it: CardStatementItem, sd: number | null, cut: string | null, openingAt: string | null | undefined): { current: number | null; balance: number | null } {
  const from = it.as_of ?? openingAt?.slice(0, 10) ?? null;
  if (!sd || !cut || !from) return { current: null, balance: null };
  const cuts = cutsBetween(sd, from, cut);
  return { current: Math.min(it.installments, it.paid_installments + cuts), balance: statementItemsAfter([it], cuts).later };
}

/**
 * Cruza las compras a cuotas del extracto con la app, compra por compra:
 *  · Cuadra (OK) o difiere (DIFFERS) en el total de cuotas, la cuota que se factura y el saldo diferido pendiente.
 *    Si el total de cuotas no es el mismo, solo se informa eso: lo demás es consecuencia.
 *  · ONLY_EXTRACT: está en el extracto y no en la app ni en las compras guardadas de la tarjeta.
 *  · ONLY_APP: la app tiene una compra a cuotas que ya debería venir en este extracto (y todavía no es su última cuota) y no viene.
 * Una compra del extracto se compara primero con la compra ya guardada de la tarjeta y, si no hay, con el movimiento de la app.
 * `cutDate` es el corte del extracto; sin él (o sin día de corte en la tarjeta) solo se compara el total de cuotas.
 */
export function checkInstallments(account: Account, txs: Transaction[], items: CardStatementItem[], purchases: ExtractPurchase[], cutDate: string | null): InstallmentCheck[] {
  const sd = account.statement_day ?? null;
  const cut = cutDate && /^\d{4}-\d{2}-\d{2}$/.test(cutDate) ? cutDate : null;
  const mine = txs.filter((t) => t.account_id === account.id);
  const myItems = items.filter((i) => i.account_id === account.id);
  const used = new Set<string>();
  const out: InstallmentCheck[] = [];

  for (const p of purchases) {
    const item = knownItem(p, myItems, account.id);
    if (item) {
      const e = expectedForItem(item, sd, cut, account.opening_at);
      const diffs: InstallmentDiff[] = [];
      if (item.installments !== p.installments) diffs.push({ field: "installments", app: item.installments, extract: p.installments });
      else {
        if (e.current !== null && e.current !== p.paidInstallments) diffs.push({ field: "current", app: e.current, extract: p.paidInstallments });
        if (e.balance !== null && Math.abs(e.balance - p.remainingBalance) > STATEMENT_TOLERANCE) diffs.push({ field: "balance", app: e.balance, extract: p.remainingBalance });
      }
      out.push({ verdict: diffs.length ? "DIFFERS" : "OK", purchase: p, source: "ITEM", item, diffs });
      for (const t of mine) if (Math.abs(t.amount - item.amount) <= 1 && daysApart(t.occurred_on, item.purchase_date) <= 1) used.add(t.id);
      continue;
    }
    const tx = mine
      .filter((t) => (t.kind === "EXPENSE" || isCardAdvance(t)) && Math.abs(t.amount - p.amount) <= 1 && daysApart(t.occurred_on, p.purchaseDate) <= 1)
      .sort((a, b) => daysApart(a.occurred_on, p.purchaseDate) - daysApart(b.occurred_on, p.purchaseDate) || Math.abs(a.amount - p.amount) - Math.abs(b.amount - p.amount))[0];
    if (!tx) { out.push({ verdict: "ONLY_EXTRACT", purchase: p, diffs: [] }); continue; }
    used.add(tx.id);
    const e = expectedForTx(tx, sd, cut);
    const diffs: InstallmentDiff[] = [];
    if (e.n !== p.installments) diffs.push({ field: "installments", app: e.n, extract: p.installments });
    else {
      if (e.current !== null && e.current !== p.paidInstallments) diffs.push({ field: "current", app: e.current, extract: p.paidInstallments });
      if (e.balance !== null && Math.abs(e.balance - p.remainingBalance) > STATEMENT_TOLERANCE) diffs.push({ field: "balance", app: e.balance, extract: p.remainingBalance });
    }
    out.push({ verdict: diffs.length ? "DIFFERS" : "OK", purchase: p, source: "APP", tx, diffs });
  }

  // En la app y no en el extracto: compras a cuotas hechas antes del corte, ya facturadas y con cuotas por pagar todavía
  if (sd && cut) {
    const open = account.opening_at?.slice(0, 10) ?? null;
    const payoffs = payoffDates(txs);
    const inExtract = matchedWithItems(mine, myItems);
    for (const t of mine) {
      if (used.has(t.id) || inExtract.has(t.id) || t.status === "PENDING_REVIEW") continue;
      if (!(t.kind === "EXPENSE" || isCardAdvance(t)) || installmentsOf(t) <= 1) continue;
      if ((open && t.occurred_on <= open) || t.occurred_on > cut) continue;
      const paidOff = payoffs.get(t.id);
      if (paidOff && paidOff <= cut) continue;
      const e = expectedForTx(t, sd, cut);
      // Aún no se factura, o ya es su última cuota (el extracto solo lista las que tienen saldo pendiente)
      if (e.current === null || e.current < 1 || e.current >= e.n) continue;
      out.push({ verdict: "ONLY_APP", source: "APP", tx: t, diffs: [] });
    }
  }

  const rank: Record<InstallmentVerdict, number> = { DIFFERS: 0, ONLY_APP: 1, ONLY_EXTRACT: 2, OK: 3 };
  return out.sort((a, b) => rank[a.verdict] - rank[b.verdict]);
}
