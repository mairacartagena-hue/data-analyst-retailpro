-- 0032 · Notificaciones Web Push.
--  · push_subscriptions: cada celular o navegador donde la persona activó las notificaciones.
--  · push_schedule: recordatorios que la app calcula (vencimientos, tarjetas, cuotas de créditos, cierre del mes)
--    y deja programados para una fecha. Los reemplaza cada vez que se abre la app.
--  · push_due(): la tarea diaria de Vercel pide lo que toca enviar hoy (con una clave propia, sin claves secretas
--    de Supabase). Suma el aviso de movimientos por revisar. push_gone() borra los celulares que ya no existen.
-- Se puede volver a correr sin problema.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (length(endpoint) between 10 and 1000),
  p256dh text not null check (length(p256dh) <= 200),
  auth text not null check (length(auth) <= 100),
  user_agent text check (length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_sent_at timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon;
drop policy if exists "ver mis celulares" on public.push_subscriptions;
create policy "ver mis celulares" on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "borrar mis celulares" on public.push_subscriptions;
create policy "borrar mis celulares" on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());

create table if not exists public.push_schedule (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null check (length(key) <= 200),
  send_on date not null,
  title text not null check (length(title) <= 120),
  body text not null default '' check (length(body) <= 300),
  url text not null default '/' check (url like '/%' and url not like '//%' and length(url) <= 200),
  sent_at timestamptz,
  unique (user_id, key)
);
create index if not exists push_schedule_due_idx on public.push_schedule (send_on) where sent_at is null;

alter table public.push_schedule enable row level security;
revoke all on public.push_schedule from anon;
drop policy if exists "ver mis recordatorios" on public.push_schedule;
create policy "ver mis recordatorios" on public.push_schedule
  for select to authenticated using (user_id = auth.uid());

-- Clave de la tarea diaria (solo su huella). Sin políticas: nadie la lee por la API.
create table if not exists public.push_config (
  id boolean primary key default true check (id),
  secret_hash text not null
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;

-- Activar en este celular (si el celular ya estaba con otra persona, pasa a quien lo activa ahora).
create or replace function public.save_push_subscription(p jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then raise exception 'Necesitas iniciar sesión'; end if;
  if coalesce(p->>'endpoint', '') !~ '^https://' then raise exception 'Suscripción inválida'; end if;
  delete from push_subscriptions where endpoint = p->>'endpoint';
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, p->>'endpoint', p->>'p256dh', p->>'auth', left(p->>'user_agent', 300))
  returning id into v_id;
  return v_id;
end $$;

-- Reemplaza los recordatorios pendientes de la persona. Los que ya se enviaron no se repiten.
create or replace function public.sync_push_schedule(p jsonb)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n integer;
begin
  if v_uid is null then raise exception 'Necesitas iniciar sesión'; end if;
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 300 then raise exception 'Lista de recordatorios inválida'; end if;
  delete from push_schedule where user_id = v_uid and sent_at is null;
  insert into push_schedule (user_id, key, send_on, title, body, url)
  select v_uid, x->>'key', (x->>'send_on')::date, x->>'title', coalesce(x->>'body', ''), coalesce(x->>'url', '/')
  from jsonb_array_elements(p) x
  on conflict (user_id, key) do nothing;
  get diagnostics v_n = row_count;
  -- Los enviados hace más de 60 días ya no evitan repeticiones
  delete from push_schedule where user_id = v_uid and sent_at < now() - interval '60 days';
  return v_n;
end $$;

-- Lo que toca enviar hoy, agrupado por persona, con sus celulares. Marca los recordatorios como enviados.
create or replace function public.push_due(p_secret text, p_today date)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_out jsonb;
begin
  if not exists (select 1 from push_config where secret_hash = encode(digest(coalesce(p_secret, ''), 'sha256'), 'hex')) then
    raise exception 'No autorizado';
  end if;

  with due as (
    select s.id, s.user_id, s.title, s.body, s.url, s.send_on
    from push_schedule s
    where s.sent_at is null and s.send_on between p_today - 2 and p_today
      and exists (select 1 from push_subscriptions ps where ps.user_id = s.user_id)
  ), marked as ( -- se ejecuta siempre, aunque no se lea
    update push_schedule set sent_at = now() where id in (select id from due) returning id
  ), pending as (
    select t.payer_user_id as user_id, count(*) as n
    from transactions t
    where t.status = 'PENDING_REVIEW'
      and exists (select 1 from push_subscriptions ps where ps.user_id = t.payer_user_id)
    group by t.payer_user_id
  ), msgs as (
    select user_id, jsonb_build_object('title', title, 'body', body, 'url', url) as m, send_on as ord from due
    union all
    select user_id, jsonb_build_object(
      'title', case when n = 1 then 'Tienes 1 movimiento por revisar' else 'Tienes ' || n || ' movimientos por revisar' end,
      'body', 'Confírmalos para que tus presupuestos estén al día.',
      'url', '/movimientos?filtro=pendientes'), p_today + 1 from pending
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', u.user_id,
    'messages', u.messages,
    'subscriptions', (select jsonb_agg(jsonb_build_object('endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth))
                      from push_subscriptions ps where ps.user_id = u.user_id)
  )), '[]'::jsonb)
  into v_out
  from (select user_id, jsonb_agg(m order by ord) as messages from msgs group by user_id) u;

  update push_subscriptions set last_sent_at = now()
  where user_id in (select (x->>'user_id')::uuid from jsonb_array_elements(v_out) x);
  return v_out;
end $$;

-- Celulares que el servicio de notificaciones dio por perdidos (desinstalada, permiso quitado).
create or replace function public.push_gone(p_secret text, p_endpoints text[])
returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_n integer;
begin
  if not exists (select 1 from push_config where secret_hash = encode(digest(coalesce(p_secret, ''), 'sha256'), 'hex')) then
    raise exception 'No autorizado';
  end if;
  delete from push_subscriptions where endpoint = any (p_endpoints);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.save_push_subscription(jsonb) from public, anon;
revoke all on function public.sync_push_schedule(jsonb) from public, anon;
grant execute on function public.save_push_subscription(jsonb) to authenticated;
grant execute on function public.sync_push_schedule(jsonb) to authenticated;
revoke all on function public.push_due(text, date) from public;
revoke all on function public.push_gone(text, text[]) from public;
grant execute on function public.push_due(text, date) to anon, authenticated;
grant execute on function public.push_gone(text, text[]) to anon, authenticated;
