// Extractos de la tarjeta de crédito: cruce de lo que dice el banco con lo que proyecta la app.
//  · La cuota del mes (lo que la app proyecta pagar en la fecha de pago del extracto) contra el pago mínimo.
//  · La deuda de la app al día del corte contra la deuda total del extracto.

import type { Account, CardStatement, CardStatementItem, Transaction } from "@/lib/types";
import { accountStatement } from "./reconcile";
import { projectCard } from "./installments";

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
