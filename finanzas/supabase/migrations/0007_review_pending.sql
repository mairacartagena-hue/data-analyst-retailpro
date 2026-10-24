-- 0007 · Revisión de pendientes: save_transaction permite cambiar el tipo de un movimiento
-- que llegó automáticamente y sigue pendiente (ej. un pago de tarjeta que entró como gasto).

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
    -- Un pendiente que llegó automáticamente puede cambiar de tipo al revisarlo (ej. pago de tarjeta)
    if v_old.kind <> v_kind and (v_old.status <> 'PENDING_REVIEW' or v_kind = 'SETTLEMENT') then
      raise exception 'No se puede cambiar el tipo de un movimiento';
    end if;
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
       set kind = v_kind,
           status = 'CONFIRMED',
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
