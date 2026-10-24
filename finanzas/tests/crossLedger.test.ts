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
