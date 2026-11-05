-- 0021 · Compras de más: los días adicionales que rinde la última compra
-- Si se compra más de lo que pedía la lista, la despensa guarda cuántos días
-- extra alcanza esa compra (sin cambiar la duración normal del producto).
-- días restantes = duracion_dias + dias_extra - (hoy - fecha_ultima_compra)
-- En la siguiente compra normal, dias_extra vuelve a 0.

alter table public.pantry_products
  add column if not exists dias_extra integer not null default 0;

alter table public.pantry_products drop constraint if exists pantry_dias_extra_no_negativo;
alter table public.pantry_products
  add constraint pantry_dias_extra_no_negativo check (dias_extra >= 0);

create or replace function public.sync_pantry(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    and (p.duracion_dias + p.dias_extra - (hoy_bogota() - p.fecha_ultima_compra))::numeric <= p.duracion_dias * 0.2
    and not exists (
      select 1 from shopping_items i
      where not i.comprado
        and i.household_id = p.household_id
        and (i.pantry_product_id = p.id or lower(trim(i.nombre)) = lower(trim(p.nombre)))
    )
  on conflict do nothing;
end;
$function$;

create or replace function public.item_after_bought()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.comprado and not coalesce(old.comprado, false) then
    update pantry_products
    set fecha_ultima_compra = hoy_bogota(),
        dias_extra = 0
    where household_id = new.household_id
      and (id = new.pantry_product_id or lower(trim(nombre)) = lower(trim(new.nombre)))
      and (fecha_ultima_compra is distinct from hoy_bogota() or dias_extra <> 0);
  end if;
  return null;
end;
$function$;
