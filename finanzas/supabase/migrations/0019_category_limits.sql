-- 0019 · Las categorías no deciden nada: solo dicen en qué se gastó o de dónde vino la plata.
--  · Todas las categorías son del hogar: las ven y las usan los dos (también las de ingresos).
--  · Si algo es del hogar o personal, y quién lo asume, se define en el presupuesto (y en cada movimiento):
--    category_limits = presupuesto de una categoría, del hogar (con responsable: 100 % de una persona o
--    montos fijos) o personal (de su dueño, solo él lo ve). Una categoría puede tener uno del hogar
--    y uno personal por persona. Los montos por periodo siguen en category_budgets (ahora por limit_id).
-- Lo que ya existía se conserva:
--  · límite con progreso compartido, de montos fijos u obligación del hogar → presupuesto del hogar
--  · límite 100 % de una persona sin progreso compartido → presupuesto personal de esa persona
--  · categoría personal con límite → presupuesto personal de su dueño
--  · Un presupuesto personal (de categoría o con nombre) se puede compartir con la pareja
--    (shared_with_partner): ella ve el límite y cuánto lleva su dueño, sin ver los movimientos
--    (los totales salen de shared_personal_spending()). Solo su dueño lo edita.
-- Se puede correr más de una vez.

-- ---------------------------------------------------------------
-- Presupuestos de categoría
-- ---------------------------------------------------------------
create table if not exists public.category_limits (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  scope text not null check (scope in ('HOUSEHOLD', 'PERSONAL')),
  -- Personal: su dueño. Del hogar: null.
  owner_user_id uuid references auth.users (id) on delete cascade,
  -- Del hogar: quién lo asume. Personal: null (lo asume su dueño).
  responsibility text check (responsibility in ('MEMBER_A_100', 'MEMBER_B_100', 'FIXED_AMOUNTS')),
  is_household_obligation boolean not null default false,
  rollover_enabled boolean not null default false,
  -- Personal: compartirlo con la pareja (ve el límite y el avance, no los movimientos)
  shared_with_partner boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope = 'PERSONAL' and owner_user_id is not null and responsibility is null and not is_household_obligation)
    or (scope = 'HOUSEHOLD' and owner_user_id is null and responsibility is not null)
  )
);
alter table public.category_limits add column if not exists shared_with_partner boolean not null default false;
alter table public.budget_plans add column if not exists shared_with_partner boolean not null default false;
update public.category_limits set shared_with_partner = false where scope = 'HOUSEHOLD' and shared_with_partner;
update public.budget_plans set shared_with_partner = false where scope = 'HOUSEHOLD' and shared_with_partner;

create unique index if not exists category_limits_household_uq on public.category_limits (category_id) where scope = 'HOUSEHOLD';
create unique index if not exists category_limits_personal_uq on public.category_limits (category_id, owner_user_id) where scope = 'PERSONAL';
create index if not exists category_limits_household_idx on public.category_limits (household_id);

alter table public.category_budgets add column if not exists limit_id uuid references public.category_limits (id) on delete cascade;

-- Pasar los límites que ya existen (una sola vez: solo categorías con montos sin limit_id)
do $$
declare
  r record;
  v_limit uuid;
  v_scope text;
  v_owner uuid;
begin
  for r in
    select c.* from public.categories c
     where exists (select 1 from public.category_budgets b where b.category_id = c.id and b.limit_id is null)
  loop
    if r.responsibility = 'PRIVATE' then
      v_scope := 'PERSONAL'; v_owner := r.owner_user_id;
    elsif r.is_shared_progress or r.responsibility = 'FIXED_AMOUNTS' or r.is_household_obligation then
      v_scope := 'HOUSEHOLD'; v_owner := null;
    else
      v_scope := 'PERSONAL';
      v_owner := public.slot_user(r.household_id, case r.responsibility when 'MEMBER_A_100' then 'A' else 'B' end);
    end if;
    if v_owner is null and v_scope = 'PERSONAL' then
      -- La persona de ese lado aún no está en el hogar: queda del hogar
      v_scope := 'HOUSEHOLD';
    end if;

    insert into public.category_limits (household_id, category_id, scope, owner_user_id, responsibility,
                                        is_household_obligation, rollover_enabled)
    values (r.household_id, r.id, v_scope, case when v_scope = 'PERSONAL' then v_owner end,
            case when v_scope = 'HOUSEHOLD' then (case when r.responsibility = 'PRIVATE' then 'FIXED_AMOUNTS' else r.responsibility end) end,
            v_scope = 'HOUSEHOLD' and r.is_household_obligation, r.rollover_enabled)
    returning id into v_limit;

    update public.category_budgets set limit_id = v_limit where category_id = r.id and limit_id is null;
  end loop;
