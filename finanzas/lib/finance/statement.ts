// Extracto bancario en CSV: lectura, clasificación de líneas (4x1000, intereses, gastos bancarios)
// y conciliación contra los movimientos de la app. Todo corre en el navegador: el archivo no se sube a ningún lado.
//
// Convención de signos: el monto de cada línea es su EFECTO sobre el saldo de la cuenta
// (+ entra plata, − sale plata). En una tarjeta de crédito una compra sale (−): sube la deuda.

import type { Account, ReconcilingItem, Transaction } from "@/lib/types";
import { fold } from "@/lib/ingest/normalize";
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
  /** Valor con centavos (los intereses diarios son de centavos y se suman por mes). */
  exact?: number;
  /** Cuántos movimientos del extracto resume esta línea (intereses y 4x1000 se agrupan por mes). */
  count?: number;
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
  /** Año para fechas escritas solo como día/mes ("1/07"); si el archivo trae el periodo (DESDE/HASTA) se usa ese. */
  yearHint?: number;
}

export interface ParsedStatement {
  lines: StatementLine[];
  map: ColumnMap;
  headers: string[];
  headerRow: number;
  dateOrder: "DMY" | "MDY";
  skipped: number; // filas que no eran movimientos (totales, encabezados repetidos, vacías)
  warnings: string[];
  /** Periodo que declara el archivo (DESDE / HASTA), si lo trae. */
  period: { start: string; end: string } | null;
  /** Las líneas sin agrupar y en el orden del archivo (para el saldo final). */
  raw: StatementLine[];
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

/**
 * Monto con signo y centavos: "-1.234,56", "(1.234)", "1,234.56-", "1.234 DB", "$ 50.000", ".49".
 * Un separador seguido de 1 o 2 dígitos al final son centavos; los demás separadores son de miles.
 */
export function parseExactAmount(raw: string): number | null {
  const s = raw.trim();
  if (!s || !/\d/.test(s)) return null;
  const negative = /^\(.*\)$/.test(s) || /^[-−–]/.test(s) || /[-−–]\s*$/.test(s) || /\b(db|deb|d[eé]bito)\b/i.test(s);
  const num = s.replace(/[^\d.,]/g, "");
  const cents = /[.,](\d{1,2})$/.exec(num);
  const intDigits = (cents ? num.slice(0, -cents[0].length) : num).replace(/[.,]/g, "");
  if (!intDigits && !cents) return null;
  const magnitude = Number(intDigits || "0") + (cents ? Number(cents[1].padEnd(2, "0")) / 100 : 0);
  if (!Number.isFinite(magnitude)) return null;
  return negative && magnitude !== 0 ? -magnitude : magnitude;
}

/** Monto con signo en pesos enteros (los centavos se redondean). */
export function parseSignedAmount(raw: string): number | null {
  const v = parseExactAmount(raw);
  if (v === null) return null;
  const r = Math.round(Math.abs(v));
  return v < 0 && r !== 0 ? -r : r;
}

/** Periodo que declara el extracto: las fechas completas (AAAA/MM/DD) que aparecen antes de los movimientos. */
function declaredPeriod(rows: string[][]): { start: string; end: string } | null {
  const found: string[] = [];
  for (const r of rows.slice(0, 80)) {
    for (const c of r) {
      const m = /^(\d{4})[-/.](\d{2})[-/.](\d{2})$/.exec(c.trim());
      if (m) {
        const d = iso(+m[1], +m[2], +m[3]);
        if (d) found.push(d);
      }
    }
  }
  if (found.length < 2) return null;
  found.sort();
  return { start: found[0], end: found[found.length - 1] };
}

/** Fecha escrita solo como día/mes ("1/07"): el año sale del periodo del extracto o del año indicado. */
function parseDayMonth(raw: string, period: { start: string; end: string } | null, yearHint?: number): string | null {
  const m = /^(\d{1,2})[-/.](\d{1,2})$/.exec(raw.trim());
  if (!m) return null;
  const years = period ? [...new Set([+period.start.slice(0, 4), +period.end.slice(0, 4)])] : yearHint ? [yearHint] : [];
  let fallback: string | null = null;
  for (const y of years) {
    const d = iso(y, +m[2], +m[1]);
    if (!d) continue;
    fallback = d;
    if (!period || (d >= period.start && d <= period.end)) return d;
  }
  return fallback;
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
  return parseStatementRows(splitCsv(text), opts);
}

/** Intereses y 4x1000 vienen en muchas líneas pequeñas (a veces una por día): se resumen en una por mes. */
const GROUPED: LineKind[] = ["GMF", "INTEREST_IN", "INTEREST_OUT"];

export function groupMonthly(lines: StatementLine[]): StatementLine[] {
  const groups = new Map<string, StatementLine[]>();
  const rest: StatementLine[] = [];
  for (const l of lines) {
    if (!GROUPED.includes(l.kind)) { rest.push(l); continue; }
    const key = `${l.kind}|${l.date.slice(0, 7)}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  for (const [key, ls] of groups) {
    const total = ls.reduce((a, l) => a + (l.exact ?? l.amount), 0);
    const amount = Math.round(total);
    if (amount === 0) continue;
    const first = ls[0];
    const date = ls.reduce((d, l) => (l.date > d ? l.date : d), first.date);
    rest.push({
      id: `G:${key}`, date, amount, exact: total, balance: null, kind: first.kind, count: ls.length,
      description: ls.length > 1 ? `${first.description} (${ls.length} movimientos del mes)` : first.description,
    });
  }
  return rest.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id, "en", { numeric: true }));
}

export function parseStatementRows(rows: string[][], opts: ParseOptions = {}): ParsedStatement {
  const warnings: string[] = [];
  const period = declaredPeriod(rows);
  const empty: ParsedStatement = { lines: [], map: { date: null, description: null, amount: null, debit: null, credit: null, balance: null }, headers: [], headerRow: -1, dateOrder: "DMY", skipped: 0, warnings, period, raw: [] };
  if (rows.length === 0) return { ...empty, warnings: ["El archivo está vacío."] };

  const header = findHeader(rows);
  const manual = opts.map && opts.map.date != null && (opts.map.amount != null || opts.map.debit != null || opts.map.credit != null);
  const blank: ColumnMap = { date: null, description: null, amount: null, debit: null, credit: null, balance: null };
  const base = header?.map ?? inferMap(rows) ?? (manual ? blank : null);
  if (!base) return { ...empty, warnings: ["No pude reconocer las columnas. Revisa que sea el extracto (con fecha y valor) o elige las columnas a mano."] };
  const map: ColumnMap = { ...base, ...opts.map };
  const headerRow = header?.row ?? -1;
  const width = Math.max(...rows.map((r) => r.length));
  const headers = Array.from({ length: width }, (_, i) => (header ? rows[header.row][i] : "") || `Columna ${i + 1}`);

  // Algunos bancos repiten el encabezado en cada página: se toma todo lo que viene después del primero
  const body = rows.slice(headerRow + 1);
  const dateOrder = detectDateOrder(body.map((r) => (map.date === null ? "" : r[map.date] ?? "")));
  const lines: StatementLine[] = [];
  let skipped = 0;
  // Tarjetas: lo habitual es que las compras vayan positivas, así que se invierte para dejar "sale = −"
  const invert = (opts.flip ? -1 : 1) * (opts.isCard && opts.purchasesPositive !== false ? -1 : 1);

  body.forEach((r, i) => {
    const cell = map.date === null ? "" : r[map.date] ?? "";
    const date = parseDate(cell, dateOrder) ?? parseDayMonth(cell, period, opts.yearHint);
    if (!date) { skipped++; return; }
    let amount: number | null = null;
    let exact: number | null = null;
    if (map.debit !== null || map.credit !== null) {
      const d = map.debit === null ? null : parseExactAmount(r[map.debit] ?? "");
      const c = map.credit === null ? null : parseExactAmount(r[map.credit] ?? "");
      if (d === null && c === null) { skipped++; return; }
      exact = Math.abs(c ?? 0) - Math.abs(d ?? 0);
      if (opts.flip) exact = -exact;
    } else if (map.amount !== null) {
      const v = parseExactAmount(r[map.amount] ?? "");
      if (v === null) { skipped++; return; }
      exact = v * invert;
    }
    if (exact === null || exact === 0) { skipped++; return; }
    amount = Math.round(exact);
    const description = (map.description === null ? "" : r[map.description] ?? "").replace(/\s+/g, " ").trim();
    const kind = classifyLine(description, exact);
    // Menos de medio peso solo tiene sentido como parte de los intereses del mes
    if (amount === 0 && !GROUPED.includes(kind)) { skipped++; return; }
    const balance = map.balance === null ? null : parseSignedAmount(r[map.balance] ?? "");
    lines.push({ id: `L${headerRow + 2 + i}`, date, description, amount, exact, balance, kind });
  });

  if (lines.length === 0) warnings.push("No encontré movimientos con fecha y valor. Revisa las columnas.");
  return { lines: groupMonthly(lines), map, headers, headerRow, dateOrder, skipped, warnings, period, raw: lines };
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
  /** `entry` es null cuando el cobro es tan pequeño que no hace falta registrarlo (menos de la tolerancia). */
  matched: { line: StatementLine; entry: AppEntry | null; /** Coincide con una diferencia pequeña (comisión de cambio en compras internacionales). */ approx?: boolean; /** La persona la vinculó a mano. */ manual?: boolean; /** Cruzada por valor idéntico con fechas muy distintas (app en un mes, extracto en otro): días de diferencia. */ dateGap?: number; /** La línea del extracto está fechada justo fuera del ciclo (el banco la facturó en este extracto): no cuenta entre las del ciclo. */ edge?: boolean }[];
  /** En el extracto y no en la app. */
  missing: StatementLine[];
  /** En la app y no en el extracto (del mes). */
  extra: AppEntry[];
  /** De las anteriores, las que parecen una copia de otra que sí aparece en el extracto. */
  duplicates: { entry: AppEntry; twin: AppEntry }[];
  /** Líneas del extracto fuera del mes que se cierra y que no se usaron para cruzar (no se comparan). */
  outOfRange: number;
}

const dayDiff = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

const entryText = (e: AppEntry) => `${e.tx.description ?? ""} ${e.tx.merchant ?? ""}`;

/** Cruce por valor: máximo de días entre la fecha de la app y la del extracto cuando el valor es idéntico (compras que la app dejó en un mes y el banco cobró en el siguiente). */
export const VALUE_WINDOW_DAYS = 45;
/** Por debajo de este valor, un monto igual no basta (hay muchas compras repetidas de $5.000): además debe coincidir el comercio. */
export const VALUE_ONLY_MIN = 20_000;

export interface ReconcileOptions {
  /** Movimientos que el cierre anterior dejó como partidas conciliatorias: pueden estar fechados fuera del ciclo y aun así se cruzan por valor. */
  carryTxIds?: Iterable<string>;
  /** Parejas que la persona separó ("esta no es"): el cruce por valor no las vuelve a unir. */
  apart?: { lineId: string; txId: string }[];
}

const STOP = new Set(["compra", "compras", "intl", "internacional", "pago", "pse", "qr", "transf", "transferencia", "transferencias", "banco", "sas", "ltda", "com", "www", "the", "del", "las", "los", "con", "por"]);
const words = (t: string) => fold(t).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));

/** ¿La descripción del extracto (a menudo cortada) y el movimiento de la app hablan del mismo comercio? */
export function sameMerchant(statementText: string, appText: string): boolean {
  const b = words(appText);
  return words(statementText).some((a) => b.some((w) => (w.startsWith(a) || a.startsWith(w)) && Math.min(a.length, w.length) >= 3));
}

/** ¿Este movimiento de la app es de la misma clase que un cobro agrupado del extracto? */
function isChargeEntry(kind: LineKind, e: AppEntry): boolean {
  if (kind === "GMF") return e.amount < 0 && e.tx.tags.includes("#gmf");
  if (kind === "INTEREST_IN") return e.amount > 0 && /interes|rendimiento/i.test(entryText(e));
  if (kind === "INTEREST_OUT") return e.amount < 0 && !e.tx.tags.includes("#gmf") && /interes/i.test(entryText(e));
  return false;
}

/**
 * Cruza el extracto con la app.
 *  · Líneas normales: mismo monto (con signo) y fecha dentro de `tolerance` días (el banco suele registrar un par de
 *    días después). Primero las de la misma fecha, luego 1 día de diferencia, etc., para que una línea no le robe su pareja a otra.
 *  · Lo que queda sin pareja y vale exactamente lo mismo se une por VALOR aunque la fecha difiera mucho (compra que la app dejó
 *    en octubre y el banco cobró en noviembre): ver `VALUE_WINDOW_DAYS` y `VALUE_ONLY_MIN`.
 *  · Intereses y 4x1000 (agrupados por mes): se compara el total del mes contra lo registrado en la app,
 *    con una tolerancia pequeña por redondeo; si falta algo, se propone solo la diferencia.
 */
export function reconcileStatement(account: Account, txs: Transaction[], lines: StatementLine[], range: MonthRange, tolerance = 3, opts: ReconcileOptions = {}): StatementReconciliation {
  const inRange = lines.filter((l) => l.date >= range.start && l.date <= range.end);
  const lo = addDays(range.start, -tolerance);
  const hi = addDays(range.end, tolerance);
  // Líneas pegadas al ciclo (hasta `tolerance` días antes o después): lo comprado el día del corte puede facturarse en cualquiera de los
  // dos extractos. Cruzan con lo de la app, pero si no tienen pareja no se reportan como faltantes (no son de este ciclo).
  const edge = lines.filter((l) => !GROUPED.includes(l.kind) && ((l.date < range.start && l.date >= lo) || (l.date > range.end && l.date <= hi)));
  const entries: AppEntry[] = [];
  for (const tx of txs) {
    const amount = effectOn(account.id, tx);
    if (amount !== 0 && tx.occurred_on >= lo && tx.occurred_on <= hi) entries.push({ tx, amount, date: tx.occurred_on });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date) || (a.tx.status === "CONFIRMED" ? -1 : 1));
  const inMonth = (e: AppEntry) => e.date >= range.start && e.date <= range.end;

  const entryTaken = new Set<AppEntry>();
  const matched: StatementReconciliation["matched"] = [];
  const missing: StatementLine[] = [];

  // 1) Cobros agrupados: total del mes
  for (const line of inRange.filter((l) => GROUPED.includes(l.kind))) {
    const recorded = entries.filter((e) => inMonth(e) && !entryTaken.has(e) && isChargeEntry(line.kind, e));
    const sum = recorded.reduce((a, e) => a + Math.abs(e.amount), 0);
    const target = Math.abs(line.amount);
    const tol = line.kind === "GMF" ? Math.max(50, target * 0.01) : Math.max(2, target * 0.01);
    if (Math.abs(target - sum) <= tol) {
      recorded.forEach((e) => entryTaken.add(e));
      matched.push({ line, entry: recorded[0] ?? null });
    } else if (sum < target) {
      recorded.forEach((e) => entryTaken.add(e));
      const rest = target - sum;
      missing.push({ ...line, amount: Math.sign(line.amount) * rest, description: sum > 0 ? `${line.description} · falta registrar la diferencia` : line.description });
    } // si la app tiene más que el banco, esos movimientos quedan como "solo en la app"
  }

  // 2) Líneas normales: primero monto exacto; luego con $1 de diferencia (el banco redondea los centavos)
  const regular = [...inRange.filter((l) => !GROUPED.includes(l.kind)), ...edge];
  const outside = (l: StatementLine) => l.date < range.start || l.date > range.end;
  const lineTaken = new Map<string, { entry: AppEntry; approx: boolean }>();
  const take = (line: StatementLine, entry: AppEntry, approx: boolean) => {
    lineTaken.set(line.id, { entry, approx });
    entryTaken.add(entry);
  };
  for (const slack of [0, 1]) {
    for (let d = 0; d <= tolerance; d++) {
      for (const line of regular) {
        if (lineTaken.has(line.id) || (slack === 1 && Math.abs(line.amount) < 1000)) continue;
        const hit = entries.find((e) => !entryTaken.has(e) && Math.sign(e.amount) === Math.sign(line.amount) && Math.abs(e.amount - line.amount) === slack && dayDiff(e.date, line.date) === d);
        if (hit) take(line, hit, false);
      }
    }
  }
  // Compras internacionales y similares: el banco cobra comisión de cambio y el aviso trae otro valor.
  // Se unen solo si el comercio coincide, la fecha es cercana y la diferencia es de hasta 5 %.
  for (const line of regular) {
    if (lineTaken.has(line.id)) continue;
    const near = entries
      .filter((e) => !entryTaken.has(e) && Math.sign(e.amount) === Math.sign(line.amount) && dayDiff(e.date, line.date) <= tolerance
        && Math.abs(e.amount - line.amount) <= Math.max(1, Math.abs(line.amount) * 0.05) && sameMerchant(line.description, entryText(e)))
      .sort((a, b) => dayDiff(a.date, line.date) - dayDiff(b.date, line.date) || Math.abs(a.amount - line.amount) - Math.abs(b.amount - line.amount));
    if (near[0]) take(line, near[0], true);
  }
  // Por valor: lo que sigue sin pareja y vale EXACTAMENTE lo mismo se une aunque las fechas difieran mucho (la app lo dejó en un
  // mes y el banco lo cobró en el siguiente). Los más cercanos en fecha primero y uno a uno. Solo entra lo del mes que se
  // cierra y las partidas conciliatorias del cierre anterior (que pueden estar fechadas antes del ciclo).
  const carry = new Set(opts.carryTxIds ?? []);
  const apart = new Set((opts.apart ?? []).map((k) => `${k.lineId}|${k.txId}`));
  const pool = entries.filter((e) => !entryTaken.has(e) && (inMonth(e) || carry.has(e.tx.id)));
  if (carry.size > 0) {
    const known = new Set(entries.map((e) => e.tx.id));
    for (const tx of txs) {
      if (!carry.has(tx.id) || known.has(tx.id)) continue;
      const amount = effectOn(account.id, tx);
      if (amount !== 0) pool.push({ tx, amount, date: tx.occurred_on });
    }
  }
  const gaps = new Map<string, number>();
  const pairs: { line: StatementLine; entry: AppEntry; slack: number; gap: number }[] = [];
  for (const line of regular) {
    if (lineTaken.has(line.id)) continue;
    for (const e of pool) {
      if (Math.sign(e.amount) !== Math.sign(line.amount)) continue;
      const slack = Math.abs(e.amount - line.amount);
      if (slack > 1 || (slack === 1 && Math.abs(line.amount) < 1000)) continue;
      const gap = dayDiff(e.date, line.date);
      if (gap > VALUE_WINDOW_DAYS || apart.has(`${line.id}|${e.tx.id}`)) continue;
      if (Math.abs(line.amount) < VALUE_ONLY_MIN && !sameMerchant(line.description, entryText(e))) continue;
      pairs.push({ line, entry: e, slack, gap });
    }
  }
  pairs.sort((a, b) => a.slack - b.slack || a.gap - b.gap || a.line.date.localeCompare(b.line.date) || a.line.id.localeCompare(b.line.id));
  for (const p of pairs) {
    if (lineTaken.has(p.line.id) || entryTaken.has(p.entry)) continue;
    take(p.line, p.entry, false);
    gaps.set(p.line.id, p.gap);
  }

  for (const l of regular) {
    const t = lineTaken.get(l.id);
    if (t) matched.push({ line: l, entry: t.entry, approx: t.approx || undefined, ...(gaps.has(l.id) ? { dateGap: gaps.get(l.id) } : {}), ...(outside(l) ? { edge: true } : {}) });
    else if (!outside(l)) missing.push(l);
  }
  missing.sort((a, b) => a.date.localeCompare(b.date));

  const extra = entries.filter((e) => !entryTaken.has(e) && inMonth(e));
  const matchedEntries = matched.map((m) => m.entry).filter((e): e is AppEntry => e !== null);
  const duplicates: StatementReconciliation["duplicates"] = [];
  for (const entry of extra) {
    const twin = matchedEntries.find((m) => m.amount === entry.amount && dayDiff(m.date, entry.date) <= tolerance);
    if (twin) duplicates.push({ entry, twin });
  }
  return { matched, missing, extra, duplicates, outOfRange: lines.length - inRange.length - matched.filter((m) => m.edge).length };
}

// ───────────────────── Vínculos hechos a mano ─────────────────────

/** "Esta línea del extracto es este movimiento de la app", cuando el cruce automático no los unió (otro valor, otro nombre, otra fecha). */
export interface ManualLink { lineId: string; txId: string }

/** Las líneas "agrupadas" (intereses, 4x1000) se comparan por total del mes: no se vinculan una a una. */
const linkable = (l: StatementLine) => !l.id.startsWith("G:");

/** Aplica los vínculos manuales: cada pareja pasa a "emparejada" y sale de "faltan en la app" y de "en la app, no en el extracto". */
export function withManualLinks(rec: StatementReconciliation, links: ManualLink[], account: Account, txs: Transaction[]): StatementReconciliation {
  if (links.length === 0) return rec;
  const lines = new Map(rec.missing.filter(linkable).map((l) => [l.id, l]));
  const byId = new Map(txs.map((t) => [t.id, t]));
  const matched = [...rec.matched];
  const doneLines = new Set<string>();
  const doneTxs = new Set<string>();
  for (const k of links) {
    const line = lines.get(k.lineId);
    const tx = byId.get(k.txId);
    if (!line || !tx || doneLines.has(line.id) || doneTxs.has(tx.id)) continue;
    const amount = effectOn(account.id, tx);
    if (amount === 0) continue;
    matched.push({ line, entry: { tx, amount, date: tx.occurred_on }, manual: true });
    doneLines.add(line.id);
    doneTxs.add(tx.id);
  }
  if (doneLines.size === 0) return rec;
  return {
    ...rec,
    matched,
    missing: rec.missing.filter((l) => !doneLines.has(l.id)),
    extra: rec.extra.filter((e) => !doneTxs.has(e.tx.id)),
    duplicates: rec.duplicates.filter((d) => !doneTxs.has(d.entry.tx.id)),
  };
}

/** El movimiento como entrada de la cuenta (con su efecto sobre el saldo), o null si no la toca. */
export function appEntryOf(account: Account, tx: Transaction): AppEntry | null {
  const amount = effectOn(account.id, tx);
  return amount === 0 ? null : { tx, amount, date: tx.occurred_on };
}

const closeness = (amount: number, date: string, ref: { amount: number; date: string }) => [Math.abs(Math.abs(amount) - Math.abs(ref.amount)), dayDiff(date, ref.date)] as const;

/**
 * Movimientos de la app que pueden ser esta línea del extracto: mismo sentido (entra o sale), hasta 10 días de diferencia y que
 * todavía no tengan pareja. Los de valor y fecha más parecidos primero. Incluye los de fuera del mes (el banco puede fecharlo en otro).
 */
export function appCandidatesFor(line: StatementLine, account: Account, txs: Transaction[], rec: StatementReconciliation, limit = 8): AppEntry[] {
  const taken = new Set(rec.matched.flatMap((m) => (m.entry ? [m.entry.tx.id] : [])));
  const out: AppEntry[] = [];
  for (const tx of txs) {
    const amount = effectOn(account.id, tx);
    if (amount === 0 || taken.has(tx.id) || Math.sign(amount) !== Math.sign(line.amount) || dayDiff(tx.occurred_on, line.date) > 10) continue;
    out.push({ tx, amount, date: tx.occurred_on });
  }
  const key = (e: AppEntry) => closeness(e.amount, e.date, line);
  return out.sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1]).slice(0, limit);
}

/** Lo mismo al revés: líneas del extracto que faltan en la app y pueden ser este movimiento. */
export function lineCandidatesFor(entry: AppEntry, rec: StatementReconciliation, limit = 8, days = 10): StatementLine[] {
  const key = (l: StatementLine) => closeness(l.amount, l.date, entry);
  return rec.missing
    .filter((l) => linkable(l) && Math.sign(l.amount) === Math.sign(entry.amount) && dayDiff(l.date, entry.date) <= days)
    .sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1])
    .slice(0, limit);
}

/**
 * Fechas que realmente se pueden comparar: el rango pedido (el ciclo de la tarjeta) recortado a lo que cubre el archivo
 * (el periodo que declara o, si no, de la primera a la última línea). Así un extracto por mes calendario no hace parecer
 * "faltantes" las compras del ciclo que el archivo no trae. Si no se cruzan, queda el rango pedido.
 */
export function coveredRange(base: MonthRange, lines: Pick<StatementLine, "date">[], period: { start: string; end: string } | null): MonthRange {
  const dates = lines.map((l) => l.date).sort();
  const from = period?.start ?? dates[0];
  const to = period?.end ?? dates[dates.length - 1];
  if (!from || !to) return base;
  const start = from > base.start ? from : base.start;
  const end = to < base.end ? to : base.end;
  return start <= end ? { ...base, start, end } : base;
}

// ───────────────────── Partidas del mes anterior ─────────────────────

export type CarryStatus = "FOUND" | "NOT_FOUND" | "GONE" | "UNKNOWN";

export interface CarryOver {
  item: ReconcilingItem;
  /**
   * FOUND: ya está en este extracto · NOT_FOUND: debería estar y no apareció · GONE: el movimiento ya no existe en la app ·
   * UNKNOWN: no se puede saber (sin extracto cargado, sin movimiento o fuera de las fechas que se comparan).
   */
  status: CarryStatus;
  /** Línea del extracto con la que se cruzó (solo en FOUND). */
  line?: StatementLine;
}

/**
 * Las partidas conciliatorias de un cierre (movimientos que el banco todavía no había cobrado) deberían aparecer en el
 * extracto siguiente. Con el cruce de ese extracto ya hecho, dice cuáles aparecieron y cuáles no.
 */
export function carryOverStatus(items: ReconcilingItem[], txs: Transaction[], rec: StatementReconciliation | null, range: MonthRange, tolerance = 3): CarryOver[] {
  const lineOf = new Map<string, StatementLine>();
  for (const m of rec?.matched ?? []) if (m.entry) lineOf.set(m.entry.tx.id, m.line);
  const ids = new Set(txs.map((t) => t.id));
  const lo = addDays(range.start, -tolerance);
  const hi = addDays(range.end, tolerance);
  // Sin líneas del extracto en las fechas comparadas no se puede decir que algo "no apareció"
  const covered = !!rec && rec.matched.length + rec.missing.length > 0;
  return items.map((item): CarryOver => {
    if (!item.transaction_id) return { item, status: "UNKNOWN" };
    if (!ids.has(item.transaction_id)) return { item, status: "GONE" };
    const line = lineOf.get(item.transaction_id);
    if (line) return { item, status: "FOUND", line };
    if (!covered || !item.occurred_on || item.occurred_on < lo || item.occurred_on > hi) return { item, status: "UNKNOWN" };
    return { item, status: "NOT_FOUND" };
  });
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
  const applies = account.kind !== "CREDIT_CARD" && account.kind !== "CASH" && account.kind !== "LOAN";
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
