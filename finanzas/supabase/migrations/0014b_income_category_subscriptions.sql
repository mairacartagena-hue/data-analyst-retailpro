-- 0014b · save_transaction con categoría de ingreso; _ingest_core detecta suscripciones.
-- Categorías de ingresos en save_transaction y detección automática de suscripciones al recibir avisos.

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
  v_inc_cat uuid := nullif(p->>'income_category_id', '')::uuid;
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

  -- Categoría de un ingreso (solo ingresos; personal o compartida que la persona pueda ver)
  if v_kind <> 'INCOME' then v_inc_cat := null; end if;
  if v_inc_cat is not null and not exists (
    select 1 from categories where id = v_inc_cat and household_id = v_hh and kind = 'INCOME'
      and (responsibility <> 'PRIVATE' or owner_user_id = v_uid)
  ) then
    raise exception 'Categoría de ingreso no válida';
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
                              is_shared, source, tags, created_by, income_category_id)
    values (v_hh, v_kind, 'CONFIRMED', v_date, v_amount, v_desc, nullif(trim(coalesce(p->>'merchant', '')), ''),
            v_account, v_to, v_uid, v_counter,
            v_kind = 'INCOME' and coalesce((p->>'is_shared')::boolean, false), 'MANUAL', v_tags, v_uid, v_inc_cat)
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
           tags = v_tags,
           income_category_id = v_inc_cat
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

