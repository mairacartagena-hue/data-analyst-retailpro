// Utilidades de texto para la ingesta: montos colombianos, comercios, últimos 4 dígitos,
// identificadores y enmascarado de datos sensibles antes de enviar algo a Gemini.

import type { IdentifierType, RawEvent } from "./types";

/** Quita tildes y pasa a minúsculas. */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Quita las variables de MacroDroid que llegaron sin reemplazar (ej. "[app_name]", "{not_title}"):
 * pasa cuando se escriben a mano en vez de insertarlas con el texto mágico.
 */
export function dropUnfilled(value: string): string {
  return value
    .split("\n")
    .filter((line) => !/^\s*[[{][a-z_]+[\]}]\s*$/i.test(line))
    .join("\n")
    .trim();
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

// Prefijos de pasarelas de pago y ruido que no forman parte del nombre del comercio.
// Las pasarelas solo se quitan cuando van como prefijo con "*" (ej. "PAYU*RAPPI"); "Wompi SAS" se deja como Wompi.
const GATEWAY_PREFIXES = [
  /^payu\s*\*\s*/i, /^mercado\s?pago\s*\*\s*/i, /^mp\s*\*\s*/i, /^dlo\s*\*\s*/i, /^dlocal\s*\*\s*/i,
  /^epayco\s*\*\s*/i, /^wompi\s*\*\s*/i, /^bold\s*\*\s*/i, /^sq\s*\*\s*/i, /^paypal\s*\*\s*/i,
  /^google\s*\*\s*/i, /^pse\s+/i, /^pos\s+/i, /^compra\s+(?:en|a)\s+/i, /^pago\s+(?:en|a)\s+/i,
];

/** Nombre limpio para mostrar: sin pasarelas, códigos ni ciudad/país al final. */
/** Largo máximo del nombre de un comercio (la base de datos también lo recorta). */
export const MAX_MERCHANT = 60;

export function cleanMerchant(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const original = raw.replace(/\s+/g, " ").trim();
  let s = original;
  for (let i = 0; i < 3; i++) for (const re of GATEWAY_PREFIXES) s = s.replace(re, "");
  s = s
    // Ciudad + país al final, como en los datáfonos: "TIENDA XYZ BOGOTA CO"
    .replace(/\s+(?:bogota|medellin|cali|barranquilla|bucaramanga|cartagena)\s+(?:co|col)\.?$/i, "")
    .replace(/\s+(?:co|col)$/i, "")
    .replace(/\s+s\.?\s?a\.?(?:\s?s\.?)?$/i, "")
    .replace(/[#*]+/g, " ")
    .replace(/\s\d{6,}$/, "")
    .replace(/\s+/g, " ")
    .trim();
  // Si solo quedaba la razón social ("S.A.S"), se usa el texto original sin símbolos
  if (!s || /^(?:s\.?\s?a\.?(?:\s?s\.?)?|ltda\.?)$/i.test(s)) s = original.replace(/[#*]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  // Mayúscula inicial en cada palabra si venía todo en mayúsculas
  if (s === s.toUpperCase()) s = s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  // Un nombre de comercio nunca es tan largo: si el lector de respaldo copia parte del correo, se corta
  if (s.length > MAX_MERCHANT) s = s.slice(0, MAX_MERCHANT).replace(/\s+\S*$/, "").trim() || s.slice(0, MAX_MERCHANT);
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
  // Avisos de seguridad por inicio de sesión (app, banca virtual, canales digitales): no son movimientos
  if (/\b(inicio de sesion|iniciaste (?:otra |una )?sesion|nueva sesion|sesion iniciada|acabas de ingresar|has ingresado|ingresaste (?:a|en)|confirmacion de ingreso|ingreso (?:a|en) (?:tu |la |nuestros |nuestra )?(?:app|aplicacion|banca|canales|portal|sucursal)|ingreso app)\b/.test(t) &&
      !/\$\s?\d/.test(t)) return "Aviso de inicio de sesión";
  if (/\b(olvido de (?:la )?(?:contrasena|clave)|(?:cambio|cambiaste|recuperacion|restablec\w*) (?:de )?(?:tu |la )?(?:contrasena|clave))\b/.test(t) &&
      !/\$\s?\d/.test(t)) return "Aviso de seguridad";
  if (/\b(rechazad[ao]|declinad[ao]|no (?:fue )?aprobad[ao]|fallid[ao]|no exitos[ao])\b/.test(t)) return "Transacción no aprobada";
  // Promociones que piden comprar y ofrecen premios ("Haz 5 compras… aplican TyC"): no son movimientos.
  // Un aviso real va en pasado ("compraste", "pagaste"), así que esa palabra lo deja pasar.
  if (/\b(haz \d+\s+(?:compras|pagos|transacciones)|manten tu racha|racha|participa por|aplican (?:tyc|t&c|terminos)|valido hasta|que no se corte)\b/.test(t) &&
      !/\b(compraste|pagaste|transferiste|recibiste|enviaste|retiraste)\b/.test(t)) return "Publicidad";
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
  if (t.includes("wallet") || t.includes("billetera de google")) return "Google Wallet";
  if (t.includes("bbva")) return "BBVA";
  if (t.includes("caja social")) return "Banco Caja Social";
  if (t.includes("lulo")) return "Lulo Bank";
  if (t.includes("daviplata")) return "Daviplata";
  if (t.includes("davivienda")) return "Davivienda";
  return null;
}

/** Arma una fecha ISO en hora de Colombia (UTC-5). Devuelve null si no es válida. */
export function bogotaIso(y: number, m: number, d: number, h = 0, mi = 0, sec = 0): string | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const date = new Date(Date.UTC(y, m - 1, d, h + 5, mi, sec));
  const local = new Date(date.getTime() - 5 * 3_600_000);
  if (local.getUTCFullYear() !== y || local.getUTCMonth() !== m - 1 || local.getUTCDate() !== d) return null;
  return date.toISOString();
}

/**
 * Fechas de los bancos: "22/10/2026 a las 14:10", "23/10/2026 10:42:10", "23/10/26 a las 18:19",
 * "el 10:07 a las 23/10/2026" (hora antes de la fecha), "2026-10-23 a las 12:51" y, con order MDY, "06/25/2026 12:21".
 */
export function findDate(text: string, order: "DMY" | "MDY" = "DMY"): string | null {
  let m = /(\d{4})-(\d{2})-(\d{2})(?:\s+a las\s+|\s+|T)(\d{1,2}):(\d{2})/i.exec(text);
  if (m) return bogotaIso(+m[1], +m[2], +m[3], +m[4], +m[5]);
  m = /(\d{1,2}):(\d{2})\s+a las\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i.exec(text);
  if (m) return order === "DMY" ? bogotaIso(+m[5], +m[4], +m[3], +m[1], +m[2]) : bogotaIso(+m[5], +m[3], +m[4], +m[1], +m[2]);
  m = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+a las)?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/i.exec(text);
  if (m) {
    const [a, b] = order === "DMY" ? [+m[1], +m[2]] : [+m[2], +m[1]];
    return bogotaIso(+m[3], b, a, +m[4], +m[5], m[6] ? +m[6] : 0);
  }
  return null;
}

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * Fechas con el mes escrito, como en Lulo y RappiCard: "22 de octubre de 2026 … Hora 5:41 p.m.",
 * "31 oct. 2026 Hora 8:19 a.m." y "31 oct 2026 03:17". La hora (con a.m./p.m. o de 24 h) debe ir justo después.
 */
export function findDateEs(text: string): string | null {
  const t = fold(text);
  // Se prueban todas las coincidencias: "…4233 CUS 7871…" también parece fecha, pero "cus" no es un mes
  let m: RegExpExecArray | null = null;
  let month = 0;
  for (const c of t.matchAll(/(\d{1,2})\s+(?:de\s+)?([a-z]{3,10})\.?\s+(?:de\s+)?(\d{4})/g)) {
    month = MONTHS_ES.indexOf(c[2].slice(0, 3)) + 1;
    if (month > 0) { m = c; break; }
  }
  if (!m) return null;
  const time = /(\d{1,2}):(\d{2})(?:\s*([ap])\.?\s?m\b)?/.exec(t.slice(m.index + m[0].length, m.index + m[0].length + 40));
  let h = time ? +time[1] : 0;
  if (time?.[3] === "p" && h < 12) h += 12;
  if (time?.[3] === "a" && h === 12) h = 0;
  return bogotaIso(+m[3], month, +m[1], h, time ? +time[2] : 0);
}
