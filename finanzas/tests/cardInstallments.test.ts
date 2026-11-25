import { describe, expect, it } from "vitest";
import { billingCut } from "@/lib/finance/installments";
import { checkInstallments, type ExtractPurchase } from "@/lib/finance/cardStatements";
import type { Account, CardStatementItem, Transaction } from "@/lib/types";

// Tarjeta con corte el 20 y pago el 5, registrada con el extracto del 20-oct.
const account: Account = {
  id: "visa", household_id: "h", owner_user_id: "u1", name: "Visa", kind: "CREDIT_CARD", institution: "BBVA", last4: "0602",
  visibility: "PRIVATE", reveal_in_shared: false, opening_balance: -1_000_000, opening_at: "2026-10-21T05:00:00+00:00",
  credit_limit: null, statement_day: 20, due_day: 5, interest_rate_ea: 0, archived: false,
};
const tx = (over: Partial<Transaction>): Transaction => ({
  id: "t1", kind: "EXPENSE", status: "CONFIRMED", occurred_on: "2026-10-24", amount: 200_000, description: "Mercado", merchant: null,
  account_id: "visa", to_account_id: null, payer_user_id: "u1", counterparty_user_id: null, is_shared: false, scope: "PERSONAL",
  creates_debt: true, source: "MANUAL", tags: [], created_by: "u1", created_at: "2026-10-24T12:00:00Z", installments: 1, splits: [], ...over,
} as Transaction);
const item = (over: Partial<CardStatementItem> = {}): CardStatementItem => ({
  id: "nevera", account_id: "visa", description: "NEVERA", purchase_date: "2026-08-25", amount: 700_000, installments: 7,
  paid_installments: 1, remaining_balance: 600_000, rate_ea: 0, ...over,
});
const tv = tx({ id: "tv", description: "TV", amount: 300_000, installments: 3, occurred_on: "2026-10-24" });
const p = (over: Partial<ExtractPurchase> = {}): ExtractPurchase => ({
  description: "TV", purchaseDate: "2026-10-24", amount: 300_000, installments: 3, paidInstallments: 1, remainingBalance: 200_000, ...over,
});

describe("corte que factura una compra", () => {
  it("el primer corte desde la fecha; el mismo día del corte entra", () => {
    expect(billingCut(20, "2026-10-24")).toBe("2026-11-20");
    expect(billingCut(20, "2026-10-20")).toBe("2026-10-20");
    expect(billingCut(20, "2026-12-22")).toBe("2027-01-20");
    expect(billingCut(31, "2026-11-10")).toBe("2026-11-30");
  });
});

