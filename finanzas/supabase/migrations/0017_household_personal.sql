-- 0017 · Organización hogar / personal
--  · transactions.scope: cada movimiento dice a qué espacio pertenece (HOUSEHOLD = hogar, PERSONAL = personal).
--    La privacidad ya no sale de la categoría ni de la visibilidad de la cuenta: la pareja ve un movimiento
--    si es del hogar o si participa en él (pagó, registró, es contraparte o responsable de una parte).
--  · Tipos nuevos: DEBT_PAYMENT (pago de deuda), REFUND (reembolso: devuelve plata de un gasto) y
--    ADJUSTMENT (ajuste de saldo; no es ingreso ni gasto).
--  · transactions.creates_debt: si quien pagó y quien responde son distintos, la persona decide si genera deuda.
--  · La pareja puede ajustar un movimiento del hogar; quien pagó sigue siendo quien lo registró.
--  · categories.parent_id: subcategorías (un nivel).
--  · scheduled_payments: compromisos y próximos vencimientos (pagos previstos con fecha). Un pago registrado
--    se enlaza con su vencimiento (transactions.scheduled_payment_id + scheduled_for) y deja de contar como comprometido.
-- Se puede correr más de una vez.

-- ---------------------------------------------------------------
-- Columnas nuevas
-- ---------------------------------------------------------------
alter table public.transactions add column if not exists scope text;
alter table public.transactions add column if not exists creates_debt boolean not null default true;
alter table public.transactions add column if not exists direction text;
alter table public.transactions add column if not exists updated_by uuid references auth.users (id) on delete set null;

alter table public.transactions drop constraint if exists transactions_kind_check;
alter table public.transactions add constraint transactions_kind_check
  check (kind in ('EXPENSE', 'INCOME', 'TRANSFER', 'SETTLEMENT', 'DEBT_PAYMENT', 'REFUND', 'ADJUSTMENT'));
alter table public.transactions drop constraint if exists transactions_account_required;
alter table public.transactions add constraint transactions_account_required
  check (kind not in ('EXPENSE', 'INCOME', 'DEBT_PAYMENT', 'REFUND', 'ADJUSTMENT') or account_id is not null or status = 'PENDING_REVIEW');
alter table public.transactions drop constraint if exists transactions_direction_check;
alter table public.transactions add constraint transactions_direction_check
  check ((kind = 'ADJUSTMENT' and direction in ('IN', 'OUT')) or (kind <> 'ADJUSTMENT' and direction is null));

-- Ámbito de lo que ya existe: se conserva exactamente lo que la pareja podía ver antes.
--  · gasto: categoría con progreso compartido o de montos fijos, o cuenta pública sin partes en categorías privadas
--  · ingreso: compartido o en cuenta pública · transferencia: alguna cuenta pública · liquidación: hogar
update public.transactions t
   set scope = case
     when t.kind = 'SETTLEMENT' then 'HOUSEHOLD'
     when t.kind = 'INCOME' and (t.is_shared or exists (
       select 1 from public.accounts a where a.id = t.account_id and a.visibility = 'PUBLIC')) then 'HOUSEHOLD'
     when t.kind = 'TRANSFER' and exists (
       select 1 from public.accounts a where a.id in (t.account_id, t.to_account_id) and a.visibility = 'PUBLIC') then 'HOUSEHOLD'
     when t.kind = 'EXPENSE' and (
       exists (select 1 from public.transaction_splits s join public.categories c on c.id = s.category_id
               where s.transaction_id = t.id and (c.is_shared_progress or c.responsibility = 'FIXED_AMOUNTS'))
       or (exists (select 1 from public.accounts a where a.id = t.account_id and a.visibility = 'PUBLIC')
           and not exists (select 1 from public.transaction_splits s join public.categories c on c.id = s.category_id
                           where s.transaction_id = t.id and c.responsibility = 'PRIVATE'))) then 'HOUSEHOLD'
     else 'PERSONAL' end
 where t.scope is null;

alter table public.transactions alter column scope set default 'PERSONAL';
alter table public.transactions alter column scope set not null;
alter table public.transactions drop constraint if exists transactions_scope_check;
alter table public.transactions add constraint transactions_scope_check check (scope in ('HOUSEHOLD', 'PERSONAL'));
create index if not exists transactions_scope_idx on public.transactions (household_id, scope);

