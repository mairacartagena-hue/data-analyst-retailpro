import { describe, expect, it } from "vitest";
import { creditPayments, fixWithRealCapital } from "@/lib/finance/creditPayments";
import type { Transaction } from "@/lib/types";

const H = "hip";
const tx = (x: Partial<Transaction>): Transaction => ({ status: "CONFIRMED", splits: [], ...x } as Transaction);
const credit = { id: H, name: "Crédito hipotecario" };

describe("cuotas pagadas de un crédito", () => {
  it("cruce automático: total transferido al crédito y los intereses cargados al crédito", () => {
    const txs = [
      tx({ id: "p", kind: "TRANSFER", amount: 1_953_000, occurred_on: "2026-10-23", account_id: "banco", to_account_id: H }),
      tx({ id: "e", kind: "EXPENSE", amount: 1_571_638, occurred_on: "2026-10-23", account_id: H, description: "Cuota Crédito hipotecario · intereses y seguros" }),
    ];
    const [p] = creditPayments(credit, txs);
    expect(p).toMatchObject({ total: 1_953_000, capital: 381_362, charges: 1_571_638, mode: "ON_CREDIT" });
    // Pago real: $932.583 a capital → intereses y seguros $1.020.417; la transferencia sigue en $1.953.000
    expect(fixWithRealCapital(p, 932_583)).toEqual({ transferAmount: 1_953_000, chargeAmount: 1_020_417 });
    expect(fixWithRealCapital(p, 2_000_000)).toBeNull();
  });

  it("registro manual: capital transferido y los intereses pagados desde la cuenta", () => {
    const txs = [
      tx({ id: "p", kind: "TRANSFER", amount: 380_000, occurred_on: "2026-11-04", account_id: "banco", to_account_id: H }),
      tx({ id: "e", kind: "EXPENSE", amount: 1_572_068, occurred_on: "2026-11-04", account_id: "banco", description: "Cuota crédito · intereses y costos (Crédito hipotecario)" }),
      tx({ id: "x", kind: "EXPENSE", amount: 50_000, occurred_on: "2026-11-04", account_id: "banco", description: "Mercado" }),
    ];
    const [p] = creditPayments(credit, txs);
    expect(p).toMatchObject({ total: 1_952_068, capital: 380_000, charges: 1_572_068, mode: "FROM_ACCOUNT" });
    expect(fixWithRealCapital(p, 400_000)).toEqual({ transferAmount: 400_000, chargeAmount: 1_552_068 });
  });

  it("abono sin intereses registrados: todo es capital hasta que se ajuste", () => {
    const [p] = creditPayments(credit, [tx({ id: "p", kind: "TRANSFER", amount: 500_000, occurred_on: "2026-10-10", account_id: "banco", to_account_id: H })]);
    expect(p).toMatchObject({ capital: 500_000, charges: 0, charge: null });
    expect(fixWithRealCapital(p, 300_000)).toEqual({ transferAmount: 500_000, chargeAmount: 200_000 });
  });
});
