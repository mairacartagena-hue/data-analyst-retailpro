-- 0015 · Lista "Mascotas" en Compras (comida y arena). Sus productos avisan a esa lista, no a Mercado.

alter table public.shopping_lists drop constraint if exists shopping_lists_nombre_check;
alter table public.shopping_lists add constraint shopping_lists_nombre_check
  check (nombre in ('Mercado', 'Droguería', 'Para la casa', 'Mascotas'));

insert into public.shopping_lists (household_id, nombre)
select id, 'Mascotas' from public.households
on conflict (household_id, nombre) do nothing;

alter table public.pantry_products add column if not exists es_mascotas boolean not null default false;
update public.pantry_products set es_mascotas = true where pet_id is not null;

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
  values (v_hh, 'Mercado'), (v_hh, 'Droguería'), (v_hh, 'Para la casa'), (v_hh, 'Mascotas');

  return v_hh;
end;
$$;

create or replace function public.sync_pantry(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not is_member(p_household_id) then
    raise exception 'No perteneces a este hogar';
  end if;

  insert into shopping_items (list_id, household_id, nombre, categoria, cantidad, es_automatico, pantry_product_id)
  select l.id, p.household_id, p.nombre, p.categoria, '1', true, p.id
  from pantry_products p
  join shopping_lists l on l.household_id = p.household_id
                       and l.nombre = case when p.es_mascotas then 'Mascotas' else 'Mercado' end
  where p.household_id = p_household_id
    and (p.duracion_dias - (hoy_bogota() - p.fecha_ultima_compra))::numeric <= p.duracion_dias * 0.2
    and not exists (
      select 1 from shopping_items i
      where not i.comprado
        and i.household_id = p.household_id
        and (i.pantry_product_id = p.id or lower(trim(i.nombre)) = lower(trim(p.nombre)))
    )
  on conflict do nothing;
end;
$$;
