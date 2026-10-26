import { describe, expect, it } from "vitest";
import { buildAiContext, MAX_CONTEXT } from "@/lib/ai/context";
import type { FinanceState } from "@/lib/data/FinanceProvider";
import { DEFAULT_PERIOD_SETTINGS, periodFor } from "@/lib/finance/periods";
import type { Account, Member, Transaction } from "@/lib/types";

const A = "user-a";
const me: Member = { id: "m1", household_id: "h", user_id: A, slot: "A", display_name: "Ana", color: "#000", avatar: null };
const acc = (id: string, kind: Account["kind"], extra: Partial<Account> = {}): Account => ({
  id, household_id: "h", owner_user_id: A, name: id, kind, institution: null, last4: null, visibility: "PRIVATE", reveal_in_shared: false,
  opening_balance: 0, credit_limit: null, statement_day: null, due_day: null, archived: false, ...extra,
});
const tx = (i: number, on: string): Transaction => ({
  id: `t${i}`, kind: "EXPENSE", status: "CONFIRMED", occurred_on: on, amount: 50_000, description: `Compra ${i}`, merchant: null,
  account_id: "ahorros", to_account_id: null, payer_user_id: A, counterparty_user_id: null, is_shared: false, scope: "HOUSEHOLD",
  creates_debt: false, source: "MANUAL", tags: [], created_by: A, created_at: on,
  splits: [{ id: `s${i}`, transaction_id: `t${i}`, amount: 50_000, category_id: "mercado", responsible_user_id: A, origin: "NORMAL", note: null }],
} as Transaction);

function state(txs: Transaction[]): FinanceState {
  return {
    me, partner: null, settings: DEFAULT_PERIOD_SETTINGS, period: periodFor(DEFAULT_PERIOD_SETTINGS, "2026-10-26"),
    accounts: [acc("ahorros", "DEPOSIT"), acc("hipoteca", "CREDIT", { due_day: 4, term_months: 240, paid_installments: 37, paid_installments_on: "2026-10-01", interest_rate_ea: 12, original_amount: 200_000_000 })],
    balances: { ahorros: 2_000_000, hipoteca: -150_000_000 },
    labels: [], categories: [{ id: "mercado", household_id: "h", name: "Mercado", icon: null, responsibility: "FIXED_AMOUNTS", owner_user_id: null,
      is_household_obligation: false, is_shared_progress: false, rollover_enabled: false, archived: false, created_at: "2026-01-01" }],
    budgets: [], limits: [], transactions: txs, consumption: txs, ledger: [], spending: [], assets: [], goals: [], contributions: [], commitments: [],
    memberById: (id: string | null | undefined) => (id === A ? me : null),
  } as unknown as FinanceState;
}

describe("contexto del asistente", () => {
  it("incluye créditos, gasto por categoría y movimientos", () => {
    const ctx = buildAiContext(state([tx(1, "2026-10-20"), tx(2, "2026-09-15")]), "2026-10-26");
    expect(ctx).toContain("Persona que pregunta: Ana");
    expect(ctx).toContain("crédito: debe $150.000.000");
    expect(ctx).toContain("cuota 39 de 240"); // 37 pagadas al 1-oct + la del 4-oct
    expect(ctx).toContain("pagado 25 % del capital");
    expect(ctx).toMatch(/2026-10: Mercado \$50\.000/);
    expect(ctx).toContain("2026-10-20 · Gasto · $50.000 · Compra 1 · Mercado · hogar · pagó Ana");
  });
  it("recorta los movimientos más viejos si no caben", () => {
    const many = Array.from({ length: 4000 }, (_, i) => tx(i, `2026-${String(5 + (i % 5)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`));
    const ctx = buildAiContext(state(many), "2026-10-26");
    expect(ctx.length).toBeLessThanOrEqual(MAX_CONTEXT + 200);
  });
});
