-- 0029 · Tasa de cada compra a cuotas (la que sale en el extracto).
-- Cada compra puede tener su propia tasa E.A.; si no, la app usa la de la tarjeta.
-- save_transaction() guarda la tasa solo en compras a cuotas con tarjeta de crédito.
-- Se puede volver a correr sin problema.

alter table public.transactions add column if not exists interest_rate_ea numeric(6,3);
do $$ begin
  alter table public.transactions add constraint transactions_interest_rate_check
    check (interest_rate_ea is null or (interest_rate_ea >= 0 and interest_rate_ea <= 200));
exception when duplicate_object then null; end $$;

create or replace function public.tx_rate(p_kind text, p_account uuid, p jsonb)
returns numeric
language sql stable security definer set search_path = public
as $$
  select case
    when p_kind = 'EXPENSE' and exists (select 1 from accounts a where a.id = p_account and a.kind = 'CREDIT_CARD')
         and coalesce(nullif(p->>'installments', '')::int, 1) > 1
      then nullif(p->>'interest_rate_ea', '')::numeric
    else null
  end
$$;
revoke all on function public.tx_rate(text, uuid, jsonb) from public, anon, authenticated;

do $$
declare v_src text;
begin
  select pg_get_functiondef('public.save_transaction(jsonb)'::regprocedure) into v_src;
  if position('tx_rate' in v_src) > 0 then return; end if;
  v_src := replace(v_src, $r$scheduled_payment_id, scheduled_for, installments)
    values$r$, $r$scheduled_payment_id, scheduled_for, installments, interest_rate_ea)
    values$r$);
  v_src := replace(v_src, $r$tx_installments(v_kind, v_account, p))
    returning id into v_id;$r$, $r$tx_installments(v_kind, v_account, p), tx_rate(v_kind, v_account, p))
    returning id into v_id;$r$);
  v_src := replace(v_src, $r$           installments = case when v_other_edit then installments else tx_installments(v_kind, v_account, p) end
     where id = v_id;$r$, $r$           installments = case when v_other_edit then installments else tx_installments(v_kind, v_account, p) end,
           interest_rate_ea = case when v_other_edit then interest_rate_ea else tx_rate(v_kind, v_account, p) end
     where id = v_id;$r$);
  if (length(v_src) - length(replace(v_src, 'tx_rate', ''))) / length('tx_rate') <> 2 or position('interest_rate_ea)' in v_src) = 0 then
    raise exception 'save_transaction no tiene la forma esperada (¿falta la migración 0027?)';
  end if;
  execute v_src;
end $$;
