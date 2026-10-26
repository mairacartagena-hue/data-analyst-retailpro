// Lectura de una frase dictada o escrita ("gasté 45 mil en el Éxito con Nequi") sin internet.
// Gemini la lee mejor cuando hay conexión; esto es el respaldo y también llena lo que Gemini no devuelva.

import { addDays } from "@/lib/finance/periods";

export type CaptureKind = "EXPENSE" | "INCOME" | "TRANSFER";

export interface CaptureOption {
  id: string;
  name: string;
}

export interface CaptureResult {
  kind?: CaptureKind;
  amount?: number;
  description?: string;
  date?: string;
  categoryId?: string;
  accountId?: string;
  toAccountId?: string;
  /** Compras con tarjeta: "a 12 cuotas". */
  installments?: number;
}

export function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const WORD_NUMBERS: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, quince: 15, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70,
  ochenta: 80, noventa: 90, cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400,
  quinientos: 500, seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900, medio: 0.5,
};

/** "45.000" · "45 mil" · "1,2 millones" · "1 millón 200 mil" · "20 lucas" · "45k" → pesos. Devuelve el monto y el texto que lo formaba. */
export function findSpokenAmount(text: string): { amount: number; match: string } | null {
  const t = fold(text);
  const num = String.raw`(?:\d+(?:[.,]\d+)*|${Object.keys(WORD_NUMBERS).join("|")})`;
  const re = new RegExp(
    String.raw`\$?\s*(${num})(?:\s*(millones|millon|palos?)\b(?:\s*(?:con\s+)?(${num})\s*(mil|lucas?|k)?)?|\s*(mil|lucas?|k)\b)?`,
    "g",
  );
  let best: { amount: number; match: string } | null = null;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    if (!m[0].trim()) {
      re.lastIndex++;
      continue;
    }
    const base = toNumber(m[1], !!(m[2] || m[5]));
    if (base == null) continue;
    let amount: number;
    if (m[2]) {
      amount = base * 1_000_000;
      if (m[3]) {
        const rest = toNumber(m[3], !!m[4]);
        if (rest != null) amount += m[4] ? rest * 1000 : rest;
      }
    } else if (m[5]) {
      amount = base * 1000;
    } else {
      // Un número suelto: solo si parece un monto (ej. "45000", "45.000"), no un día o una cantidad
      if (WORD_NUMBERS[m[1]] != null || base < 1000) continue;
      amount = base;
    }
    amount = Math.round(amount);
    if (amount > 0 && (!best || amount > best.amount)) best = { amount, match: m[0].trim() };
  }
  return best;
}

