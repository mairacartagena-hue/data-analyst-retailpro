-- 0038 · Cuota de los créditos en Presupuestos y cruce automático del pago.
-- Un crédito puede tener una categoría con presupuesto del hogar (budget_category_id). Cuando llega
-- automáticamente (correo, SMS o notificación) un pago con el valor de su cuota, la app lo convierte en el
-- pago de ese crédito: el movimiento original pasa a ser una transferencia al crédito (baja la deuda) y los
-- intereses y seguros se cargan al crédito como gasto en su categoría. El presupuesto cuenta la cuota completa.
-- Se puede correr más de una vez.

alter table public.accounts add column if not exists budget_category_id uuid
  references public.categories (id) on delete set null;

-- p = { transaction_id, credit_id, charges }  (charges = intereses + seguros del pago)
-- Devuelve el id del movimiento si lo convirtió, o null si ya no aplica (por ejemplo, ya se había cruzado).
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
begin
  if v_uid is null or v_hh is null then raise exception 'Necesitas iniciar sesión'; end if;

  select * into v_t from transactions
   where id = v_tx_id and household_id = v_hh and payer_user_id = v_uid and created_by = v_uid
   for update;
  if not found then raise exception 'Ese movimiento no existe'; end if;
  if v_t.source = 'MANUAL' then raise exception 'Solo se cruzan pagos que llegaron automáticamente'; end if;
  -- Ya convertido (o es otra cosa): no se toca
  if not (v_t.kind in ('EXPENSE', 'DEBT_PAYMENT') or (v_t.kind = 'TRANSFER' and v_t.to_account_id is null)) then
    return null;
  end if;

  select * into v_c from accounts
   where id = v_credit_id and household_id = v_hh and owner_user_id = v_uid
     and kind in ('CREDIT', 'LOAN') and budget_category_id is not null and not archived;
  if not found then raise exception 'Ese crédito no tiene presupuesto'; end if;

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

  -- El aviso conserva su monto (así no se duplica si llega otra vez) y pasa a ser el pago al crédito
  delete from cross_ledger where transaction_id = v_t.id;
  delete from transaction_splits where transaction_id = v_t.id;
  update transactions
     set kind = 'TRANSFER',
         to_account_id = v_credit_id,
         status = 'CONFIRMED',
         scope = 'HOUSEHOLD',
         creates_debt = false,
         income_category_id = null,
         scheduled_payment_id = null,
         scheduled_for = null,
         description = coalesce(description, 'Cuota ' || v_c.name),
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
