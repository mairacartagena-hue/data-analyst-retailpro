// Detecta si un movimiento que llegó automáticamente parece ser el mismo que la persona registró a mano
// (por ejemplo, pagó "Lulo bank" con el botón Registrar pago usando el monto del presupuesto y luego llegó
// el aviso del banco con el monto exacto).

import type { Category, Transaction } from "@/lib/types";
import { normalizeMerchant } from "./normalize";

const STOPWORDS = new Set([
  "banco", "pago", "pagos", "cuenta", "credito", "creditos", "colombia", "zona", "transferencia",
  "compra", "servicio", "tarjeta", "bancolombia", "cartera", "boton", "para", "desde",
]);

function words(text: string | null | undefined): Set<string> {
  const n = normalizeMerchant(text ?? null) ?? "";
  return new Set(n.split(" ").filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !STOPWORDS.has(w)));
}

function shareWord(a: Set<string>, b: Set<string>): boolean {
  for (const w of a) if (b.has(w)) return true;
  return false;
}

function dayDiff(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/** Un aviso de compra puede ser un pago de deuda registrado a mano; un ingreso, un reembolso. */
function sameDirection(manual: Transaction["kind"], pending: Transaction["kind"]): boolean {
  return manual === pending || (pending === "EXPENSE" && manual === "DEBT_PAYMENT") || (pending === "INCOME" && manual === "REFUND");
}

/** Movimiento manual (±3 días, mismo tipo y pagador) que parece ser el mismo pago, o null. */
export function findManualTwin(pending: Transaction, all: Transaction[], categories: Category[]): Transaction | null {
  const target = words(pending.merchant_norm ?? pending.merchant ?? pending.description);
  let best: Transaction | null = null;
  let bestScore = Infinity;
  for (const t of all) {
    if (t.id === pending.id || t.source !== "MANUAL" || !sameDirection(t.kind, pending.kind)) continue;
    if (t.payer_user_id !== pending.payer_user_id || t.status !== "CONFIRMED") continue;
    if (t.splits.length > 1 || dayDiff(t.occurred_on, pending.occurred_on) > 3) continue;
    if (pending.account_id && t.account_id && pending.account_id !== t.account_id) continue;

    const catName = t.splits[0]?.category_id ? categories.find((c) => c.id === t.splits[0].category_id)?.name : null;
    const sameName = shareWord(target, words(t.merchant ?? t.description)) || shareWord(target, words(catName));
    // Tiene que coincidir el nombre (comercio, descripción o categoría); el monto puede diferir hasta un 25 %
    if (!sameName) continue;
    if (Math.abs(t.amount - pending.amount) > 0.25 * pending.amount) continue;

    const score = Math.abs(t.amount - pending.amount) + dayDiff(t.occurred_on, pending.occurred_on) * 1000;
    if (score < bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}
