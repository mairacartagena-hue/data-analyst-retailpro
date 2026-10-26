// Plata de un tercero: alguien (ej. Álvaro) envía dinero y la persona hace un pago por él.
// Esos movimientos mueven el saldo real de la cuenta, pero no son gasto ni ingreso propio.

import type { MerchantMemory, Transaction } from "@/lib/types";

export const DEFAULT_THIRD_PARTY_NAME = "Álvaro";

export function isThirdParty(t: Pick<Transaction, "third_party_id">): boolean {
  return !!t.third_party_id;
}

/**
 * Saldo con el tercero, desde los movimientos de quien paga:
 * positivo = plata recibida que aún no se ha pagado (es de él);
 * negativo = se pagó y aún no la ha devuelto (él debe).
 */
export function thirdPartyBalance(txs: Transaction[], payerUserId: string, thirdPartyId?: string): number {
  let bal = 0;
  for (const t of txs) {
    if (!t.third_party_id || t.payer_user_id !== payerUserId) continue;
    if (thirdPartyId && t.third_party_id !== thirdPartyId) continue;
    if (t.kind === "INCOME") bal += Number(t.amount);
    if (t.kind === "EXPENSE") bal -= Number(t.amount);
  }
  return bal;
}

/** Plata recibida del tercero que aún no se ha pagado: se aparta del Saldo Seguro. */
export function heldForThirdParty(txs: Transaction[], payerUserId: string): number {
  return Math.max(0, thirdPartyBalance(txs, payerUserId));
}

/** ¿El comercio o remitente ya se marcó antes como del tercero? Devuelve el id del tercero. */
export function suggestThirdParty(
  t: Pick<Transaction, "merchant_norm" | "ingest_identifiers">,
  memory: Pick<MerchantMemory, "identifier_type" | "identifier" | "third_party_id">[],
): string | null {
  const keys = new Set<string>();
  if (t.merchant_norm) keys.add(`MERCHANT:${t.merchant_norm}`);
  for (const i of t.ingest_identifiers ?? []) {
    if (i?.type && i?.value) keys.add(`${i.type.toUpperCase()}:${i.value.toLowerCase()}`);
  }
  const hit = memory.find((m) => m.third_party_id && keys.has(`${m.identifier_type}:${m.identifier}`));
  return hit?.third_party_id ?? null;
}
