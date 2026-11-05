-- 0023 · Tienda en la despensa (opcional)
-- Cuando un producto de la despensa se agrega solo a la lista (AUTO), lleva su tienda.

alter table public.pantry_products
  add column if not exists tienda text;

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
  insert into shopping_items (list_id, household_id, nombre, categoria, cantidad, es_automatico, pantry_product_id, tienda)
  select l.id, p.household_id, p.nombre, p.categoria, '1', true, p.id, p.tienda
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
