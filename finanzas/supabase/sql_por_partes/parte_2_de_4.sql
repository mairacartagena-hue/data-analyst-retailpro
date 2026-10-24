-- Finanzas en Pareja · parte 2 de 4. Pegar completo en SQL Editor → Run. Correr en orden: 1, 2, 3, 4.

-- ---------------------------------------------------------------
-- Hogar
-- ---------------------------------------------------------------
create or replace function public.gen_invite_code()
returns text
language plpgsql volatile
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.households where invite_code = code);
  end loop;
  return code;
end;
$$;

create or replace function public.create_household(p_household_name text, p_display_name text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hh uuid;
begin
  if v_uid is null then raise exception 'Necesitas iniciar sesión'; end if;
  if exists (select 1 from household_members where user_id = v_uid) then
    raise exception 'Ya perteneces a un hogar';
  end if;

  insert into households (name, invite_code)
  values (coalesce(nullif(trim(p_household_name), ''), 'Nuestro hogar'), gen_invite_code())
  returning id into v_hh;

  insert into household_members (household_id, user_id, slot, display_name, color)
  values (v_hh, v_uid, 'A', coalesce(nullif(trim(p_display_name), ''), 'Persona 1'), '#6b7a3a');

  insert into period_settings (household_id) values (v_hh);
  return v_hh;
end;
$$;

create or replace function public.join_household(p_code text, p_display_name text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hh uuid;
begin
  if v_uid is null then raise exception 'Necesitas iniciar sesión'; end if;
  if exists (select 1 from household_members where user_id = v_uid) then
    raise exception 'Ya perteneces a un hogar';
  end if;

  select id into v_hh from households where invite_code = upper(trim(p_code)) for update;
  if v_hh is null then raise exception 'Ese código no existe. Pídele a tu pareja el código de nuevo.'; end if;
  if (select count(*) from household_members where household_id = v_hh) >= 2 then
    raise exception 'Ese hogar ya tiene dos miembros';
  end if;

  insert into household_members (household_id, user_id, slot, display_name, color)
  values (v_hh, v_uid,
          case when exists (select 1 from household_members where household_id = v_hh and slot = 'A') then 'B' else 'A' end,
          coalesce(nullif(trim(p_display_name), ''), 'Persona 2'), '#a0703f');
  return v_hh;
end;
$$;

create or replace function public.regenerate_invite_code()
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_hh uuid := my_household_id();
  v_code text := gen_invite_code();
begin
  if v_hh is null then raise exception 'No perteneces a un hogar'; end if;
  update households set invite_code = v_code where id = v_hh;
  return v_code;
end;
$$;

create or replace function public.update_my_profile(p_display_name text, p_color text, p_avatar text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update household_members
     set display_name = trim(p_display_name),
         color = p_color,
         avatar = nullif(trim(coalesce(p_avatar, '')), '')
   where user_id = auth.uid();
  if not found then raise exception 'No perteneces a un hogar'; end if;
end;
$$;

-- ---------------------------------------------------------------
-- Categorías y presupuesto
-- p = { id?, name, icon, responsibility, is_household_obligation, is_shared_progress,
--       rollover_enabled, budget: { valid_from, amount, fixed_amount_a, fixed_amount_b } }
-- ---------------------------------------------------------------
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
  v_a bigint;
  v_b bigint;
  v_amount bigint;
begin
  if v_hh is null then raise exception 'No perteneces a un hogar'; end if;
  if v_resp not in ('MEMBER_A_100', 'MEMBER_B_100', 'FIXED_AMOUNTS', 'PRIVATE') then
    raise exception 'Tipo de responsabilidad no válido';
  end if;

  if v_id is not null and not can_see_category(v_id) then
    raise exception 'Esa categoría no existe';
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
                            is_household_obligation, is_shared_progress, rollover_enabled)
    values (v_hh, trim(p->>'name'), nullif(p->>'icon', ''), v_resp, v_owner,
            v_obligation, v_shared, coalesce((p->>'rollover_enabled')::boolean, false))
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

create or replace function public.archive_category(p_id uuid, p_archived boolean default true)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not can_see_category(p_id) then raise exception 'Esa categoría no existe'; end if;
  update categories set archived = p_archived where id = p_id;
end;
$$;

