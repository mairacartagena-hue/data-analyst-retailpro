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

-- ---------------------------------------------------------------
-- Hogar
-- ---------------------------------------------------------------
create or replace function public.gen_invite_code()
returns text
language plpgsql volatile
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.households where invite_code = code);
  end loop;
  return code;
end;
$$;

create or replace function public.create_household(p_household_name text, p_display_name text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hh uuid;
begin
  if v_uid is null then raise exception 'Necesitas iniciar sesión'; end if;
  if exists (select 1 from household_members where user_id = v_uid) then
    raise exception 'Ya perteneces a un hogar';
  end if;

  insert into households (name, invite_code)
  values (coalesce(nullif(trim(p_household_name), ''), 'Nuestro hogar'), gen_invite_code())
  returning id into v_hh;

  insert into household_members (household_id, user_id, slot, display_name, color)
  values (v_hh, v_uid, 'A', coalesce(nullif(trim(p_display_name), ''), 'Persona 1'), '#6b7a3a');

  insert into period_settings (household_id) values (v_hh);
  return v_hh;
end;
$$;

create or replace function public.join_household(p_code text, p_display_name text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hh uuid;
begin
  if v_uid is null then raise exception 'Necesitas iniciar sesión'; end if;
  if exists (select 1 from household_members where user_id = v_uid) then
    raise exception 'Ya perteneces a un hogar';
  end if;

  select id into v_hh from households where invite_code = upper(trim(p_code)) for update;
  if v_hh is null then raise exception 'Ese código no existe. Pídele a tu pareja el código de nuevo.'; end if;
  if (select count(*) from household_members where household_id = v_hh) >= 2 then
    raise exception 'Ese hogar ya tiene dos miembros';
  end if;

  insert into household_members (household_id, user_id, slot, display_name, color)
  values (v_hh, v_uid,
          case when exists (select 1 from household_members where household_id = v_hh and slot = 'A') then 'B' else 'A' end,
          coalesce(nullif(trim(p_display_name), ''), 'Persona 2'), '#a0703f');
  return v_hh;
end;
$$;

create or replace function public.regenerate_invite_code()
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_hh uuid := my_household_id();
  v_code text := gen_invite_code();
begin
  if v_hh is null then raise exception 'No perteneces a un hogar'; end if;
  update households set invite_code = v_code where id = v_hh;
  return v_code;
end;
$$;

create or replace function public.update_my_profile(p_display_name text, p_color text, p_avatar text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update household_members
     set display_name = trim(p_display_name),
         color = p_color,
         avatar = nullif(trim(coalesce(p_avatar, '')), '')
   where user_id = auth.uid();
  if not found then raise exception 'No perteneces a un hogar'; end if;
end;
$$;

-- ---------------------------------------------------------------
-- Categorías y presupuesto
-- p = { id?, name, icon, responsibility, is_household_obligation, is_shared_progress,
--       rollover_enabled, budget: { valid_from, amount, fixed_amount_a, fixed_amount_b } }
-- ---------------------------------------------------------------
create or replace function public.save_category(p jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hh uuid := my_household_id();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_resp text := p->>'responsibility';
  v_owner uuid;
  v_obligation boolean := coalesce((p->>'is_household_obligation')::boolean, false);
  v_shared boolean := coalesce((p->>'is_shared_progress')::boolean, false);
  v_budget jsonb := p->'budget';
  v_a bigint;
  v_b bigint;
  v_amount bigint;
begin
  if v_hh is null then raise exception 'No perteneces a un hogar'; end if;
  if v_resp not in ('MEMBER_A_100', 'MEMBER_B_100', 'FIXED_AMOUNTS', 'PRIVATE') then
    raise exception 'Tipo de responsabilidad no válido';
  end if;

  if v_id is not null and not can_see_category(v_id) then
    raise exception 'Esa categoría no existe';
  end if;

  -- Quien no ve el progreso de una categoría no puede volverla compartida,
  -- reasignarla ni cambiarle el presupuesto (así no se salta la privacidad).
  if v_id is not null and not can_see_budget(v_id) then
    select responsibility, is_shared_progress into v_resp, v_shared from categories where id = v_id;
    v_budget := null;
  end if;

  if v_resp = 'PRIVATE' then
    v_owner := v_uid;
    v_obligation := false;
    v_shared := false;
    if v_id is not null and exists (
      select 1 from categories where id = v_id and responsibility = 'PRIVATE' and owner_user_id <> v_uid
    ) then
      raise exception 'Solo su dueño puede editar una categoría privada';
    end if;
  end if;

  if v_id is null then
    insert into categories (household_id, name, icon, responsibility, owner_user_id,
                            is_household_obligation, is_shared_progress, rollover_enabled)
    values (v_hh, trim(p->>'name'), nullif(p->>'icon', ''), v_resp, v_owner,
            v_obligation, v_shared, coalesce((p->>'rollover_enabled')::boolean, false))
    returning id into v_id;
  else
    update categories
       set name = trim(p->>'name'),
           icon = nullif(p->>'icon', ''),
           responsibility = v_resp,
           owner_user_id = v_owner,
           is_household_obligation = v_obligation,
           is_shared_progress = v_shared,
           rollover_enabled = coalesce((p->>'rollover_enabled')::boolean, false)
     where id = v_id and household_id = v_hh;
  end if;

  if v_budget is not null then
    if v_resp = 'FIXED_AMOUNTS' then
      v_a := coalesce((v_budget->>'fixed_amount_a')::bigint, 0);
      v_b := coalesce((v_budget->>'fixed_amount_b')::bigint, 0);
      v_amount := v_a + v_b;
    else
      v_a := null;
      v_b := null;
      v_amount := coalesce((v_budget->>'amount')::bigint, 0);
    end if;
    insert into category_budgets (category_id, household_id, valid_from, amount, fixed_amount_a, fixed_amount_b)
    values (v_id, v_hh, (v_budget->>'valid_from')::date, v_amount, v_a, v_b)
    on conflict (category_id, valid_from)
    do update set amount = excluded.amount,
                  fixed_amount_a = excluded.fixed_amount_a,
                  fixed_amount_b = excluded.fixed_amount_b;
  end if;

  return v_id;
end;
$$;

create or replace function public.archive_category(p_id uuid, p_archived boolean default true)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not can_see_category(p_id) then raise exception 'Esa categoría no existe'; end if;
  update categories set archived = p_archived where id = p_id;
end;
$$;

-- ---------------------------------------------------------------
-- Transacciones + motor de cruce
-- p = { id?, kind, amount, occurred_on, description, merchant, account_id, to_account_id,
--       counterparty_user_id, is_shared, tags: [], splits: [{ amount, category_id, responsible_user_id, origin, note }] }
-- Quien registra es quien pagó (payer_user_id = auth.uid()).
-- ---------------------------------------------------------------
create or replace function public.save_transaction(p jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hh uuid := my_household_id();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_kind text := p->>'kind';
  v_amount bigint := (p->>'amount')::bigint;
  v_account uuid := nullif(p->>'account_id', '')::uuid;
  v_to uuid := nullif(p->>'to_account_id', '')::uuid;
  v_counter uuid := nullif(p->>'counterparty_user_id', '')::uuid;
  v_date date := coalesce(nullif(p->>'occurred_on', '')::date, today_bogota());
  v_desc text := nullif(trim(coalesce(p->>'description', '')), '');
  v_tags text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'tags', '[]'::jsonb))), '{}');
  v_old transactions;
  v_split jsonb;
  v_splits jsonb := coalesce(p->'splits', '[]'::jsonb);
  v_n int;
  v_sum bigint := 0;
  v_cat categories;
  v_cat_id uuid;
  v_resp uuid;
  v_origin text;
  v_split_id uuid;
begin
  if v_uid is null then raise exception 'Necesitas iniciar sesión'; end if;
  if v_hh is null then raise exception 'Primero crea o únete a un hogar'; end if;
  if v_kind not in ('EXPENSE', 'INCOME', 'TRANSFER', 'SETTLEMENT') then raise exception 'Tipo de movimiento no válido'; end if;
  if v_amount is null or v_amount <= 0 then raise exception 'El monto debe ser mayor que cero'; end if;

  if v_id is not null then
    select * into v_old from transactions where id = v_id and household_id = v_hh for update;
    if not found then raise exception 'Ese movimiento no existe'; end if;
    if v_old.created_by <> v_uid then raise exception 'Solo quien registró el movimiento puede editarlo'; end if;
    if v_old.kind <> v_kind then raise exception 'No se puede cambiar el tipo de un movimiento'; end if;
  end if;

  if v_account is not null and not exists (
    select 1 from accounts where id = v_account and owner_user_id = v_uid and household_id = v_hh
  ) then
    raise exception 'La cuenta de origen debe ser tuya';
  end if;

  if v_kind in ('EXPENSE', 'INCOME') and v_account is null then
    raise exception 'Elige la cuenta';
  end if;

  if v_kind = 'TRANSFER' then
    if v_account is null or v_to is null or v_account = v_to then
      raise exception 'Elige dos cuentas distintas';
    end if;
    if not exists (select 1 from accounts where id = v_to and owner_user_id = v_uid and household_id = v_hh) then
      raise exception 'Las transferencias son entre tus propias cuentas. Para pagarle a tu pareja usa Liquidar.';
    end if;
  end if;

  if v_kind = 'SETTLEMENT' then
    if v_counter is null or v_counter = v_uid
       or not exists (select 1 from household_members where user_id = v_counter and household_id = v_hh) then
      raise exception 'La liquidación es con tu pareja';
    end if;
    if v_to is not null and not exists (
      select 1 from accounts where id = v_to and owner_user_id = v_counter and household_id = v_hh
    ) then
      raise exception 'La cuenta de destino debe ser de tu pareja';
    end if;
  else
    v_counter := null;
  end if;

  if v_kind <> 'TRANSFER' and v_kind <> 'SETTLEMENT' then
    v_to := null;
  end if;

  if v_kind = 'EXPENSE' then
    v_n := jsonb_array_length(v_splits);
    if v_n = 0 then raise exception 'El gasto necesita al menos una categoría o responsable'; end if;
    select coalesce(sum((s->>'amount')::bigint), 0) into v_sum from jsonb_array_elements(v_splits) s;
    if v_sum <> v_amount then
      raise exception 'La suma del desglose (%) debe ser igual al total (%)', v_sum, v_amount;
    end if;
  end if;

  if v_id is null then
    insert into transactions (household_id, kind, status, occurred_on, amount, description, merchant,
                              account_id, to_account_id, payer_user_id, counterparty_user_id,
                              is_shared, source, tags, created_by)
    values (v_hh, v_kind, 'CONFIRMED', v_date, v_amount, v_desc, nullif(trim(coalesce(p->>'merchant', '')), ''),
            v_account, v_to, v_uid, v_counter,
            v_kind = 'INCOME' and coalesce((p->>'is_shared')::boolean, false), 'MANUAL', v_tags, v_uid)
    returning id into v_id;
  else
    update transactions
       set status = 'CONFIRMED',
           occurred_on = v_date,
           amount = v_amount,
           description = v_desc,
           merchant = nullif(trim(coalesce(p->>'merchant', '')), ''),
           account_id = v_account,
           to_account_id = v_to,
           counterparty_user_id = v_counter,
           is_shared = v_kind = 'INCOME' and coalesce((p->>'is_shared')::boolean, false),
           tags = v_tags
     where id = v_id;
    delete from cross_ledger where transaction_id = v_id;
    delete from transaction_splits where transaction_id = v_id;
  end if;

  if v_kind = 'EXPENSE' then
    for v_split in select * from jsonb_array_elements(v_splits)
    loop
      v_cat_id := nullif(v_split->>'category_id', '')::uuid;
      v_resp := nullif(v_split->>'responsible_user_id', '')::uuid;
      v_origin := coalesce(nullif(v_split->>'origin', ''), 'NORMAL');

      if (v_split->>'amount')::bigint <= 0 then raise exception 'Cada parte del desglose debe ser mayor que cero'; end if;

      if v_cat_id is not null then
        select * into v_cat from categories where id = v_cat_id and household_id = v_hh;
        if not found or not can_see_category(v_cat_id) then raise exception 'Categoría no válida'; end if;
        if v_resp is null then v_resp := category_responsible(v_cat_id); end if;
        if v_cat.responsibility = 'PRIVATE' and v_resp <> v_cat.owner_user_id then
          raise exception 'Una categoría privada solo puede quedar a cargo de su dueño';
        end if;
      end if;

      if v_resp is null then v_resp := v_uid; end if;
      if not exists (select 1 from household_members where user_id = v_resp and household_id = v_hh) then
        raise exception 'El responsable debe ser miembro del hogar';
      end if;
      if v_origin = 'FIXED_EXCESS' and v_resp = v_uid then v_origin := 'NORMAL'; end if;

      insert into transaction_splits (transaction_id, household_id, amount, category_id, responsible_user_id, origin, note)
      values (v_id, v_hh, (v_split->>'amount')::bigint, v_cat_id, v_resp, v_origin,
              nullif(trim(coalesce(v_split->>'note', '')), ''))
      returning id into v_split_id;

      -- Caso 2 y 3: pagó uno y le correspondía al otro → asiento a favor del pagador
      if v_resp <> v_uid then
        insert into cross_ledger (household_id, creditor_user_id, debtor_user_id, amount, kind,
                                  transaction_id, split_id, description, occurred_on, created_by)
        values (v_hh, v_uid, v_resp, (v_split->>'amount')::bigint,
                case when v_origin = 'FIXED_EXCESS' then 'FIXED_EXCESS'
                     when v_n = 1 then 'CROSS_PAYMENT'
                     else 'SPLIT' end,
                v_id, v_split_id, coalesce(v_desc, nullif(trim(coalesce(p->>'merchant', '')), '')),
                v_date, v_uid);
      end if;
    end loop;
  end if;

  if v_kind = 'SETTLEMENT' then
    insert into cross_ledger (household_id, creditor_user_id, debtor_user_id, amount, kind,
                              transaction_id, description, occurred_on, created_by)
    values (v_hh, v_uid, v_counter, v_amount, 'SETTLEMENT', v_id, coalesce(v_desc, 'Liquidación'), v_date, v_uid);
  end if;

  return v_id;
end;
$$;

create or replace function public.delete_transaction(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from transactions
   where id = p_id and household_id = my_household_id() and created_by = auth.uid();
  if not found then raise exception 'Solo quien registró el movimiento puede borrarlo'; end if;
end;
$$;

-- El responsable de un desglose puede ponerle su propia categoría
-- (ej. tu pareja registró "35.000 tuyos" sin categoría).
create or replace function public.set_split_category(p_split_id uuid, p_category_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_split transaction_splits;
  v_cat categories;
begin
  select * into v_split from transaction_splits where id = p_split_id and household_id = my_household_id();
  if not found then raise exception 'Ese desglose no existe'; end if;
  if v_split.responsible_user_id <> auth.uid() then
    raise exception 'Solo el responsable puede cambiar la categoría de su parte';
  end if;
  if p_category_id is not null then
    select * into v_cat from categories where id = p_category_id;
    if not found or not can_see_category(p_category_id) then raise exception 'Categoría no válida'; end if;
    if v_cat.responsibility = 'PRIVATE' and v_cat.owner_user_id <> auth.uid() then
      raise exception 'Categoría no válida';
    end if;
  end if;
  update transaction_splits set category_id = p_category_id where id = p_split_id;
end;
$$;

-- Préstamos directos y encargos entre los dos.
create or replace function public.add_ledger_entry(
  p_kind text, p_creditor uuid, p_debtor uuid, p_amount bigint, p_description text, p_occurred_on date
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_hh uuid := my_household_id();
  v_id uuid;
begin
  if v_hh is null then raise exception 'No perteneces a un hogar'; end if;
  if p_kind not in ('LOAN', 'ERRAND') then raise exception 'Tipo no válido'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'El monto debe ser mayor que cero'; end if;
  if auth.uid() not in (p_creditor, p_debtor) then raise exception 'Debes ser una de las dos partes'; end if;
  if p_creditor = p_debtor
     or (select count(*) from household_members where household_id = v_hh and user_id in (p_creditor, p_debtor)) <> 2 then
    raise exception 'El asiento es entre los dos miembros del hogar';
  end if;
  insert into cross_ledger (household_id, creditor_user_id, debtor_user_id, amount, kind, description, occurred_on, created_by)
  values (v_hh, p_creditor, p_debtor, p_amount, p_kind, nullif(trim(coalesce(p_description, '')), ''),
          coalesce(p_occurred_on, today_bogota()), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.delete_ledger_entry(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from cross_ledger
   where id = p_id and household_id = my_household_id() and created_by = auth.uid()
     and kind in ('LOAN', 'ERRAND');
  if not found then
    raise exception 'Solo puedes borrar préstamos o encargos que registraste tú. Los demás se corrigen editando el movimiento.';
  end if;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'gen_invite_code()', 'create_household(text, text)', 'join_household(text, text)', 'regenerate_invite_code()',
    'update_my_profile(text, text, text)', 'save_category(jsonb)', 'archive_category(uuid, boolean)',
    'save_transaction(jsonb)', 'delete_transaction(uuid)', 'set_split_category(uuid, uuid)',
    'add_ledger_entry(text, uuid, uuid, bigint, text, date)', 'delete_ledger_entry(uuid)',
    'account_balances()', 'account_labels()', 'category_daily_spending(date, date)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
