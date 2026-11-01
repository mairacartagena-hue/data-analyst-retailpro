// Lectura del extracto de una tarjeta de crédito (PDF o foto) con Gemini: validación de lo que devuelve.
// La persona revisa antes de que algo se guarde.

export interface CardStatementPurchase {
  description: string;
  purchaseDate: string;
  amount: number;
  installments: number;
  paidInstallments: number;
  remainingBalance: number;
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
  for (const it of items.slice(0, 200)) {
    const description = typeof it?.description === "string" ? it.description.trim().slice(0, 80) : "";
    const amount = money(it?.amount);
    const installments = typeof it?.installments === "number" ? Math.round(it.installments) : 0;
    const paid = typeof it?.paid_installments === "number" ? Math.round(it.paid_installments) : 0;
    const remaining = typeof it?.remaining_balance === "number" && it.remaining_balance >= 0 ? Math.round(it.remaining_balance) : undefined;
    // Solo compras realmente diferidas (2+ cuotas, con cuotas por pagar y saldo)
    if (!description || !amount || installments < 2 || installments > 48 || paid < 0 || paid >= installments || remaining === undefined || remaining <= 0 || remaining > amount) continue;
    const rate = typeof it.rate_ea === "number" && it.rate_ea >= 0 && it.rate_ea < 200 ? Math.round(it.rate_ea * 100) / 100 : undefined;
    r.purchases.push({ description, purchaseDate: date(it.purchase_date) ?? r.statementDate ?? today, amount, installments, paidInstallments: paid, remainingBalance: remaining, ...(rate !== undefined ? { rateEa: rate } : {}) });
  }
  for (const k of Object.keys(r) as (keyof CardStatementData)[]) if (r[k] === undefined) delete r[k];
  return r;
}
