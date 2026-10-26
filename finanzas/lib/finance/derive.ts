// Une los datos que llegan de Supabase con las funciones puras de presupuesto, cruce y Saldo Seguro.

import type {
  Account, Category, CategoryBudgetRow, LedgerRow, ManualAsset, Member, PeriodSettingsRow, Transaction,
} from "@/lib/types";
import { categoryStatus, pendingObligationsFor, type BudgetCategory, type CategoryStatus, type Members, type SpendingRow } from "./budget";
import { netFor, owedToPartner, type LedgerEntry } from "./crossLedger";
import { DEFAULT_PERIOD_SETTINGS, isWithin, type Period, type PeriodSettings } from "./periods";
import { heldForThirdParty, thirdPartyBalance } from "./thirdParty";
import { computeSafeToSpend, creditCardDebtOf, realBalanceOf, type SafeToSpendResult } from "./safeToSpend";

export interface Snapshot {
  me: Member;
  partner: Member | null;
  settings: PeriodSettings;
  accounts: Account[];
  balances: Record<string, number>;
  categories: Category[];
  budgets: CategoryBudgetRow[];
  transactions: Transaction[];
  ledger: LedgerRow[];
  spending: SpendingRow[];
  assets: ManualAsset[];
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

export function toBudgetCategories(categories: Category[], budgets: CategoryBudgetRow[]): BudgetCategory[] {
  return categories.map((c) => ({
    id: c.id,
    responsibility: c.responsibility,
    ownerUserId: c.owner_user_id,
    rolloverEnabled: c.rollover_enabled,
    isHouseholdObligation: c.is_household_obligation,
    budgets: budgets
      .filter((b) => b.category_id === c.id)
      .map((b) => ({
        validFrom: b.valid_from,
        amount: Number(b.amount),
        fixedAmountA: b.fixed_amount_a == null ? null : Number(b.fixed_amount_a),
        fixedAmountB: b.fixed_amount_b == null ? null : Number(b.fixed_amount_b),
      })),
  }));
}

/** Categorías cuyo presupuesto puedo ver (la RLS solo me entrega esas versiones). */
export function hasVisibleBudget(categoryId: string, budgets: CategoryBudgetRow[]): boolean {
  return budgets.some((b) => b.category_id === categoryId);
}

export function statusesFor(s: Snapshot, period: Period): Map<string, CategoryStatus> {
  const members = membersOf(s.me, s.partner);
  const out = new Map<string, CategoryStatus>();
  for (const c of toBudgetCategories(s.categories, s.budgets)) {
    out.set(c.id, categoryStatus(c, period, s.spending, s.settings, members));
  }
  return out;
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
    householdObligationsPending: pendingObligationsFor(me, toBudgetCategories(s.categories, s.budgets), [...statuses.values()]),
    // Las metas de ahorro llegan en la Fase 4; mientras tanto no hay ahorros programados.
    scheduledSavingsPending: 0,
    creditCardDebt: creditCardDebtOf(me, accounts),
    owedToPartner: owedToPartner(me, ledgerEntries(s.ledger)),
    heldForThirdParty: heldForThirdParty(s.transactions, me),
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
  // Plata de terceros: lo recibido sin pagar es de ellos (pasivo); lo pagado sin reembolso, cuenta por cobrar (activo).
  const payers = new Set(s.transactions.filter((t) => t.third_party_id).map((t) => t.payer_user_id));
  for (const payer of payers) {
    if (!mine(payer)) continue;
    const bal = thirdPartyBalance(s.transactions, payer);
    if (bal > 0) liabilities += bal;
    else assets += -bal;
  }
  return { assets, liabilities, total: assets - liabilities };
}

export interface CashFlow {
  income: number;
  expense: number;
  net: number;
}

/** Flujo de caja del periodo. "me": lo que entró y salió de mis cuentas. "household": ingresos compartidos y gastos del hogar. */
export function cashFlow(s: Snapshot, period: Period, scope: Scope): CashFlow {
  const privateCats = new Set(s.categories.filter((c) => c.responsibility === "PRIVATE").map((c) => c.id));
  let income = 0;
  let expense = 0;
  for (const t of s.transactions) {
    if (!isWithin(t.occurred_on, period) || t.third_party_id) continue;
    const amount = Number(t.amount);
    if (scope === "me") {
      if (t.payer_user_id !== s.me.user_id) continue;
      if (t.kind === "INCOME") income += amount;
      if (t.kind === "EXPENSE") expense += amount;
    } else if (scope === "household") {
      if (t.kind === "INCOME" && t.is_shared) income += amount;
      if (t.kind === "EXPENSE") {
        expense += t.splits
          .filter((sp) => sp.category_id && !privateCats.has(sp.category_id))
          .reduce((acc, sp) => acc + Number(sp.amount), 0);
      }
    } else {
      if (t.kind === "INCOME") income += amount;
      if (t.kind === "EXPENSE") expense += amount;
    }
  }
  return { income, expense, net: income - expense };
}

/** Categorías que se muestran en cada vista del inicio. */
export function categoriesForScope(s: Snapshot, scope: Scope): Category[] {
  const me = s.me.user_id;
  const visible = s.categories.filter((c) => !c.archived && hasVisibleBudget(c.id, s.budgets));
  if (scope === "global") return visible;
  if (scope === "household") return visible.filter((c) => c.responsibility !== "PRIVATE");
  return visible.filter((c) => {
    if (c.responsibility === "PRIVATE") return c.owner_user_id === me;
    if (c.responsibility === "FIXED_AMOUNTS") return true;
    return (c.responsibility === "MEMBER_A_100" ? "A" : "B") === s.me.slot;
  });
}
