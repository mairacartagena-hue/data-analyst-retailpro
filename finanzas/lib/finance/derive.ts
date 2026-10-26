// Une los datos que llegan de Supabase con las funciones puras de presupuesto, cruce y Saldo Seguro.

import type {
  Account, CardStatementItem, Category, CategoryBudgetRow, CategoryLimit, LedgerRow, ManualAsset, Member, PeriodSettingsRow, SavingsContribution, SavingsGoal, Transaction,
} from "@/lib/types";
import { categoryStatus, pendingObligationsFor, type BudgetCategory, type CategoryStatus, type Members, type SpendingRow } from "./budget";
import { netFor, owedToPartner, type LedgerEntry } from "./crossLedger";
import { DEFAULT_PERIOD_SETTINGS, isWithin, type Period, type PeriodSettings } from "./periods";
import { computeSafeToSpend, realBalanceOf, type SafeToSpendResult } from "./safeToSpend";
import { cardDue } from "./installments";
import { creditReserve } from "./credit";
import { todayBogota } from "./periods";
import { pendingSavingsFor } from "./goals";
import { consumptionSign } from "./spaces";

export interface Snapshot {
  me: Member;
  partner: Member | null;
  settings: PeriodSettings;
  accounts: Account[];
  balances: Record<string, number>;
  categories: Category[];
  budgets: CategoryBudgetRow[];
  transactions: Transaction[];
  /** Movimientos con las compras a cuotas repartidas mes a mes (ver installments.ts). */
  consumption?: Transaction[];
  ledger: LedgerRow[];
  spending: SpendingRow[];
  assets: ManualAsset[];
  /** Presupuestos de categoría (del hogar o personales). */
  limits: CategoryLimit[];
  goals?: SavingsGoal[];
  contributions?: SavingsContribution[];
  /** Compras a cuotas de los extractos de las tarjetas. */
  cardItems?: CardStatementItem[];
}

export function toPeriodSettings(row: PeriodSettingsRow | null | undefined): PeriodSettings {
  if (!row) return DEFAULT_PERIOD_SETTINGS;
  return {
    cycle: row.cycle,
    monthlyStartDay: row.monthly_start_day,
    biweeklyFirstDay: row.biweekly_first_day,
    biweeklySecondDay: row.biweekly_second_day,
  };
}

export function membersOf(me: Member, partner: Member | null): Members {
  const all = [me, partner].filter(Boolean) as Member[];
  return {
    a: all.find((m) => m.slot === "A")?.user_id ?? null,
    b: all.find((m) => m.slot === "B")?.user_id ?? null,
  };
}

/** Presupuestos de categoría en el formato del cálculo (el id es el del presupuesto, no el de la categoría). */
export function toBudgetCategories(limits: CategoryLimit[], budgets: CategoryBudgetRow[]): BudgetCategory[] {
  return limits.map((l) => ({
    id: l.id,
    // Un presupuesto personal lo asume su dueño
    responsibility: l.scope === "PERSONAL" ? "PRIVATE" : (l.responsibility ?? "FIXED_AMOUNTS"),
    ownerUserId: l.owner_user_id,
    rolloverEnabled: l.rollover_enabled,
    isHouseholdObligation: l.is_household_obligation,
    budgets: budgets
      .filter((b) => b.limit_id === l.id)
      .map((b) => ({
        validFrom: b.valid_from,
        amount: Number(b.amount),
        fixedAmountA: b.fixed_amount_a == null ? null : Number(b.fixed_amount_a),
        fixedAmountB: b.fixed_amount_b == null ? null : Number(b.fixed_amount_b),
      })),
  }));
}

/**
 * Ejecutado que cuenta para cada presupuesto de categoría:
 *  · la categoría y sus subcategorías
 *  · del hogar: solo movimientos del hogar (cuadra en los dos celulares y lo personal no se filtra)
 *  · personal: solo movimientos personales a cargo de su dueño
 */
export function spendingByLimit(s: Pick<Snapshot, "categories" | "spending" | "limits">): Map<string, SpendingRow[]> {
  const out = new Map<string, SpendingRow[]>();
  const parentOf = new Map(s.categories.map((c) => [c.id, c.parent_id ?? null]));
  const byCategory = new Map<string, CategoryLimit[]>();
  for (const l of s.limits) byCategory.set(l.category_id, [...(byCategory.get(l.category_id) ?? []), l]);
  for (const r of s.spending) {
    const parent = parentOf.get(r.categoryId);
    const candidates = [...(byCategory.get(r.categoryId) ?? []), ...(parent ? byCategory.get(parent) ?? [] : [])];
    for (const l of candidates) {
      const counts = l.scope === "HOUSEHOLD"
        ? r.scope !== "PERSONAL"
        : r.scope === "PERSONAL" && r.responsibleUserId === l.owner_user_id;
      if (!counts) continue;
      out.set(l.id, [...(out.get(l.id) ?? []), { ...r, categoryId: l.id }]);
    }
  }
  return out;
}

/** Estado de cada presupuesto de categoría en el periodo (por id de presupuesto). */
export function statusesFor(s: Snapshot, period: Period): Map<string, CategoryStatus> {
  const members = membersOf(s.me, s.partner);
  const rows = spendingByLimit(s);
  const out = new Map<string, CategoryStatus>();
  for (const c of toBudgetCategories(s.limits, s.budgets)) {
    out.set(c.id, categoryStatus(c, period, rows.get(c.id) ?? [], s.settings, members));
  }
  return out;
}

