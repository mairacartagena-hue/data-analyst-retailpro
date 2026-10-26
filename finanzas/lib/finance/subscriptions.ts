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

export interface UpcomingSubscription {
  key: string;
  name: string;
  amount: number; // último cobro
  nextDate: string; // fecha estimada del próximo cobro
}

function addMonthsKeepDay(iso: string, months: number, day: number): string {
  const [y, m] = iso.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.toISOString().slice(0, 8)}${String(Math.min(day, last)).padStart(2, "0")}`;
}

/**
 * Próximos cobros de suscripciones según los antecedentes: los comercios marcados como suscripción, los conocidos
 * o los que se cobran cada mes por un monto parecido. El próximo cobro se estima el mismo día del mes del último.
 * Si el último cobro tiene más de ~40 días, la suscripción se da por cancelada.
 */
export function upcomingSubscriptions(txs: Transaction[], payerId: string, today: string, until: string): UpcomingSubscription[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.kind !== "EXPENSE" || t.payer_user_id !== payerId) continue;
    const k = key(t);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const detected = new Set(detectSubscriptions(txs, payerId).map((c) => c.key));
  const out: UpcomingSubscription[] = [];
  for (const [k, list] of groups) {
    if (!detected.has(k) && !list.some((t) => t.tags.includes(SUBSCRIPTION_TAG))) continue;
    const last = [...list].sort((a, b) => a.occurred_on.localeCompare(b.occurred_on)).at(-1)!;
    if (last.occurred_on > today || days(today, last.occurred_on) > 40) continue;
    const day = Number(last.occurred_on.slice(8, 10));
    let next = addMonthsKeepDay(last.occurred_on, 1, day);
    for (let i = 2; next <= today; i++) next = addMonthsKeepDay(last.occurred_on, i, day);
    if (next > until) continue;
    out.push({ key: k, name: last.merchant ?? last.description ?? k, amount: last.amount, nextDate: next });
  }
  return out.sort((a, b) => a.nextDate.localeCompare(b.nextDate) || b.amount - a.amount);
}
