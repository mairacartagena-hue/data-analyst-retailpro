begin;
create or replace function public.change_turn(p_occurrence_id uuid, p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o task_occurrences%rowtype;
  t tasks%rowtype;
begin
  select * into o from task_occurrences where id = p_occurrence_id;
  if not found or not is_member(o.household_id) then
    raise exception 'No encontramos esa tarea';
  end if;
  if o.completada then
    raise exception 'Esa tarea ya está hecha';
  end if;
  if p_member_id is not null and not exists (
    select 1 from members where id = p_member_id and household_id = o.household_id
  ) then
    raise exception 'Esa persona no es de este hogar';
  end if;
  select * into t from tasks where id = o.task_id;
  if t.modo = 'rota' and p_member_id is not null and o.fecha >= hoy_bogota() then
    update tasks
    set rotacion_ancla = coalesce(o.fecha_original, o.fecha),
        rotacion_ancla_miembro = p_member_id
    where id = t.id;
  else
    update task_occurrences
    set responsable_id = p_member_id, responsable_manual = true
    where id = o.id;
  end if;
end;
$$;
create or replace function public.move_occurrence(p_occurrence_id uuid, p_fecha date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o task_occurrences%rowtype;
  v_tipo text;
begin
  select * into o from task_occurrences where id = p_occurrence_id;
  if not found or not is_member(o.household_id) then
    raise exception 'No encontramos esa tarea';
  end if;
  select tipo into v_tipo from tasks where id = o.task_id;
  if v_tipo = 'medicamento' then
    raise exception 'Los medicamentos no se mueven de día';
  end if;
  if o.completada then
    raise exception 'Esa tarea ya está hecha';
  end if;
  if p_fecha < hoy_bogota() then
    raise exception 'No se puede mover a un día que ya pasó';
  end if;
  if exists (
    select 1 from task_occurrences
    where task_id = o.task_id and fecha = p_fecha and hora = o.hora and id <> o.id
  ) then
    raise exception 'Esa tarea ya está programada ese día';
  end if;
  update task_occurrences
  set fecha_original = coalesce(fecha_original, fecha),
      fecha = p_fecha
  where id = o.id;
end;
$$;
revoke all on function public.task_desired_occurrences(uuid) from public, anon, authenticated;
revoke all on function public.generate_task_occurrences(uuid) from public, anon, authenticated;
revoke all on function public.generate_occurrences(uuid) from public, anon, authenticated;
revoke all on function public.generate_all_occurrences() from public, anon, authenticated;
revoke all on function public.finish_expired_treatments() from public, anon, authenticated;
revoke all on function public.change_turn(uuid, uuid) from public, anon;
revoke all on function public.move_occurrence(uuid, date) from public, anon;
grant execute on function public.change_turn(uuid, uuid) to authenticated;
grant execute on function public.move_occurrence(uuid, date) to authenticated;
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
  join shopping_lists l on l.household_id = p.household_id and l.nombre = 'Mercado'
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
create or replace function public.pantry_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform sync_pantry(new.household_id);
  return null;
end;
$$;
create trigger pantry_sync after insert or update on public.pantry_products
  for each row execute function public.pantry_after_change();
create or replace function public.item_after_bought()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.comprado and not coalesce(old.comprado, false) then
    update pantry_products
    set fecha_ultima_compra = hoy_bogota()
    where household_id = new.household_id
      and (id = new.pantry_product_id or lower(trim(nombre)) = lower(trim(new.nombre)))
      and fecha_ultima_compra is distinct from hoy_bogota();
  end if;
  return null;
end;
$$;
create trigger shopping_items_comprado after update of comprado on public.shopping_items
  for each row execute function public.item_after_bought();
create or replace function public.item_before_bought()
returns trigger
language plpgsql
as $$
begin
  if new.comprado and not coalesce(old.comprado, false) then
    new.comprado_en := now();
  elsif not new.comprado then
    new.comprado_en := null;
  end if;
  return new;
end;
$$;
create trigger shopping_items_comprado_en before update of comprado on public.shopping_items
  for each row execute function public.item_before_bought();
create or replace function public.next_instance(p_base timestamptz, p_rep text, p_desde timestamptz)
returns timestamptz
language plpgsql
stable
as $$
declare
  n int := 0;
  v timestamptz := p_base;
  local timestamp := p_base at time zone 'America/Bogota';
begin
  if p_rep = 'ninguna' or p_base >= p_desde then
    return p_base;
  end if;
  loop
    n := n + 1;
    v := (local + case when p_rep = 'mensual' then n * interval '1 month'
                       else n * interval '1 year' end) at time zone 'America/Bogota';
    exit when v >= p_desde or n > 2400;
  end loop;
  return v;
end;
$$;
commit;
