// Lectura de un extracto de crédito (PDF o foto) con Gemini: validación de lo que devuelve y cómo se
// traduce a los campos del crédito en la app. La persona revisa el formulario antes de guardar.

export interface CreditStatementData {
  institution?: string;
  last4?: string;
  /** Fecha del extracto (facturación o corte), AAAA-MM-DD. */
  statementDate?: string;
  /** Fecha límite de pago de la cuota facturada, AAAA-MM-DD. */
  dueDate?: string;
  /** Saldo de capital a la fecha del extracto. */
  capitalBalance?: number;
  /** Tasa efectiva anual (%) que se está cobrando. */
  rateEa?: number;
  termMonths?: number;
  installmentsPending?: number;
  /** Capital + intereses corrientes de la cuota facturada. */
  installmentAmount?: number;
  /** Seguros y otros cargos fijos de la cuota. */
  monthlyCosts?: number;
  /** Valor total a pagar de la cuota. */
  amountDue?: number;
  /** Valor inicial del crédito (desembolso), si aparece. */
  originalAmount?: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const money = (v: unknown, max = 100_000_000_000) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v < max ? Math.round(v * 100) / 100 : undefined);
const int = (v: unknown, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : undefined);
const date = (v: unknown) => (typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(v)) ? v : undefined);

/** Solo se aceptan valores con forma válida; lo demás queda vacío. */
export function sanitizeCreditStatement(raw: Record<string, unknown>): CreditStatementData {
  const r: CreditStatementData = {};
  if (typeof raw.institution === "string" && raw.institution.trim()) r.institution = raw.institution.trim().slice(0, 60);
  if (typeof raw.credit_number === "string") {
    const digits = raw.credit_number.replace(/\D/g, "");
    if (digits.length >= 4) r.last4 = digits.slice(-4);
  }
  r.statementDate = date(raw.statement_date);
  r.dueDate = date(raw.due_date);
  r.capitalBalance = money(raw.capital_balance);
  const rate = typeof raw.rate_ea === "number" && raw.rate_ea > 0 && raw.rate_ea < 200 ? Math.round(raw.rate_ea * 100) / 100 : undefined;
  r.rateEa = rate;
  r.termMonths = int(raw.term_months, 1, 600);
  r.installmentsPending = int(raw.installments_pending, 0, 600);
  r.installmentAmount = money(raw.installment_capital_interest);
  r.monthlyCosts = typeof raw.monthly_costs === "number" && raw.monthly_costs >= 0 && raw.monthly_costs < 1_000_000_000 ? Math.round(raw.monthly_costs * 100) / 100 : undefined;
  r.amountDue = money(raw.amount_due);
  r.originalAmount = money(raw.original_amount);
  if (r.termMonths && r.installmentsPending !== undefined && r.installmentsPending > r.termMonths) r.installmentsPending = undefined;
  for (const k of Object.keys(r) as (keyof CreditStatementData)[]) if (r[k] === undefined) delete r[k];
  return r;
}

/**
 * Cuota en la que va el crédito hoy según el extracto: plazo − pendientes + 1 es la cuota facturada; si su fecha
 * de pago ya pasó, cuenta como pagada y se suma cada día de pago transcurrido desde entonces.
 */
export function currentInstallmentFrom(d: CreditStatementData, today: string): number | undefined {
  if (!d.termMonths || d.installmentsPending === undefined) return undefined;
  let next = d.termMonths - d.installmentsPending + 1;
  if (d.dueDate && d.dueDate < today) {
    const [y0, m0, dd] = d.dueDate.split("-").map(Number);
    const [y1, m1, d1] = today.split("-").map(Number);
    let months = (y1 - y0) * 12 + (m1 - m0);
    if (d1 >= dd) months += 1;
    next += Math.max(1, months);
  }
  return Math.min(Math.max(1, next), d.termMonths);
}
