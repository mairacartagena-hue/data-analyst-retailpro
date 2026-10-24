-- 0016 · Seguridad: avisos del asesor de Supabase (octubre 2026).
-- Algunos permisos de las migraciones 0009, 0014a y 0015 no quedaron aplicados
-- al pegarlas por partes en el SQL Editor. Esta migración los deja fijos.

-- search_path fijo
alter function public.tx_effective_at(timestamptz, date) set search_path = public;

-- Ayudante interno de la deduplicación: solo lo usan ingest_event() y reingest_log()
revoke all on function public.ingest_find_duplicate(uuid, uuid, bigint, boolean, timestamptz, text, uuid)
  from public, anon, authenticated;

-- Funciones de etiquetas: solo con sesión iniciada
revoke all on function public.tag_transactions(uuid[], text, boolean) from public, anon;
revoke all on function public.rename_tag(text, text) from public, anon;
revoke all on function public.remove_tag(text) from public, anon;
grant execute on function public.tag_transactions(uuid[], text, boolean) to authenticated;
grant execute on function public.rename_tag(text, text) to authenticated;
grant execute on function public.remove_tag(text) to authenticated;

-- ingest_event() se queda ejecutable sin sesión a propósito: el webhook la llama
-- con la clave pública y la función valida el token personal de cada persona.
revoke all on function public.ingest_event(text, jsonb) from public;
grant execute on function public.ingest_event(text, jsonb) to anon, authenticated;

-- Las funciones nuevas ya no quedan abiertas sin sesión por defecto;
-- cada migración debe dar el permiso a quien lo necesite.
alter default privileges in schema public revoke execute on functions from public, anon;
