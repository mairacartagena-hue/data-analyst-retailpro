-- 0048 · El primer barrido del celular no duplica lo que ya estaba
-- Dos casos que el barrido traía repetidos:
--  · Un SMS o notificación que MacroDroid ya había capturado en su momento: esos llegaron sin identificador,
--    así que se reconoce por el mismo texto en fechas cercanas y se descarta (aunque no se hubiera reconocido).
--  · Un aviso pegado a mano solo trae el día (no la hora): se compara como los correos sin fecha
--    (mismo monto y comercio parecido, ±1 día), así se une con lo registrado a mano o por otro canal.
-- _ingest_core() queda igual a 0025 salvo esa condición. Se puede correr más de una vez.

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
  v_dated boolean;
begin
  v_uid := p_uid;
  v_hh := p_hh;
  -- Gemini a veces agrega letras de otros alfabetos al nombre: solo se conservan las latinas, números y signos comunes
  v_merchant := nullif(trim(regexp_replace(coalesce(v_merchant, ''), '[^\u0020-\u024F\u00B7\u2013\u2014\u2019]', '', 'g')), '');
  v_norm := nullif(trim(regexp_replace(coalesce(v_norm, ''), '[^\u0020-\u024F\u00B7\u2013\u2014\u2019]', '', 'g')), '');
  v_merchant := left(v_merchant, 60);
  v_norm := left(v_norm, 80);

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
  -- ¿El aviso trae la fecha del movimiento? (los correos de AvalPay no la traen: se usa la hora en que se leyó)
  v_dated := nullif(v_parsed->>'occurred_at', '') is not null;

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

  -- Un aviso sin fecha no puede compararse por minutos: se busca el mismo monto y comercio en los últimos días
  -- (correos sin fecha y avisos pegados a mano en el primer barrido, que solo traen el día)
  if not found and not v_dated
     and (upper(coalesce(p_event->>'channel', '')) = 'GMAIL' or coalesce(p_event->>'undated', '') = 'true') then
    select t.* into v_existing from transactions t
     where t.id = ingest_find_undated_duplicate(v_hh, v_uid, v_amount, v_outflow, v_at, v_norm, v_account);
  end if;

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

  -- Memoria de comercios: identificador más específico primero.
  -- Los gastos usan la memoria normal; un ingreso solo usa reglas de reembolso (ej. lo que me devuelven por un gasto).
  if v_txkind in ('EXPENSE', 'INCOME') then
    select m.* into v_mem
      from merchant_memory m
     where m.user_id = v_uid
       and ((v_txkind = 'EXPENSE' and m.movement_kind is null) or (v_txkind = 'INCOME' and m.movement_kind = 'REFUND'))
       and ((m.identifier_type = 'MERCHANT' and v_norm is not null and m.identifier = v_norm)
            or (m.identifier_type = 'KEYWORD' and lower(coalesce(p_event->>'raw_text', '')) like '%' || m.identifier || '%')
            or exists (select 1 from jsonb_array_elements(v_idents) i
                        where upper(i->>'type') = m.identifier_type and lower(i->>'value') = m.identifier))
     order by (m.identifier_type in ('NIT', 'ACCOUNT', 'PHONE')) desc, m.hits desc
     limit 1;

    if found and m_valid_category(v_mem.category_id, v_hh, v_uid) then
      update merchant_memory set hits = hits + 1, last_used_at = now() where id = v_mem.id;
      -- El nombre que la persona le puso al comercio, llave o cuenta
      if v_mem.label is not null then v_merchant := left(v_mem.label, 60); end if;
      if v_mem.tag is not null then v_tags := v_tags || v_mem.tag; end if;
      if v_mem.auto_apply and v_account is not null then
        v_split_cat := v_mem.category_id;
        v_split_resp := coalesce(v_mem.responsible_user_id, v_uid);
        v_status := 'CONFIRMED';
        -- Ingreso con regla de reembolso: entra como reembolso de esa categoría (resta del gasto)
        if v_txkind = 'INCOME' then v_txkind := 'REFUND'; end if;
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
                            movement_type, card_last4, ingest_identifiers, scope, creates_debt,
                            suggested_category_id, suggested_responsible_user_id, suggested_to_account_id)
  values (v_hh, v_txkind, v_status, (v_at at time zone 'America/Bogota')::date, v_at, v_amount,
          coalesce(v_merchant, case v_kind when 'WITHDRAWAL' then 'Retiro' when 'CARD_PAYMENT' then 'Pago de tarjeta' else null end),
          v_merchant, v_norm, v_account, v_to, v_uid, false,
          coalesce(nullif(p_event->>'channel', ''), 'INGEST'),
          md5(v_uid::text || v_amount::text || to_char(v_at, 'YYYYMMDDHH24MI') || coalesce(v_norm, '')),
          array(select distinct unnest(v_tags)), v_uid, v_kind, v_last4, v_idents,
          case when v_split_cat is not null then coalesce(v_mem.scope, 'PERSONAL') else 'PERSONAL' end,
          case when v_split_cat is not null then coalesce(v_mem.creates_debt, true) else true end,
          v_mem.category_id, v_mem.responsible_user_id,
          case when v_kind = 'CARD_PAYMENT' and v_account_kind = 'CREDIT_CARD' then v_account else null end)
  returning id into v_tx;

  if v_txkind in ('EXPENSE', 'REFUND') then
    insert into transaction_splits (transaction_id, household_id, amount, category_id, responsible_user_id)
    values (v_tx, v_hh, v_amount, v_split_cat, coalesce(v_split_resp, v_uid))
    returning id into v_split_id;
    if v_txkind = 'EXPENSE' and coalesce(v_split_resp, v_uid) <> v_uid and v_split_cat is not null and coalesce(v_mem.creates_debt, true) then
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

