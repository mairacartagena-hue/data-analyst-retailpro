-- 0041 · Verificación en dos pasos (código de una app autenticadora). Se puede correr más de una vez.
--
-- Quien activa la verificación en dos pasos solo ve y cambia datos después de escribir el código (sesión "aal2").
-- Quien no la activa sigue igual. La base lo exige, no solo la pantalla: con la contraseña sola no se lee nada.

-- ¿La sesión cumple? Sí si ya pasó el código, o si la persona no tiene la verificación activada.
create or replace function public.mfa_ok()
returns boolean
language sql
stable security definer set search_path = public, auth
as $$
  select coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status::text = 'verified')
$$;
revoke all on function public.mfa_ok() from public, anon;
grant execute on function public.mfa_ok() to authenticated;

-- 1. Tablas: una regla restrictiva en todas (se suma a las que ya existen).
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('drop policy if exists "verificacion en dos pasos" on public.%I', t);
    execute format('create policy "verificacion en dos pasos" on public.%I as restrictive for all to authenticated '
                   'using ((select public.mfa_ok())) with check ((select public.mfa_ok()))', t);
  end loop;
end $$;

-- 2. Funciones: casi todas pasan por my_household_id() o is_member(); sin el código no hay hogar.
create or replace function public.my_household_id()
returns uuid
language sql
stable security definer set search_path = public
as $$ select household_id from household_members where user_id = auth.uid() and public.mfa_ok() $$;

create or replace function public.is_member(p_household_id uuid)
returns boolean
language sql
stable security definer set search_path = public
as $$
  select public.mfa_ok() and exists (select 1 from household_members where household_id = p_household_id and user_id = auth.uid())
$$;

-- Las que leen sin pasar por ellas
create or replace function public.account_balances()
returns table (account_id uuid, balance bigint)
language sql
stable security definer set search_path = public
as $$
  select a.id,
         a.opening_balance + coalesce((
           select sum(
                    case when t.account_id = a.id then tx_sign(t.kind, t.direction) * t.amount else 0 end
                  + case when t.to_account_id = a.id then t.amount else 0 end)
           from transactions t
           where (t.account_id = a.id or t.to_account_id = a.id)
             and tx_effective_at(t.occurred_at, t.occurred_on) >= a.opening_at
         ), 0)::bigint
  from accounts a
  join household_members m on m.household_id = a.household_id and m.user_id = auth.uid()
  where (a.owner_user_id = auth.uid() or a.visibility in ('PUBLIC', 'BALANCE_ONLY'))
    and public.mfa_ok()
$$;

create or replace function public.account_labels()
returns table (id uuid, owner_user_id uuid, name text, kind text, institution text, last4 text, visibility text)
language sql
stable security definer set search_path = public
as $$
  select a.id, a.owner_user_id, a.name, a.kind, a.institution, a.last4, a.visibility
  from accounts a
  join household_members m on m.household_id = a.household_id and m.user_id = auth.uid()
  where (a.owner_user_id = auth.uid() or a.visibility <> 'PRIVATE' or a.reveal_in_shared)
    and public.mfa_ok()
$$;

-- Notificaciones: sin el código no se puede registrar un celular para recibir los avisos de otra persona
create or replace function public.save_push_subscription(p jsonb)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then raise exception 'Necesitas iniciar sesión'; end if;
  if not public.mfa_ok() then raise exception 'Escribe el código de verificación'; end if;
  if coalesce(p->>'endpoint', '') !~ '^https://' then raise exception 'Suscripción inválida'; end if;
  delete from push_subscriptions where endpoint = p->>'endpoint';
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, p->>'endpoint', p->>'p256dh', p->>'auth', left(p->>'user_agent', 300))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.sync_push_schedule(p jsonb)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n integer;
begin
  if v_uid is null then raise exception 'Necesitas iniciar sesión'; end if;
  if not public.mfa_ok() then raise exception 'Escribe el código de verificación'; end if;
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 300 then raise exception 'Lista de recordatorios inválida'; end if;
  delete from push_schedule where user_id = v_uid and sent_at is null;
  insert into push_schedule (user_id, key, send_on, title, body, url)
  select v_uid, x->>'key', (x->>'send_on')::date, x->>'title', coalesce(x->>'body', ''), coalesce(x->>'url', '/')
  from jsonb_array_elements(p) x
  on conflict (user_id, key) do nothing;
  get diagnostics v_n = row_count;
  delete from push_schedule where user_id = v_uid and sent_at < now() - interval '60 days';
  return v_n;
end $$;
