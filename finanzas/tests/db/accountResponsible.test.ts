// Migración 0032: el responsable de una tarjeta o crédito ve sus movimientos y las compras del extracto.

import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, rpc, setupDb } from "./harness";

const MAY = "00000000-0000-0000-0000-00000000000a";
const BREI = "00000000-0000-0000-0000-00000000000b";
const OUTSIDER = "00000000-0000-0000-0000-0000000000ff";

describe("responsable de la tarjeta o del crédito", () => {
  let db: PGlite;
  let hh: string, card: string, savings: string, cat: string;
  const seenBy = async (uid: string) => (await as<{ description: string }>(db, uid, `select description from transactions order by description`)).map((r) => r.description);

  beforeAll(async () => {
    db = await setupDb();
    await db.exec(`insert into auth.users values ('${MAY}'), ('${BREI}')`);
    await as(db, MAY, `select public.create_household('Casa', 'May')`);
    const code = (await db.query<{ invite_code: string }>(`select invite_code from households`)).rows[0].invite_code;
    await as(db, BREI, `select public.join_household($1, 'Brei')`, [code]);
    hh = (await db.query<{ id: string }>(`select id from households`)).rows[0].id;
    card = (await as<{ id: string }>(db, MAY, `insert into accounts (household_id, owner_user_id, name, kind, visibility, opening_balance, opening_at)
      values ($1, $2, 'Visa', 'CREDIT_CARD', 'BALANCE_ONLY', 0, '2026-01-01') returning id`, [hh, MAY]))[0].id;
    savings = (await as<{ id: string }>(db, MAY, `insert into accounts (household_id, owner_user_id, name, kind, visibility, opening_balance, opening_at)
      values ($1, $2, 'Ahorros', 'DEPOSIT', 'BALANCE_ONLY', 1000000, '2026-01-01') returning id`, [hh, MAY]))[0].id;
    cat = await rpc<string>(db, MAY, "save_category", { name: "Compras", responsibility: "MEMBER_A_100" });
    for (const [account, description] of [[card, "Compra con tarjeta"], [savings, "Compra con ahorros"]]) {
      await rpc(db, MAY, "save_transaction", { kind: "EXPENSE", scope: "PERSONAL", amount: 50_000, occurred_on: "2026-10-10", description, account_id: account, splits: [{ amount: 50_000, category_id: cat, responsible_user_id: MAY }] });
    }
    await as(db, MAY, `insert into card_statement_items (household_id, account_id, owner_user_id, description, purchase_date, amount, installments, paid_installments, remaining_balance)
      values ($1, $2, $3, 'IKEA', '2026-10-15', 100000, 2, 1, 50000)`, [hh, card, MAY]);
  }, 30_000);

  it("sin responsable, su pareja no ve sus movimientos personales ni las compras del extracto", async () => {
    expect(await seenBy(BREI)).toEqual([]);
    expect(await as(db, BREI, `select 1 from card_statement_items`)).toHaveLength(0);
  });

  it("al asignarle la tarjeta, el responsable ve sus movimientos y las compras del extracto, pero no los de otras cuentas", async () => {
    await as(db, MAY, `update accounts set responsible_user_id = $1 where id = $2`, [BREI, card]);
    expect(await seenBy(BREI)).toEqual(["Compra con tarjeta"]);
    expect(await as(db, BREI, `select 1 from card_statement_items`)).toHaveLength(1);
  });

  it("el responsable no puede editar la cuenta ni sus compras del extracto", async () => {
    await as(db, BREI, `update accounts set name = 'otra' where id = $1`, [card]);
    expect((await db.query<{ name: string }>(`select name from accounts where id = $1`, [card])).rows[0].name).toBe("Visa");
    await as(db, BREI, `update card_statement_items set description = 'x'`);
    expect((await db.query<{ description: string }>(`select description from card_statement_items`)).rows[0].description).toBe("IKEA");
  });

  it("el responsable debe ser parte del hogar", async () => {
    await expect(as(db, MAY, `update accounts set responsible_user_id = $1 where id = $2`, [OUTSIDER, card])).rejects.toThrow(/hogar/);
  });

  it("solo aplica a tarjetas, créditos y préstamos", async () => {
    await as(db, MAY, `update accounts set responsible_user_id = $1 where id = $2`, [BREI, savings]);
    expect((await db.query<{ r: string | null }>(`select responsible_user_id r from accounts where id = $1`, [savings])).rows[0].r).toBeNull();
  });

  it("al quitarle la responsabilidad deja de verlos", async () => {
    await as(db, MAY, `update accounts set responsible_user_id = null where id = $1`, [card]);
    expect(await seenBy(BREI)).toEqual([]);
  });

  it("la migración 0032 se puede volver a correr", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    await db.exec(fs.readFileSync(path.join(__dirname, "../../supabase/migrations/0032_account_responsible.sql"), "utf8"));
  });
});
