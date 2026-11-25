import { describe, expect, it } from "vitest";
import { cycleRange } from "@/lib/finance/reconcile";
import { appCandidatesFor, carryOverStatus, classifyLine, lineCandidatesFor, reconcileStatement, withManualLinks, type StatementLine } from "@/lib/finance/statement";
import type { Account, ReconcilingItem, Transaction } from "@/lib/types";

const card: Account = {
  id: "bbva", household_id: "h", owner_user_id: "u1", name: "BBVA", kind: "CREDIT_CARD", institution: "BBVA", last4: "0602",
  visibility: "PRIVATE", reveal_in_shared: false, opening_balance: -8_000_000, opening_at: "2026-10-01T05:00:00Z",
  credit_limit: null, statement_day: 20, due_day: 5, archived: false,
};
const tx = (id: string, amount: number, occurred_on: string, description = id, account_id = "bbva"): Transaction => ({
  id, kind: "EXPENSE", status: "CONFIRMED", occurred_on, amount, description, merchant: null, account_id, to_account_id: null,
  payer_user_id: "u1", counterparty_user_id: null, is_shared: false, scope: "PERSONAL", creates_debt: true, source: "MANUAL", tags: [],
  created_by: "u1", created_at: `${occurred_on}T15:00:00Z`, installments: 1, splits: [],
} as Transaction);
const line = (id: string, date: string, amount: number, description = "COMPRA"): StatementLine =>
  ({ id, date, amount, description, balance: null, kind: classifyLine(description, amount) });

const range = cycleRange(20, "2026-11"); // 21-oct a 20-nov
// El banco cobró 190.000 por "REST EL CORRAL" y en la app se registró 180.000 como "Almuerzo": no se unen solos (valor y nombre distintos)
const txs = [tx("almuerzo", 180_000, "2026-11-03", "Almuerzo"), tx("mercado", 95_000, "2026-11-06", "Mercado"), tx("otra", 40_000, "2026-11-30", "Otra", "ahorros")];
const lines = [line("L2", "2026-11-04", -190_000, "REST EL CORRAL"), line("L3", "2026-11-06", -95_000, "MERCADO EXITO")];
const auto = reconcileStatement(card, txs, lines, range);

describe("el cruce automático no une lo que cambia de valor y de nombre", () => {
  it("queda como falta en la app y sobra en la app", () => {
    expect(auto.matched.map((m) => m.line.id)).toEqual(["L3"]);
    expect(auto.missing.map((l) => l.id)).toEqual(["L2"]);
    expect(auto.extra.map((e) => e.tx.id)).toEqual(["almuerzo"]);
  });
});

