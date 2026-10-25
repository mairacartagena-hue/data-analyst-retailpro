import { describe, expect, it } from "vitest";
import { groupMemory } from "@/lib/finance/memoryApply";
import type { MerchantMemory } from "@/lib/types";

const mem = (id: string, type: string, identifier: string, extra: Partial<MerchantMemory> = {}) =>
  ({ id, identifier_type: type, identifier, category_id: "cat1", responsible_user_id: null, tag: null, auto_apply: true, hits: 1, label: null, scope: "PERSONAL", creates_debt: true, movement_kind: null, ...extra }) as MerchantMemory;

describe("memoria de comercios: la misma cuenta no sale dos veces", () => {
  it("une la llave completa con su gemela de 4 dígitos", () => {
    const g = groupMemory([mem("a", "ACCOUNT", "3182349549", { hits: 2 }), mem("b", "MERCHANT", "cuenta 9549", { hits: 3 })]);
    expect(g).toHaveLength(1);
    expect(g[0].main.id).toBe("a");
    expect(g[0].all.map((m) => m.id)).toEqual(["a", "b"]);
    expect(g[0].hits).toBe(3);
  });

  it("funciona igual con un celular (Nequi) y respeta el orden de la lista", () => {
    const g = groupMemory([mem("x", "MERCHANT", "d1"), mem("p", "PHONE", "3104577966"), mem("q", "MERCHANT", "cuenta 7966")]);
    expect(g.map((e) => e.main.id)).toEqual(["x", "p"]);
    expect(g[1].twins.map((m) => m.id)).toEqual(["q"]);
  });

  it("no junta cuentas distintas: otra categoría, otros dígitos o un comercio con nombre", () => {
    const g = groupMemory([
      mem("a", "ACCOUNT", "3182349549"),
      mem("b", "MERCHANT", "cuenta 9549", { category_id: "otra" }),
      mem("c", "MERCHANT", "cuenta 1111"),
      mem("d", "MERCHANT", "tienda 9549"),
    ]);
    expect(g.map((e) => e.main.id)).toEqual(["a", "b", "c", "d"]);
  });
});
