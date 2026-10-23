begin;
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
    where f >= v_hoy
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
create or replace function public.generate_task_occurrences(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t tasks%rowtype;
  v_hoy date := hoy_bogota();
begin
  select * into t from tasks where id = p_task_id;
  if not found then
    return;
  end if;
  if not t.activa then
    delete from task_occurrences
    where task_id = t.id and fecha >= v_hoy and not completada;
    return;
  end if;
  if to_regclass('pg_temp._deseadas') is null then
    create temporary table _deseadas (fecha date, hora time, responsable_id uuid) on commit drop;
  else
    truncate _deseadas;
  end if;
  insert into _deseadas select * from task_desired_occurrences(t.id);
  delete from task_occurrences o
  where o.task_id = t.id
    and not o.completada
    and o.fecha >= v_hoy
    and coalesce(o.fecha_original, o.fecha) >= v_hoy
    and not exists (
      select 1 from _deseadas d
      where d.fecha = coalesce(o.fecha_original, o.fecha) and d.hora = o.hora
    );
  update task_occurrences o
  set responsable_id = d.responsable_id
  from _deseadas d
  where o.task_id = t.id
    and not o.completada
    and not o.responsable_manual
    and o.fecha >= v_hoy
    and d.fecha = coalesce(o.fecha_original, o.fecha)
    and d.hora = o.hora
    and o.responsable_id is distinct from d.responsable_id;
  insert into task_occurrences (task_id, household_id, fecha, hora, responsable_id)
  select t.id, t.household_id, d.fecha, d.hora, d.responsable_id
  from _deseadas d
  where not exists (
    select 1 from task_occurrences o
    where o.task_id = t.id
      and o.hora = d.hora
      and (o.fecha = d.fecha or o.fecha_original = d.fecha)
  )
  on conflict (task_id, fecha, hora) do nothing;
end;
$$;
create or replace function public.generate_occurrences(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  for r in select id from tasks where household_id = p_household_id loop
    perform generate_task_occurrences(r.id);
  end loop;
end;
$$;
create or replace function public.generate_all_occurrences()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  for r in select id from households loop
    perform generate_occurrences(r.id);
  end loop;
end;
$$;
create or replace function public.tasks_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform generate_task_occurrences(new.id);
  return null;
end;
$$;
create trigger tasks_generar after insert or update on public.tasks
  for each row execute function public.tasks_after_change();
create or replace function public.occurrence_before_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.completada and not old.completada then
    new.completada_en := coalesce(new.completada_en, now());
    if new.completada_por is null then
      select id into new.completada_por
      from members where user_id = auth.uid() and household_id = new.household_id;
    end if;
  elsif not new.completada and old.completada then
    new.completada_en := null;
    new.completada_por := null;
  end if;
  return new;
end;
$$;
create trigger task_occurrences_completar before update on public.task_occurrences
  for each row execute function public.occurrence_before_update();
create or replace function public.occurrence_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare t tasks%rowtype;
begin
  if new.completada is not distinct from old.completada then
    return null;
  end if;
  select * into t from tasks where id = new.task_id;
  if t.tipo <> 'medicamento' or t.fecha_fin is null then
    return null;
  end if;
  if new.completada and t.activa and new.fecha >= t.fecha_fin
     and not exists (
       select 1 from task_occurrences
       where task_id = t.id and fecha = t.fecha_fin and not completada
     ) then
    update tasks set activa = false where id = t.id;
  elsif not new.completada and not t.activa and t.fecha_fin >= hoy_bogota() then
    update tasks set activa = true where id = t.id;
  end if;
  return null;
end;
$$;
create trigger task_occurrences_terminar after update on public.task_occurrences
  for each row execute function public.occurrence_after_update();
create or replace function public.finish_expired_treatments()
returns void
language sql
security definer
set search_path = public
as $$
  update tasks set activa = false
  where tipo = 'medicamento' and activa and fecha_fin is not null and fecha_fin < hoy_bogota();
$$;
commit;