describe("vínculos manuales", () => {
  it("la pareja pasa a emparejada y sale de las dos listas", () => {
    const r = withManualLinks(auto, [{ lineId: "L2", txId: "almuerzo" }], card, txs);
    expect(r.matched.map((m) => m.line.id).sort()).toEqual(["L2", "L3"]);
    expect(r.matched.find((m) => m.line.id === "L2")).toMatchObject({ manual: true, entry: { amount: -180_000 } });
    expect(r.missing).toEqual([]);
    expect(r.extra).toEqual([]);
    expect(r.outOfRange).toBe(auto.outOfRange);
  });

  it("sin vínculos devuelve lo mismo y no toca el original", () => {
    expect(withManualLinks(auto, [], card, txs)).toBe(auto);
    withManualLinks(auto, [{ lineId: "L2", txId: "almuerzo" }], card, txs);
    expect(auto.missing).toHaveLength(1);
  });

  it("ignora vínculos a líneas o movimientos que no existen o que ya tienen pareja, y repetidos", () => {
    const r = withManualLinks(auto, [
      { lineId: "L9", txId: "almuerzo" }, // línea inexistente
      { lineId: "L2", txId: "borrado" }, // movimiento inexistente
      { lineId: "L3", txId: "almuerzo" }, // L3 ya estaba emparejada sola: no está entre las que faltan
      { lineId: "L2", txId: "almuerzo" },
      { lineId: "L2", txId: "mercado" }, // L2 ya vinculada
    ], card, txs);
    expect(r.matched.filter((m) => m.manual).map((m) => m.entry?.tx.id)).toEqual(["almuerzo"]);
  });

  it("una partida del cierre anterior vinculada a mano cuenta como encontrada", () => {
    const item: ReconcilingItem = { transaction_id: "almuerzo", amount: -180_000, description: "Almuerzo", occurred_on: "2026-11-03" };
    expect(carryOverStatus([item], txs, auto, range)[0].status).toBe("NOT_FOUND");
    const linked = withManualLinks(auto, [{ lineId: "L2", txId: "almuerzo" }], card, txs);
    expect(carryOverStatus([item], txs, linked, range)[0].status).toBe("FOUND");
  });

  it("un duplicado que se vincula deja de aparecer como duplicado", () => {
    const dup = tx("dup", 95_000, "2026-11-06", "Mercado otra vez");
    const all = [...txs, dup];
    const a = reconcileStatement(card, all, [...lines, line("L4", "2026-11-12", -50_000, "OTRA COSA")], range);
    // Cuál de los dos de $95.000 queda como el repetido lo decide el orden; lo que importa es que el repetido deje de serlo
    expect(a.duplicates).toHaveLength(1);
    const repeated = a.duplicates[0].entry.tx.id;
    const r = withManualLinks(a, [{ lineId: "L4", txId: repeated }], card, all);
    expect(r.duplicates).toEqual([]);
    expect(r.matched.find((m) => m.manual)?.entry?.tx.id).toBe(repeated);
  });

  it("las líneas agrupadas (intereses) no se vinculan una a una", () => {
    const g = line("G:INTEREST_OUT|2026-11", "2026-11-20", -30_000, "INTERESES");
    const rec = { ...auto, missing: [...auto.missing, g] };
    const r = withManualLinks(rec, [{ lineId: g.id, txId: "almuerzo" }], card, txs);
    expect(r).toBe(rec);
  });
});

describe("candidatos para vincular", () => {
  it("de la app para una línea: mismo sentido, hasta 10 días, sin pareja; los más parecidos primero", () => {
    const more = [...txs,
      tx("cerca", 188_000, "2026-11-05", "Cerca"), tx("lejos", 190_000, "2026-11-25", "Lejos"), tx("pago", 190_000, "2026-11-04", "Pago"),
      tx("ya-unido", 190_000, "2026-11-04", "Ya unido"),
    ];
    // "pago" entra (ingreso): sentido contrario
    (more.find((t) => t.id === "pago") as Transaction).kind = "INCOME";
    const rec = { ...auto, matched: [...auto.matched, { line: line("L9", "2026-11-04", -190_000), entry: { tx: more.find((t) => t.id === "ya-unido")!, amount: -190_000, date: "2026-11-04" } }] };
    const out = appCandidatesFor(auto.missing[0], card, more, rec);
    expect(out.map((e) => e.tx.id)).toEqual(["cerca", "almuerzo"]);
    expect(out.every((e) => e.tx.account_id === "bbva")).toBe(true);
  });

  it("incluye movimientos de fuera del mes (el banco puede fecharlo en otro ciclo)", () => {
    const fuera = tx("fuera", 190_000, "2026-10-19", "Fuera del ciclo");
    const l = line("L5", "2026-10-22", -190_000, "REST EL CORRAL");
    expect(appCandidatesFor(l, card, [fuera], { ...auto, matched: [] }).map((e) => e.tx.id)).toEqual(["fuera"]);
  });

  it("de la extracto para un movimiento: líneas que faltan, mismo sentido, cercanas; sin agrupadas", () => {
    const rec = { ...auto, missing: [
      line("L2", "2026-11-04", -190_000), line("L7", "2026-11-25", -180_000), line("L8", "2026-11-03", +180_000, "ABONO"),
      line("G:FEE|2026-11", "2026-11-20", -20_000, "CUOTA DE MANEJO"), line("L6", "2026-11-03", -181_000),
    ] };
    const entry = { tx: txs[0], amount: -180_000, date: "2026-11-03" };
    expect(lineCandidatesFor(entry, rec).map((l) => l.id)).toEqual(["L6", "L2"]);
  });
});
