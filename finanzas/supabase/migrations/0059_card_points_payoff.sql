-- 0059 · Pagar con puntos una compra a cuotas de la tarjeta (ej. BBVA).
--
-- · accounts.points_enabled: la tarjeta permite pagar compras con puntos (muestra el botón "Con puntos").
-- · El pago con puntos es un ajuste que suma a la tarjeta (ADJUSTMENT, direction IN: baja la deuda sin que salga
--   plata de ninguna cuenta) y guarda qué compra cubre en transactions.pays_off_id, igual que el pago total (0058).
--   Desde la fecha del canje la compra ya no tiene cuotas pendientes y lo que cubrieron los puntos no cuenta en
--   ningún presupuesto. Si se borra el ajuste, la compra vuelve a sus cuotas.
-- Se puede volver a correr sin problema.

alter table public.accounts add column if not exists points_enabled boolean not null default false;

-- Marca un pago (transferencia a la tarjeta, o ajuste con puntos en la tarjeta) como el pago total de una compra
-- a cuotas de esa tarjeta. Solo quien registró el pago, y si es dueño o responsable de la tarjeta.
create or replace function public.mark_card_payoff(p_transfer uuid, p_purchase uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hh uuid := my_household_id();
  v_t transactions;
  v_card accounts;
  v_card_id uuid;
begin
  if v_uid is null or v_hh is null then raise exception 'Necesitas iniciar sesión'; end if;

  select * into v_t from transactions
   where id = p_transfer and household_id = v_hh and created_by = v_uid
     and (kind = 'TRANSFER' or (kind = 'ADJUSTMENT' and direction = 'IN'))
   for update;
  if not found then raise exception 'Ese pago no existe'; end if;

  v_card_id := case when v_t.kind = 'TRANSFER' then v_t.to_account_id else v_t.account_id end;

  select * into v_card from accounts
   where id = v_card_id and household_id = v_hh and kind = 'CREDIT_CARD'
     and (owner_user_id = v_uid or responsible_user_id = v_uid);
  if not found then raise exception 'El pago debe ir a una tarjeta de crédito tuya o de la que pagas'; end if;

  if not exists (select 1 from transactions
                  where id = p_purchase and household_id = v_hh and account_id = v_card.id and kind = 'EXPENSE')
     and not exists (select 1 from card_statement_items
                      where id = p_purchase and household_id = v_hh and account_id = v_card.id) then
    raise exception 'Esa compra no es de esta tarjeta';
  end if;

  update transactions set pays_off_id = p_purchase, updated_by = v_uid where id = p_transfer;
end;
$$;

revoke all on function public.mark_card_payoff(uuid, uuid) from public, anon;
grant execute on function public.mark_card_payoff(uuid, uuid) to authenticated;
