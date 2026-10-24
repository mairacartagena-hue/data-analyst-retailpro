-- 0001 · Esquema de Finanzas en Pareja
-- Todos los montos son pesos colombianos (COP) enteros, sin decimales.
-- Zona horaria de la app: America/Bogota.

create extension if not exists pgcrypto;

create or replace function public.today_bogota()
returns date
language sql
stable
as $$ select (now() at time zone 'America/Bogota')::date $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------
-- Hogar y miembros (máximo 2: slot A y slot B)
-- ---------------------------------------------------------------
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Nuestro hogar',
  invite_code text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  slot text not null check (slot in ('A', 'B')),
  display_name text not null check (length(trim(display_name)) between 1 and 40),
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  avatar text check (avatar is null or length(avatar) <= 8),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, slot)
);
create index household_members_household_idx on public.household_members (household_id);

-- ---------------------------------------------------------------
-- Periodos: ciclo del hogar + rangos personalizados
-- ---------------------------------------------------------------
create table public.period_settings (
  household_id uuid primary key references public.households (id) on delete cascade,
  cycle text not null default 'MONTHLY' check (cycle in ('MONTHLY', 'BIWEEKLY')),
  monthly_start_day smallint not null default 1 check (monthly_start_day between 1 and 28),
  biweekly_first_day smallint not null default 1 check (biweekly_first_day between 1 and 28),
  biweekly_second_day smallint not null default 16 check (biweekly_second_day between 2 and 28),
  updated_at timestamptz not null default now(),
  check (biweekly_first_day < biweekly_second_day)
);

create table public.custom_periods (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index custom_periods_household_idx on public.custom_periods (household_id);

-- ---------------------------------------------------------------
-- Cuentas (depósito, billetera, efectivo, tarjeta de crédito)
-- opening_balance: saldo inicial. En tarjetas es negativo (deuda).
-- ---------------------------------------------------------------
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  kind text not null check (kind in ('DEPOSIT', 'WALLET', 'CASH', 'CREDIT_CARD')),
  institution text,
  last4 text check (last4 is null or last4 ~ '^[0-9]{4}$'),
  -- Aislamiento por defecto: privada.
  visibility text not null default 'PRIVATE' check (visibility in ('PUBLIC', 'BALANCE_ONLY', 'PRIVATE')),
  -- Si es privada: mostrar su nombre a la pareja cuando paga algo de una categoría compartida.
  reveal_in_shared boolean not null default false,
  opening_balance bigint not null default 0,
  credit_limit bigint check (credit_limit is null or credit_limit >= 0),
  statement_day smallint check (statement_day is null or statement_day between 1 and 31),
  due_day smallint check (due_day is null or due_day between 1 and 31),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index accounts_household_idx on public.accounts (household_id);
create index accounts_owner_idx on public.accounts (owner_user_id);

-- ---------------------------------------------------------------
-- Categorías con responsabilidad asignada (sin porcentajes)
-- ---------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 50),
  icon text check (icon is null or length(icon) <= 8),
  responsibility text not null
    check (responsibility in ('MEMBER_A_100', 'MEMBER_B_100', 'FIXED_AMOUNTS', 'PRIVATE')),
  -- Solo para PRIVATE: dueño de la categoría.
  owner_user_id uuid references auth.users (id) on delete cascade,
  is_household_obligation boolean not null default false,
  is_shared_progress boolean not null default false,
  rollover_enabled boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (responsibility = 'PRIVATE' and owner_user_id is not null
      and not is_household_obligation and not is_shared_progress)
    or (responsibility <> 'PRIVATE' and owner_user_id is null)
  )
);
create index categories_household_idx on public.categories (household_id);

-- Presupuesto por versiones: aplica desde el periodo que empieza en valid_from
-- hasta que exista una versión más nueva. Así se conserva el historial para rollover.
create table public.category_budgets (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  valid_from date not null,
  amount bigint not null check (amount >= 0),
  fixed_amount_a bigint check (fixed_amount_a is null or fixed_amount_a >= 0),
  fixed_amount_b bigint check (fixed_amount_b is null or fixed_amount_b >= 0),
  created_at timestamptz not null default now(),
  unique (category_id, valid_from),
  check (
    (fixed_amount_a is null and fixed_amount_b is null)
    or (fixed_amount_a is not null and fixed_amount_b is not null and amount = fixed_amount_a + fixed_amount_b)
  )
);
create index category_budgets_category_idx on public.category_budgets (category_id);

