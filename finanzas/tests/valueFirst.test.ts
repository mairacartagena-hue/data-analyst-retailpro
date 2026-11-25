import { describe, expect, it } from "vitest";
import { cycleRange } from "@/lib/finance/reconcile";
import { VALUE_ONLY_MIN, VALUE_WINDOW_DAYS, carryOverStatus, classifyLine, reconcileStatement, withManualLinks, type StatementLine } from "@/lib/finance/statement";
import type { Account, ReconcilingItem, Transaction } from "@/lib/types";

const card: Account = {
  id: "bbva", household_id: "h", owner_user_id: "u1", name: "BBVA", kind: "CREDIT_CARD", institution: "BBVA", last4: "0602",
  visibility: "PRIVATE", reveal_in_shared: false, opening_balance: -8_000_000, opening_at: "2026-09-01T05:00:00Z",
  credit_limit: null, statement_day: 20, due_day: 5, archived: false,
};
const tx = (id: string, amount: number, occurred_on: string, description = id): Transaction => ({
  id, kind: "EXPENSE", status: "CONFIRMED", occurred_on, amount, description, merchant: null, account_id: "bbva", to_account_id: null,
  payer_user_id: "u1", counterparty_user_id: null, is_shared: false, scope: "PERSONAL", creates_debt: true, source: "MANUAL", tags: [],
  created_by: "u1", created_at: `${occurred_on}T15:00:00Z`, installments: 1, splits: [],
} as Transaction);
const line = (id: string, date: string, amount: number, description = "COMPRA"): StatementLine =>
  ({ id, date, amount, description, balance: null, kind: classifyLine(description, amount) });
const partida = (t: Transaction): ReconcilingItem => ({ transaction_id: t.id, amount: -t.amount, description: t.description ?? "", occurred_on: t.occurred_on });

// Ciclo de noviembre con corte el 20: del 21-oct al 20-nov
const range = cycleRange(20, "2026-11");

