// Primer barrido: la persona lo pide en la app y el Apps Script (con su token) lo recoge y lo cierra.

import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, setupDb } from "./harness";

const MAY = "00000000-0000-0000-0000-00000000000a";
const BREI = "00000000-0000-0000-0000-00000000000b";

const bogotaDay = (offset = 0) => {
  const d = new Date(Date.now() - 5 * 3_600_000 + offset * 86_400_000);
  return d.toISOString().slice(0, 10);
};

describe("barrido inicial de la captura automática", () => {
  let db: PGlite;
  let mayToken: string;
  let breiToken: string;

  /** Llama una función como el Apps Script: sin sesión, solo con el token. */
  async function anon<T>(sql: string, params: unknown[]): Promise<T> {
    await db.exec("set role anon");
    try {
      return (await db.query<{ r: T }>(sql, params)).rows[0].r;
    } finally {
      await db.exec("reset role");
    }
  }
  const pending = (token: string) => anon<string | null>("select public.ingest_backfill_pending($1)::text as r", [token]);

  beforeAll(async () => {
    db = await setupDb();
    await db.exec(`insert into auth.users values ('${MAY}'), ('${BREI}')`);
    await as(db, MAY, `select public.create_household('Casa', 'May')`);
    const code = (await db.query<{ invite_code: string }>(`select invite_code from households`)).rows[0].invite_code;
    await as(db, BREI, `select public.join_household($1, 'Brei')`, [code]);
    mayToken = (await as<{ t: string }>(db, MAY, `select public.create_ingest_token() as t`))[0].t;
    breiToken = (await as<{ t: string }>(db, BREI, `select public.create_ingest_token() as t`))[0].t;
  }, 30_000);

  it("sin pedido no hay barrido pendiente", async () => {
    expect(await pending(mayToken)).toBeNull();
  });

  it("pedirlo deja la fecha pendiente solo para esa persona; terminarlo lo cierra", async () => {
    const from = bogotaDay(-10);
    await as(db, MAY, `select public.request_ingest_backfill($1::date)`, [from]);
    expect(await pending(mayToken)).toBe(from);
    expect(await pending(breiToken)).toBeNull();

    await anon("select public.ingest_backfill_done($1) as r", [mayToken]);
    expect(await pending(mayToken)).toBeNull();
    const [row] = await as<{ done_at: string | null }>(db, MAY, `select done_at from ingest_backfills`);
    expect(row.done_at).not.toBeNull();
  });

  it("pedirlo otra vez reabre el barrido", async () => {
    await as(db, MAY, `select public.request_ingest_backfill($1::date)`, [bogotaDay(-5)]);
    expect(await pending(mayToken)).not.toBeNull();
  });

  it("al terminar guarda cuántos correos envió y si encontró la etiqueta; pedir de nuevo lo borra", async () => {
    await anon("select public.ingest_backfill_done($1, 0, false) as r", [mayToken]);
    const [done] = await as<{ sent: number; label_found: boolean; done_at: string }>(db, MAY, `select sent, label_found, done_at from ingest_backfills`);
    expect(done.sent).toBe(0);
    expect(done.label_found).toBe(false);
    expect(done.done_at).not.toBeNull();

    await as(db, MAY, `select public.request_ingest_backfill($1::date)`, [bogotaDay(-5)]);
    const [again] = await as<{ sent: number | null; label_found: boolean | null; done_at: string | null }>(db, MAY, `select sent, label_found, done_at from ingest_backfills`);
    expect(again).toEqual({ sent: null, label_found: null, done_at: null });

    await anon("select public.ingest_backfill_done($1, 12, true) as r", [mayToken]);
    const [ok] = await as<{ sent: number; label_found: boolean }>(db, MAY, `select sent, label_found from ingest_backfills`);
    expect(ok).toEqual({ sent: 12, label_found: true });
    await as(db, MAY, `select public.request_ingest_backfill($1::date)`, [bogotaDay(-5)]); // vuelve a quedar pendiente
  });

  it("cada persona solo ve su propio pedido", async () => {
    expect(await as(db, BREI, `select * from ingest_backfills`)).toHaveLength(0);
    expect(await as(db, MAY, `select * from ingest_backfills`)).toHaveLength(1);
  });

  it("nadie escribe en la tabla directamente", async () => {
    await expect(as(db, MAY, `update ingest_backfills set done_at = now()`)).rejects.toThrow();
    await expect(as(db, MAY, `delete from ingest_backfills`)).rejects.toThrow();
  });

  it("rechaza fechas futuras, demasiado antiguas o sin token", async () => {
    await expect(as(db, MAY, `select public.request_ingest_backfill($1::date)`, [bogotaDay(3)])).rejects.toThrow(/no es válida/);
    await expect(as(db, MAY, `select public.request_ingest_backfill($1::date)`, [bogotaDay(-200)])).rejects.toThrow(/no es válida/);
    await db.exec(`delete from ingest_tokens where user_id = '${BREI}'`);
    await expect(as(db, BREI, `select public.request_ingest_backfill($1::date)`, [bogotaDay(-3)])).rejects.toThrow(/token/);
  });

  it("un token inválido no ve ni cierra nada", async () => {
    expect(await pending("fp_token_que_no_existe_0000")).toBeNull();
    await expect(anon("select public.ingest_backfill_done($1) as r", ["fp_token_que_no_existe_0000"])).rejects.toThrow(/Token no válido/);
  });
});
