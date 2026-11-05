-- 0058 · Pagar el total de una compra a cuotas de la tarjeta antes de tiempo.
--
-- El pago es una transferencia a la tarjeta (baja la deuda) que guarda qué compra salda en
-- transactions.pays_off_id: el id de la compra a cuotas registrada (transactions) o de la compra
-- del extracto (card_statement_items). Desde la fecha del pago esa compra ya no tiene cuotas
-- pendientes: no se proyecta, no se aparta en el Saldo Seguro y su presupuesto cuenta lo que
-- faltaba en el mes del pago. Si se borra el pago, la compra vuelve a quedar con sus cuotas.
-- Se puede volver a correr sin problema.

alter table public.transactions add column if not exists pays_off_id uuid;

create index if not exists transactions_pays_off_idx
  on public.transactions (pays_off_id) where pays_off_id is not null;

-- Marca una transferencia a la tarjeta como el pago total de una compra a cuotas de esa tarjeta.
-- Solo quien registró el pago, y si es dueño o responsable de la tarjeta.
create or replace function public.mark_card_payoff(p_transfer uuid, p_purchase uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hh uuid := my_household_id();
  v_t transactions;
  v_card accounts;
begin
  if v_uid is null or v_hh is null then raise exception 'Necesitas iniciar sesión'; end if;

  select * into v_t from transactions
   where id = p_transfer and household_id = v_hh and created_by = v_uid and kind = 'TRANSFER'
   for update;
  if not found then raise exception 'Ese pago no existe'; end if;

  select * into v_card from accounts
   where id = v_t.to_account_id and household_id = v_hh and kind = 'CREDIT_CARD'
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
