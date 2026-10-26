import { describe, expect, it } from "vitest";
import { annuityPayment, nextCuota, remainingMonths, suggestSplit } from "@/lib/finance/credit";
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
    const base = nextCuota(5_000_000, 12, 60, "2026-01-01", 0, "2026-10-26");
    expect(nextCuota(5_000_000, 12, 60, "2026-01-01", 45_000, "2026-10-26")).toBe(base + 45_000);
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
