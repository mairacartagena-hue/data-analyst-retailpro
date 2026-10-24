import { describe, expect, it } from "vitest";
import {
  allocationFor, budgetVersionAt, categoryStatus, fixedAmountsExcess, pendingObligationsFor,
  type BudgetCategory, type SpendingRow,
} from "@/lib/finance/budget";
import { periodFor, type PeriodSettings } from "@/lib/finance/periods";

const A = "user-a";
const B = "user-b";
const members = { a: A, b: B };
const monthly: PeriodSettings = { cycle: "MONTHLY", monthlyStartDay: 1, biweeklyFirstDay: 1, biweeklySecondDay: 16 };
const oct = periodFor(monthly, "2026-10-10");

const mercado: BudgetCategory = {
  id: "mercado",
  responsibility: "MEMBER_A_100",
  ownerUserId: null,
  rolloverEnabled: false,
  isHouseholdObligation: true,
  budgets: [{ validFrom: "2026-10-01", amount: 1_000_000, fixedAmountA: null, fixedAmountB: null }],
};

const arriendo: BudgetCategory = {
  id: "arriendo",
  responsibility: "FIXED_AMOUNTS",
  ownerUserId: null,
  rolloverEnabled: false,
  isHouseholdObligation: true,
  budgets: [{ validFrom: "2026-01-01", amount: 800_000, fixedAmountA: 500_000, fixedAmountB: 300_000 }],
};

describe("asignación por responsable", () => {
  it("100 % de un miembro, montos fijos y privada", () => {
    const v = mercado.budgets[0];
    expect(allocationFor(mercado, v, members)).toEqual({ [A]: 1_000_000 });
    expect(allocationFor({ ...mercado, responsibility: "MEMBER_B_100" }, v, members)).toEqual({ [B]: 1_000_000 });
    expect(allocationFor(arriendo, arriendo.budgets[0], members)).toEqual({ [A]: 500_000, [B]: 300_000 });
    expect(allocationFor({ responsibility: "PRIVATE", ownerUserId: B }, v, members)).toEqual({ [B]: 1_000_000 });
    expect(allocationFor(mercado, null, members)).toEqual({});
  });

  it("toma la versión de presupuesto vigente", () => {
    const budgets = [
      { validFrom: "2026-01-01", amount: 1, fixedAmountA: null, fixedAmountB: null },
      { validFrom: "2026-09-01", amount: 2, fixedAmountA: null, fixedAmountB: null },
    ];
    expect(budgetVersionAt(budgets, "2026-08-01")?.amount).toBe(1);
    expect(budgetVersionAt(budgets, "2026-10-01")?.amount).toBe(2);
    expect(budgetVersionAt(budgets, "2025-12-01")).toBeNull();
  });
});

describe("ejecución, alertas y obligaciones", () => {
  it("ejemplo del documento: Mercado 1.000.000 con 400.000 gastados reserva 600.000", () => {
    const rows: SpendingRow[] = [
      { categoryId: "mercado", responsibleUserId: A, occurredOn: "2026-10-03", total: 250_000 },
      { categoryId: "mercado", responsibleUserId: A, occurredOn: "2026-10-09", total: 150_000 },
      { categoryId: "mercado", responsibleUserId: A, occurredOn: "2026-09-28", total: 999_999 }, // otro periodo
    ];
    const st = categoryStatus(mercado, oct, rows, monthly, members);
    expect(st.totalSpent).toBe(400_000);
    expect(st.allocations).toEqual([
      { userId: A, budget: 1_000_000, carry: 0, available: 1_000_000, spent: 400_000, remaining: 600_000 },
    ]);
    expect(st.level).toBe("ok");
    expect(pendingObligationsFor(A, [mercado], [st])).toBe(600_000);
    expect(pendingObligationsFor(B, [mercado], [st])).toBe(0);
  });

  it("alerta cerca del tope y al pasarse; el sobregiro no libera dinero", () => {
    const near = categoryStatus(mercado, oct, [{ categoryId: "mercado", responsibleUserId: A, occurredOn: "2026-10-05", total: 900_000 }], monthly, members);
    expect(near.level).toBe("warning");
    const over = categoryStatus(mercado, oct, [{ categoryId: "mercado", responsibleUserId: A, occurredOn: "2026-10-05", total: 1_200_000 }], monthly, members);
    expect(over.level).toBe("over");
    expect(pendingObligationsFor(A, [mercado], [over])).toBe(0);
  });

  it("montos fijos: cada uno reserva su parte", () => {
    const rows: SpendingRow[] = [{ categoryId: "arriendo", responsibleUserId: A, occurredOn: "2026-10-01", total: 500_000 }];
    const st = categoryStatus(arriendo, oct, rows, monthly, members);
    expect(pendingObligationsFor(A, [arriendo], [st])).toBe(0);
    expect(pendingObligationsFor(B, [arriendo], [st])).toBe(300_000);
  });

  it("no es obligación del hogar: no se reserva", () => {
    const salidas = { ...mercado, id: "salidas", isHouseholdObligation: false };
    const st = categoryStatus(salidas, oct, [], monthly, members);
    expect(pendingObligationsFor(A, [salidas], [st])).toBe(0);
  });
});

describe("rollover", () => {
  const base: BudgetCategory = {
    ...mercado,
    rolloverEnabled: true,
    budgets: [{ validFrom: "2026-08-01", amount: 300_000, fixedAmountA: null, fixedAmountB: null }],
  };

  it("pasa sobrantes y sobregiros acumulados", () => {
    const rows: SpendingRow[] = [
      { categoryId: "mercado", responsibleUserId: A, occurredOn: "2026-08-10", total: 200_000 }, // sobran 100.000
      { categoryId: "mercado", responsibleUserId: A, occurredOn: "2026-09-10", total: 450_000 }, // 400.000 disponibles → -50.000
    ];
    const st = categoryStatus(base, oct, rows, monthly, members);
    expect(st.allocations[0]).toMatchObject({ budget: 300_000, carry: -50_000, available: 250_000 });
  });

  it("sin rollover no arrastra nada", () => {
    const rows: SpendingRow[] = [{ categoryId: "mercado", responsibleUserId: A, occurredOn: "2026-08-10", total: 0 }];
    const st = categoryStatus({ ...base, rolloverEnabled: false }, oct, rows, monthly, members);
    expect(st.allocations[0].carry).toBe(0);
  });

  it("el primer periodo con presupuesto no tiene arrastre", () => {
    const st = categoryStatus(base, periodFor(monthly, "2026-08-15"), [], monthly, members);
    expect(st.allocations[0].carry).toBe(0);
  });
});

describe("excedente en montos fijos", () => {
  it("A ya puso 400.000 de sus 500.000 y paga 300.000: excedente 200.000", () => {
    const r = fixedAmountsExcess({ amount: 300_000, payerAvailable: 500_000, payerSpent: 400_000, partnerAvailable: 300_000, partnerSpent: 150_000 });
    expect(r).toEqual({ payerRemaining: 100_000, partnerRemaining: 150_000, excess: 200_000, suggestedCharge: 150_000 });
  });

  it("sin excedente no hay nada que preguntar", () => {
    const r = fixedAmountsExcess({ amount: 100_000, payerAvailable: 500_000, payerSpent: 0, partnerAvailable: 300_000, partnerSpent: 0 });
    expect(r.excess).toBe(0);
    expect(r.suggestedCharge).toBe(0);
  });
});
