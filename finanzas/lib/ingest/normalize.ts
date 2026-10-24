// Utilidades de texto para la ingesta: montos colombianos, comercios, últimos 4 dígitos,
// identificadores y enmascarado de datos sensibles antes de enviar algo a Gemini.

import type { IdentifierType, RawEvent } from "./types";

/** Quita tildes y pasa a minúsculas. */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Texto completo del evento (título, asunto y cuerpo) en una sola cadena. */
export function eventText(ev: RawEvent): string {
  return [ev.title, ev.subject, ev.text].filter(Boolean).join("\n").trim();
}

/**
 * Convierte un monto escrito a la colombiana o a la gringa en pesos enteros.
 * "1.250.000" → 1250000 · "45,000.00" → 45000 · "$20.000,50" → 20001 · "1.234" → 1234
 * Regla: si termina en separador + 2 dígitos son centavos (se redondea); los demás separadores son de miles.
 */
export function parseAmountCo(raw: string): number | null {
  const s = raw.replace(/[^\d.,]/g, "");
  if (!/\d/.test(s)) return null;
  const decimal = /[.,](\d{2})$/.exec(s);
  let intPart = s;
  let cents = 0;
  if (decimal) {
    intPart = s.slice(0, -3);
    cents = Number(decimal[1]);
  }
  const digits = intPart.replace(/[.,]/g, "");
  if (!digits) return null;
  const n = Number.parseInt(digits, 10) + (cents >= 50 ? 1 : 0);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Primer monto con signo pesos o "COP" en el texto. */
export function findAmount(text: string): number | null {
  const m = /(?:\$|cop\s?)\s?([\d][\d.,]*)/i.exec(text);
  return m ? parseAmountCo(m[1]) : null;
}

/** Últimos 4 dígitos de una tarjeta o cuenta: "*1234", "**1234", "terminada en 1234", "ending 1234". */
export function findLast4(text: string): string | null {
  const m =
    /\*+\s?(\d{4})\b/.exec(text) ??
    /(?:terminad[ao] en|finalizad[ao] en|ending in|ending)\s+(\d{4})\b/i.exec(text) ??
    /\bx{2,}(\d{4})\b/i.exec(text);
  return m ? m[1] : null;
}

// Prefijos de pasarelas de pago y ruido que no forman parte del nombre del comercio
const GATEWAY_PREFIXES = [
  /^payu\s*\*?\s*/i, /^mercado\s?pago\s*\*?\s*/i, /^mp\s*\*\s*/i, /^dlo\s*\*\s*/i, /^dlocal\s*\*?\s*/i,
  /^epayco\s*\*?\s*/i, /^wompi\s*\*?\s*/i, /^bold\s*\*\s*/i, /^sq\s*\*\s*/i, /^paypal\s*\*\s*/i,
  /^google\s*\*\s*/i, /^pse\s+/i, /^pos\s+/i, /^compra\s+(?:en|a)\s+/i, /^pago\s+(?:en|a)\s+/i,
];

/** Nombre limpio para mostrar: sin pasarelas, códigos ni ciudad/país al final. */
export function cleanMerchant(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i++) for (const re of GATEWAY_PREFIXES) s = s.replace(re, "");
  s = s
    .replace(/\b(?:bogota|medellin|cali|barranquilla|bucaramanga|cartagena)\b\s*(?:co|col)?\.?$/i, "")
    .replace(/\s+(?:co|col)$/i, "")
    .replace(/[#*]+/g, " ")
    .replace(/\s\d{4,}$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  // Mayúscula inicial en cada palabra si venía todo en mayúsculas
  if (s === s.toUpperCase()) s = s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  return s;
}

/** Versión para comparar comercios (memoria y deduplicación). */
export function normalizeMerchant(raw: string | null | undefined): string | null {
  const clean = cleanMerchant(raw);
  if (!clean) return null;
  const n = fold(clean).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return n || null;
}

/** Celulares, NIT y números de cuenta que sirven para la memoria de comercios. */
export function findIdentifiers(text: string): { type: IdentifierType; value: string }[] {
  const out: { type: IdentifierType; value: string }[] = [];
  const nit = /\bnit[:.\s]*([\d.]{6,15}(?:-\d)?)/i.exec(text);
  if (nit) out.push({ type: "NIT", value: nit[1].replace(/[.\s]/g, "") });
  const phone = /(?<!\d)(3\d{9})(?!\d)/.exec(text);
  if (phone) out.push({ type: "PHONE", value: phone[1] });
  return out;
}

/**
 * Datos que nunca salen hacia Gemini: secuencias largas de dígitos (cuentas, tarjetas, celulares,
 * documentos) se reducen a sus últimos 4. Los montos con separadores se conservan.
 */
export function maskSensitive(text: string): string {
  return text
    .replace(/\b(?:\d[ -]?){9,19}\b/g, (m) => `****${m.replace(/\D/g, "").slice(-4)}`)
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[correo]");
}

/** Mensajes que no son movimientos: códigos, claves, publicidad o transacciones no aprobadas. */
export function detectIgnore(text: string): string | null {
  const t = fold(text);
  if (/\b(codigo|clave|otp|token)\b.{0,40}\b(verificacion|seguridad|dinamica|transaccional|es|:)/.test(t) &&
      !/\$\s?\d/.test(t)) return "Código o clave";
  if (/\b(rechazad[ao]|declinad[ao]|no (?:fue )?aprobad[ao]|fallid[ao]|no exitos[ao])\b/.test(t)) return "Transacción no aprobada";
  if (/\b(aprovecha|promocion|descuento|cashback|oferta|gana|sorteo|felicitaciones)\b/.test(t) && !/\b(compra|pago|transferencia|retiro|recibiste|enviaste)\b/.test(t)) {
    return "Publicidad";
  }
  return null;
}

/** Entidad a partir de la app, remitente o texto. */
export function guessInstitution(ev: RawEvent): string | null {
  const t = fold(`${ev.source} ${ev.title ?? ""} ${ev.subject ?? ""}`);
  if (t.includes("nequi")) return "Nequi";
  if (t.includes("bancolombia")) return "Bancolombia";
  if (t.includes("bogota")) return "Banco de Bogotá";
  if (t.includes("wallet") || t.includes("walletnfcrel")) return "Google Wallet";
  if (t.includes("daviplata")) return "Daviplata";
  if (t.includes("davivienda")) return "Davivienda";
  return null;
}
