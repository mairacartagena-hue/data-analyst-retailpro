// Parámetros de save_transaction() para editar un movimiento que ya existe, cambiando solo algunos datos.
// save_transaction reescribe todo el movimiento: por eso se reenvían los demás datos tal como están.

import type { Transaction } from "@/lib/types";

/** Reparte un valor nuevo entre las partes del gasto en la misma proporción (lo que sobra va a la última). */
export function scaleSplits(t: Pick<Transaction, "splits">, amount: number) {
  const base = t.splits.reduce((s, x) => s + x.amount, 0) || 1;
  let left = amount;
  return t.splits.map((s, i) => {
    const v = i === t.splits.length - 1 ? left : Math.round((s.amount * amount) / base);
    left -= v;
    return { amount: v, category_id: s.category_id, responsible_user_id: s.responsible_user_id, origin: s.origin ?? "NORMAL" };
  });
}

/** Lo único que estas ediciones cambian: el valor y/o el número de cuotas. Todo lo demás se conserva. */
export interface TxPatch {
  amount?: number;
  installments?: number;
}

export function editPayload(t: Transaction, patch: TxPatch = {}) {
  const amount = patch.amount ?? t.amount;
  const splits = t.splits.length ? (amount === t.amount ? t.splits.map((s) => ({ amount: s.amount, category_id: s.category_id, responsible_user_id: s.responsible_user_id, origin: s.origin ?? "NORMAL", note: s.note ?? null })) : scaleSplits(t, amount)) : [];
  return {
    id: t.id, kind: t.kind, scope: t.scope, amount, occurred_on: t.occurred_on, description: t.description,
    merchant: t.merchant ?? null, tags: t.tags ?? [], account_id: t.account_id, to_account_id: t.to_account_id,
    direction: t.direction ?? null, installments: patch.installments ?? t.installments ?? 1, interest_rate_ea: t.interest_rate_ea ?? null,
    creates_debt: t.creates_debt, is_shared: t.is_shared, income_category_id: t.income_category_id ?? null,
    scheduled_payment_id: t.scheduled_payment_id ?? null, scheduled_for: t.scheduled_for ?? null, splits,
  };
}
