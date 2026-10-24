-- Finanzas en Pareja · parte 1 de 4. Pegar completo en SQL Editor → Run. Correr en orden: 1, 2, 3, 4.

-- Limpia políticas de un intento anterior (para poder volver a crearlas)
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- 0002 · Funciones de apoyo y operaciones del hogar, presupuestos y cruce.
-- Las escrituras de categorías, transacciones y cruce pasan por estas funciones
-- (SECURITY DEFINER) para validar las reglas y mantener el libro de cruce al día.

-- ---------------------------------------------------------------
-- Ayudantes de pertenencia y visibilidad
-- ---------------------------------------------------------------
create or replace function public.my_household_id()
returns uuid
language sql stable security definer set search_path = public
as $$ select household_id from household_members where user_id = auth.uid() $$;

create or replace function public.is_member(p_household_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from household_members where household_id = p_household_id and user_id = auth.uid())
$$;

create or replace function public.slot_user(p_household_id uuid, p_slot text)
returns uuid
language sql stable security definer set search_path = public
as $$ select user_id from household_members where household_id = p_household_id and slot = p_slot $$;

-- Responsable único de una categoría (null en FIXED_AMOUNTS: son los dos).
create or replace function public.category_responsible(p_category_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select case c.responsibility
           when 'MEMBER_A_100' then slot_user(c.household_id, 'A')
           when 'MEMBER_B_100' then slot_user(c.household_id, 'B')
           when 'PRIVATE' then c.owner_user_id
         end
  from categories c where c.id = p_category_id
$$;

-- La categoría existe para mí (las privadas solo para su dueño).
create or replace function public.can_see_category(p_category_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from categories c
    join household_members m on m.household_id = c.household_id and m.user_id = auth.uid()
    where c.id = p_category_id
      and (c.responsibility <> 'PRIVATE' or c.owner_user_id = auth.uid())
  )
$$;

-- Puedo ver el presupuesto, el límite y lo ejecutado de la categoría.
create or replace function public.can_see_budget(p_category_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from categories c
    join household_members m on m.household_id = c.household_id and m.user_id = auth.uid()
    where c.id = p_category_id
      and (
        c.is_shared_progress
        or c.responsibility = 'FIXED_AMOUNTS'
        or (c.responsibility = 'PRIVATE' and c.owner_user_id = auth.uid())
        or (c.responsibility = 'MEMBER_A_100' and m.slot = 'A')
        or (c.responsibility = 'MEMBER_B_100' and m.slot = 'B')
      )
  )
$$;

-- Reglas de visibilidad de un movimiento:
--  · siempre: quien pagó, quien lo registró, la contraparte y los responsables de algún desglose
--  · ingreso: si se compartió o entró a una cuenta pública
--  · transferencia: si alguna de las cuentas es pública
--  · gasto: si toca una categoría de progreso compartido, o si salió de una cuenta pública
--    y no tiene desgloses en categorías privadas (la privacidad gana)
create or replace function public.can_see_transaction(p_transaction_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from transactions t
    join household_members m on m.household_id = t.household_id and m.user_id = auth.uid()
    left join accounts a on a.id = t.account_id
    left join accounts a2 on a2.id = t.to_account_id
    where t.id = p_transaction_id
      and (
        t.payer_user_id = auth.uid()
        or t.created_by = auth.uid()
        or t.counterparty_user_id = auth.uid()
        or exists (select 1 from transaction_splits s
                   where s.transaction_id = t.id and s.responsible_user_id = auth.uid())
        or (t.kind = 'INCOME' and (t.is_shared or a.visibility = 'PUBLIC'))
        or (t.kind = 'TRANSFER' and (a.visibility = 'PUBLIC' or a2.visibility = 'PUBLIC'))
        or (t.kind = 'EXPENSE' and (
              exists (select 1 from transaction_splits s join categories c on c.id = s.category_id
                      where s.transaction_id = t.id and c.is_shared_progress)
              or (a.visibility = 'PUBLIC'
                  and not exists (select 1 from transaction_splits s join categories c on c.id = s.category_id
                                  where s.transaction_id = t.id and c.responsibility = 'PRIVATE'))
           ))
      )
  )
$$;

revoke all on function public.my_household_id() from public;
revoke all on function public.is_member(uuid) from public;
revoke all on function public.slot_user(uuid, text) from public;
revoke all on function public.category_responsible(uuid) from public;
revoke all on function public.can_see_category(uuid) from public;
revoke all on function public.can_see_budget(uuid) from public;
revoke all on function public.can_see_transaction(uuid) from public;
grant execute on function public.my_household_id() to authenticated;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.slot_user(uuid, text) to authenticated;
grant execute on function public.category_responsible(uuid) to authenticated;
grant execute on function public.can_see_category(uuid) to authenticated;
grant execute on function public.can_see_budget(uuid) to authenticated;
grant execute on function public.can_see_transaction(uuid) to authenticated;

-- ---------------------------------------------------------------
-- Lecturas calculadas que respetan la privacidad
-- ---------------------------------------------------------------

-- Saldo de las cuentas cuyo saldo puedo ver (mías, PUBLIC o BALANCE_ONLY).
create or replace function public.account_balances()
returns table (account_id uuid, balance bigint)
language sql stable security definer set search_path = public
as $$
  select a.id,
         a.opening_balance + coalesce((
           select sum(
                    case when t.account_id = a.id
                         then case when t.kind = 'INCOME' then t.amount else -t.amount end
                         else 0 end
                  + case when t.to_account_id = a.id then t.amount else 0 end)
           from transactions t
           where t.account_id = a.id or t.to_account_id = a.id
         ), 0)::bigint
  from accounts a
  join household_members m on m.household_id = a.household_id and m.user_id = auth.uid()
  where a.owner_user_id = auth.uid() or a.visibility in ('PUBLIC', 'BALANCE_ONLY')
$$;

-- Nombres de cuentas que puedo mostrar: mías, no privadas o privadas que su dueño decidió mostrar.
create or replace function public.account_labels()
returns table (id uuid, owner_user_id uuid, name text, kind text, institution text, last4 text, visibility text)
language sql stable security definer set search_path = public
as $$
  select a.id, a.owner_user_id, a.name, a.kind, a.institution, a.last4, a.visibility
  from accounts a
  join household_members m on m.household_id = a.household_id and m.user_id = auth.uid()
  where a.owner_user_id = auth.uid() or a.visibility <> 'PRIVATE' or a.reveal_in_shared
$$;

-- Ejecutado por día, categoría y responsable, solo en categorías cuyo progreso puedo ver.
-- Incluye montos de movimientos que no puedo abrir (ej. pagados desde una cuenta privada),
-- para que las barras compartidas cuadren en los dos celulares.
create or replace function public.category_daily_spending(p_from date, p_to date)
returns table (category_id uuid, responsible_user_id uuid, occurred_on date, total bigint)
language sql stable security definer set search_path = public
as $$
  select s.category_id, s.responsible_user_id, t.occurred_on, sum(s.amount)::bigint
  from transaction_splits s
  join transactions t on t.id = s.transaction_id
  where t.household_id = my_household_id()
    and t.kind = 'EXPENSE'
    and t.occurred_on between p_from and p_to
    and s.category_id is not null
    and can_see_budget(s.category_id)
  group by s.category_id, s.responsible_user_id, t.occurred_on
$$;

grant execute on function public.account_balances() to authenticated;
grant execute on function public.account_labels() to authenticated;
grant execute on function public.category_daily_spending(date, date) to authenticated;

