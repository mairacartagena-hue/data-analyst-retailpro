-- 0044 · Primer barrido de la captura automática
-- Desde Ajustes → Periodos la persona pide traer los correos bancarios desde el inicio del mes hasta hoy.
-- La app no lee Gmail: el Apps Script de la persona pregunta (con su token) si hay un barrido pendiente,
-- lo hace y lo marca como terminado. Un solo pedido por persona; pedir de nuevo lo reemplaza.
-- Los correos ya enviados no se duplican (external_id). Se puede correr más de una vez.

create table if not exists public.ingest_backfills (
  user_id uuid primary key references auth.users (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  from_date date not null,
  requested_at timestamptz not null default now(),
  done_at timestamptz
);

alter table public.ingest_backfills enable row level security;
drop policy if exists "ver mi barrido" on public.ingest_backfills;
create policy "ver mi barrido" on public.ingest_backfills for select to authenticated using (user_id = auth.uid());
-- Solo se escribe con las funciones de abajo
revoke all on public.ingest_backfills from anon, authenticated;
grant select on public.ingest_backfills to authenticated;

-- La persona pide el barrido desde `p_from` (hasta hoy). Hasta 92 días atrás.
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
  insert into ingest_backfills (user_id, household_id, from_date, requested_at, done_at)
  values (v_uid, v_hh, p_from, now(), null)
  on conflict (user_id) do update
    set household_id = excluded.household_id, from_date = excluded.from_date, requested_at = now(), done_at = null;
  return p_from;
end;
$$;
revoke all on function public.request_ingest_backfill(date) from public, anon;
grant execute on function public.request_ingest_backfill(date) to authenticated;

-- El Apps Script pregunta si hay un barrido pendiente: devuelve la fecha de inicio o null.
create or replace function public.ingest_backfill_pending(p_token text)
returns date
language plpgsql stable security definer set search_path = public, extensions
as $$
declare
  v_tok ingest_tokens;
begin
  if p_token is null or length(p_token) < 20 then return null; end if;
  select * into v_tok from ingest_tokens where token_hash = encode(digest(p_token, 'sha256'), 'hex');
  if not found then return null; end if;
  return (select from_date from ingest_backfills where user_id = v_tok.user_id and done_at is null);
end;
$$;
revoke all on function public.ingest_backfill_pending(text) from public;
grant execute on function public.ingest_backfill_pending(text) to anon, authenticated;

-- El Apps Script avisa que terminó el barrido.
create or replace function public.ingest_backfill_done(p_token text)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tok ingest_tokens;
begin
  if p_token is null or length(p_token) < 20 then raise exception 'Token no válido'; end if;
  select * into v_tok from ingest_tokens where token_hash = encode(digest(p_token, 'sha256'), 'hex');
  if not found then raise exception 'Token no válido'; end if;
  update ingest_backfills set done_at = now() where user_id = v_tok.user_id and done_at is null;
end;
$$;
revoke all on function public.ingest_backfill_done(text) from public;
grant execute on function public.ingest_backfill_done(text) to anon, authenticated;
