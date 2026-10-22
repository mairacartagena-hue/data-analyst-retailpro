-- 0004 · Ocurrencias de tareas y tomas de medicamentos
-- generate_occurrences(household_id) es idempotente: crea lo que falta de las
-- próximas 4 semanas, corrige responsables de lo futuro no completado y borra
-- lo futuro que ya no corresponde. Corre al crear/editar una tarea (trigger),
-- cuando alguien se une o sale del hogar y todos los días con pg_cron.
-- El cliente nunca la llama.

-- Normaliza tareas antes de guardar
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

-- Lo que debería existir para una tarea desde hoy hasta hoy + 27 días.
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

  -- 1. borrar lo futuro no completado que ya no corresponde
  delete from task_occurrences o
  where o.task_id = t.id
    and not o.completada
    and o.fecha >= v_hoy
    and coalesce(o.fecha_original, o.fecha) >= v_hoy
    and not exists (
      select 1 from _deseadas d
      where d.fecha = coalesce(o.fecha_original, o.fecha) and d.hora = o.hora
    );

  -- 2. reacomodar responsables solo en lo futuro no completado
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

  -- 3. crear lo que falta
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

-- Al crear o editar una tarea se regeneran sus ocurrencias
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

-- ---------------------------------------------------------------
-- Tildar / destildar una ocurrencia
-- ---------------------------------------------------------------
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

-- Si se completa la última toma del tratamiento, el medicamento termina.
-- Si alguien la destilda antes de que pase la fecha de fin, se reactiva.
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

-- Tratamientos cuya fecha de fin ya pasó (lo corre pg_cron a diario)
create or replace function public.finish_expired_treatments()
returns void
language sql
security definer
set search_path = public
as $$
  update tasks set activa = false
  where tipo = 'medicamento' and activa and fecha_fin is not null and fecha_fin < hoy_bogota();
$$;

-- ---------------------------------------------------------------
-- Cambiar un turno (RPC para el cliente)
-- En tareas que rotan, la rotación se reacomoda desde ese día solo en las
-- ocurrencias futuras no completadas. En fijas/juntos cambia solo esa.
-- ---------------------------------------------------------------
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
    where id = t.id; -- el trigger regenera y reacomoda lo futuro
  else
    update task_occurrences
    set responsable_id = p_member_id, responsable_manual = true
    where id = o.id;
  end if;
end;
$$;

-- Mover una tarea a otro día (sugerencias). Nunca medicamentos.
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
