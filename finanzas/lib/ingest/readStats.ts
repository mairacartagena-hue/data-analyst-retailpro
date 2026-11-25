// Cuánto de lo que llega se lee con reglas y cuánto necesita a Gemini. Se muestra en Captura automática
// para ver qué formatos falta enseñarle a las reglas.

import { senderEmail } from "./senders";

export interface ReadStatsRow {
  parser: string | null;
  source: string | null;
}

export interface ReadStats {
  /** Avisos que alguien leyó (reglas o Gemini); los que ninguna lectura reconoció no cuentan. */
  total: number;
  withGemini: number;
  /** Porcentaje leído sin IA, redondeado; null si no hay avisos. */
  pctWithoutAi: number | null;
  /** Fuentes que más le pidieron a Gemini, de mayor a menor. */
  geminiSources: { source: string; count: number }[];
}

/** Nombre corto de la fuente: la dirección de correo si la hay; si no, la app o el número tal cual. */
export function sourceLabel(source: string | null): string {
  const s = (source ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "Sin fuente";
  return senderEmail(s) ?? s;
}

export function readStats(rows: ReadStatsRow[], topSources = 5): ReadStats {
  let total = 0;
  let withGemini = 0;
  const bySource = new Map<string, number>();
  for (const r of rows) {
    if (!r.parser) continue;
    total++;
    if (r.parser !== "gemini") continue;
    withGemini++;
    const label = sourceLabel(r.source);
    bySource.set(label, (bySource.get(label) ?? 0) + 1);
  }
  return {
    total,
    withGemini,
    pctWithoutAi: total === 0 ? null : Math.round(((total - withGemini) / total) * 100),
    geminiSources: [...bySource.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source))
      .slice(0, topSources),
  };
}
