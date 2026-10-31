// Registro de parsers por fuente. Para agregar un banco: crear lib/ingest/parsers/<banco>.ts
// con un BankParser y sumarlo a PARSERS. El núcleo (pipeline, deduplicación, memoria) no cambia.
//
// Los formatos de cada banco se escriben a partir de ejemplos reales (no se inventan).

import type { BankParser, ParsedEvent, RawEvent } from "./types";
import { isKnownSubscription, SUBSCRIPTION_TAG } from "@/lib/finance/subscriptions";
import { bancolombiaParser } from "./parsers/bancolombia";
import { bbvaParser } from "./parsers/bbva";
import { cajaSocialParser } from "./parsers/cajaSocial";
import { googleWalletParser } from "./parsers/googleWallet";
import { nequiParser } from "./parsers/nequi";
import { cleanMerchant, detectIgnore, eventText, findDate, findIdentifiers, guessInstitution, normalizeMerchant } from "./normalize";

export const PARSERS: BankParser[] = [
  bancolombiaParser,
  bbvaParser,
  cajaSocialParser,
  googleWalletParser,
  nequiParser,
  // Banco de Bogotá: se agrega cuando haya ejemplos reales
];

export interface ParseOutcome {
  parsed: ParsedEvent | null;
  parser: string | null;
}

/** Completa lo que el parser no llenó: comercio limpio, normalizado, entidad e identificadores. */
export function finishParsed(ev: RawEvent, parsed: ParsedEvent): ParsedEvent {
  const merchant = cleanMerchant(parsed.merchant ?? null);
  const merchantNorm = parsed.merchantNorm ?? normalizeMerchant(merchant);
  return {
    ...parsed,
    merchant,
    merchantNorm,
    tags: [...(parsed.tags ?? []), ...(parsed.kind === "PURCHASE" && isKnownSubscription(merchantNorm) ? [SUBSCRIPTION_TAG] : [])],
    institution: parsed.institution ?? guessInstitution(ev),
    // Si el parser (o Gemini) no trajo la fecha, se busca en el texto; si no aparece, se usa la hora de llegada
    occurredAt: parsed.occurredAt ?? findDate(eventText(ev).replace(/\s+/g, " ")),
    identifiers: parsed.identifiers ?? findIdentifiers(eventText(ev)),
  };
}

/** Reglas deterministas y gratis: mensajes a ignorar y luego el parser de la fuente. */
export function parseWithRules(ev: RawEvent): ParseOutcome {
  const text = eventText(ev);
  const ignore = detectIgnore(text);
  if (ignore) return { parsed: { kind: "IGNORE", ignoreReason: ignore }, parser: "ignore-rules" };

  for (const p of PARSERS) {
    if (!p.matches(ev)) continue;
    const parsed = p.parse(ev);
    if (parsed) return { parsed: finishParsed(ev, parsed), parser: p.id };
  }
  return { parsed: null, parser: null };
}
