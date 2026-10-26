-- 0027 · Compras a cuotas con tarjeta de crédito.
-- - transactions.installments: número de cuotas de una compra (1 = sin cuotas). Solo en gastos pagados con tarjeta de crédito.
-- - accounts.interest_rate_ea: tasa efectiva anual (%) de la tarjeta, para estimar los intereses en la app.
-- - save_transaction() guarda las cuotas; shared_personal_spending() reparte cada compra en sus meses
--   (igual que la app: cuota de capital = valor / cuotas, el sobrante de pesos en la primera).
-- Se puede volver a correr sin problema.

alter table public.transactions add column if not exists installments smallint not null default 1;
do $$ begin
  alter table public.transactions add constraint transactions_installments_check check (installments between 1 and 48);
exception when duplicate_object then null; end $$;

alter table public.accounts add column if not exists interest_rate_ea numeric(6,3);
do $$ begin
  alter table public.accounts add constraint accounts_interest_rate_check check (interest_rate_ea is null or (interest_rate_ea >= 0 and interest_rate_ea <= 200));
exception when duplicate_object then null; end $$;

-- Cuotas que se guardan: solo en un gasto con tarjeta de crédito; si no, 1.
create or replace function public.tx_installments(p_kind text, p_account uuid, p jsonb)
returns smallint
language sql stable security definer set search_path = public
as $$
  select case
    when p_kind = 'EXPENSE' and exists (select 1 from accounts a where a.id = p_account and a.kind = 'CREDIT_CARD')
      then least(48, greatest(1, coalesce(nullif(p->>'installments', '')::int, 1)))::smallint
    else 1::smallint
  end
$$;
revoke all on function public.tx_installments(text, uuid, jsonb) from public, anon, authenticated;

-- save_transaction: guardar las cuotas (la pareja que ajusta un movimiento del hogar no las cambia)
do $$
declare v_src text;
begin
  select pg_get_functiondef('public.save_transaction(jsonb)'::regprocedure) into v_src;
  if position('tx_installments' in v_src) > 0 then return; end if;
  v_src := replace(v_src, $r$scheduled_payment_id, scheduled_for)
    values$r$, $r$scheduled_payment_id, scheduled_for, installments)
    values$r$);
  v_src := replace(v_src, $r$v_sp, v_sp_for)
    returning id into v_id;$r$, $r$v_sp, v_sp_for, tx_installments(v_kind, v_account, p))
    returning id into v_id;$r$);
  v_src := replace(v_src, $r$scheduled_for = v_sp_for
     where id = v_id;$r$, $r$scheduled_for = v_sp_for,
           installments = case when v_other_edit then installments else tx_installments(v_kind, v_account, p) end
     where id = v_id;$r$);
  if (length(v_src) - length(replace(v_src, 'tx_installments', ''))) / length('tx_installments') <> 2
     or position('scheduled_for, installments)' in v_src) = 0 then
    raise exception 'save_transaction no tiene la forma esperada (¿falta la migración 0022?)';
  end if;
  execute v_src;
end $$;

-- Totales de los presupuestos personales que la pareja comparte: cada compra a cuotas cuenta una cuota por mes
create or replace function public.shared_personal_spending()
returns table (owner_user_id uuid, category_id uuid, occurred_on date, total bigint)
language sql stable security definer set search_path = public
as $$
  with shared as (
    select l.owner_user_id, l.category_id from category_limits l
     where l.household_id = my_household_id() and l.scope = 'PERSONAL' and l.shared_with_partner
       and l.owner_user_id <> auth.uid()
    union
    select b.owner_user_id, pc.category_id from budget_plans b
      join budget_plan_categories pc on pc.plan_id = b.id
     where b.household_id = my_household_id() and b.scope = 'PERSONAL' and b.shared_with_partner
       and b.owner_user_id <> auth.uid()
  ),
  cats as (
    select s.owner_user_id, c.id as category_id from shared s
      join categories c on c.id = s.category_id or c.parent_id = s.category_id
  ),
  parts as (
    select sp.responsible_user_id, sp.category_id, t.kind, sp.amount, t.occurred_on,
           case when t.kind = 'EXPENSE' then greatest(t.installments, 1) else 1 end as n
      from transactions t
      join transaction_splits sp on sp.transaction_id = t.id
      join (select distinct * from cats) k on k.category_id = sp.category_id and k.owner_user_id = sp.responsible_user_id
     where t.household_id = my_household_id()
       and t.scope = 'PERSONAL'
       and t.kind in ('EXPENSE', 'DEBT_PAYMENT', 'REFUND')
       and not can_see_transaction(t.id)
  )
  -- Solo lo que la persona no puede abrir (lo que sí ve ya lo suma la app): así cada parte cuenta una vez
  select p.responsible_user_id, p.category_id, (p.occurred_on + make_interval(months => g.k))::date,
         sum((case when p.kind = 'REFUND' then -1 else 1 end)
             * (p.amount / p.n + case when g.k = 0 then p.amount % p.n else 0 end))::bigint
    from parts p
    cross join lateral generate_series(0, p.n - 1) as g(k)
   group by 1, 2, 3
$$;
revoke all on function public.shared_personal_spending() from public, anon;
grant execute on function public.shared_personal_spending() to authenticated;
