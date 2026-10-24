-- Copiar todo → Supabase → finanzas-pareja → SQL Editor → Run. Se puede correr más de una vez.
-- 1) Deduplicación mejorada  2) Unir con lo registrado a mano  3) Limpiar el pago de Davivienda que quedó doble

create or replace function public.ingest_event(p_token text, p_event jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_tok ingest_tokens;
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
begin
  if p_token is null or length(p_token) < 20 then raise exception 'Token no válido'; end if;
  select * into v_tok from ingest_tokens where token_hash = encode(digest(p_token, 'sha256'), 'hex');
  if not found then raise exception 'Token no válido'; end if;
  v_uid := v_tok.user_id;
  v_hh := v_tok.household_id;
  update ingest_tokens set last_used_at = now() where id = v_tok.id;

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

grant execute on function public.ingest_event(text, jsonb) to anon, authenticated;

-- 0010 · Unir un movimiento que llegó automáticamente con el que la persona ya había registrado a mano.
-- Se conserva el registrado a mano (con su categoría y responsable) y se actualiza con el monto y la fecha reales.

create or replace function public.merge_pending_into(p_pending uuid, p_target uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_p transactions;
  v_t transactions;
  v_split_id uuid;
  v_n int;
begin
  select * into v_p from transactions
   where id = p_pending and payer_user_id = v_uid and status = 'PENDING_REVIEW' and household_id = my_household_id();
  if not found then raise exception 'Ese movimiento pendiente no existe'; end if;
  select * into v_t from transactions
   where id = p_target and created_by = v_uid and household_id = v_p.household_id and kind = v_p.kind and id <> v_p.id;
  if not found then raise exception 'El movimiento registrado a mano no existe'; end if;

  if v_t.kind = 'EXPENSE' then
    select count(*) into v_n from transaction_splits where transaction_id = v_t.id;
    if v_n <> 1 then raise exception 'El movimiento registrado a mano está dividido en partes; corrígelo editándolo.'; end if;
    update transaction_splits set amount = v_p.amount where transaction_id = v_t.id returning id into v_split_id;
    update cross_ledger set amount = v_p.amount where split_id = v_split_id;
  end if;

  update transactions
     set amount = v_p.amount,
         occurred_on = v_p.occurred_on,
         occurred_at = coalesce(v_p.occurred_at, occurred_at),
         account_id = coalesce(v_p.account_id, account_id),
         merchant = coalesce(merchant, v_p.merchant),
         merchant_norm = coalesce(merchant_norm, v_p.merchant_norm),
         card_last4 = coalesce(card_last4, v_p.card_last4),
         movement_type = coalesce(movement_type, v_p.movement_type),
         tags = array(select distinct unnest(tags || v_p.tags)),
         ingest_identifiers = ingest_identifiers || v_p.ingest_identifiers
   where id = v_t.id;

  update ingest_logs set transaction_id = v_t.id where transaction_id = v_p.id;
  delete from transactions where id = v_p.id;

  -- La próxima vez este comercio se sugiere con la misma categoría
  perform remember_merchant(v_t.id, false);
end;
$$;

revoke all on function public.merge_pending_into(uuid, uuid) from public, anon;
grant execute on function public.merge_pending_into(uuid, uuid) to authenticated;

-- Limpieza: el pago de $1.043.000 a Davivienda entró dos veces (aviso de Bancolombia y correo de Davivienda)
update ingest_logs set transaction_id = 'f558d6c2-ae31-40dd-bfbd-f02bdd0005f0'
 where transaction_id = 'e62c99d9-7f4b-4ef8-9f9d-8b139305eda8';
delete from transactions where id = 'e62c99d9-7f4b-4ef8-9f9d-8b139305eda8' and status = 'PENDING_REVIEW';
