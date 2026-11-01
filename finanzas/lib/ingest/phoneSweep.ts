// Primer barrido del celular: convierte una copia de los SMS (app "SMS Backup & Restore", archivo .xml)
// o avisos pegados a mano en eventos para la ingesta. Todo corre en el navegador; solo se envía lo bancario.

import { findAmount } from "./normalize";
import type { Channel } from "./types";

export interface PhoneItem {
  channel: Extract<Channel, "ANDROID_SMS" | "ANDROID_NOTIFICATION">;
  source: string;
  text: string;
  receivedAt: string; // ISO
  externalId: string;
}

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (let m = re.exec(tag); m; m = re.exec(tag)) out[m[1]] = decodeXml(m[2] ?? m[3] ?? "");
  return out;
}

const BANK_WORDS = /compra|pago|pagaste|transfer|retiro|recib|abono|consign|debit|cr[eé]dito|tarjeta|cuenta|nequi|bancolombia|davivienda|bbva|lulo|rappi|daviplata/i;

/**
 * ¿Parece un SMS del banco? Los bancos escriben desde números cortos (85540, 891333…) o con nombre;
 * los números de personas (celulares de 10 dígitos) se descartan para no mandar conversaciones.
 */
export function looksLikeBankSms(sender: string, text: string): boolean {
  const digits = sender.replace(/\D/g, "");
  const personal = !/[a-z]/i.test(sender) && digits.length >= 10;
  if (personal) return false;
  return findAmount(text) != null || (BANK_WORDS.test(text) && /\d/.test(text));
}

/** SMS recibidos desde `fromDate` (AAAA-MM-DD, hora de Bogotá) en la copia .xml de "SMS Backup & Restore". */
export function parseSmsBackup(xml: string, fromDate: string): { items: PhoneItem[]; total: number } {
  const fromMs = Date.parse(`${fromDate}T05:00:00Z`); // medianoche en Bogotá
  const items: PhoneItem[] = [];
  let total = 0;
  for (const m of xml.matchAll(/<sms\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if (a.type && a.type !== "1") continue; // solo recibidos
    const ms = Number(a.date);
    if (!Number.isFinite(ms) || ms < fromMs) continue;
    total++;
    const sender = a.address ?? "";
    const text = (a.body ?? "").trim();
    if (!text || !looksLikeBankSms(sender, text)) continue;
    items.push({ channel: "ANDROID_SMS", source: sender, text, receivedAt: new Date(ms).toISOString(), externalId: `sms:${sender}:${ms}` });
  }
  items.sort((x, y) => x.receivedAt.localeCompare(y.receivedAt));
  return { items, total };
}

/** Huella corta del texto para que pegar lo mismo dos veces no lo duplique. */
export function textHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Avisos pegados a mano: uno por bloque (separados por una línea en blanco), todos con la fecha `day`.
 * `source` es la app o el banco (ej. "Nequi"): con eso se usan las reglas de ese banco antes que Gemini.
 */
export function parsePasted(raw: string, day: string, channel: PhoneItem["channel"], source = ""): PhoneItem[] {
  const receivedAt = `${day}T17:00:00.000Z`; // mediodía en Bogotá: el parser usa la hora del aviso si la trae
  const seen = new Set<string>();
  return raw
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
    .flatMap((text) => {
      const id = `pegado:${day}:${textHash(`${source.trim().toLowerCase()}|${text.replace(/\s+/g, " ").toLowerCase()}`)}`;
      if (seen.has(id)) return [];
      seen.add(id);
      return [{ channel, source: source.trim(), text, receivedAt, externalId: id }];
    });
}
