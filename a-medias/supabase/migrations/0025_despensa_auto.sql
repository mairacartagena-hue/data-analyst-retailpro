-- 0025 · Encender o apagar AUTO en cada producto de la despensa
-- Con AUTO encendido (lo de siempre), cuando al producto le queda el 20% o menos se agrega
-- solo a la lista (Mercado o Mascotas) con la etiqueta AUTO. Apagado, no se agrega solo.

alter table public.pantry_products
  add column if not exists auto boolean not null default true;

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
    and p.auto
    and (p.duracion_dias + p.dias_extra - greatest(0, hoy_bogota() - p.fecha_ultima_compra - 1))::numeric
        <= p.duracion_dias * 0.2
    and not exists (
      select 1 from shopping_items i
      where not i.comprado
        and i.household_id = p.household_id
        and (i.pantry_product_id = p.id or lower(trim(i.nombre)) = lower(trim(p.nombre)))
    )
  on conflict do nothing;
end;
$function$;
