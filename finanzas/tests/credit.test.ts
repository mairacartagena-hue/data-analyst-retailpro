import { describe, expect, it } from "vitest";
import { annuityPayment, creditReserve, nextCuota, remainingMonths, suggestSplit } from "@/lib/finance/credit";
import type { Transaction } from "@/lib/types";
import { monthlyRate } from "@/lib/finance/installments";

describe("cuota de un crédito", () => {
  it("sin tasa, la cuota es el saldo dividido en las cuotas", () => {
    expect(annuityPayment(1_200_000, 0, 12)).toBe(100_000);
  });
  it("con tasa, la cuota cubre los intereses del primer mes", () => {
    const r = monthlyRate(12);
    const cuota = annuityPayment(10_000_000, r, 120);
    expect(cuota).toBeGreaterThan(10_000_000 / 120);
    expect(Math.round(cuota)).toBe(Math.round(annuityPayment(10_000_000, r, 120)));
  });
  it("cuotas que faltan: plazo menos los meses transcurridos", () => {
    expect(remainingMonths(120, "2026-01-15", "2026-10-26")).toBe(111);
    expect(remainingMonths(12, null, "2026-10-26")).toBe(12);
    expect(remainingMonths(3, "2020-01-01", "2026-10-26")).toBe(1);
  });
  it("la cuota estimada suma los costos mensuales", () => {
    const base = nextCuota(5_000_000, { interest_rate_ea: 12, term_months: 60, opening_at: "2026-01-01", monthly_costs: 0 }, "2026-10-26");
    expect(nextCuota(5_000_000, { interest_rate_ea: 12, term_months: 60, opening_at: "2026-01-01", monthly_costs: 45_000 }, "2026-10-26")).toBe(base + 45_000);
  });
});

describe("reparto de un pago", () => {
  it("los intereses salen del saldo y el resto baja el capital", () => {
    const s = suggestSplit(10_000_000, 12, 1_000_000, 50_000);
    expect(s.interest).toBe(Math.round(10_000_000 * monthlyRate(12)));
    expect(s.costs).toBe(50_000);
    expect(s.capital).toBe(1_000_000 - s.interest - 50_000);
    expect(s.capital + s.interest + s.costs).toBe(1_000_000);
  });
  it("nunca deja capital negativo si la cuota es menor que lo que cobra el banco", () => {
    const s = suggestSplit(10_000_000, 12, 50_000, 0);
    expect(s.capital).toBe(0);
    expect(s.interest).toBe(50_000);
  });
});

describe("cuota del crédito que falta reservar en el periodo", () => {
  // Hipoteca de Banco de Bogotá según el extracto: tasa 12,28 % EA, 180 cuotas, seguros $68.002,40,
  // corte el 20 y pago el 4: el extracto del 20-oct se paga el 4-nov
  const credit = { id: "hip", interest_rate_ea: 12.28, term_months: 180, opening_at: "2025-07-01", monthly_costs: 68_002.4, statement_day: 20, due_day: 4 };
  const balance = -154_099_591;
  const period = { start: "2026-10-22", end: "2026-11-21" };
  const today = "2026-10-26";
  const toCredit = (amount: number, on: string): Transaction => ({
    id: `t${on}${amount}`, kind: "TRANSFER", status: "CONFIRMED", occurred_on: on, amount, account_id: "bancolombia", to_account_id: "hip",
  } as unknown as Transaction);

  it("la cuota estimada se parece a la del extracto ($1.952.068)", () => {
    const cuota = nextCuota(-balance, { interest_rate_ea: 12.28, term_months: 180, opening_at: "2025-07-01", monthly_costs: 68_002.4 }, today);
    expect(Math.abs(cuota - 1_952_068)).toBeLessThan(15_000);
  });

  it("sin pagos registrados se reserva la cuota completa", () => {
    expect(creditReserve(credit, balance, [], period, today)).toBe(nextCuota(-balance, { interest_rate_ea: 12.28, term_months: 180, opening_at: "2025-07-01", monthly_costs: 68_002.4 }, today));
  });

  it("si ya se abonó capital después del corte del 20-oct, la cuota del 4-nov está pagada", () => {
    expect(creditReserve(credit, balance, [toCredit(932_583, "2026-10-23")], period, today)).toBe(0);
  });

  it("un abono anterior al corte no paga esta cuota", () => {
    const full = creditReserve(credit, balance, [], period, today);
    expect(creditReserve(credit, balance, [toCredit(932_583, "2026-10-05")], period, today)).toBe(full);
  });

  it("un abono menor al capital de la cuota deja reservada la parte que falta", () => {
    const full = creditReserve(credit, balance, [], period, today);
    const r = creditReserve(credit, balance, [toCredit(190_000, "2026-10-23")], period, today);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(full);
  });

  it("el periodo siguiente vuelve a reservar la cuota del 4-dic", () => {
    const next = { start: "2026-11-22", end: "2026-12-21" };
    const full = creditReserve(credit, balance, [], next, today);
    expect(creditReserve(credit, balance, [toCredit(932_583, "2026-10-23")], next, today)).toBe(full);
    expect(full).toBeGreaterThan(1_800_000);
  });

  it("si el periodo no incluye el día de pago, no se reserva nada", () => {
    expect(creditReserve(credit, balance, [], { start: "2026-11-05", end: "2026-11-30" }, today)).toBe(0);
  });

  it("sin día de pago se reserva la cuota completa, como antes", () => {
    expect(creditReserve({ ...credit, due_day: null }, balance, [toCredit(932_583, "2026-10-23")], period, today))
      .toBe(nextCuota(-balance, { interest_rate_ea: 12.28, term_months: 180, opening_at: "2025-07-01", monthly_costs: 68_002.4 }, today));
  });
});

