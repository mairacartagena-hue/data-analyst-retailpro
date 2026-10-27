// Migración 0040: funciones internas cerradas a la API y validación del token del webhook antes de usar la IA.

import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, setupDb } from "./harness";

const MAY = "00000000-0000-0000-0000-00000000000a";

describe("auditoría de seguridad (0040)", () => {
  let db: PGlite;
  let token = "";
  let hh = "";

  beforeAll(async () => {
    db = await setupDb();
    await db.exec(`insert into auth.users values ('${MAY}')`);
    hh = (await as<{ id: string }>(db, MAY, `select public.create_household('Casa', 'May') as id`))[0].id;
    token = (await as<{ t: string }>(db, MAY, `select public.create_ingest_token() as t`))[0].t;
  }, 30_000);

  it("el token del webhook se valida sin sesión", async () => {
    const ok = async (t: string | null) => (await as<{ v: boolean }>(db, null, `select public.ingest_token_valid($1) as v`, [t]))[0].v;
    expect(await ok(token)).toBe(true);
    expect(await ok("fp_" + "0".repeat(48))).toBe(false);
    expect(await ok("corto")).toBe(false);
    expect(await ok(null)).toBe(false);
  });

  it("slot_user y category_responsible ya no se pueden llamar desde la API", async () => {
    await expect(as(db, MAY, `select public.slot_user($1, 'A')`, [hh])).rejects.toThrow(/permission denied/);
    await expect(as(db, null, `select public.slot_user($1, 'A')`, [hh])).rejects.toThrow(/permission denied/);
    await expect(as(db, MAY, `select public.category_responsible(gen_random_uuid())`)).rejects.toThrow(/permission denied/);
  });

  it("las funciones que las usan por dentro siguen funcionando", async () => {
    // add_suggested_categories y save_transaction corren como dueño y no necesitan el permiso
    await as(db, MAY, `select public.add_suggested_categories()`);
    const cats = await as(db, MAY, `select id from categories`);
    expect(cats.length).toBeGreaterThan(0);
  });
});
