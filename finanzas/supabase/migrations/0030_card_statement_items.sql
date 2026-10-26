-- 0030 · Compras del extracto de la tarjeta que no se registran como movimiento.
-- Solo sirven para la proyección de cuotas de la tarjeta: no entran en Movimientos, presupuestos ni informes.
-- Se puede volver a correr sin problema.

create table if not exists public.card_statement_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  description text not null,
  purchase_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  installments smallint not null check (installments between 1 and 48),
  paid_installments smallint not null default 0 check (paid_installments >= 0),
  remaining_balance numeric(14,2) not null check (remaining_balance >= 0),
  rate_ea numeric(6,3) check (rate_ea is null or (rate_ea >= 0 and rate_ea <= 200)),
  created_at timestamptz not null default now()
);

create index if not exists card_statement_items_account_idx on public.card_statement_items (account_id);

alter table public.card_statement_items enable row level security;

drop policy if exists card_statement_items_owner on public.card_statement_items;
create policy card_statement_items_owner on public.card_statement_items
  for all to authenticated
  using (owner_user_id = auth.uid())
  with check (
    owner_user_id = auth.uid()
    and exists (select 1 from accounts a where a.id = account_id and a.owner_user_id = auth.uid() and a.kind = 'CREDIT_CARD')
  );

revoke all on table public.card_statement_items from anon;
grant select, insert, update, delete on table public.card_statement_items to authenticated;
