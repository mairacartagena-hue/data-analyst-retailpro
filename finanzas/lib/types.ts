// Filas de la base de datos (nombres tal como están en Supabase).
import type { Responsibility } from "@/lib/finance/budget";
import type { AccountKind } from "@/lib/finance/safeToSpend";
import type { LedgerKind, SplitOrigin } from "@/lib/finance/crossLedger";

export type Visibility = "PUBLIC" | "BALANCE_ONLY" | "PRIVATE";
export type TxKind = "EXPENSE" | "INCOME" | "TRANSFER" | "SETTLEMENT" | "DEBT_PAYMENT" | "REFUND" | "ADJUSTMENT";
/** Espacio al que pertenece un movimiento, presupuesto, compromiso o meta. */
export type Space = "HOUSEHOLD" | "PERSONAL";

export const SPACE_LABEL: Record<Space, string> = { HOUSEHOLD: "Hogar", PERSONAL: "Personal" };

export const TX_KIND_LABEL: Record<TxKind, string> = {
  EXPENSE: "Gasto",
  INCOME: "Ingreso",
  TRANSFER: "Transferencia",
  SETTLEMENT: "Liquidación",
  DEBT_PAYMENT: "Pago de deuda",
  REFUND: "Reembolso",
  ADJUSTMENT: "Ajuste",
};

export interface Household {
  id: string;
  name: string;
  invite_code: string;
}

export interface Member {
  id: string;
  household_id: string;
  user_id: string;
  slot: "A" | "B";
  display_name: string;
  color: string;
  avatar: string | null;
}

export interface PeriodSettingsRow {
  household_id: string;
  cycle: "MONTHLY" | "BIWEEKLY";
  monthly_start_day: number;
  biweekly_first_day: number;
  biweekly_second_day: number;
  uvt_value?: number;
}

export interface Reconciliation {
  id: string;
  account_id: string;
  month: string;
  statement_balance: number;
  app_balance: number;
  difference: number;
  status: "RECONCILED" | "DIFFERENCE";
  note: string | null;
  updated_at: string;
}

export interface CustomPeriodRow {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
}

export interface Account {
  id: string;
  household_id: string;
  owner_user_id: string;
  name: string;
  kind: AccountKind;
  institution: string | null;
  last4: string | null;
  /** Otros últimos 4 dígitos de la misma cuenta (ej. su tarjeta débito). */
  alias_last4?: string[];
  visibility: Visibility;
  reveal_in_shared: boolean;
  opening_balance: number;
  /** Momento del saldo inicial; los movimientos anteriores no lo afectan. */
  opening_at?: string;
  gmf_mode?: "TAXED" | "EXEMPT_350" | "LOW_AMOUNT_65";
  credit_limit: number | null;
  statement_day: number | null;
  due_day: number | null;
  /** Quién paga la tarjeta o el crédito (vacío = el dueño). */
  responsible_user_id?: string | null;
  /** Tarjetas: tasa de interés efectiva anual (%) para estimar los intereses de las cuotas. */
  interest_rate_ea?: number | null;
  /** Créditos: plazo en meses y costos mensuales (seguros, otros). */
  term_months?: number | null;
  /** Créditos: cuotas ya pagadas a la fecha paid_installments_on (desde ahí suma cada día de pago). */
  paid_installments?: number | null;
  /** Créditos: valor inicial (lo que prestó el banco). */
  original_amount?: number | null;
  /** Créditos: cuota fija del extracto (capital + intereses, sin seguros). */
  installment_amount?: number | null;
  paid_installments_on?: string | null;
  monthly_costs?: number;
  archived: boolean;
}

export interface AccountLabel {
  id: string;
  owner_user_id: string;
  name: string;
  kind: AccountKind;
  institution: string | null;
  last4: string | null;
  visibility: Visibility;
}

export interface Category {
  id: string;
  household_id: string;
  name: string;
  icon: string | null;
  responsibility: Responsibility;
  owner_user_id: string | null;
  is_household_obligation: boolean;
  is_shared_progress: boolean;
  rollover_enabled: boolean;
  archived: boolean;
  created_at: string;
  /** EXPENSE: categoría de presupuesto · INCOME: de dónde viene un ingreso. */
  kind?: "EXPENSE" | "INCOME";
  /** Categoría principal (si es una subcategoría). */
  parent_id?: string | null;
}

