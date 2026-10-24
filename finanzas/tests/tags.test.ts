import { describe, expect, it } from "vitest";
import type { Tag, Transaction } from "@/lib/types";
import { diffTags, findTagByName, spendingByTag, tagKey, tagUsage } from "@/lib/finance/tags";

const tag = (id: string, name: string): Tag => ({ id, household_id: "h", name, color: null });
const tx = (id: string, kind: string, amount: number, date: string): Transaction => ({ id, kind, amount, occurred_on: date } as unknown as Transaction);
const period = { start: "2026-10-01", end: "2026-10-31", label: "Octubre" } as never;

describe("etiquetas", () => {
  const tags = [tag("viaje", "Viaje"), tag("regalo", "Regalos")];
  const txs = [tx("a", "EXPENSE", 100_000, "2026-10-05"), tx("b", "EXPENSE", 50_000, "2026-10-10"), tx("c", "REFUND", 20_000, "2026-10-12"),
    tx("d", "INCOME", 300_000, "2026-10-15"), tx("e", "EXPENSE", 999, "2026-09-30"), tx("f", "TRANSFER", 70_000, "2026-10-20")];
  const txTags = { a: ["viaje"], b: ["viaje", "regalo"], c: ["viaje"], d: ["regalo"], e: ["viaje"], f: ["viaje"] };

  it("el nombre se compara sin tildes, mayúsculas ni espacios", () => {
    expect(tagKey("  Vacaciónes ")).toBe("vacaciones");
    expect(findTagByName(tags, " regalos ")?.id).toBe("regalo");
    expect(findTagByName(tags, "otra")).toBeUndefined();
  });

  it("cuenta los movimientos de cada etiqueta", () => {
    const u = tagUsage(txs, txTags);
    expect(u.get("viaje")).toBe(5);
    expect(u.get("regalo")).toBe(2);
  });

  it("informe por etiqueta: gastos netos (los reembolsos restan), ingresos y solo el periodo", () => {
    const r = spendingByTag(txs, txTags, tags, period);
    const viaje = r.find((x) => x.tagId === "viaje")!;
    expect(viaje).toMatchObject({ count: 4, expense: 100_000 + 50_000 - 20_000, income: 0 }); // sin septiembre; la transferencia no gasta
    const regalo = r.find((x) => x.tagId === "regalo")!;
    expect(regalo).toMatchObject({ count: 2, expense: 50_000, income: 300_000 });
    expect(r[0].tagId).toBe("viaje"); // ordenado por gasto
  });

  it("ignora etiquetas que ya no existen", () => {
    expect(spendingByTag([tx("a", "EXPENSE", 1, "2026-10-05")], { a: ["borrada"] }, tags, period)).toEqual([]);
  });

  it("qué agregar y qué quitar al cambiar las etiquetas de un movimiento", () => {
    expect(diffTags(["a", "b"], ["b", "c"])).toEqual({ add: ["c"], remove: ["a"] });
    expect(diffTags([], ["x"])).toEqual({ add: ["x"], remove: [] });
    expect(diffTags(["x"], ["x"])).toEqual({ add: [], remove: [] });
  });
});
