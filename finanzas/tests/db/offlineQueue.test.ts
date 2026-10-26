// Cola sin conexión: reenviar el mismo movimiento (mismo client_id) no lo duplica.

import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, rpc, setupDb } from "./harness";

const MAY = "00000000-0000-0000-0000-00000000000a";
const BREI = "00000000-0000-0000-0000-00000000000b";
const CLIENT = "11111111-2222-4333-8444-555555555555";

describe("save_transaction_once", () => {
  let db: PGlite;
  let acc: string;
  const count = async () => Number((await db.query<{ n: string }>(`select count(*)::text n from transactions`)).rows[0].n);

  beforeAll(async () => {
    db = await setupDb();
    await db.exec(`insert into auth.users values ('${MAY}'), ('${BREI}')`);
    await as(db, MAY, `select public.create_household('Casa', 'May')`);
    const code = (await db.query<{ invite_code: string }>(`select invite_code from households`)).rows[0].invite_code;
    await as(db, BREI, `select public.join_household($1, 'Brei')`, [code]);
    const hh = (await db.query<{ id: string }>(`select id from households`)).rows[0].id;
    acc = (await as<{ id: string }>(db, MAY, `insert into accounts (household_id, owner_user_id, name, kind, visibility, opening_balance, opening_at)
      values ($1, $2, 'Ahorros', 'DEPOSIT', 'PRIVATE', 0, '2026-01-01') returning id`, [hh, MAY]))[0].id;
  }, 30_000);

  const payload = () => ({ client_id: CLIENT, kind: "EXPENSE", scope: "PERSONAL", amount: 45_000, occurred_on: "2026-10-26", description: "Mercado", account_id: acc, splits: [{ amount: 45_000, category_id: null, responsible_user_id: MAY }] });

  it("guarda el movimiento la primera vez y devuelve el mismo id al reenviarlo", async () => {
    const first = await rpc<string>(db, MAY, "save_transaction_once", payload());
    const again = await rpc<string>(db, MAY, "save_transaction_once", payload());
    expect(again).toBe(first);
    expect(await count()).toBe(1);
  });

  it("otra persona no puede reusar el identificador", async () => {
    await expect(rpc(db, BREI, "save_transaction_once", payload())).rejects.toThrow(/no válido/);
  });

  it("no sirve para editar ni sin sesión", async () => {
    await expect(rpc(db, MAY, "save_transaction_once", { ...payload(), client_id: crypto.randomUUID(), id: crypto.randomUUID() })).rejects.toThrow(/nuevos/);
    await expect(rpc(db, null, "save_transaction_once", payload())).rejects.toThrow();
  });

  it("la tabla de envíos no se lee desde la API", async () => {
    await expect(as(db, MAY, `select * from client_submissions`)).rejects.toThrow(/permission/);
  });
});