end $$;

alter table public.category_budgets alter column limit_id set not null;
alter table public.category_budgets drop constraint if exists category_budgets_category_id_valid_from_key;
create unique index if not exists category_budgets_limit_valid_uq on public.category_budgets (limit_id, valid_from);
create index if not exists category_budgets_limit_idx on public.category_budgets (limit_id);

-- Las categorías quedan del hogar y sin responsable (las columnas viejas se dejan, sin uso)
update public.categories
   set responsibility = 'FIXED_AMOUNTS', owner_user_id = null,
       is_household_obligation = false, is_shared_progress = false, rollover_enabled = false
 where responsibility <> 'FIXED_AMOUNTS' or owner_user_id is not null
    or is_household_obligation or is_shared_progress or rollover_enabled;

-- ---------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------
-- Ver: del hogar, propio o personal compartido. Editar: del hogar o propio.
create or replace function public.can_see_limit(p_limit_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from category_limits l
    join household_members m on m.household_id = l.household_id and m.user_id = auth.uid()
    where l.id = p_limit_id and (l.scope = 'HOUSEHOLD' or l.owner_user_id = auth.uid() or l.shared_with_partner)
  )
$$;

create or replace function public.can_edit_limit(p_limit_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from category_limits l
    join household_members m on m.household_id = l.household_id and m.user_id = auth.uid()
    where l.id = p_limit_id and (l.scope = 'HOUSEHOLD' or l.owner_user_id = auth.uid())
  )
$$;

create or replace function public.can_see_plan(p_plan_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from budget_plans b
    join household_members m on m.household_id = b.household_id and m.user_id = auth.uid()
    where b.id = p_plan_id and (b.scope = 'HOUSEHOLD' or b.owner_user_id = auth.uid() or b.shared_with_partner)
  )
$$;

create or replace function public.can_edit_plan(p_plan_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from budget_plans b
    join household_members m on m.household_id = b.household_id and m.user_id = auth.uid()
    where b.id = p_plan_id and (b.scope = 'HOUSEHOLD' or b.owner_user_id = auth.uid())
  )
$$;

-- Lo que lleva gastado la pareja en sus presupuestos personales compartidos conmigo:
-- totales por categoría y día de los movimientos personales a su cargo (sin detalle de los movimientos),
-- solo en las categorías (y subcategorías) de esos presupuestos.
create or replace function public.shared_personal_spending()
returns table (owner_user_id uuid, category_id uuid, occurred_on date, total bigint)
language sql stable security definer set search_path = public
as $$
  with shared as (
    select l.owner_user_id, l.category_id from category_limits l
     where l.household_id = my_household_id() and l.scope = 'PERSONAL' and l.shared_with_partner
       and l.owner_user_id <> auth.uid()
    union
    select b.owner_user_id, pc.category_id from budget_plans b
      join budget_plan_categories pc on pc.plan_id = b.id
     where b.household_id = my_household_id() and b.scope = 'PERSONAL' and b.shared_with_partner
       and b.owner_user_id <> auth.uid()
  ),
  cats as (
    select s.owner_user_id, c.id as category_id from shared s
      join categories c on c.id = s.category_id or c.parent_id = s.category_id
  )
  -- Solo lo que la persona no puede abrir (lo que sí ve ya lo suma la app): así cada parte cuenta una vez
  select sp.responsible_user_id, sp.category_id, t.occurred_on,
         sum(case when t.kind = 'REFUND' then -sp.amount else sp.amount end)::bigint
    from transactions t
    join transaction_splits sp on sp.transaction_id = t.id
    join (select distinct * from cats) k on k.category_id = sp.category_id and k.owner_user_id = sp.responsible_user_id
   where t.household_id = my_household_id()
     and t.scope = 'PERSONAL'
     and t.kind in ('EXPENSE', 'DEBT_PAYMENT', 'REFUND')
     and not can_see_transaction(t.id)
   group by sp.responsible_user_id, sp.category_id, t.occurred_on
