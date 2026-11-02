import { describe, expect, it } from "vitest";
import { accountStatement, gmfEstimate, inCloseWindow, monthRange, reconciliationDrift, shiftMonth, suggestedCloseMonth } from "@/lib/finance/reconcile";
import type { Account, Transaction } from "@/lib/types";

const acc: Account = {
  id: "bc", household_id: "h", owner_user_id: "a", name: "Bancolombia", kind: "DEPOSIT", institution: "Bancolombia", last4: "2505",
  visibility: "PRIVATE", reveal_in_shared: false, opening_balance: 2_365_000, opening_at: "2026-10-24T06:00:00Z",
  credit_limit: null, statement_day: null, due_day: null, archived: false,
};
const tx = (p: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36), kind: "EXPENSE", status: "CONFIRMED", occurred_on: "2026-10-24", amount: 0, description: null,
  merchant: null, account_id: "bc", to_account_id: null, payer_user_id: "a", counterparty_user_id: null, is_shared: false,
  source: "MANUAL", tags: [], created_by: "a", created_at: "", splits: [], scope: "PERSONAL", creates_debt: true, ...p,
});

describe("cierre del mes", () => {
  it("rangos de mes", () => {
    expect(monthRange("2026-02")).toEqual({ month: "2026-02", start: "2026-02-01", end: "2026-02-28" });
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("cuenta creada a mitad de mes: el cierre incluye todo el mes y cuadra con el saldo de hoy", () => {
    const txs = [
      tx({ kind: "INCOME", amount: 6_044_772, occurred_on: "2026-10-23", occurred_at: "2026-10-23T15:07:00Z", source: "GMAIL" }), // antes de crear la cuenta
      tx({ amount: 838_058, occurred_on: "2026-10-23", occurred_at: "2026-10-23T15:51:02Z", source: "GMAIL" }), // antes
      tx({ amount: 200_000, occurred_on: "2026-10-24" }), // manual, después
      tx({ kind: "INCOME", amount: 100_000, occurred_on: "2026-10-25", occurred_at: "2026-10-25T18:00:00Z" }),
      tx({ kind: "TRANSFER", amount: 50_000, account_id: "nequi", to_account_id: "bc", occurred_on: "2026-10-26" }),
      tx({ amount: 999, occurred_on: "2026-11-02" }), // otro mes
    ];
    const st = accountStatement(acc, txs, monthRange("2026-10"));
    // Al 1 de octubre: 2.365.000 − 6.044.772 (entró antes del saldo) + 838.058 (salió antes del saldo)
    expect(st.opening).toBe(2_365_000 - 6_044_772 + 838_058);
    expect(st.inflow).toBe(6_044_772 + 150_000);
    expect(st.outflow).toBe(838_058 + 200_000);
    // El cierre coincide con el saldo de la app: saldo inicial + lo posterior a crear la cuenta
    expect(st.closing).toBe(2_365_000 - 200_000 + 100_000 + 50_000);
    expect(st.items).toHaveLength(5);
  });

  it("el saldo inicial del mes siguiente arrastra lo del mes anterior", () => {
    const st = accountStatement(acc, [tx({ amount: 200_000, occurred_on: "2026-10-24" })], monthRange("2026-11"));
    expect(st.opening).toBe(2_165_000);
    expect(st.items).toHaveLength(0);
  });

  it("4x1000: gravada, exenta (350 UVT) y bajo monto (65 UVT)", () => {
    const uvt = 52_374;
    expect(gmfEstimate(1_000_000, "TAXED", uvt)).toBe(4_000);
    expect(gmfEstimate(10_000_000, "EXEMPT_350", uvt)).toBe(0); // tope ≈ $18.330.900
    expect(gmfEstimate(20_000_000, "EXEMPT_350", uvt)).toBe(Math.round((20_000_000 - 350 * uvt) * 0.004));
    expect(gmfEstimate(4_000_000, "LOW_AMOUNT_65", uvt)).toBe(Math.round((4_000_000 - 65 * uvt) * 0.004));
  });

  it("el 4x1000 ya registrado no se vuelve a sumar a la base", () => {
    const st = accountStatement(acc, [
      tx({ amount: 1_000_000, occurred_on: "2026-10-25" }),
      tx({ amount: 4_000, occurred_on: "2026-10-31", tags: ["#gmf"] }),
    ], monthRange("2026-10"));
    expect(st.gmfBase).toBe(1_000_000);
    expect(st.gmfRecorded).toBe(4_000);
  });

  it("recordatorio: últimos 3 días y primeros 5", () => {
    expect(inCloseWindow("2026-10-29")).toBe(true);
    expect(inCloseWindow("2026-10-28")).toBe(false);
    expect(inCloseWindow("2026-11-05")).toBe(true);
    expect(suggestedCloseMonth("2026-11-03")).toBe("2026-10");
    expect(suggestedCloseMonth("2026-10-30")).toBe("2026-10");
  });
});

describe("cuenta conciliada que se mueve después", () => {
  const credit: Account = { ...acc, id: "lulo", kind: "CREDIT", opening_balance: -17_972_309, opening_at: "2026-10-26T05:00:00Z" };
  const rec = { month: "2026-10-01", status: "RECONCILED" as const, statement_balance: -17_972_309, updated_at: "2026-10-27T01:42:08Z" };
  const old = [tx({ account_id: null, to_account_id: "lulo", kind: "TRANSFER", amount: 838_058, occurred_on: "2026-10-23", created_at: "2026-10-24T07:00:00Z" })];

  it("sin cambios después de conciliar: no hay aviso", () => {
    expect(reconciliationDrift(credit, old, rec)).toBeNull();
  });

  it("un movimiento de antes del corte registrado después: avisa la diferencia y cuál fue", () => {
    const late = tx({ account_id: "lulo", kind: "ADJUSTMENT", direction: "OUT", amount: 78_203, occurred_on: "2026-10-26", created_at: "2026-11-02T15:00:00Z" });
    const d = reconciliationDrift(credit, [...old, late], rec)!;
    expect(d.drift).toBe(-78_203);
    expect(d.cutoff).toBe("2026-10-26"); // se concilió el 26 en Bogotá, antes de terminar el mes
    expect(d.changed.map((t) => t.id)).toEqual([late.id]);
  });

  it("movimientos después del corte no descuadran la conciliación", () => {
    const next = tx({ account_id: null, to_account_id: "lulo", kind: "TRANSFER", amount: 900_000, occurred_on: "2026-11-01", created_at: "2026-11-01T15:00:00Z" });
    expect(reconciliationDrift(credit, [...old, next], rec)).toBeNull();
  });

  it("cambiar el saldo inicial después de conciliar también avisa", () => {
    expect(reconciliationDrift({ ...credit, opening_balance: -18_000_000 }, old, rec)?.drift).toBe(-27_691);
  });
});
