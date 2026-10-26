-- 0035 · Créditos: valor inicial del crédito (lo que prestó el banco), para ver cuánto del capital ya se pagó.
-- Se puede volver a correr sin problema.

alter table public.accounts add column if not exists original_amount numeric(14,2);
do $$ begin
  alter table public.accounts add constraint accounts_original_amount_check check (original_amount is null or original_amount > 0);
exception when duplicate_object then null; end $$;
