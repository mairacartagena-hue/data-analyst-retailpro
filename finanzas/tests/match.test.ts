import { describe, expect, it } from "vitest";
import { findManualTwin } from "@/lib/ingest/match";
import type { Category, Transaction } from "@/lib/types";

const A = "user-a";
const tx = (p: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36), kind: "EXPENSE", status: "CONFIRMED", occurred_on: "2026-10-24", amount: 0,
  description: null, merchant: null, account_id: "bc", to_account_id: null, payer_user_id: A, counterparty_user_id: null,
  is_shared: false, source: "MANUAL", tags: [], created_by: A, created_at: "", splits: [], ...p,
});
const cats: Category[] = [{ id: "lulo", household_id: "h", name: "Lulo bank", icon: null, responsibility: "MEMBER_A_100", owner_user_id: null,
  is_household_obligation: true, is_shared_progress: true, rollover_enabled: false, archived: false, created_at: "" }];
const split = (amount: number, category_id: string | null) => [{ id: "s", transaction_id: "t", amount, category_id, responsible_user_id: A, origin: "NORMAL" as const, note: null }];

describe("pago registrado a mano y aviso del banco", () => {
  const manualLulo = tx({ amount: 800000, description: "Lulo bank", splits: split(800000, "lulo") });
  const manualAddi = tx({ amount: 200000, description: "Addi", splits: split(200000, null) });
  const otherTransfer = tx({ amount: 800000, description: "Cuenta ···6876", status: "PENDING_REVIEW", source: "GMAIL", occurred_on: "2026-10-23", merchant_norm: "cuenta 6876" });

  it("Lulo: monto del presupuesto vs monto real del banco", () => {
    const pending = tx({ amount: 838058, status: "PENDING_REVIEW", source: "GMAIL", occurred_on: "2026-10-23", merchant_norm: "lulo bank" });
    expect(findManualTwin(pending, [manualLulo, manualAddi, otherTransfer], cats)?.id).toBe(manualLulo.id);
  });

  it("Addi: el nombre del comercio trae ruido (P A Addi)", () => {
    const pending = tx({ amount: 208617, status: "PENDING_REVIEW", source: "GMAIL", occurred_on: "2026-10-22", merchant_norm: "p a addi" });
    expect(findManualTwin(pending, [manualLulo, manualAddi], cats)?.id).toBe(manualAddi.id);
  });

  it("una transferencia a otra cuenta por el mismo monto no se confunde con el pago de Lulo", () => {
    expect(findManualTwin(otherTransfer, [manualLulo], cats)).toBeNull();
  });

  it("muy lejos en fechas o con monto muy distinto no se propone", () => {
    const far = tx({ amount: 838058, status: "PENDING_REVIEW", source: "GMAIL", occurred_on: "2026-10-01", merchant_norm: "lulo bank" });
    expect(findManualTwin(far, [manualLulo], cats)).toBeNull();
    const big = tx({ amount: 2000000, status: "PENDING_REVIEW", source: "GMAIL", occurred_on: "2026-10-23", merchant_norm: "lulo bank" });
    expect(findManualTwin(big, [manualLulo], cats)).toBeNull();
  });
});
