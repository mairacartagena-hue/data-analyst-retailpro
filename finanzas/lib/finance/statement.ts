// Extracto bancario en CSV: lectura, clasificación de líneas (4x1000, intereses, gastos bancarios)
// y conciliación contra los movimientos de la app. Todo corre en el navegador: el archivo no se sube a ningún lado.
//
// Convención de signos: el monto de cada línea es su EFECTO sobre el saldo de la cuenta
// (+ entra plata, − sale plata). En una tarjeta de crédito una compra sale (−): sube la deuda.

import type { Account, Transaction } from "@/lib/types";
import { fold, parseAmountCo } from "@/lib/ingest/normalize";
import { addDays } from "./periods";
import { effectOn, gmfEstimate, type GmfMode, type MonthRange } from "./reconcile";

// ───────────────────────── Lectura del CSV ─────────────────────────

export type LineKind = "GMF" | "INTEREST_IN" | "INTEREST_OUT" | "FEE" | "OTHER";

export interface StatementLine {
  /** Posición en el archivo (para identificar la línea en pantalla). */
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // efecto sobre el saldo: + entra, − sale
  balance: number | null;
  kind: LineKind;
}

/** Índices de columna (0 = primera). null = el extracto no la trae. */
export interface ColumnMap {
  date: number | null;
  description: number | null;
  amount: number | null; // un solo valor con signo
  debit: number | null; // columnas separadas de débitos y créditos
  credit: number | null;
  balance: number | null;
}

export interface ParseOptions {
  /** Columnas elegidas a mano (reemplazan a las detectadas). */
  map?: Partial<ColumnMap>;
  /** Invierte todos los signos (si el banco muestra las salidas como positivas). */
  flip?: boolean;
  /** Tarjetas: el extracto muestra las compras como positivas (lo más común). */
  purchasesPositive?: boolean;
  isCard?: boolean;
}

export interface ParsedStatement {
  lines: StatementLine[];
  map: ColumnMap;
  headers: string[];
  headerRow: number;
  dateOrder: "DMY" | "MDY";
  skipped: number; // filas que no eran movimientos (totales, encabezados repetidos, vacías)
  warnings: string[];
}

const BOM = /^﻿/;

function countOutsideQuotes(line: string, ch: string): number {
  let q = false;
  let n = 0;
  for (const c of line) {
    if (c === '"') q = !q;
    else if (c === ch && !q) n++;
  }
  return n;
}

export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 12);
  let best = ";";
  let bestScore = 0;
  for (const d of [";", "\t", ","]) {
    const counts = lines.map((l) => countOutsideQuotes(l, d)).filter((n) => n > 0).sort((a, b) => a - b);
    const score = counts.length ? counts[Math.floor(counts.length / 2)] * counts.length : 0;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** CSV con comillas, separador automático (; , o tabulación) y saltos de línea Windows o Unix. */
export function splitCsv(text: string): string[][] {
  const src = text.replace(BOM, "");
  const delim = detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell.trim()); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell.trim());
      cell = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

const MONTHS: Record<string, number> = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, set: 9, oct: 10, nov: 11, dic: 12 };

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return date.toISOString().slice(0, 10);
}

/** Fecha en formatos comunes de extractos. DMY (día/mes/año) por defecto, como en Colombia. */
export function parseDate(raw: string, order: "DMY" | "MDY" = "DMY"): string | null {
  const s = raw.trim();
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\D|$)/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/. ]([a-zA-Z]{3,5})\.?[-/. ](\d{2,4})/.exec(fold(s));
  if (m && MONTHS[m[2]]) return iso(+m[3], MONTHS[m[2]], +m[1]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:\D|$)/.exec(s);
  if (m) return order === "DMY" ? iso(+m[3], +m[2], +m[1]) : iso(+m[3], +m[1], +m[2]);
  return null;
}

