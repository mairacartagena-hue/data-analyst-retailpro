// Migración 0041: con la verificación en dos pasos activada, sin el código (sesión aal1) no se ve ni se cambia nada.

import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, setupDb } from "./harness";

const MAY = "00000000-0000-0000-0000-00000000000a";
const BREI = "00000000-0000-0000-0000-00000000000b";

describe("verificación en dos pasos (0041)", () => {
  let db: PGlite;
  let hh = "";
  /** Consulta como MAY con la sesión en el nivel dado (aal1 = solo contraseña, aal2 = ya escribió el código). */
  const asMay = async <T = Record<string, unknown>>(aal: "aal1" | "aal2", sql: string) => {
    await db.exec(`select set_config('request.jwt.claims', '{"aal":"${aal}"}', false)`);
    try {
      return await as<T>(db, MAY, sql);
    } finally {
      await db.exec(`select set_config('request.jwt.claims', '', false)`);
    }
  };

  beforeAll(async () => {
    db = await setupDb();
    await db.exec(`insert into auth.users values ('${MAY}'), ('${BREI}')`);
    hh = (await as<{ id: string }>(db, MAY, `select public.create_household('Casa', 'May') as id`))[0].id;
    await as(db, MAY, `insert into accounts (household_id, owner_user_id, name, kind) values (public.my_household_id(), '${MAY}', 'Ahorros', 'DEPOSIT')`);
  }, 30_000);

  it("sin la verificación activada todo sigue igual", async () => {
    expect(await asMay("aal1", `select id from accounts`)).toHaveLength(1);
    expect((await asMay<{ v: boolean }>("aal1", `select public.mfa_ok() as v`))[0].v).toBe(true);
  });

  it("con la verificación activada, la contraseña sola no deja ver ni cambiar nada", async () => {
    await db.exec(`insert into auth.mfa_factors (user_id, status) values ('${MAY}', 'verified')`);
    expect(await asMay("aal1", `select id from accounts`)).toHaveLength(0);
    expect(await asMay("aal1", `select * from public.account_balances()`)).toHaveLength(0);
    expect((await asMay<{ h: string | null }>("aal1", `select public.my_household_id() as h`))[0].h).toBeNull();
    await expect(asMay("aal1", `insert into accounts (household_id, owner_user_id, name, kind) values ('${hh}', '${MAY}', 'Otra', 'CASH')`)).rejects.toThrow();
    await expect(asMay("aal1", `select public.save_push_subscription('{"endpoint":"https://push.example/x","p256dh":"k","auth":"a"}'::jsonb)`)).rejects.toThrow(/código/);
  });

  it("después del código (aal2) se ve todo", async () => {
    expect(await asMay("aal2", `select id from accounts`)).toHaveLength(1);
    expect(await asMay("aal2", `select * from public.account_balances()`)).toHaveLength(1);
  });

  it("un factor sin terminar de configurar no bloquea", async () => {
    await db.exec(`update auth.mfa_factors set status = 'unverified' where user_id = '${MAY}'`);
    expect(await asMay("aal1", `select id from accounts`)).toHaveLength(1);
  });
});
