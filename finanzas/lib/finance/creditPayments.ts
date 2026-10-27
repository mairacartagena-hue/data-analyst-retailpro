// Cuotas pagadas de un crédito y su reparto real (capital vs. intereses y seguros).
// Hay dos formas en que la app guarda un pago:
//  · "cargado al crédito" (cruce automático): transferencia al crédito por el total pagado + gasto en la cuenta
//    del crédito por los intereses y seguros (sube la deuda en lo que no fue capital).
//  · "desde la cuenta" (registro manual de la cuota): transferencia al crédito por el capital + gasto en la cuenta
//    que pagó por los intereses y seguros.
// En ambos casos se puede corregir con el pago real del banco: se escribe el capital y el resto queda como
// intereses y seguros, sin cambiar lo que salió de la cuenta que pagó.

import type { Account, Transaction } from "@/lib/types";

export interface CreditPayment {
  date: string;
  /** Lo que salió de la cuenta que pagó. */
  total: number;
  capital: number;
  charges: number;
  /** Transferencia a la cuenta del crédito. */
  transfer: Transaction;
  /** Gasto de intereses y seguros (si existe). */
  charge: Transaction | null;
  mode: "ON_CREDIT" | "FROM_ACCOUNT";
}

const confirmed = (t: Transaction) => t.status !== "PENDING_REVIEW";

/** Cuotas pagadas del crédito (las más recientes primero). */
export function creditPayments(credit: Pick<Account, "id" | "name">, txs: Transaction[], since?: string): CreditPayment[] {
  const out: CreditPayment[] = [];
  const used = new Set<string>();
  const name = credit.name.toLowerCase();
  const transfers = txs
    .filter((t) => confirmed(t) && t.kind === "TRANSFER" && t.to_account_id === credit.id && (!since || t.occurred_on >= since))
    .sort((a, b) => (a.occurred_on < b.occurred_on ? 1 : a.occurred_on > b.occurred_on ? -1 : 0));
  for (const p of transfers) {
    const sameDay = txs.filter((t) => confirmed(t) && t.kind === "EXPENSE" && t.occurred_on === p.occurred_on && !used.has(t.id));
    const onCredit = sameDay.find((t) => t.account_id === credit.id);
    const fromAccount = onCredit
      ? undefined
      : sameDay.find((t) => t.account_id === p.account_id && /intereses|cuota/i.test(t.description ?? "") && (t.description ?? "").toLowerCase().includes(name));
    const charge = onCredit ?? fromAccount ?? null;
    if (charge) used.add(charge.id);
    if (onCredit) {
      out.push({ date: p.occurred_on, total: p.amount, capital: Math.max(0, p.amount - onCredit.amount), charges: onCredit.amount, transfer: p, charge: onCredit, mode: "ON_CREDIT" });
    } else if (fromAccount) {
      out.push({ date: p.occurred_on, total: p.amount + fromAccount.amount, capital: p.amount, charges: fromAccount.amount, transfer: p, charge: fromAccount, mode: "FROM_ACCOUNT" });
    } else {
      out.push({ date: p.occurred_on, total: p.amount, capital: p.amount, charges: 0, transfer: p, charge: null, mode: "ON_CREDIT" });
    }
  }
  return out;
}

export interface PaymentFix {
  /** Nuevo valor de la transferencia al crédito. */
  transferAmount: number;
  /** Nuevo valor del gasto de intereses y seguros (0 = no debe haber gasto). */
  chargeAmount: number;
}

/** Cómo quedan los movimientos con el capital real, sin cambiar el total pagado. null si el capital no es válido. */
export function fixWithRealCapital(p: CreditPayment, capital: number): PaymentFix | null {
  if (!Number.isFinite(capital) || capital < 0 || capital > p.total) return null;
  const charges = p.total - capital;
  return p.mode === "ON_CREDIT"
    ? { transferAmount: p.total, chargeAmount: charges }
    : { transferAmount: capital, chargeAmount: charges };
}

/**
 * Movimiento del mes de un crédito separado como en el extracto: lo que bajó el capital, los intereses y seguros
 * de las cuotas (cargados al crédito) y otros desembolsos o ajustes. `inflow`/`outflow` son los del extracto de la app.
 */
export function creditMonthBreakdown(
  credit: Pick<Account, "id" | "name">, txs: Transaction[], range: { start: string; end: string }, inflow: number, outflow: number,
): { capital: number; charges: number; other: number } {
  const charges = creditPayments(credit, txs, range.start)
    .filter((p) => p.mode === "ON_CREDIT" && p.charge && p.charge.occurred_on >= range.start && p.charge.occurred_on <= range.end)
    .reduce((s, p) => s + p.charges, 0);
  const used = Math.min(charges, inflow, outflow);
  return { capital: inflow - used, charges: used, other: outflow - used };
}
