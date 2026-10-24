// Migración 0021: nombre de comercio/llave/cuenta, regla de reembolso para ingresos y etiquetas.

import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, rpc, setupDb } from "./harness";

const MAY = "00000000-0000-0000-0000-00000000000a";
const BREI = "00000000-0000-0000-0000-00000000000b";

describe("memoria de comercios: nombre y regla de reembolso", () => {
  let db: PGlite;
  let hh: string, acc: string, alvaro: string, restaurantes: string, token: string;
  const ingest = async (ev: object) => (await as<{ r: { result: string; transaction_id?: string } }>(db, null, `select public.ingest_event($1, $2::jsonb) as r`, [token, JSON.stringify(ev)]))[0].r;
  const txOf = async (id: string) => (await db.query<{ kind: string; status: string; merchant: string; description: string; scope: string }>(`select kind, status, merchant, description, scope from transactions where id = $1`, [id])).rows[0];
  let n = 0;
  const purchase = (identifiers: object[], merchant: string, at: string, amount = 24_000) => ({
    channel: "GMAIL", external_id: `x${++n}`, parsed: { kind: "PURCHASE", amount, merchant, merchant_norm: merchant.toLowerCase(), last4: "2505", occurred_at: at, identifiers },
  });

  beforeAll(async () => {
    db = await setupDb();
    await db.exec(`insert into auth.users values ('${MAY}'), ('${BREI}')`);
    await as(db, MAY, `select public.create_household('Casa', 'May')`);
    hh = (await db.query<{ id: string }>(`select id from households`)).rows[0].id;
    acc = (await as<{ id: string }>(db, MAY, `insert into accounts (household_id, owner_user_id, name, kind, visibility, opening_balance, opening_at, last4)
      values ($1, $2, 'Ahorros', 'DEPOSIT', 'PRIVATE', 1000000, '2026-01-01', '2505') returning id`, [hh, MAY]))[0].id;
    alvaro = await rpc<string>(db, MAY, "save_category", { name: "Alvaro", responsibility: "MEMBER_A_100" });
    restaurantes = await rpc<string>(db, MAY, "save_category", { name: "Restaurantes", responsibility: "MEMBER_A_100" });
    token = (await as<{ t: string }>(db, MAY, `select public.create_ingest_token() as t`))[0].t;
  }, 30_000);

  it("el nombre que se le pone a una llave llega en los avisos nuevos (y recorta nombres desmedidos)", async () => {
    const first = await ingest(purchase([{ type: "ACCOUNT", value: "0043308568" }], "Heladeria Creperia Cream Waffles", "2026-10-01T15:00:00Z"));
    await rpc(db, MAY, "save_transaction", { id: first.transaction_id, kind: "EXPENSE", amount: 24_000, account_id: acc, merchant: "Heladeria Creperia Cream Waffles", splits: [{ amount: 24_000, category_id: restaurantes }] });
    await as(db, MAY, `select public.remember_merchant($1, true)`, [first.transaction_id]);
    await as(db, MAY, `update merchant_memory set label = 'Heladería' where identifier_type = 'ACCOUNT' and identifier = '0043308568'`);

    const next = await ingest(purchase([{ type: "ACCOUNT", value: "0043308568" }], "Heladeria Creperia Cream Waffles", "2026-10-08T15:00:00Z"));
    expect(await txOf(next.transaction_id!)).toMatchObject({ merchant: "Heladería", description: "Heladería", status: "CONFIRMED" });

    const long = await ingest(purchase([], "x".repeat(300), "2026-10-09T15:00:00Z", 9_999));
    expect((await txOf(long.transaction_id!)).merchant).toHaveLength(60);
  });

  it("la persona solo cambia su propia memoria", async () => {
    await expect(as(db, MAY, `update merchant_memory set label = 'x'.repeat(61)`)).rejects.toThrow();
    expect(await as(db, BREI, `select id from merchant_memory`)).toHaveLength(0);
  });

  describe("ingreso que es reembolso (el pago mensual de Alvaro y lo que envía Yolima)", () => {
    const income = (merchant: string, at: string, amount = 1_050_000) => ({
      channel: "GMAIL", external_id: `x${++n}`, parsed: { kind: "TRANSFER_IN", amount, merchant, merchant_norm: merchant.toLowerCase(), last4: "2505", occurred_at: at, identifiers: [] },
    });
    const rule = (auto: boolean) => db.exec(`delete from merchant_memory where identifier = 'yolima campaz';
      insert into merchant_memory (household_id, user_id, identifier_type, identifier, category_id, responsible_user_id, auto_apply, scope, creates_debt, movement_kind, label)
      values ('${hh}', '${MAY}', 'MERCHANT', 'yolima campaz', '${alvaro}', '${MAY}', ${auto}, 'PERSONAL', false, 'REFUND', 'Yolima (reembolso Alvaro)')`);

    it("con la regla automática, el ingreso entra como reembolso de Alvaro y resta del gasto", async () => {
      await rule(true);
      const balance = async () => Number((await as<{ balance: string }>(db, MAY, `select balance::text from public.account_balances() where account_id = $1`, [acc]))[0].balance);
      const before = await balance();
      const r = await ingest(income("Yolima Campaz", "2026-11-17T22:38:00Z"));
      expect(await balance()).toBe(before + 1_050_000);
      expect(r.result).toBe("ACCEPTED");
      expect(await txOf(r.transaction_id!)).toMatchObject({ kind: "REFUND", status: "CONFIRMED", merchant: "Yolima (reembolso Alvaro)" });
      expect((await db.query(`select category_id from transaction_splits where transaction_id = $1`, [r.transaction_id])).rows).toEqual([{ category_id: alvaro }]);

      // el saldo sube y el consumo de Alvaro baja: pago de $1.043.000 y reembolso de $1.050.000 → −$7.000
      await rpc(db, MAY, "save_transaction", { kind: "EXPENSE", amount: 1_043_000, occurred_on: "2026-11-23", account_id: acc, splits: [{ amount: 1_043_000, category_id: alvaro }] });
      const spent = await as<{ s: string }>(db, MAY, `select sum(case when t.kind = 'REFUND' then -s.amount else s.amount end)::text s
        from transaction_splits s join transactions t on t.id = s.transaction_id where s.category_id = $1 and t.kind in ('EXPENSE','REFUND') and t.occurred_on >= '2026-11-01'`, [alvaro]);
      expect(Number(spent[0].s)).toBe(-7_000);
      expect(await balance()).toBe(before + 1_050_000 - 1_043_000);
    });

    it("el mismo aviso por otro canal no duplica el reembolso", async () => {
      const again = await ingest({ ...income("Yolima Campaz", "2026-11-17T22:39:00Z"), channel: "ANDROID_SMS" });
      expect(again.result).toBe("MERGED");
    });

    it("sin 'aplicar siempre' queda pendiente como ingreso con la categoría sugerida", async () => {
      await rule(false);
      const r = await ingest(income("Yolima Campaz", "2026-12-17T22:38:00Z"));
      expect(await txOf(r.transaction_id!)).toMatchObject({ kind: "INCOME", status: "PENDING_REVIEW" });
      expect((await db.query(`select suggested_category_id from transactions where id = $1`, [r.transaction_id])).rows).toEqual([{ suggested_category_id: alvaro }]);
    });

    it("la regla no se aplica a un gasto del mismo nombre ni a ingresos de otras personas", async () => {
      await rule(true);
      const other = await ingest(income("Otra Persona", "2026-12-18T22:38:00Z", 50_000));
      expect((await txOf(other.transaction_id!)).kind).toBe("INCOME");
      const expense = await ingest(purchase([], "Yolima Campaz", "2026-12-19T15:00:00Z", 30_000));
      expect((await txOf(expense.transaction_id!)).kind).toBe("EXPENSE");
    });
  });

  it("la migración se puede volver a correr", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    await db.exec(fs.readFileSync(path.join(__dirname, "../../supabase/migrations/0021_tags_memory_rules.sql"), "utf8"));
  });
});

