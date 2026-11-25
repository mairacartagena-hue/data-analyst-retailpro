import { describe, expect, it } from "vitest";
import { threeWayCheck, type ThreeWayInput } from "@/lib/finance/bankBalance";
import type { Account, Transaction } from "@/lib/types";

const card: Account = {
  id: "bbva", household_id: "h", owner_user_id: "u1", name: "BBVA", kind: "CREDIT_CARD", institution: "BBVA", last4: "0602",
  visibility: "PRIVATE", reveal_in_shared: false, opening_balance: -8_000_000, opening_at: "2026-10-01T05:00:00Z",
  credit_limit: null, statement_day: 20, due_day: 5, archived: false,
};
const savings: Account = { ...card, id: "ahorros", name: "Ahorros", kind: "DEPOSIT", opening_balance: 1_000_000, statement_day: null, due_day: null };
const tx = (id: string, amount: number, occurred_on: string, account_id = "bbva", kind: "EXPENSE" | "INCOME" = "EXPENSE"): Transaction => ({
  id, kind, status: "CONFIRMED", occurred_on, amount, description: id, merchant: null, account_id, to_account_id: null,
  payer_user_id: "u1", counterparty_user_id: null, is_shared: false, scope: "PERSONAL", creates_debt: true, source: "MANUAL", tags: [],
  created_by: "u1", created_at: `${occurred_on}T15:00:00Z`, installments: 1, splits: [],
} as Transaction);

// Deuda: 8.000.000 al abrir + 500.000 (10 nov) = 8.500.000 al corte del 20 + 200.000 (25 nov) = 8.700.000 al 30
const txs = [tx("a", 500_000, "2026-11-10"), tx("b", 200_000, "2026-11-25")];
const base: ThreeWayInput = { account: card, txs, isDebt: true, extractValue: 8_500_000, extractDate: "2026-11-20", bankValue: 8_700_000, bankDate: "2026-11-30" };
const check = (over: Partial<ThreeWayInput>) => threeWayCheck({ ...base, ...over })!;

describe("cruce a tres puntas: app vs extracto vs app del banco", () => {
  it("todo cuadra: la app dice lo mismo en las dos fechas", () => {
    const c = check({});
    expect([c.appAtExtract, c.appAtBank]).toEqual([8_500_000, 8_700_000]);
    expect([c.extractDiff, c.bankDiff, c.sinceDiff]).toEqual([0, 0, 0]);
    expect([c.appSince, c.bankSince]).toEqual([200_000, 200_000]);
    expect(c.diagnosis).toBe("OK");
    expect(c.sinceTxs.map((t) => t.id)).toEqual(["b"]);
  });

  it("cuadraba al corte y hoy no: la diferencia viene de lo posterior al corte", () => {
    const c = check({ bankValue: 8_650_000 });
    expect([c.extractDiff, c.bankDiff, c.sinceDiff]).toEqual([0, 50_000, 50_000]);
    expect(c.diagnosis).toBe("NEW_SINCE");
  });

  it("la misma diferencia en las dos fechas: ya estaba en el corte", () => {
    const c = check({ extractValue: 8_450_000, bankValue: 8_650_000 });
    expect([c.extractDiff, c.bankDiff, c.sinceDiff]).toEqual([50_000, 50_000, 0]);
    expect(c.diagnosis).toBe("SAME_GAP");
  });

  it("no cuadraba al corte y hoy sí: se compensó después", () => {
    const c = check({ extractValue: 8_450_000 });
    expect([c.extractDiff, c.bankDiff]).toEqual([50_000, 0]);
    expect(c.diagnosis).toBe("FIXED_SINCE");
  });

  it("diferencia antes del corte y otra distinta después", () => {
    const c = check({ extractValue: 8_450_000, bankValue: 8_600_000 });
    expect([c.extractDiff, c.bankDiff, c.sinceDiff]).toEqual([50_000, 100_000, 50_000]);
    expect(c.diagnosis).toBe("BOTH_GAPS");
  });

  it("tolera redondeos de hasta $1.000 en cada punta", () => {
    expect(check({ extractValue: 8_499_500, bankValue: 8_700_900 }).diagnosis).toBe("OK");
    expect(check({ extractValue: 8_498_999 }).diagnosis).toBe("FIXED_SINCE");
  });

  it("si la app del banco se miró antes del corte no hay desde-el-corte que comparar", () => {
    expect(threeWayCheck({ ...base, bankDate: "2026-11-19" })).toBeNull();
  });

  it("mismo día en las dos fuentes: si no coinciden entre sí lo avisa", () => {
    const c = check({ bankDate: "2026-11-20", bankValue: 8_400_000 });
    expect(c.sourcesDisagree).toBe(true);
    expect(c.sinceTxs).toEqual([]);
    expect(check({ bankDate: "2026-11-20", bankValue: 8_500_000 }).sourcesDisagree).toBe(false);
  });

  it("en una cuenta de saldo (no deuda) los valores van sin invertir", () => {
    const sTxs = [tx("sueldo", 3_000_000, "2026-11-15", "ahorros", "INCOME"), tx("mercado", 400_000, "2026-11-25", "ahorros")];
    const c = threeWayCheck({ account: savings, txs: sTxs, isDebt: false, extractValue: 4_000_000, extractDate: "2026-11-20", bankValue: 3_600_000, bankDate: "2026-11-30" })!;
    expect([c.appAtExtract, c.appAtBank]).toEqual([4_000_000, 3_600_000]);
    expect(c.diagnosis).toBe("OK");
    expect(c.bankSince).toBe(-400_000);
    expect(c.appSince).toBe(-400_000);
  });

  it("movimientos de otras cuentas no cuentan", () => {
    const c = check({ txs: [...txs, tx("otra", 999_000, "2026-11-26", "ahorros")] });
    expect(c.diagnosis).toBe("OK");
    expect(c.sinceTxs.map((t) => t.id)).toEqual(["b"]);
  });
});
