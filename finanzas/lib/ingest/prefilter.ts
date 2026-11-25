// Filtro previo a Gemini: lo que ninguna persona leería como movimiento no gasta el cupo de la IA.
// Es puro (sin red ni base de datos) para poder probarlo.

import type { ParsedEvent, RawEvent } from "./types";
import { eventText } from "./normalize";

/** Quita fechas y horas: "2026-11-20", "20/11/2026", "2026/11/20", "16:14" no son montos. */
function withoutDates(text: string): string {
  return text
    .replace(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/g, " ")
    .replace(/\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/g, " ")
    .replace(/\d{1,2}:\d{2}(?::\d{2})?/g, " ");
}

/**
 * ¿El texto trae algo que parezca un monto? Con signo pesos o "COP" cualquier número vale; sin ellos hacen falta
 * 4 dígitos o más o miles con separador ("1.250" sí; "500" no, porque casi siempre es un código, una hora o un día).
 */
export function hasAmount(text: string): boolean {
  const t = withoutDates(text);
  return /\$\s?\d|\bcop\s?\d|\d{1,3}(?:[.,]\d{3})+|\b\d{4,}\b/i.test(t);
}

/**
 * Descarta sin Gemini lo que no puede ser un movimiento. Devuelve null cuando hay que seguir leyéndolo.
 * Hoy: avisos sin ningún monto (el registro exige un monto, así que Gemini solo gastaría cupo para decir "no es un movimiento").
 */
export function prefilterBeforeGemini(ev: RawEvent): ParsedEvent | null {
  if (!hasAmount(eventText(ev))) return { kind: "IGNORE", ignoreReason: "Sin monto" };
  return null;
}

/** Tope diario de lecturas con Gemini por persona (cupo gratuito de la IA). GEMINI_DAILY_CAP lo cambia; 0 o inválido = sin tope. */
export const DEFAULT_GEMINI_DAILY_CAP = 30;

export function geminiDailyCap(raw: string | undefined = process.env.GEMINI_DAILY_CAP): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_GEMINI_DAILY_CAP;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
