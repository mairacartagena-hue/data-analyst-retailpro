-- 0006 · Fase 2: ingesta automática (notificaciones, SMS y correos bancarios)
-- Tokens de ingesta por persona, registro de eventos, memoria de comercios,
-- deduplicación sin IA (pg_trgm) y cola de pendientes.

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------
-- Columnas nuevas en movimientos
-- ---------------------------------------------------------------
alter table public.transactions
  add column if not exists merchant_norm text,
  add column if not exists movement_type text
    check (movement_type is null or movement_type in
      ('PURCHASE', 'TRANSFER_OUT', 'TRANSFER_IN', 'WITHDRAWAL', 'CARD_PAYMENT', 'INCOME', 'OWN_TRANSFER')),
  add column if not exists card_last4 text,
  add column if not exists ingest_identifiers jsonb not null default '[]',
  add column if not exists suggested_category_id uuid references public.categories (id) on delete set null,
  add column if not exists suggested_responsible_user_id uuid references auth.users (id) on delete set null,
  add column if not exists suggested_to_account_id uuid references public.accounts (id) on delete set null;

create index if not exists transactions_dedup_lookup_idx on public.transactions (payer_user_id, amount);

-- Un movimiento pendiente de revisión puede llegar sin cuenta identificada.
alter table public.transactions drop constraint if exists transactions_check1;
alter table public.transactions add constraint transactions_account_required
  check (kind not in ('EXPENSE', 'INCOME') or account_id is not null or status = 'PENDING_REVIEW');

-- ---------------------------------------------------------------
-- Tokens de ingesta (uno por persona; se guarda solo el hash)
-- ---------------------------------------------------------------
create table if not exists public.ingest_tokens (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  token_hash text not null unique,
  token_hint text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

-- ---------------------------------------------------------------
-- Registro de cada evento crudo
-- ---------------------------------------------------------------
create table if not exists public.ingest_logs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  channel text not null,
  source text,
  external_id text,
  raw_text text, -- se borra a los 30 días
  parsed jsonb,
  parser text,
  result text not null check (result in ('ACCEPTED', 'MERGED', 'DISCARDED', 'IGNORED', 'UNRECOGNIZED', 'ERROR')),
  reason text,
  transaction_id uuid references public.transactions (id) on delete set null,
  received_at timestamptz not null default now()
);
create index if not exists ingest_logs_user_idx on public.ingest_logs (user_id, received_at desc);
create unique index if not exists ingest_logs_external_idx on public.ingest_logs (user_id, external_id) where external_id is not null;

-- ---------------------------------------------------------------
-- Memoria de comercios (de cada persona)
-- ---------------------------------------------------------------
create table if not exists public.merchant_memory (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  identifier_type text not null check (identifier_type in ('MERCHANT', 'NIT', 'ACCOUNT', 'PHONE', 'KEYWORD')),
  identifier text not null,
  category_id uuid references public.categories (id) on delete cascade,
  responsible_user_id uuid references auth.users (id) on delete set null,
  tag text,
  auto_apply boolean not null default false,
  hits int not null default 0,
  last_used_at timestamptz not null default now(),
  unique (user_id, identifier_type, identifier)
);

alter table public.ingest_tokens enable row level security;
alter table public.ingest_logs enable row level security;
alter table public.merchant_memory enable row level security;
revoke all on public.ingest_tokens, public.ingest_logs, public.merchant_memory from anon;

create policy "ver mi token" on public.ingest_tokens for select to authenticated using (user_id = auth.uid());
create policy "ver mis eventos" on public.ingest_logs for select to authenticated using (user_id = auth.uid());
create policy "borrar mis eventos" on public.ingest_logs for delete to authenticated using (user_id = auth.uid());
create policy "ver mi memoria" on public.merchant_memory for select to authenticated using (user_id = auth.uid());
create policy "editar mi memoria" on public.merchant_memory for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "borrar mi memoria" on public.merchant_memory for delete to authenticated using (user_id = auth.uid());

alter publication supabase_realtime add table public.ingest_logs, public.merchant_memory;

-- ---------------------------------------------------------------
-- Generar token (se muestra una sola vez)
-- ---------------------------------------------------------------
create or replace function public.create_ingest_token()
returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_hh uuid := my_household_id();
  v_token text := 'fp_' || encode(gen_random_bytes(24), 'hex');
begin
  if v_hh is null then raise exception 'No perteneces a un hogar'; end if;
  insert into ingest_tokens (household_id, user_id, token_hash, token_hint)
  values (v_hh, v_uid, encode(digest(v_token, 'sha256'), 'hex'), right(v_token, 4))
  on conflict (user_id) do update
    set token_hash = excluded.token_hash, token_hint = excluded.token_hint, created_at = now(), last_used_at = null;
  return v_token;
end;
$$;

