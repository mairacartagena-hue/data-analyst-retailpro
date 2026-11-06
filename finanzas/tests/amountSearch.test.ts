import { describe, expect, it } from "vitest";
import { amountMatch, parseAmountQuery } from "@/lib/finance/amountSearch";

describe("parseAmountQuery", () => {
  it("lee montos con y sin separadores", () => {
    expect(parseAmountQuery("45000")).toBe(45000);
    expect(parseAmountQuery("$45.000")).toBe(45000);
    expect(parseAmountQuery("$ 1.250.000")).toBe(1250000);
    expect(parseAmountQuery("45,000")).toBe(45000);
  });
  it("entiende mil, k y millones", () => {
    expect(parseAmountQuery("45 mil")).toBe(45000);
    expect(parseAmountQuery("45k")).toBe(45000);
    expect(parseAmountQuery("1,5 millones")).toBe(1500000);
    expect(parseAmountQuery("2m")).toBe(2000000);
  });
  it("no confunde texto con montos", () => {
    expect(parseAmountQuery("mercado")).toBeNull();
    expect(parseAmountQuery("cuota 3")).toBeNull();
    expect(parseAmountQuery("")).toBeNull();
    expect(parseAmountQuery("0")).toBeNull();
  });
});

describe("amountMatch", () => {
  it("exacto, aproximado (±10 %) y parecido", () => {
    expect(amountMatch(45000, 45000)).toBe("exact");
    expect(amountMatch(48000, 45000)).toBe("approx");
    expect(amountMatch(41000, 45000)).toBe("approx");
    expect(amountMatch(4500, 45000)).toBe("similar");
    expect(amountMatch(450000, 45000)).toBe("similar");
    expect(amountMatch(45900, 45000)).toBe("approx");
    expect(amountMatch(60000, 45000)).toBeNull();
  });
  it("con un valor redondo compara las dos primeras cifras", () => {
    expect(amountMatch(5090, 50000)).toBe("similar");
    expect(amountMatch(5100, 50000)).toBeNull();
  });
});