function detectDateOrder(cells: string[]): "DMY" | "MDY" {
  let secondOver12 = false;
  for (const c of cells) {
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(c.trim());
    if (!m) continue;
    if (+m[1] > 12) return "DMY";
    if (+m[2] > 12) secondOver12 = true;
  }
  return secondOver12 ? "MDY" : "DMY";
}

/** Monto con signo: "-1.234,56", "(1.234)", "1,234.56-", "1.234 DB", "$ 50.000". Devuelve pesos enteros. */
export function parseSignedAmount(raw: string): number | null {
  const s = raw.trim();
  if (!s || !/\d/.test(s)) return null;
  const negative = /^\(.*\)$/.test(s) || /^[-−–]/.test(s) || /[-−–]\s*$/.test(s) || /\b(db|deb|d[eé]bito)\b/i.test(s);
  if (/^[^\d]*0+(?:[.,]0+)?[^\d]*$/.test(s)) return 0;
  const magnitude = parseAmountCo(s.replace(/[-−–()]/g, ""));
  if (magnitude === null) return null;
  return negative ? -magnitude : magnitude;
}

const ROLE_PATTERNS: Record<keyof ColumnMap, RegExp> = {
  date: /fecha|date/,
  description: /descripci|detalle|concepto|movimiento|referencia|transacci|observaci/,
  amount: /^(valor|monto|importe|amount|total)\b|^valor|^monto|^importe/,
  debit: /debito|cargo|retiro|egreso|salida|debit/,
  credit: /credito|abono|deposito|ingreso|entrada|credit/,
  balance: /saldo|balance/,
};

function findHeader(rows: string[][]): { row: number; map: ColumnMap } | null {
  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const cells = rows[r].map(fold);
    const idx = (role: keyof ColumnMap, skip: number[] = []) => {
      const i = cells.findIndex((c, k) => !skip.includes(k) && ROLE_PATTERNS[role].test(c));
      return i >= 0 ? i : null;
    };
    const date = idx("date");
    const balance = idx("balance");
    const used = [date, balance].filter((x): x is number => x !== null);
    const debit = idx("debit", used);
    const credit = idx("credit", used.concat(debit === null ? [] : [debit]));
    const amount = idx("amount", used.concat([debit, credit].filter((x): x is number => x !== null)));
    if (date === null || (amount === null && debit === null && credit === null)) continue;
    const taken = [date, balance, debit, credit, amount].filter((x): x is number => x !== null);
    const description = idx("description", taken) ?? cells.findIndex((_, k) => !taken.includes(k));
    return { row: r, map: { date, description: description >= 0 ? description : null, amount, debit, credit, balance } };
  }
  return null;
}

/** Sin encabezado: se deducen las columnas por su contenido. */
function inferMap(rows: string[][]): ColumnMap | null {
  const sample = rows.slice(0, 40);
  const width = Math.max(...sample.map((r) => r.length));
  const share = (col: number, test: (c: string) => boolean) => sample.filter((r) => r[col] !== undefined && r[col] !== "").filter((r) => test(r[col])).length / Math.max(1, sample.filter((r) => r[col]).length);
  const dateCol = Array.from({ length: width }, (_, i) => i).find((i) => share(i, (c) => parseDate(c) !== null) >= 0.7);
  if (dateCol === undefined) return null;
  const numeric = Array.from({ length: width }, (_, i) => i).filter((i) => i !== dateCol && share(i, (c) => parseSignedAmount(c) !== null) >= 0.7);
  if (numeric.length === 0) return null;
  const text = Array.from({ length: width }, (_, i) => i).filter((i) => i !== dateCol && !numeric.includes(i))
    .sort((a, b) => sample.reduce((n, r) => n + (r[b]?.length ?? 0), 0) - sample.reduce((n, r) => n + (r[a]?.length ?? 0), 0));
  const map: ColumnMap = { date: dateCol, description: text[0] ?? null, amount: null, debit: null, credit: null, balance: null };
  if (numeric.length === 1) map.amount = numeric[0];
  else if (numeric.length === 2) { map.amount = numeric[0]; map.balance = numeric[1]; }
  else { map.debit = numeric[0]; map.credit = numeric[1]; map.balance = numeric[2]; }
  return map;
}