$$;

-- Todas las categorías del hogar se ven
create or replace function public.can_see_category(p_category_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from categories c
    join household_members m on m.household_id = c.household_id and m.user_id = auth.uid()
    where c.id = p_category_id
  )
$$;

alter table public.category_limits enable row level security;
revoke all on public.category_limits from anon;
drop policy if exists "ver presupuestos de categoría" on public.category_limits;
create policy "ver presupuestos de categoría" on public.category_limits for select to authenticated
  using (public.can_see_limit(id));

drop policy if exists "ver presupuestos" on public.category_budgets;
create policy "ver presupuestos" on public.category_budgets for select to authenticated
  using (public.can_see_limit(limit_id));

drop trigger if exists category_limits_updated_at on public.category_limits;
create trigger category_limits_updated_at before update on public.category_limits
  for each row execute function public.set_updated_at();

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                  and schemaname = 'public' and tablename = 'category_limits') then
    alter publication supabase_realtime add table public.category_limits;
  end if;
end $$;

-- ---------------------------------------------------------------
-- Categorías: nombre, ícono, principal y tipo (gasto o ingreso). Nada más.
-- p = { id?, kind, parent_id?, name, icon }
-- ---------------------------------------------------------------
create or replace function public.save_category(p jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_hh uuid := my_household_id();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_kind text := coalesce(nullif(p->>'kind', ''), 'EXPENSE');
  v_parent uuid := nullif(p->>'parent_id', '')::uuid;
  v_par categories;
begin
  if v_hh is null then raise exception 'No perteneces a un hogar'; end if;
  if v_kind not in ('EXPENSE', 'INCOME') then raise exception 'Tipo de categoría no válido'; end if;
  if v_id is not null then
    if not exists (select 1 from categories where id = v_id and household_id = v_hh) then
      raise exception 'Esa categoría no existe';
    end if;
    select kind into v_kind from categories where id = v_id;
  end if;

  if v_parent is not null then
    select * into v_par from categories where id = v_parent and household_id = v_hh;
    if not found then raise exception 'La categoría principal no existe'; end if;
    if v_par.parent_id is not null then raise exception 'Una subcategoría no puede tener subcategorías'; end if;
    if v_par.kind <> v_kind then raise exception 'La categoría principal debe ser del mismo tipo'; end if;
    if v_id is not null and (v_parent = v_id or exists (select 1 from categories where parent_id = v_id)) then
      raise exception 'Esta categoría tiene subcategorías: no puede quedar dentro de otra';
    end if;
  end if;

  if v_id is null then
    insert into categories (household_id, name, icon, responsibility, kind, parent_id)
    values (v_hh, trim(p->>'name'), nullif(p->>'icon', ''), 'FIXED_AMOUNTS', v_kind, v_parent)
    returning id into v_id;
  else
    update categories
       set name = trim(p->>'name'), icon = nullif(p->>'icon', ''), parent_id = v_parent
     where id = v_id and household_id = v_hh;
  end if;
  return v_id;
end;
$$;

create or replace function public.archive_category(p_id uuid, p_archived boolean default true)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update categories set archived = p_archived where id = p_id and household_id = my_household_id();
  if not found then raise exception 'Esa categoría no existe'; end if;
end;
$$;

-- ---------------------------------------------------------------
-- Presupuesto de una categoría
-- p = { id?, category_id, scope, responsibility, is_household_obligation, rollover_enabled,
--       budget: { valid_from, amount, fixed_amount_a, fixed_amount_b } }
-- Del hogar: lo editan los dos. Personal: solo su dueño (y solo él lo ve).
-- ---------------------------------------------------------------
create or replace function public.save_category_limit(p jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hh uuid := my_household_id();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_cat uuid := nullif(p->>'category_id', '')::uuid;
  v_scope text := coalesce(nullif(p->>'scope', ''), 'HOUSEHOLD');
  v_resp text := nullif(p->>'responsibility', '');
  v_obligation boolean := coalesce((p->>'is_household_obligation')::boolean, false);
  v_rollover boolean := coalesce((p->>'rollover_enabled')::boolean, false);
  v_shared boolean := coalesce((p->>'shared_with_partner')::boolean, false);
  v_budget jsonb := p->'budget';
  v_old category_limits;
  v_a bigint;
  v_b bigint;
  v_amount bigint;
begin
  if v_hh is null then raise exception 'No perteneces a un hogar'; end if;
  if v_scope not in ('HOUSEHOLD', 'PERSONAL') then raise exception 'Ámbito no válido'; end if;

  if v_id is not null then
    select * into v_old from category_limits where id = v_id and household_id = v_hh for update;
    if not found or not can_see_limit(v_id) then raise exception 'Ese presupuesto no existe'; end if;
    if not can_edit_limit(v_id) then raise exception 'Solo su dueño puede editar un presupuesto personal'; end if;
    v_cat := v_old.category_id;
    v_scope := v_old.scope; -- el ámbito de un presupuesto no cambia (se crea otro)
  end if;
  if not exists (select 1 from categories where id = v_cat and household_id = v_hh and kind = 'EXPENSE') then
    raise exception 'Categoría no válida';
  end if;

  if v_scope = 'HOUSEHOLD' then
    if v_resp is null or v_resp not in ('MEMBER_A_100', 'MEMBER_B_100', 'FIXED_AMOUNTS') then
      raise exception 'Elige quién asume el presupuesto';
    end if;
    v_shared := false;
  else
    v_resp := null;
    v_obligation := false;
  end if;

  if v_id is null then
    if v_scope = 'HOUSEHOLD' and exists (select 1 from category_limits where category_id = v_cat and scope = 'HOUSEHOLD') then
      raise exception 'Esa categoría ya tiene presupuesto del hogar';
    end if;
    if v_scope = 'PERSONAL' and exists (select 1 from category_limits where category_id = v_cat and scope = 'PERSONAL' and owner_user_id = v_uid) then
      raise exception 'Ya tienes un presupuesto personal en esa categoría';
    end if;
    insert into category_limits (household_id, category_id, scope, owner_user_id, responsibility, is_household_obligation,
                                 rollover_enabled, shared_with_partner)
    values (v_hh, v_cat, v_scope, case when v_scope = 'PERSONAL' then v_uid end, v_resp, v_obligation, v_rollover, v_shared)
    returning id into v_id;
  else
    update category_limits
       set responsibility = v_resp, is_household_obligation = v_obligation, rollover_enabled = v_rollover,
           shared_with_partner = v_shared
     where id = v_id;
  end if;

  if v_budget is not null then
    if v_resp = 'FIXED_AMOUNTS' then
      v_a := coalesce((v_budget->>'fixed_amount_a')::bigint, 0);
      v_b := coalesce((v_budget->>'fixed_amount_b')::bigint, 0);
      v_amount := v_a + v_b;
    else
      v_a := null;
      v_b := null;
      v_amount := coalesce((v_budget->>'amount')::bigint, 0);
    end if;
    insert into category_budgets (category_id, household_id, limit_id, valid_from, amount, fixed_amount_a, fixed_amount_b)
    values (v_cat, v_hh, v_id, (v_budget->>'valid_from')::date, v_amount, v_a, v_b)
    on conflict (limit_id, valid_from)
    do update set amount = excluded.amount,
                  fixed_amount_a = excluded.fixed_amount_a,
                  fixed_amount_b = excluded.fixed_amount_b;
  end if;
  return v_id;
end;
$$;

create or replace function public.delete_category_limit(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not can_edit_limit(p_id) then raise exception 'Ese presupuesto no existe'; end if;
  delete from category_limits where id = p_id;
end;
$$;

-- ---------------------------------------------------------------
-- Movimientos: cualquier categoría sirve en lo personal y en el hogar; si no se dice
-- quién asume una parte, la asume quien pagó.
-- ---------------------------------------------------------------
do $$
declare v_src text;
begin
  -- save_transaction: quitar las reglas de categorías privadas y el responsable por categoría
  select pg_get_functiondef('public.save_transaction(jsonb)'::regprocedure) into v_src;
  v_src := replace(v_src, $r$        if v_resp is null then v_resp := category_responsible(v_cat_id); end if;
        if v_cat.responsibility = 'PRIVATE' then
          if v_scope = 'HOUSEHOLD' then
            raise exception 'La categoría "%" es personal: úsala en un movimiento personal', v_cat.name;
          end if;
          if v_resp <> v_cat.owner_user_id then
            raise exception 'Una categoría privada solo puede quedar a cargo de su dueño';
          end if;
        end if;
$r$, '');
  v_src := replace(v_src, $r$      if exists (select 1 from transaction_splits s where s.transaction_id = v_id
                  and s.category_id is not null and not can_see_category(s.category_id)) then
        raise exception 'Este movimiento tiene partes privadas; solo quien lo registró puede editarlo';
      end if;
$r$, '');
  v_src := replace(v_src, $r$      and (responsibility <> 'PRIVATE' or owner_user_id = v_uid)
$r$, '');
  if position('category_responsible' in v_src) > 0 or position('es personal' in v_src) > 0
     or position('partes privadas' in v_src) > 0 or position('responsibility <> ''PRIVATE''' in v_src) > 0 then
    raise exception 'save_transaction no tiene la forma esperada (¿falta la migración 0017?)';
  end if;
  execute v_src;
end $$;

create or replace function public.set_split_category(p_split_id uuid, p_category_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_split transaction_splits;
begin
  select * into v_split from transaction_splits where id = p_split_id and household_id = my_household_id();
  if not found then raise exception 'Ese desglose no existe'; end if;
  if v_split.responsible_user_id <> auth.uid() then
    raise exception 'Solo el responsable puede cambiar la categoría de su parte';
  end if;
  if p_category_id is not null and not exists (
    select 1 from categories where id = p_category_id and household_id = v_split.household_id and kind = 'EXPENSE'
  ) then
    raise exception 'Categoría no válida';
  end if;
  update transaction_splits set category_id = p_category_id where id = p_split_id;
end;
$$;

-- Captura automática: cualquier categoría activa del hogar sirve
create or replace function public.m_valid_category(p_category uuid, p_hh uuid, p_uid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from categories c where c.id = p_category and c.household_id = p_hh and not c.archived)
$$;

-- Ejecutado por categoría: solo de movimientos que la persona puede ver
create or replace function public.category_daily_spending(p_from date, p_to date)
returns table (category_id uuid, responsible_user_id uuid, occurred_on date, total bigint)
language sql stable security definer set search_path = public
as $$
  select s.category_id, s.responsible_user_id, t.occurred_on,
         sum(case when t.kind = 'REFUND' then -s.amount else s.amount end)::bigint
  from transaction_splits s
  join transactions t on t.id = s.transaction_id
  where t.household_id = my_household_id()
    and t.kind in ('EXPENSE', 'DEBT_PAYMENT', 'REFUND')
    and t.occurred_on between p_from and p_to
    and s.category_id is not null
    and can_see_transaction(t.id)
  group by s.category_id, s.responsible_user_id, t.occurred_on
$$;

-- Presupuestos con nombre: cualquier categoría de gasto sirve; un personal se puede compartir
-- p = { id?, scope, name, icon, periodicity, amount, start_date, end_date, alert_pct, status,
--       shared_with_partner, categories: [{ category_id, amount? }] }
create or replace function public.save_budget_plan(p jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hh uuid := my_household_id();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_scope text := coalesce(nullif(p->>'scope', ''), 'HOUSEHOLD');
  v_shared boolean := coalesce((p->>'shared_with_partner')::boolean, false);
  v_old budget_plans;
  v_owner uuid := v_uid;
  v_item jsonb;
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
    if not can_edit_plan(v_id) then raise exception 'Solo su dueño puede editar un presupuesto personal'; end if;
    -- Solo su dueño puede volver personal un presupuesto del hogar (y sigue siendo de él)
    v_owner := v_old.owner_user_id;
    if v_scope = 'PERSONAL' and v_owner <> v_uid then
      raise exception 'Solo quien creó el presupuesto puede volverlo personal';
    end if;
  end if;
  if v_scope = 'HOUSEHOLD' then v_shared := false; end if;

  if v_id is null then
    insert into budget_plans (household_id, scope, owner_user_id, name, icon, periodicity, amount, start_date, end_date,
                              alert_pct, status, shared_with_partner)
    values (v_hh, v_scope, v_owner, trim(p->>'name'), nullif(p->>'icon', ''),
            coalesce(nullif(p->>'periodicity', ''), 'PERIOD'), coalesce((p->>'amount')::bigint, 0),
            coalesce(nullif(p->>'start_date', '')::date, today_bogota()), nullif(p->>'end_date', '')::date,
            coalesce((p->>'alert_pct')::smallint, 85), coalesce(nullif(p->>'status', ''), 'ACTIVE'), v_shared)
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
           status = coalesce(nullif(p->>'status', ''), 'ACTIVE'),
           shared_with_partner = v_shared
     where id = v_id;
    delete from budget_plan_categories where plan_id = v_id;
  end if;

  for v_item in select * from jsonb_array_elements(p->'categories')
  loop
    v_cat_id := nullif(v_item->>'category_id', '')::uuid;
    if not exists (select 1 from categories where id = v_cat_id and household_id = v_hh and kind = 'EXPENSE') then
      raise exception 'Categoría no válida';
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
  if not can_edit_plan(p_id) then raise exception 'Ese presupuesto no existe'; end if;
  delete from budget_plans where id = p_id;
end;
$$;

-- Categorías sugeridas: todas del hogar (también las de ingresos)
do $$
declare v_src text;
begin
  select pg_get_functiondef('public.add_suggested_categories()'::regprocedure) into v_src;
  v_src := replace(v_src, $r$values (v_hh, v_group->>'name', v_group->>'icon', 'FIXED_AMOUNTS', true, 'EXPENSE')$r$,
                          $r$values (v_hh, v_group->>'name', v_group->>'icon', 'FIXED_AMOUNTS', false, 'EXPENSE')$r$);
  v_src := replace(v_src, $r$values (v_hh, v_child, 'FIXED_AMOUNTS', true, 'EXPENSE', v_parent)$r$,
                          $r$values (v_hh, v_child, 'FIXED_AMOUNTS', false, 'EXPENSE', v_parent)$r$);
  v_src := replace(v_src, $r$      insert into categories (household_id, name, responsibility, owner_user_id, kind)
      values (v_hh, v_child, 'PRIVATE', v_uid, 'INCOME');$r$,
                          $r$      insert into categories (household_id, name, responsibility, kind)
      values (v_hh, v_child, 'FIXED_AMOUNTS', 'INCOME');$r$);
  if position('''PRIVATE''' in v_src) > 0 or position(', true, ''EXPENSE''' in v_src) > 0 then
    raise exception 'add_suggested_categories no tiene la forma esperada (¿falta la migración 0017?)';
  end if;
  execute v_src;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'can_see_limit(uuid)', 'can_edit_limit(uuid)', 'can_see_plan(uuid)', 'can_edit_plan(uuid)',
    'shared_personal_spending()', 'delete_budget_plan(uuid)', 'can_see_category(uuid)', 'save_category(jsonb)', 'archive_category(uuid, boolean)',
    'save_category_limit(jsonb)', 'delete_category_limit(uuid)', 'save_transaction(jsonb)',
    'set_split_category(uuid, uuid)', 'category_daily_spending(date, date)', 'save_budget_plan(jsonb)',
    'add_suggested_categories()'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.m_valid_category(uuid, uuid, uuid) from public, anon, authenticated;
