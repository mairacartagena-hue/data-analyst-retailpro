import { describe, expect, it } from "vitest";
import { accountStatement, gmfEstimate, inCloseWindow, monthRange, shiftMonth, suggestedCloseMonth } from "@/lib/finance/reconcile";
import type { Account, Transaction } from "@/lib/types";

const acc: Account = {
  id: "bc", household_id: "h", owner_user_id: "a", name: "Bancolombia", kind: "DEPOSIT", institution: "Bancolombia", last4: "2505",
  visibility: "PRIVATE", reveal_in_shared: false, opening_balance: 2_365_000, opening_at: "2026-10-24T06:00:00Z",
  credit_limit: null, statement_day: null, due_day: null, archived: false,
};
const tx = (p: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36), kind: "EXPENSE", status: "CONFIRMED", occurred_on: "2026-10-24", amount: 0, description: null,
  merchant: null, account_id: "bc", to_account_id: null, payer_user_id: "a", counterparty_user_id: null, is_shared: false,
  source: "MANUAL", tags: [], created_by: "a", created_at: "", splits: [], ...p,
});

describe("cierre del mes", () => {
  it("rangos de mes", () => {
    expect(monthRange("2026-02")).toEqual({ month: "2026-02", start: "2026-02-01", end: "2026-02-28" });
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("los movimientos anteriores al saldo inicial no lo vuelven a restar", () => {
    const txs = [
      tx({ amount: 838_058, occurred_on: "2026-10-23", occurred_at: "2026-10-23T15:51:02Z", source: "GMAIL" }), // antes de crear la cuenta
      tx({ amount: 200_000, occurred_on: "2026-10-24" }), // manual, después
      tx({ kind: "INCOME", amount: 100_000, occurred_on: "2026-10-25", occurred_at: "2026-10-25T18:00:00Z" }),
      tx({ kind: "TRANSFER", amount: 50_000, account_id: "nequi", to_account_id: "bc", occurred_on: "2026-10-26" }),
      tx({ amount: 999, occurred_on: "2026-11-02" }), // otro mes
    ];
    const st = accountStatement(acc, txs, monthRange("2026-10"));
    expect(st.opening).toBe(2_365_000);
    expect(st.inflow).toBe(150_000);
    expect(st.outflow).toBe(200_000);
    expect(st.closing).toBe(2_315_000);
    expect(st.items).toHaveLength(3);
  });

  it("el saldo inicial del mes siguiente arrastra lo del mes anterior", () => {
    const st = accountStatement(acc, [tx({ amount: 200_000, occurred_on: "2026-10-24" })], monthRange("2026-11"));
    expect(st.opening).toBe(2_165_000);
    expect(st.items).toHaveLength(0);
  });

  it("4x1000: gravada, exenta (350 UVT) y bajo monto (65 UVT)", () => {
    const uvt = 52_374;
    expect(gmfEstimate(1_000_000, "TAXED", uvt)).toBe(4_000);
    expect(gmfEstimate(10_000_000, "EXEMPT_350", uvt)).toBe(0); // tope ≈ $18.330.900
    expect(gmfEstimate(20_000_000, "EXEMPT_350", uvt)).toBe(Math.round((20_000_000 - 350 * uvt) * 0.004));
    expect(gmfEstimate(4_000_000, "LOW_AMOUNT_65", uvt)).toBe(Math.round((4_000_000 - 65 * uvt) * 0.004));
  });

  it("el 4x1000 ya registrado no se vuelve a sumar a la base", () => {
    const st = accountStatement(acc, [
      tx({ amount: 1_000_000, occurred_on: "2026-10-25" }),
      tx({ amount: 4_000, occurred_on: "2026-10-31", tags: ["#gmf"] }),
    ], monthRange("2026-10"));
    expect(st.gmfBase).toBe(1_000_000);
    expect(st.gmfRecorded).toBe(4_000);
  });

  it("recordatorio: últimos 3 días y primeros 5", () => {
    expect(inCloseWindow("2026-10-29")).toBe(true);
    expect(inCloseWindow("2026-10-28")).toBe(false);
    expect(inCloseWindow("2026-11-05")).toBe(true);
    expect(suggestedCloseMonth("2026-11-03")).toBe("2026-10");
    expect(suggestedCloseMonth("2026-10-30")).toBe("2026-10");
  });
});
