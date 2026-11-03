-- 0054 · Revisión de seguridad (3-nov-2026). Se puede correr más de una vez.
--
-- 1. Tres tablas nuevas quedaron con permisos para quien no inició sesión (anon), incluido TRUNCATE (vaciar la
--    tabla), que no respeta la RLS. La API pública no lo expone, pero se quitan: nadie sin sesión las necesita.
revoke all on table public.account_reconciliations from anon;
revoke all on table public.contacts from anon;
revoke all on table public.contact_ledger from anon;

-- 2. La tabla del barrido de Gmail se creó después de la 0041 y no tenía la regla de la verificación en dos pasos.
drop policy if exists "verificacion en dos pasos" on public.ingest_backfills;
create policy "verificacion en dos pasos" on public.ingest_backfills as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));

-- 3. Funciones internas (un trigger y un ayudante de la deduplicación) que quedaron ejecutables sin sesión.
revoke all on function public.credit_payment_household() from public, anon;
revoke all on function public.ingest_merchant_compatible(text, text) from public, anon;
