import { describe, expect, it } from "vitest";
import { heldForThirdParty, suggestThirdParty, thirdPartyBalance } from "@/lib/finance/thirdParty";
import { computeSafeToSpend } from "@/lib/finance/safeToSpend";
import { monthlyTrend, spendingByCategory } from "@/lib/finance/reports";
import type { Transaction } from "@/lib/types";

const A = "user-a";
const tx = (id: string, kind: Transaction["kind"], amount: number, extra: Partial<Transaction> = {}): Transaction => ({
  id, kind, status: "CONFIRMED", occurred_on: "2026-10-10", amount, description: null, merchant: null,
  account_id: "ahorros", to_account_id: null, payer_user_id: A, counterparty_user_id: null, is_shared: false,
  source: "MANUAL", tags: [], created_by: A, created_at: "", scope: "PERSONAL", creates_debt: true, splits: [], ...extra,
});

describe("Plata de un tercero", () => {
  const paid = tx("p", "EXPENSE", 1_043_000, { third_party_id: "alv", splits: [{ id: "s", transaction_id: "p", amount: 1_043_000, category_id: null, responsible_user_id: A } as never] });
  const received = tx("r", "INCOME", 1_043_000, { third_party_id: "alv" });
  const salary = tx("w", "INCOME", 5_000_000);

  it("recibido sin pagar se aparta; pagado sin reembolso no suma", () => {
    expect(thirdPartyBalance([received], A)).toBe(1_043_000);
    expect(heldForThirdParty([received], A)).toBe(1_043_000);
    expect(thirdPartyBalance([paid], A)).toBe(-1_043_000);
    expect(heldForThirdParty([paid], A)).toBe(0);
    expect(thirdPartyBalance([paid, received, salary], A)).toBe(0);
  });

  it("el Saldo Seguro resta lo que es del tercero", () => {
    const r = computeSafeToSpend({ realBalance: 3_000_000, householdObligationsPending: 0, scheduledSavingsPending: 0, creditCardDebt: 0, owedToPartner: 0, heldForThirdParty: 1_043_000 });
    expect(r.total).toBe(1_957_000);
  });

  it("no cuenta en informes", () => {
    const period = { start: "2026-10-01", end: "2026-10-31" };
    expect(spendingByCategory([paid], [], period)).toEqual([]);
    expect(monthlyTrend([paid, received, salary], ["2026-10"])[0]).toEqual({ month: "2026-10", income: 5_000_000, expense: 0 });
  });

  it("sugiere el tercero por comercio o remitente recordado", () => {
    const mem = [{ identifier_type: "MERCHANT" as const, identifier: "banco davivienda s a zona pa", third_party_id: "alv" }];
    expect(suggestThirdParty({ merchant_norm: "banco davivienda s a zona pa", ingest_identifiers: [] }, mem)).toBe("alv");
    expect(suggestThirdParty({ merchant_norm: "exito", ingest_identifiers: [] }, mem)).toBeNull();
  });
});

describe("Plata de un tercero en el inicio", async () => {
  const { cashFlow, netWorth, safeToSpendFor } = await import("@/lib/finance/derive");
  const { DEFAULT_PERIOD_SETTINGS, periodFor } = await import("@/lib/finance/periods");
  const me = { id: "m1", household_id: "h", user_id: A, slot: "A", display_name: "Ana", color: "#000", avatar: null } as never;
  const base = {
    me, partner: null, settings: DEFAULT_PERIOD_SETTINGS, accounts: [], balances: {}, categories: [], limits: [], budgets: [],
    transactions: [] as Transaction[], ledger: [], spending: [], assets: [],
  } as never as Parameters<typeof cashFlow>[0];
  const withTp = { ...base, transactions: [tx("r", "INCOME", 1_000_000, { third_party_id: "alv" })] };
  const period = periodFor(DEFAULT_PERIOD_SETTINGS, "2026-10-15");

  it("no cuenta en el flujo, se aparta del Saldo Seguro y el patrimonio lo compensa", () => {
    expect(cashFlow(withTp, period, "me").income).toBe(0);
    expect(safeToSpendFor(withTp, period).total).toBe(safeToSpendFor(base, period).total - 1_000_000);
    expect(netWorth(withTp, "me").liabilities).toBe(1_000_000);
  });
});
