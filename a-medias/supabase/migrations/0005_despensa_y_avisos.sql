-- 0005 · Despensa automática y cálculo de notificaciones pendientes

-- ---------------------------------------------------------------
-- Despensa
-- días restantes = duracion_dias - (hoy - fecha_ultima_compra)
-- Con 20% o menos, se agrega a la lista Mercado como AUTO (sin duplicar).
-- ---------------------------------------------------------------
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

-- Al marcar comprado: se actualiza la fecha de última compra del producto.
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

-- ---------------------------------------------------------------
-- Siguiente repetición de una fecha (mensual / anual) a partir de p_desde
-- ---------------------------------------------------------------
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

-- ---------------------------------------------------------------
-- Notificaciones que tocan ahora (la Edge Function la llama cada 5 min).
-- Ventana: (ahora - p_ventana, ahora]. push_log evita repetir.
-- ---------------------------------------------------------------
create or replace function public.due_notifications(p_ventana interval default interval '20 minutes')
returns table (key text, user_id uuid, title text, body text, url text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ahora timestamptz := now();
  v_desde timestamptz := now() - p_ventana;
begin
  return query
  -- Tareas del día a su hora de recordatorio y tomas de medicamentos a su hora
  select
    'occ:' || o.id || ':' || m.user_id,
    m.user_id,
    case when t.tipo = 'medicamento' then 'Toma de ' || coalesce(p.nombre, 'tu mascota')
         else t.titulo end,
    case when t.tipo = 'medicamento'
         then t.titulo || coalesce(' ' || t.dosis, '') || ' · ' || to_char(o.hora, 'FMHH24:MI')
         when o.responsable_id is null then 'Les toca juntos hoy'
         else 'Te toca hoy' end,
    case when t.tipo = 'medicamento' then '/mascotas/' || t.pet_id else '/' end
  from task_occurrences o
  join tasks t on t.id = o.task_id
  left join pets p on p.id = t.pet_id
  join members m on m.household_id = o.household_id
               and (o.responsable_id is null or m.id = o.responsable_id)
  where t.activa
    and not o.completada
    and (t.tipo = 'medicamento' or t.hora_recordatorio is not null)
    and o.fecha between (v_desde at time zone 'America/Bogota')::date and (v_ahora at time zone 'America/Bogota')::date
    and ((o.fecha + o.hora) at time zone 'America/Bogota') > v_desde
    and ((o.fecha + o.hora) at time zone 'America/Bogota') <= v_ahora

  union all

  -- Recordatorios: a su hora y con su aviso previo
  select
    'rem:' || r.id || ':' || k.tipo || ':' || extract(epoch from k.instancia)::bigint || ':' || m.user_id,
    m.user_id,
    r.titulo,
    case when k.tipo = 'hora' then coalesce(nullif(r.nota, ''), 'Es ahora')
         else 'En ' || r.aviso_previo_dias || case when r.aviso_previo_dias = 1 then ' día' else ' días' end
              || ' · ' || to_char(k.instancia at time zone 'America/Bogota', 'DD/MM FMHH24:MI') end,
    '/recordar'
  from reminders r
  cross join lateral (
    select 'hora'::text as tipo, next_instance(r.fecha_hora, r.repeticion, v_desde) as instancia, interval '0' as antes
    union all
    select 'aviso', next_instance(r.fecha_hora, r.repeticion, v_desde + make_interval(days => r.aviso_previo_dias)),
           make_interval(days => r.aviso_previo_dias)
    where r.aviso_previo_dias > 0
  ) k
  join members m on m.household_id = r.household_id
               and (coalesce(array_length(r.responsables, 1), 0) = 0 or m.id = any(r.responsables))
  where k.instancia - k.antes > v_desde
    and k.instancia - k.antes <= v_ahora

  union all

  -- Vacunas y controles: a las 8:00 del día y con su aviso previo
  select
    'pet:' || e.id || ':' || k.tipo || ':' || extract(epoch from k.instancia)::bigint || ':' || m.user_id,
    m.user_id,
    pt.nombre || ' · ' || e.titulo,
    case when k.tipo = 'hora' then 'Es hoy'
         else 'En ' || e.aviso_previo_dias || case when e.aviso_previo_dias = 1 then ' día' else ' días' end end,
    '/mascotas/' || e.pet_id
  from pet_events e
  join pets pt on pt.id = e.pet_id
  cross join lateral (
    select ((e.fecha + time '08:00') at time zone 'America/Bogota') as base
  ) b
  cross join lateral (
    select 'hora'::text as tipo, next_instance(b.base, e.repeticion, v_desde) as instancia, interval '0' as antes
    union all
    select 'aviso', next_instance(b.base, e.repeticion, v_desde + make_interval(days => e.aviso_previo_dias)),
           make_interval(days => e.aviso_previo_dias)
    where e.aviso_previo_dias > 0
  ) k
  join members m on m.household_id = e.household_id
               and (e.responsable_id is null or m.id = e.responsable_id)
  where k.instancia - k.antes > v_desde
    and k.instancia - k.antes <= v_ahora;
end;
$$;

-- Mantenimiento diario (pg_cron)
create or replace function public.daily_maintenance()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  perform finish_expired_treatments();
  perform generate_all_occurrences();
  for r in select id from households loop
    perform sync_pantry(r.id);
  end loop;
  delete from push_log where sent_at < now() - interval '7 days';
end;
$$;

revoke all on function public.sync_pantry(uuid) from public, anon;
grant execute on function public.sync_pantry(uuid) to authenticated;
revoke all on function public.due_notifications(interval) from public, anon, authenticated;
grant execute on function public.due_notifications(interval) to service_role;
revoke all on function public.daily_maintenance() from public, anon, authenticated;
