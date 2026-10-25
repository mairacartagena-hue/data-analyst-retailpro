import { describe, expect, it } from "vitest";
import {
  classifyExpense, ledgerEntriesForExpense, netFor, owedByPartner, owedToPartner, settlementEntry,
  suggestSettlement, unassigned, validateSplits, type LedgerEntry,
} from "@/lib/finance/crossLedger";

const A = "user-a";
const B = "user-b";

describe("motor de cruce", () => {
  it("caso 1: pagó el mismo responsable, no toca el cruce", () => {
    const splits = [{ amount: 50000, categoryId: "mercado", responsibleUserId: A }];
    expect(classifyExpense(A, splits)).toBe("NORMAL");
    expect(ledgerEntriesForExpense(A, splits)).toEqual([]);
  });

  it("caso 2: pagado por A, corresponde a B, asiento por el 100 %", () => {
    const splits = [{ amount: 120000, categoryId: "internet", responsibleUserId: B }];
    expect(classifyExpense(A, splits)).toBe("CROSS_PAYMENT");
    expect(ledgerEntriesForExpense(A, splits)).toEqual([
      { creditorUserId: A, debtorUserId: B, amount: 120000, kind: "CROSS_PAYMENT" },
    ]);
  });

  it("caso 3: supermercado de 200.000, 165.000 de A y 35.000 de B", () => {
    const splits = [
      { amount: 165000, categoryId: "mercado", responsibleUserId: A },
      { amount: 35000, categoryId: null, responsibleUserId: B },
    ];
    expect(validateSplits(200000, splits)).toBeNull();
    expect(classifyExpense(A, splits)).toBe("SPLIT");
    expect(ledgerEntriesForExpense(A, splits)).toEqual([
      { creditorUserId: A, debtorUserId: B, amount: 35000, kind: "SPLIT" },
    ]);
  });

  it("el desglose debe sumar exactamente el total", () => {
    const parts = [{ amount: 150000, categoryId: null, responsibleUserId: A }];
    expect(validateSplits(200000, parts)).toBe("Faltan 50.000 pesos por asignar.");
    expect(validateSplits(100000, parts)).toBe("Te pasaste por 50.000 pesos.");
    expect(unassigned(200000, parts)).toBe(50000);
    expect(validateSplits(1000, [{ amount: 1000.5, categoryId: null, responsibleUserId: A }])).toMatch(/mayor que cero/);
  });

  it("excedente de montos fijos queda marcado como tal", () => {
    const splits = [
      { amount: 500000, categoryId: "arriendo", responsibleUserId: A },
      { amount: 100000, categoryId: "arriendo", responsibleUserId: B, origin: "FIXED_EXCESS" as const },
    ];
    expect(ledgerEntriesForExpense(A, splits)[0].kind).toBe("FIXED_EXCESS");
  });

  it("neto, deudas y liquidación", () => {
    const entries: LedgerEntry[] = [
      { creditorUserId: A, debtorUserId: B, amount: 35000, kind: "SPLIT" },
      { creditorUserId: B, debtorUserId: A, amount: 120000, kind: "CROSS_PAYMENT" },
      { creditorUserId: A, debtorUserId: B, amount: 15000, kind: "LOAN" },
    ];
    expect(netFor(A, entries)).toBe(-70000);
    expect(owedToPartner(A, entries)).toBe(70000);
    expect(owedByPartner(A, entries)).toBe(0);
    expect(owedByPartner(B, entries)).toBe(70000);

    const s = suggestSettlement(A, B, entries);
    expect(s).toEqual({ payerUserId: A, receiverUserId: B, amount: 70000 });
    const after = [...entries, settlementEntry(s!.payerUserId, s!.receiverUserId, s!.amount)];
    expect(netFor(A, after)).toBe(0);
    expect(suggestSettlement(A, B, after)).toBeNull();
  });
});

describe("deudas a mi favor que siguen abiertas", () => {
  const ME = "me";
  const HE = "he";
  let n = 0;
  const row = (creditor: string, amount: number, date: string, extra: Record<string, unknown> = {}) => ({
    id: `r${++n}`, creditor_user_id: creditor, debtor_user_id: creditor === ME ? HE : ME, amount, kind: "LOAN" as const,
    description: null, occurred_on: date, created_at: `${date}T10:00:00Z`, ...extra,
  });

  it("lista cada deuda con lo que queda", async () => {
    const { openDebtsInFavor } = await import("@/lib/finance/crossLedger");
    const a = row(ME, 300_000, "2026-10-01", { description: "Envío para una compra" });
    const b = row(ME, 50_000, "2026-10-05");
    expect(openDebtsInFavor([a, b], ME).map((d) => [d.id, d.remaining])).toEqual([[a.id, 300_000], [b.id, 50_000]]);
  });

  it("un pago o perdón que apunta a una deuda baja esa, no otra", async () => {
    const { openDebtsInFavor } = await import("@/lib/finance/crossLedger");
    const a = row(ME, 300_000, "2026-10-01");
    const b = row(ME, 50_000, "2026-10-05");
    const forgive = row(HE, 50_000, "2026-10-06", { kind: "FORGIVEN", resolves_id: b.id });
    expect(openDebtsInFavor([a, b, forgive], ME).map((d) => [d.id, d.remaining])).toEqual([[a.id, 300_000]]);
    const partial = row(HE, 120_000, "2026-10-07", { kind: "PAYMENT", resolves_id: a.id });
    expect(openDebtsInFavor([a, b, partial], ME).map((d) => [d.id, d.remaining])).toEqual([[a.id, 180_000], [b.id, 50_000]]);
  });

  it("lo que él pone a su favor sin apuntar a nada (su liquidación, una compra a mi cargo) baja las más antiguas primero", async () => {
    const { openDebtsInFavor } = await import("@/lib/finance/crossLedger");
    const a = row(ME, 100_000, "2026-10-01");
    const b = row(ME, 100_000, "2026-10-02");
    const compra = row(HE, 150_000, "2026-10-03", { kind: "CROSS_PAYMENT" });
    expect(openDebtsInFavor([a, b, compra], ME).map((d) => [d.id, d.remaining])).toEqual([[b.id, 50_000]]);
  });

  it("el total abierto coincide con el neto del cruce", async () => {
    const { openDebtsInFavor, netFor } = await import("@/lib/finance/crossLedger");
    const rows = [row(ME, 300_000, "2026-10-01"), row(HE, 120_000, "2026-10-02", { kind: "CROSS_PAYMENT" }), row(ME, 40_000, "2026-10-03"), row(HE, 10_000, "2026-10-04", { kind: "FORGIVEN" })];
    const entries = rows.map((r) => ({ creditorUserId: r.creditor_user_id, debtorUserId: r.debtor_user_id, amount: r.amount, kind: r.kind }));
    expect(openDebtsInFavor(rows, ME).reduce((a, d) => a + d.remaining, 0)).toBe(netFor(ME, entries));
  });

  it("si yo le debo a él no hay deudas abiertas a mi favor; y lo que le debía antes se descuenta de lo que le presto después (neto)", async () => {
    const { openDebtsInFavor } = await import("@/lib/finance/crossLedger");
    expect(openDebtsInFavor([row(HE, 80_000, "2026-10-01")], ME)).toEqual([]);
    const owed = row(HE, 80_000, "2026-10-01");
    const lent = row(ME, 100_000, "2026-10-02");
    expect(openDebtsInFavor([owed, lent], ME).map((d) => d.remaining)).toEqual([20_000]); // 100.000 − 80.000, igual que el neto
  });
});
