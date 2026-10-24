-- 0011 · Cierre del mes (conciliación) y 4x1000
--  · accounts.opening_at: momento del saldo inicial; los movimientos anteriores no lo vuelven a afectar
--    (evita restar dos veces lo que llega de correos de días anteriores a crear la cuenta)
--  · accounts.gmf_mode: cuenta gravada con 4x1000, exenta (350 UVT/mes) o de bajo monto (65 UVT/mes)
--  · period_settings.uvt_value: valor de la UVT del año (2026: $52.374, Resolución DIAN 000238 de 2025)
--  · account_reconciliations: historial de conciliaciones por cuenta y mes (solo su dueño)

alter table public.accounts
  add column if not exists opening_at timestamptz,
  add column if not exists gmf_mode text not null default 'TAXED'
    check (gmf_mode in ('TAXED', 'EXEMPT_350', 'LOW_AMOUNT_65'));
update public.accounts set opening_at = created_at where opening_at is null;
alter table public.accounts alter column opening_at set default now();
alter table public.accounts alter column opening_at set not null;

alter table public.period_settings add column if not exists uvt_value int not null default 52374
  check (uvt_value > 0);

-- Momento efectivo de un movimiento: su hora real si la tiene; si no, el final del día de su fecha (Bogotá)
create or replace function public.tx_effective_at(p_occurred_at timestamptz, p_occurred_on date)
returns timestamptz
language sql immutable
as $$ select coalesce(p_occurred_at, ((p_occurred_on + time '23:59:59') at time zone 'America/Bogota')) $$;

create or replace function public.account_balances()
returns table (account_id uuid, balance bigint)
language sql stable security definer set search_path = public
as $$
  select a.id,
         a.opening_balance + coalesce((
           select sum(
                    case when t.account_id = a.id
                         then case when t.kind = 'INCOME' then t.amount else -t.amount end
                         else 0 end
                  + case when t.to_account_id = a.id then t.amount else 0 end)
           from transactions t
           where (t.account_id = a.id or t.to_account_id = a.id)
             and tx_effective_at(t.occurred_at, t.occurred_on) >= a.opening_at
         ), 0)::bigint
  from accounts a
  join household_members m on m.household_id = a.household_id and m.user_id = auth.uid()
  where a.owner_user_id = auth.uid() or a.visibility in ('PUBLIC', 'BALANCE_ONLY')
$$;

create table if not exists public.account_reconciliations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  statement_balance bigint not null,
  app_balance bigint not null,
  difference bigint generated always as (statement_balance - app_balance) stored,
  status text not null check (status in ('RECONCILED', 'DIFFERENCE')),
  note text,
  updated_at timestamptz not null default now(),
  unique (account_id, month)
);
create index if not exists account_reconciliations_owner_idx on public.account_reconciliations (owner_user_id, month desc);

alter table public.account_reconciliations enable row level security;
revoke all on public.account_reconciliations from anon;
create policy "ver mis conciliaciones" on public.account_reconciliations
  for select to authenticated using (owner_user_id = auth.uid());
create policy "crear mis conciliaciones" on public.account_reconciliations
  for insert to authenticated
  with check (owner_user_id = auth.uid() and household_id = public.my_household_id()
              and exists (select 1 from public.accounts a where a.id = account_id and a.owner_user_id = auth.uid()));
create policy "editar mis conciliaciones" on public.account_reconciliations
  for update to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

create trigger account_reconciliations_updated_at before update on public.account_reconciliations
  for each row execute function public.set_updated_at();
