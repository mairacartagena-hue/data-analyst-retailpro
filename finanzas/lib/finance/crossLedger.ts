// Motor de cruce: quién pagó vs. a quién le correspondía.
// La base de datos (save_transaction) es la que guarda los asientos; estas funciones
// replican la misma regla para mostrar vistas previas y para probarla.

export type SplitOrigin = "NORMAL" | "FIXED_EXCESS";

export interface SplitDraft {
  amount: number;
  categoryId: string | null;
  responsibleUserId: string;
  origin?: SplitOrigin;
}

export type LedgerKind = "CROSS_PAYMENT" | "SPLIT" | "FIXED_EXCESS" | "LOAN" | "ERRAND" | "SETTLEMENT";

export interface LedgerEntry {
  creditorUserId: string; // a quien le deben
  debtorUserId: string; // quien debe
  amount: number;
  kind: LedgerKind;
}

/** Caso 1: coincidencia normal · Caso 2: pago cruzado total · Caso 3: desglose con cruce. */
export type CrossCase = "NORMAL" | "CROSS_PAYMENT" | "SPLIT";

/** Devuelve un mensaje de error en español, o null si el desglose es válido. */
export function validateSplits(total: number, splits: SplitDraft[]): string | null {
  if (!Number.isInteger(total) || total <= 0) return "El total debe ser mayor que cero.";
  if (splits.length === 0) return "Asigna el gasto al menos a una categoría o responsable.";
  for (const s of splits) {
    if (!Number.isInteger(s.amount) || s.amount <= 0) return "Cada parte debe ser un monto mayor que cero.";
    if (!s.responsibleUserId) return "Cada parte necesita un responsable.";
  }
  const diff = total - splits.reduce((acc, s) => acc + s.amount, 0);
  if (diff > 0) return `Faltan ${diff.toLocaleString("es-CO")} pesos por asignar.`;
  if (diff < 0) return `Te pasaste por ${(-diff).toLocaleString("es-CO")} pesos.`;
  return null;
}

/** Lo que falta por asignar del total (negativo si se pasó). */
export function unassigned(total: number, splits: SplitDraft[]): number {
  return total - splits.reduce((acc, s) => acc + s.amount, 0);
}

export function classifyExpense(payerUserId: string, splits: SplitDraft[]): CrossCase {
  if (!splits.some((s) => s.responsibleUserId !== payerUserId)) return "NORMAL";
  return splits.length === 1 ? "CROSS_PAYMENT" : "SPLIT";
}

/** Asientos que genera un gasto: cada parte que le correspondía al otro queda a favor del pagador. */
export function ledgerEntriesForExpense(payerUserId: string, splits: SplitDraft[]): LedgerEntry[] {
  return splits
    .filter((s) => s.responsibleUserId !== payerUserId)
    .map((s) => ({
      creditorUserId: payerUserId,
      debtorUserId: s.responsibleUserId,
      amount: s.amount,
      kind: s.origin === "FIXED_EXCESS" ? "FIXED_EXCESS" : splits.length === 1 ? "CROSS_PAYMENT" : "SPLIT",
    }));
}

/** Liquidación: quien paga queda como acreedor, lo que reduce su deuda. */
export function settlementEntry(payerUserId: string, receiverUserId: string, amount: number): LedgerEntry {
  return { creditorUserId: payerUserId, debtorUserId: receiverUserId, amount, kind: "SETTLEMENT" };
}

/**
 * Neto entre los dos desde el punto de vista de `me`:
 * positivo = la pareja me debe · negativo = yo le debo.
 */
export function netFor(me: string, entries: LedgerEntry[]): number {
  let net = 0;
  for (const e of entries) {
    if (e.creditorUserId === me) net += e.amount;
    else if (e.debtorUserId === me) net -= e.amount;
  }
  return net;
}

/** Lo que yo le debo a mi pareja (0 si no le debo). Se resta del Saldo Seguro. */
export function owedToPartner(me: string, entries: LedgerEntry[]): number {
  return Math.max(0, -netFor(me, entries));
}

/** Lo que mi pareja me debe (0 si no me debe). No suma al Saldo Seguro. */
export function owedByPartner(me: string, entries: LedgerEntry[]): number {
  return Math.max(0, netFor(me, entries));
}

export interface SettlementSuggestion {
  payerUserId: string;
  receiverUserId: string;
  amount: number;
}

/** Transferencia que deja el cruce en cero, o null si ya están a paz y salvo. */
export function suggestSettlement(me: string, partner: string, entries: LedgerEntry[]): SettlementSuggestion | null {
  const net = netFor(me, entries);
  if (net === 0) return null;
  return net < 0
    ? { payerUserId: me, receiverUserId: partner, amount: -net }
    : { payerUserId: partner, receiverUserId: me, amount: net };
}
