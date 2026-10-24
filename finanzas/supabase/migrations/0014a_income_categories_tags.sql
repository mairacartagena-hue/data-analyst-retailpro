-- 0014 · Categorías de ingresos y suscripciones
--  · categories.kind: EXPENSE (presupuesto) o INCOME (de dónde viene la plata; personales, sin presupuesto)
--  · transactions.income_category_id: categoría de un ingreso
--  · tag_transactions(): agregar o quitar una etiqueta (ej. #suscripcion) a movimientos propios

alter table public.categories add column if not exists kind text not null default 'EXPENSE'
  check (kind in ('EXPENSE', 'INCOME'));
alter table public.transactions add column if not exists income_category_id uuid
  references public.categories (id) on delete set null;

create or replace function public.save_category(p jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hh uuid := my_household_id();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_resp text := p->>'responsibility';
  v_owner uuid;
  v_obligation boolean := coalesce((p->>'is_household_obligation')::boolean, false);
  v_shared boolean := coalesce((p->>'is_shared_progress')::boolean, false);
  v_budget jsonb := p->'budget';
  v_kind text := coalesce(nullif(p->>'kind', ''), 'EXPENSE');
  v_a bigint;
  v_b bigint;
  v_amount bigint;
begin
  if v_hh is null then raise exception 'No perteneces a un hogar'; end if;
  if v_resp not in ('MEMBER_A_100', 'MEMBER_B_100', 'FIXED_AMOUNTS', 'PRIVATE') then
    raise exception 'Tipo de responsabilidad no válido';
  end if;

  if v_kind not in ('EXPENSE', 'INCOME') then raise exception 'Tipo de categoría no válido'; end if;

  if v_id is not null and not can_see_category(v_id) then
    raise exception 'Esa categoría no existe';
  end if;
  if v_id is not null then
    select kind into v_kind from categories where id = v_id;
  end if;

  -- Categorías de ingresos: personales y sin presupuesto
  if v_kind = 'INCOME' then
    v_resp := 'PRIVATE';
    v_budget := null;
  end if;

  -- Quien no ve el progreso de una categoría no puede volverla compartida,
  -- reasignarla ni cambiarle el presupuesto (así no se salta la privacidad).
  if v_id is not null and not can_see_budget(v_id) then
    select responsibility, is_shared_progress into v_resp, v_shared from categories where id = v_id;
    v_budget := null;
  end if;

  if v_resp = 'PRIVATE' then
    v_owner := v_uid;
    v_obligation := false;
    v_shared := false;
    if v_id is not null and exists (
      select 1 from categories where id = v_id and responsibility = 'PRIVATE' and owner_user_id <> v_uid
    ) then
      raise exception 'Solo su dueño puede editar una categoría privada';
    end if;
  end if;

  if v_id is null then
    insert into categories (household_id, name, icon, responsibility, owner_user_id,
                            is_household_obligation, is_shared_progress, rollover_enabled, kind)
    values (v_hh, trim(p->>'name'), nullif(p->>'icon', ''), v_resp, v_owner,
            v_obligation, v_shared, coalesce((p->>'rollover_enabled')::boolean, false) and v_kind = 'EXPENSE', v_kind)
    returning id into v_id;
  else
    update categories
       set name = trim(p->>'name'),
           icon = nullif(p->>'icon', ''),
           responsibility = v_resp,
           owner_user_id = v_owner,
           is_household_obligation = v_obligation,
           is_shared_progress = v_shared,
           rollover_enabled = coalesce((p->>'rollover_enabled')::boolean, false)
     where id = v_id and household_id = v_hh;
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
    insert into category_budgets (category_id, household_id, valid_from, amount, fixed_amount_a, fixed_amount_b)
    values (v_id, v_hh, (v_budget->>'valid_from')::date, v_amount, v_a, v_b)
    on conflict (category_id, valid_from)
    do update set amount = excluded.amount,
                  fixed_amount_a = excluded.fixed_amount_a,
                  fixed_amount_b = excluded.fixed_amount_b;
  end if;

  return v_id;
end;
$$;

create or replace function public.tag_transactions(p_ids uuid[], p_tag text, p_add boolean default true)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_n int;
  v_tag text := lower(trim(p_tag));
begin
  if v_tag !~ '^#[a-z0-9_]{2,30}$' then raise exception 'Etiqueta no válida'; end if;
  update transactions
     set tags = case when p_add then array(select distinct unnest(tags || array[v_tag]))
                     else array_remove(tags, v_tag) end
   where id = any (p_ids) and household_id = my_household_id()
     and (created_by = auth.uid() or payer_user_id = auth.uid());
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.tag_transactions(uuid[], text, boolean) from public, anon;
grant execute on function public.tag_transactions(uuid[], text, boolean) to authenticated;
