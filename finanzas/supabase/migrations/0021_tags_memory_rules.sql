-- 0021 · Etiquetas, nombre y reglas en la memoria de comercios.
--
--  · tags / transaction_tags: etiquetas del hogar para filtrar e informar. Cualquiera de los dos las crea, renombra y borra;
--    quien ve un movimiento ve sus etiquetas (misma privacidad que el movimiento).
--  · merchant_memory.label: nombre que la persona le pone a un comercio, llave o cuenta (ej. "Heladería", "Hermano"):
--    los avisos nuevos de ese comercio llegan con ese nombre.
--  · merchant_memory.movement_kind = 'REFUND': regla para ingresos que son reembolso de una categoría
--    (ej. lo que envía Yolima cada mes para cubrir el pago de Alvaro): el ingreso entra como reembolso y resta del gasto.
--  · _ingest_core: aplica lo anterior y recorta nombres de comercio desmedidos (60 caracteres).
-- Se puede volver a correr sin problema.

-- ───────────── Memoria de comercios ─────────────
alter table public.merchant_memory add column if not exists label text;
alter table public.merchant_memory add column if not exists movement_kind text;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.merchant_memory'::regclass and conname = 'merchant_memory_movement_kind_check') then
    alter table public.merchant_memory add constraint merchant_memory_movement_kind_check check (movement_kind is null or movement_kind = 'REFUND');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.merchant_memory'::regclass and conname = 'merchant_memory_label_check') then
    alter table public.merchant_memory add constraint merchant_memory_label_check check (label is null or char_length(label) <= 60);
  end if;
end $$;

-- ───────────── Etiquetas ─────────────
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 40),
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists tags_household_name_uq on public.tags (household_id, lower(trim(name)));

create table if not exists public.transaction_tags (
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  primary key (transaction_id, tag_id)
);
create index if not exists transaction_tags_tag_idx on public.transaction_tags (tag_id);
create index if not exists transaction_tags_household_idx on public.transaction_tags (household_id);

alter table public.tags enable row level security;
alter table public.transaction_tags enable row level security;
revoke all on public.tags, public.transaction_tags from anon;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tags' and policyname = 'ver etiquetas') then
    create policy "ver etiquetas" on public.tags for select to authenticated using (public.is_member(household_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tags' and policyname = 'crear etiquetas') then
    create policy "crear etiquetas" on public.tags for insert to authenticated
      with check (public.is_member(household_id) and created_by = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tags' and policyname = 'editar etiquetas') then
    create policy "editar etiquetas" on public.tags for update to authenticated
      using (public.is_member(household_id)) with check (public.is_member(household_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tags' and policyname = 'borrar etiquetas') then
    create policy "borrar etiquetas" on public.tags for delete to authenticated using (public.is_member(household_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'transaction_tags' and policyname = 'ver etiquetas de movimientos') then
    create policy "ver etiquetas de movimientos" on public.transaction_tags for select to authenticated
      using (public.can_see_transaction(transaction_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'transaction_tags' and policyname = 'poner etiquetas') then
    create policy "poner etiquetas" on public.transaction_tags for insert to authenticated
      with check (
        public.can_see_transaction(transaction_id)
        and household_id = (select t.household_id from public.transactions t where t.id = transaction_id)
        and household_id = (select g.household_id from public.tags g where g.id = tag_id)
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'transaction_tags' and policyname = 'quitar etiquetas') then
    create policy "quitar etiquetas" on public.transaction_tags for delete to authenticated
      using (public.can_see_transaction(transaction_id));
  end if;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tags') then
      alter publication supabase_realtime add table public.tags;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'transaction_tags') then
      alter publication supabase_realtime add table public.transaction_tags;
    end if;
  end if;
end $$;

-- ───────────── Procesador de avisos ─────────────
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
