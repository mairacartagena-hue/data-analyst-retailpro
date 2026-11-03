-- El pago de la cuota de un crédito (o tarjeta) con presupuesto es del hogar.
-- En Presupuestos lo que se transfiere a ese crédito cuenta como la cuota pagada (capital, intereses y seguros).
-- Si la transferencia quedaba personal (p. ej. "Registrar cuota" desde una cuenta propia), la pareja no la veía y en
-- su presupuesto solo contaban los intereses. Ahora toda transferencia a un crédito, préstamo o tarjeta con
-- presupuesto queda del hogar, se registre como se registre, y se corrigen las que ya estaban.

create or replace function public.credit_payment_household()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.kind = 'TRANSFER' and new.to_account_id is not null and new.scope <> 'HOUSEHOLD'
     and exists (select 1 from accounts a
                 where a.id = new.to_account_id
                   and a.kind in ('CREDIT', 'LOAN', 'CREDIT_CARD')
                   and a.budget_category_id is not null) then
    new.scope := 'HOUSEHOLD';
  end if;
  return new;
end;
$$;

drop trigger if exists credit_payment_household on public.transactions;
create trigger credit_payment_household
  before insert or update of kind, to_account_id, scope on public.transactions
  for each row execute function public.credit_payment_household();

-- Al incluir un crédito en Presupuestos, sus pagos anteriores también pasan al hogar
create or replace function public.credit_budget_payments_household()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.budget_category_id is not null and new.kind in ('CREDIT', 'LOAN', 'CREDIT_CARD')
     and (old.budget_category_id is null or old.budget_category_id <> new.budget_category_id) then
    update transactions set scope = 'HOUSEHOLD'
     where to_account_id = new.id and kind = 'TRANSFER' and scope <> 'HOUSEHOLD';
  end if;
  return new;
end;
$$;

revoke all on function public.credit_budget_payments_household() from public, anon, authenticated;

drop trigger if exists credit_budget_payments_household on public.accounts;
create trigger credit_budget_payments_household
  after update of budget_category_id on public.accounts
  for each row execute function public.credit_budget_payments_household();

-- Los pagos que ya quedaron personales
update public.transactions t set scope = 'HOUSEHOLD'
  from public.accounts a
 where a.id = t.to_account_id
   and t.kind = 'TRANSFER'
   and t.scope <> 'HOUSEHOLD'
   and a.kind in ('CREDIT', 'LOAN', 'CREDIT_CARD')
   and a.budget_category_id is not null;