-- Deuda que genera un reembolso cuando la parte devuelta era de la pareja
alter table public.cross_ledger drop constraint if exists cross_ledger_kind_check;
alter table public.cross_ledger add constraint cross_ledger_kind_check
  check (kind in ('CROSS_PAYMENT', 'SPLIT', 'FIXED_EXCESS', 'LOAN', 'ERRAND', 'SETTLEMENT', 'REFUND'));

-- ---------------------------------------------------------------
-- Compromisos: pagos previstos (una vez o cada mes) del hogar o personales
-- ---------------------------------------------------------------
create table if not exists public.scheduled_payments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  scope text not null default 'HOUSEHOLD' check (scope in ('HOUSEHOLD', 'PERSONAL')),
  owner_user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  kind text not null default 'EXPENSE' check (kind in ('EXPENSE', 'DEBT_PAYMENT')),
  amount bigint not null check (amount > 0),
  category_id uuid references public.categories (id) on delete set null,
  responsible_user_id uuid references auth.users (id) on delete set null,
  frequency text not null check (frequency in ('ONCE', 'MONTHLY')),
  due_date date,
  day_of_month smallint check (day_of_month is null or day_of_month between 1 and 31),
  start_date date not null default public.today_bogota(),
  end_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((frequency = 'ONCE' and due_date is not null) or (frequency = 'MONTHLY' and day_of_month is not null)),
  check (end_date is null or end_date >= start_date)
);
create index if not exists scheduled_payments_household_idx on public.scheduled_payments (household_id);

alter table public.scheduled_payments enable row level security;
revoke all on public.scheduled_payments from anon;
drop policy if exists "ver compromisos" on public.scheduled_payments;
drop policy if exists "crear compromisos" on public.scheduled_payments;
drop policy if exists "editar compromisos" on public.scheduled_payments;
drop policy if exists "borrar compromisos" on public.scheduled_payments;
create policy "ver compromisos" on public.scheduled_payments for select to authenticated
  using (public.is_member(household_id) and (scope = 'HOUSEHOLD' or owner_user_id = auth.uid()));
create policy "crear compromisos" on public.scheduled_payments for insert to authenticated
  with check (household_id = public.my_household_id() and owner_user_id = auth.uid());
create policy "editar compromisos" on public.scheduled_payments for update to authenticated
  using (public.is_member(household_id) and (scope = 'HOUSEHOLD' or owner_user_id = auth.uid()))
  with check (household_id = public.my_household_id() and (scope = 'HOUSEHOLD' or owner_user_id = auth.uid()));
create policy "borrar compromisos" on public.scheduled_payments for delete to authenticated
  using (public.is_member(household_id) and (scope = 'HOUSEHOLD' or owner_user_id = auth.uid()));

drop trigger if exists scheduled_payments_updated_at on public.scheduled_payments;
create trigger scheduled_payments_updated_at before update on public.scheduled_payments
  for each row execute function public.set_updated_at();

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                  and schemaname = 'public' and tablename = 'scheduled_payments') then
    alter publication supabase_realtime add table public.scheduled_payments;
  end if;
end $$;

alter table public.transactions add column if not exists scheduled_payment_id uuid
  references public.scheduled_payments (id) on delete set null;
alter table public.transactions add column if not exists scheduled_for date;
create index if not exists transactions_scheduled_idx on public.transactions (scheduled_payment_id) where scheduled_payment_id is not null;

-- Subcategorías
alter table public.categories add column if not exists parent_id uuid references public.categories (id) on delete set null;
create index if not exists categories_parent_idx on public.categories (parent_id);
alter table public.categories drop constraint if exists categories_parent_check;
alter table public.categories add constraint categories_parent_check check (parent_id is null or parent_id <> id);

-- Memoria de comercios: también recuerda el ámbito y si genera deuda (para "Aplicar siempre")
alter table public.merchant_memory add column if not exists scope text
  check (scope is null or scope in ('HOUSEHOLD', 'PERSONAL'));
alter table public.merchant_memory add column if not exists creates_debt boolean not null default true;
update public.merchant_memory m
   set scope = case when exists (select 1 from public.categories c where c.id = m.category_id
                                  and (c.is_shared_progress or c.responsibility = 'FIXED_AMOUNTS'))
                    then 'HOUSEHOLD' else 'PERSONAL' end
 where m.scope is null;

