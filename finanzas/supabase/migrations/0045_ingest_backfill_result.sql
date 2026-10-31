-- 0045 · El primer barrido dice qué encontró
-- El Apps Script, al terminar, informa cuántos correos envió y si encontró la etiqueta de Gmail.
-- Así la app puede avisar "no había correos" o "no existe la etiqueta" en vez de dar el barrido por bueno.
-- Se puede correr más de una vez.

alter table public.ingest_backfills
  add column if not exists sent integer,
  add column if not exists label_found boolean;

-- Pedir de nuevo borra el resultado anterior
create or replace function public.request_ingest_backfill(p_from date)
returns date
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hh uuid := public.my_household_id();
  v_today date := (now() at time zone 'America/Bogota')::date;
begin
  if v_uid is null or v_hh is null then raise exception 'No perteneces a un hogar'; end if;
  if not exists (select 1 from ingest_tokens where user_id = v_uid) then
    raise exception 'Primero genera tu token en Captura automática';
  end if;
  if p_from is null or p_from > v_today or p_from < v_today - 92 then
    raise exception 'La fecha de inicio no es válida';
  end if;
  insert into ingest_backfills (user_id, household_id, from_date, requested_at, done_at, sent, label_found)
  values (v_uid, v_hh, p_from, now(), null, null, null)
  on conflict (user_id) do update
    set household_id = excluded.household_id, from_date = excluded.from_date, requested_at = now(),
        done_at = null, sent = null, label_found = null;
  return p_from;
end;
$$;
revoke all on function public.request_ingest_backfill(date) from public, anon;
grant execute on function public.request_ingest_backfill(date) to authenticated;

-- Se reemplaza la firma de 0044 (solo token) por una con el resultado; los datos son opcionales.
drop function if exists public.ingest_backfill_done(text);
create or replace function public.ingest_backfill_done(p_token text, p_sent integer default null, p_label_found boolean default null)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tok ingest_tokens;
begin
  if p_token is null or length(p_token) < 20 then raise exception 'Token no válido'; end if;
  select * into v_tok from ingest_tokens where token_hash = encode(digest(p_token, 'sha256'), 'hex');
  if not found then raise exception 'Token no válido'; end if;
  update ingest_backfills
     set done_at = now(), sent = greatest(0, p_sent), label_found = p_label_found
   where user_id = v_tok.user_id and done_at is null;
end;
$$;
revoke all on function public.ingest_backfill_done(text, integer, boolean) from public;
grant execute on function public.ingest_backfill_done(text, integer, boolean) to anon, authenticated;
