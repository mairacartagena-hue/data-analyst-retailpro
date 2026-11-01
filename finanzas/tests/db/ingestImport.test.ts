// Primer barrido del celular: la persona sube SMS o avisos con su sesión y entran como los del webhook,
// sin repetir lo que ya estaba (migraciones 0047 y 0048).

import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, rpc, setupDb } from "./harness";

const MAY = "00000000-0000-0000-0000-00000000000a";
type R = { result: string; transaction_id?: string };

const purchase = (amount: number, merchant: string, occurred_at: string | null = null) =>
  ({ kind: "PURCHASE", amount, merchant, merchant_norm: merchant.toLowerCase(), occurred_at, identifiers: [], tags: [] });

const ev = (over: Record<string, unknown> = {}) => ({
  channel: "ANDROID_SMS",
  source: "85540",
  external_id: "sms:85540:1",
  raw_text: "Bancolombia: Compraste $45.000 en EXITO",
  received_at: "2026-10-20T15:00:00Z",
  parser: "bancolombia",
  parsed: purchase(45000, "Exito"),
  ...over,
});

describe("subir SMS y notificaciones desde la app", () => {
  let db: PGlite;
  let token: string, account: string, cat: string;
  const imp = (e: object) => rpc<R>(db, MAY, "ingest_import_event", e);
  const live = async (e: object) => (await as<{ r: R }>(db, null, `select public.ingest_event($1, $2::jsonb) as r`, [token, JSON.stringify(e)]))[0].r;
  const count = async () => Number((await db.query<{ n: string }>(`select count(*)::text n from transactions`)).rows[0].n);

  beforeAll(async () => {
    db = await setupDb();
    await db.exec(`insert into auth.users values ('${MAY}')`);
    await as(db, MAY, `select public.create_household('Casa', 'May')`);
    token = (await as<{ t: string }>(db, MAY, `select public.create_ingest_token() as t`))[0].t;
    const hh = (await db.query<{ id: string }>(`select id from households`)).rows[0].id;
    account = (await as<{ id: string }>(db, MAY, `insert into accounts (household_id, owner_user_id, name, kind, visibility, opening_balance, opening_at)
      values ($1, $2, 'Nequi', 'DEPOSIT', 'PRIVATE', 0, '2026-01-01') returning id`, [hh, MAY]))[0].id;
    cat = await rpc<string>(db, MAY, "save_category", { name: "Mercado", responsibility: "MEMBER_A_100" });
  }, 30_000);

  it("registra el aviso y no lo duplica si se sube otra vez", async () => {
    expect(await imp(ev())).toMatchObject({ result: "ACCEPTED" });
    expect(await imp(ev())).toMatchObject({ result: "DUPLICATE" });
    expect(await count()).toBe(1);
  });

  it("no acepta Gmail, avisos sin identificador ni llamadas sin sesión", async () => {
    await expect(imp(ev({ channel: "GMAIL", external_id: "x" }))).rejects.toThrow(/SMS o notificaciones/);
    await expect(imp(ev({ external_id: "" }))).rejects.toThrow(/identificador/);
    await expect(rpc(db, null, "ingest_import_event", ev({ external_id: "y" }))).rejects.toThrow();
  });

  it("un SMS que MacroDroid ya había enviado (aunque llegara un rato después) no se repite", async () => {
    const text = "Bancolombia: Compraste $12.300 en D1 SAS con tu T.Deb *9999";
    // MacroDroid lo envió 20 minutos tarde, sin identificador y con otro comercio leído
    await live({ channel: "ANDROID_SMS", source: "85540", raw_text: text, received_at: "2026-10-21T15:20:00Z", parsed: purchase(12300, "D1") });
    const before = await count();
    expect(await imp(ev({ external_id: "sms:85540:2", raw_text: text, received_at: "2026-10-21T15:00:00Z", parsed: purchase(12300, "Tiendas D1") })))
      .toMatchObject({ result: "DUPLICATE" });
    expect(await count()).toBe(before);
  });

  it("tampoco repite un aviso que llegó y no se reconoció", async () => {
    const text = "Nequi: Tienes un movimiento nuevo por revisar en tu app";
    await live({ channel: "ANDROID_NOTIFICATION", source: "Nequi", raw_text: `Nequi\n${text}`, received_at: "2026-10-22T13:00:00Z", parsed: null });
    expect(await imp(ev({ channel: "ANDROID_NOTIFICATION", source: "Nequi", external_id: "pegado:2026-10-22:a", raw_text: text, received_at: "2026-10-22T17:00:00Z", parsed: null })))
      .toMatchObject({ result: "DUPLICATE" });
    const logs = await as<{ n: string }>(db, MAY, `select count(*)::text n from ingest_logs where channel = 'ANDROID_NOTIFICATION'`);
    expect(logs[0].n).toBe("1");
  });

  it("un aviso pegado (solo con el día) se une con lo que ya se registró a mano", async () => {
    const manual = await rpc<string>(db, MAY, "save_transaction", { kind: "EXPENSE", amount: 58_000, occurred_on: "2026-10-23", account_id: account,
      description: "Carulla", splits: [{ amount: 58_000, category_id: cat }] });
    const before = await count();
    const r = await imp(ev({ channel: "ANDROID_NOTIFICATION", source: "Nequi", external_id: "pegado:2026-10-24:b",
      raw_text: "Pagaste $58.000 en CARULLA", received_at: "2026-10-24T17:00:00Z", parsed: purchase(58_000, "Carulla") }));
    expect(r).toMatchObject({ result: "MERGED", transaction_id: manual });
    expect(await count()).toBe(before);
  });

  it("un aviso pegado se une con el mismo pago que ya llegó por correo con su hora", async () => {
    const mail = await live({ channel: "GMAIL", external_id: "gm1", raw_text: "Compra en RAPPI", received_at: "2026-10-25T19:32:00Z", parsed: purchase(27_500, "Rappi", "2026-10-25T19:32:00Z") });
    expect(mail.result).toBe("ACCEPTED");
    const r = await imp(ev({ channel: "ANDROID_NOTIFICATION", source: "Nequi", external_id: "pegado:2026-10-25:e",
      raw_text: "Pagaste $27.500 en Rappi Colombia", received_at: "2026-10-25T17:00:00Z", parsed: purchase(27_500, "Rappi Colombia") }));
    expect(r).toMatchObject({ result: "MERGED", transaction_id: mail.transaction_id });
  });

  it("lo mismo pegado con días de diferencia, o con otro monto, sí es un movimiento nuevo", async () => {
    const base = { channel: "ANDROID_NOTIFICATION", source: "Nequi", parsed: purchase(58_000, "Carulla") };
    expect(await imp({ ...ev(base), external_id: "pegado:2026-10-28:c", raw_text: "Pagaste $58.000 en CARULLA", received_at: "2026-10-28T17:00:00Z" }))
      .toMatchObject({ result: "ACCEPTED" });
    expect(await imp({ ...ev(base), external_id: "pegado:2026-10-24:d", raw_text: "Pagaste $61.000 en CARULLA", received_at: "2026-10-24T17:00:00Z", parsed: purchase(61_000, "Carulla") }))
      .toMatchObject({ result: "ACCEPTED" });
  });
});