function toNumber(raw: string, hasMultiplier: boolean): number | null {
  if (WORD_NUMBERS[raw] != null) return WORD_NUMBERS[raw];
  // Con "mil" o "millones" la coma o el punto pueden ser decimales ("1,5 millones"); si no, separan miles
  if (hasMultiplier && /^\d+[.,]\d{1,2}$/.test(raw)) return Number(raw.replace(",", "."));
  const n = Number(raw.replace(/[.,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

const INCOME_WORDS = /\b(recibi|me (pagaron|consignaron|transfirieron|enviaron|llego|llegaron|devolvieron)|ingreso|salario|sueldo|nomina|quincena|cobre|vendi)\b/;
const TRANSFER_WORDS = /\b(pase|transferi|movi|pague la tarjeta|abone a la tarjeta)\b/;

/** Nombre de cuenta o categoría que aparece en la frase (el más largo gana). */
function findOption(text: string, options: CaptureOption[]): CaptureOption | null {
  let best: CaptureOption | null = null;
  let bestLen = 0;
  for (const o of options) {
    const name = fold(o.name).trim();
    if (name.length < 3) continue;
    const words = name.split(/\s+/).filter((w) => w.length >= 4);
    const hit = new RegExp(String.raw`\b${escape(name)}\b`).test(text) ? name.length
      : words.some((w) => new RegExp(String.raw`\b${escape(w)}`).test(text)) ? Math.max(...words.map((w) => w.length)) - 1 : 0;
    if (hit > bestLen) {
      best = o;
      bestLen = hit;
    }
  }
  return best;
}

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Interpreta la frase. `today` es la fecha de hoy en Bogotá (AAAA-MM-DD). */
export function parsePhrase(
  phrase: string,
  ctx: { today: string; accounts: CaptureOption[]; categories: CaptureOption[]; incomeCategories?: CaptureOption[] },
): CaptureResult {
  const t = fold(phrase).replace(/\s+/g, " ").trim();
  if (!t) return {};
  const out: CaptureResult = {};

  const amount = findSpokenAmount(t);
  if (amount) out.amount = amount.amount;
  const cuotas = /\b(?:a|en)?\s*(\d{1,2})\s*cuotas?\b/.exec(t);
  if (cuotas && Number(cuotas[1]) >= 1 && Number(cuotas[1]) <= 48) out.installments = Number(cuotas[1]);

  if (INCOME_WORDS.test(t)) out.kind = "INCOME";
  else if (TRANSFER_WORDS.test(t)) out.kind = "TRANSFER";
  else out.kind = "EXPENSE";

  if (/\b(anteayer|antier|antes de ayer)\b/.test(t)) out.date = addDays(ctx.today, -2);
  else if (/\bayer\b/.test(t)) out.date = addDays(ctx.today, -1);
  else out.date = ctx.today;

  // Cuenta: "con Nequi", "desde Bancolombia", "en efectivo"; en una transferencia la segunda es el destino
  let rest = t;
  const acc = findOption(t, ctx.accounts);
  if (acc) {
    out.accountId = acc.id;
    if (out.kind === "TRANSFER") {
      const others = ctx.accounts.filter((a) => a.id !== acc.id);
      const dest = findOption(t.replace(new RegExp(escape(fold(acc.name)), "g"), " "), others);
      if (dest) {
        // El que aparece después de "a" o "para" es el destino
        const i = t.indexOf(fold(acc.name));
        const j = t.indexOf(fold(dest.name));
        if (j >= 0 && i > j) {
          out.accountId = dest.id;
          out.toAccountId = acc.id;
        } else out.toAccountId = dest.id;
      }
    }
  }
  const cat = findOption(t, out.kind === "INCOME" ? ctx.incomeCategories ?? [] : ctx.categories);
  if (cat && out.kind !== "TRANSFER") out.categoryId = cat.id;

  // Descripción: lo que queda sin el monto, la fecha, la cuenta ni los verbos
  if (amount) rest = rest.replace(amount.match, " ");
  const used = ctx.accounts.filter((a) => a.id === out.accountId || a.id === out.toAccountId);
  for (const a of ctx.accounts) {
    // Nombre completo de cualquier cuenta; de las elegidas, también sus palabras sueltas ("con bancolombia")
    const names = [fold(a.name), ...(used.includes(a) ? fold(a.name).split(/\s+/).filter((w) => w.length >= 4) : [])];
    for (const n of names) {
      rest = rest.replace(new RegExp(String.raw`\b(con|desde|de|en|a|por|para)?\s*(la|el|mi)?\s*(cuenta|tarjeta)?\s*(de)?\s*${escape(n)}\b`, "g"), " ");
    }
  }
  rest = tidy(rest.replace(/[,;:!?¡¿"]+|\.(?=\s|$)/g, " "));
  if (cat) {
    // La categoría ya quedó elegida: no se repite en la descripción, salvo que sea lo único que se dijo
    const catName = fold(ctx.categories.concat(ctx.incomeCategories ?? []).find((c) => c.id === cat.id)!.name);
    const without = tidy(rest.replace(new RegExp(String.raw`\b(de|en|para)?\s*${escape(catName)}\b`, "g"), " "));
    if (without.length >= 2) rest = without;
  }
  if (rest.length >= 2) out.description = restoreCase(phrase, rest);
  return out;
}

function tidy(text: string): string {
  return text
    .replace(/\b(?:a|en)?\s*\d{1,2}\s*cuotas?\b/g, " ")
    .replace(/\b(hoy|ayer|anteayer|antier|antes de ayer)\b/g, " ")
    .replace(/\b(me gaste|gaste|pague|compre|recibi|me pagaron|me consignaron|me llego|me llegaron|me devolvieron|pase|transferi|movi|cobre|vendi|registra|registrar|anota|anotar|pesos|plata)\b/g, " ")
    .replace(/\b(con|en efectivo|efectivo)\b\s*$/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(en|de|por|para|del|al|a)\s+/, "")
    .replace(/^(el|la|los|las|un|una|unos|unas)\s+/, "")
    .replace(/\s+(en|de|por|para|con|y|a)$/, "")
    .trim();
}

/** Recupera mayúsculas y tildes del texto original, palabra por palabra. */
function restoreCase(original: string, foldedPart: string): string {
  const words = new Map<string, string>();
  for (const w of original.split(/[\s,;:!?¡¿"]+/)) if (w) words.set(fold(w).replace(/\.$/, ""), w.replace(/\.$/, ""));
  const text = foldedPart.split(" ").map((w) => words.get(w) ?? w).join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
