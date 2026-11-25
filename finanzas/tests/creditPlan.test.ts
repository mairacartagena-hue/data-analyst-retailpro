import { describe, expect, it } from "vitest";
import { milestones, monthYear, nextDueDate, planInstallment, projectCredit, savingsVs, yearEndBalances, type PlanInput } from "@/lib/finance/creditPlan";
import { annuityPayment } from "@/lib/finance/credit";
import { monthlyRate } from "@/lib/finance/installments";

// Crédito de ejemplo: $100 M al 12 % E.A., cuota de $1.400.000 y $50.000 de seguros (se salda en 120 cuotas)
const EJEMPLO: PlanInput = {
  owed: 100_000_000,
  eaPercent: 12,
  installment: 1_400_000,
  costs: 50_000,
  firstDue: "2026-12-05",
};

describe("próxima fecha de pago", () => {
  it("el mismo mes si el día de pago no ha pasado", () => {
    expect(nextDueDate(28, "2026-11-25")).toBe("2026-11-28");
  });
  it("el mes siguiente si ya pasó o es hoy", () => {
    expect(nextDueDate(4, "2026-11-25")).toBe("2026-12-04");
    expect(nextDueDate(25, "2026-11-25")).toBe("2026-12-25");
  });
  it("cambia de año en diciembre", () => {
    expect(nextDueDate(4, "2026-12-20")).toBe("2027-01-04");
  });
  it("recorta al último día de un mes corto", () => {
    expect(nextDueDate(31, "2027-01-31")).toBe("2027-02-28");
  });
  it("sin día de pago usa el día de hoy", () => {
    expect(nextDueDate(null, "2026-11-25")).toBe("2026-12-25");
  });
});

describe("etiqueta de fecha", () => {
  it("mes corto y año", () => {
    expect(monthYear("2040-08-04")).toBe("ago 2040");
    expect(monthYear("2026-12-31")).toBe("dic 2026");
  });
});

describe("cuota de la ruta", () => {
  it("usa la cuota del extracto cuando existe", () => {
    expect(planInstallment(10_000_000, { installment_amount: 450_000 }, "2026-11-25")).toBe(450_000);
  });
  it("sin cuota del extracto, la estima con la tasa y las cuotas que faltan", () => {
    const a = { interest_rate_ea: 12, term_months: 60, opening_at: "2026-01-01" };
    const esperada = Math.round(annuityPayment(10_000_000, monthlyRate(12), 60 - 10));
    expect(planInstallment(10_000_000, a, "2026-11-25")).toBe(esperada);
  });
  it("sin deuda no hay cuota", () => {
    expect(planInstallment(0, { installment_amount: 450_000 }, "2026-11-25")).toBe(0);
  });
});

describe("proyección del crédito", () => {
  const base = projectCredit(EJEMPLO);

  it("el crédito de ejemplo se salda en 120 cuotas, en nov-2036", () => {
    expect(base.amortizes).toBe(true);
    expect(base.payments).toBe(120);
    expect(base.endDate).toBe("2036-11-05");
  });
  it("los intereses de todo el plazo salen de la tasa y el saldo", () => {
    expect(base.interest).toBeGreaterThan(67_000_000);
    expect(base.interest).toBeLessThan(68_500_000);
  });
  it("lo que baja el capital suma exactamente lo que se debe", () => {
    const capital = base.rows.reduce((s, r) => s + r.capital + r.extra, 0);
    expect(capital).toBe(EJEMPLO.owed);
    expect(base.rows[base.rows.length - 1].balance).toBe(0);
  });
  it("el saldo baja cada mes y la última cuota no pasa de lo que falta", () => {
    for (let i = 1; i < base.rows.length; i++) expect(base.rows[i].balance).toBeLessThan(base.rows[i - 1].balance);
    const last = base.rows[base.rows.length - 1];
    expect(last.capital + last.interest).toBeLessThanOrEqual(EJEMPLO.installment);
  });
  it("los seguros se suman cada cuota", () => {
    expect(base.costs).toBe(50_000 * base.payments);
  });

  it("un abono mensual a capital acorta el plazo y ahorra intereses", () => {
    const plan = projectCredit({ ...EJEMPLO, extraMonthly: 400_000 });
    const s = savingsVs(base, plan);
    expect(plan.payments).toBe(80);
    expect(s.monthsSaved).toBe(base.payments - 80);
    expect(s.interestSaved).toBeGreaterThan(25_000_000);
    expect(s.interestSaved).toBeLessThan(25_300_000);
  });
  it("un abono de un mes concreto solo cae en ese mes", () => {
    const plan = projectCredit({ ...EJEMPLO, extraByMonth: { 12: 5_000_000 } });
    for (const r of plan.rows.slice(0, 24)) {
      expect(r.extra).toBe(r.date.slice(5, 7) === "12" ? 5_000_000 : 0);
    }
    expect(plan.payments).toBeLessThan(base.payments);
  });
  it("el abono nunca pasa de lo que se debe", () => {
    const plan = projectCredit({ owed: 3_000_000, eaPercent: 12, installment: 500_000, costs: 0, firstDue: "2026-12-04", extraMonthly: 10_000_000 });
    expect(plan.payments).toBe(1);
    expect(plan.rows[0].balance).toBe(0);
    expect(plan.rows[0].capital + plan.rows[0].extra).toBe(3_000_000);
  });
  it("si la cuota no cubre los intereses, no se salda", () => {
    const plan = projectCredit({ owed: 100_000_000, eaPercent: 12, installment: 500_000, costs: 0, firstDue: "2026-12-04" });
    expect(plan.amortizes).toBe(false);
    expect(plan.payments).toBe(0);
    expect(plan.endDate).toBe("");
    expect(savingsVs(plan, plan)).toEqual({ monthsSaved: 0, interestSaved: 0 });
  });
  it("sin tasa, la cuota baja el capital completo", () => {
    const plan = projectCredit({ owed: 1_200_000, eaPercent: null, installment: 100_000, costs: 0, firstDue: "2026-12-04" });
    expect(plan.payments).toBe(12);
    expect(plan.interest).toBe(0);
    expect(plan.endDate).toBe("2027-11-04");
  });
  it("sin deuda no hay ruta", () => {
    const plan = projectCredit({ ...EJEMPLO, owed: 0 });
    expect(plan.rows).toEqual([]);
    expect(plan.payments).toBe(0);
  });
});

describe("hitos y saldo por año", () => {
  const base = projectCredit(EJEMPLO);

  it("los hitos llegan en orden: 75 %, 50 % y 25 % de lo que se debe", () => {
    const hs = milestones(base, EJEMPLO.owed);
    expect(hs.map((h) => h.left)).toEqual([0.75, 0.5, 0.25]);
    expect(hs[0].date < hs[1].date && hs[1].date < hs[2].date).toBe(true);
    for (const h of hs) expect(base.rows.find((r) => r.date === h.date)!.balance).toBeLessThanOrEqual(h.balance);
  });
  it("el saldo al cierre de cada año termina en cero", () => {
    const years = yearEndBalances(base);
    expect(years[0].year).toBe("2026");
    expect(years[years.length - 1]).toEqual({ year: "2036", balance: 0 });
  });
});
