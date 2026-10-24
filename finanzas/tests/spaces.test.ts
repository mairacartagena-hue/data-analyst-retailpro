import { describe, expect, it } from "vitest";
import { cashFlow, statusesFor, type Snapshot } from "@/lib/finance/derive";
import { DEFAULT_PERIOD_SETTINGS, periodFor } from "@/lib/finance/periods";
import { accountSign, categoryPath, categoryTree, spendingRows, withDescendants } from "@/lib/finance/spaces";
import { effectOn } from "@/lib/finance/reconcile";
import type { Category, CategoryLimit, Member, Transaction } from "@/lib/types";

const A = "may";
const B = "brei";
const me: Member = { id: "1", household_id: "h", user_id: A, slot: "A", display_name: "May", color: "#000000", avatar: null };
const partner: Member = { ...me, id: "2", user_id: B, slot: "B", display_name: "Brei" };
const cat = (id: string, p: Partial<Category> = {}): Category => ({
  id, household_id: "h", name: id, icon: null, responsibility: "FIXED_AMOUNTS", owner_user_id: null,
  is_household_obligation: false, is_shared_progress: true, rollover_enabled: false, archived: false, created_at: "", ...p,
});
const split = (amount: number, category_id: string, responsible_user_id = A) =>
  ({ id: Math.random().toString(36), transaction_id: "t", amount, category_id, responsible_user_id, origin: "NORMAL" as const, note: null });
const tx = (p: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36), kind: "EXPENSE", status: "CONFIRMED", occurred_on: "2026-10-10", amount: 0, description: null,
  merchant: null, account_id: "x", to_account_id: null, payer_user_id: A, counterparty_user_id: null, is_shared: false,
  source: "MANUAL", tags: [], created_by: A, created_at: "", splits: [], scope: "HOUSEHOLD", creates_debt: true, ...p,
});
const oct = periodFor(DEFAULT_PERIOD_SETTINGS, "2026-10-10");

// Las categorías solo dicen en qué se gastó; los presupuestos dicen si es del hogar o personal y quién lo asume
const categories = [cat("vivienda"), cat("hipoteca", { parent_id: "vivienda" }), cat("remodelacion", { parent_id: "vivienda" }), cat("restaurantes"), cat("ropa")];
const lim = (id: string, category_id: string, scope: CategoryLimit["scope"], extra: Partial<CategoryLimit> = {}): CategoryLimit => ({
  id, category_id, scope, owner_user_id: null, responsibility: null, is_household_obligation: false, rollover_enabled: false, ...extra,
});
const limits = [
  lim("vivienda", "vivienda", "HOUSEHOLD", { responsibility: "FIXED_AMOUNTS" }),
  lim("hipoteca", "hipoteca", "HOUSEHOLD", { responsibility: "MEMBER_A_100" }),
  lim("restaurantes", "restaurantes", "HOUSEHOLD", { responsibility: "FIXED_AMOUNTS" }),
  lim("mis-restaurantes", "restaurantes", "PERSONAL", { owner_user_id: A }),
  lim("ropa", "ropa", "PERSONAL", { owner_user_id: A }),
];
const budgets = limits.map((l, i) => ({
  id: String(i), category_id: l.category_id, limit_id: l.id, valid_from: "2026-01-01", amount: 5_000_000,
  fixed_amount_a: l.responsibility === "FIXED_AMOUNTS" ? 2_500_000 : null,
  fixed_amount_b: l.responsibility === "FIXED_AMOUNTS" ? 2_500_000 : null,
}));

const transactions = [
  tx({ kind: "DEBT_PAYMENT", amount: 2_000_000, splits: [split(2_000_000, "hipoteca")] }),
  tx({ kind: "DEBT_PAYMENT", amount: 800_000, payer_user_id: B, created_by: B, splits: [split(800_000, "remodelacion", B)] }),
  tx({ amount: 90_000, splits: [split(90_000, "restaurantes")] }),
  tx({ amount: 40_000, scope: "PERSONAL", splits: [split(40_000, "restaurantes")] }), // personal en una categoría del hogar
  tx({ kind: "REFUND", amount: 10_000, splits: [split(10_000, "restaurantes")] }),
  tx({ amount: 150_000, scope: "PERSONAL", splits: [split(150_000, "ropa")] }),
  tx({ kind: "INCOME", amount: 6_000_000, scope: "PERSONAL" }),
  tx({ kind: "INCOME", amount: 1_000_000 }),
  tx({ kind: "TRANSFER", amount: 500_000, to_account_id: "y", scope: "PERSONAL" }),
];

const snap: Snapshot = {
  me, partner, settings: DEFAULT_PERIOD_SETTINGS, accounts: [], balances: {}, categories, limits, budgets, transactions,
  ledger: [], spending: spendingRows(transactions), assets: [],
};

describe("hogar y personal", () => {
  it("principal suma subcategorías; el presupuesto del hogar no suma lo personal y el personal no suma lo del hogar; reembolsos restan", () => {
    const st = statusesFor(snap, oct);
    expect(st.get("vivienda")?.totalSpent).toBe(2_800_000);
    expect(st.get("vivienda")?.spentByUser).toEqual({ [A]: 2_000_000, [B]: 800_000 });
    expect(st.get("hipoteca")?.totalSpent).toBe(2_000_000);
    expect(st.get("restaurantes")?.totalSpent).toBe(80_000);
    expect(st.get("mis-restaurantes")?.totalSpent).toBe(40_000);
    expect(st.get("ropa")?.totalSpent).toBe(150_000);
  });

  it("flujo del hogar solo con movimientos del hogar; transferencias no cuentan", () => {
    expect(cashFlow(snap, oct, "household")).toEqual({ income: 1_000_000 + 10_000, expense: 2_000_000 + 800_000 + 90_000, net: 1_010_000 - 2_890_000 });
    expect(cashFlow(snap, oct, "me").income).toBe(7_000_000 + 10_000);
    expect(cashFlow(snap, oct, "me").expense).toBe(2_000_000 + 90_000 + 40_000 + 150_000);
  });

  it("árbol de categorías y rutas", () => {
    const tree = categoryTree(categories);
    expect(tree.map((n) => n.category.id)).toEqual(["restaurantes", "ropa", "vivienda"]);
    expect(tree[2].children.map((c) => c.id)).toEqual(["hipoteca", "remodelacion"]);
    expect(categoryPath(categories, "hipoteca")).toBe("vivienda › hipoteca");
    expect([...withDescendants(categories, ["vivienda"])].sort()).toEqual(["hipoteca", "remodelacion", "vivienda"]);
  });

  it("efecto sobre la cuenta: reembolsos y ajustes", () => {
    expect(accountSign({ kind: "REFUND", direction: null })).toBe(1);
    expect(accountSign({ kind: "ADJUSTMENT", direction: "IN" })).toBe(1);
    expect(accountSign({ kind: "ADJUSTMENT", direction: "OUT" })).toBe(-1);
    expect(accountSign({ kind: "DEBT_PAYMENT", direction: null })).toBe(-1);
    expect(effectOn("x", tx({ kind: "REFUND", amount: 5 }))).toBe(5);
    expect(effectOn("x", tx({ kind: "ADJUSTMENT", amount: 5, direction: "OUT" }))).toBe(-5);
  });
});
