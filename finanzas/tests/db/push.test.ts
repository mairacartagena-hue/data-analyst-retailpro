// Web Push: cada persona ve y cambia solo lo suyo; la tarea diaria necesita su clave y no repite recordatorios.

import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, rpc, setupDb } from "./harness";

const MAY = "00000000-0000-0000-0000-00000000000a";
const BREI = "00000000-0000-0000-0000-00000000000b";
const SECRET = "clave-de-prueba";

describe("notificaciones web push", () => {
  let db: PGlite;
  const due = async (secret: string, today: string) =>
    (await as<{ r: { user_id: string; messages: { title: string; url: string }[]; subscriptions: { endpoint: string }[] }[] }>(
      db, null, `select public.push_due($1, $2::date) as r`, [secret, today]))[0].r;

  beforeAll(async () => {
    db = await setupDb();
    await db.exec(`insert into auth.users values ('${MAY}'), ('${BREI}')`);
    await db.exec(`insert into push_config (secret_hash) values (encode(digest('${SECRET}', 'sha256'), 'hex'))`);
  }, 30_000);

  it("cada uno activa sus celulares y no ve los del otro", async () => {
    await rpc(db, MAY, "save_push_subscription", { endpoint: "https://push.example/may", p256dh: "k", auth: "a" });
    await rpc(db, BREI, "save_push_subscription", { endpoint: "https://push.example/brei", p256dh: "k", auth: "a" });
    expect(await as(db, MAY, `select endpoint from push_subscriptions`)).toEqual([{ endpoint: "https://push.example/may" }]);
    expect(await as(db, null, `select endpoint from push_subscriptions`)).toHaveLength(0);
    await expect(as(db, MAY, `insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://x.example/1', 'k', 'a')`, [BREI])).rejects.toThrow();
    await expect(rpc(db, MAY, "save_push_subscription", { endpoint: "http://inseguro", p256dh: "k", auth: "a" })).rejects.toThrow();
  });

  it("sin la clave, la tarea diaria no recibe nada", async () => {
    await expect(due("otra", "2026-10-26")).rejects.toThrow(/No autorizado/);
    await expect(as(db, null, `select public.push_gone('otra', array['https://push.example/may'])`)).rejects.toThrow();
  });

  it("envía lo que vence hoy una sola vez y reemplaza lo pendiente al sincronizar", async () => {
    await rpc(db, MAY, "sync_push_schedule", [
      { key: "pago:1:2026-10-27:-1", send_on: "2026-10-26", title: "Mañana vence Arriendo", body: "$1.500.000", url: "/presupuestos" },
      { key: "cierre:2026-10", send_on: "2026-11-01", title: "Haz el cierre de octubre", url: "/cierre?mes=2026-10" },
    ]);
    const first = await due(SECRET, "2026-10-26");
    expect(first).toHaveLength(1);
    expect(first[0].user_id).toBe(MAY);
    expect(first[0].messages.map((m) => m.title)).toEqual(["Mañana vence Arriendo"]);
    expect(await due(SECRET, "2026-10-26")).toHaveLength(0);

    // Al volver a sincronizar, lo ya enviado no se repite y lo pendiente se reemplaza
    await rpc(db, MAY, "sync_push_schedule", [
      { key: "pago:1:2026-10-27:-1", send_on: "2026-10-26", title: "Mañana vence Arriendo" },
    ]);
    expect(await due(SECRET, "2026-10-26")).toHaveLength(0);
    expect(await due(SECRET, "2026-11-01")).toHaveLength(0); // el cierre ya no estaba en la lista
    expect(await as(db, BREI, `select id from push_schedule`)).toHaveLength(0);
  });

  it("no acepta enlaces a otros sitios", async () => {
    await expect(rpc(db, MAY, "sync_push_schedule", [{ key: "x", send_on: "2026-10-26", title: "x", url: "https://malo.example" }])).rejects.toThrow();
    await expect(rpc(db, MAY, "sync_push_schedule", [{ key: "x", send_on: "2026-10-26", title: "x", url: "//malo.example" }])).rejects.toThrow();
  });

  it("borra los celulares perdidos", async () => {
    await as(db, null, `select public.push_gone($1, array['https://push.example/brei'])`, [SECRET]);
    expect(await as(db, BREI, `select id from push_subscriptions`)).toHaveLength(0);
  });
});
