// Cruce automático del pago de la cuota de un crédito con presupuesto.

import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, rpc, setupDb } from "./harness";

const MAY = "00000000-0000-0000-0000-00000000000a";

describe("pago de la cuota de un crédito", () => {
  let db: PGlite;
  let hh: string, bank: string, credit: string, cat: string, other: string;
  const balance = async (acc: string) =>
    Number((await as<{ balance: string }>(db, MAY, `select balance::text from public.account_balances() where account_id = $1`, [acc]))[0].balance);
  const autoPayment = async (amount: number, on: string, source = "GMAIL") =>
    (await db.query<{ id: string }>(`insert into transactions (household_id, kind, scope, status, occurred_on, amount, merchant, account_id, payer_user_id, created_by, source)
      values ($1, 'EXPENSE', 'PERSONAL', 'CONFIRMED', $2, $3, 'Lulo Bank', $4, $5, $5, $6) returning id`, [hh, on, amount, bank, MAY, source])).rows[0].id;

  beforeAll(async () => {
    db = await setupDb();
    await db.exec(`insert into auth.users values ('${MAY}')`);
    await as(db, MAY, `select public.create_household('Casa', 'May')`);
    hh = (await db.query<{ id: string }>(`select id from households`)).rows[0].id;
    const acc = async (name: string, kind: string, opening: number) =>
      (await as<{ id: string }>(db, MAY, `insert into accounts (household_id, owner_user_id, name, kind, visibility, opening_balance, opening_at)
        values ($1, $2, $3, $4, 'PRIVATE', $5, '2026-01-01') returning id`, [hh, MAY, name, kind, opening]))[0].id;
    bank = await acc("Bancolombia", "DEPOSIT", 5_000_000);
    credit = await acc("Lulo Bank", "CREDIT", -10_000_000);
    cat = await rpc<string>(db, MAY, "save_category", { name: "Lulo Bank" });
    other = await rpc<string>(db, MAY, "save_category", { name: "Consumo" });
    await as(db, MAY, `update accounts set budget_category_id = $1 where id = $2`, [cat, credit]);
  }, 30_000);

  it("convierte el aviso en el pago del crédito: baja la deuda en el capital y los intereses quedan como gasto", async () => {
    const id = await autoPayment(800_000, "2026-10-23");
    await db.query(`insert into transaction_splits (household_id, transaction_id, amount, category_id, responsible_user_id) values ($4, $1, 800000, $2, $3)`, [id, other, MAY, hh]);
    expect(await rpc(db, MAY, "apply_credit_payment", { transaction_id: id, credit_id: credit, charges: 300_000 })).toBe(id);

    expect(await balance(bank)).toBe(4_200_000);
    expect(await balance(credit)).toBe(-9_500_000);
    const t = (await db.query<{ kind: string; to_account_id: string; amount: string; n: string }>(
      `select kind, to_account_id, amount::text, (select count(*)::text from transaction_splits where transaction_id = t.id) n from transactions t where id = $1`, [id])).rows[0];
    expect(t).toEqual({ kind: "TRANSFER", to_account_id: credit, amount: "800000", n: "0" });
    const charge = (await db.query<{ scope: string; amount: string; category_id: string }>(
      `select t.scope, t.amount::text, s.category_id from transactions t join transaction_splits s on s.transaction_id = t.id where t.account_id = $1 and t.kind = 'EXPENSE'`, [credit])).rows;
    expect(charge).toEqual([{ scope: "HOUSEHOLD", amount: "300000", category_id: cat }]);
  });

  it("no lo convierte dos veces ni cruza otro pago de la misma cuota", async () => {
    const first = (await db.query<{ id: string }>(`select id from transactions where kind = 'TRANSFER' and to_account_id = $1`, [credit])).rows[0].id;
    expect(await rpc(db, MAY, "apply_credit_payment", { transaction_id: first, credit_id: credit, charges: 300_000 })).toBeNull();
    const again = await autoPayment(800_000, "2026-10-28");
    expect(await rpc(db, MAY, "apply_credit_payment", { transaction_id: again, credit_id: credit, charges: 300_000 })).toBeNull();
    expect(await balance(credit)).toBe(-9_500_000);
  });

  it("no toca lo registrado a mano", async () => {
    const manual = await autoPayment(800_000, "2026-12-23", "MANUAL");
    await expect(rpc(db, MAY, "apply_credit_payment", { transaction_id: manual, credit_id: credit, charges: 300_000 })).rejects.toThrow(/automáticamente/);
  });
});