-- Texto comparable: minúsculas y espacios simples
create or replace function public.ingest_text_key(p text)
returns text
language sql immutable set search_path = public
as $$ select nullif(lower(trim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g'))), '') $$;
revoke all on function public.ingest_text_key(text) from public, anon, authenticated;

create or replace function public.ingest_import_event(p_event jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_hh uuid := public.my_household_id();
  v_ext text := nullif(p_event->>'external_id', '');
  v_at timestamptz := nullif(p_event->>'received_at', '')::timestamptz;
  v_key text := ingest_text_key(p_event->>'raw_text');
  v_pasted boolean;
  v_event jsonb := p_event;
begin
  if v_uid is null or v_hh is null then raise exception 'No perteneces a un hogar'; end if;
  if coalesce(p_event->>'channel', '') not in ('ANDROID_SMS', 'ANDROID_NOTIFICATION') then
    raise exception 'Solo se pueden subir SMS o notificaciones';
  end if;
  if v_ext is null then raise exception 'Falta el identificador del aviso'; end if;
  v_pasted := v_ext like 'pegado:%';

  -- Ya llegó en su momento por MacroDroid (o se pegó antes): el mismo texto, en el mismo canal y fechas cercanas.
  -- Un SMS de la copia trae su hora exacta; MacroDroid pudo enviarlo un rato después (sin señal).
  -- Un aviso pegado solo trae el día.
  if v_key is not null and length(v_key) >= 15 and v_at is not null and exists (
    select 1 from ingest_logs l
     where l.user_id = v_uid
       and l.channel = p_event->>'channel'
       and l.raw_text is not null
       -- Entre avisos subidos del mismo modo ya decide el identificador (dos compras iguales en días seguidos son dos)
       and (l.external_id is null or split_part(l.external_id, ':', 1) <> split_part(v_ext, ':', 1))
       and (strpos(ingest_text_key(l.raw_text), v_key) > 0 or strpos(v_key, ingest_text_key(l.raw_text)) > 0)
       and (case when v_pasted
                 then abs((coalesce(l.event_at, l.received_at) at time zone 'America/Bogota')::date - (v_at at time zone 'America/Bogota')::date) <= 1
                 else coalesce(l.event_at, l.received_at) between v_at - interval '10 minutes' and v_at + interval '1 day' end)
  ) then
    return jsonb_build_object('result', 'DUPLICATE');
  end if;

  if v_pasted then v_event := v_event || jsonb_build_object('undated', true); end if;
  return _ingest_core(v_uid, v_hh, v_event);
end;
$$;
revoke all on function public.ingest_import_event(jsonb) from public, anon;
grant execute on function public.ingest_import_event(jsonb) to authenticated;
