-- 0051 · Vencimientos de los presupuestos obligatorios del hogar para los dos.
-- Los créditos y tarjetas cuyo presupuesto es del hogar y obligatorio se muestran en Vencimientos a ambos miembros,
-- aunque la cuenta sea privada. Esta función solo entrega lo necesario para el vencimiento (nombre, tipo, días de
-- corte y de pago y la categoría del presupuesto); no entrega saldos ni movimientos.
-- Se puede correr más de una vez.

create or replace function public.household_obligation_debts()
returns table (id uuid, owner_user_id uuid, responsible_user_id uuid, name text, kind text,
               statement_day int, due_day int, budget_category_id uuid)
language sql stable security definer set search_path = public
as $$
  select a.id, a.owner_user_id, a.responsible_user_id, a.name, a.kind::text,
         a.statement_day::int, a.due_day::int, a.budget_category_id
  from accounts a
  join household_members m on m.household_id = a.household_id and m.user_id = auth.uid()
  where a.kind in ('CREDIT', 'LOAN', 'CREDIT_CARD')
    and not a.archived
    and a.due_day is not null
    and a.budget_category_id is not null
    and exists (select 1 from category_limits l
                 where l.household_id = a.household_id and l.category_id = a.budget_category_id
                   and l.scope = 'HOUSEHOLD' and l.is_household_obligation)
    and public.mfa_ok()
$$;

revoke all on function public.household_obligation_debts() from public, anon;
grant execute on function public.household_obligation_debts() to authenticated;
