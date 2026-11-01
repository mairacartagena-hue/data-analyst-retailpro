// Migración 0046: un pago registrado a mano en la categoría del crédito se cruza con el crédito, y quien paga la
// tarjeta o el crédito de su pareja puede transferirle.

import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, rpc, setupDb } from "./harness";

const MAY = "00000000-0000-0000-0000-00000000000a";
const BREI = "00000000-0000-0000-0000-00000000000b";

describe("pago de deudas: cruce con presupuesto y vencimientos", () => {
  let db: PGlite;
  let hh: string, bank: string, credit: string, cat: string, card: string, breiBank: string, sp: string;
  const balance = async (uid: string, acc: string) =>
    Number((await as<{ balance: string }>(db, uid, `select balance::text from public.account_balances() where account_id = $1`, [acc]))[0].balance);

  beforeAll(async () => {
    db = await setupDb();
    await db.exec(`insert into auth.users values ('${MAY}'), ('${BREI}')`);
    await as(db, MAY, `select public.create_household('Casa', 'May')`);
    const code = (await db.query<{ invite_code: string }>(`select invite_code from households`)).rows[0].invite_code;
    await as(db, BREI, `select public.join_household($1, 'Brei')`, [code]);
    hh = (await db.query<{ id: string }>(`select id from households`)).rows[0].id;
    const acc = async (uid: string, name: string, kind: string, opening: number) =>
      (await as<{ id: string }>(db, uid, `insert into accounts (household_id, owner_user_id, name, kind, visibility, opening_balance, opening_at)
        values ($1, $2, $3, $4, 'BALANCE_ONLY', $5, '2026-01-01') returning id`, [hh, uid, name, kind, opening]))[0].id;
    bank = await acc(MAY, "Bancolombia", "DEPOSIT", 5_000_000);
    credit = await acc(MAY, "Hipoteca", "CREDIT", -100_000_000);
    card = await acc(MAY, "Visa", "CREDIT_CARD", -1_000_000);
    breiBank = await acc(BREI, "Nequi", "DEPOSIT", 2_000_000);
    cat = await rpc<string>(db, MAY, "save_category", { name: "Hipoteca" });
    await as(db, MAY, `update accounts set budget_category_id = $1 where id = $2`, [cat, credit]);
    sp = (await as<{ id: string }>(db, MAY, `insert into scheduled_payments (household_id, owner_user_id, name, kind, scope, amount, frequency, day_of_month, start_date, category_id)
      values ($1, $2, 'Hipoteca', 'DEBT_PAYMENT', 'HOUSEHOLD', 1500000, 'MONTHLY', 5, '2026-01-01', $3) returning id`, [hh, MAY, cat]))[0].id;
  }, 30_000);

  it("convierte un pago de deuda registrado a mano en la categoría del crédito y conserva el vencimiento", async () => {
    const id = await rpc<string>(db, MAY, "save_transaction", {
      kind: "DEBT_PAYMENT", scope: "HOUSEHOLD", amount: 1_500_000, occurred_on: "2026-11-04", description: "Cuota hipoteca", account_id: bank,
      scheduled_payment_id: sp, scheduled_for: "2026-11-05", tags: [],
      splits: [{ amount: 1_500_000, category_id: cat, responsible_user_id: MAY, origin: "NORMAL" }],
    });
    expect(await rpc(db, MAY, "apply_credit_payment", { transaction_id: id, credit_id: credit, charges: 900_000 })).toBe(id);
    expect(await balance(MAY, bank)).toBe(3_500_000);
    expect(await balance(MAY, credit)).toBe(-100_000_000 + 1_500_000 - 900_000);
    const t = (await db.query<{ kind: string; scheduled_payment_id: string; scheduled_for: string }>(
      `select kind, scheduled_payment_id, scheduled_for::text from transactions where id = $1`, [id])).rows[0];
    expect(t).toEqual({ kind: "TRANSFER", scheduled_payment_id: sp, scheduled_for: "2026-11-05" });
  });

  it("no convierte un movimiento a mano de otra categoría", async () => {
    const other = await rpc<string>(db, MAY, "save_category", { name: "Mercado" });
    const id = await rpc<string>(db, MAY, "save_transaction", {
      kind: "EXPENSE", scope: "HOUSEHOLD", amount: 1_500_000, occurred_on: "2026-12-04", account_id: bank, tags: [],
      splits: [{ amount: 1_500_000, category_id: other, responsible_user_id: MAY, origin: "NORMAL" }],
    });
    await expect(rpc(db, MAY, "apply_credit_payment", { transaction_id: id, credit_id: credit, charges: 900_000 })).rejects.toThrow(/categoría del crédito/);
  });

  it("sin ser responsable, la pareja no puede transferir a la tarjeta", async () => {
    await expect(rpc(db, BREI, "save_transaction", { kind: "TRANSFER", amount: 300_000, occurred_on: "2026-11-03", account_id: breiBank, to_account_id: card, tags: [] }))
      .rejects.toThrow(/tus propias cuentas/);
  });

  it("quien paga la tarjeta de su pareja puede transferirle desde su cuenta", async () => {
    await as(db, MAY, `update accounts set responsible_user_id = $1 where id = $2`, [BREI, card]);
    await rpc(db, BREI, "save_transaction", { kind: "TRANSFER", amount: 300_000, occurred_on: "2026-11-03", account_id: breiBank, to_account_id: card, tags: [] });
    expect(await balance(MAY, card)).toBe(-700_000);
    expect(await balance(BREI, breiBank)).toBe(1_700_000);
  });

  it("pero no a una cuenta de ahorros de su pareja", async () => {
    await expect(rpc(db, BREI, "save_transaction", { kind: "TRANSFER", amount: 1, occurred_on: "2026-11-03", account_id: breiBank, to_account_id: bank, tags: [] }))
      .rejects.toThrow(/tus propias cuentas/);
  });

  it("la migración 0046 se puede volver a correr", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    await db.exec(fs.readFileSync(path.join(__dirname, "../../supabase/migrations/0046_debt_payment_cross.sql"), "utf8"));
  });
});
