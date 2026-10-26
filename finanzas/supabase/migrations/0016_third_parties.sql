-- 0016 · Plata de terceros: dinero que pasa por las cuentas pero no es de la persona
-- (ej. un familiar envía la plata y la persona hace el pago por él).
-- Esos movimientos mueven el saldo real de la cuenta, pero no cuentan como gasto ni ingreso.

create table if not exists public.third_parties (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  created_at timestamptz not null default now()
);
create index if not exists third_parties_owner_idx on public.third_parties (owner_user_id);

alter table public.third_parties enable row level security;
create policy "ver mis terceros" on public.third_parties for select to authenticated using (owner_user_id = auth.uid());
create policy "crear mis terceros" on public.third_parties for insert to authenticated
  with check (owner_user_id = auth.uid() and household_id = public.my_household_id());
create policy "editar mis terceros" on public.third_parties for update to authenticated
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

alter table public.transactions add column if not exists third_party_id uuid
  references public.third_parties (id) on delete set null;
alter table public.merchant_memory add column if not exists third_party_id uuid
  references public.third_parties (id) on delete cascade;

-- Marcar (o desmarcar con null) un movimiento propio como plata de un tercero.
-- Se quita su categoría para que no consuma presupuesto y, si se pide, se recuerda el comercio o remitente.
create or replace function public.set_third_party(p_transaction_id uuid, p_third_party_id uuid, p_remember boolean default true)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tx transactions;
  v_ident record;
begin
  select * into v_tx from transactions
   where id = p_transaction_id and household_id = my_household_id() and (created_by = v_uid or payer_user_id = v_uid);
  if not found then raise exception 'Ese movimiento no existe'; end if;
  if v_tx.kind not in ('EXPENSE', 'INCOME') then raise exception 'Solo gastos o ingresos pueden ser de un tercero'; end if;
  if p_third_party_id is not null and not exists (select 1 from third_parties where id = p_third_party_id and owner_user_id = v_uid) then
    raise exception 'Ese tercero no existe';
  end if;
  if p_third_party_id is not null and exists (select 1 from transaction_splits where transaction_id = v_tx.id and responsible_user_id <> v_uid) then
    raise exception 'Este gasto tiene una parte a cargo de tu pareja; quítala antes de marcarlo como de un tercero.';
  end if;

  update transactions
     set third_party_id = p_third_party_id,
         status = case when p_third_party_id is not null and account_id is not null then 'CONFIRMED' else status end,
         income_category_id = case when p_third_party_id is not null then null else income_category_id end
   where id = v_tx.id;
  if p_third_party_id is not null then
    update transaction_splits set category_id = null where transaction_id = v_tx.id;
  end if;

  if p_remember and p_third_party_id is not null then
    for v_ident in
      select 'MERCHANT' as type, v_tx.merchant_norm as value where v_tx.merchant_norm is not null
      union
      select upper(i->>'type'), lower(i->>'value') from jsonb_array_elements(v_tx.ingest_identifiers) i
       where upper(i->>'type') in ('NIT', 'ACCOUNT', 'PHONE') and coalesce(i->>'value', '') <> ''
    loop
      insert into merchant_memory (household_id, user_id, identifier_type, identifier, category_id, third_party_id, hits)
      values (v_tx.household_id, v_uid, v_ident.type, v_ident.value, null, p_third_party_id, 1)
      on conflict (user_id, identifier_type, identifier) do update
        set third_party_id = excluded.third_party_id, category_id = null, auto_apply = false, hits = merchant_memory.hits + 1, last_used_at = now();
    end loop;
  end if;
end;
$$;

revoke all on function public.set_third_party(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_third_party(uuid, uuid, boolean) to authenticated;

alter publication supabase_realtime add table public.third_parties;
