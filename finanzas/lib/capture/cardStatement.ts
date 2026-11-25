// Lectura del extracto de una tarjeta de crédito (PDF o foto) con Gemini: validación de lo que devuelve.
// La persona revisa antes de que algo se guarde.

export interface CardStatementPurchase {
  description: string;
  purchaseDate: string;
  amount: number;
  installments: number;
  paidInstallments: number;
  remainingBalance: number;
  /** Cargo del mes por esta compra, tal como lo imprime el extracto: en unos bancos es la cuota con intereses y en otros (BBVA) solo el capital. */
  monthlyCharge?: number;
  /** "Saldo a corte" de la compra: lo que debía antes de la cuota de este mes (el saldo diferido es lo que queda después). */
  balanceAtCut?: number;
  rateEa?: number;
}

/**
 * Lo que una compra a cuotas factura en el extracto, cuando el extracto no imprime su plan (Addi: ni valor de la compra ni número de
 * cuotas, solo lo que cobra este mes de cada una). Se cruza con la app por la fecha de la compra.
 */
export interface CardChargeLine {
  purchaseDate: string;
  description: string;
  capital: number;
  interest: number;
  /** Fianza, seguros y otros cargos de esa compra en el mes. */
  fees: number;
  rateEa?: number;
}

export interface CardStatementData {
  institution?: string;
  last4?: string;
  /** Fecha de corte del extracto, AAAA-MM-DD. */
  statementDate?: string;
  /** Fecha límite de pago, AAAA-MM-DD. */
  dueDate?: string;
  /** Deuda total de la tarjeta a la fecha de corte. */
  totalDebt?: number;
  /** Pago total / para no generar intereses. */
  totalPayment?: number;
  minimumPayment?: number;
  creditLimit?: number;
  rateEa?: number;
  /** Compras diferidas a cuotas que siguen pendientes. */
  purchases: CardStatementPurchase[];
  /** Si el extracto no imprime el plan de cuotas por compra (Addi), por qué: no es un fallo de la lectura. */
  installmentsNote?: string;
  /** Cobro del mes de cada compra a cuotas, cuando el extracto lo trae así (Addi). Se cruza con `checkMonthlyCharges`. */
  chargeLines?: CardChargeLine[];
  /** Cuántas filas de compras devolvió la IA antes de validarlas (para distinguir "no vio ninguna" de "ninguna pasó la validación"). */
  rawPurchases?: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const money = (v: unknown, max = 100_000_000_000) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v < max ? Math.round(v) : undefined);
const date = (v: unknown) => (typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(v)) ? v : undefined);

export function sanitizeCardStatement(raw: Record<string, unknown>, today: string): CardStatementData {
  const r: CardStatementData = { purchases: [] };
  if (typeof raw.institution === "string" && raw.institution.trim()) r.institution = raw.institution.trim().slice(0, 60);
  if (typeof raw.card_number === "string") {
    const digits = raw.card_number.replace(/\D/g, "");
    if (digits.length >= 4) r.last4 = digits.slice(-4);
  }
  r.statementDate = date(raw.statement_date);
  r.dueDate = date(raw.due_date);
  r.totalDebt = money(raw.total_debt);
  r.totalPayment = money(raw.total_payment);
  r.minimumPayment = money(raw.minimum_payment);
  r.creditLimit = money(raw.credit_limit);
  r.rateEa = typeof raw.rate_ea === "number" && raw.rate_ea > 0 && raw.rate_ea < 200 ? Math.round(raw.rate_ea * 100) / 100 : undefined;
  const items = Array.isArray(raw.purchases) ? (raw.purchases as Record<string, unknown>[]) : [];
  r.rawPurchases = items.length;
  for (const it of items.slice(0, 200)) {
    const description = typeof it?.description === "string" ? it.description.trim().slice(0, 80) : "";
    const amount = money(it?.amount);
    const installments = typeof it?.installments === "number" ? Math.round(it.installments) : 0;
    const paid = typeof it?.paid_installments === "number" ? Math.round(it.paid_installments) : 0;
    const remaining = typeof it?.remaining_balance === "number" && it.remaining_balance >= 0 ? Math.round(it.remaining_balance) : undefined;
    // Solo compras realmente diferidas (2+ cuotas, con cuotas por pagar y saldo)
    if (!description || !amount || installments < 2 || installments > 48 || paid < 0 || paid >= installments || remaining === undefined || remaining <= 0 || remaining > amount) continue;
    const rate = typeof it.rate_ea === "number" && it.rate_ea >= 0 && it.rate_ea < 200 ? Math.round(it.rate_ea * 100) / 100 : undefined;
    // El cargo del mes de una compra no puede pasar de su valor; si viene raro se ignora (no se descarta la compra)
    const charge = money(it.monthly_charge);
    // El saldo a corte no puede ser menor que lo que queda ni mayor que la compra (con $1 de redondeo)
    const atCut = money(it.balance_at_cut);
    r.purchases.push({
      description, purchaseDate: date(it.purchase_date) ?? r.statementDate ?? today, amount, installments, paidInstallments: paid, remainingBalance: remaining,
      ...(charge !== undefined && charge <= amount ? { monthlyCharge: charge } : {}),
      ...(atCut !== undefined && atCut >= remaining && atCut <= amount + 1 ? { balanceAtCut: atCut } : {}),
      ...(rate !== undefined ? { rateEa: rate } : {}),
    });
  }
  for (const k of Object.keys(r) as (keyof CardStatementData)[]) if (r[k] === undefined) delete r[k];
  return r;
}

