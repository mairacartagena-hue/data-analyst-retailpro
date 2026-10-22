-- 0003 · Hogar: crear, unirse con código, regenerar código, salir, colores

create or replace function public.gen_invite_code()
returns text
language plpgsql
volatile
as $$
declare
  alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- sin 0/O ni 1/I
  codigo text;
begin
  loop
    codigo := '';
    for i in 1..8 loop
      codigo := codigo || substr(alfabeto, 1 + floor(random() * length(alfabeto))::int, 1);
    end loop;
    exit when not exists (select 1 from public.households where codigo_invitacion = codigo);
  end loop;
  return codigo;
end;
$$;

-- Crea el hogar, la primera persona (rosa) y las 3 listas de compras.
create or replace function public.create_household(p_nombre_hogar text, p_nombre text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hh uuid;
begin
  if v_uid is null then
    raise exception 'Necesitas iniciar sesión';
  end if;
  if exists (select 1 from members where user_id = v_uid) then
    raise exception 'Ya perteneces a un hogar';
  end if;

  insert into households (nombre, codigo_invitacion)
  values (coalesce(nullif(trim(p_nombre_hogar), ''), 'Nuestra casa'), gen_invite_code())
  returning id into v_hh;

  insert into members (household_id, user_id, nombre, color)
  values (v_hh, v_uid, coalesce(nullif(trim(p_nombre), ''), 'Persona 1'), 'rosa');

  insert into shopping_lists (household_id, nombre)
  values (v_hh, 'Mercado'), (v_hh, 'Droguería'), (v_hh, 'Para la casa');

  return v_hh;
end;
$$;

-- El invitado aún no es miembro (RLS no lo deja leer), por eso la unión
-- se hace aquí con SECURITY DEFINER. Máximo 2 personas por hogar.
create or replace function public.join_household(p_codigo text, p_nombre text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hh uuid;
  v_total int;
  v_color text;
  v_nombre text;
begin
  if v_uid is null then
    raise exception 'Necesitas iniciar sesión';
  end if;

  select id into v_hh
  from households
  where codigo_invitacion = upper(trim(p_codigo))
  for update;

  if v_hh is null then
    raise exception 'Ese código no existe. Pídele a tu pareja el link de nuevo.';
  end if;

  if exists (select 1 from members where user_id = v_uid and household_id = v_hh) then
    return v_hh; -- ya era miembro
  end if;
  if exists (select 1 from members where user_id = v_uid) then
    raise exception 'Ya perteneces a otro hogar. Sal de ese hogar en Ajustes para unirte a este.';
  end if;

  select count(*) into v_total from members where household_id = v_hh;
  if v_total >= 2 then
    raise exception 'Este hogar ya tiene dos personas';
  end if;

  select c into v_color
  from unnest(array['rosa', 'bordo']) as c
  where c not in (select color from members where household_id = v_hh)
  limit 1;

  v_nombre := coalesce(
    nullif(trim(p_nombre), ''),
    (select split_part(email, '@', 1) from auth.users where id = v_uid),
    'Persona 2'
  );

  insert into members (household_id, user_id, nombre, color)
  values (v_hh, v_uid, v_nombre, v_color);

  -- las tareas que rotan ahora incluyen a la nueva persona
  perform generate_occurrences(v_hh);

  return v_hh;
end;
$$;

create or replace function public.regenerate_invite_code(p_household_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_codigo text;
begin
  if not is_member(p_household_id) then
    raise exception 'No perteneces a este hogar';
  end if;
  v_codigo := gen_invite_code();
  update households set codigo_invitacion = v_codigo where id = p_household_id;
  return v_codigo;
end;
$$;

-- Cambia el color de una persona; si la otra lo tenía, se intercambian.
create or replace function public.set_member_color(p_member_id uuid, p_color text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hh uuid;
  v_actual text;
begin
  if p_color not in ('rosa', 'bordo') then
    raise exception 'Color no válido';
  end if;
  select household_id, color into v_hh, v_actual from members where id = p_member_id;
  if v_hh is null or not is_member(v_hh) then
    raise exception 'No perteneces a este hogar';
  end if;
  if v_actual = p_color then
    return;
  end if;
  update members set color = v_actual where household_id = v_hh and color = p_color;
  update members set color = p_color where id = p_member_id;
end;
$$;

-- Sale del hogar. Si no queda nadie, se borra el hogar con todos sus datos.
create or replace function public.leave_household()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member members%rowtype;
begin
  select * into v_member from members where user_id = auth.uid();
  if not found then
    return;
  end if;

  delete from push_subscriptions where user_id = auth.uid();
  delete from members where id = v_member.id;

  if not exists (select 1 from members where household_id = v_member.household_id) then
    delete from households where id = v_member.household_id;
    return;
  end if;

  update tasks
  set orden_rotacion = array_remove(orden_rotacion, v_member.id)
  where household_id = v_member.household_id;

  perform generate_occurrences(v_member.household_id);
end;
$$;

revoke all on function public.create_household(text, text) from public, anon;
revoke all on function public.join_household(text, text) from public, anon;
revoke all on function public.regenerate_invite_code(uuid) from public, anon;
revoke all on function public.set_member_color(uuid, text) from public, anon;
revoke all on function public.leave_household() from public, anon;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.join_household(text, text) to authenticated;
grant execute on function public.regenerate_invite_code(uuid) to authenticated;
grant execute on function public.set_member_color(uuid, text) to authenticated;
grant execute on function public.leave_household() to authenticated;
revoke all on function public.gen_invite_code() from public, anon, authenticated;