-- ---------------------------------------------------------------
-- Registro interno de un evento
-- ---------------------------------------------------------------
create or replace function public._ingest_log(
  p_hh uuid, p_uid uuid, p_event jsonb, p_result text, p_reason text, p_tx uuid
)
returns void
language sql security definer set search_path = public
as $$
  insert into ingest_logs (household_id, user_id, channel, source, external_id, raw_text, parsed, parser, result, reason, transaction_id)
  values (p_hh, p_uid, coalesce(nullif(p_event->>'channel', ''), 'UNKNOWN'), nullif(p_event->>'source', ''),
          nullif(p_event->>'external_id', ''), left(p_event->>'raw_text', 4000), p_event->'parsed',
          nullif(p_event->>'parser', ''), p_result, p_reason, p_tx)
$$;
revoke all on function public._ingest_log(uuid, uuid, jsonb, text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------
-- Ingesta de un evento ya interpretado por el servidor (parser o Gemini).
-- p_event = { channel, source, external_id, raw_text, parser, received_at,
--             parsed: { kind, amount, merchant, merchant_norm, last4, institution, occurred_at,
--                       identifiers: [{type, value}], ignore_reason } | null }
-- kind: PURCHASE | TRANSFER_OUT | TRANSFER_IN | WITHDRAWAL | CARD_PAYMENT | INCOME | IGNORE
-- Se puede llamar sin sesión: la identidad sale del token.
-- ---------------------------------------------------------------
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
     where owner_user_id = v_uid and household_id = v_hh and not archived and last4 = v_last4
     order by (kind = 'CREDIT_CARD') desc, created_at limit 1;
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
  select t.* into v_existing
    from transactions t
   where t.household_id = v_hh
     and t.payer_user_id = v_uid
     and t.amount = v_amount
     and (case when v_outflow then t.kind in ('EXPENSE', 'TRANSFER', 'SETTLEMENT') else t.kind = 'INCOME' end)
     and abs(extract(epoch from (coalesce(t.occurred_at, t.created_at) - v_at))) <= 300
     and (t.merchant_norm is null or v_norm is null
          or similarity(t.merchant_norm, v_norm) >= 0.3
          or t.merchant_norm like '%' || v_norm || '%' or v_norm like '%' || t.merchant_norm || '%')
     and (t.account_id is null or v_account is null or t.account_id = v_account)
   order by abs(extract(epoch from (coalesce(t.occurred_at, t.created_at) - v_at)))
   limit 1;

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

-- Categoría que la persona puede usar (sin sesión no sirve can_see_category)
create or replace function public.m_valid_category(p_category uuid, p_hh uuid, p_uid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from categories c
     where c.id = p_category and c.household_id = p_hh and not c.archived
       and (c.responsibility <> 'PRIVATE' or c.owner_user_id = p_uid)
  )
$$;
revoke all on function public.m_valid_category(uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------
-- Recordar el comercio de un movimiento ya revisado
-- ---------------------------------------------------------------
create or replace function public.remember_merchant(p_transaction_id uuid, p_auto_apply boolean default false)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tx transactions;
  v_split transaction_splits;
  v_n int := 0;
  v_ident record;
  v_tag text;
begin
  select * into v_tx from transactions where id = p_transaction_id and payer_user_id = v_uid and household_id = my_household_id();
  if not found then raise exception 'Ese movimiento no existe'; end if;
  if v_tx.kind <> 'EXPENSE' then return 0; end if;
  if (select count(*) from transaction_splits where transaction_id = v_tx.id) <> 1 then return 0; end if;
  select * into v_split from transaction_splits where transaction_id = v_tx.id;
  if v_split.category_id is null then return 0; end if;
  v_tag := (select t from unnest(v_tx.tags) t where t not like '#tc\_%' limit 1);

  for v_ident in
    select 'MERCHANT' as type, v_tx.merchant_norm as value where v_tx.merchant_norm is not null
    union
    select upper(i->>'type'), lower(i->>'value') from jsonb_array_elements(v_tx.ingest_identifiers) i
     where upper(i->>'type') in ('NIT', 'ACCOUNT', 'PHONE') and coalesce(i->>'value', '') <> ''
  loop
    insert into merchant_memory (household_id, user_id, identifier_type, identifier, category_id, responsible_user_id, tag, auto_apply, hits)
    values (v_tx.household_id, v_uid, v_ident.type, v_ident.value, v_split.category_id, v_split.responsible_user_id, v_tag, p_auto_apply, 1)
    on conflict (user_id, identifier_type, identifier) do update
      set category_id = excluded.category_id,
          responsible_user_id = excluded.responsible_user_id,
          tag = coalesce(excluded.tag, merchant_memory.tag),
          auto_apply = excluded.auto_apply,
          hits = merchant_memory.hits + 1,
          last_used_at = now();
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

grant execute on function public.ingest_event(text, jsonb) to anon, authenticated;
revoke all on function public.create_ingest_token() from public, anon;
grant execute on function public.create_ingest_token() to authenticated;
revoke all on function public.remember_merchant(uuid, boolean) from public, anon;
grant execute on function public.remember_merchant(uuid, boolean) to authenticated;
