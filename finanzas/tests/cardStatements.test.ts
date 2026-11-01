import { describe, expect, it } from "vitest";
import { projectCard } from "@/lib/finance/installments";
import { legacySchedule } from "@/lib/finance/cardBudget";
import { appDebtAt, checkStatement, knownItem, registeredTx, squares } from "@/lib/finance/cardStatements";
import type { Account, CardStatement, CardStatementItem, Transaction } from "@/lib/types";

// Tarjeta registrada con el extracto del 20-oct: deuda 1.000.000, de la que 600.000 es una compra a 6 cuotas sin facturar.
const account: Account = {
  id: "visa", household_id: "h", owner_user_id: "u1", name: "Visa", kind: "CREDIT_CARD", institution: "BBVA", last4: "0602",
  visibility: "PRIVATE", reveal_in_shared: false, opening_balance: -1_000_000, opening_at: "2026-10-21T05:00:00+00:00",
  credit_limit: null, statement_day: 20, due_day: 5, interest_rate_ea: 0, archived: false,
};
const item = (over: Partial<CardStatementItem> = {}): CardStatementItem => ({
  id: "nevera", account_id: "visa", description: "NEVERA", purchase_date: "2026-08-25", amount: 700_000, installments: 7,
  paid_installments: 1, remaining_balance: 600_000, rate_ea: 0, ...over,
});
const tx = (over: Partial<Transaction>): Transaction => ({
  id: "t1", kind: "EXPENSE", status: "CONFIRMED", occurred_on: "2026-10-24", amount: 200_000, description: "Mercado", merchant: null,
  account_id: "visa", to_account_id: null, payer_user_id: "u1", counterparty_user_id: null, is_shared: false, scope: "PERSONAL",
  creates_debt: true, source: "MANUAL", tags: [], created_by: "u1", created_at: "2026-10-24T12:00:00Z", installments: 1, splits: [], ...over,
});
const card = { id: "visa", statement_day: 20, due_day: 5, opening_at: account.opening_at, opening_balance: -1_000_000, interest_rate_ea: 0 };
const st = (over: Partial<CardStatement>): CardStatement => ({
  account_id: "visa", cut_date: "2026-10-20", due_date: "2026-11-05", minimum_payment: 400_000, total_payment: 1_000_000,
  total_debt: 1_000_000, ...over,
});

describe("proyección por compra", () => {
  it("cada mes dice qué compra y qué cuota se paga", () => {
    const p = projectCard(card, [tx({ id: "tv", description: "TV", amount: 300_000, installments: 3 })], "2026-11-01", 3, [item()]);
    expect(p[0].lines.map((l) => [l.source, l.capital])).toEqual([["STATEMENT", 400_000]]);
    const dec = p[1].lines.map((l) => `${l.label} ${l.no}/${l.of}`).sort();
    expect(dec).toEqual(["NEVERA 2/7", "TV 1/3"]);
    expect(p[2].lines.map((l) => `${l.label} ${l.no}/${l.of}`).sort()).toEqual(["NEVERA 3/7", "TV 2/3"]);
    expect(p[1].capital).toBe(100_000 + 100_000);
  });

  it("una compra de un extracto posterior empieza a facturarse después de ese corte", () => {
    const later = item({ id: "moto", description: "CDA MOTOS", purchase_date: "2026-10-24", amount: 200_000, installments: 2, paid_installments: 1, remaining_balance: 100_000, as_of: "2026-11-20" });
    const p = projectCard(card, [], "2026-11-01", 4, [later]);
    // corte 20-nov ya facturó la cuota 1; la 2 se factura el 20-dic y se paga el 5-ene
    expect(p.map((m) => m.lines.filter((l) => l.key.startsWith("moto")).map((l) => l.no))).toEqual([[], [], [2], []]);
  });

  it("las compras de extractos posteriores no son deuda anterior de la tarjeta", () => {
    const later = item({ id: "moto", as_of: "2026-11-20", remaining_balance: 100_000 });
    const withLater = legacySchedule(card, [item(), later]);
    expect(withLater).toEqual(legacySchedule(card, [item()]));
  });
});

describe("cruce con el extracto", () => {
  it("la cuota del mes cuadra con el pago mínimo y la deuda con la del extracto", () => {
    const c = checkStatement(account, [], [item()], st({}));
    expect(c.projected).toBe(400_000);
    expect(c.minimumDiff).toBe(0);
    expect(c.appDebt).toBe(1_000_000);
    expect(c.debtDiff).toBe(0);
    expect(squares(c.minimumDiff) && squares(c.debtDiff)).toBe(true);
  });

  it("el extracto siguiente: cuota de la compra + compras del mes contra el mínimo; la deuda incluye lo comprado", () => {
    const txs = [tx({ id: "m", amount: 200_000 }), tx({ id: "pago", kind: "TRANSFER", account_id: "nomina", to_account_id: "visa", amount: 400_000, occurred_on: "2026-11-05" })];
    const c = checkStatement(account, txs, [item()], st({ cut_date: "2026-11-20", due_date: "2026-12-05", minimum_payment: 300_000, total_debt: 750_000 }));
    expect(c.projected).toBe(300_000); // 100.000 de la nevera + 200.000 del mercado
    expect(c.minimumDiff).toBe(0);
    expect(c.appDebt).toBe(800_000); // 1.000.000 + 200.000 − 400.000
    expect(c.debtDiff).toBe(50_000);
    expect(squares(c.debtDiff)).toBe(false);
  });

  it("deuda de la app a una fecha", () => {
    expect(appDebtAt(account, [tx({ occurred_on: "2026-12-01" })], "2026-11-20")).toBe(1_000_000);
  });
});

describe("compras del PDF que ya están", () => {
  const p = { description: "Nevera", purchaseDate: "2026-08-25", amount: 700_000 };
  it("como compra del extracto (mismo comercio y valor) o registrada en la app (valor y fecha)", () => {
    expect(knownItem(p, [item()], "visa")?.id).toBe("nevera");
    expect(knownItem({ ...p, amount: 1 }, [item()], "visa")).toBeUndefined();
    expect(registeredTx({ description: "x", purchaseDate: "2026-10-25", amount: 200_000 }, [tx({})], "visa")?.id).toBe("t1");
    expect(registeredTx({ description: "x", purchaseDate: "2026-10-28", amount: 200_000 }, [tx({})], "visa")).toBeUndefined();
  });
});

describe("fechas del cruce a mano", () => {
  it("propone el último corte que ya pasó y su fecha de pago", async () => {
    const { cutAndDue, lastCutMonth } = await import("@/components/CardStatements");
    expect(cutAndDue({ statement_day: 20, due_day: 5 }, "2026-10")).toEqual({ cut: "2026-10-20", due: "2026-11-05" });
    expect(cutAndDue({ statement_day: 10, due_day: 25 }, "2026-12")).toEqual({ cut: "2026-12-10", due: "2026-12-25" });
    expect(lastCutMonth({ statement_day: 20, due_day: 5 }, "2026-11-01")).toBe("2026-10");
    expect(lastCutMonth({ statement_day: 20, due_day: 5 }, "2026-11-20")).toBe("2026-11");
    expect(lastCutMonth({ statement_day: 20, due_day: 5 }, "2026-01-05")).toBe("2025-12");
  });
});
