-- 0036 · Créditos: valor fijo de la cuota (capital + intereses, sin seguros) como dice el extracto.
-- Con él, la app usa esa cuota: los intereses salen de la tasa y el saldo, y la diferencia va a capital.
-- Vacío: la cuota se calcula con la tasa y las cuotas que faltan (como antes).
-- Se puede volver a correr sin problema.

alter table public.accounts add column if not exists installment_amount numeric(14,2);
do $$ begin
  alter table public.accounts add constraint accounts_installment_amount_check check (installment_amount is null or installment_amount > 0);
exception when duplicate_object then null; end $$;