/** Clasifica una línea por su descripción. Es una sugerencia: la persona decide al registrar. */
export function classifyLine(description: string, amount: number): LineKind {
  const f = fold(description);
  if (/4\s*x\s*1000|4\s*por\s*(?:mil|1000)|4\s*\*\s*1000|\bgmf\b|g\.m\.f|gravamen|impuesto(?:s)?\s+(?:al\s+)?gobierno|imp(?:to)?\.?\s+gobierno/.test(f)) return "GMF";
  if (/interes|rendimiento/.test(f) && !/retencion|retefuente|reteica/.test(f)) return amount > 0 ? "INTEREST_IN" : "INTEREST_OUT";
  if (/cuota\s+(?:de\s+)?(?:manejo|administracion)|comision|\biva\b|seguro\s+(?:de\s+)?(?:vida|deudor|deudores|tarjeta|proteccion|cuota)|retencion\s+en\s+la\s+fuente|retefuente|reteica|servicio\s+financiero|costo\s+(?:de\s+)?(?:transferencia|transaccion)|tarifa|cobro\s+(?:por|servicio)|cargo\s+por/.test(f)) return "FEE";
  return "OTHER";
}

export function parseStatement(text: string, opts: ParseOptions = {}): ParsedStatement {
  const rows = splitCsv(text);
  const warnings: string[] = [];
  const empty: ParsedStatement = { lines: [], map: { date: null, description: null, amount: null, debit: null, credit: null, balance: null }, headers: [], headerRow: -1, dateOrder: "DMY", skipped: 0, warnings };
  if (rows.length === 0) return { ...empty, warnings: ["El archivo está vacío."] };

  const header = findHeader(rows);
  const manual = opts.map && opts.map.date != null && (opts.map.amount != null || opts.map.debit != null || opts.map.credit != null);
  const blank: ColumnMap = { date: null, description: null, amount: null, debit: null, credit: null, balance: null };
  const base = header?.map ?? inferMap(rows) ?? (manual ? blank : null);
  if (!base) return { ...empty, warnings: ["No pude reconocer las columnas. Revisa que sea el extracto en CSV (con fecha y valor) o elige las columnas a mano."] };
  const map: ColumnMap = { ...base, ...opts.map };
  const headerRow = header?.row ?? -1;
  const width = Math.max(...rows.map((r) => r.length));
  const headers = Array.from({ length: width }, (_, i) => (header ? rows[header.row][i] : "") || `Columna ${i + 1}`);

  const body = rows.slice(headerRow + 1);
  const dateOrder = detectDateOrder(body.map((r) => (map.date === null ? "" : r[map.date] ?? "")));
  const lines: StatementLine[] = [];
  let skipped = 0;
  // Tarjetas: lo habitual es que las compras vayan positivas, así que se invierte para dejar "sale = −"
  const invert = (opts.flip ? -1 : 1) * (opts.isCard && opts.purchasesPositive !== false ? -1 : 1);

  body.forEach((r, i) => {
    const date = map.date === null ? null : parseDate(r[map.date] ?? "", dateOrder);
    if (!date) { skipped++; return; }
    let amount: number | null = null;
    if (map.debit !== null || map.credit !== null) {
      const d = map.debit === null ? null : parseSignedAmount(r[map.debit] ?? "");
      const c = map.credit === null ? null : parseSignedAmount(r[map.credit] ?? "");
      if (d === null && c === null) { skipped++; return; }
      amount = Math.abs(c ?? 0) - Math.abs(d ?? 0);
      if (opts.flip) amount = -amount;
    } else if (map.amount !== null) {
      const v = parseSignedAmount(r[map.amount] ?? "");
      if (v === null) { skipped++; return; }
      amount = v * invert;
    }
    if (amount === null || amount === 0) { skipped++; return; }
    const description = (map.description === null ? "" : r[map.description] ?? "").replace(/\s+/g, " ").trim();
    const balance = map.balance === null ? null : parseSignedAmount(r[map.balance] ?? "");
    lines.push({ id: `L${headerRow + 2 + i}`, date, description, amount, balance, kind: classifyLine(description, amount) });
  });

  if (lines.length === 0) warnings.push("No encontré movimientos con fecha y valor. Revisa las columnas.");
  return { lines, map, headers, headerRow, dateOrder, skipped, warnings };
}

