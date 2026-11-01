-- 0050 · Cuota de la tarjeta: cruce del pago con su presupuesto y su vencimiento.
-- apply_credit_payment también convierte el pago de una tarjeta con presupuesto (budget_category_id): un pago
-- registrado en la categoría de la tarjeta (a mano, desde Presupuestos o Vencimientos) o un aviso del banco que la
-- menciona pasa a ser la transferencia a la tarjeta. Así baja la deuda, su vencimiento queda pagado y el presupuesto
-- cuenta la parte que cubre la deuda que ya traía. Sin intereses aparte (ya vienen en el extracto).
-- La tarjeta puede ser tuya o estar a tu cargo (accounts.responsible_user_id).
-- Se puede correr más de una vez.

create or replace function public.apply_credit_payment(p jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hh uuid := my_household_id();
  v_tx_id uuid := nullif(p->>'transaction_id', '')::uuid;
  v_credit_id uuid := nullif(p->>'credit_id', '')::uuid;
  v_charges bigint := greatest(0, coalesce((p->>'charges')::bigint, 0));
  v_t transactions;
  v_c accounts;
  v_in_category boolean;
begin
  if v_uid is null or v_hh is null then raise exception 'Necesitas iniciar sesión'; end if;

  select * into v_t from transactions
   where id = v_tx_id and household_id = v_hh and payer_user_id = v_uid and created_by = v_uid
   for update;
  if not found then raise exception 'Ese movimiento no existe'; end if;
  -- Ya convertido (o es otra cosa): no se toca
  if not (v_t.kind in ('EXPENSE', 'DEBT_PAYMENT') or (v_t.kind = 'TRANSFER' and v_t.to_account_id is null)) then
    return null;
  end if;

  -- Créditos propios; tarjetas propias o a tu cargo
  select * into v_c from accounts
   where id = v_credit_id and household_id = v_hh and budget_category_id is not null and not archived
     and ((kind in ('CREDIT', 'LOAN') and owner_user_id = v_uid)
          or (kind = 'CREDIT_CARD' and (owner_user_id = v_uid or responsible_user_id = v_uid)));
  if not found then raise exception 'Ese crédito o tarjeta no tiene presupuesto'; end if;
  -- Tarjeta: los intereses ya vienen en el extracto, todo el pago va a la tarjeta
  if v_c.kind = 'CREDIT_CARD' then v_charges := 0; end if;

  -- Toda la plata del movimiento está en la categoría del crédito
  v_in_category := v_t.kind in ('EXPENSE', 'DEBT_PAYMENT')
    and exists (select 1 from transaction_splits where transaction_id = v_t.id)
    and not exists (select 1 from transaction_splits where transaction_id = v_t.id
                     and category_id is distinct from v_c.budget_category_id);
  if (v_t.source = 'MANUAL' or v_t.scheduled_payment_id is not null) and not v_in_category then
    raise exception 'Solo se cruzan pagos que llegaron automáticamente o que están en la categoría del crédito o la tarjeta';
  end if;

  if not exists (select 1 from accounts where id = v_t.account_id and owner_user_id = v_uid
                  and kind in ('DEPOSIT', 'WALLET', 'CASH')) then
    raise exception 'El pago debe salir de una de tus cuentas';
  end if;

  -- Esa cuota ya se pagó: hay otra transferencia al crédito en esas fechas
  if exists (select 1 from transactions
              where household_id = v_hh and kind = 'TRANSFER' and to_account_id = v_credit_id and id <> v_t.id
                and abs(occurred_on - v_t.occurred_on) <= 20) then
    return null;
  end if;

  if v_charges >= v_t.amount then raise exception 'Los intereses y seguros no pueden ser toda la cuota'; end if;

  -- El movimiento conserva su monto (así no se duplica si el aviso llega otra vez) y pasa a ser el pago al crédito.
  -- El enlace con el vencimiento se conserva: el vencimiento sigue pagado.
  delete from cross_ledger where transaction_id = v_t.id;
  delete from transaction_splits where transaction_id = v_t.id;
  update transactions
     set kind = 'TRANSFER',
         to_account_id = v_credit_id,
         status = 'CONFIRMED',
         scope = 'HOUSEHOLD',
         creates_debt = false,
         income_category_id = null,
         installments = 1,
         description = coalesce(description, case when v_c.kind = 'CREDIT_CARD' then 'Pago ' else 'Cuota ' end || v_c.name),
         updated_by = v_uid
   where id = v_t.id;

  -- Intereses y seguros: gasto cargado al crédito (sube la deuda en lo que no fue capital)
  if v_charges > 0 then
    perform save_transaction(jsonb_build_object(
      'kind', 'EXPENSE', 'scope', 'HOUSEHOLD', 'amount', v_charges, 'occurred_on', v_t.occurred_on,
      'description', 'Cuota ' || v_c.name || ' · intereses y seguros', 'account_id', v_credit_id, 'tags', '[]'::jsonb,
      'splits', jsonb_build_array(jsonb_build_object(
        'amount', v_charges, 'category_id', v_c.budget_category_id, 'responsible_user_id', v_uid, 'origin', 'NORMAL'))));
  end if;

  return v_t.id;
end;
$$;

revoke all on function public.apply_credit_payment(jsonb) from public, anon;
grant execute on function public.apply_credit_payment(jsonb) to authenticated;