describe("etiquetas", () => {
  let db: PGlite;
  let hh: string, acc: string, cat: string, shared: string, personal: string;
  const newTag = (uid: string, name: string) =>
    as<{ id: string }>(db, uid, `insert into tags (household_id, name, created_by) values ($1, $2, $3) returning id`, [hh, name, uid]);
  const attach = (uid: string, tx: string, tag: string) =>
    as(db, uid, `insert into transaction_tags (transaction_id, tag_id, household_id) values ($1, $2, $3)`, [tx, tag, hh]);

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

  it("las dos personas crean, ven, renombran y borran las etiquetas del hogar", async () => {
    const viaje = (await newTag(MAY, "Viaje"))[0].id;
    await newTag(BREI, "Regalos");
    expect((await as<{ name: string }>(db, BREI, `select name from tags order by name`)).map((t) => t.name)).toEqual(["Regalos", "Viaje"]);
    await as(db, BREI, `update tags set name = 'Vacaciones' where id = $1`, [viaje]);
    expect((await as<{ name: string }>(db, MAY, `select name from tags where id = $1`, [viaje]))[0].name).toBe("Vacaciones");
    await as(db, MAY, `delete from tags where name = 'Regalos'`);
    expect(await as(db, BREI, `select id from tags`)).toHaveLength(1);
  });

  it("no se repite un nombre (sin importar mayúsculas ni espacios) y no se escribe a nombre de otro", async () => {
    await expect(newTag(MAY, " vacaciones ")).rejects.toThrow();
    await expect(newTag(MAY, "   ")).rejects.toThrow();
    await expect(as(db, MAY, `insert into tags (household_id, name, created_by) values ($1, 'Falsa', $2)`, [hh, BREI])).rejects.toThrow();
  });

  it("quien ve el movimiento ve sus etiquetas; lo personal no se filtra a la pareja", async () => {
    const t = (await as<{ id: string }>(db, MAY, `select id from tags where name = 'Vacaciones'`))[0].id;
    await attach(MAY, shared, t);
    await attach(MAY, personal, t);
    expect(await as(db, BREI, `select tag_id from transaction_tags where transaction_id = $1`, [shared])).toHaveLength(1);
    expect(await as(db, BREI, `select tag_id from transaction_tags where transaction_id = $1`, [personal])).toHaveLength(0);
    await expect(attach(BREI, personal, t)).rejects.toThrow();
    expect(await as(db, null, `select tag_id from transaction_tags`)).toHaveLength(0);
  });

  it("la misma etiqueta no se pone dos veces al mismo movimiento", async () => {
    const t = (await as<{ id: string }>(db, MAY, `select id from tags where name = 'Vacaciones'`))[0].id;
    await expect(attach(MAY, shared, t)).rejects.toThrow();
  });

  it("al borrar una etiqueta desaparece de los movimientos, y los movimientos se quedan", async () => {
    const t = (await as<{ id: string }>(db, MAY, `select id from tags where name = 'Vacaciones'`))[0].id;
    await as(db, MAY, `delete from tags where id = $1`, [t]);
    expect((await db.query(`select 1 from transaction_tags`)).rows).toHaveLength(0);
    expect((await db.query(`select 1 from transactions`)).rows.length).toBeGreaterThanOrEqual(2);
  });

  it("al borrar el movimiento se van sus etiquetas, no la etiqueta", async () => {
    const t = (await newTag(MAY, "Temporal"))[0].id;
    await attach(MAY, shared, t);
    await as(db, MAY, `select public.delete_transaction($1)`, [shared]);
    expect((await db.query(`select 1 from transaction_tags where tag_id = $1`, [t])).rows).toHaveLength(0);
    expect((await db.query(`select 1 from tags where id = $1`, [t])).rows).toHaveLength(1);
  });
});
