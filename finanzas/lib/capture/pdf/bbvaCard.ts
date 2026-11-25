// Lectura local (sin IA) del extracto de una tarjeta de crédito de BBVA Colombia, a partir del texto con posición del PDF.
// Devuelve lo mismo que la lectura con Gemini (los objetos "crudos" que pasan por `sanitizeCardStatement` y `sanitizeCardLines`),
// así que el resto de la app no sabe de dónde salió. Si algo no cuadra devuelve null y la ruta cae a Gemini.
//
// Cómo está armado el extracto (página 1): tres cuadros con los valores a la derecha de unas etiquetas que en el PDF son dibujos,
// no texto. Por eso los valores se identifican por su posición y su orden, y se validan con la cuenta del resumen:
//   saldo anterior + facturación + intereses corrientes + intereses de mora − pagos y abonos = saldo total.
// Después viene la tabla de movimientos: fecha · comprobante · descripción · tasa · cuota "NN DE MM" · valor original · saldo a corte ·
// cargos del mes · saldo diferido, por tarjeta y en dos bloques ("MOVIMIENTOS ANTERIORES" y "MOVIMIENTOS DE ESTE MES").

import { groupRows, isMoney, parseDate, parseMoney, rightEdge, type PdfRow, type PdfTextItem } from "./rows";

export interface BbvaCardRead {
  /** Últimos 4 dígitos de las tarjetas que trae el extracto (la principal primero). */
  cards: string[];
  /** Para `sanitizeCardStatement`: totales y compras diferidas. */
  statement: Record<string, unknown>;
  /** Para `sanitizeCardLines`: movimientos del periodo y totales impresos. */
  lines: Record<string, unknown>;
  summary: { previous: number; purchases: number; interest: number; late: number; payments: number; total: number };
  stats: { movements: number; currencyNotes: number; unreadable: number };
}

const CARD_LABEL = /^TARJETA\s+\d{4,6}\*+(\d{4})$/;
const CARD_HEADER = /^\d{4,6}\*{4,}(\d{4})$/;
const CUOTA = /^(\d{2}) DE (\d{2})$/;
const RATE = /^(?:\d{1,3}\.\d{2}|\.\d{2}|\*{5})$/;
const PERCENT = /^(\d{1,3}(?:\.\d+)?)\s*%\s*E\.?\s?A\.?$/i;
const DATE_COL_MAX = 60; // fecha (ddmmyyyy): x < 60
const DESC_COL = [125, 275] as const; // descripción
const RATE_COL = [275, 320] as const; // tasa de la transacción
const CUOTA_COL = [320, 362] as const; // "NN DE MM"
const AMOUNTS_FROM = 360; // desde aquí, solo valores
// Bordes derechos que separan las cuatro columnas de valores (observados ≈ 417 · 472 · 523 · 580)
const EDGE_ORIGINAL = 445;
const EDGE_AT_CUT = 497;
const EDGE_CHARGE = 550;

type Section = "PREVIOUS" | "CURRENT";

interface Movement {
  date: string;
  description: string;
  rate: number | null;
  cuota: { no: number; of: number } | null;
  original: number;
  atCut: number | null;
  charge: number | null;
  deferred: number | null;
  credit: boolean;
  section: Section | null;
}

const cents = (n: number) => Math.round(n * 100) / 100;
const between = (v: number, [a, b]: readonly [number, number]) => v >= a && v < b;
const text = (it: PdfTextItem) => it.text.trim();

