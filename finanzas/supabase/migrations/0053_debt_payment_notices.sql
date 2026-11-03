-- 0053 · Los pagos y abonos del cruce no se duplican con el aviso del banco.
--
-- Un pago o abono del cruce es una liquidación (pareja) o un ajuste de saldo (Cobrar, y los pagos con contactos).
--  1. Si el aviso del banco llega DESPUÉS: el paso 1b de _ingest_core ya unía las liquidaciones; ahora también une
--     los ajustes que son pagos del cruce (mismo monto, misma cuenta, misma dirección, ±3 días).
--  2. Si el aviso llegó ANTES (quedó como ingreso o gasto de una transferencia): al registrar el pago o abono, ese
--     aviso se une al pago (absorb_bank_notices) y se borra el movimiento repetido. Solo avisos de transferencias o
--     ingresos que llegaron solos (no compras ni movimientos registrados a mano).
-- Se puede volver a correr sin problema.

-- ¿El movimiento es el pago de una deuda del cruce (pareja o contacto)?
create or replace function public.is_debt_payment_tx(p_tx uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from cross_ledger where transaction_id = p_tx and kind = 'PAYMENT')
      or exists (select 1 from contact_ledger where (transaction_id = p_tx and kind = 'PAYMENT') or received_transaction_id = p_tx)
$$;
revoke all on function public.is_debt_payment_tx(uuid) from public, anon, authenticated;

-- Une al pago (liquidación o ajuste) los avisos del banco que ya habían llegado por esa misma plata.
create or replace function public.absorb_bank_notices(p_tx uuid)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_t transactions;
  v_n int := 0;
  v_dup uuid;
  v_side record;
begin
  select * into v_t from transactions where id = p_tx;
  if not found or v_t.kind not in ('SETTLEMENT', 'ADJUSTMENT') then return 0; end if;
  for v_side in
    -- (cuenta, ¿salida?) que mueve el pago
    select v_t.account_id as account, (v_t.kind = 'SETTLEMENT' or v_t.direction = 'OUT') as outflow where v_t.account_id is not null
    union all
    select v_t.to_account_id, false where v_t.kind = 'SETTLEMENT' and v_t.to_account_id is not null
  loop
    select d.id into v_dup from transactions d
     where d.household_id = v_t.household_id and d.id <> v_t.id
       and d.source <> 'MANUAL' and d.amount = v_t.amount and d.account_id = v_side.account
       and abs(d.occurred_on - v_t.occurred_on) <= 3
       and (case when v_side.outflow then d.kind = 'EXPENSE' and d.movement_type = 'TRANSFER_OUT'
                 else d.kind = 'INCOME' and d.movement_type in ('TRANSFER_IN', 'INCOME') end)
     order by abs(d.occurred_on - v_t.occurred_on), d.created_at
     limit 1;
    if v_dup is not null then
      update ingest_logs set transaction_id = v_t.id, result = 'MERGED',
             reason = case when v_t.kind = 'SETTLEMENT' then 'Ya estaba registrado como liquidación' else 'Ya estaba registrado como pago del cruce' end
       where transaction_id = v_dup;
      delete from transactions where id = v_dup;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.absorb_bank_notices(uuid) from public, anon, authenticated;

-- 1. _ingest_core: el paso 1b también une el aviso con un ajuste que es pago del cruce
do $$
declare v_src text;
begin
  select pg_get_functiondef('public._ingest_core(uuid, uuid, jsonb)'::regprocedure) into v_src;
  if position('is_debt_payment_tx' in v_src) > 0 then return; end if;
  v_src := replace(v_src, $r$     where t.household_id = v_hh and t.kind in ('SETTLEMENT', 'TRANSFER') and t.status = 'CONFIRMED'
       and t.amount = v_amount
       and (case when v_outflow then t.account_id = v_account else t.to_account_id = v_account end)$r$,
    $r$     where t.household_id = v_hh and t.status = 'CONFIRMED' and t.amount = v_amount
       and ((t.kind in ('SETTLEMENT', 'TRANSFER')
             and (case when v_outflow then t.account_id = v_account else t.to_account_id = v_account end))
            or (t.kind = 'ADJUSTMENT' and t.account_id = v_account
                and t.direction = case when v_outflow then 'OUT' else 'IN' end
                and is_debt_payment_tx(t.id)))$r$);
  v_src := replace(v_src,
    $r$case when v_existing.kind = 'SETTLEMENT' then 'Ya estaba registrado como liquidación' else 'Ya estaba registrado como transferencia' end$r$,
    $r$case v_existing.kind when 'SETTLEMENT' then 'Ya estaba registrado como liquidación'
             when 'ADJUSTMENT' then 'Ya estaba registrado como pago del cruce'
             else 'Ya estaba registrado como transferencia' end$r$);
  if position('is_debt_payment_tx' in v_src) = 0 or position('como pago del cruce' in v_src) = 0 then
    raise exception '_ingest_core no tiene la forma esperada (¿falta la migración 0052_settlement_notice_no_duplicate?)';
  end if;
  execute v_src;
end $$;

-- 2. Al registrar el pago o abono se une el aviso que ya había llegado
do $$
declare v_src text;
begin
  -- Liquidación nueva con la pareja
  select pg_get_functiondef('public.save_transaction(jsonb)'::regprocedure) into v_src;
  if position('absorb_bank_notices' in v_src) = 0 then
    v_src := replace(v_src, $r$
  return v_id;
end;$r$, $r$
  if v_kind = 'SETTLEMENT' and v_old.id is null then perform absorb_bank_notices(v_id); end if;
  return v_id;
end;$r$);
    if position('absorb_bank_notices' in v_src) = 0 then raise exception 'save_transaction no tiene la forma esperada'; end if;
    execute v_src;
  end if;

  -- Cobrar a la pareja
  select pg_get_functiondef('public.resolve_debt(jsonb)'::regprocedure) into v_src;
  if position('absorb_bank_notices' in v_src) = 0 then
    v_src := replace(v_src, $r$
  return v_id;
end;$r$, $r$
  if v_tx is not null then perform absorb_bank_notices(v_tx); end if;
  return v_id;
end;$r$);
    if position('absorb_bank_notices' in v_src) = 0 then raise exception 'resolve_debt no tiene la forma esperada'; end if;
    execute v_src;
  end if;

  -- Me pagó / le pagué a un contacto
  select pg_get_functiondef('public.settle_contact(jsonb)'::regprocedure) into v_src;
  if position('absorb_bank_notices' in v_src) = 0 then
    v_src := replace(v_src, $r$
  return v_id;
end;$r$, $r$
  if v_tx is not null then perform absorb_bank_notices(v_tx); end if;
  return v_id;
end;$r$);
    if position('absorb_bank_notices' in v_src) = 0 then raise exception 'settle_contact no tiene la forma esperada'; end if;
    execute v_src;
  end if;

  -- Contacto vinculado: en qué cuenta me entró su pago
  select pg_get_functiondef('public.receive_contact_payment(jsonb)'::regprocedure) into v_src;
  if position('absorb_bank_notices' in v_src) = 0 then
    v_src := replace(v_src, $r$
  return v_tx;
end;$r$, $r$
  perform absorb_bank_notices(v_tx);
  return v_tx;
end;$r$);
    if position('absorb_bank_notices' in v_src) = 0 then raise exception 'receive_contact_payment no tiene la forma esperada'; end if;
    execute v_src;
  end if;
end $$;
