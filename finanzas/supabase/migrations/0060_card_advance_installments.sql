-- 0060 · Avances de la tarjeta de crédito a cuotas.
-- Un avance es una transferencia que SALE de una tarjeta de crédito (la deuda de la tarjeta sube y la plata
-- llega a otra cuenta). Igual que una compra, se puede diferir a cuotas y con su propia tasa E.A.
-- - tx_installments(): guarda las cuotas en gastos y en transferencias que salen de una tarjeta de crédito.
-- - tx_rate(): guarda la tasa del avance solo si tiene más de una cuota.
-- save_transaction() ya llama a estas dos funciones (migraciones 0027 y 0029), así que no se toca.
-- Un avance no es un gasto: no cuenta en presupuestos ni en informes; solo cambia lo que toca pagar de la tarjeta.
-- Se puede volver a correr sin problema.

create or replace function public.tx_installments(p_kind text, p_account uuid, p jsonb)
returns smallint
language sql stable security definer set search_path = public
as $$
  select case
    when p_kind in ('EXPENSE', 'TRANSFER') and exists (select 1 from accounts a where a.id = p_account and a.kind = 'CREDIT_CARD')
      then least(48, greatest(1, coalesce(nullif(p->>'installments', '')::int, 1)))::smallint
    else 1::smallint
  end
$$;
revoke all on function public.tx_installments(text, uuid, jsonb) from public, anon, authenticated;

create or replace function public.tx_rate(p_kind text, p_account uuid, p jsonb)
returns numeric
language sql stable security definer set search_path = public
as $$
  select case
    when p_kind in ('EXPENSE', 'TRANSFER') and exists (select 1 from accounts a where a.id = p_account and a.kind = 'CREDIT_CARD')
         and coalesce(nullif(p->>'installments', '')::int, 1) > 1
      then nullif(p->>'interest_rate_ea', '')::numeric
    else null
  end
$$;
revoke all on function public.tx_rate(text, uuid, jsonb) from public, anon, authenticated;
