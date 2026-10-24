-- 0018 · Presupuestos con nombre y metas de ahorro
--  · budget_plans: presupuesto del hogar o personal, con nombre, periodicidad (cada periodo del hogar o un rango
--    de fechas), límite, fechas de inicio y fin, alerta de consumo (%) y estado (activo, en pausa, cerrado).
--  · budget_plan_categories: categorías incluidas (una categoría principal incluye sus subcategorías)
--    y, si se quiere, un límite propio para cada una dentro del presupuesto.
--  · savings_goals / savings_contributions: metas de ahorro del hogar o personales y sus aportes.
-- Lo personal solo lo ve su dueño. Se puede correr más de una vez.

-- ---------------------------------------------------------------
-- Presupuestos
-- ---------------------------------------------------------------
create table if not exists public.budget_plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  scope text not null check (scope in ('HOUSEHOLD', 'PERSONAL')),
  owner_user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  icon text check (icon is null or length(icon) <= 8),
  periodicity text not null default 'PERIOD' check (periodicity in ('PERIOD', 'RANGE')),
  amount bigint not null check (amount >= 0),
  start_date date not null default public.today_bogota(),
  end_date date,
  alert_pct smallint not null default 85 check (alert_pct between 10 and 100),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'PAUSED', 'CLOSED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  check (periodicity <> 'RANGE' or end_date is not null)
);
create index if not exists budget_plans_household_idx on public.budget_plans (household_id);

