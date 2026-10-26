-- 0032 · Responsable de una tarjeta de crédito o de un crédito.
--
-- accounts.responsible_user_id: quién paga la tarjeta o el crédito (vacío = el dueño de la cuenta). El Saldo Seguro de esa
-- persona aparta la cuota y la deuda; el del otro no.
-- Para que el responsable pueda calcularlo ve lo que necesita de esa cuenta:
--  · los movimientos pagados con ella o que le llegan (can_see_transaction),
--  · las compras del extracto cargadas en la tarjeta (card_statement_items).
-- La cuenta tiene que estar compartida (no privada) para que el responsable la vea; la app lo exige al elegirlo.
-- Solo aplica a tarjetas de crédito, créditos y préstamos, y el responsable debe ser parte del hogar.
-- Se puede volver a correr sin problema.

alter table public.accounts add column if not exists responsible_user_id uuid;

create or replace function public.accounts_check_responsible()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.kind not in ('CREDIT_CARD', 'CREDIT', 'LOAN') then
    new.responsible_user_id := null;
  elsif new.responsible_user_id is not null and not exists (
    select 1 from household_members m where m.household_id = new.household_id and m.user_id = new.responsible_user_id
  ) then
    raise exception 'El responsable debe ser parte del hogar';
  end if;
  return new;
end;
$$;

create or replace trigger accounts_check_responsible
  before insert or update of responsible_user_id, kind on public.accounts
  for each row execute function public.accounts_check_responsible();

-- El responsable de una tarjeta o crédito ve los movimientos de esa cuenta
create or replace function public.can_see_transaction(p_transaction_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from transactions t
    join household_members m on m.household_id = t.household_id and m.user_id = auth.uid()
    where t.id = p_transaction_id
      and (
        t.scope = 'HOUSEHOLD'
        or t.payer_user_id = auth.uid()
        or t.created_by = auth.uid()
        or t.counterparty_user_id = auth.uid()
        or exists (select 1 from transaction_splits s
                   where s.transaction_id = t.id and s.responsible_user_id = auth.uid())
        or exists (select 1 from accounts a
                   where a.household_id = t.household_id and a.responsible_user_id = auth.uid()
                     and (a.id = t.account_id or a.id = t.to_account_id))
      )
  )
$$;
revoke all on function public.can_see_transaction(uuid) from public, anon;
grant execute on function public.can_see_transaction(uuid) to authenticated;

-- Y las compras del extracto de la tarjeta de la que es responsable
do $$ begin
  create policy card_statement_items_responsible_read on public.card_statement_items
    for select to authenticated
    using (exists (select 1 from public.accounts a where a.id = account_id and a.responsible_user_id = auth.uid()));
exception when duplicate_object then null; end $$;
