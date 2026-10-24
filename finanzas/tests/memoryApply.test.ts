import { describe, expect, it } from "vitest";
import type { MerchantMemory, Transaction } from "@/lib/types";
import { applyChange, memoryChange, memoryMatches, memoryValues } from "@/lib/finance/memoryApply";

const ME = "me";
const mem = (over: Partial<MerchantMemory> = {}): MerchantMemory => ({
  id: "m", identifier_type: "ACCOUNT", identifier: "3145159690", category_id: "compras", responsible_user_id: ME, tag: null, auto_apply: false, hits: 1,
  label: null, scope: "PERSONAL", creates_debt: true, movement_kind: null, ...over,
});
const tx = (over: Partial<Transaction> = {}): Transaction => ({
  id: "t1", kind: "EXPENSE", status: "CONFIRMED", occurred_on: "2026-10-20", amount: 42000, description: "Cuenta ···9690", merchant: "Cuenta ···9690", account_id: "acc",
  payer_user_id: ME, created_by: ME, scope: "PERSONAL", creates_debt: true, tags: ["#bancolombia"], merchant_norm: "cuenta 9690",
  ingest_identifiers: [{ type: "ACCOUNT", value: "3145159690" }], source: "GMAIL",
  splits: [{ id: "s1", transaction_id: "t1", amount: 42000, category_id: "compras", responsible_user_id: ME, origin: "NORMAL", note: null }],
  ...over,
} as unknown as Transaction);

describe("a qué movimientos se aplica una memoria", () => {
  it("por llave o cuenta (identificador del aviso), por comercio y no por otra cosa", () => {
    expect(memoryMatches(tx(), mem())).toBe(true);
    expect(memoryMatches(tx(), mem({ identifier: "9999999999" }))).toBe(false);
    expect(memoryMatches(tx(), mem({ identifier_type: "MERCHANT", identifier: "cuenta 9690" }))).toBe(true);
    expect(memoryMatches(tx({ merchant_norm: "otro" }), mem({ identifier_type: "MERCHANT", identifier: "cuenta 9690" }))).toBe(false);
    expect(memoryMatches(tx(), mem({ identifier_type: "KEYWORD", identifier: "uñas" }))).toBe(false);
  });

  it("una memoria de gastos no toca ingresos y una regla de reembolso sí toca los ingresos de ese origen", () => {
    expect(memoryMatches(tx({ kind: "INCOME" }), mem())).toBe(false);
    expect(memoryMatches(tx({ kind: "INCOME" }), mem({ movement_kind: "REFUND" }))).toBe(true);
    expect(memoryMatches(tx({ kind: "EXPENSE" }), mem({ movement_kind: "REFUND" }))).toBe(false);
  });
});

describe("qué cambió", () => {
  it("solo lo que se editó", () => {
    const before = memoryValues(mem(), ME);
    expect(memoryChange(before, { ...before })).toEqual({});
    expect(memoryChange(before, { ...before, label: "Lady uñas" })).toEqual({ label: "Lady uñas" });
    expect(memoryChange(before, { ...before, categoryId: "belleza", scope: "HOUSEHOLD" })).toEqual({ categoryId: "belleza", scope: "HOUSEHOLD" });
  });
});

describe("actualizar un movimiento anterior", () => {
  it("el nombre reemplaza al comercio y a la descripción automática", () => {
    const { payload } = applyChange(tx(), { label: "Lady uñas" }, null, ME);
    expect(payload).toMatchObject({ id: "t1", merchant: "Lady uñas", description: "Lady uñas", scope: "PERSONAL", amount: 42000 });
    expect((payload!.splits as { category_id: string }[])[0].category_id).toBe("compras"); // la categoría no cambió
  });

  it("respeta la descripción que la persona escribió", () => {
    const { payload } = applyChange(tx({ description: "Manicure de octubre" }), { label: "Lady uñas" }, null, ME);
    expect(payload).toMatchObject({ merchant: "Lady uñas", description: "Manicure de octubre" });
  });

  it("reemplaza la descripción si era el nombre anterior", () => {
    const { payload } = applyChange(tx({ description: "Heladería", merchant: "Heladería" }), { label: "Heladería Cream" }, "Heladería", ME);
    expect(payload).toMatchObject({ description: "Heladería Cream" });
  });

  it("cambia la categoría y el responsable de la única parte", () => {
    const { payload } = applyChange(tx(), { categoryId: "belleza", responsibleId: "pareja", createsDebt: false }, null, ME);
    expect(payload).toMatchObject({ creates_debt: false });
    expect(payload!.splits).toEqual([{ amount: 42000, category_id: "belleza", responsible_user_id: "pareja", origin: "NORMAL", note: null }]);
  });

  it("cambia el espacio sin tocar las partes", () => {
    const { payload } = applyChange(tx(), { scope: "HOUSEHOLD" }, null, ME);
    expect(payload).toMatchObject({ scope: "HOUSEHOLD" });
    expect((payload!.splits as { category_id: string }[])[0].category_id).toBe("compras");
  });

  it("no toca pendientes, movimientos de otra persona ni divididos (si cambia categoría o responsable)", () => {
    expect(applyChange(tx({ status: "PENDING_REVIEW" }), { label: "x" }, null, ME)).toEqual({ payload: null, skipped: "PENDING" });
    expect(applyChange(tx({ created_by: "otra", payer_user_id: "otra" }), { label: "x" }, null, ME)).toEqual({ payload: null, skipped: "OTHER_PERSON" });
    const divided = tx({ splits: [{ amount: 1, category_id: "a" }, { amount: 41999, category_id: "b" }] as never });
    expect(applyChange(divided, { categoryId: "c" }, null, ME).skipped).toBe("DIVIDED");
    expect(applyChange(divided, { label: "Nuevo" }, null, ME).payload).toMatchObject({ merchant: "Nuevo" }); // el nombre sí
    expect(applyChange(tx(), {}, null, ME).skipped).toBe("NOTHING");
  });
});