/**
 * Presupuesto de una categoría: del hogar (con responsable) o personal (de su dueño).
 * La categoría en sí no decide quién paga ni si es del hogar o personal.
 */
export interface CategoryLimit {
  id: string;
  category_id: string;
  scope: Space;
  owner_user_id: string | null;
  responsibility: Exclude<Responsibility, "PRIVATE"> | null;
  is_household_obligation: boolean;
  rollover_enabled: boolean;
  /** Personal: su dueño lo comparte con la pareja (ve el límite y el avance, no los movimientos). */
  shared_with_partner: boolean;
}

export interface CategoryBudgetRow {
  id: string;
  category_id: string;
  limit_id: string;
  valid_from: string;
  amount: number;
  fixed_amount_a: number | null;
  fixed_amount_b: number | null;
}

export interface Split {
  id: string;
  transaction_id: string;
  amount: number;
  category_id: string | null;
  responsible_user_id: string;
  origin: SplitOrigin;
  note: string | null;
}

export interface Transaction {
  id: string;
  kind: TxKind;
  status: "CONFIRMED" | "PENDING_REVIEW";
  occurred_on: string;
  amount: number;
  description: string | null;
  merchant: string | null;
  account_id: string | null;
  to_account_id: string | null;
  payer_user_id: string;
  counterparty_user_id: string | null;
  is_shared: boolean;
  /** Hogar o personal: decide quién lo ve (junto con quién participa en él). */
  scope: Space;
  /** Si quien pagó y quien responde son distintos: ¿se anota deuda en el cruce? */
  creates_debt: boolean;
  /** Solo en ajustes: IN suma al saldo, OUT resta. */
  direction?: "IN" | "OUT" | null;
  updated_by?: string | null;
  scheduled_payment_id?: string | null;
  scheduled_for?: string | null;
  source: string;
  tags: string[];
  created_by: string;
  created_at: string;
  occurred_at?: string | null;
  merchant_norm?: string | null;
  movement_type?: "PURCHASE" | "TRANSFER_OUT" | "TRANSFER_IN" | "WITHDRAWAL" | "CARD_PAYMENT" | "INCOME" | "OWN_TRANSFER" | null;
  card_last4?: string | null;
  /** Llaves, cuentas, celulares o NIT que traía el aviso del banco. */
  ingest_identifiers?: { type: string; value: string }[] | null;
  suggested_category_id?: string | null;
  suggested_responsible_user_id?: string | null;
  suggested_to_account_id?: string | null;
  income_category_id?: string | null;
  /** Compras con tarjeta de crédito: número de cuotas (1 = una sola). */
  installments?: number;
  /** Tasa efectiva anual (%) de esta compra a cuotas; si no hay, la de la tarjeta. */
  interest_rate_ea?: number | null;
  /** Solo en las copias por cuota que usan presupuestos e informes: número de la cuota y el movimiento original. */
  installment_no?: number;
  installment_of?: Transaction;
  /** Plata de un tercero (ej. Álvaro): mueve la cuenta pero no es gasto ni ingreso propio. */
  third_party_id?: string | null;
  splits: Split[];
}

export interface ThirdParty {
  id: string;
  name: string;
}

export interface IngestLog {
  id: string;
  channel: string;
  source: string | null;
  raw_text: string | null;
  parser: string | null;
  result: "ACCEPTED" | "MERGED" | "DISCARDED" | "IGNORED" | "UNRECOGNIZED" | "ERROR";
  reason: string | null;
  transaction_id: string | null;
  received_at: string;
}

export interface MerchantMemory {
  id: string;
  identifier_type: "MERCHANT" | "NIT" | "ACCOUNT" | "PHONE" | "KEYWORD";
  identifier: string;
  category_id: string | null;
  responsible_user_id: string | null;
  tag: string | null;
  auto_apply: boolean;
  hits: number;
  /** Nombre que la persona le puso (ej. "Heladería", "Hermano"). */
  label: string | null;
  scope: "HOUSEHOLD" | "PERSONAL" | null;
  creates_debt: boolean;
  /** REFUND: los ingresos de este origen entran como reembolso de la categoría. */
  movement_kind: "REFUND" | null;
  third_party_id?: string | null;
}

/** Etiqueta del hogar para filtrar e informar (se pueden crear, renombrar y borrar). */
export interface Tag {
  id: string;
  household_id: string;
  name: string;
  color: string | null;
}

