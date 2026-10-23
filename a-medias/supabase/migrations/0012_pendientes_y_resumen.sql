-- 0012 · Pendientes de antes: se pueden omitir, y a las 21:00 llega un resumen de lo que quedó sin marcar

alter table public.task_occurrences add column if not exists omitida boolean not null default false;

-- Resumen de las 21:00 (Bogotá) por persona: cuántas tareas de hoy quedaron sin marcar
create or replace function public.due_resumen_pendientes(p_ventana interval default interval '20 minutes')
returns table (key text, user_id uuid, title text, body text, url text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ahora timestamptz := now();
  v_hoy date := (v_ahora at time zone 'America/Bogota')::date;
  v_las_nueve timestamptz := ((v_hoy + time '21:00') at time zone 'America/Bogota');
begin
  -- Solo en la ventana de las 21:00 (el cron corre cada 5 minutos)
  if not (v_las_nueve > v_ahora - p_ventana and v_las_nueve <= v_ahora) then
    return;
  end if;

  return query
  select
    'resumen:' || v_hoy || ':' || m.user_id,
    m.user_id,
    'Quedaron ' || n.cuenta || case when n.cuenta = 1 then ' cosa' else ' cosas' end || ' sin marcar hoy',
    'Revisa Hoy para marcarlas o darlas por hechas',
    '/'
  from members m
  cross join lateral (
    select count(*) as cuenta
    from task_occurrences o
    join tasks t on t.id = o.task_id
    where o.household_id = m.household_id
      and o.fecha = v_hoy
      and not o.completada
      and not o.omitida
      and t.activa
      and (o.responsable_id is null or o.responsable_id = m.id)
  ) n
  where n.cuenta > 0;
end;
$$;

revoke all on function public.due_resumen_pendientes(interval) from public, anon, authenticated;
grant execute on function public.due_resumen_pendientes(interval) to service_role;
