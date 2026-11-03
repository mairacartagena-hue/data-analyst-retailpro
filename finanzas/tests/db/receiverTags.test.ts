// Quien recibe el pago en un cruce (la liquidación o la compra que pagó la pareja por mí) puede cambiar
// la categoría de su parte y poner o quitar etiquetas, aunque no haya registrado el movimiento.

import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, rpc, setupDb } from "./harness";

const MAY = "00000000-0000-0000-0000-00000000000a";
const BREI = "00000000-0000-0000-0000-00000000000b";

describe("etiquetas y categoría para quien recibe el pago", () => {
  let db: PGlite;
  let hh: string, mayAcc: string, breiAcc: string, tag: string, cat: string;

  beforeAll(async () => {
    db = await setupDb();
    await db.exec(`insert into auth.users values ('${MAY}'), ('${BREI}')`);
    await as(db, MAY, `select public.create_household('Casa', 'May')`);
    const code = (await db.query<{ invite_code: string }>(`select invite_code from households`)).rows[0].invite_code;
    await as(db, BREI, `select public.join_household($1, 'Brei')`, [code]);
    hh = (await db.query<{ id: string }>(`select id from households`)).rows[0].id;
    const acc = async (uid: string, name: string) => (await as<{ id: string }>(db, uid, `insert into accounts (household_id, owner_user_id, name, kind, visibility, opening_balance, opening_at)
      values ($1, $2, $3, 'DEPOSIT', 'BALANCE_ONLY', 1000000, '2026-01-01') returning id`, [hh, uid, name]))[0].id;
    mayAcc = await acc(MAY, "Ahorros May");
    breiAcc = await acc(BREI, "Ahorros Brei");
    tag = (await as<{ id: string }>(db, BREI, `insert into tags (household_id, name, created_by) values ($1, '#viaje', $2) returning id`, [hh, BREI]))[0].id;
    cat = await rpc<string>(db, BREI, "save_category", { name: "Ropa", responsibility: "MEMBER_B_100" });
  }, 30_000);

  it("liquidación: quien la recibe pone y quita etiquetas", async () => {
    const tx = await rpc<string>(db, MAY, "save_transaction", { kind: "SETTLEMENT", amount: 50_000, occurred_on: "2026-11-01", account_id: mayAcc, to_account_id: breiAcc, counterparty_user_id: BREI });
    await as(db, BREI, `insert into transaction_tags (transaction_id, tag_id, household_id) values ($1, $2, $3)`, [tx, tag, hh]);
    expect(await as(db, MAY, `select 1 from transaction_tags where transaction_id = $1`, [tx])).toHaveLength(1);
    await as(db, BREI, `delete from transaction_tags where transaction_id = $1`, [tx]);
    expect(await as(db, MAY, `select 1 from transaction_tags where transaction_id = $1`, [tx])).toHaveLength(0);
  });

  it("compra personal que pagó la pareja por mí: cambio la categoría de mi parte y las etiquetas", async () => {
    const tx = await rpc<string>(db, MAY, "save_transaction", {
      kind: "EXPENSE", scope: "PERSONAL", amount: 80_000, occurred_on: "2026-11-02", account_id: mayAcc,
      splits: [{ amount: 80_000, responsible_user_id: BREI }],
    });
    const split = (await db.query<{ id: string }>(`select id from transaction_splits where transaction_id = $1`, [tx])).rows[0].id;
    await as(db, BREI, `select public.set_split_category($1, $2)`, [split, cat]);
    expect((await db.query<{ category_id: string }>(`select category_id from transaction_splits where id = $1`, [split])).rows[0].category_id).toBe(cat);
    await as(db, BREI, `insert into transaction_tags (transaction_id, tag_id, household_id) values ($1, $2, $3)`, [tx, tag, hh]);
    expect(await as(db, BREI, `select 1 from transaction_tags where transaction_id = $1`, [tx])).toHaveLength(1);
  });
});
