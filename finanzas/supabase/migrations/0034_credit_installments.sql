-- 0034 · Créditos: número de cuotas y en qué cuota se va.
-- paid_installments: cuotas ya pagadas a la fecha paid_installments_on (la persona escribe "voy en la cuota 38",
-- se guarda 37). Desde esa fecha, cada día de pago que pasa suma una cuota. Plazo total en term_months (0031).
-- Se puede volver a correr sin problema.

alter table public.accounts add column if not exists paid_installments smallint;
alter table public.accounts add column if not exists paid_installments_on date;
do $$ begin
  alter table public.accounts add constraint accounts_paid_installments_check
    check (paid_installments is null or (paid_installments >= 0 and paid_installments <= 600));
exception when duplicate_object then null; end $$;