describe("cuotas del extracto contra la app", () => {
  it("una compra del app que cuadra en total, cuota y saldo", () => {
    const [c] = checkInstallments(account, [tv], [], [p()], "2026-11-20");
    expect(c).toMatchObject({ verdict: "OK", source: "APP", diffs: [] });
    const [d] = checkInstallments(account, [tv], [], [p({ paidInstallments: 2, remainingBalance: 100_000 })], "2026-12-20");
    expect(d.verdict).toBe("OK");
  });

  it("distinto total de cuotas: solo se informa eso", () => {
    const [c] = checkInstallments(account, [tv], [], [p({ installments: 6, remainingBalance: 250_000 })], "2026-11-20");
    expect(c.verdict).toBe("DIFFERS");
    expect(c.diffs).toEqual([{ field: "installments", app: 3, extract: 6 }]);
  });

  it("una compra sin cuotas en la app (1) que el banco difirió se detecta", () => {
    const sin = tx({ id: "tv", amount: 300_000, installments: 1, occurred_on: "2026-10-24" });
    const [c] = checkInstallments(account, [sin], [], [p()], "2026-11-20");
    expect(c.diffs).toEqual([{ field: "installments", app: 1, extract: 3 }]);
  });

  it("otra cuota que la que debería facturarse", () => {
    const [c] = checkInstallments(account, [tv], [], [p({ paidInstallments: 2 })], "2026-11-20");
    expect(c.diffs).toEqual([{ field: "current", app: 1, extract: 2 }]);
  });

  it("el saldo pendiente se compara con tolerancia de $1.000", () => {
    expect(checkInstallments(account, [tv], [], [p({ remainingBalance: 199_500 })], "2026-11-20")[0].verdict).toBe("OK");
    const [c] = checkInstallments(account, [tv], [], [p({ remainingBalance: 150_000 })], "2026-11-20");
    expect(c.diffs).toEqual([{ field: "balance", app: 200_000, extract: 150_000 }]);
  });

  it("la compra del extracto que no está en la app ni en la tarjeta", () => {
    const [c] = checkInstallments(account, [], [], [p({ description: "LAVADORA", amount: 900_000, purchaseDate: "2026-10-30" })], "2026-11-20");
    expect(c.verdict).toBe("ONLY_EXTRACT");
  });

  it("una compra del extracto ya guardada en la tarjeta se compara con lo guardado", () => {
    // NEVERA: cuota 1 en el extracto del 20-oct; en el del 20-nov va la cuota 2 y quedan 500.000
    const bien = p({ description: "NEVERA", purchaseDate: "2026-08-25", amount: 700_000, installments: 7, paidInstallments: 2, remainingBalance: 500_000 });
    const [c] = checkInstallments(account, [], [item()], [bien], "2026-11-20");
    expect(c).toMatchObject({ verdict: "OK", source: "ITEM" });
    const [d] = checkInstallments(account, [], [item()], [{ ...bien, installments: 12 }], "2026-11-20");
    expect(d.diffs).toEqual([{ field: "installments", app: 7, extract: 12 }]);
    const [e] = checkInstallments(account, [], [item()], [{ ...bien, paidInstallments: 3, remainingBalance: 400_000 }], "2026-11-20");
    expect(e.diffs.map((x) => x.field)).toEqual(["current", "balance"]);
  });

  it("si la compra está guardada en la tarjeta, manda sobre el movimiento de la app", () => {
    const igual = tx({ id: "nev", description: "NEVERA", amount: 700_000, installments: 2, occurred_on: "2026-08-25" });
    const bien = p({ description: "NEVERA", purchaseDate: "2026-08-25", amount: 700_000, installments: 7, paidInstallments: 2, remainingBalance: 500_000 });
    const [c] = checkInstallments(account, [igual], [item()], [bien], "2026-11-20");
    expect(c).toMatchObject({ verdict: "OK", source: "ITEM" });
  });

  it("una compra a cuotas de la app que ya debería venir en el extracto y no viene", () => {
    const ml = tx({ id: "ml", description: "Mercado Libre", amount: 600_000, installments: 6, occurred_on: "2026-10-25" });
    const out = checkInstallments(account, [tv, ml], [], [p()], "2026-11-20");
    expect(out.map((c) => [c.verdict, c.tx?.id ?? c.purchase?.description])).toEqual([["ONLY_APP", "ml"], ["OK", "tv"]]);
  });

  it("no avisa de compras a una cuota, posteriores al corte, anteriores a la tarjeta, pagadas por completo ni en su última cuota", () => {
    const una = tx({ id: "una", amount: 90_000, installments: 1, occurred_on: "2026-10-25" });
    const despues = tx({ id: "despues", amount: 600_000, installments: 6, occurred_on: "2026-11-25" });
    const antes = tx({ id: "antes", amount: 600_000, installments: 6, occurred_on: "2026-09-10" });
    const mercado = tx({ id: "ml", amount: 600_000, installments: 6, occurred_on: "2026-10-25" });
    const pago = tx({ id: "pago", kind: "TRANSFER", account_id: "bank", to_account_id: "visa", amount: 600_000, pays_off_id: "ml", occurred_on: "2026-11-10", installments: 1 });
    expect(checkInstallments(account, [una, despues, antes, mercado, pago], [], [], "2026-11-20")).toEqual([]);
    // dos cuotas: en el corte del 20-ene ya se facturó la última y el extracto no la lista
    const dos = tx({ id: "dos", amount: 200_000, installments: 2, occurred_on: "2026-10-25" });
    expect(checkInstallments(account, [dos], [], [], "2027-01-20")).toEqual([]);
    expect(checkInstallments(account, [dos], [], [], "2026-11-20").map((c) => c.verdict)).toEqual(["ONLY_APP"]);
  });

  it("sin fecha de corte o sin día de corte solo compara el total de cuotas", () => {
    const [a] = checkInstallments(account, [tv], [], [p({ paidInstallments: 9, remainingBalance: 1 })], null);
    expect(a.verdict).toBe("OK");
    const sinDia = { ...account, statement_day: null };
    const [b] = checkInstallments(sinDia, [tv], [], [p({ paidInstallments: 9, remainingBalance: 1 })], "2026-11-20");
    expect(b.verdict).toBe("OK");
    expect(checkInstallments(sinDia, [tv], [], [p({ installments: 5 })], "2026-11-20")[0].diffs).toEqual([{ field: "installments", app: 3, extract: 5 }]);
    // y sin día de corte no se puede saber qué debería venir en el extracto
    expect(checkInstallments(sinDia, [tv], [], [], "2026-11-20")).toEqual([]);
  });

  it("de varias compras iguales toma la de la fecha más cercana", () => {
    const lejos = tx({ id: "lejos", description: "TV", amount: 300_000, installments: 6, occurred_on: "2026-10-25" });
    const cerca = tx({ id: "cerca", description: "TV", amount: 300_000, installments: 3, occurred_on: "2026-10-24" });
    const out = checkInstallments(account, [lejos, cerca], [], [p()], "2026-11-20");
    expect(out.find((c) => c.purchase)?.tx?.id).toBe("cerca");
    // la otra queda como compra a cuotas de la app que no viene en el extracto
    expect(out.find((c) => !c.purchase)).toMatchObject({ verdict: "ONLY_APP" });
  });

  it("ordena primero lo que difiere", () => {
    const out = checkInstallments(account, [tv], [], [p(), p({ description: "OTRA", amount: 77_000, purchaseDate: "2026-10-26" }), p({ installments: 6, amount: 300_000 })], "2026-11-20");
    expect(out.map((c) => c.verdict)).toEqual(["DIFFERS", "ONLY_EXTRACT", "OK"]);
  });
});
