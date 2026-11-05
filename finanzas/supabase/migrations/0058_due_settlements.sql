-- 0058 · Vencimientos de créditos y tarjetas pagados con un valor distinto a la cuota. Se puede correr más de una vez.
--
-- Al pagar un vencimiento con otro valor, la app pregunta qué pasó y lo guarda aquí (uno por cuenta y fecha de pago):
--  · PARTIAL: abono o pago parcial; lo que falta sigue por pagar.
--  · LOWER: la cuota era menor; el vencimiento queda pagado, la diferencia sigue en la deuda y el presupuesto se
--    ajusta a lo pagado.
--  · EXTRA_CAPITAL: se pagó de más como abono a capital; el presupuesto solo cuenta la cuota.
--  · HIGHER: la cuota era mayor; todo es cuota y el presupuesto se ajusta a lo pagado.
-- expected = cuota del vencimiento; paid = lo pagado en total para esa fecha.

create table if not exists public.due_settlements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  due_date date not null,
  mode text not null check (mode in ('PARTIAL', 'LOWER', 'EXTRA_CAPITAL', 'HIGHER')),
  expected bigint not null check (expected >= 0),
  paid bigint not null check (paid >= 0),
  payer_user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, due_date)
);

alter table public.due_settlements enable row level security;
revoke all on table public.due_settlements from anon;

-- Los dos miembros del hogar lo ven (el presupuesto del crédito es del hogar); lo registra quien paga la cuenta
drop policy if exists "ver vencimientos resueltos" on public.due_settlements;
create policy "ver vencimientos resueltos" on public.due_settlements for select to authenticated
  using (public.is_member(household_id));
drop policy if exists "resolver vencimientos" on public.due_settlements;
create policy "resolver vencimientos" on public.due_settlements for insert to authenticated
  with check (household_id = public.my_household_id() and payer_user_id = auth.uid()
    and exists (select 1 from public.accounts a where a.id = account_id and a.household_id = due_settlements.household_id
                and a.kind in ('CREDIT', 'LOAN', 'CREDIT_CARD')));
drop policy if exists "cambiar vencimientos resueltos" on public.due_settlements;
create policy "cambiar vencimientos resueltos" on public.due_settlements for update to authenticated
  using (public.is_member(household_id)) with check (household_id = public.my_household_id() and payer_user_id = auth.uid());
drop policy if exists "borrar vencimientos resueltos" on public.due_settlements;
create policy "borrar vencimientos resueltos" on public.due_settlements for delete to authenticated
  using (payer_user_id = auth.uid());
drop policy if exists "verificacion en dos pasos" on public.due_settlements;
create policy "verificacion en dos pasos" on public.due_settlements as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));

drop trigger if exists due_settlements_updated_at on public.due_settlements;
create trigger due_settlements_updated_at before update on public.due_settlements
  for each row execute function public.set_updated_at();

do $$ begin
  alter publication supabase_realtime add table public.due_settlements;
exception when duplicate_object then null;
end $$;