/** Saldo final del extracto, si trae columna de saldo: el de la línea más reciente. */
export function closingBalance(lines: StatementLine[]): number | null {
  const withBalance = lines.filter((l) => l.balance !== null);
  if (withBalance.length < Math.max(2, lines.length * 0.8)) return null;
  const first = withBalance[0];
  const last = withBalance[withBalance.length - 1];
  return first.date > last.date ? first.balance : last.balance;
}

// ───────────────────────── Conciliación ─────────────────────────

export interface AppEntry {
  tx: Transaction;
  amount: number; // efecto sobre esta cuenta (+/−)
  date: string;
}

export interface StatementReconciliation {
  matched: { line: StatementLine; entry: AppEntry }[];
  /** En el extracto y no en la app. */
  missing: StatementLine[];
  /** En la app y no en el extracto (del mes). */
  extra: AppEntry[];
  /** De las anteriores, las que parecen una copia de otra que sí aparece en el extracto. */
  duplicates: { entry: AppEntry; twin: AppEntry }[];
  /** Líneas del extracto fuera del mes que se cierra (no se comparan). */
  outOfRange: number;
}

const dayDiff = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/**
 * Cruza línea por línea el extracto con la app: mismo monto (con signo) y fecha dentro de `tolerance` días
 * (el banco suele registrar un par de días después). Primero se emparejan las de la misma fecha,
 * luego 1 día de diferencia, etc., para que una línea no le robe su pareja a otra.
 */
export function reconcileStatement(account: Account, txs: Transaction[], lines: StatementLine[], range: MonthRange, tolerance = 3): StatementReconciliation {
  const inRange = lines.filter((l) => l.date >= range.start && l.date <= range.end);
  const lo = addDays(range.start, -tolerance);
  const hi = addDays(range.end, tolerance);
  const entries: AppEntry[] = [];
  for (const tx of txs) {
    const amount = effectOn(account.id, tx);
    if (amount !== 0 && tx.occurred_on >= lo && tx.occurred_on <= hi) entries.push({ tx, amount, date: tx.occurred_on });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date) || (a.tx.status === "CONFIRMED" ? -1 : 1));

  const lineTaken = new Map<string, AppEntry>();
  const entryTaken = new Set<AppEntry>();
  for (let d = 0; d <= tolerance; d++) {
    for (const line of inRange) {
      if (lineTaken.has(line.id)) continue;
      const hit = entries.find((e) => !entryTaken.has(e) && e.amount === line.amount && dayDiff(e.date, line.date) === d);
      if (hit) {
        lineTaken.set(line.id, hit);
        entryTaken.add(hit);
      }
    }
  }

  const matched = inRange.filter((l) => lineTaken.has(l.id)).map((line) => ({ line, entry: lineTaken.get(line.id)! }));
  const missing = inRange.filter((l) => !lineTaken.has(l.id));
  const extra = entries.filter((e) => !entryTaken.has(e) && e.date >= range.start && e.date <= range.end);
  const duplicates: StatementReconciliation["duplicates"] = [];
  for (const entry of extra) {
    const twin = matched.map((m) => m.entry).find((m) => m.amount === entry.amount && dayDiff(m.date, entry.date) <= tolerance);
    if (twin) duplicates.push({ entry, twin });
  }
  return { matched, missing, extra, duplicates, outOfRange: lines.length - inRange.length };
}