// ───────────────────── Movimientos del extracto (lectura aparte) ─────────────────────
// Segunda lectura, opcional: la lista de movimientos del periodo (compras, pagos, intereses, cuotas de manejo) para cruzarla
// con la app como se cruza el CSV. Va en una llamada separada porque con extractos largos tarda más que la lectura de totales.

export type CardLineKind = "PURCHASE" | "PAYMENT" | "INTEREST" | "FEE" | "OTHER";

export interface CardStatementLine {
  date: string;
  description: string;
  /** Valor en pesos, siempre positivo: el sentido lo da `credit`. */
  amount: number;
  kind: CardLineKind;
  /** true = abono a la tarjeta (pago, devolución, reversión): baja la deuda. */
  credit: boolean;
  /** Si es la cuota de una compra diferida, el número de cuota. Esas cuotas las revisa la validación de cuotas, no este cruce. */
  installmentNo?: number;
}

/** Totales tal como los imprime el extracto en su resumen (para comprobar que la lectura no se dejó movimientos). */
export interface CardPrintedTotals {
  purchases?: number;
  payments?: number;
  interest?: number;
  fees?: number;
}

export interface CardLinesData {
  institution?: string;
  last4?: string;
  periodStart?: string;
  periodEnd?: string;
  totals: CardPrintedTotals;
  lines: CardStatementLine[];
  /** Movimientos que la IA devolvió sin fecha o valor legibles. */
  dropped: number;
  /**
   * El extracto solo trae los cobros del banco (intereses, fianza, comisiones), no las compras ni los pagos (Addi): lo que la app
   * tenga de más en el periodo no es "solo en la app". `note` dice por qué.
   */
  chargesOnly?: boolean;
  note?: string;
}

const KINDS: CardLineKind[] = ["PURCHASE", "PAYMENT", "INTEREST", "FEE", "OTHER"];
const MAX_LINES = 400;

/** Monedas con las que el extracto repite el valor original de una compra en el exterior ("AIRBNB … COP", "… USD", "… MXN"). */
const CURRENCY_NOTE = /\s+(?:COP|USD|MXN|EUR|GBP|CAD|BRL|PEN|CLP|ARS|JPY|CHF|AUD|CNY)$/i;
const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
/** Mismo comercio: el extracto corta los nombres según la columna, así que la nota puede traer un tramo menos ("…CG USD" junto a "…CG2"). */
const sameText = (a: string, b: string) => {
  const x = norm(a);
  const y = norm(b);
  return x === y || (Math.min(x.length, y.length) >= 6 && (x.startsWith(y) || y.startsWith(x)));
};

/**
 * Debajo de una compra en moneda extranjera (o en pesos con comercio del exterior) el extracto repite el valor en la moneda original:
 * es una nota de la misma compra, no otro movimiento. Si se deja, la compra queda contada dos veces ("Faltan en la app: Registrar").
 * Solo se descarta la línea que termina en un código de moneda y que tiene, el mismo día, la compra con el mismo comercio.
 */
export function dropCurrencyNotes(lines: CardStatementLine[]): CardStatementLine[] {
  return lines.filter((l) => {
    const m = CURRENCY_NOTE.exec(l.description);
    if (!m) return true;
    const base = l.description.slice(0, m.index);
    return !lines.some((o) => o !== l && o.date === l.date && sameText(o.description, base));
  });
}

