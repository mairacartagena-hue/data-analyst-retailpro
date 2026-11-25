// Lectura local (sin IA) del extracto mensual de Addi, a partir del texto con posición del PDF.
// Devuelve el objeto "crudo" que pasa por `sanitizeCreditStatement` (el mismo que arma Gemini), así que el resto de la app
// no sabe de dónde salió. Si algo no cuadra devuelve null y la ruta cae a Gemini.
//
// Cómo está armado el extracto:
//   Página 1: fecha del extracto arriba a la derecha ("15 de noviembre de 2026"), y tres recuadros con su etiqueta encima:
//   "Fecha límite de pago" (la fecha puede partirse en dos líneas: "22 de nov. de" / "2026"), "Tu pago mínimo" y
//   "Tu pago total al …". Debajo, el "Resumen de tu pago mínimo" (intereses corrientes, capital, fianza…).
//   Página 2: "Detalle de tu pago mínimo", una fila por compra financiada:
//   fecha (mes y día; el año en la línea de abajo) · comercio (una o dos líneas) e ID · capital · interés (tasa EA debajo) ·
//   fianza · interés de mora · gastos de cobranza · pago mínimo.
// Validaciones: cada fila suma su pago mínimo (±$1, Addi redondea por dentro), las filas suman "Tu pago mínimo del mes" y el resumen cuadra con las columnas.

import { groupRows, type PdfRow, type PdfTextItem } from "./rows";

export interface AddiPurchase {
  date: string;
  merchant: string;
  id: string;
  capital: number;
  interest: number;
  rateEa: number;
  fianza: number;
  lateInterest: number;
  collection: number;
  minimum: number;
}

export interface AddiCreditRead {
  /** Para `sanitizeCreditStatement`. */
  statement: Record<string, unknown>;
  purchases: AddiPurchase[];
}

const MONTHS: Record<string, number> = {
  ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4, may: 5, mayo: 5, jun: 6, junio: 6,
  jul: 7, julio: 7, ago: 8, agosto: 8, sep: 9, sept: 9, septiembre: 9, setiembre: 9, oct: 10, octubre: 10,
  nov: 11, noviembre: 11, dic: 12, diciembre: 12,
};

