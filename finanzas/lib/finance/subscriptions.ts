// Suscripciones: comercios conocidos y cobros que se repiten cada mes por un monto parecido.

import type { Transaction } from "@/lib/types";
import { normalizeMerchant } from "@/lib/ingest/normalize";

export const SUBSCRIPTION_TAG = "#suscripcion";

// Servicios que casi siempre son suscripción (se reconocen por el nombre del comercio)
const KNOWN = [
  "netflix", "spotify", "youtube", "play yout", "disney", "hbo", "max com", "prime video", "amazon prime", "primevideo",
  "apple com bill", "icloud", "claude", "anthropic", "openai", "chatgpt", "deezer", "crunchyroll", "paramount",
  "xbox", "playstation", "microsoft 365", "office 365", "canva", "adobe", "dropbox", "google one", "google storage",
  "rappi prime", "rappi pro", "duolingo", "tidal", "star plus", "vix", "mubi", "linkedin premium", "notion",
];

export function isKnownSubscription(merchantNorm: string | null | undefined): boolean {
  if (!merchantNorm) return false;
  return KNOWN.some((k) => merchantNorm.includes(k));
}

export interface SubscriptionCandidate {
  key: string;
  name: string;
  averageAmount: number;
  count: number;
  lastDate: string;
  transactionIds: string[];
  known: boolean;
}

function key(t: Transaction): string | null {
  return t.merchant_norm ?? normalizeMerchant(t.merchant ?? t.description);
}

function days(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/**
 * Posibles suscripciones aún sin etiquetar: un comercio con al menos 2 cobros separados entre 25 y 35 días
 * y montos dentro de ±15 %, o un comercio conocido de suscripción.
 */
export function detectSubscriptions(txs: Transaction[], payerId: string): SubscriptionCandidate[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.kind !== "EXPENSE" || t.payer_user_id !== payerId) continue;
    const k = key(t);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }

  const out: SubscriptionCandidate[] = [];
  for (const [k, list] of groups) {
    if (list.every((t) => t.tags.includes(SUBSCRIPTION_TAG))) continue;
    const sorted = [...list].sort((a, b) => a.occurred_on.localeCompare(b.occurred_on));
    let monthly = false;
    for (let i = 1; i < sorted.length && !monthly; i++) {
      const gap = days(sorted[i].occurred_on, sorted[i - 1].occurred_on);
      const ratio = sorted[i].amount / sorted[i - 1].amount;
      if (gap >= 25 && gap <= 35 && ratio >= 0.85 && ratio <= 1.15) monthly = true;
    }
    const known = isKnownSubscription(k);
    if (!monthly && !known) continue;
    out.push({
      key: k,
      name: sorted.at(-1)!.merchant ?? sorted.at(-1)!.description ?? k,
      averageAmount: Math.round(sorted.reduce((a, t) => a + t.amount, 0) / sorted.length),
      count: sorted.length,
      lastDate: sorted.at(-1)!.occurred_on,
      transactionIds: sorted.map((t) => t.id),
      known,
    });
  }
  return out.sort((a, b) => b.averageAmount - a.averageAmount);
}