/** Mismo día del mes anterior (el corte anterior); si ese mes no tiene ese día, el último. */
export function previousCutoff(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  return `${py}-${String(pm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

function addDay(iso: string): string {
  const t = new Date(`${iso}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

/** Pagos y abonos del titular (el resto de los abonos —devoluciones, puntos, ajustes— es "OTHER"). */
function kindOf(description: string, credit: boolean): "PURCHASE" | "PAYMENT" | "INTEREST" | "FEE" | "OTHER" {
  if (credit) return /^(PAGO|ABONO)\b/i.test(description) && !/COMPRA\s+ESPECIF/i.test(description) ? "PAYMENT" : "OTHER";
  if (/^INTERES(ES)?\b/i.test(description)) return "INTEREST";
  // Cobros del banco: "Cobro Prima: Vida…", "COBRO PRIMA SEGURO…", cuota de manejo, comisiones, IVA (al inicio, para no confundir un comercio)
  if (/^(COBRO\b|CUOTA\s+(DE\s+)?MANEJO|COMISI[OÓ]N|IVA\b|PRIMA\b|SEGURO\b)/i.test(description)) return "FEE";
  return "PURCHASE";
}

/** Un movimiento de la tabla; null si no es una fila de movimiento. `note` = nota con el valor en la moneda original (no es otro movimiento). */
function readMovement(row: PdfRow, section: Section | null): { mov?: Movement; note?: true; unreadable?: true } | null {
  const dateItem = row.items.find((i) => i.x < DATE_COL_MAX && /^\d{8}$/.test(text(i)));
  if (!dateItem) return null;
  const date = parseDate(text(dateItem));
  const rateItem = row.items.find((i) => between(i.x, RATE_COL) && RATE.test(text(i)));
  const cuotaItem = row.items.find((i) => between(i.x, CUOTA_COL) && CUOTA.test(text(i)));
  // Debajo de una compra en moneda extranjera el extracto repite el valor original con "*****" en las demás columnas
  if (rateItem && text(rateItem) === "*****" && !cuotaItem) return { note: true };
  const description = row.items
    .filter((i) => between(i.x, DESC_COL))
    .map(text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const values = row.items.filter((i) => i.x >= AMOUNTS_FROM && isMoney(i.text));
  const pick = (from: number, to: number) => {
    const it = values.find((v) => rightEdge(v) > from && rightEdge(v) <= to);
    return it ? parseMoney(it.text) : null;
  };
  const original = pick(0, EDGE_ORIGINAL);
  if (!date || !description || original === null || original <= 0) return { unreadable: true };
  // Un abono lleva un "-" antes del valor, suelto o pegado a él
  const credit = row.items.some((i) => i.x >= AMOUNTS_FROM && (/^[-−]$/.test(text(i)) || /^[-−]\s*\d/.test(text(i))));
  const cuota = cuotaItem ? { no: Number(CUOTA.exec(text(cuotaItem))?.[1]), of: Number(CUOTA.exec(text(cuotaItem))?.[2]) } : null;
  const rate = rateItem && text(rateItem) !== "*****" ? Number(text(rateItem)) : null;
  return {
    mov: {
      date, description, rate: rate !== null && Number.isFinite(rate) ? rate : null, cuota, original, credit, section,
      atCut: pick(EDGE_ORIGINAL, EDGE_AT_CUT), charge: pick(EDGE_AT_CUT, EDGE_CHARGE), deferred: pick(EDGE_CHARGE, 10_000),
    },
  };
}

type HeaderKind = "M" | "D" | "P";
interface HeaderValue { kind: HeaderKind; raw: string; y: number }

/** Valores de los cuadros del resumen (antes de la primera tarjeta), por zona de la página y de arriba abajo. */
function headerValues(rows: PdfRow[]): { left: HeaderValue[]; middle: HeaderValue[]; card?: string } {
  const left: HeaderValue[] = [];
  const middle: HeaderValue[] = [];
  let card: string | undefined;
  for (const row of rows) {
    if (row.page !== 1) break;
    if (row.items.some((i) => CARD_LABEL.test(text(i)))) break;
    for (const it of row.items) {
      const t = text(it);
      const m = CARD_HEADER.exec(t);
      if (m && !card) card = m[1];
      const kind: HeaderKind | null = isMoney(t) ? "M" : parseDate(t) && t.includes("-") ? "D" : PERCENT.test(t) ? "P" : null;
      if (!kind) continue;
      if (it.x < 280) left.push({ kind, raw: t, y: row.y });
      else if (it.x < 500) middle.push({ kind, raw: t, y: row.y });
    }
  }
  const byTop = (a: HeaderValue, b: HeaderValue) => b.y - a.y;
  return { left: left.sort(byTop), middle: middle.sort(byTop), card };
}

const kinds = (v: HeaderValue[]) => v.map((x) => x.kind).join("");

export function parseBbvaCardStatement(items: PdfTextItem[]): BbvaCardRead | null {
  const rows = groupRows(items);
  const { left, middle, card } = headerValues(rows);
  // Estructura esperada del resumen: [cupo, disponible, disponible avances, corte, límite de pago, pago total, pago mínimo]
  // y [saldo anterior, facturación, intereses corrientes, mora, pagos, saldo total, no cobrados, %EA mora, %EA del mes]
  if (kinds(left) !== "MMMDDMM" || kinds(middle) !== "MMMMMMMPP") return null;
  const L = left.map((v) => (v.kind === "M" ? parseMoney(v.raw) : parseDate(v.raw)));
  const M = middle.map((v) => (v.kind === "M" ? parseMoney(v.raw) : Number(PERCENT.exec(v.raw)?.[1])));
  if (L.some((v) => v === null) || M.some((v) => v === null || Number.isNaN(v))) return null;
  const [limit, , , cutoff, dueDate, totalPayment, minimumPayment] = L as [number, number, number, string, string, number, number];
  const [previous, purchases, interest, late, payments, total, , , rateEa] = M as number[];
  // La cuenta del resumen tiene que cuadrar: si no, algún valor no es el que creo y no se confía en la lectura
  if (Math.abs(previous + purchases + interest + late - payments - total) > 1 || Math.abs(totalPayment - total) > 1) return null;

  const movements: Movement[] = [];
  const cards: string[] = [];
  let section: Section | null = null;
  let currencyNotes = 0;
  let unreadable = 0;
  for (const row of rows) {
    const labels = row.items.map(text);
    const cardLabel = labels.map((t) => CARD_LABEL.exec(t)).find(Boolean);
    if (cardLabel) {
      if (!cards.includes(cardLabel[1])) cards.push(cardLabel[1]);
      section = null;
      continue;
    }
    if (labels.includes("MOVIMIENTOS ANTERIORES")) { section = "PREVIOUS"; continue; }
    if (labels.includes("MOVIMIENTOS DE ESTE MES")) { section = "CURRENT"; continue; }
    const r = readMovement(row, section);
    if (!r) continue;
    if (r.note) currencyNotes++;
    else if (r.unreadable) unreadable++;
    else if (r.mov) movements.push(r.mov);
  }
  if (cards.length === 0 || movements.length === 0) return null;

  const start = addDay(previousCutoff(cutoff));
  const lines = movements.map((m) => ({
    date: m.date,
    description: m.description,
    amount: m.original,
    kind: kindOf(m.description, m.credit),
    is_credit: m.credit,
    // La cuota que se factura ("02 DE 36" → 2); las compras nuevas del mes traen "00 DE 36" y no son todavía una cuota
    installment_no: m.cuota && !m.credit ? m.cuota.no : null,
  }));
  // Compras diferidas a 2 o más cuotas con saldo pendiente; la columna "cargos del mes" de BBVA es solo el capital
  const deferred = movements
    .filter((m) => !m.credit && m.cuota && m.cuota.of >= 2 && m.deferred !== null && m.deferred > 0)
    .map((m) => ({
      description: m.description,
      purchase_date: m.date,
      amount: m.original,
      installments: m.cuota?.of,
      paid_installments: m.cuota?.no,
      remaining_balance: m.deferred,
      monthly_charge: m.charge,
      balance_at_cut: m.atCut,
      rate_ea: m.rate,
    }));
  const last4 = card ?? cards[0];
  return {
    cards,
    summary: { previous, purchases, interest, late, payments, total },
    stats: { movements: movements.length, currencyNotes, unreadable },
    statement: {
      institution: "BBVA", card_number: last4, statement_date: cutoff, due_date: dueDate,
      total_debt: total, total_payment: totalPayment, minimum_payment: minimumPayment, credit_limit: limit, rate_ea: rateEa,
      purchases: deferred,
    },
    lines: {
      institution: "BBVA", card_number: last4, period_start: start, period_end: cutoff,
      // BBVA cuenta los seguros y comisiones dentro de la facturación y no trae un total de cuotas de manejo ($0)
      printed_totals: { purchases: cents(purchases), payments: cents(payments), interest: cents(interest + late), fees: 0 },
      lines,
    },
  };
}