describe("cruce por valor: la app lo dejó en octubre y el extracto en noviembre", () => {
  it("mismo valor y fechas muy distintas dentro del ciclo: se unen solas y no salen dobles", () => {
    const moto = tx("moto", 247_590, "2026-10-24", "Cda motos carrera");
    const mercado = tx("mercado", 219_926, "2026-10-26", "Autoservicio merc");
    const lines = [line("L1", "2026-11-14", -247_590, "CDA MOTOS CARRERA"), line("L2", "2026-11-18", -219_926, "AUTOSERVICIO MERC")];
    const rec = reconcileStatement(card, [moto, mercado], lines, range);
    expect(rec.missing).toEqual([]);
    expect(rec.extra).toEqual([]);
    expect(rec.matched.map((m) => [m.line.id, m.entry?.tx.id, m.dateGap])).toEqual([["L1", "moto", 21], ["L2", "mercado", 23]]);
  });

  it("partidas del cierre anterior fechadas ANTES del ciclo se cruzan por valor y quedan como encontradas", () => {
    const moto = tx("moto", 247_590, "2026-10-12", "Cda motos carrera"); // antes del 21-oct
    const lines = [line("L1", "2026-11-03", -247_590, "CDA MOTOS CARRERA")];
    const sin = reconcileStatement(card, [moto], lines, range);
    expect(sin.missing.map((l) => l.id)).toEqual(["L1"]);
    const rec = reconcileStatement(card, [moto], lines, range, 3, { carryTxIds: ["moto"] });
    expect(rec.missing).toEqual([]);
    expect(rec.matched[0]).toMatchObject({ dateGap: 22 });
    expect(rec.matched[0].entry?.tx.id).toBe("moto");
    const [c] = carryOverStatus([partida(moto)], [moto], rec, range);
    expect(c.status).toBe("FOUND");
    expect(c.line?.id).toBe("L1");
  });

  it("un movimiento de otro ciclo que NO es partida pendiente no se lleva líneas de este extracto", () => {
    const viejo = tx("viejo", 247_590, "2026-10-12");
    const rec = reconcileStatement(card, [viejo], [line("L1", "2026-11-03", -247_590, "CDA MOTOS CARRERA")], range);
    expect(rec.missing.map((l) => l.id)).toEqual(["L1"]);
    expect(rec.matched).toEqual([]);
  });

  it("más allá de la ventana no se une", () => {
    const moto = tx("moto", 247_590, "2026-09-20");
    const rec = reconcileStatement(card, [moto], [line("L1", "2026-11-14", -247_590)], range, 3, { carryTxIds: ["moto"] });
    expect(rec.matched).toEqual([]);
    expect(VALUE_WINDOW_DAYS).toBe(45);
  });

  it("un valor distinto o de signo contrario no se une", () => {
    const t = tx("t", 100_000, "2026-10-24");
    expect(reconcileStatement(card, [t], [line("L1", "2026-11-14", -100_500)], range).matched).toEqual([]);
    expect(reconcileStatement(card, [t], [line("L1", "2026-11-14", 100_000)], range).matched).toEqual([]);
  });

  it("$1 de diferencia (redondeo del banco) también se une, si el valor no es pequeño", () => {
    const t = tx("t", 100_000, "2026-10-24");
    const rec = reconcileStatement(card, [t], [line("L1", "2026-11-14", -100_001)], range);
    expect(rec.matched).toHaveLength(1);
    expect(rec.matched[0].dateGap).toBe(21);
  });

  it("valores bajos: sin el mismo comercio no basta (hay muchas compras de $5.000)", () => {
    const t = tx("t", 5_000, "2026-10-24", "Tinto Juan Valdez");
    expect(VALUE_ONLY_MIN).toBeGreaterThan(5_000);
    expect(reconcileStatement(card, [t], [line("L1", "2026-11-14", -5_000, "PANADERIA LA 85")], range).matched).toEqual([]);
    expect(reconcileStatement(card, [t], [line("L1", "2026-11-14", -5_000, "JUAN VALDEZ CALLE 85")], range).matched).toHaveLength(1);
  });

  it("uno a uno y el más cercano primero: dos líneas iguales y un movimiento", () => {
    const t = tx("t", 80_000, "2026-10-25");
    const lines = [line("L1", "2026-11-18", -80_000), line("L2", "2026-11-05", -80_000)];
    const rec = reconcileStatement(card, [t], lines, range);
    expect(rec.matched.map((m) => m.line.id)).toEqual(["L2"]);
    expect(rec.missing.map((l) => l.id)).toEqual(["L1"]);
  });

  it("lo que ya cruzó por fecha no se reasigna; esas parejas no llevan dateGap", () => {
    const a = tx("a", 80_000, "2026-11-05");
    const b = tx("b", 80_000, "2026-10-25");
    const lines = [line("L1", "2026-11-05", -80_000), line("L2", "2026-11-18", -80_000)];
    const rec = reconcileStatement(card, [a, b], lines, range);
    const by = Object.fromEntries(rec.matched.map((m) => [m.line.id, m]));
    expect(by.L1.entry?.tx.id).toBe("a");
    expect(by.L1.dateGap).toBeUndefined();
    expect(by.L2.entry?.tx.id).toBe("b");
    expect(by.L2.dateGap).toBe(24);
  });

  it("separar una pareja la deshace: la línea vuelve a faltar y el movimiento a sobrar", () => {
    const t = tx("t", 100_000, "2026-10-24");
    const lines = [line("L1", "2026-11-14", -100_000)];
    expect(reconcileStatement(card, [t], lines, range).matched).toHaveLength(1);
    const rec = reconcileStatement(card, [t], lines, range, 3, { apart: [{ lineId: "L1", txId: "t" }] });
    expect(rec.matched).toEqual([]);
    expect(rec.missing.map((l) => l.id)).toEqual(["L1"]);
    expect(rec.extra.map((e) => e.tx.id)).toEqual(["t"]);
  });

  it("separada de uno, la línea puede unirse con otro movimiento del mismo valor", () => {
    const t1 = tx("t1", 100_000, "2026-11-10");
    const t2 = tx("t2", 100_000, "2026-10-24");
    const lines = [line("L1", "2026-11-14", -100_000)];
    expect(reconcileStatement(card, [t1, t2], lines, range).matched[0].entry?.tx.id).toBe("t1");
    expect(reconcileStatement(card, [t1, t2], lines, range, 3, { apart: [{ lineId: "L1", txId: "t1" }] }).matched[0].entry?.tx.id).toBe("t2");
  });

  it("los vínculos a mano siguen funcionando con lo que quedó sin pareja", () => {
    const t = tx("t", 100_000, "2026-10-24");
    const rec = reconcileStatement(card, [t], [line("L1", "2026-11-14", -90_000)], range);
    const linked = withManualLinks(rec, [{ lineId: "L1", txId: "t" }], card, [t]);
    expect(linked.matched[0]).toMatchObject({ manual: true });
    expect(linked.missing).toEqual([]);
    expect(linked.extra).toEqual([]);
  });

  it("las líneas agrupadas (4x1000, intereses) no pasan por el cruce por valor", () => {
    const t = tx("t", 12_345, "2026-10-24", "Intereses corrientes");
    const interest = line("G:INT", "2026-11-14", -12_345, "INTERESES CORRIENTES");
    expect(reconcileStatement(card, [t], [interest], range).matched.every((m) => m.dateGap === undefined)).toBe(true);
  });

  it("sin partidas ni separaciones el resultado de siempre no cambia", () => {
    const t = tx("t", 100_000, "2026-11-05");
    const rec = reconcileStatement(card, [t], [line("L1", "2026-11-06", -100_000)], range);
    expect(rec.matched).toHaveLength(1);
    expect(rec.matched[0].dateGap).toBeUndefined();
    expect(rec.missing).toEqual([]);
    expect(rec.extra).toEqual([]);
  });
});
