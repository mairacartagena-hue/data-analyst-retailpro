import { describe, expect, it } from "vitest";
import {
  periodFor, shiftPeriod, periodsBetween, periodLabel, todayBogota, daysInPeriod, type PeriodSettings,
} from "@/lib/finance/periods";

const monthly: PeriodSettings = { cycle: "MONTHLY", monthlyStartDay: 1, biweeklyFirstDay: 1, biweeklySecondDay: 16 };
const monthly25: PeriodSettings = { ...monthly, monthlyStartDay: 25 };
const biweekly: PeriodSettings = { ...monthly, cycle: "BIWEEKLY" };
const biweekly5_20: PeriodSettings = { ...biweekly, biweeklyFirstDay: 5, biweeklySecondDay: 20 };

describe("periodos mensuales", () => {
  it("mes calendario", () => {
    expect(periodFor(monthly, "2026-02-14")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(periodFor(monthly, "2028-02-29")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
  });

  it("con día de inicio 25 y cambio de año", () => {
    expect(periodFor(monthly25, "2026-10-24")).toEqual({ start: "2026-09-25", end: "2026-10-24" });
    expect(periodFor(monthly25, "2026-10-25")).toEqual({ start: "2026-10-25", end: "2026-11-24" });
    expect(periodFor(monthly25, "2027-01-03")).toEqual({ start: "2026-12-25", end: "2027-01-24" });
  });
});

describe("periodos quincenales", () => {
  it("cortes 1 y 16", () => {
    expect(periodFor(biweekly, "2026-10-01")).toEqual({ start: "2026-10-01", end: "2026-10-15" });
    expect(periodFor(biweekly, "2026-10-31")).toEqual({ start: "2026-10-16", end: "2026-10-31" });
    expect(periodFor(biweekly, "2026-02-20")).toEqual({ start: "2026-02-16", end: "2026-02-28" });
  });

  it("cortes 5 y 20, cruzando el mes y el año", () => {
    expect(periodFor(biweekly5_20, "2027-01-03")).toEqual({ start: "2026-12-20", end: "2027-01-04" });
    expect(periodFor(biweekly5_20, "2026-10-12")).toEqual({ start: "2026-10-05", end: "2026-10-19" });
  });

  it("navegar hacia atrás y adelante", () => {
    const p = periodFor(biweekly, "2026-10-10");
    expect(shiftPeriod(biweekly, p, 1)).toEqual({ start: "2026-10-16", end: "2026-10-31" });
    expect(shiftPeriod(biweekly, p, -1)).toEqual({ start: "2026-09-16", end: "2026-09-30" });
    expect(shiftPeriod(biweekly, p, -2)).toEqual({ start: "2026-09-01", end: "2026-09-15" });
  });

  it("lista de periodos y días", () => {
    const list = periodsBetween(biweekly, "2026-09-03", periodFor(biweekly, "2026-10-20"));
    expect(list.map((p) => p.start)).toEqual(["2026-09-01", "2026-09-16", "2026-10-01", "2026-10-16"]);
    expect(daysInPeriod(list[3])).toBe(16);
  });
});

describe("etiquetas y hoy", () => {
  it("etiquetas en español", () => {
    expect(periodLabel({ start: "2026-10-01", end: "2026-10-31" })).toBe("octubre 2026");
    expect(periodLabel({ start: "2026-10-01", end: "2026-10-15" })).toBe("1 – 15 oct 2026");
    expect(periodLabel({ start: "2026-12-25", end: "2027-01-24" })).toBe("25 dic 2026 – 24 ene 2027");
  });

  it("hoy en Bogotá (UTC-5)", () => {
    expect(todayBogota(new Date("2026-10-25T03:00:00Z"))).toBe("2026-10-24");
    expect(todayBogota(new Date("2026-10-25T06:00:00Z"))).toBe("2026-10-25");
  });
});