// ───────────────────── 4x1000, intereses y gastos bancarios ─────────────────────

export interface BankCharges {
  gmf: {
    charged: number; // lo que cobró el banco según el extracto
    expected: number; // estimado de la app
    diff: number; // cobrado − esperado
    ok: boolean;
    lines: StatementLine[];
    applies: boolean; // las tarjetas de crédito no pagan 4x1000
  };
  interestIn: { total: number; lines: StatementLine[] };
  interestOut: { total: number; lines: StatementLine[] };
  fees: { total: number; lines: StatementLine[] };
}

export function bankCharges(account: Account, lines: StatementLine[], uvt: number): BankCharges {
  const sum = (ls: StatementLine[]) => ls.reduce((a, l) => a + Math.abs(l.amount), 0);
  const of = (k: LineKind) => lines.filter((l) => l.kind === k);
  const gmfLines = of("GMF").filter((l) => l.amount < 0);
  const applies = account.kind !== "CREDIT_CARD" && account.kind !== "CASH";
  // Base: todo lo que sale de la cuenta menos el propio 4x1000
  const base = lines.filter((l) => l.amount < 0 && l.kind !== "GMF").reduce((a, l) => a - l.amount, 0);
  const mode = (account.gmf_mode ?? "TAXED") as GmfMode;
  const expected = applies ? gmfEstimate(base, mode, uvt) : 0;
  const charged = sum(gmfLines);
  const diff = charged - expected;
  // El banco redondea cada cobro y el tope exento se comparte entre cuentas: se tolera 3 % o $2.000
  const ok = Math.abs(diff) <= Math.max(2000, expected * 0.03);
  return {
    gmf: { charged, expected, diff, ok, lines: gmfLines, applies },
    interestIn: { total: sum(of("INTEREST_IN")), lines: of("INTEREST_IN") },
    interestOut: { total: sum(of("INTEREST_OUT")), lines: of("INTEREST_OUT") },
    fees: { total: sum(of("FEE")), lines: of("FEE") },
  };
}

// ───────────────────── Registrar lo que falta ─────────────────────

export const BANK_CATEGORY = { name: "Gastos bancarios", icon: "🏦" } as const;
export const UNKNOWN_CATEGORY = { name: "No identificado", icon: "❓" } as const;
export const INTEREST_CATEGORY = { name: "Intereses", icon: "💰" } as const;

/** Líneas que la app puede registrar sola (no hace falta que la persona las categorice). */
export const isBankLine = (l: StatementLine) => l.kind !== "OTHER";

export interface RegisterContext {
  accountId: string;
  userId: string;
  bankCategoryId: string;
  unknownCategoryId: string;
  interestCategoryId: string;
}

/** Parámetros de save_transaction() para registrar una línea del extracto. */
export function registerPayload(line: StatementLine, ctx: RegisterContext) {
  const amount = Math.abs(line.amount);
  const description = line.description || (line.amount > 0 ? "Entrada según extracto" : "Salida según extracto");
  if (line.amount > 0) {
    return {
      kind: "INCOME", amount, occurred_on: line.date, description, account_id: ctx.accountId,
      tags: [line.kind === "INTEREST_IN" ? "#banco" : "#conciliacion"],
      income_category_id: line.kind === "INTEREST_IN" ? ctx.interestCategoryId : null,
    };
  }
  const tag = line.kind === "GMF" ? "#gmf" : line.kind === "OTHER" ? "#conciliacion" : "#banco";
  const categoryId = line.kind === "OTHER" ? ctx.unknownCategoryId : ctx.bankCategoryId;
  return {
    kind: "EXPENSE", amount, occurred_on: line.date, description, account_id: ctx.accountId, tags: [tag],
    splits: [{ amount, category_id: categoryId, responsible_user_id: ctx.userId }],
  };
}