-- ---------------------------------------------------------------
-- Visibilidad de un movimiento: del hogar, o la persona participa en él
-- ---------------------------------------------------------------
create or replace function public.can_see_transaction(p_transaction_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from transactions t
    join household_members m on m.household_id = t.household_id and m.user_id = auth.uid()
    where t.id = p_transaction_id
      and (
        t.scope = 'HOUSEHOLD'
        or t.payer_user_id = auth.uid()
        or t.created_by = auth.uid()
        or t.counterparty_user_id = auth.uid()
        or exists (select 1 from transaction_splits s
                   where s.transaction_id = t.id and s.responsible_user_id = auth.uid())
      )
  )
$$;

-- Efecto de un movimiento sobre su cuenta de origen: +1 entra, −1 sale
create or replace function public.tx_sign(p_kind text, p_direction text)
returns int
language sql immutable set search_path = public
as $$ select case when p_kind in ('INCOME', 'REFUND') or (p_kind = 'ADJUSTMENT' and p_direction = 'IN') then 1 else -1 end $$;

create or replace function public.account_balances()
returns table (account_id uuid, balance bigint)
language sql stable security definer set search_path = public
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
  where a.owner_user_id = auth.uid() or a.visibility in ('PUBLIC', 'BALANCE_ONLY')
$$;

-- Ejecutado por categoría: solo de movimientos que la persona puede ver.
-- (La app ya lo calcula con los movimientos; esto evita que la función muestre montos personales de la pareja.)
create or replace function public.category_daily_spending(p_from date, p_to date)
returns table (category_id uuid, responsible_user_id uuid, occurred_on date, total bigint)
language sql stable security definer set search_path = public
as $$
  select s.category_id, s.responsible_user_id, t.occurred_on,
         sum(case when t.kind = 'REFUND' then -s.amount else s.amount end)::bigint
  from transaction_splits s
  join transactions t on t.id = s.transaction_id
  where t.household_id = my_household_id()
    and t.kind in ('EXPENSE', 'DEBT_PAYMENT', 'REFUND')
    and t.occurred_on between p_from and p_to
    and s.category_id is not null
    and can_see_budget(s.category_id)
    and can_see_transaction(t.id)
  group by s.category_id, s.responsible_user_id, t.occurred_on
$$;

-- ---------------------------------------------------------------
-- Guardar un movimiento
-- p = { id?, kind, scope, amount, occurred_on, description, merchant, account_id, to_account_id,
--       counterparty_user_id, direction, creates_debt, income_category_id, scheduled_payment_id, scheduled_for, tags: [],
--       splits: [{ amount, category_id, responsible_user_id, origin, note }] }
-- Quien registra es quien pagó. La pareja puede ajustar un movimiento del hogar ya confirmado
-- (gasto, ingreso, pago de deuda o reembolso); el pagador y la cuenta no cambian.
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
  v_scope text := nullif(p->>'scope', '');
  v_amount bigint := (p->>'amount')::bigint;
  v_account uuid := nullif(p->>'account_id', '')::uuid;
  v_to uuid := nullif(p->>'to_account_id', '')::uuid;
  v_counter uuid := nullif(p->>'counterparty_user_id', '')::uuid;
  v_date date := coalesce(nullif(p->>'occurred_on', '')::date, today_bogota());
  v_desc text := nullif(trim(coalesce(p->>'description', '')), '');
  v_merchant text := nullif(trim(coalesce(p->>'merchant', '')), '');
  v_tags text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'tags', '[]'::jsonb))), '{}');
  v_direction text := nullif(p->>'direction', '');
  v_debt boolean := coalesce((p->>'creates_debt')::boolean, true);
  v_inc_cat uuid := nullif(p->>'income_category_id', '')::uuid;
  v_sp uuid := nullif(p->>'scheduled_payment_id', '')::uuid;
  v_sp_for date := nullif(p->>'scheduled_for', '')::date;
  v_old transactions;
  v_payer uuid := v_uid;
  v_other_edit boolean := false;
  v_split jsonb;
  v_splits jsonb := coalesce(p->'splits', '[]'::jsonb);
  v_has_splits boolean;
  v_n int;
  v_sum bigint := 0;
  v_cat categories;
  v_cat_id uuid;
  v_resp uuid;
  v_origin text;
  v_split_id uuid;
  v_split_amount bigint;