export function sanitizeCardLines(raw: Record<string, unknown>, today: string): CardLinesData {
  const year = Number(today.slice(0, 4));
  const inRange = (d: string) => Math.abs(Number(d.slice(0, 4)) - year) <= 1;
  const r: CardLinesData = { totals: {}, lines: [], dropped: 0 };
  if (typeof raw.institution === "string" && raw.institution.trim()) r.institution = raw.institution.trim().slice(0, 60);
  if (typeof raw.card_number === "string") {
    const digits = raw.card_number.replace(/\D/g, "");
    if (digits.length >= 4) r.last4 = digits.slice(-4);
  }
  const ps = date(raw.period_start);
  const pe = date(raw.period_end);
  if (ps && pe && ps <= pe) { r.periodStart = ps; r.periodEnd = pe; }
  // Un total impreso de $0 es un dato válido ("intereses: 0"); solo se descarta lo que no es número
  const printed = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 100_000_000_000 ? Math.round(Math.abs(v)) : undefined);
  const totals = (raw.printed_totals ?? {}) as Record<string, unknown>;
  for (const k of ["purchases", "payments", "interest", "fees"] as const) {
    const v = printed(totals[k]);
    if (v !== undefined) r.totals[k] = v;
  }
  const items = Array.isArray(raw.lines) ? (raw.lines as Record<string, unknown>[]) : [];
  for (const it of items.slice(0, MAX_LINES)) {
    const d = date(it?.date);
    const value = typeof it?.amount === "number" && Number.isFinite(it.amount) ? it.amount : NaN;
    const amount = Math.round(Math.abs(value));
    if (!d || !inRange(d) || !(amount > 0) || amount >= 100_000_000_000) { r.dropped++; continue; }
    const kind = KINDS.includes(it.kind as CardLineKind) ? (it.kind as CardLineKind) : "OTHER";
    const description = typeof it.description === "string" ? it.description.replace(/\s+/g, " ").trim().slice(0, 80) : "";
    // Un valor negativo en el extracto también es un abono, aunque la IA no lo haya marcado
    const credit = kind === "PAYMENT" || it.is_credit === true || value < 0;
    const no = typeof it.installment_no === "number" ? Math.round(it.installment_no) : 0;
    r.lines.push({ date: d, description, amount, kind, credit, ...(no >= 1 && no <= 48 ? { installmentNo: no } : {}) });
  }
  r.lines = dropCurrencyNotes(r.lines);
  if (items.length > MAX_LINES) r.dropped += items.length - MAX_LINES;
  for (const k of Object.keys(r) as (keyof CardLinesData)[]) if (r[k] === undefined) delete r[k];
  return r;
}

/**
 * Lee con los modelos en orden y se queda con la primera lectura que SÍ trae lo importante (`good`): un modelo saturado o liviano
 * a veces responde bien pero con la lista vacía. Si ninguno la trae devuelve la primera lectura válida (vacía); si ninguna se
 * pudo leer, relanza el último error. `read` recibe el modelo y los ms que quedan del presupuesto (Vercel corta a los 60 s);
 * con menos de `minMs` no se prueba otro modelo.
 */
export async function firstGoodRead<T>(
  models: string[],
  read: (model: string, leftMs: number) => Promise<T>,
  good: (data: T) => boolean,
  noRead: string,
  budgetMs = 57_000,
  minMs = 8_000,
  now: () => number = Date.now,
): Promise<T> {
  const started = now();
  let empty: { data: T } | null = null;
  let lastError: unknown = null;
  for (const model of models) {
    const left = budgetMs - (now() - started);
    if (left < minMs) break;
    try {
      const data = await read(model, left);
      if (good(data)) return data;
      empty ??= { data };
    } catch (e) {
      lastError = e;
    }
  }
  if (empty) return empty.data;
  throw lastError ?? new Error(noRead);
}

/** Lee los movimientos probando los modelos en orden: se queda con la primera lectura que SÍ trae movimientos. */
export const firstReadWithLines = (
  models: string[],
  read: (model: string, leftMs: number) => Promise<CardLinesData>,
  budgetMs = 57_000,
  minMs = 8_000,
  now: () => number = Date.now,
): Promise<CardLinesData> => firstGoodRead(models, read, (d) => d.lines.length > 0, "No se pudo leer la lista de movimientos del extracto.", budgetMs, minMs, now);

/** Lee los totales y las compras a cuotas probando los modelos en orden: se queda con la primera lectura que SÍ trae compras. */
export const firstReadWithPurchases = (
  models: string[],
  read: (model: string, leftMs: number) => Promise<CardStatementData>,
  budgetMs = 57_000,
  minMs = 8_000,
  now: () => number = Date.now,
): Promise<CardStatementData> => firstGoodRead(models, read, (d) => d.purchases.length > 0, "No se pudo leer el extracto.", budgetMs, minMs, now);
