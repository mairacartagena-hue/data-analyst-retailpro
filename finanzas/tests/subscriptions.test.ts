import { describe, expect, it } from "vitest";
import { detectSubscriptions, isKnownSubscription } from "@/lib/finance/subscriptions";
import type { Transaction } from "@/lib/types";

const A = "a";
const tx = (p: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36), kind: "EXPENSE", status: "CONFIRMED", occurred_on: "2026-10-24", amount: 0, description: null,
  merchant: null, account_id: "x", to_account_id: null, payer_user_id: A, counterparty_user_id: null, is_shared: false,
  source: "GMAIL", tags: [], created_by: A, created_at: "", splits: [], scope: "PERSONAL", creates_debt: true, ...p,
});

describe("suscripciones", () => {
  it("comercios conocidos", () => {
    expect(isKnownSubscription("claude by an")).toBe(true);
    expect(isKnownSubscription("play yout")).toBe(true);
    expect(isKnownSubscription("supermercado bela")).toBe(false);
  });

  it("cobro mensual con monto parecido", () => {
    const list = [
      tx({ merchant: "Smart Gym", merchant_norm: "smart gym", amount: 99_000, occurred_on: "2026-08-05" }),
      tx({ merchant: "Smart Gym", merchant_norm: "smart gym", amount: 99_000, occurred_on: "2026-09-05" }),
      tx({ merchant: "Exito", merchant_norm: "exito", amount: 50_000, occurred_on: "2026-09-05" }),
      tx({ merchant: "Exito", merchant_norm: "exito", amount: 180_000, occurred_on: "2026-10-04" }), // monto distinto
    ];
    const r = detectSubscriptions(list, A);
    expect(r.map((c) => c.key)).toEqual(["smart gym"]);
    expect(r[0].count).toBe(2);
  });

  it("los ya etiquetados no se vuelven a proponer", () => {
    const r = detectSubscriptions([tx({ merchant_norm: "netflix", amount: 30_000, tags: ["#suscripcion"] })], A);
    expect(r).toEqual([]);
  });
});
