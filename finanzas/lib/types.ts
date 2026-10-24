// Filas de la base de datos (nombres tal como están en Supabase).
import type { Responsibility } from "@/lib/finance/budget";
import type { AccountKind } from "@/lib/finance/safeToSpend";
import type { LedgerKind, SplitOrigin } from "@/lib/finance/crossLedger";

export type Visibility = "PUBLIC" | "BALANCE_ONLY" | "PRIVATE";
export type TxKind = "EXPENSE" | "INCOME" | "TRANSFER" | "SETTLEMENT";

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
  visibility: Visibility;
  reveal_in_shared: boolean;
  opening_balance: number;
  credit_limit: number | null;
  statement_day: number | null;
  due_day: number | null;
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
}

export interface CategoryBudgetRow {
  id: string;
  category_id: string;
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
  source: string;
  tags: string[];
  created_by: string;
  created_at: string;
  occurred_at?: string | null;
  merchant_norm?: string | null;
  movement_type?: "PURCHASE" | "TRANSFER_OUT" | "TRANSFER_IN" | "WITHDRAWAL" | "CARD_PAYMENT" | "INCOME" | "OWN_TRANSFER" | null;
  card_last4?: string | null;
  suggested_category_id?: string | null;
  suggested_responsible_user_id?: string | null;
  suggested_to_account_id?: string | null;
  splits: Split[];
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

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  DEPOSIT: "Cuenta de ahorros o corriente",
  WALLET: "Billetera digital",
  CASH: "Efectivo",
  CREDIT_CARD: "Tarjeta de crédito",
};

export const VISIBILITY_LABEL: Record<Visibility, string> = {
  PUBLIC: "Pública: ve saldo y movimientos",
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
