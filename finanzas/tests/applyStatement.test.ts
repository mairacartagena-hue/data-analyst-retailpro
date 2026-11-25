import { describe, expect, it } from "vitest";
import { checkInstallments, installmentFix, type ExtractPurchase } from "@/lib/finance/cardStatements";
import { editPayload } from "@/lib/finance/txEdit";
import {
  DIFFERENCE_TAG, appEntryOf, bankCharges, classifyLine, differencePayload, valuePairs, type RegisterContext, type StatementLine, type AppEntry,
} from "@/lib/finance/statement";
import type { Account, Transaction } from "@/lib/types";

const card: Account = {
  id: "bbva", household_id: "h", owner_user_id: "u1", name: "BBVA", kind: "CREDIT_CARD", institution: "BBVA", last4: "0602",
  visibility: "PRIVATE", reveal_in_shared: false, opening_balance: -1_000_000, opening_at: "2026-10-21T05:00:00+00:00",
  credit_limit: null, statement_day: 20, due_day: 5, interest_rate_ea: 0, archived: false,
};
const tx = (over: Partial<Transaction>): Transaction => ({
  id: "t1", kind: "EXPENSE", status: "CONFIRMED", occurred_on: "2026-11-06", amount: 100_000, description: "Compra", merchant: null,
  account_id: "bbva", to_account_id: null, payer_user_id: "u1", counterparty_user_id: null, is_shared: false, scope: "PERSONAL",
  creates_debt: true, source: "MANUAL", tags: [], created_by: "u1", created_at: "2026-11-06T12:00:00Z", installments: 1,
  splits: [{ amount: 100_000, category_id: "c1", responsible_user_id: "u1", origin: "NORMAL" }], ...over,
} as Transaction);
const entry = (t: Transaction): AppEntry => appEntryOf(card, t)!;
const line = (id: string, date: string, amount: number, description: string): StatementLine => ({ id, date, amount, description, balance: null, kind: classifyLine(description, amount) });
const ctx: RegisterContext = { accountId: "bbva", userId: "u1", bankCategoryId: "bank", unknownCategoryId: "unk", interestCategoryId: "int" };

describe("primas de seguro del extracto", () => {
  it("se reconocen como cobros del banco, no como líneas sin clasificar", () => {
    expect(classifyLine("Cobro Prima: Vida Integral Pre", -102_600)).toBe("FEE");
    expect(classifyLine("COBRO PRIMA SEGURO INDIVIDU", -4_800)).toBe("FEE");
    expect(classifyLine("Compraste usando tus puntos", 149_896)).toBe("OTHER");
  });

  it("suman en cuotas, comisiones y seguros", () => {
    const lines = [line("L1", "2026-11-06", -102_600, "Cobro Prima: Vida Integral Pre"), line("L2", "2026-11-07", -4_800, "COBRO PRIMA SEGURO INDIVIDU")];
    expect(bankCharges(card, lines, 47_065).fees.total).toBe(107_400);
  });
});