const COP = /^\$\s*(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/;
const ROW_DATE = /^([a-záéíóú]{3,10})\.?\s+(\d{1,2})$/i;
const LONG_DATE = /^(\d{1,2})\s+de\s+([a-záéíóú]{3,10})\.?\s+de\s+(\d{4})$/i;
const YEAR = /^\d{4}$/;
const PERCENT = /^(\d{1,3}(?:,\d+)?)\s*%\s*E\.?\s?A\.?$/i;
const HEX_ID = /^[0-9a-f]{6,12}$/i;

const cents = (n: number) => Math.round(n * 100) / 100;
const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol;
const text = (it: PdfTextItem) => it.text.trim();
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** "$ 2.343.761,51" → 2343761.51; "$ 0,00" → 0. null si no es un valor en pesos. */
export function parseCop(s: string): number | null {
  const m = COP.exec(s.trim());
  if (!m) return null;
  const n = Number(`${m[1].replace(/\./g, "")}.${(m[2] ?? "0").padEnd(2, "0")}`);
  return Number.isFinite(n) ? n : null;
}

function iso(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const s = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return new Date(`${s}T00:00:00Z`).getUTCDate() === d ? s : null;
}

/** "15 de noviembre de 2026" o "22 de nov. de 2026" → "2026-11-22". */
export function parseLongDate(s: string): string | null {
  const m = LONG_DATE.exec(s.trim().replace(/\s+/g, " "));
  if (!m) return null;
  const month = MONTHS[norm(m[2])];
  return month ? iso(Number(m[3]), month, Number(m[1])) : null;
}

/** Trozos que están debajo de una etiqueta, en su misma columna (misma x ±3), hasta `depth` puntos más abajo. */
function below(items: PdfTextItem[], label: PdfTextItem, depth: number): PdfTextItem[] {
  return items
    .filter((it) => it.page === label.page && Math.abs(it.x - label.x) <= 3 && it.y < label.y - 1 && it.y >= label.y - depth)
    .sort((a, b) => b.y - a.y);
}

const find = (items: PdfTextItem[], re: RegExp) => items.find((it) => re.test(norm(it.text)));

/** El primer valor en pesos debajo de una etiqueta. */
function amountBelow(items: PdfTextItem[], label: RegExp): number | null {
  const l = find(items, label);
  if (!l) return null;
  for (const it of below(items, l, 30)) {
    const v = parseCop(text(it));
    if (v !== null) return v;
  }
  return null;
}

/** Valor en pesos en la misma fila que una etiqueta del resumen (a su derecha). 0 si la etiqueta no está. */
function summaryValue(rows: PdfRow[], label: RegExp): number | null {
  for (const r of rows) {
    const idx = r.items.findIndex((it) => label.test(norm(it.text)));
    if (idx < 0) continue;
    for (const it of r.items.slice(idx + 1)) {
      const v = parseCop(text(it));
      if (v !== null) return v;
    }
    return null;
  }
  return 0;
}

export function parseAddiCreditStatement(items: PdfTextItem[]): AddiCreditRead | null {
  const all = items.filter((it) => text(it));
  const joined = norm(all.map((it) => it.text).join(" "));
  if (!joined.includes("addi") || !joined.includes("detalle de tu pago minimo")) return null;

  // Fecha del extracto: la primera fecha larga completa de la página 1 (arriba a la derecha)
  const page1 = all.filter((it) => it.page === 1).sort((a, b) => b.y - a.y);
  const statementDate = page1.map((it) => parseLongDate(text(it))).find((d): d is string => !!d) ?? null;

  // Fecha límite de pago: lo que esté debajo de la etiqueta, unido (puede venir partido en dos líneas)
  const dueLabel = find(all, /^fecha limite de pago$/);
  const dueDate = dueLabel ? parseLongDate(below(all, dueLabel, 35).map(text).join(" ")) : null;

  const minimum = amountBelow(all, /^tu pago minimo$/);
  const payoff = amountBelow(all, /^tu pago total al\b/);
  if (!statementDate || !dueDate || minimum === null) return null;

  // Tabla del detalle: cada compra arranca con su fecha "Nov. 3" en la columna de la izquierda
  const header = find(all, /^detalle de tu pago minimo$/);
  if (!header) return null;
  const table = all.filter((it) => it.page === header.page && it.y < header.y);
  const footer = find(table, /^tu pago minimo del mes$/);
  const body = table.filter((it) => !footer || it.y > footer.y + 2);
  const credHeader = find(body, /^credito$/);
  const nameX = credHeader?.x ?? null;
  const anchors = body.filter((it) => ROW_DATE.test(text(it)) && MONTHS[norm(ROW_DATE.exec(text(it))![1])]).sort((a, b) => b.y - a.y);
  if (anchors.length === 0 || nameX === null) return null;

  const purchases: AddiPurchase[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const bottom = i + 1 < anchors.length ? anchors[i + 1].y + 2 : -Infinity;
    const block = body.filter((it) => it.y <= a.y + 2 && it.y > bottom);
    const [, mon, day] = ROW_DATE.exec(text(a))!;
    const yearIt = block.find((it) => Math.abs(it.x - a.x) <= 3 && YEAR.test(text(it)) && it.y < a.y);
    const date = yearIt ? iso(Number(text(yearIt)), MONTHS[norm(mon)], Number(day)) : null;
    // Valores de la fila: los que están a la altura de la fecha (±2), de izquierda a derecha
    const values = block.filter((it) => Math.abs(it.y - a.y) <= 2 && it.x > nameX + 10).map((it) => ({ x: it.x, v: parseCop(text(it)) }))
      .filter((v): v is { x: number; v: number } => v.v !== null).sort((p, q) => p.x - q.x).map((v) => v.v);
    if (!date || values.length !== 6) return null;
    const nameParts = block.filter((it) => Math.abs(it.x - nameX) <= 3).sort((p, q) => q.y - p.y).map(text);
    const id = nameParts.length > 1 && HEX_ID.test(nameParts[nameParts.length - 1]) ? (nameParts.pop() as string) : "";
    const rateIt = block.find((it) => PERCENT.test(text(it)));
    const rate = rateIt ? Number(PERCENT.exec(text(rateIt))![1].replace(",", ".")) : NaN;
    const [capital, interest, fianza, lateInterest, collection, rowMin] = values;
    if (!Number.isFinite(rate) || nameParts.length === 0) return null;
    // Addi redondea por dentro: en filas con intereses y fianza el pago mínimo impreso puede diferir unos centavos de la suma
    if (!near(capital + interest + fianza + lateInterest + collection, rowMin, 1)) return null;
    purchases.push({ date, merchant: nameParts.join(" ").replace(/\s+/g, " "), id, capital, interest, rateEa: rate, fianza, lateInterest, collection, minimum: rowMin });
  }

  const sum = (k: keyof AddiPurchase) => cents(purchases.reduce((s, p) => s + (p[k] as number), 0));
  if (!near(sum("minimum"), minimum, 0.05)) return null;
  // El resumen de la página 1 debe cuadrar con las columnas (si una línea no aparece, es porque va en 0)
  const rows = groupRows(page1);
  const checks: [RegExp, keyof AddiPurchase][] = [
    [/^intereses corrientes$/, "interest"], [/^capital de tus compras$/, "capital"], [/^servicio de fianza$/, "fianza"],
    [/^intereses? de mora$/, "lateInterest"], [/^gastos de cobranza$/, "collection"],
  ];
  for (const [label, key] of checks) {
    const v = summaryValue(rows, label);
    if (v === null || !near(v, sum(key), 0.05)) return null;
  }

  // Una sola tasa para el crédito: la de las compras que cobran intereses, si todas tienen la misma
  const rates = [...new Set(purchases.filter((p) => p.rateEa > 0).map((p) => p.rateEa))];
  const statement: Record<string, unknown> = {
    institution: "Addi",
    statement_date: statementDate,
    due_date: dueDate,
    rate_ea: rates.length === 1 ? rates[0] : null,
    installment_capital_interest: cents(sum("capital") + sum("interest")),
    monthly_costs: sum("fianza"),
    amount_due: minimum,
    payoff_amount: payoff,
  };
  return { statement, purchases };
}

/**
 * El mismo extracto en el formato de la revisión de tarjetas (`sanitizeCardStatement`): la deuda es el pago total a la fecha del
 * extracto. Addi no imprime el plan de cuotas de cada compra (número de cuotas ni saldo por compra) ni la lista de movimientos
 * del periodo, así que esas dos partes no se leen: se avisa en vez de mandarlas a la IA, que solo podría inventarlas.
 */
export function addiAsCardStatement(read: AddiCreditRead): Record<string, unknown> {
  const s = read.statement;
  return {
    institution: "Addi",
    statement_date: s.statement_date,
    due_date: s.due_date,
    total_debt: s.payoff_amount,
    total_payment: s.payoff_amount,
    minimum_payment: s.amount_due,
    rate_ea: s.rate_ea,
    purchases: [],
  };
}

export const ADDI_NO_INSTALLMENTS = "El extracto de Addi no trae el plan de cuotas de cada compra (cuántas cuotas ni cuánto queda por compra): revísalas en la app de Addi.";
export const ADDI_NO_LINES = "El extracto de Addi no trae la lista de movimientos del mes (compras y pagos), solo el detalle del pago mínimo, así que no hay nada que cruzar. Revisa los movimientos en la app de Addi.";
