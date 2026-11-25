import { describe, expect, it } from "vitest";
import { geminiDailyCap, hasAmount, prefilterBeforeGemini, DEFAULT_GEMINI_DAILY_CAP } from "@/lib/ingest/prefilter";
import { readStats, sourceLabel } from "@/lib/ingest/readStats";
import type { RawEvent } from "@/lib/ingest/types";

const ev = (text: string, title?: string): RawEvent => ({ channel: "ANDROID_NOTIFICATION", source: "Banco X", title, text, receivedAt: "2026-11-20T21:00:00.000Z" });

describe("hasAmount", () => {
  it("reconoce montos con signo pesos, COP o miles", () => {
    expect(hasAmount("Pagaste $500 en una tienda")).toBe(true);
    expect(hasAmount("valor COP 90")).toBe(true);
    expect(hasAmount("Pagaste 63.490,00 en GOOGLE")).toBe(true);
    expect(hasAmount("JUAN te envió 300000")).toBe(true);
    expect(hasAmount("recibiste 1,050,000 de YOLIMA")).toBe(true);
  });

  it("las fechas y horas no cuentan como monto", () => {
    expect(hasAmount("Iniciaste sesión el 2026-11-20 a las 16:14")).toBe(false);
    expect(hasAmount("Ingreso a la app 2026/11/20 16:14:05")).toBe(false);
    expect(hasAmount("El 20/11/2026 a las 16:14 entraste desde la web")).toBe(false);
  });

  it("un número chico sin signo pesos no es un monto", () => {
    expect(hasAmount("Tienes 3 notificaciones nuevas, 12 beneficios")).toBe(false);
    expect(hasAmount("Entra a Nequi y mira lo nuevo")).toBe(false);
  });
});

describe("prefilterBeforeGemini", () => {
  it("un aviso sin monto se descarta sin Gemini", () => {
    expect(prefilterBeforeGemini(ev("Entra a Nequi y mira lo nuevo", "Novedades"))).toEqual({ kind: "IGNORE", ignoreReason: "Sin monto" });
  });

  it("el monto puede venir en el título", () => {
    expect(prefilterBeforeGemini(ev("Revisa tu movimiento", "Compra por $45.000"))).toBeNull();
  });

  it("un aviso con monto sigue a Gemini", () => {
    expect(prefilterBeforeGemini(ev("Pagaste $73.500 en un fondo de inversión"))).toBeNull();
  });
});

describe("tope diario de Gemini", () => {
  it("usa 30 por defecto y acepta un valor propio", () => {
    expect(geminiDailyCap(undefined)).toBe(DEFAULT_GEMINI_DAILY_CAP);
    expect(geminiDailyCap("")).toBe(DEFAULT_GEMINI_DAILY_CAP);
    expect(geminiDailyCap("50")).toBe(50);
  });

  it("0 o un valor inválido quitan el tope", () => {
    expect(geminiDailyCap("0")).toBe(0);
    expect(geminiDailyCap("-4")).toBe(0);
    expect(geminiDailyCap("mucho")).toBe(0);
  });
});

describe("readStats", () => {
  it("calcula el porcentaje leído sin IA y las fuentes que más usan Gemini", () => {
    const rows = [
      { parser: "bbva", source: "BBVA Colombia" },
      { parser: "bancolombia", source: "85540" },
      { parser: "ignore-rules", source: "Billetera de Google" },
      { parser: "gemini", source: "Caja Social <notificador@bancocajasocial.com>" },
      { parser: "gemini", source: "NOTIFICADOR@bancocajasocial.com" },
      { parser: "gemini", source: "Nequi Colombia" },
      { parser: null, source: "Algo raro" },
    ];
    const s = readStats(rows);
    expect(s.total).toBe(6);
    expect(s.withGemini).toBe(3);
    expect(s.pctWithoutAi).toBe(50);
    expect(s.geminiSources).toEqual([
      { source: "notificador@bancocajasocial.com", count: 2 },
      { source: "Nequi Colombia", count: 1 },
    ]);
  });

  it("sin avisos no inventa un porcentaje", () => {
    expect(readStats([]).pctWithoutAi).toBeNull();
    expect(readStats([{ parser: null, source: "x" }]).total).toBe(0);
  });

  it("nombra la fuente por su correo cuando lo trae", () => {
    expect(sourceLabel("BBVA <BBVA@bbvanet.com.co>")).toBe("bbva@bbvanet.com.co");
    expect(sourceLabel("  ")).toBe("Sin fuente");
    expect(sourceLabel(null)).toBe("Sin fuente");
  });
});
