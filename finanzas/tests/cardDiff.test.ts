import { describe, expect, it } from "vitest";
import { STATEMENT_TOLERANCE, diffVerdict, squares } from "@/lib/finance/cardStatements";

describe("veredicto de la diferencia con el extracto", () => {
  it("exacto: cuadra sin redondeo", () => {
    expect(diffVerdict(0)).toEqual({ ok: true, rounding: 0, direction: "NONE" });
  });
  it("dentro de la tolerancia: cuadra, pero dice cuánto es el redondeo", () => {
    expect(diffVerdict(640)).toEqual({ ok: true, rounding: 640, direction: "MORE" });
    expect(diffVerdict(-STATEMENT_TOLERANCE)).toEqual({ ok: true, rounding: STATEMENT_TOLERANCE, direction: "LESS" });
  });
  it("fuera de la tolerancia: no cuadra y no se da por bueno ningún redondeo", () => {
    expect(diffVerdict(STATEMENT_TOLERANCE + 1)).toEqual({ ok: false, rounding: 0, direction: "MORE" });
    expect(diffVerdict(-25_000)).toEqual({ ok: false, rounding: 0, direction: "LESS" });
  });
  it("coincide con squares()", () => {
    for (const d of [0, 1, 999, 1000, 1001, -1000, -1001]) expect(diffVerdict(d).ok).toBe(squares(d));
  });
});