create or replace function public._ingest_core(p_uid uuid, p_hh uuid, p_event jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_uid uuid;
  v_hh uuid;
  v_parsed jsonb := p_event->'parsed';
  v_kind text := upper(coalesce(p_event->'parsed'->>'kind', ''));
  v_amount bigint;
  v_merchant text := nullif(trim(coalesce(p_event->'parsed'->>'merchant', '')), '');
  v_norm text := nullif(lower(trim(coalesce(p_event->'parsed'->>'merchant_norm', ''))), '');
  v_last4 text := nullif(p_event->'parsed'->>'last4', '');
  v_inst text := nullif(trim(coalesce(p_event->'parsed'->>'institution', '')), '');
  v_at timestamptz;
  v_ext text := nullif(p_event->>'external_id', '');
  v_idents jsonb := coalesce(p_event->'parsed'->'identifiers', '[]'::jsonb);
  v_outflow boolean;
  v_account uuid;
  v_account_kind text;
  v_cash uuid;
  v_existing transactions;
  v_mem merchant_memory;
  v_cat categories;
  v_tx uuid;
  v_txkind text;
  v_to uuid;
  v_status text := 'PENDING_REVIEW';
  v_tags text[] := '{}';
  v_split_cat uuid;
  v_split_resp uuid;
  v_split_id uuid;
  v_n int;
  v_prev uuid;
begin
  v_uid := p_uid;
  v_hh := p_hh;

  -- El texto crudo se guarda máximo 30 días
  update ingest_logs set raw_text = null
   where user_id = v_uid and raw_text is not null and received_at < now() - interval '30 days';

  -- El mismo correo o notificación enviado dos veces
  if v_ext is not null and exists (select 1 from ingest_logs where user_id = v_uid and external_id = v_ext) then
    return jsonb_build_object('result', 'DUPLICATE');
  end if;

  if v_parsed is null or v_kind = '' then
    perform _ingest_log(v_hh, v_uid, p_event, 'UNRECOGNIZED', coalesce(p_event->>'reason', 'No se reconoció el formato'), null);
    return jsonb_build_object('result', 'UNRECOGNIZED');
  end if;

  if v_kind = 'IGNORE' then
    perform _ingest_log(v_hh, v_uid, p_event, 'IGNORED', coalesce(v_parsed->>'ignore_reason', 'Mensaje sin movimiento'), null);
    return jsonb_build_object('result', 'IGNORED');
  end if;

  if v_kind not in ('PURCHASE', 'TRANSFER_OUT', 'TRANSFER_IN', 'WITHDRAWAL', 'CARD_PAYMENT', 'INCOME') then
    perform _ingest_log(v_hh, v_uid, p_event, 'ERROR', 'Tipo de movimiento desconocido: ' || v_kind, null);
    return jsonb_build_object('result', 'ERROR');
  end if;

  v_amount := nullif(v_parsed->>'amount', '')::bigint;
  if v_amount is null or v_amount <= 0 then
    perform _ingest_log(v_hh, v_uid, p_event, 'DISCARDED', 'Sin monto', null);
    return jsonb_build_object('result', 'DISCARDED');
  end if;

  v_at := coalesce(nullif(v_parsed->>'occurred_at', '')::timestamptz, nullif(p_event->>'received_at', '')::timestamptz, now());
  v_outflow := v_kind in ('PURCHASE', 'TRANSFER_OUT', 'WITHDRAWAL', 'CARD_PAYMENT');

  -- Cuenta o tarjeta: por últimos 4 dígitos; si no, por entidad cuando hay una sola cuenta de esa entidad
  if v_last4 is not null then
    select id, kind into v_account, v_account_kind from accounts
     where owner_user_id = v_uid and household_id = v_hh and not archived
       and (last4 = v_last4 or v_last4 = any (alias_last4))
     order by (last4 = v_last4) desc, (kind = 'CREDIT_CARD') desc, created_at limit 1;
  end if;
  if v_account is null and v_inst is not null then
    select count(*) into v_n from accounts
     where owner_user_id = v_uid and household_id = v_hh and not archived
       and (institution ilike v_inst or name ilike '%' || v_inst || '%');
    if v_n = 1 then
      select id, kind into v_account, v_account_kind from accounts
       where owner_user_id = v_uid and household_id = v_hh and not archived
         and (institution ilike v_inst or name ilike '%' || v_inst || '%');
    end if;
  end if;

  -- Etiquetas automáticas
  if v_inst is not null then
    v_tags := v_tags || ('#' || lower(regexp_replace(v_inst, '[^[:alnum:]]+', '', 'g')));
  end if;
  if v_last4 is not null and (v_account_kind = 'CREDIT_CARD' or v_kind = 'CARD_PAYMENT') then
    v_tags := v_tags || ('#tc_' || v_last4);
  end if;
  -- Etiquetas que trae el parser (ej. #suscripcion para comercios de suscripción conocidos)
  v_tags := v_tags || coalesce(array(select lower(jsonb_array_elements_text(coalesce(p_event->'parsed'->'tags', '[]'::jsonb)))), '{}');

  -- 1) Deduplicación: mismo usuario, monto exacto, ±5 minutos, comercio parecido y cuenta compatible
  select t.* into v_existing from transactions t
   where t.id = ingest_find_duplicate(v_hh, v_uid, v_amount, v_outflow, v_at, v_norm, v_account);

  if found then
    update transactions
       set merchant = coalesce(merchant, v_merchant),
           merchant_norm = coalesce(merchant_norm, v_norm),
           description = coalesce(description, v_merchant),
           account_id = coalesce(account_id, v_account),
           card_last4 = coalesce(card_last4, v_last4),
           occurred_at = coalesce(occurred_at, v_at),
           tags = array(select distinct unnest(tags || v_tags)),
           ingest_identifiers = ingest_identifiers || v_idents
     where id = v_existing.id;
    perform _ingest_log(v_hh, v_uid, p_event, 'MERGED', 'Ya estaba registrado; se completó con este aviso', v_existing.id);
    return jsonb_build_object('result', 'MERGED', 'transaction_id', v_existing.id);
  end if;

  -- 2) Transferencia entre cuentas propias: unir la salida y la entrada en un solo movimiento
  -- (una salida TRANSFER_OUT con una entrada TRANSFER_IN o INCOME, en cuentas distintas, ±10 minutos)
  if v_account is not null and v_kind in ('TRANSFER_IN', 'TRANSFER_OUT', 'INCOME') then
    select t.* into v_existing
      from transactions t
     where t.household_id = v_hh and t.payer_user_id = v_uid and t.amount = v_amount
       and t.status = 'PENDING_REVIEW' and t.source <> 'MANUAL'
       and t.account_id is not null and t.account_id <> v_account
       and abs(extract(epoch from (coalesce(t.occurred_at, t.created_at) - v_at))) <= 600
       and (case when v_outflow then t.kind = 'INCOME' and t.movement_type in ('TRANSFER_IN', 'INCOME')
                 else t.kind = 'EXPENSE' and t.movement_type = 'TRANSFER_OUT' end)
     order by abs(extract(epoch from (coalesce(t.occurred_at, t.created_at) - v_at)))
     limit 1;
    if found and (v_kind in ('TRANSFER_IN', 'TRANSFER_OUT') or v_existing.movement_type in ('TRANSFER_IN', 'TRANSFER_OUT')) then
      delete from cross_ledger where transaction_id = v_existing.id;
      delete from transaction_splits where transaction_id = v_existing.id;
      update transactions
         set kind = 'TRANSFER',
             status = 'CONFIRMED',
             movement_type = 'OWN_TRANSFER',
             account_id = case when v_outflow then v_account else v_existing.account_id end,
             to_account_id = case when v_outflow then v_existing.account_id else v_account end,
             description = coalesce(description, 'Transferencia entre mis cuentas'),
             tags = array(select distinct unnest(tags || v_tags))
       where id = v_existing.id;
      perform _ingest_log(v_hh, v_uid, p_event, 'MERGED', 'Transferencia entre cuentas propias', v_existing.id);
      return jsonb_build_object('result', 'MERGED', 'transaction_id', v_existing.id);
    end if;
  end if;

  -- 3) Movimiento nuevo
  v_txkind := case when v_outflow then 'EXPENSE' else 'INCOME' end;

  if v_kind = 'WITHDRAWAL' and v_account is not null then
    select id into v_cash from accounts
     where owner_user_id = v_uid and household_id = v_hh and not archived and kind = 'CASH'
     order by created_at limit 1;
    if v_cash is not null and v_cash <> v_account then
      v_txkind := 'TRANSFER';
      v_to := v_cash;
      v_status := 'CONFIRMED';
    end if;
  end if;

  -- Memoria de comercios: identificador más específico primero
  if v_txkind = 'EXPENSE' then
    select m.* into v_mem
      from merchant_memory m
     where m.user_id = v_uid
       and ((m.identifier_type = 'MERCHANT' and v_norm is not null and m.identifier = v_norm)
            or (m.identifier_type = 'KEYWORD' and lower(coalesce(p_event->>'raw_text', '')) like '%' || m.identifier || '%')
            or exists (select 1 from jsonb_array_elements(v_idents) i
                        where upper(i->>'type') = m.identifier_type and lower(i->>'value') = m.identifier))
     order by (m.identifier_type in ('NIT', 'ACCOUNT', 'PHONE')) desc, m.hits desc
     limit 1;

    if found and m_valid_category(v_mem.category_id, v_hh, v_uid) then
      update merchant_memory set hits = hits + 1, last_used_at = now() where id = v_mem.id;
      if v_mem.tag is not null then v_tags := v_tags || v_mem.tag; end if;
      if v_mem.auto_apply and v_account is not null then
        v_split_cat := v_mem.category_id;
        v_split_resp := coalesce(v_mem.responsible_user_id, v_uid);
        v_status := 'CONFIRMED';
      end if;
    else
      v_mem := null;
    end if;
  end if;

  -- Suscripción: el mismo comercio cobró un monto parecido (±15 %) hace 25 a 35 días
  if v_txkind = 'EXPENSE' and v_norm is not null and not ('#suscripcion' = any (v_tags)) then
    select t.id into v_prev from transactions t
     where t.household_id = v_hh and t.payer_user_id = v_uid and t.kind = 'EXPENSE'
       and coalesce(t.merchant_norm, t.description) is not null
       and ingest_merchant_compatible(coalesce(t.merchant_norm, lower(t.description)), v_norm)
       and t.amount between v_amount * 0.85 and v_amount * 1.15
       and tx_effective_at(t.occurred_at, t.occurred_on) between v_at - interval '35 days' and v_at - interval '25 days'
     limit 1;
    if v_prev is not null then
      v_tags := v_tags || '#suscripcion'::text;
      update transactions set tags = array(select distinct unnest(tags || array['#suscripcion'])) where id = v_prev;
    end if;
  end if;

  if v_txkind in ('EXPENSE', 'INCOME') and v_account is null then
    v_status := 'PENDING_REVIEW';
    v_split_cat := null;
    v_split_resp := null;
  end if;

  insert into transactions (household_id, kind, status, occurred_on, occurred_at, amount, description, merchant, merchant_norm,
                            account_id, to_account_id, payer_user_id, is_shared, source, dedup_hash, tags, created_by,
                            movement_type, card_last4, ingest_identifiers,
                            suggested_category_id, suggested_responsible_user_id, suggested_to_account_id)
  values (v_hh, v_txkind, v_status, (v_at at time zone 'America/Bogota')::date, v_at, v_amount,
          coalesce(v_merchant, case v_kind when 'WITHDRAWAL' then 'Retiro' when 'CARD_PAYMENT' then 'Pago de tarjeta' else null end),
          v_merchant, v_norm, v_account, v_to, v_uid, false,
          coalesce(nullif(p_event->>'channel', ''), 'INGEST'),
          md5(v_uid::text || v_amount::text || to_char(v_at, 'YYYYMMDDHH24MI') || coalesce(v_norm, '')),
          array(select distinct unnest(v_tags)), v_uid, v_kind, v_last4, v_idents,
          v_mem.category_id, v_mem.responsible_user_id,
          case when v_kind = 'CARD_PAYMENT' and v_account_kind = 'CREDIT_CARD' then v_account else null end)
  returning id into v_tx;

  if v_txkind = 'EXPENSE' then
    insert into transaction_splits (transaction_id, household_id, amount, category_id, responsible_user_id)
    values (v_tx, v_hh, v_amount, v_split_cat, coalesce(v_split_resp, v_uid))
    returning id into v_split_id;
    if coalesce(v_split_resp, v_uid) <> v_uid then
      insert into cross_ledger (household_id, creditor_user_id, debtor_user_id, amount, kind,
                                transaction_id, split_id, description, occurred_on, created_by)
      values (v_hh, v_uid, v_split_resp, v_amount, 'CROSS_PAYMENT', v_tx, v_split_id,
              v_merchant, (v_at at time zone 'America/Bogota')::date, v_uid);
    end if;
  end if;

  perform _ingest_log(v_hh, v_uid, p_event, 'ACCEPTED',
                      case when v_status = 'CONFIRMED' then 'Conciliado automáticamente' else 'En la cola de pendientes' end, v_tx);
  return jsonb_build_object('result', 'ACCEPTED', 'transaction_id', v_tx, 'status', v_status);
end;
$$;
revoke all on function public._ingest_core(uuid, uuid, jsonb) from public, anon, authenticated;
