import { describe, expect, it } from "vitest";
import { formatCop, formatCopShort, parseCop } from "@/lib/finance/money";

describe("money", () => {
  it("lee montos con puntos, comas, espacios y signo pesos", () => {
    expect(parseCop("1.250.000")).toBe(1250000);
    expect(parseCop("45,000")).toBe(45000);
    expect(parseCop("$ 20 000")).toBe(20000);
    expect(parseCop("")).toBeNull();
    expect(parseCop("abc")).toBeNull();
  });

  it("formatea en pesos colombianos sin decimales", () => {
    expect(formatCop(1250000)).toBe("$ 1.250.000");
    expect(formatCop(-35000)).toMatch(/-\s?\$\s?35\.000/);
  });

  it("formato corto", () => {
    expect(formatCopShort(45000)).toBe("$45 mil");
    expect(formatCopShort(1250000)).toBe("$1,3 M");
    expect(formatCopShort(800)).toBe("$800");
  });
});
