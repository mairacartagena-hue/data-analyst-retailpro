-- 0055 · El segundo aviso de Google Wallet no duplica la compra (4-nov-2026). Se puede correr más de una vez.
--
-- Google Wallet avisa cada pago dos veces: al pagar y otra vez minutos después (7 a 50 min en los casos reales),
-- cuando agrega la ubicación al recibo, con el nombre del comercio corregido (ej. "TIENDA JUAN VALDEZ CAFE M" →
-- "Juan Valdez Café"). La deduplicación normal solo une avisos a ±5 minutos, así que el segundo aviso creaba otro
-- gasto. Ahora un aviso de Wallet se une a un gasto que ya tenga un aviso de Wallet del mismo monto, cuenta
-- compatible y comercio parecido en las 2 horas anteriores. Un SMS o notificación del banco no usa esta regla:
-- dos compras iguales reales siguen quedando aparte.
--
-- Se agrega el paso a _ingest_core tal como quedó en la base (0052 + 0053), sin reescribirla entera.

do $$
declare v_src text;
begin
  select pg_get_functiondef('public._ingest_core(uuid, uuid, jsonb)'::regprocedure) into v_src;
  if position('segundo aviso de Wallet' in v_src) > 0 then return; end if;
  v_src := replace(v_src, $r$     where t.id = ingest_find_undated_duplicate(v_hh, v_uid, v_amount, v_outflow, v_at, v_norm, v_account);
  end if;
$r$, $r$     where t.id = ingest_find_undated_duplicate(v_hh, v_uid, v_amount, v_outflow, v_at, v_norm, v_account);
  end if;

  -- El segundo aviso de Wallet (cuando agrega la ubicación al recibo) es la misma compra: mismo monto, cuenta
  -- compatible, comercio parecido y un gasto que ya tiene un aviso de Wallet en las 2 horas anteriores
  if not found and v_outflow and coalesce(p_event->>'source', '') ~* '(wallet|billetera de google)' then
    select t.* into v_existing from transactions t
     where t.household_id = v_hh and t.payer_user_id = v_uid and t.amount = v_amount
       and t.kind in ('EXPENSE', 'TRANSFER', 'SETTLEMENT', 'DEBT_PAYMENT')
       and (t.account_id is null or v_account is null or t.account_id = v_account)
       and ingest_merchant_compatible(coalesce(t.merchant_norm, nullif(lower(trim(t.description)), '')), v_norm)
       and coalesce(t.occurred_at, t.created_at) between v_at - interval '2 hours' and v_at + interval '5 minutes'
       and exists (select 1 from ingest_logs l
                    where l.transaction_id = t.id and coalesce(l.source, '') ~* '(wallet|billetera de google)')
     order by coalesce(t.occurred_at, t.created_at) desc
     limit 1;
  end if;
$r$);
  if position('segundo aviso de Wallet' in v_src) = 0 then
    raise exception '_ingest_core no tiene la forma esperada (¿faltan las migraciones 0052 y 0053?)';
  end if;
  execute v_src;
end $$;

revoke all on function public._ingest_core(uuid, uuid, jsonb) from public, anon, authenticated;