export const CHANNEL_LABEL: Record<string, string> = {
  ANDROID_NOTIFICATION: "Notificación",
  ANDROID_SMS: "SMS",
  GMAIL: "Correo",
  MANUAL: "Manual",
};

export interface LedgerRow {
  id: string;
  creditor_user_id: string;
  debtor_user_id: string;
  amount: number;
  kind: LedgerKind;
  transaction_id: string | null;
  /** Deuda que resuelve este asiento (pago o perdón). */
  resolves_id?: string | null;
  description: string | null;
  occurred_on: string;
  created_by: string;
  created_at: string;
}

export interface ManualAsset {
  id: string;
  owner_user_id: string;
  name: string;
  kind: "ASSET" | "LIABILITY";
  asset_type: "INVESTMENT" | "PROPERTY" | "VEHICLE" | "LOAN" | "MORTGAGE" | "OTHER";
  value: number;
  visibility: "PUBLIC" | "PRIVATE";
}

/** Compra del extracto de una tarjeta que no se registra como movimiento (solo para proyectar cuotas). */
export interface CardStatementItem {
  id: string;
  account_id: string;
  description: string;
  purchase_date: string;
  amount: number;
  installments: number;
  paid_installments: number;
  remaining_balance: number;
  rate_ea: number | null;
}

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  DEPOSIT: "Cuenta de ahorros o corriente",
  WALLET: "Billetera digital",
  CASH: "Efectivo",
  CREDIT_CARD: "Tarjeta de crédito",
  LOAN: "Préstamo (me deben pagar o debo a alguien)",
  CREDIT: "Crédito con cuotas (hipoteca, libre inversión)",
};

export const VISIBILITY_LABEL: Record<Visibility, string> = {
  PUBLIC: "Visible: ve la cuenta y su saldo",
  BALANCE_ONLY: "Solo saldo",
  PRIVATE: "Privada: no ve nada",
};

export const RESPONSIBILITY_LABEL: Record<Responsibility, string> = {
  MEMBER_A_100: "100 % de una persona",
  MEMBER_B_100: "100 % de una persona",
  FIXED_AMOUNTS: "Compartida con montos fijos",
  PRIVATE: "Personal (privada)",
};

export const ASSET_TYPE_LABEL: Record<ManualAsset["asset_type"], string> = {
  INVESTMENT: "Inversión",
  PROPERTY: "Inmueble",
  VEHICLE: "Vehículo",
  LOAN: "Crédito",
  MORTGAGE: "Hipoteca",
  OTHER: "Otro",
};

export interface BudgetPlan {
  id: string;
  scope: Space;
  owner_user_id: string;
  name: string;
  icon: string | null;
  /** PERIOD: se repite cada periodo del hogar · RANGE: un rango fijo de fechas. */
  periodicity: "PERIOD" | "RANGE";
  amount: number;
  start_date: string;
  end_date: string | null;
  alert_pct: number;
  status: "ACTIVE" | "PAUSED" | "CLOSED";
  /** Personal: su dueño lo comparte con la pareja (ve el límite y el avance, no los movimientos). */
  shared_with_partner: boolean;
}

export interface BudgetPlanCategory {
  plan_id: string;
  category_id: string;
  /** Límite propio de la categoría dentro del presupuesto (opcional). */
  amount: number | null;
}

export interface ScheduledPayment {
  id: string;
  scope: Space;
  owner_user_id: string;
  name: string;
  kind: "EXPENSE" | "DEBT_PAYMENT";
  amount: number;
  category_id: string | null;
  responsible_user_id: string | null;
  frequency: "ONCE" | "MONTHLY";
  due_date: string | null;
  day_of_month: number | null;
  start_date: string;
  end_date: string | null;
  active: boolean;
}

export interface SavingsGoal {
  id: string;
  scope: Space;
  owner_user_id: string;
  name: string;
  icon: string | null;
  target_amount: number;
  target_date: string | null;
  planned_amount: number | null;
  account_id: string | null;
  status: "ACTIVE" | "DONE" | "ARCHIVED";
  created_at: string;
}

export interface SavingsContribution {
  id: string;
  goal_id: string;
  user_id: string;
  amount: number;
  occurred_on: string;
  note: string | null;
  created_at: string;
}