/** Quién asume un presupuesto de categoría (null en montos fijos: los dos). */
export function limitResponsible(l: CategoryLimit, me: Member, partner: Member | null): string | null {
  if (l.scope === "PERSONAL") return l.owner_user_id;
  const bySlot = (slot: "A" | "B") => [me, partner].find((m) => m?.slot === slot)?.user_id ?? null;
  if (l.responsibility === "MEMBER_A_100") return bySlot("A");
  if (l.responsibility === "MEMBER_B_100") return bySlot("B");
  return null;
}

export function ledgerEntries(rows: LedgerRow[]): LedgerEntry[] {
  return rows.map((r) => ({
    creditorUserId: r.creditor_user_id,
    debtorUserId: r.debtor_user_id,
    amount: Number(r.amount),
    kind: r.kind,
  }));
}

export function balanceAccounts(s: Snapshot) {
  return s.accounts
    .filter((a) => s.balances[a.id] !== undefined)
    .map((a) => ({ ownerUserId: a.owner_user_id, kind: a.kind, balance: s.balances[a.id] }));
}

export function safeToSpendFor(s: Snapshot, period: Period, statuses = statusesFor(s, period)): SafeToSpendResult {
  const me = s.me.user_id;
  const accounts = balanceAccounts(s);
  return computeSafeToSpend({
    realBalance: realBalanceOf(me, accounts),
    householdObligationsPending: pendingObligationsFor(me, toBudgetCategories(s.limits, s.budgets), [...statuses.values()]),
    scheduledSavingsPending: pendingSavingsFor(me, s.goals ?? [], s.contributions ?? [], period),
    // Tarjetas: solo lo que toca pagar en el periodo (las cuotas que vencen después no se apartan).
    // Préstamos: se aparta todo lo que se debe. Créditos: solo la cuota del próximo pago.
    creditCardDebt: s.accounts
      .filter((a) => a.owner_user_id === me && (a.kind === "CREDIT_CARD" || a.kind === "LOAN" || a.kind === "CREDIT") && s.balances[a.id] !== undefined)
      .reduce((acc, a) => acc + (a.kind === "LOAN"
        ? Math.max(0, -s.balances[a.id])
        : a.kind === "CREDIT"
          ? creditReserve(a, s.balances[a.id], s.transactions, period, todayBogota())
          : cardDue(a, s.balances[a.id], s.transactions, period, s.cardItems ?? []).due), 0),
    owedToPartner: owedToPartner(me, ledgerEntries(s.ledger)),
  });
}

export function crossNet(s: Snapshot): number {
  return netFor(s.me.user_id, ledgerEntries(s.ledger));
}

export type Scope = "me" | "household" | "global";

export interface NetWorth {
  assets: number;
  liabilities: number;
  total: number;
}

/**
 * Patrimonio neto: cuentas (con saldo visible) y activos/pasivos manuales.
 * "me" solo lo mío; "household"/"global" incluye lo que la pareja deja ver.
 */
export function netWorth(s: Snapshot, scope: Scope): NetWorth {
  const mine = (owner: string) => scope === "me" ? owner === s.me.user_id : true;
  let assets = 0;
  let liabilities = 0;
  for (const a of s.accounts) {
    const bal = s.balances[a.id];
    if (bal === undefined || !mine(a.owner_user_id)) continue;
    if (bal >= 0) assets += bal;
    else liabilities += -bal;
  }
  for (const m of s.assets) {
    if (!mine(m.owner_user_id)) continue;
    if (m.kind === "ASSET") assets += Number(m.value);
    else liabilities += Number(m.value);
  }
  return { assets, liabilities, total: assets - liabilities };
}

export interface CashFlow {
  income: number;
  expense: number;
  net: number;
}

/**
 * Flujo de caja del periodo. "me": lo que entró y salió de mis cuentas. "household": movimientos del hogar.
 * Ingresos y reembolsos entran; gastos y pagos de deuda salen. Transferencias propias, liquidaciones y
 * ajustes no cuentan (no son ingresos ni gastos nuevos).
 */
export function cashFlow(s: Snapshot, period: Period, scope: Scope): CashFlow {
  let income = 0;
  let expense = 0;
  // Una compra a cuotas sale de la caja a medida que se paga: cada cuota en su mes
  for (const t of s.consumption ?? s.transactions) {
    if (!isWithin(t.occurred_on, period)) continue;
    if (scope === "me" && t.payer_user_id !== s.me.user_id) continue;
    if (scope === "household" && t.scope !== "HOUSEHOLD") continue;
    const amount = Number(t.amount);
    if (t.kind === "INCOME" || t.kind === "REFUND") income += amount;
    else if (consumptionSign(t.kind) > 0) expense += amount;
  }
  return { income, expense, net: income - expense };
}


/** Presupuestos de categoría que se muestran en cada vista del inicio. */
export function limitsForScope(s: Snapshot, scope: Scope): CategoryLimit[] {
  const me = s.me.user_id;
  const active = new Set(s.categories.filter((c) => !c.archived).map((c) => c.id));
  const visible = s.limits.filter((l) => active.has(l.category_id) && s.budgets.some((b) => b.limit_id === l.id));
  if (scope === "global") return visible;
  if (scope === "household") return visible.filter((l) => l.scope === "HOUSEHOLD");
  // Mis finanzas: lo que me toca (los personales de la pareja, aunque los comparta, van en la vista global)
  return visible.filter((l) => {
    if (l.scope === "PERSONAL") return l.owner_user_id === me;
    if (l.responsibility === "FIXED_AMOUNTS") return true;
    return (l.responsibility === "MEMBER_A_100" ? "A" : "B") === s.me.slot;
  });
}
