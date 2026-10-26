import { describe, expect, it } from "vitest";
import { addMonthsIso, cardDue, expandInstallments, installmentPlan, monthlyRate, splitEven } from "@/lib/finance/installments";
import { spendingRows } from "@/lib/finance/spaces";
import type { Transaction } from "@/lib/types";

const tx = (over: Partial<Transaction>): Transaction => ({
  id: "t1", kind: "EXPENSE", status: "CONFIRMED", occurred_on: "2026-10-15", amount: 1_200_000, description: "Nevera", merchant: null,
  account_id: "visa", to_account_id: null, payer_user_id: "u1", counterparty_user_id: null, is_shared: false, scope: "PERSONAL",
  creates_debt: true, source: "MANUAL", tags: [], created_by: "u1", created_at: "2026-10-15T12:00:00Z", installments: 12,
  splits: [{ id: "s1", transaction_id: "t1", amount: 1_200_000, category_id: "hogar", responsible_user_id: "u1" } as Transaction["splits"][number]],
  ...over,
});

describe("fechas y reparto", () => {
  it("un mes después conserva el día o usa el último del mes", () => {
    expect(addMonthsIso("2026-10-15", 1)).toBe("2026-11-15");
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsIso("2026-11-30", 3)).toBe("2027-02-28");
  });
  it("el sobrante de pesos va en la primera cuota", () => {
    expect(splitEven(100_000, 3)).toEqual([33_334, 33_333, 33_333]);
  });
});

describe("intereses", () => {
  it("tasa mensual equivalente a la efectiva anual", () => {
    expect(monthlyRate(28)).toBeCloseTo(0.02079, 4);
    expect(monthlyRate(null)).toBe(0);
  });
  it("capital fijo e intereses sobre el saldo que queda", () => {
    const plan = installmentPlan(1_200_000, 12, "2026-10-15", 28);
    expect(plan).toHaveLength(12);
    expect(plan.every((c) => c.capital === 100_000)).toBe(true);
    expect(plan[0].interest).toBe(Math.round(1_200_000 * monthlyRate(28)));
    expect(plan[11].interest).toBe(Math.round(100_000 * monthlyRate(28)));
    expect(plan[11].date).toBe("2027-09-15");
  });
  it("a 1 cuota no hay intereses", () => {
    expect(installmentPlan(500_000, 1, "2026-10-15", 28)[0].interest).toBe(0);
  });
});

describe("presupuesto: cada mes su cuota", () => {
  it("una compra a 12 cuotas cuenta 100.000 por mes durante 12 meses", () => {
    const rows = spendingRows(expandInstallments([tx({})]));
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.total === 100_000 && r.categoryId === "hogar")).toBe(true);
    expect(rows.map((r) => r.occurredOn).slice(0, 3)).toEqual(["2026-10-15", "2026-11-15", "2026-12-15"]);
  });
  it("las copias apuntan al movimiento original", () => {
    const parts = expandInstallments([tx({})]);
    expect(parts[4].installment_no).toBe(5);
    expect(parts[4].installment_of?.amount).toBe(1_200_000);
  });
  it("sin cuotas, ingresos y transferencias quedan igual", () => {
    const list = [tx({ installments: 1 }), tx({ id: "t2", kind: "INCOME", installments: 6 })];
    expect(expandInstallments(list)).toEqual(list);
  });
});

describe("tarjeta: lo que toca pagar en el periodo", () => {
  const card = { id: "visa", interest_rate_ea: 28 };
  const oct = { start: "2026-10-01", end: "2026-10-31" };

  it("aparta la cuota del mes con sus intereses y no toda la deuda", () => {
    const d = cardDue(card, -1_200_000, [tx({})], oct);
    expect(d.debt).toBe(1_200_000);
    expect(d.laterCapital).toBe(1_100_000);
    expect(d.due).toBe(100_000 + Math.round(1_200_000 * monthlyRate(28)));
  });

  it("las compras a 1 cuota se pagan completas", () => {
    const d = cardDue(card, -1_350_000, [tx({}), tx({ id: "t2", amount: 150_000, installments: 1 })], oct);
    expect(d.due - d.interest).toBe(250_000);
  });

  it("después de pagar la cuota del mes no queda nada por pagar en el periodo", () => {
    const d = cardDue(card, -1_100_000, [tx({})], oct);
    expect(d.due - d.interest).toBe(0);
  });

  it("al mes siguiente toca la segunda cuota", () => {
    const d = cardDue({ id: "visa" }, -1_100_000, [tx({})], { start: "2026-11-01", end: "2026-11-30" });
    expect(d.due).toBe(100_000);
  });
});
