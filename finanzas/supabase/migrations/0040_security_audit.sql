-- 0040 · Ajustes de seguridad (auditoría del 27-oct-2026). Se puede correr más de una vez.
--
-- 1. Funciones internas que no deben llamarse desde la API:
--    slot_user() y category_responsible() devolvían el id de usuario de cualquier hogar si se conocía su id;
--    accounts_check_responsible() es la función del trigger de cuentas. Las siguen usando por dentro las
--    funciones SECURITY DEFINER y el trigger, que corren como dueño y no necesitan este permiso.
revoke all on function public.slot_user(uuid, text) from public, anon, authenticated;
revoke all on function public.category_responsible(uuid) from public, anon, authenticated;
revoke all on function public.accounts_check_responsible() from public, anon, authenticated;

-- 2. El webhook de captura valida el token ANTES de leer el aviso con Gemini, para que alguien sin token
--    no pueda gastar el cupo gratuito de la IA enviando textos. Solo dice sí o no; el token es aleatorio de
--    192 bits, así que no sirve para adivinarlo.
create or replace function public.ingest_token_valid(p_token text)
returns boolean
language sql
stable security definer set search_path = public, extensions
as $$
  select p_token is not null and length(p_token) >= 20
     and exists (select 1 from ingest_tokens where token_hash = encode(digest(p_token, 'sha256'), 'hex'))
$$;
revoke all on function public.ingest_token_valid(text) from public;
grant execute on function public.ingest_token_valid(text) to anon, authenticated;
