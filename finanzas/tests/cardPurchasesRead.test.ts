import { describe, expect, it } from "vitest";
import { firstReadWithPurchases, sanitizeCardStatement, type CardStatementData } from "@/lib/capture/cardStatement";

const TODAY = "2026-11-25";
const row = (over: Record<string, unknown> = {}) => ({
  description: "AIRBNB", purchase_date: "2026-10-31", amount: 161_600, installments: 36, paid_installments: 1, remaining_balance: 150_000, monthly_charge: 4_489, ...over,
});
const withPurchases = sanitizeCardStatement({ total_debt: 8_000_000, statement_date: "2026-11-20", purchases: [row(), row({ description: "IKEA", amount: 170_950, installments: 2, remaining_balance: 85_475 })] }, TODAY);
const empty = sanitizeCardStatement({ total_debt: 8_000_000, statement_date: "2026-11-20", purchases: [] }, TODAY);

describe("cuántas compras devolvió la IA", () => {
  it("cuenta las filas que llegaron antes de validarlas", () => {
    expect(withPurchases.rawPurchases).toBe(2);
    expect(withPurchases.purchases).toHaveLength(2);
    expect(empty.rawPurchases).toBe(0);
  });
  it("filas que no pasan la validación se descartan pero se cuentan (la deuda sí se lee)", () => {
    const d = sanitizeCardStatement({ total_debt: 8_000_000, purchases: [row({ installments: 1 }), row({ remaining_balance: 999_999_999 })] }, TODAY);
    expect(d.purchases).toEqual([]);
    expect(d.rawPurchases).toBe(2);
    expect(d.totalDebt).toBe(8_000_000);
  });
});

describe("leer el extracto con el siguiente modelo si no trae compras", () => {
  const run = (reads: Record<string, CardStatementData | Error>, budget = 57_000, clock?: () => number) => {
    const asked: string[] = [];
    return firstReadWithPurchases(Object.keys(reads), async (m) => {
      asked.push(m);
      const r = reads[m];
      if (r instanceof Error) throw r;
      return r;
    }, budget, 8_000, clock).then((data) => ({ data, asked }));
  };

  it("el primero trae compras: no se pregunta más", async () => {
    const { data, asked } = await run({ a: withPurchases, b: withPurchases });
    expect(data.purchases).toHaveLength(2);
    expect(asked).toEqual(["a"]);
  });
  it("el primero devuelve la deuda sin compras: se prueba el siguiente y se queda con el que sí las trae", async () => {
    const { data, asked } = await run({ a: empty, b: withPurchases });
    expect(data.purchases).toHaveLength(2);
    expect(asked).toEqual(["a", "b"]);
  });
  it("uno falla (saturado) y el siguiente responde", async () => {
    const { data, asked } = await run({ a: new Error("saturado"), b: withPurchases });
    expect(data.purchases).toHaveLength(2);
    expect(asked).toEqual(["a", "b"]);
  });
  it("ninguno trae compras: devuelve la lectura con la deuda (no un error)", async () => {
    const { data } = await run({ a: empty, b: empty });
    expect(data.totalDebt).toBe(8_000_000);
    expect(data.purchases).toEqual([]);
  });
  it("todos fallan: relanza el último error", async () => {
    const err = await run({ a: new Error("uno"), b: new Error("dos") }).then(() => null, (e: Error) => e);
    expect(err?.message).toBe("dos");
  });
  it("sin tiempo para otro modelo no lo intenta", async () => {
    let t = 0;
    const clock = () => t;
    const asked: string[] = [];
    const data = await firstReadWithPurchases(["a", "b"], async (m) => { asked.push(m); t += 52_000; return empty; }, 57_000, 8_000, clock);
    expect(asked).toEqual(["a"]);
    expect(data.purchases).toEqual([]);
  });
});
