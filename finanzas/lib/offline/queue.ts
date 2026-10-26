// Movimientos guardados sin conexión, en espera de enviarse a Supabase.

export interface QueuedTx {
  /** Identificador del envío: reenviarlo no duplica el movimiento (save_transaction_once). */
  client_id: string;
  queued_at: string;
  /** Lo que recibe save_transaction(). */
  payload: Record<string, unknown>;
  tagIds: string[];
  /** Último error de la base de datos (ej. datos no válidos); los de conexión no se guardan. */
  error?: string | null;
}

export function newClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Respaldo para navegadores viejos: UUID v4 con Math.random
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function queuedSummary(q: QueuedTx): { amount: number; description: string; date: string; kind: string } {
  const p = q.payload;
  return {
    amount: Number(p.amount) || 0,
    description: String(p.description ?? "").trim(),
    date: String(p.occurred_on ?? ""),
    kind: String(p.kind ?? ""),
  };
}
