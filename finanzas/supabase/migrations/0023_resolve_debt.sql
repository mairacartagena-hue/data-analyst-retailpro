-- 0023 · Deudas a favor: "me la paga" o "se la perdono".
--
--  · Tipos nuevos de asiento en el cruce: PAYMENT (la pareja me pagó) y FORGIVEN (le perdoné la deuda).
--  · cross_ledger.resolves_id: a qué deuda corresponde el pago o el perdón (para mostrar cuánto queda de cada una).
--  · resolve_debt(): lo hace todo de una vez.
--      PAID     → entra la plata a mi cuenta (un ajuste de saldo: no cuenta como ingreso) y baja la deuda.
--      FORGIVEN → solo baja la deuda; no se mueve plata.
--    Solo quien tiene la deuda a favor puede resolverla, y nunca por más de lo que le deben.
--  · delete_ledger_entry(): también deshace un perdón (un pago se deshace borrando su movimiento).
-- Se puede volver a correr sin problema.

alter table public.cross_ledger drop constraint if exists cross_ledger_kind_check;
alter table public.cross_ledger add constraint cross_ledger_kind_check
  check (kind in ('CROSS_PAYMENT', 'SPLIT', 'FIXED_EXCESS', 'LOAN', 'ERRAND', 'SETTLEMENT', 'REFUND', 'PAYMENT', 'FORGIVEN'));

alter table public.cross_ledger add column if not exists resolves_id uuid references public.cross_ledger (id) on delete set null;

create or replace function public.resolve_debt(p jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hh uuid := my_household_id();
  v_mode text := p->>'mode';
  v_amount bigint := nullif(p->>'amount', '')::bigint;
  v_date date := coalesce(nullif(p->>'occurred_on', '')::date, today_bogota());
  v_note text := nullif(trim(coalesce(p->>'note', '')), '');
  v_account uuid := nullif(p->>'account_id', '')::uuid;
  v_entry uuid := nullif(p->>'entry_id', '')::uuid;
  v_partner uuid;
  v_net bigint;
  v_tx uuid;
  v_id uuid;
begin
  if v_uid is null then raise exception 'Necesitas iniciar sesión'; end if;
  if v_hh is null then raise exception 'No perteneces a un hogar'; end if;
  if v_mode not in ('PAID', 'FORGIVEN') then raise exception 'Elige si te la pagó o se la perdonas'; end if;
  if v_amount is null or v_amount <= 0 then raise exception 'El monto debe ser mayor que cero'; end if;

  select user_id into v_partner from household_members where household_id = v_hh and user_id <> v_uid limit 1;
  if v_partner is null then raise exception 'Tu pareja todavía no está en el hogar'; end if;

  select coalesce(sum(case when creditor_user_id = v_uid then amount when debtor_user_id = v_uid then -amount else 0 end), 0)
    into v_net from cross_ledger where household_id = v_hh;
  if v_net <= 0 then raise exception 'Tu pareja no te debe nada'; end if;
  if v_amount > v_net then raise exception 'Te debe % en total: no puedes resolver más', v_net; end if;

  if v_entry is not null and not exists (
    select 1 from cross_ledger where id = v_entry and household_id = v_hh and creditor_user_id = v_uid
  ) then
    raise exception 'Esa deuda no existe';
  end if;

  if v_mode = 'PAID' then
    if v_account is null then raise exception 'Elige en qué cuenta entró el pago'; end if;
    -- Ajuste de saldo hacia adentro: sube el saldo de la cuenta sin contar como ingreso del hogar
    v_tx := save_transaction(jsonb_build_object(
      'kind', 'ADJUSTMENT', 'direction', 'IN', 'amount', v_amount, 'occurred_on', v_date,
      'description', coalesce(v_note, 'Pago de deuda de tu pareja'), 'account_id', v_account));
  end if;

  insert into cross_ledger (household_id, creditor_user_id, debtor_user_id, amount, kind, transaction_id, resolves_id, description, occurred_on, created_by)
  values (v_hh, v_partner, v_uid, v_amount, case when v_mode = 'PAID' then 'PAYMENT' else 'FORGIVEN' end,
          v_tx, v_entry, v_note, v_date, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.resolve_debt(jsonb) from public, anon;
grant execute on function public.resolve_debt(jsonb) to authenticated;

create or replace function public.delete_ledger_entry(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from cross_ledger
   where id = p_id and household_id = my_household_id() and created_by = auth.uid()
     and kind in ('LOAN', 'ERRAND', 'FORGIVEN');
  if not found then
    raise exception 'Solo puedes borrar préstamos, encargos o perdones que registraste tú. Los demás se corrigen editando el movimiento.';
  end if;
end;
$$;
revoke all on function public.delete_ledger_entry(uuid) from public, anon;
grant execute on function public.delete_ledger_entry(uuid) to authenticated;
