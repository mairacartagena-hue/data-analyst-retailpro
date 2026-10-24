-- 0010 · Unir un movimiento que llegó automáticamente con el que la persona ya había registrado a mano.
-- Se conserva el registrado a mano (con su categoría y responsable) y se actualiza con el monto y la fecha reales.

create or replace function public.merge_pending_into(p_pending uuid, p_target uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_p transactions;
  v_t transactions;
  v_split_id uuid;
  v_n int;
begin
  select * into v_p from transactions
   where id = p_pending and payer_user_id = v_uid and status = 'PENDING_REVIEW' and household_id = my_household_id();
  if not found then raise exception 'Ese movimiento pendiente no existe'; end if;
  select * into v_t from transactions
   where id = p_target and created_by = v_uid and household_id = v_p.household_id and kind = v_p.kind and id <> v_p.id;
  if not found then raise exception 'El movimiento registrado a mano no existe'; end if;

  if v_t.kind = 'EXPENSE' then
    select count(*) into v_n from transaction_splits where transaction_id = v_t.id;
    if v_n <> 1 then raise exception 'El movimiento registrado a mano está dividido en partes; corrígelo editándolo.'; end if;
    update transaction_splits set amount = v_p.amount where transaction_id = v_t.id returning id into v_split_id;
    update cross_ledger set amount = v_p.amount where split_id = v_split_id;
  end if;

  update transactions
     set amount = v_p.amount,
         occurred_on = v_p.occurred_on,
         occurred_at = coalesce(v_p.occurred_at, occurred_at),
         account_id = coalesce(v_p.account_id, account_id),
         merchant = coalesce(merchant, v_p.merchant),
         merchant_norm = coalesce(merchant_norm, v_p.merchant_norm),
         card_last4 = coalesce(card_last4, v_p.card_last4),
         movement_type = coalesce(movement_type, v_p.movement_type),
         tags = array(select distinct unnest(tags || v_p.tags)),
         ingest_identifiers = ingest_identifiers || v_p.ingest_identifiers
   where id = v_t.id;

  update ingest_logs set transaction_id = v_t.id where transaction_id = v_p.id;
  delete from transactions where id = v_p.id;

  -- La próxima vez este comercio se sugiere con la misma categoría
  perform remember_merchant(v_t.id, false);
end;
$$;

revoke all on function public.merge_pending_into(uuid, uuid) from public, anon;
grant execute on function public.merge_pending_into(uuid, uuid) to authenticated;