describe("parejas con otro valor", () => {
  it("el avance de 1.000.000 contra la transferencia de 990.000 se proponen como pareja", () => {
    const flor = tx({ id: "flor", kind: "TRANSFER", to_account_id: "flor", amount: 990_000, occurred_on: "2026-11-20", description: "Avance a Flor", splits: [] });
    const pairs = valuePairs([line("L9", "2026-11-20", -1_000_000, "AVANCE TARJETA BREB-DIF")], [entry(flor)], card, "u1");
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ diff: -10_000, editable: false });
  });

  it("los puntos: abono de 149.896 contra 143.523 en la app, en un ingreso simple que sí se puede corregir", () => {
    const puntos = tx({ id: "puntos", kind: "INCOME", amount: 143_523, occurred_on: "2026-11-06", description: "Puntos BBVA", splits: [] });
    const [pair] = valuePairs([line("L5", "2026-11-06", 149_896, "Compraste usando tus puntos")], [entry(puntos)], card, "u1");
    expect(pair).toMatchObject({ diff: 6_373, editable: true });
  });

  it("no se proponen si el valor difiere demasiado, el sentido es otro o la fecha está lejos", () => {
    const base = tx({ id: "a", amount: 100_000, occurred_on: "2026-11-06" });
    const l = line("L1", "2026-11-06", -100_500, "REST EL CORRAL");
    expect(valuePairs([l], [entry(base)], card, "u1")).toHaveLength(1);
    expect(valuePairs([line("L1", "2026-11-06", -150_000, "REST EL CORRAL")], [entry(base)], card, "u1")).toHaveLength(0);
    expect(valuePairs([line("L1", "2026-11-06", 100_500, "DEVOLUCION")], [entry(base)], card, "u1")).toHaveLength(0);
    expect(valuePairs([line("L1", "2026-11-18", -100_500, "REST EL CORRAL")], [entry(base)], card, "u1")).toHaveLength(0);
  });

  it("compras pequeñas solo se emparejan si el comercio coincide", () => {
    const cafe = tx({ id: "cafe", amount: 9_500, description: "Juan Valdez", merchant: "Juan Valdez" });
    expect(valuePairs([line("L1", "2026-11-06", -10_000, "OTRO SITIO")], [entry(cafe)], card, "u1")).toHaveLength(0);
    expect(valuePairs([line("L1", "2026-11-06", -10_000, "JUAN VALDEZ CHIA")], [entry(cafe)], card, "u1")).toHaveLength(1);
  });

  it("cada línea y cada movimiento quedan en una sola pareja: gana la más parecida", () => {
    const a = tx({ id: "a", amount: 100_000 });
    const b = tx({ id: "b", amount: 96_000 });
    const pairs = valuePairs([line("L1", "2026-11-06", -99_000, "MERCADO")], [entry(a), entry(b)], card, "u1");
    expect(pairs).toHaveLength(1);
    expect(pairs[0].entry.tx.id).toBe("a");
  });

  it("lo que la persona descartó con “No es” no se vuelve a proponer", () => {
    const a = tx({ id: "a", amount: 100_000 });
    expect(valuePairs([line("L1", "2026-11-06", -99_000, "MERCADO")], [entry(a)], card, "u1", ["L1|a"])).toHaveLength(0);
  });

  it("los cobros del banco y las líneas agrupadas no se emparejan", () => {
    const a = tx({ id: "a", amount: 100_000 });
    expect(valuePairs([line("L1", "2026-11-06", -99_000, "Comision avance")], [entry(a)], card, "u1")).toHaveLength(0);
    expect(valuePairs([{ ...line("G:INTEREST_OUT|2026-11", "2026-11-06", -99_000, "Intereses"), kind: "OTHER" }], [entry(a)], card, "u1")).toHaveLength(0);
  });

  it("solo se puede cambiar el valor de lo propio, simple y sin cuotas", () => {
    const l = [line("L1", "2026-11-06", -99_000, "MERCADO")];
    const edit = (t: Transaction) => valuePairs(l, [entry(t)], card, "u1")[0].editable;
    expect(edit(tx({ id: "a", amount: 100_000 }))).toBe(true);
    expect(edit(tx({ id: "a", amount: 100_000, created_by: "u2" }))).toBe(false);
    expect(edit(tx({ id: "a", amount: 100_000, installments: 3 }))).toBe(false);
    expect(edit(tx({ id: "a", amount: 100_000, status: "PENDING_REVIEW" }))).toBe(false);
  });
});

describe("registrar la diferencia de una pareja", () => {
  it("el banco cobró más: un gasto por la diferencia, marcado para no confundirlo con un movimiento solo de la app", () => {
    const p = differencePayload({ line: line("L9", "2026-11-20", -1_000_000, "AVANCE TARJETA BREB-DIF"), diff: -10_000 }, ctx);
    expect(p).toMatchObject({ kind: "EXPENSE", amount: 10_000, occurred_on: "2026-11-20", account_id: "bbva" });
    expect(p.tags).toEqual(["#conciliacion", DIFFERENCE_TAG]);
    expect(p.description).toContain("Diferencia con el extracto");
    expect((p as { splits: { amount: number }[] }).splits).toEqual([{ amount: 10_000, category_id: "unk", responsible_user_id: "u1" }]);
  });

  it("el banco abonó más: un ingreso por la diferencia", () => {
    const p = differencePayload({ line: line("L5", "2026-11-06", 149_896, "Compraste usando tus puntos"), diff: 6_373 }, ctx);
    expect(p).toMatchObject({ kind: "INCOME", amount: 6_373 });
    expect(p.tags).toContain(DIFFERENCE_TAG);
  });
});

