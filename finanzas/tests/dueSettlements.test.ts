import { describe, expect, it } from "vitest";
import { dueBudgetAdjustments, dueDiffers, dueForPayment, dueOptions, settledAsPaid } from "@/lib/finance/dueSettlements";
import { creditReserve } from "@/lib/finance/credit";
import { statusesFor, type Snapshot } from "@/lib/finance/derive";
import { DEFAULT_PERIOD_SETTINGS, periodFor } from "@/lib/finance/periods";
import type { Account, DueSettlement, Member, Transaction } from "@/lib/types";

const A = "user-a";
const me: Member = { id: "m1", household_id: "h", user_id: A, slot: "A", display_name: "Ana", color: "#6b7a3a", avatar: null };
const hip = {
  id: "hip", household_id: "h", owner_user_id: A, name: "Hipoteca", kind: "CREDIT", institution: null, last4: null,
  visibility: "PRIVATE", reveal_in_shared: false, opening_balance: -100_000_000, credit_limit: null,
  statement_day: 20, due_day: 4, archived: false, budget_category_id: "cuota-hip", interest_rate_ea: 12, term_months: 120,
  opening_at: "2026-01-01",
} as unknown as Account;
const settle = (mode: DueSettlement["mode"], expected: number, paid: number, due = "2026-10-04"): DueSettlement => ({
  id: "s", household_id: "h", account_id: "hip", due_date: due, mode, expected, paid, payer_user_id: A,
});

const snap = (paid: number, settlements: DueSettlement[]): Snapshot => ({
  me, partner: null, settings: DEFAULT_PERIOD_SETTINGS, accounts: [hip], balances: { hip: -100_000_000 },
  categories: [], transactions: [], ledger: [], assets: [],
  limits: [{ id: "l-hip", category_id: "cuota-hip", scope: "HOUSEHOLD", owner_user_id: null, responsibility: "MEMBER_A_100", is_household_obligation: true, rollover_enabled: false, shared_with_partner: false }],
  budgets: [{ id: "1", category_id: "cuota-hip", limit_id: "l-hip", valid_from: "2026-01-01", amount: 2_000_000, fixed_amount_a: null, fixed_amount_b: null }],
  spending: [{ categoryId: "cuota-hip", responsibleUserId: A, occurredOn: "2026-10-03", total: paid, scope: "HOUSEHOLD" }],
  dueSettlements: settlements,
});
const oct = periodFor(DEFAULT_PERIOD_SETTINGS, "2026-10-10");

describe("vencimiento pagado con otro valor", () => {
  it("solo pregunta si la diferencia pasa de $1.000", () => {
    expect(dueDiffers(2_000_000, 2_000_800)).toBe(false);
    expect(dueDiffers(2_000_000, 1_800_000)).toBe(true);
  });

  it("opciones según se pagó menos o más", () => {
    expect(dueOptions(2_000_000, 1_800_000).map((o) => o.mode)).toEqual(["PARTIAL", "LOWER"]);
    expect(dueOptions(2_000_000, 2_500_000).map((o) => o.mode)).toEqual(["EXTRA_CAPITAL", "HIGHER"]);
    expect(settledAsPaid(settle("PARTIAL", 2_000_000, 1_800_000))).toBe(false);
    expect(settledAsPaid(settle("LOWER", 2_000_000, 1_800_000))).toBe(true);
  });

  it("fecha de pago de un pago: la del mes, o la del siguiente si ya pasó hace más de 10 días", () => {
    expect(dueForPayment(4, "2026-10-02")).toBe("2026-10-04");
    expect(dueForPayment(4, "2026-10-10")).toBe("2026-10-04");
    expect(dueForPayment(4, "2026-10-20")).toBe("2026-11-04");
    expect(dueForPayment(31, "2026-12-31")).toBe("2026-12-31");
  });

  it("la cuota era menor: el presupuesto baja a lo pagado y queda cumplido", () => {
    const st = statusesFor(snap(1_800_000, [settle("LOWER", 2_000_000, 1_800_000)]), oct).get("l-hip")!;
    expect(st.totalAvailable).toBe(1_800_000);
    expect(st.allocations[0].remaining).toBe(0);
  });

  it("abono parcial: el presupuesto no cambia y falta el resto", () => {
    const st = statusesFor(snap(1_800_000, [settle("PARTIAL", 2_000_000, 1_800_000)]), oct).get("l-hip")!;
    expect(st.allocations[0].remaining).toBe(200_000);
  });

  it("abono a capital: el presupuesto solo cuenta la cuota", () => {
    const st = statusesFor(snap(2_500_000, [settle("EXTRA_CAPITAL", 2_000_000, 2_500_000)]), oct).get("l-hip")!;
    expect(st.totalSpent).toBe(2_000_000);
    expect(st.allocations[0].remaining).toBe(0);
  });

  it("la cuota era mayor: el presupuesto sube a lo pagado", () => {
    const st = statusesFor(snap(2_500_000, [settle("HIGHER", 2_000_000, 2_500_000)]), oct).get("l-hip")!;
    expect(st.totalAvailable).toBe(2_500_000);
    expect(st.totalSpent).toBe(2_500_000);
    expect(st.level).toBe("over"); // 100 %: cumplido
  });

  it("los ajustes solo aplican a créditos con presupuesto y a vencimientos del periodo", () => {
    const adj = dueBudgetAdjustments([settle("LOWER", 2_000_000, 1_800_000, "2026-12-04")], [hip], oct);
    expect(adj.budget).toEqual([]);
    expect(dueBudgetAdjustments([settle("LOWER", 2_000_000, 1_800_000)], [{ id: "hip", budget_category_id: null }], oct).budget).toEqual([]);
  });

  it("reserva del crédito: un abono parcial deja el resto; la cuota menor la deja pagada", () => {
    const credit = { ...hip, interest_rate_ea: 12, term_months: 120, opening_at: "2026-01-01", monthly_costs: 0 } as Account & { term_months: number };
    const period = { start: "2026-10-21", end: "2026-11-20" };
    const today = "2026-10-25";
    const abono = { id: "t", kind: "TRANSFER", status: "CONFIRMED", occurred_on: "2026-10-23", amount: 300_000, account_id: "x", to_account_id: "hip", splits: [] } as unknown as Transaction;
    const full = creditReserve(credit, -100_000_000, [], period, today);
    const partial = creditReserve(credit, -100_000_000, [abono], period, today);
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(full);
    expect(creditReserve(credit, -100_000_000, [abono], period, today, [settle("LOWER", full, 300_000, "2026-11-04")])).toBe(0);
    expect(creditReserve(credit, -100_000_000, [abono], period, today, [settle("PARTIAL", full, 300_000, "2026-11-04")])).toBe(partial);
  });
});
