-- Medicamentos: si la fecha de inicio es anterior a hoy, también se crean
-- las tomas de esos días pasados (para poder marcarlas). Las tareas del hogar
-- siguen generándose solo desde hoy.

create or replace function public.task_desired_occurrences(p_task_id uuid)
returns table (fecha date, hora time, responsable_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t tasks%rowtype;
  v_hoy date := hoy_bogota();
  v_fin date := hoy_bogota() + 27;
  v_todos uuid[];
  v_orden uuid[];
  v_n int;
  v_pos_ancla int;
  v_ancla date;
begin
  select * into t from tasks where id = p_task_id;
  if not found or not t.activa then
    return;
  end if;

  select coalesce(array_agg(m.id order by m.created_at), '{}')
  into v_todos
  from members m
  where m.household_id = t.household_id;

  -- orden de rotación: el guardado (solo miembros actuales) + los que falten
  v_orden := array(
      select x from unnest(t.orden_rotacion) with ordinality u(x, i)
      where x = any(v_todos) order by i
    ) || array(
      select x from unnest(v_todos) with ordinality u(x, i)
      where not (x = any(t.orden_rotacion)) order by i
    );
  v_n := coalesce(array_length(v_orden, 1), 0);

  v_pos_ancla := array_position(v_orden, t.rotacion_ancla_miembro);
  v_ancla := case when v_pos_ancla is not null then t.rotacion_ancla end;

  return query
  with dias as (
    select d::date as f
    from generate_series(t.fecha_inicio::timestamp, v_fin::timestamp, interval '1 day') d
    where t.fecha_fin is null or d::date <= t.fecha_fin
  ),
  programados as (
    select f
    from dias
    where case t.frecuencia
      when 'diaria' then true
      when 'semanal' then extract(isodow from f)::smallint = any(
        case when coalesce(array_length(t.dias_semana, 1), 0) = 0
          then array[extract(isodow from t.fecha_inicio)::smallint]
          else t.dias_semana end)
      when 'quincenal' then (f - t.fecha_inicio) % 14 = 0
      when 'mensual' then extract(day from f) = least(
        extract(day from t.fecha_inicio),
        extract(day from (date_trunc('month', f) + interval '1 month - 1 day')))
      else false
    end
  ),
  numerados as (
    select f,
           (v_ancla is not null and f >= v_ancla) as tras_ancla,
           row_number() over (
             partition by (v_ancla is not null and f >= v_ancla) order by f
           ) - 1 as rn
    from programados
  ),
  con_responsable as (
    select f,
      case t.modo
        when 'fija' then t.responsable_fijo
        when 'juntos' then null::uuid
        else case
          when v_n = 0 then null::uuid
          when tras_ancla then v_orden[((v_pos_ancla - 1 + rn) % v_n) + 1]
          else v_orden[(rn % v_n) + 1]
        end
      end as resp
    from numerados
    where f >= v_hoy or t.tipo = 'medicamento'
  )
  select c.f,
         h.hora,
         c.resp
  from con_responsable c
  cross join lateral (
    select unnest(
      case when t.tipo = 'medicamento' then t.horas_toma
           else array[coalesce(t.hora_recordatorio, '00:00'::time)] end
    ) as hora
  ) h;
end;
$$;

-- Crear ya las tomas pasadas de los medicamentos activos
do $$
declare r record;
begin
  for r in select id from public.tasks where tipo = 'medicamento' and activa loop
    perform public.generate_task_occurrences(r.id);
  end loop;
end;
$$;
