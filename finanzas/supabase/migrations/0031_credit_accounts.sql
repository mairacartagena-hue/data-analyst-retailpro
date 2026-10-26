-- 0031 · Créditos con saldo (hipoteca, libre inversión).
-- Tipo de cuenta CREDIT: el saldo es el capital que falta (negativo). La tasa va en interest_rate_ea
-- y el día de pago en due_day (como en las tarjetas). Plazo en meses y costos mensuales (seguros, otros).
-- Se puede volver a correr sin problema.

alter table public.accounts drop constraint if exists accounts_kind_check;
alter table public.accounts add constraint accounts_kind_check
  check (kind in ('DEPOSIT', 'WALLET', 'CASH', 'CREDIT_CARD', 'LOAN', 'CREDIT'));

alter table public.accounts add column if not exists term_months smallint;
alter table public.accounts add column if not exists monthly_costs numeric(14,2) not null default 0;
do $$ begin
  alter table public.accounts add constraint accounts_term_check check (term_months is null or term_months between 1 and 600);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.accounts add constraint accounts_monthly_costs_check check (monthly_costs >= 0);
exception when duplicate_object then null; end $$;
