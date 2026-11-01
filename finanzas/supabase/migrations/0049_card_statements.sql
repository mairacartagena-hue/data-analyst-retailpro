-- 0049 · Extractos de la tarjeta de crédito
-- Cada extracto (corte) guarda el pago mínimo, el pago total y la deuda total. Se llenan al leer el PDF y la
-- persona los puede escribir o corregir a mano. La app los cruza con su proyección: la cuota del mes contra el
-- pago mínimo y la deuda de la app contra la deuda del extracto.
-- card_statement_items.as_of: corte del extracto del que salió la compra. Sin fecha = el extracto con el que
-- se registró la tarjeta (como hasta ahora); con fecha, su saldo pendiente se factura desde el corte siguiente.
-- Se puede volver a correr sin problema.

alter table public.card_statement_items add column if not exists as_of date;

create table if not exists public.card_statements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  cut_date date not null,
  due_date date,
  minimum_payment numeric(14,2) check (minimum_payment is null or minimum_payment >= 0),
  total_payment numeric(14,2) check (total_payment is null or total_payment >= 0),
  total_debt numeric(14,2) check (total_debt is null or total_debt >= 0),
  source text not null default 'MANUAL' check (source in ('PDF', 'MANUAL')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, cut_date)
);

alter table public.card_statements enable row level security;

drop policy if exists card_statements_owner on public.card_statements;
create policy card_statements_owner on public.card_statements
  for all to authenticated
  using (owner_user_id = auth.uid())
  with check (
    owner_user_id = auth.uid()
    and household_id = public.my_household_id()
    and exists (select 1 from accounts a where a.id = account_id and a.owner_user_id = auth.uid() and a.kind = 'CREDIT_CARD')
  );

revoke all on table public.card_statements from anon;
grant select, insert, update, delete on table public.card_statements to authenticated;
