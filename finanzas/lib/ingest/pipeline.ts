import "server-only";

// Interpretación de un aviso: primero reglas (gratis), luego Gemini como respaldo.
// Lo usan el webhook (MacroDroid/Gmail) y el botón Reintentar de Captura automática.

import type { ParsedEvent, RawEvent } from "./types";
import { eventText } from "./normalize";
import { finishParsed, parseWithRules } from "./registry";
import { extractWithGemini } from "./gemini";
import { prefilterBeforeGemini } from "./prefilter";

export interface Interpretation {
  parsed: ParsedEvent | null;
  parser: string | null;
  reason?: string;
}

export interface InterpretOptions {
  /**
   * Se consulta justo antes de llamar a Gemini (no en cada aviso). Si responde false, la persona ya llegó al tope diario
   * de lecturas con IA: el aviso queda sin reconocer y se puede reintentar con el botón.
   */
  canUseGemini?: () => Promise<boolean>;
}

export async function interpret(ev: RawEvent, opts: InterpretOptions = {}): Promise<Interpretation> {
  const rules = parseWithRules(ev);
  if (rules.parsed) return rules;
  // Sin monto no puede ser un movimiento: no se le gasta el cupo a Gemini
  const skipped = prefilterBeforeGemini(ev);
  if (skipped) return { parsed: skipped, parser: "ignore-rules" };
  if (opts.canUseGemini && !(await opts.canUseGemini())) return { parsed: null, parser: null, reason: "Se llegó al tope diario de lecturas con Gemini; se puede reintentar mañana" };
  try {
    const g = await extractWithGemini(ev);
    if (g) return { parsed: g.kind === "IGNORE" ? g : finishParsed(ev, g), parser: "gemini" };
    return { parsed: null, parser: null, reason: process.env.GEMINI_API_KEY ? "Ni las reglas ni Gemini reconocieron el formato" : "Las reglas no reconocieron el formato (Gemini no está configurado)" };
  } catch (e) {
    return { parsed: null, parser: null, reason: `Gemini no respondió: ${(e as Error).message}` };
  }
}

/** Evento en el formato que espera ingest_event() / reingest_log() en la base de datos. */
export function toDbEvent(ev: RawEvent, it: Interpretation) {
  const p = it.parsed;
  return {
    channel: ev.channel,
    source: ev.source,
    external_id: ev.externalId ?? null,
    raw_text: eventText(ev),
    received_at: ev.receivedAt,
    parser: it.parser,
    reason: it.reason,
    parsed: p
      ? {
          kind: p.kind,
          amount: p.amount ?? null,
          merchant: p.merchant ?? null,
          merchant_norm: p.merchantNorm ?? null,
          last4: p.last4 ?? null,
          institution: p.institution ?? null,
          occurred_at: p.occurredAt ?? null,
          identifiers: p.identifiers ?? [],
          tags: p.tags ?? [],
          ignore_reason: p.ignoreReason ?? null,
        }
      : null,
  };
}