import { creditCheckDue } from "@/components/CreditCheck";

describe("aviso mensual del saldo del crédito", () => {
  const acc = { id: "c1", due_day: 4, opening_at: "2026-01-15" };
  it("aparece después del día de pago si no se ha confirmado el mes", () => {
    expect(creditCheckDue(acc, [], "2026-10-03")).toBe(false);
    expect(creditCheckDue(acc, [], "2026-10-05")).toBe(true);
    expect(creditCheckDue(acc, ["2026-10-01"], "2026-10-20")).toBe(false);
  });
  it("sin día de pago aparece desde el día 1; no aparece el mes en que se creó", () => {
    expect(creditCheckDue({ ...acc, due_day: null }, [], "2026-10-01")).toBe(true);
    expect(creditCheckDue({ ...acc, opening_at: "2026-10-02" }, [], "2026-10-20")).toBe(false);
  });
});

import { installmentLabel, installmentsPaid, remainingInstallments } from "@/lib/finance/credit";

describe("en qué cuota va el crédito", () => {
  const hip = { term_months: 240, due_day: 4, paid_installments: 37, paid_installments_on: "2026-10-26", opening_at: "2025-07-01" };
  it("parte de lo que dijo la persona y suma cada día de pago que pasa", () => {
    expect(installmentLabel(hip, "2026-10-26")).toBe("Cuota 38 de 240");
    expect(installmentLabel(hip, "2026-11-03")).toBe("Cuota 38 de 240");
    expect(installmentLabel(hip, "2026-11-04")).toBe("Cuota 39 de 240");
    expect(installmentsPaid(hip, "2027-01-10")).toBe(40);
    expect(remainingInstallments(hip, "2026-10-26")).toBe(203);
  });
  it("sin la cuota indicada cuenta los meses desde el saldo inicial; al final no pasa del plazo", () => {
    expect(installmentsPaid({ term_months: 120, opening_at: "2026-01-15" }, "2026-10-26")).toBe(9);
    expect(installmentLabel({ ...hip, term_months: 38 }, "2027-06-01")).toBe("38 de 38 cuotas pagadas");
    expect(installmentLabel({ term_months: null }, "2026-10-26")).toBeNull();
  });
  it("la cuota estimada usa las cuotas que faltan", () => {
    const a = nextCuota(100_000_000, { ...hip, interest_rate_ea: 12 }, "2026-10-26");
    const b = nextCuota(100_000_000, { ...hip, interest_rate_ea: 12, paid_installments: 200 }, "2026-10-26");
    expect(b).toBeGreaterThan(a); // menos cuotas por delante → cuota mayor para el mismo saldo
  });
});

import { capitalPaidRatio } from "@/lib/finance/credit";

describe("valor inicial del crédito", () => {
  it("parte del capital ya pagada", () => {
    expect(capitalPaidRatio(200_000_000, 150_000_000)).toBe(0.25);
    expect(capitalPaidRatio(null, 150_000_000)).toBeNull();
    expect(capitalPaidRatio(100, 120)).toBe(0); // deuda mayor que el valor inicial (intereses capitalizados)
  });
});
