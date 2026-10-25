// Migración 0025: un aviso sin fecha (correo de AvalPay) se une con el mismo pago que ya está registrado,
// aunque lo lean días después, y los avisos con fecha siguen comparándose por minutos.

import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, rpc, setupDb } from "./harness";

const MAY = "00000000-0000-0000-0000-00000000000a";

describe("avisos sin fecha", () => {
  let db: PGlite;
  let token: string, hipotecario: string;
  const ingest = async (ev: object) => (await as<{ r: { result: string; transaction_id?: string } }>(db, null, `select public.ingest_event($1, $2::jsonb) as r`, [token, JSON.stringify(ev)]))[0].r;
  const count = async () => Number((await db.query<{ n: string }>(`select count(*)::text n from transactions where kind = 'EXPENSE'`)).rows[0].n);
  let n = 0;
  // Bancolombia: trae fecha y hora
  const dated = (amount: number, at: string) => ({
    channel: "GMAIL", external_id: `d${++n}`, received_at: at,
    parsed: { kind: "PURCHASE", amount, merchant: "Banco de Bogota", merchant_norm: "banco de bogota", last4: "2505", occurred_at: at, identifiers: [] },
  });
  // AvalPay: sin fecha en el texto; solo se sabe la fecha del correo (received_at)
  const undated = (amount: number, readAt: string, merchant = "Banco Bogota - Credito Hipotecario") => ({
    channel: "GMAIL", external_id: `u${++n}`, received_at: readAt,
    parsed: { kind: "PURCHASE", amount, merchant, merchant_norm: merchant.toLowerCase(), occurred_at: null, identifiers: [] },
  });

  beforeAll(async () => {
    db = await setupDb();
    await db.exec(`insert into auth.users values ('${MAY}')`);
    await as(db, MAY, `select public.create_household('Casa', 'May')`);
    const hh = (await db.query<{ id: string }>(`select id from households`)).rows[0].id;
    await as(db, MAY, `insert into accounts (household_id, owner_user_id, name, kind, visibility, opening_balance, opening_at, last4)
      values ($1, $2, 'Ahorros', 'DEPOSIT', 'PRIVATE', 5000000, '2026-01-01', '2505')`, [hh, MAY]);
    hipotecario = await rpc<string>(db, MAY, "save_category", { name: "Hipotecario", responsibility: "MEMBER_A_100" });
    token = (await as<{ t: string }>(db, MAY, `select public.create_ingest_token() as t`))[0].t;
  }, 30_000);

  it("el correo sin fecha leído días después se une al pago que ya trae fecha", async () => {
    const real = await ingest(dated(1_950_980, "2026-10-05T20:14:34Z"));
    expect(real.result).toBe("ACCEPTED");
    const late = await ingest(undated(1_950_980, "2026-10-05T20:20:00Z"));
    expect(late).toMatchObject({ result: "MERGED", transaction_id: real.transaction_id });
    expect(await count()).toBe(1);
  });

  it("aunque el movimiento ya esté confirmado con 'Aplicar siempre', el aviso sin fecha no crea otro", async () => {
    const first = (await db.query<{ id: string }>(`select id from transactions limit 1`)).rows[0].id;
    await rpc(db, MAY, "save_transaction", { id: first, kind: "EXPENSE", amount: 1_950_980, occurred_on: "2026-10-05",
      account_id: (await db.query<{ id: string }>(`select id from accounts`)).rows[0].id, merchant: "Banco de Bogota", splits: [{ amount: 1_950_980, category_id: hipotecario }] });
    await as(db, MAY, `select public.remember_merchant($1, true)`, [first]);
    const again = await ingest(undated(1_950_980, "2026-10-06T05:40:00Z"));
    expect(again.result).toBe("MERGED");
    expect(await count()).toBe(1);
  });

  it("un monto distinto, o uno de otro mes, sí es otro pago", async () => {
    expect((await ingest(undated(1_953_000, "2026-10-05T20:20:00Z"))).result).toBe("ACCEPTED");
    expect((await ingest(undated(1_950_980, "2026-11-20T08:12:00Z"))).result).toBe("ACCEPTED");
    expect(await count()).toBe(3);
  });

  it("un aviso CON fecha del mismo monto, pero de otro momento, sigue siendo un pago nuevo", async () => {
    const r = await ingest(dated(1_950_980, "2026-11-05T15:00:00Z"));
    expect(r.result).toBe("ACCEPTED");
  });

  it("el nombre del comercio queda solo con letras latinas (sin el alfabeto que agrega Gemini)", async () => {
    const r = await ingest(undated(77_000, "2026-12-01T10:00:00Z", "Banco De Bogotá - Crédito Hipotecarioခင်ဗျားအတွက်"));
    const row = (await db.query<{ merchant: string }>(`select merchant from transactions where id = $1`, [r.transaction_id])).rows[0];
    expect(row.merchant).toBe("Banco De Bogotá - Crédito Hipotecario");
  });

  it("el registro del aviso guarda la fecha del correo para que 'Reintentar' no use la hora de lectura", async () => {
    const r = await ingest({ channel: "GMAIL", external_id: "ev1", received_at: "2026-10-02T13:00:00Z", parsed: null });
    expect(r.result).toBe("UNRECOGNIZED");
    const log = (await db.query<{ event_at: string }>(`select event_at::text from ingest_logs where external_id = 'ev1'`)).rows[0];
    expect(new Date(log.event_at).toISOString()).toBe("2026-10-02T13:00:00.000Z");
  });

  it("el archivo de limpieza corre sin errores y no borra nada que no coincida", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const before = await count();
    await db.exec(fs.readFileSync(path.join(__dirname, "../../supabase/cleanup/2026-10-25_copias_hipotecario.sql"), "utf8"));
    expect(await count()).toBe(before);
  });

  it("la migración 0025 se puede volver a correr", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    await db.exec(fs.readFileSync(path.join(__dirname, "../../supabase/migrations/0025_dedupe_undated.sql"), "utf8"));
  });
});
