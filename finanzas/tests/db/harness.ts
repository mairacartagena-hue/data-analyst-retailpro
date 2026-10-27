// Base de datos de prueba en memoria (PGlite) con lo mínimo de Supabase (auth.uid(), roles y Realtime)
// para correr las migraciones reales y probar permisos y funciones como cada persona.

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(__dirname, "../../supabase/migrations");

/** Corre las migraciones en orden; `before` se ejecuta justo antes de la migración `until` (para probar datos viejos). */
export async function setupDb(opts: { until?: string; before?: (db: PGlite) => Promise<void> } = {}): Promise<PGlite> {
  const db = new PGlite({ extensions: { pg_trgm, pgcrypto } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create schema extensions;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable
      as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid not null, status text not null);
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    grant execute on function auth.jwt() to authenticated, anon;
    create publication supabase_realtime;
    grant usage on schema public to authenticated, anon;
    alter default privileges in schema public grant all on tables to authenticated, anon;
    create extension pgcrypto;
  `);
  let before = opts.before;
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".sql")).sort()) {
    if (opts.until && f >= opts.until && before) {
      await before(db);
      before = undefined;
    }
    try {
      await db.exec(fs.readFileSync(path.join(DIR, f), "utf8"));
    } catch (e) {
      throw new Error(`${f}: ${(e as Error).message}`);
    }
  }
  return db;
}

/** Consulta como una persona con sesión (RLS activa). Sin uid = sin sesión. */
export async function as<T = Record<string, unknown>>(db: PGlite, uid: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

/** Llama una función que recibe un jsonb. */
export async function rpc<T = unknown>(db: PGlite, uid: string | null, fn: string, p: unknown): Promise<T> {
  const rows = await as<{ r: T }>(db, uid, `select public.${fn}($1::jsonb) as r`, [JSON.stringify(p)]);
  return rows[0].r;
}