create table if not exists public.budget_plan_categories (
  plan_id uuid not null references public.budget_plans (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  amount bigint check (amount is null or amount >= 0),
  primary key (plan_id, category_id)
);
create index if not exists budget_plan_categories_household_idx on public.budget_plan_categories (household_id);

alter table public.budget_plans enable row level security;
alter table public.budget_plan_categories enable row level security;
revoke all on public.budget_plans, public.budget_plan_categories from anon;

create or replace function public.can_see_plan(p_plan_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from budget_plans b
    join household_members m on m.household_id = b.household_id and m.user_id = auth.uid()
    where b.id = p_plan_id and (b.scope = 'HOUSEHOLD' or b.owner_user_id = auth.uid())
  )
$$;

drop policy if exists "ver presupuestos con nombre" on public.budget_plans;
create policy "ver presupuestos con nombre" on public.budget_plans for select to authenticated
  using (public.can_see_plan(id));
drop policy if exists "ver categorías de presupuestos" on public.budget_plan_categories;
create policy "ver categorías de presupuestos" on public.budget_plan_categories for select to authenticated
  using (public.can_see_plan(plan_id));

-- p = { id?, scope, name, icon, periodicity, amount, start_date, end_date, alert_pct, status,
--       categories: [{ category_id, amount? }] }
create or replace function public.save_budget_plan(p jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hh uuid := my_household_id();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_scope text := coalesce(nullif(p->>'scope', ''), 'HOUSEHOLD');
  v_old budget_plans;
  v_owner uuid := v_uid;
  v_item jsonb;
  v_cat categories;
  v_cat_id uuid;
begin
  if v_hh is null then raise exception 'No perteneces a un hogar'; end if;
  if v_scope not in ('HOUSEHOLD', 'PERSONAL') then raise exception 'Ámbito no válido'; end if;
  if jsonb_array_length(coalesce(p->'categories', '[]'::jsonb)) = 0 then
    raise exception 'Elige al menos una categoría';
  end if;

  if v_id is not null then
    select * into v_old from budget_plans where id = v_id and household_id = v_hh for update;
    if not found or not can_see_plan(v_id) then raise exception 'Ese presupuesto no existe'; end if;
    -- Solo su dueño puede volver personal un presupuesto del hogar (y sigue siendo de él)
    v_owner := v_old.owner_user_id;
    if v_scope = 'PERSONAL' and v_owner <> v_uid then
      raise exception 'Solo quien creó el presupuesto puede volverlo personal';
    end if;
  end if;

  if v_id is null then
    insert into budget_plans (household_id, scope, owner_user_id, name, icon, periodicity, amount, start_date, end_date, alert_pct, status)
    values (v_hh, v_scope, v_owner, trim(p->>'name'), nullif(p->>'icon', ''),
            coalesce(nullif(p->>'periodicity', ''), 'PERIOD'), coalesce((p->>'amount')::bigint, 0),
            coalesce(nullif(p->>'start_date', '')::date, today_bogota()), nullif(p->>'end_date', '')::date,
            coalesce((p->>'alert_pct')::smallint, 85), coalesce(nullif(p->>'status', ''), 'ACTIVE'))
    returning id into v_id;
  else
    update budget_plans
       set scope = v_scope,
           name = trim(p->>'name'),
           icon = nullif(p->>'icon', ''),
           periodicity = coalesce(nullif(p->>'periodicity', ''), 'PERIOD'),
           amount = coalesce((p->>'amount')::bigint, 0),
           start_date = coalesce(nullif(p->>'start_date', '')::date, start_date),
           end_date = nullif(p->>'end_date', '')::date,
           alert_pct = coalesce((p->>'alert_pct')::smallint, 85),
           status = coalesce(nullif(p->>'status', ''), 'ACTIVE')
     where id = v_id;
    delete from budget_plan_categories where plan_id = v_id;
  end if;

  for v_item in select * from jsonb_array_elements(p->'categories')
  loop
    v_cat_id := nullif(v_item->>'category_id', '')::uuid;
    select * into v_cat from categories where id = v_cat_id and household_id = v_hh;
    if not found or not can_see_category(v_cat_id) or v_cat.kind <> 'EXPENSE' then
      raise exception 'Categoría no válida';
    end if;
    if v_scope = 'HOUSEHOLD' and v_cat.responsibility = 'PRIVATE' then
      raise exception 'La categoría "%" es personal: no puede ir en un presupuesto del hogar', v_cat.name;
    end if;
    insert into budget_plan_categories (plan_id, category_id, household_id, amount)
    values (v_id, v_cat_id, v_hh, nullif(v_item->>'amount', '')::bigint)
    on conflict (plan_id, category_id) do update set amount = excluded.amount;
  end loop;

  return v_id;
end;
$$;

create or replace function public.delete_budget_plan(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not can_see_plan(p_id) then raise exception 'Ese presupuesto no existe'; end if;
  delete from budget_plans where id = p_id;
end;
$$;

-- ---------------------------------------------------------------
-- Metas de ahorro
-- ---------------------------------------------------------------
create table if not exists public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  scope text not null check (scope in ('HOUSEHOLD', 'PERSONAL')),
  owner_user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  icon text check (icon is null or length(icon) <= 8),
  target_amount bigint not null check (target_amount > 0),
  target_date date,
  -- Aporte que su dueño quiere apartar cada periodo (se resta de su Saldo Seguro mientras falte)
  planned_amount bigint check (planned_amount is null or planned_amount >= 0),
  account_id uuid references public.accounts (id) on delete set null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'DONE', 'ARCHIVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists savings_goals_household_idx on public.savings_goals (household_id);

create table if not exists public.savings_contributions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.savings_goals (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Positivo = aporte · negativo = retiro
  amount bigint not null check (amount <> 0),
  occurred_on date not null default public.today_bogota(),
  note text check (note is null or length(note) <= 120),
  created_at timestamptz not null default now()
);
create index if not exists savings_contributions_goal_idx on public.savings_contributions (goal_id);
create index if not exists savings_contributions_household_idx on public.savings_contributions (household_id);

alter table public.savings_goals enable row level security;
alter table public.savings_contributions enable row level security;
revoke all on public.savings_goals, public.savings_contributions from anon;

create or replace function public.can_see_goal(p_goal_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from savings_goals g
    join household_members m on m.household_id = g.household_id and m.user_id = auth.uid()
    where g.id = p_goal_id and (g.scope = 'HOUSEHOLD' or g.owner_user_id = auth.uid())
  )
$$;

drop policy if exists "ver metas" on public.savings_goals;
drop policy if exists "crear metas" on public.savings_goals;
drop policy if exists "editar metas" on public.savings_goals;
drop policy if exists "borrar metas" on public.savings_goals;
create policy "ver metas" on public.savings_goals for select to authenticated
  using (public.is_member(household_id) and (scope = 'HOUSEHOLD' or owner_user_id = auth.uid()));
create policy "crear metas" on public.savings_goals for insert to authenticated
  with check (household_id = public.my_household_id() and owner_user_id = auth.uid());
create policy "editar metas" on public.savings_goals for update to authenticated
  using (public.is_member(household_id) and (scope = 'HOUSEHOLD' or owner_user_id = auth.uid()))
  with check (household_id = public.my_household_id() and (scope = 'HOUSEHOLD' or owner_user_id = auth.uid()));
create policy "borrar metas" on public.savings_goals for delete to authenticated
  using (public.is_member(household_id) and (scope = 'HOUSEHOLD' or owner_user_id = auth.uid()));

drop policy if exists "ver aportes" on public.savings_contributions;
drop policy if exists "crear aportes" on public.savings_contributions;
drop policy if exists "borrar mis aportes" on public.savings_contributions;
create policy "ver aportes" on public.savings_contributions for select to authenticated
  using (public.can_see_goal(goal_id));
create policy "crear aportes" on public.savings_contributions for insert to authenticated
  with check (user_id = auth.uid() and household_id = public.my_household_id() and public.can_see_goal(goal_id));
create policy "borrar mis aportes" on public.savings_contributions for delete to authenticated
  using (user_id = auth.uid());

-- updated_at automático
drop trigger if exists budget_plans_updated_at on public.budget_plans;
create trigger budget_plans_updated_at before update on public.budget_plans
  for each row execute function public.set_updated_at();
drop trigger if exists savings_goals_updated_at on public.savings_goals;
create trigger savings_goals_updated_at before update on public.savings_goals
  for each row execute function public.set_updated_at();

-- Realtime
do $$
declare t text;
begin
  foreach t in array array['budget_plans', 'budget_plan_categories', 'savings_goals', 'savings_contributions']
  loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                    and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Permisos
do $$
declare f text;
begin
  foreach f in array array['can_see_plan(uuid)', 'save_budget_plan(jsonb)', 'delete_budget_plan(uuid)', 'can_see_goal(uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
