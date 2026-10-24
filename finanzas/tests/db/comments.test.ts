// Comentarios de movimientos: los ve quien ve el movimiento; cada uno escribe y borra solo lo suyo.

import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, rpc, setupDb } from "./harness";

const MAY = "00000000-0000-0000-0000-00000000000a";
const BREI = "00000000-0000-0000-0000-00000000000b";

describe("comentarios en movimientos", () => {
  let db: PGlite;
  let hh: string, acc: string, cat: string, shared: string, personal: string;
  const comment = (uid: string, tx: string, body: string, author = uid) =>
    as(db, uid, `insert into transaction_comments (household_id, transaction_id, author_id, body) values ($1, $2, $3, $4) returning id`, [hh, tx, author, body]);

  beforeAll(async () => {
    db = await setupDb();
    await db.exec(`insert into auth.users values ('${MAY}'), ('${BREI}')`);
    await as(db, MAY, `select public.create_household('Casa', 'May')`);
    const code = (await db.query<{ invite_code: string }>(`select invite_code from households`)).rows[0].invite_code;
    await as(db, BREI, `select public.join_household($1, 'Brei')`, [code]);
    hh = (await db.query<{ id: string }>(`select id from households`)).rows[0].id;
    acc = (await as<{ id: string }>(db, MAY, `insert into accounts (household_id, owner_user_id, name, kind, visibility, opening_balance, opening_at)
      values ($1, $2, 'Ahorros', 'DEPOSIT', 'PRIVATE', 1000000, '2026-01-01') returning id`, [hh, MAY]))[0].id;
    cat = await rpc<string>(db, MAY, "save_category", { name: "Mercado", responsibility: "MEMBER_A_100" });
    const tx = (scope: string) => rpc<string>(db, MAY, "save_transaction", { kind: "EXPENSE", scope, amount: 50_000, account_id: acc, occurred_on: "2026-10-10", splits: [{ amount: 50_000, category_id: cat }] });
    shared = await tx("HOUSEHOLD");
    personal = await tx("PERSONAL");
  }, 30_000);

  it("en un movimiento del hogar comentan los dos y los dos leen", async () => {
    await comment(MAY, shared, "Compra de la quincena");
    await comment(BREI, shared, "Faltó el aseo");
    const seen = await as<{ body: string }>(db, BREI, `select body from transaction_comments where transaction_id = $1 order by created_at, body`, [shared]);
    expect(seen.map((c) => c.body).sort()).toEqual(["Compra de la quincena", "Faltó el aseo"]);
    expect(await as(db, MAY, `select id from transaction_comments where transaction_id = $1`, [shared])).toHaveLength(2);
  });

  it("en un movimiento personal solo lo ve y comenta su dueño", async () => {
    await comment(MAY, personal, "Regalo sorpresa");
    expect(await as(db, BREI, `select id from transaction_comments where transaction_id = $1`, [personal])).toHaveLength(0);
    await expect(comment(BREI, personal, "Intento espiar")).rejects.toThrow();
    expect(await as(db, MAY, `select id from transaction_comments where transaction_id = $1`, [personal])).toHaveLength(1);
  });

  it("nadie escribe a nombre de otra persona", async () => {
    await expect(comment(MAY, shared, "Falso", BREI)).rejects.toThrow();
  });

  it("sin sesión no se ve nada y los comentarios vacíos o enormes se rechazan", async () => {
    expect(await as(db, null, `select id from transaction_comments`)).toHaveLength(0);
    await expect(comment(MAY, shared, "   ")).rejects.toThrow();
    await expect(comment(MAY, shared, "x".repeat(1001))).rejects.toThrow();
  });

  it("cada uno borra solo los suyos y no se pueden editar", async () => {
    const mine = (await as<{ id: string }>(db, MAY, `select id from transaction_comments where transaction_id = $1 and author_id = $2`, [shared, MAY]))[0].id;
    await as(db, BREI, `delete from transaction_comments where id = $1`, [mine]);
    expect(await as(db, MAY, `select id from transaction_comments where id = $1`, [mine])).toHaveLength(1);
    await as(db, BREI, `update transaction_comments set body = 'cambiado' where id = $1`, [mine]);
    expect((await as<{ body: string }>(db, MAY, `select body from transaction_comments where id = $1`, [mine]))[0].body).toBe("Compra de la quincena");
    await as(db, MAY, `delete from transaction_comments where id = $1`, [mine]);
    expect(await as(db, MAY, `select id from transaction_comments where id = $1`, [mine])).toHaveLength(0);
  });

  it("al borrar el movimiento se borran sus comentarios", async () => {
    await as(db, MAY, `select public.delete_transaction($1)`, [personal]);
    expect((await db.query(`select id from transaction_comments where transaction_id = $1`, [personal])).rows).toHaveLength(0);
  });

  it("la migración se puede volver a correr", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    await db.exec(fs.readFileSync(path.join(__dirname, "../../supabase/migrations/0020_transaction_comments.sql"), "utf8"));
  });
});