describe("editar un movimiento cambiando solo el valor o las cuotas", () => {
  it("el valor nuevo reparte el desglose en proporción y deja lo demás igual", () => {
    const t = tx({ id: "a", amount: 100_000, splits: [
      { amount: 60_000, category_id: "c1", responsible_user_id: "u1", origin: "NORMAL" },
      { amount: 40_000, category_id: "c2", responsible_user_id: "u2", origin: "NORMAL" },
    ] as Transaction["splits"], description: "Mercado", tags: ["#x"] });
    const p = editPayload(t, { amount: 110_000 });
    expect(p).toMatchObject({ id: "a", kind: "EXPENSE", amount: 110_000, description: "Mercado", tags: ["#x"], installments: 1, account_id: "bbva" });
    expect(p.splits.map((s) => s.amount)).toEqual([66_000, 44_000]);
    expect(p.splits.reduce((a, s) => a + s.amount, 0)).toBe(110_000);
  });

  it("solo las cuotas: el valor y el desglose no cambian", () => {
    const t = tx({ id: "a", amount: 118_491 });
    const p = editPayload(t, { installments: 2 });
    expect(p).toMatchObject({ amount: 118_491, installments: 2 });
    expect(p.splits).toEqual([{ amount: 100_000, category_id: "c1", responsible_user_id: "u1", origin: "NORMAL", note: null }]);
  });
});

describe("corregir el total de cuotas con lo que dice el extracto", () => {
  const purchase = (over: Partial<ExtractPurchase> = {}): ExtractPurchase => ({
    description: "PONTIFICIA", purchaseDate: "2026-10-24", amount: 300_000, installments: 2, paidInstallments: 1, remainingBalance: 150_000, ...over,
  });
  const sinCuotas = tx({ id: "pont", amount: 300_000, occurred_on: "2026-10-24", description: "Pontificia", installments: 1 });

  it("compra de la app a una cuota que el banco difirió a dos: se ofrece ponerle 2", () => {
    const [c] = checkInstallments(card, [sinCuotas], [], [purchase()], "2026-11-20");
    expect(c.diffs).toEqual([{ field: "installments", app: 1, extract: 2 }]);
    expect(installmentFix(c, card, "u1")).toMatchObject({ from: 1, to: 2, tx: { id: "pont" } });
  });

  it("no se ofrece si la compra es de otra persona, está pendiente o la diferencia no es el total de cuotas", () => {
    const [ajena] = checkInstallments(card, [{ ...sinCuotas, created_by: "u2" }], [], [purchase()], "2026-11-20");
    expect(installmentFix(ajena, card, "u1")).toBeNull();
    const [pendiente] = checkInstallments(card, [{ ...sinCuotas, status: "PENDING_REVIEW" }], [], [purchase()], "2026-11-20");
    expect(installmentFix(pendiente, card, "u1")).toBeNull();
    const tv = tx({ id: "tv", amount: 300_000, occurred_on: "2026-10-24", installments: 3 });
    const [otra] = checkInstallments(card, [tv], [], [purchase({ installments: 3, paidInstallments: 2, remainingBalance: 100_000 })], "2026-11-20");
    expect(otra.diffs[0]?.field).toBe("current");
    expect(installmentFix(otra, card, "u1")).toBeNull();
  });

  it("no se ofrece cuando la compra solo está en el extracto o ya cuadra", () => {
    const [sola] = checkInstallments(card, [], [], [purchase()], "2026-11-20");
    expect(installmentFix(sola, card, "u1")).toBeNull();
    const tres = tx({ id: "tv", amount: 300_000, occurred_on: "2026-10-24", installments: 3 });
    const [ok] = checkInstallments(card, [tres], [], [purchase({ installments: 3, remainingBalance: 200_000 })], "2026-11-20");
    expect(ok.verdict).toBe("OK");
    expect(installmentFix(ok, card, "u1")).toBeNull();
  });
});