begin
  if v_uid is null then raise exception 'Necesitas iniciar sesión'; end if;
  if v_hh is null then raise exception 'Primero crea o únete a un hogar'; end if;
  if v_kind not in ('EXPENSE', 'INCOME', 'TRANSFER', 'SETTLEMENT', 'DEBT_PAYMENT', 'REFUND', 'ADJUSTMENT') then
    raise exception 'Tipo de movimiento no válido';
  end if;
  if v_amount is null or v_amount <= 0 then raise exception 'El monto debe ser mayor que cero'; end if;
  if v_scope is not null and v_scope not in ('HOUSEHOLD', 'PERSONAL') then raise exception 'Ámbito no válido'; end if;
  v_has_splits := v_kind in ('EXPENSE', 'DEBT_PAYMENT', 'REFUND');

  if v_id is not null then
    select * into v_old from transactions where id = v_id and household_id = v_hh for update;
    if not found then raise exception 'Ese movimiento no existe'; end if;
    v_payer := v_old.payer_user_id;
    if v_old.created_by <> v_uid then
      -- Ajuste de la pareja: solo movimientos del hogar ya confirmados
      if v_old.scope <> 'HOUSEHOLD' or v_old.status <> 'CONFIRMED'
         or v_old.kind not in ('EXPENSE', 'INCOME', 'DEBT_PAYMENT', 'REFUND') then
        raise exception 'Solo quien registró el movimiento puede editarlo';
      end if;
      if exists (select 1 from transaction_splits s where s.transaction_id = v_id
                  and s.category_id is not null and not can_see_category(s.category_id)) then
        raise exception 'Este movimiento tiene partes privadas; solo quien lo registró puede editarlo';
      end if;
      v_other_edit := true;
      v_account := v_old.account_id;
      v_scope := 'HOUSEHOLD';
    end if;
    -- Un pendiente que llegó automáticamente puede cambiar de tipo al revisarlo (ej. pago de tarjeta)
    if v_old.kind <> v_kind and (v_old.status <> 'PENDING_REVIEW' or v_kind = 'SETTLEMENT' or v_other_edit) then
      raise exception 'No se puede cambiar el tipo de un movimiento';
    end if;
    v_scope := coalesce(v_scope, v_old.scope);
  end if;

  if v_kind = 'SETTLEMENT' then v_scope := 'HOUSEHOLD'; end if;
  v_scope := coalesce(v_scope, 'PERSONAL');

  if not v_other_edit and v_account is not null and not exists (
    select 1 from accounts where id = v_account and owner_user_id = v_payer and household_id = v_hh
  ) then
    raise exception 'La cuenta de origen debe ser tuya';
  end if;

  if v_kind in ('EXPENSE', 'INCOME', 'DEBT_PAYMENT', 'REFUND', 'ADJUSTMENT') and v_account is null then
    raise exception 'Elige la cuenta';
  end if;

  if v_kind = 'ADJUSTMENT' then
    if v_direction is null or v_direction not in ('IN', 'OUT') then
      raise exception 'Indica si el ajuste suma o resta al saldo';
    end if;
  else
    v_direction := null;
  end if;

  if v_kind = 'TRANSFER' then
    if v_account is null or v_to is null or v_account = v_to then
      raise exception 'Elige dos cuentas distintas';
    end if;
    if not exists (select 1 from accounts where id = v_to and owner_user_id = v_payer and household_id = v_hh) then
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
  -- Vencimiento que se paga con este movimiento (gasto o pago de deuda)
  if v_other_edit then
    v_sp := v_old.scheduled_payment_id;
    v_sp_for := v_old.scheduled_for;
  end if;
  if v_kind not in ('EXPENSE', 'DEBT_PAYMENT') then v_sp := null; end if;
  if v_sp is null then
    v_sp_for := null;
  elsif not exists (select 1 from scheduled_payments where id = v_sp and household_id = v_hh
                     and (scope = 'HOUSEHOLD' or owner_user_id = v_uid)) then
    raise exception 'Ese compromiso no existe';
  elsif v_sp_for is null then
    raise exception 'Indica qué vencimiento se paga';
  end if;

  if v_kind <> 'INCOME' then v_inc_cat := null; end if;
  if v_inc_cat is not null and not exists (
    select 1 from categories where id = v_inc_cat and household_id = v_hh and kind = 'INCOME'
      and (responsibility <> 'PRIVATE' or owner_user_id = v_uid)
  ) then
    raise exception 'Categoría de ingreso no válida';
  end if;

  if v_has_splits then
    v_n := jsonb_array_length(v_splits);
    if v_n = 0 then raise exception 'El movimiento necesita al menos una categoría o responsable'; end if;
    select coalesce(sum((s->>'amount')::bigint), 0) into v_sum from jsonb_array_elements(v_splits) s;
    if v_sum <> v_amount then
      raise exception 'La suma del desglose (%) debe ser igual al total (%)', v_sum, v_amount;
    end if;
  end if;

  if v_id is null then
    insert into transactions (household_id, kind, scope, status, occurred_on, amount, description, merchant,
                              account_id, to_account_id, payer_user_id, counterparty_user_id,
                              is_shared, source, tags, created_by, income_category_id, direction, creates_debt, updated_by,
                              scheduled_payment_id, scheduled_for)
    values (v_hh, v_kind, v_scope, 'CONFIRMED', v_date, v_amount, v_desc, v_merchant,
            v_account, v_to, v_uid, v_counter,
            v_kind = 'INCOME' and v_scope = 'HOUSEHOLD', 'MANUAL', v_tags, v_uid, v_inc_cat, v_direction, v_debt, v_uid,
            v_sp, v_sp_for)
    returning id into v_id;
  else
    update transactions
       set kind = v_kind,
           scope = v_scope,
           status = 'CONFIRMED',
           occurred_on = v_date,
           amount = v_amount,
           description = v_desc,
           merchant = case when v_other_edit then merchant else v_merchant end,
           account_id = v_account,
           to_account_id = v_to,
           counterparty_user_id = v_counter,
           is_shared = v_kind = 'INCOME' and v_scope = 'HOUSEHOLD',
           tags = case when v_other_edit then tags else v_tags end,
           income_category_id = case when v_other_edit then income_category_id else v_inc_cat end,
           direction = v_direction,
           creates_debt = v_debt,
           updated_by = v_uid,
           scheduled_payment_id = v_sp,
           scheduled_for = v_sp_for
     where id = v_id;
    delete from cross_ledger where transaction_id = v_id;
    delete from transaction_splits where transaction_id = v_id;
  end if;

  if v_has_splits then
    for v_split in select * from jsonb_array_elements(v_splits)
    loop
      v_cat_id := nullif(v_split->>'category_id', '')::uuid;
      v_resp := nullif(v_split->>'responsible_user_id', '')::uuid;
      v_origin := coalesce(nullif(v_split->>'origin', ''), 'NORMAL');
      v_split_amount := (v_split->>'amount')::bigint;

      if v_split_amount <= 0 then raise exception 'Cada parte del desglose debe ser mayor que cero'; end if;

      if v_cat_id is not null then
        select * into v_cat from categories where id = v_cat_id and household_id = v_hh;
        if not found or not can_see_category(v_cat_id) or v_cat.kind <> 'EXPENSE' then
          raise exception 'Categoría no válida';
        end if;
        if v_resp is null then v_resp := category_responsible(v_cat_id); end if;
        if v_cat.responsibility = 'PRIVATE' then
          if v_scope = 'HOUSEHOLD' then
            raise exception 'La categoría "%" es personal: úsala en un movimiento personal', v_cat.name;
          end if;
          if v_resp <> v_cat.owner_user_id then
            raise exception 'Una categoría privada solo puede quedar a cargo de su dueño';
          end if;
        end if;
      end if;

      if v_resp is null then v_resp := v_payer; end if;
      if not exists (select 1 from household_members where user_id = v_resp and household_id = v_hh) then
        raise exception 'El responsable debe ser miembro del hogar';
      end if;
      if v_origin not in ('NORMAL', 'FIXED_EXCESS') or v_kind = 'REFUND' then v_origin := 'NORMAL'; end if;
      if v_origin = 'FIXED_EXCESS' and v_resp = v_payer then v_origin := 'NORMAL'; end if;

      insert into transaction_splits (transaction_id, household_id, amount, category_id, responsible_user_id, origin, note)
      values (v_id, v_hh, v_split_amount, v_cat_id, v_resp, v_origin,
              nullif(trim(coalesce(v_split->>'note', '')), ''))
      returning id into v_split_id;

      -- Pagó uno y le correspondía al otro: deuda solo si se pidió (el excedente de montos fijos ya se preguntó)
      if v_resp <> v_payer and (v_debt or v_origin = 'FIXED_EXCESS') then
        if v_kind = 'REFUND' then
          -- El reembolso entró a la cuenta de quien pagó, pero esa parte era del otro: se la debe
          insert into cross_ledger (household_id, creditor_user_id, debtor_user_id, amount, kind,
                                    transaction_id, split_id, description, occurred_on, created_by)
          values (v_hh, v_resp, v_payer, v_split_amount, 'REFUND',
                  v_id, v_split_id, coalesce(v_desc, v_merchant, 'Reembolso'), v_date, v_payer);
        else
          insert into cross_ledger (household_id, creditor_user_id, debtor_user_id, amount, kind,
                                    transaction_id, split_id, description, occurred_on, created_by)
          values (v_hh, v_payer, v_resp, v_split_amount,
                  case when v_origin = 'FIXED_EXCESS' then 'FIXED_EXCESS'
                       when v_n = 1 then 'CROSS_PAYMENT'
                       else 'SPLIT' end,
                  v_id, v_split_id, coalesce(v_desc, v_merchant), v_date, v_payer);
        end if;
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

