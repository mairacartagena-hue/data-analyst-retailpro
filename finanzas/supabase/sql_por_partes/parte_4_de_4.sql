-- Finanzas en Pareja · parte 4 de 4. Pegar completo en SQL Editor → Run. Correr en orden: 1, 2, 3, 4.

-- 0003 · Seguridad a nivel de fila (RLS). Lo que no está marcado como compartido es privado.
-- Las tablas sin política de escritura solo se modifican con las funciones de 0002.

alter table public.households         enable row level security;
alter table public.household_members  enable row level security;
alter table public.period_settings    enable row level security;
alter table public.custom_periods     enable row level security;
alter table public.accounts           enable row level security;
alter table public.categories         enable row level security;
alter table public.category_budgets   enable row level security;
alter table public.transactions       enable row level security;
alter table public.transaction_splits enable row level security;
alter table public.cross_ledger       enable row level security;
alter table public.manual_assets      enable row level security;

-- Nadie anónimo toca nada
revoke all on all tables in schema public from anon;

-- Hogar y miembros
create policy "leer mi hogar" on public.households
  for select to authenticated using (public.is_member(id));
create policy "renombrar mi hogar" on public.households
  for update to authenticated using (public.is_member(id)) with check (public.is_member(id));

create policy "leer miembros de mi hogar" on public.household_members
  for select to authenticated using (public.is_member(household_id));

-- Periodos
create policy "leer periodos" on public.period_settings
  for select to authenticated using (public.is_member(household_id));
create policy "cambiar periodos" on public.period_settings
  for update to authenticated using (public.is_member(household_id)) with check (public.is_member(household_id));

create policy "rangos personalizados" on public.custom_periods
  for all to authenticated using (public.is_member(household_id)) with check (public.is_member(household_id));

-- Cuentas: el dueño todo; la pareja solo ve las PUBLIC y BALANCE_ONLY.
-- (Los nombres de cuentas privadas que su dueño decide mostrar salen por account_labels().)
create policy "ver cuentas" on public.accounts
  for select to authenticated
  using (owner_user_id = auth.uid() or (public.is_member(household_id) and visibility <> 'PRIVATE'));
create policy "crear mis cuentas" on public.accounts
  for insert to authenticated
  with check (owner_user_id = auth.uid() and household_id = public.my_household_id());
create policy "editar mis cuentas" on public.accounts
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid() and household_id = public.my_household_id());
create policy "borrar mis cuentas" on public.accounts
  for delete to authenticated using (owner_user_id = auth.uid());

-- Categorías: las privadas solo para su dueño.
create policy "ver categorías" on public.categories
  for select to authenticated using (public.can_see_category(id));

-- Presupuesto: solo si el progreso es compartido o soy responsable.
create policy "ver presupuestos" on public.category_budgets
  for select to authenticated using (public.can_see_budget(category_id));

-- Movimientos
create policy "ver movimientos" on public.transactions
  for select to authenticated using (public.can_see_transaction(id));

-- Desgloses: los del movimiento visible, sin mostrar partes en categorías privadas ajenas.
create policy "ver desgloses" on public.transaction_splits
  for select to authenticated
  using (
    public.can_see_transaction(transaction_id)
    and (category_id is null or public.can_see_category(category_id) or responsible_user_id = auth.uid())
  );

-- Cruce: siempre involucra a los dos, ambos lo ven.
create policy "ver cruce" on public.cross_ledger
  for select to authenticated using (public.is_member(household_id));

-- Patrimonio manual
create policy "ver activos" on public.manual_assets
  for select to authenticated
  using (owner_user_id = auth.uid() or (public.is_member(household_id) and visibility = 'PUBLIC'));
create policy "crear mis activos" on public.manual_assets
  for insert to authenticated
  with check (owner_user_id = auth.uid() and household_id = public.my_household_id());
create policy "editar mis activos" on public.manual_assets
  for update to authenticated
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "borrar mis activos" on public.manual_assets
  for delete to authenticated using (owner_user_id = auth.uid());

-- Una cuenta con movimientos no se borra (se archiva): lo impide la FK on delete restrict.
