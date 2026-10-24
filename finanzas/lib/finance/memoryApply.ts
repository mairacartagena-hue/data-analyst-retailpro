// Cuando se edita una memoria de comercio (nombre, categoría, responsable, espacio…), los movimientos anteriores
// de ese mismo origen se actualizan igual, pero solo en lo que cambió y solo los que la persona registró y ya confirmó.

import type { MerchantMemory, Transaction } from "@/lib/types";

export interface MemoryValues {
  label: string | null;
  categoryId: string | null;
  responsibleId: string | null;
  scope: "HOUSEHOLD" | "PERSONAL";
  createsDebt: boolean;
}

export const memoryValues = (m: MerchantMemory, me: string): MemoryValues => ({
  label: m.label ?? null,
  categoryId: m.category_id ?? null,
  responsibleId: m.responsible_user_id ?? me,
  scope: m.scope ?? "PERSONAL",
  createsDebt: m.creates_debt,
});

export type MemoryChange = Partial<MemoryValues>;

/** Solo lo que cambió entre antes y después de editar. */
export function memoryChange(before: MemoryValues, after: MemoryValues): MemoryChange {
  const out: MemoryChange = {};
  if (before.label !== after.label) out.label = after.label;
  if (before.categoryId !== after.categoryId) out.categoryId = after.categoryId;
  if (before.responsibleId !== after.responsibleId) out.responsibleId = after.responsibleId;
  if (before.scope !== after.scope) out.scope = after.scope;
  if (before.createsDebt !== after.createsDebt) out.createsDebt = after.createsDebt;
  return out;
}

/** ¿Este movimiento vino de este comercio, llave, cuenta o celular? */
export function memoryMatches(tx: Transaction, m: MerchantMemory): boolean {
  const kinds = m.movement_kind === "REFUND" ? ["REFUND", "INCOME"] : ["EXPENSE"];
  if (!kinds.includes(tx.kind)) return false;
  if (m.identifier_type === "MERCHANT") return (tx.merchant_norm ?? "") === m.identifier;
  if (m.identifier_type === "KEYWORD") return false; // el texto del aviso ya no está
  return (tx.ingest_identifiers ?? []).some((i) => i.type.toUpperCase() === m.identifier_type && i.value.toLowerCase() === m.identifier);
}

const DERIVED_DESCRIPTION = /^(?:cuenta|llave)\s*[·.\s]*\d+$/i;

export interface ApplyResult {
  payload: Record<string, unknown> | null;
  /** Por qué no se actualizó (para informarlo). */
  skipped?: "OTHER_PERSON" | "PENDING" | "DIVIDED" | "NOTHING";
}

/**
 * Parámetros de save_transaction() para actualizar un movimiento anterior con lo que cambió en la memoria.
 * Los pendientes no se tocan (se resuelven al revisarlos), ni los de otra persona, ni los divididos si el cambio es de categoría o responsable.
 */
export function applyChange(tx: Transaction, change: MemoryChange, prevLabel: string | null, me: string): ApplyResult {
  if (tx.created_by !== me || tx.payer_user_id !== me) return { payload: null, skipped: "OTHER_PERSON" };
  if (tx.status !== "CONFIRMED") return { payload: null, skipped: "PENDING" };
  if (Object.keys(change).length === 0) return { payload: null, skipped: "NOTHING" };
  const touchesSplits = change.categoryId !== undefined || change.responsibleId !== undefined;
  if (touchesSplits && tx.splits.length !== 1) return { payload: null, skipped: "DIVIDED" };

  let merchant = tx.merchant;
  let description = tx.description;
  if (change.label) {
    merchant = change.label;
    // Si la persona escribió su propia descripción, se respeta
    const derived = !description || description === tx.merchant || description === prevLabel || DERIVED_DESCRIPTION.test(description);
    if (derived) description = change.label;
  }
  return {
    payload: {
      id: tx.id,
      kind: tx.kind,
      scope: change.scope ?? tx.scope,
      amount: tx.amount,
      occurred_on: tx.occurred_on,
      description,
      merchant,
      account_id: tx.account_id,
      tags: tx.tags,
      creates_debt: change.createsDebt ?? tx.creates_debt,
      scheduled_payment_id: tx.scheduled_payment_id ?? null,
      scheduled_for: tx.scheduled_for ?? null,
      splits: tx.splits.map((s) => ({
        amount: s.amount,
        category_id: touchesSplits && change.categoryId !== undefined ? change.categoryId : s.category_id,
        responsible_user_id: touchesSplits && change.responsibleId !== undefined ? change.responsibleId : s.responsible_user_id,
        origin: s.origin ?? "NORMAL",
        note: s.note ?? null,
      })),
    },
  };
}