-- El responsable de un desglose puede ponerle su propia categoría (también en pagos de deuda y reembolsos)
create or replace function public.set_split_category(p_split_id uuid, p_category_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_split transaction_splits;
  v_cat categories;
  v_scope text;
begin
  select * into v_split from transaction_splits where id = p_split_id and household_id = my_household_id();
  if not found then raise exception 'Ese desglose no existe'; end if;
  if v_split.responsible_user_id <> auth.uid() then
    raise exception 'Solo el responsable puede cambiar la categoría de su parte';
  end if;
  select scope into v_scope from transactions where id = v_split.transaction_id;
  if p_category_id is not null then
    select * into v_cat from categories where id = p_category_id;
    if not found or not can_see_category(p_category_id) or v_cat.kind <> 'EXPENSE' then
      raise exception 'Categoría no válida';
    end if;
    if v_cat.responsibility = 'PRIVATE' and (v_cat.owner_user_id <> auth.uid() or v_scope = 'HOUSEHOLD') then
      raise exception 'Categoría no válida';
    end if;
  end if;
  update transaction_splits set category_id = p_category_id where id = p_split_id;
end;
$$;

-- ---------------------------------------------------------------
-- Categorías con subcategorías
-- p = { id?, kind, parent_id?, name, icon, responsibility, is_household_obligation, is_shared_progress,
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
  v_kind text := coalesce(nullif(p->>'kind', ''), 'EXPENSE');
  v_parent uuid := nullif(p->>'parent_id', '')::uuid;
  v_par categories;
  v_a bigint;
  v_b bigint;
  v_amount bigint;
begin
  if v_hh is null then raise exception 'No perteneces a un hogar'; end if;
  if v_resp not in ('MEMBER_A_100', 'MEMBER_B_100', 'FIXED_AMOUNTS', 'PRIVATE') then
    raise exception 'Tipo de responsabilidad no válido';
  end if;

  if v_kind not in ('EXPENSE', 'INCOME') then raise exception 'Tipo de categoría no válido'; end if;

  if v_id is not null and not can_see_category(v_id) then
    raise exception 'Esa categoría no existe';
  end if;
  if v_id is not null then
    select kind into v_kind from categories where id = v_id;
  end if;

  -- Categorías de ingresos: personales y sin presupuesto
  if v_kind = 'INCOME' then
    v_resp := 'PRIVATE';
    v_budget := null;
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

  -- Subcategoría: un solo nivel, del mismo tipo; dentro de una categoría personal solo caben personales
  if v_parent is not null then
    select * into v_par from categories where id = v_parent and household_id = v_hh;
    if not found or not can_see_category(v_parent) then raise exception 'La categoría principal no existe'; end if;
    if v_par.parent_id is not null then raise exception 'Una subcategoría no puede tener subcategorías'; end if;
    if v_par.kind <> v_kind then raise exception 'La categoría principal debe ser del mismo tipo'; end if;
    if v_id is not null and (v_parent = v_id or exists (select 1 from categories where parent_id = v_id)) then
      raise exception 'Esta categoría tiene subcategorías: no puede quedar dentro de otra';
    end if;
    if v_par.responsibility = 'PRIVATE' and v_resp <> 'PRIVATE' then
      raise exception 'Dentro de una categoría personal solo puede haber subcategorías personales';
    end if;
  end if;

  if v_id is null then
    insert into categories (household_id, name, icon, responsibility, owner_user_id,
                            is_household_obligation, is_shared_progress, rollover_enabled, kind, parent_id)
    values (v_hh, trim(p->>'name'), nullif(p->>'icon', ''), v_resp, v_owner,
            v_obligation, v_shared, coalesce((p->>'rollover_enabled')::boolean, false) and v_kind = 'EXPENSE', v_kind, v_parent)
    returning id into v_id;
  else
    update categories
       set name = trim(p->>'name'),
           icon = nullif(p->>'icon', ''),
           responsibility = v_resp,
           owner_user_id = v_owner,
           is_household_obligation = v_obligation,
           is_shared_progress = v_shared,
           rollover_enabled = coalesce((p->>'rollover_enabled')::boolean, false),
           parent_id = v_parent
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

-- Categorías sugeridas (estructura inicial). Solo agrega las que faltan: si ya existe una categoría
-- con el mismo nombre (en cualquier lugar), no se duplica. Las de gastos quedan del hogar con progreso
-- compartido y sin presupuesto; las de ingresos, personales de quien las agrega.
create or replace function public.add_suggested_categories()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hh uuid := my_household_id();
  v_tree jsonb := '[
    {"name": "Vivienda y hogar", "icon": "🏠", "children": ["Crédito hipotecario", "Crédito de remodelación", "Administración", "Servicios públicos", "Mantenimiento y reparaciones", "Muebles y artículos del hogar", "Aseo"]},
    {"name": "Alimentación", "icon": "🛒", "children": ["Mercado", "Tiendas", "Restaurantes", "Domicilios"]},
    {"name": "Mascotas", "icon": "🐾", "children": ["Alimentación de mascotas", "Veterinaria", "Medicamentos de mascotas", "Accesorios", "Cuidado"]},
    {"name": "Transporte", "icon": "🚗", "children": ["Combustible", "Transporte público", "Aplicaciones de transporte", "Parqueaderos", "Mantenimiento del vehículo"]},
    {"name": "Salud y bienestar", "icon": "💊", "children": ["Consultas", "Medicamentos", "Seguros", "Cuidado personal"]},
    {"name": "Deudas y obligaciones", "icon": "💳", "children": ["Cuotas", "Intereses", "Seguros asociados", "Comisiones financieras"]},
    {"name": "Estilo de vida", "icon": "🎁", "children": ["Ropa", "Entretenimiento", "Hobbies", "Viajes", "Regalos", "Suscripciones"]},
    {"name": "Ahorro e inversión", "icon": "📈", "children": ["Fondo de emergencia", "Metas de ahorro", "Aportes a inversiones"]}
  ]'::jsonb;
  v_income text[] := array['Salario', 'Honorarios', 'Ingresos adicionales', 'Rendimientos', 'Reembolsos'];
  v_group jsonb;
  v_parent uuid;
  v_child text;
  v_n int := 0;
begin
  if v_hh is null then raise exception 'No perteneces a un hogar'; end if;

  for v_group in select * from jsonb_array_elements(v_tree)
  loop
    select id into v_parent from categories
     where household_id = v_hh and kind = 'EXPENSE' and parent_id is null and not archived
       and lower(name) = lower(v_group->>'name') and can_see_category(id)
     limit 1;
    if v_parent is null then
      insert into categories (household_id, name, icon, responsibility, is_shared_progress, kind)
      values (v_hh, v_group->>'name', v_group->>'icon', 'FIXED_AMOUNTS', true, 'EXPENSE')
      returning id into v_parent;
      v_n := v_n + 1;
    end if;
    for v_child in select jsonb_array_elements_text(v_group->'children')
    loop
      if not exists (select 1 from categories where household_id = v_hh and kind = 'EXPENSE'
                      and lower(name) = lower(v_child) and can_see_category(id)) then
        insert into categories (household_id, name, responsibility, is_shared_progress, kind, parent_id)
        values (v_hh, v_child, 'FIXED_AMOUNTS', true, 'EXPENSE', v_parent);
        v_n := v_n + 1;
      end if;
    end loop;
    v_parent := null;
  end loop;

  foreach v_child in array v_income
  loop
    if not exists (select 1 from categories where household_id = v_hh and kind = 'INCOME'
                    and lower(name) = lower(v_child) and can_see_category(id)) then
      insert into categories (household_id, name, responsibility, owner_user_id, kind)
      values (v_hh, v_child, 'PRIVATE', v_uid, 'INCOME');
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------
-- Ingesta: deduplicar también contra pagos de deuda y reembolsos registrados a mano
-- ---------------------------------------------------------------
create or replace function public.ingest_find_duplicate(
  p_hh uuid, p_uid uuid, p_amount bigint, p_outflow boolean, p_at timestamptz, p_norm text, p_account uuid
)
returns uuid
language sql stable security definer set search_path = public, extensions
as $$
  select t.id
    from transactions t
   where t.household_id = p_hh
     and t.payer_user_id = p_uid
     and t.amount = p_amount
     and (case when p_outflow then t.kind in ('EXPENSE', 'TRANSFER', 'SETTLEMENT', 'DEBT_PAYMENT')
               else t.kind in ('INCOME', 'REFUND') end)
     and (t.account_id is null or p_account is null or t.account_id = p_account)
     and ingest_merchant_compatible(coalesce(t.merchant_norm, nullif(lower(trim(t.description)), '')), p_norm)
     and (
       (t.occurred_at is not null and abs(extract(epoch from (t.occurred_at - p_at))) <= 300)
       or (t.occurred_at is null and t.source = 'MANUAL'
           and abs(t.occurred_on - (p_at at time zone 'America/Bogota')::date) <= 1)
       or (t.occurred_at is null and t.source <> 'MANUAL' and abs(extract(epoch from (t.created_at - p_at))) <= 300)
     )
   order by (t.occurred_at is null), abs(extract(epoch from (coalesce(t.occurred_at, t.created_at) - p_at)))
   limit 1
$$;

-- Unir un aviso con lo registrado a mano: un gasto puede unirse con un pago de deuda y un ingreso con un reembolso
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
   where id = p_target and created_by = v_uid and household_id = v_p.household_id and id <> v_p.id
     and (kind = v_p.kind
          or (v_p.kind = 'EXPENSE' and kind = 'DEBT_PAYMENT')
          or (v_p.kind = 'INCOME' and kind = 'REFUND'));
  if not found then raise exception 'El movimiento registrado a mano no existe'; end if;

  if v_t.kind in ('EXPENSE', 'DEBT_PAYMENT', 'REFUND') then
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

-- Recordar el comercio de un movimiento revisado (con su ámbito y si genera deuda)
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
    insert into merchant_memory (household_id, user_id, identifier_type, identifier, category_id, responsible_user_id,
                                 tag, auto_apply, hits, scope, creates_debt)
    values (v_tx.household_id, v_uid, v_ident.type, v_ident.value, v_split.category_id, v_split.responsible_user_id,
            v_tag, p_auto_apply, 1, v_tx.scope, v_tx.creates_debt)
    on conflict (user_id, identifier_type, identifier) do update
      set category_id = excluded.category_id,
          responsible_user_id = excluded.responsible_user_id,
          tag = coalesce(excluded.tag, merchant_memory.tag),
          auto_apply = excluded.auto_apply,
          scope = excluded.scope,
          creates_debt = excluded.creates_debt,
          hits = merchant_memory.hits + 1,
          last_used_at = now();
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Permisos (desde 0016 las funciones nuevas no quedan abiertas por defecto)
revoke all on function public.tx_sign(text, text) from public, anon;
grant execute on function public.tx_sign(text, text) to authenticated;
revoke all on function public.add_suggested_categories() from public, anon;
grant execute on function public.add_suggested_categories() to authenticated;
revoke all on function public.ingest_find_duplicate(uuid, uuid, bigint, boolean, timestamptz, text, uuid)
  from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'can_see_transaction(uuid)', 'account_balances()', 'category_daily_spending(date, date)',
    'save_transaction(jsonb)', 'set_split_category(uuid, uuid)', 'save_category(jsonb)',
    'merge_pending_into(uuid, uuid)', 'remember_merchant(uuid, boolean)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------
-- Ingesta (_ingest_core igual a 0014b, con dos cambios):
--  · un movimiento nuevo queda PERSONAL; si se aplicó solo por "Aplicar siempre", toma el ámbito recordado
--  · la deuda con la pareja solo se anota si el comercio recordado la genera
-- ---------------------------------------------------------------
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

  if v_txkind = 'EXPENSE' then
    insert into transaction_splits (transaction_id, household_id, amount, category_id, responsible_user_id)
    values (v_tx, v_hh, v_amount, v_split_cat, coalesce(v_split_resp, v_uid))
    returning id into v_split_id;
    if coalesce(v_split_resp, v_uid) <> v_uid and v_split_cat is not null and coalesce(v_mem.creates_debt, true) then
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
