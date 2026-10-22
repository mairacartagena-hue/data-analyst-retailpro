begin;
create or replace function public.gen_invite_code()
returns text
language plpgsql
volatile
as $$
declare
  alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
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
    return v_hh;
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
create or replace function public.tasks_normalizar()
returns trigger
language plpgsql
as $$
begin
  if new.tipo = 'medicamento' then
    new.frecuencia := 'diaria';
    if coalesce(array_length(new.horas_toma, 1), 0) = 0 then
      new.horas_toma := array['08:00'::time];
    end if;
    new.horas_toma := array(select distinct h from unnest(new.horas_toma) h order by h);
    new.fecha_fin := case
      when new.duracion_dias is not null then new.fecha_inicio + new.duracion_dias - 1
      else null
    end;
  else
    new.horas_toma := '{}';
  end if;
  return new;
end;
$$;
create trigger tasks_normalizar before insert or update on public.tasks
  for each row execute function public.tasks_normalizar();
commit;
