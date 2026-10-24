import { describe, expect, it } from "vitest";
import { computeSafeToSpend, creditCardDebtOf, realBalanceOf, type BalanceAccount } from "@/lib/finance/safeToSpend";

const A = "user-a";
const B = "user-b";

const accounts: BalanceAccount[] = [
  { ownerUserId: A, kind: "DEPOSIT", balance: 3_000_000 },
  { ownerUserId: A, kind: "WALLET", balance: 400_000 },
  { ownerUserId: A, kind: "CASH", balance: 100_000 },
  { ownerUserId: A, kind: "CREDIT_CARD", balance: -800_000 },
  { ownerUserId: A, kind: "CREDIT_CARD", balance: 50_000 }, // saldo a favor: no suma
  { ownerUserId: B, kind: "DEPOSIT", balance: 9_000_000 },
];

describe("Saldo Seguro", () => {
  it("solo depósitos y billeteras del usuario suman al saldo real", () => {
    expect(realBalanceOf(A, accounts)).toBe(3_500_000);
  });

  it("la deuda de tarjetas se resta", () => {
    expect(creditCardDebtOf(A, accounts)).toBe(800_000);
  });

  it("fórmula completa", () => {
    const r = computeSafeToSpend({
      realBalance: 3_500_000,
      householdObligationsPending: 600_000,
      scheduledSavingsPending: 200_000,
      creditCardDebt: 800_000,
      owedToPartner: 70_000,
    });
    expect(r.total).toBe(1_830_000);
  });

  it("puede ser negativo y nunca suma valores negativos de las restas", () => {
    const r = computeSafeToSpend({
      realBalance: 100_000,
      householdObligationsPending: -5,
      scheduledSavingsPending: 0,
      creditCardDebt: 300_000,
      owedToPartner: 0,
    });
    expect(r.householdObligationsPending).toBe(0);
    expect(r.total).toBe(-200_000);
  });
});