-- ---------------------------------------------------------------
-- Transacciones
--   EXPENSE    gasto: sale de account_id (de payer_user_id); se reparte en transaction_splits
--   INCOME     ingreso: entra a account_id
--   TRANSFER   entre cuentas propias (incluye pago de tarjeta: no consume presupuesto)
--   SETTLEMENT liquidación del cruce: payer_user_id le paga a counterparty_user_id
-- ---------------------------------------------------------------
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  kind text not null check (kind in ('EXPENSE', 'INCOME', 'TRANSFER', 'SETTLEMENT')),
  status text not null default 'CONFIRMED' check (status in ('CONFIRMED', 'PENDING_REVIEW')),
  occurred_on date not null default public.today_bogota(),
  occurred_at timestamptz,
  amount bigint not null check (amount > 0),
  description text,
  merchant text,
  account_id uuid references public.accounts (id) on delete restrict,
  to_account_id uuid references public.accounts (id) on delete restrict,
  payer_user_id uuid not null references auth.users (id) on delete cascade,
  counterparty_user_id uuid references auth.users (id) on delete cascade,
  -- Ingresos: privados por defecto; compartido = la pareja lo ve y cuenta para el hogar.
  is_shared boolean not null default false,
  source text not null default 'MANUAL',
  dedup_hash text,
  tags text[] not null default '{}',
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'TRANSFER' or (account_id is not null and to_account_id is not null and account_id <> to_account_id)),
  check (kind not in ('EXPENSE', 'INCOME') or account_id is not null),
  check (kind <> 'SETTLEMENT' or counterparty_user_id is not null)
);
create index transactions_household_date_idx on public.transactions (household_id, occurred_on desc);
create index transactions_account_idx on public.transactions (account_id);
create index transactions_to_account_idx on public.transactions (to_account_id);
create index transactions_payer_idx on public.transactions (payer_user_id);
create index transactions_dedup_idx on public.transactions (household_id, dedup_hash) where dedup_hash is not null;

-- Desglose por montos exactos. Todo gasto tiene al menos un desglose.
create table public.transaction_splits (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  amount bigint not null check (amount > 0),
  category_id uuid references public.categories (id) on delete set null,
  responsible_user_id uuid not null references auth.users (id) on delete cascade,
  -- FIXED_EXCESS: excedente de una partida de montos fijos que se decidió cobrar.
  origin text not null default 'NORMAL' check (origin in ('NORMAL', 'FIXED_EXCESS')),
  note text,
  created_at timestamptz not null default now()
);
create index transaction_splits_tx_idx on public.transaction_splits (transaction_id);
create index transaction_splits_category_idx on public.transaction_splits (category_id);
create index transaction_splits_responsible_idx on public.transaction_splits (responsible_user_id);

-- ---------------------------------------------------------------
-- Libro de cruce: cada asiento dice "debtor le debe amount a creditor".
-- ---------------------------------------------------------------
create table public.cross_ledger (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  creditor_user_id uuid not null references auth.users (id) on delete cascade,
  debtor_user_id uuid not null references auth.users (id) on delete cascade,
  amount bigint not null check (amount > 0),
  kind text not null
    check (kind in ('CROSS_PAYMENT', 'SPLIT', 'FIXED_EXCESS', 'LOAN', 'ERRAND', 'SETTLEMENT')),
  transaction_id uuid references public.transactions (id) on delete cascade,
  split_id uuid references public.transaction_splits (id) on delete cascade,
  description text,
  occurred_on date not null default public.today_bogota(),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (creditor_user_id <> debtor_user_id)
);
create index cross_ledger_household_idx on public.cross_ledger (household_id, occurred_on desc);
create index cross_ledger_tx_idx on public.cross_ledger (transaction_id);

-- ---------------------------------------------------------------
-- Activos y pasivos manuales para el patrimonio neto
-- ---------------------------------------------------------------
create table public.manual_assets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  kind text not null check (kind in ('ASSET', 'LIABILITY')),
  asset_type text not null default 'OTHER'
    check (asset_type in ('INVESTMENT', 'PROPERTY', 'VEHICLE', 'LOAN', 'MORTGAGE', 'OTHER')),
  value bigint not null default 0 check (value >= 0),
  visibility text not null default 'PRIVATE' check (visibility in ('PUBLIC', 'PRIVATE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index manual_assets_household_idx on public.manual_assets (household_id);

-- updated_at automático
do $$
declare t text;
begin
  foreach t in array array['households', 'household_members', 'period_settings', 'accounts', 'categories',
                           'transactions', 'manual_assets']
  loop
    execute format('create trigger %I_updated_at before update on public.%I
                    for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;
