import { describe, expect, it } from "vitest";
import { cashFlow, crossNet, limitsForScope, netWorth, responsibleOf, safeToSpendFor, type Snapshot } from "@/lib/finance/derive";
import { periodFor, DEFAULT_PERIOD_SETTINGS } from "@/lib/finance/periods";
import type { Account, Category, CategoryLimit, Member } from "@/lib/types";

const A = "user-a";
const B = "user-b";
const me: Member = { id: "m1", household_id: "h", user_id: A, slot: "A", display_name: "Ana", color: "#6b7a3a", avatar: null };
const partner: Member = { ...me, id: "m2", user_id: B, slot: "B", display_name: "Beto" };
const acc = (id: string, owner: string, kind: Account["kind"]): Account => ({
  id, household_id: "h", owner_user_id: owner, name: id, kind, institution: null, last4: null,
  visibility: "PRIVATE", reveal_in_shared: false, opening_balance: 0, credit_limit: null,
  statement_day: null, due_day: null, archived: false,
});
const cat = (id: string, responsibility: Category["responsibility"], extra: Partial<Category> = {}): Category => ({
  id, household_id: "h", name: id, icon: null, responsibility, owner_user_id: null,
  is_household_obligation: false, is_shared_progress: false, rollover_enabled: false, archived: false,
  created_at: "2026-01-01", ...extra,
});

const lim = (id: string, category_id: string, scope: CategoryLimit["scope"], extra: Partial<CategoryLimit> = {}): CategoryLimit => ({
  id, category_id, scope, owner_user_id: null, responsibility: null, is_household_obligation: false, rollover_enabled: false, shared_with_partner: false, ...extra,
});

const snapshot: Snapshot = {
  me, partner, settings: DEFAULT_PERIOD_SETTINGS,
  accounts: [acc("ahorros", A, "DEPOSIT"), acc("nequi", A, "WALLET"), acc("visa", A, "CREDIT_CARD"), acc("b-ahorros", B, "DEPOSIT")],
  balances: { ahorros: 2_000_000, nequi: 300_000, visa: -500_000, "b-ahorros": 1_000_000 },
  // Las categorías no deciden nada; los presupuestos sí (del hogar con responsable, o personales)
  categories: [cat("mercado", "FIXED_AMOUNTS"), cat("arriendo", "FIXED_AMOUNTS"), cat("internet", "FIXED_AMOUNTS"), cat("ropa", "FIXED_AMOUNTS")],
  limits: [
    lim("l-mercado", "mercado", "HOUSEHOLD", { responsibility: "MEMBER_A_100", is_household_obligation: true }),
    lim("l-arriendo", "arriendo", "HOUSEHOLD", { responsibility: "FIXED_AMOUNTS", is_household_obligation: true }),
    lim("l-ropa", "ropa", "PERSONAL", { owner_user_id: A }),
  ],
  budgets: [
    { id: "1", category_id: "mercado", limit_id: "l-mercado", valid_from: "2026-10-01", amount: 1_000_000, fixed_amount_a: null, fixed_amount_b: null },
    { id: "2", category_id: "arriendo", limit_id: "l-arriendo", valid_from: "2026-10-01", amount: 800_000, fixed_amount_a: 500_000, fixed_amount_b: 300_000 },
    { id: "3", category_id: "ropa", limit_id: "l-ropa", valid_from: "2026-10-01", amount: 200_000, fixed_amount_a: null, fixed_amount_b: null },
  ],
  transactions: [],
  ledger: [{ id: "l1", creditor_user_id: B, debtor_user_id: A, amount: 70_000, kind: "CROSS_PAYMENT", transaction_id: null, description: null, occurred_on: "2026-10-02", created_by: B, created_at: "" }],
  spending: [{ categoryId: "mercado", responsibleUserId: A, occurredOn: "2026-10-05", total: 400_000, scope: "HOUSEHOLD" }],
  assets: [{ id: "x", owner_user_id: A, name: "CDT", kind: "ASSET", asset_type: "INVESTMENT", value: 1_000_000, visibility: "PRIVATE" }],
};
const oct = periodFor(DEFAULT_PERIOD_SETTINGS, "2026-10-10");

describe("derivados del inicio", () => {
  it("Saldo Seguro completo de A", () => {
    const r = safeToSpendFor(snapshot, oct);
    expect(r.realBalance).toBe(2_300_000);
    expect(r.householdObligationsPending).toBe(600_000 + 500_000); // mercado + su parte del arriendo
    expect(r.creditCardDebt).toBe(500_000);
    expect(r.owedToPartner).toBe(70_000);
    expect(r.total).toBe(2_300_000 - 1_100_000 - 500_000 - 70_000);
  });

  it("cruce neto desde mi punto de vista", () => {
    expect(crossNet(snapshot)).toBe(-70_000);
  });

  it("patrimonio mío vs global", () => {
    expect(netWorth(snapshot, "me")).toEqual({ assets: 3_300_000, liabilities: 500_000, total: 2_800_000 });
    expect(netWorth(snapshot, "global").total).toBe(3_800_000);
  });

  it("presupuestos por vista", () => {
    expect(limitsForScope(snapshot, "me").map((l) => l.id)).toEqual(["l-mercado", "l-arriendo", "l-ropa"]);
    expect(limitsForScope(snapshot, "household").map((l) => l.id)).toEqual(["l-mercado", "l-arriendo"]);
  });

  it("flujo de caja vacío", () => {
    expect(cashFlow(snapshot, oct, "me")).toEqual({ income: 0, expense: 0, net: 0 });
  });
});

describe("responsable de la tarjeta o del crédito", () => {
  const withResponsible = (responsible: string | null): Snapshot => ({
    ...snapshot,
    accounts: snapshot.accounts.map((a) => (a.id === "visa" ? { ...a, responsible_user_id: responsible } : a)),
  });

  it("sin responsable, la deuda la aparta el dueño de la cuenta", () => {
    expect(responsibleOf(withResponsible(null).accounts[2])).toBe(A);
    expect(safeToSpendFor(withResponsible(null), oct).creditCardDebt).toBe(500_000);
  });

  it("con otro responsable, el dueño ya no la aparta y la aparta el responsable", () => {
    const s = withResponsible(B);
    expect(safeToSpendFor(s, oct).creditCardDebt).toBe(0);
    expect(safeToSpendFor({ ...s, me: partner, partner: me }, oct).creditCardDebt).toBe(500_000);
  });
});
