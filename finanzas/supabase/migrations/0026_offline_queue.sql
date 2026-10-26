-- 0026 · Registrar sin conexión (Fase 3).
-- Los movimientos que se guardan sin internet quedan en una cola del celular y se envían cuando vuelve la conexión.
-- Cada uno lleva un id propio (client_id): si un envío llegó pero la respuesta se perdió, reenviarlo no lo duplica.
-- Se puede volver a correr sin problema.

create table if not exists public.client_submissions (
  client_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  transaction_id uuid references public.transactions (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.client_submissions enable row level security;
-- Solo la usa save_transaction_once(); nadie la lee ni la escribe desde la API.
revoke all on table public.client_submissions from anon, authenticated;

-- Guarda un movimiento nuevo una sola vez por client_id. Devuelve el id del movimiento (el ya creado si se repite).
create or replace function public.save_transaction_once(p jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_client uuid := nullif(p->>'client_id', '')::uuid;
  v_prev client_submissions;
  v_id uuid;
begin
  if v_uid is null then raise exception 'Necesitas iniciar sesión'; end if;
  if v_client is null then raise exception 'Falta el identificador del envío'; end if;
  if nullif(p->>'id', '') is not null then raise exception 'Solo para movimientos nuevos'; end if;

  -- Dos envíos iguales al mismo tiempo: el segundo espera al primero
  perform pg_advisory_xact_lock(hashtext(v_client::text));
  select * into v_prev from client_submissions where client_id = v_client;
  if found then
    if v_prev.user_id <> v_uid then raise exception 'Identificador de envío no válido'; end if;
    return v_prev.transaction_id;
  end if;

  v_id := save_transaction(p - 'client_id');
  insert into client_submissions (client_id, user_id, transaction_id) values (v_client, v_uid, v_id);
  return v_id;
end $$;

revoke all on function public.save_transaction_once(jsonb) from public, anon;
grant execute on function public.save_transaction_once(jsonb) to authenticated;
