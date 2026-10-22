-- A Medias · resto de la instalación (migraciones 0003 a 0007)
-- Proyecto: qrciymjmmpfremtjaiof. Las migraciones 0001 y 0002 ya están aplicadas.
-- Pega TODO este archivo en Supabase → SQL Editor → Run. Corre en una sola transacción.

begin;


-- ===================== 0003_hogar =====================
-- 0003 · Hogar: crear, unirse con código, regenerar código, salir, colores

create or replace function public.gen_invite_code()
returns text
language plpgsql
volatile
as $$
declare
  alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- sin 0/O ni 1/I
  codigo text;
begin
  loop
    codigo := '';
    for i in 1..8 loop
      codigo := codigo || substr(alfabeto, 1 + floor(random() * length(alfabeto))::int, 1);
    end loop;
    exit when not exists (select 1 from public.households where codigo_invitacion = codigo);
  end loop;
  return codigo;
end;
$$;

-- Crea el hogar, la primera persona (rosa) y las 3 listas de compras.
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
  values (v_hh, 'Mercado'), (v_hh, 'Droguería'), (v_hh, 'Para la casa');

  return v_hh;
end;
$$;

-- El invitado aún no es miembro (RLS no lo deja leer), por eso la unión
-- se hace aquí con SECURITY DEFINER. Máximo 2 personas por hogar.
create or replace function public.join_household(p_codigo text, p_nombre text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hh uuid;
  v_total int;
  v_color text;
  v_nombre text;
begin
  if v_uid is null then
    raise exception 'Necesitas iniciar sesión';
  end if;

  select id into v_hh
  from households
  where codigo_invitacion = upper(trim(p_codigo))
  for update;

  if v_hh is null then
    raise exception 'Ese código no existe. Pídele a tu pareja el link de nuevo.';
  end if;

  if exists (select 1 from members where user_id = v_uid and household_id = v_hh) then
    return v_hh; -- ya era miembro
  end if;
  if exists (select 1 from members where user_id = v_uid) then
    raise exception 'Ya perteneces a otro hogar. Sal de ese hogar en Ajustes para unirte a este.';
  end if;

  select count(*) into v_total from members where household_id = v_hh;
  if v_total >= 2 then
    raise exception 'Este hogar ya tiene dos personas';
  end if;

  select c into v_color
  from unnest(array['rosa', 'bordo']) as c
  where c not in (select color from members where household_id = v_hh)
  limit 1;

  v_nombre := coalesce(
    nullif(trim(p_nombre), ''),
    (select split_part(email, '@', 1) from auth.users where id = v_uid),
    'Persona 2'
  );

  insert into members (household_id, user_id, nombre, color)
  values (v_hh, v_uid, v_nombre, v_color);

  -- las tareas que rotan ahora incluyen a la nueva persona
  perform generate_occurrences(v_hh);

  return v_hh;
end;
$$;

create or replace function public.regenerate_invite_code(p_household_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_codigo text;
begin
  if not is_member(p_household_id) then
    raise exception 'No perteneces a este hogar';
  end if;
  v_codigo := gen_invite_code();
  update households set codigo_invitacion = v_codigo where id = p_household_id;
  return v_codigo;
end;
$$;

-- Cambia el color de una persona; si la otra lo tenía, se intercambian.
create or replace function public.set_member_color(p_member_id uuid, p_color text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hh uuid;
  v_actual text;
begin
  if p_color not in ('rosa', 'bordo') then
    raise exception 'Color no válido';
  end if;
  select household_id, color into v_hh, v_actual from members where id = p_member_id;
  if v_hh is null or not is_member(v_hh) then
    raise exception 'No perteneces a este hogar';
  end if;
  if v_actual = p_color then
    return;
  end if;
  update members set color = v_actual where household_id = v_hh and color = p_color;
  update members set color = p_color where id = p_member_id;
end;
$$;

-- Sale del hogar. Si no queda nadie, se borra el hogar con todos sus datos.
create or replace function public.leave_household()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member members%rowtype;
begin
  select * into v_member from members where user_id = auth.uid();
  if not found then
    return;
  end if;

  delete from push_subscriptions where user_id = auth.uid();
  delete from members where id = v_member.id;

  if not exists (select 1 from members where household_id = v_member.household_id) then
    delete from households where id = v_member.household_id;
    return;
  end if;

  update tasks
  set orden_rotacion = array_remove(orden_rotacion, v_member.id)
  where household_id = v_member.household_id;

  perform generate_occurrences(v_member.household_id);
end;
$$;

revoke all on function public.create_household(text, text) from public, anon;
revoke all on function public.join_household(text, text) from public, anon;
revoke all on function public.regenerate_invite_code(uuid) from public, anon;
revoke all on function public.set_member_color(uuid, text) from public, anon;
revoke all on function public.leave_household() from public, anon;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.join_household(text, text) to authenticated;
grant execute on function public.regenerate_invite_code(uuid) to authenticated;
grant execute on function public.set_member_color(uuid, text) to authenticated;
grant execute on function public.leave_household() to authenticated;
revoke all on function public.gen_invite_code() from public, anon, authenticated;

-- ===================== 0004_ocurrencias =====================
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

-- ===================== 0005_despensa_y_avisos =====================
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

-- ===================== 0006_realtime =====================
-- 0006 · Realtime en todas las tablas de datos
-- Los cambios llegan al otro celular al instante. Realtime respeta RLS.

do $$
declare t text;
begin
  foreach t in array array[
    'households','members','pets','tasks','task_occurrences','shopping_lists',
    'pantry_products','shopping_items','reminders','pet_events','notes',
    'suggestion_dismissals'
  ] loop
    execute format('alter table public.%I replica identity full', t);
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ===================== Extensiones y Vault =====================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- URL del proyecto (no es secreta)
select vault.create_secret('https://qrciymjmmpfremtjaiof.supabase.co', 'project_url')
where not exists (select 1 from vault.secrets where name = 'project_url');

-- Secreto del cron: se genera aquí mismo, al azar, y no sale de tu base de datos
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'push_cron_secret')
where not exists (select 1 from vault.secrets where name = 'push_cron_secret');

-- ===================== 0007_cron =====================
-- 0007 · Tareas programadas con pg_cron + pg_net
-- Antes de correr esta migración, activa pg_cron y pg_net (Database > Extensions)
-- y guarda en Vault la URL del proyecto y el secreto del cron (ver README):
--   select vault.create_secret('https://TU-PROYECTO.supabase.co', 'project_url');
--   select vault.create_secret('UN-SECRETO-LARGO', 'push_cron_secret');


-- Todos los días a las 00:05 de Bogotá (05:05 UTC):
-- termina tratamientos vencidos, genera 4 semanas de turnos y revisa la despensa.
select cron.schedule(
  'a-medias-diario',
  '5 5 * * *',
  $$ select public.daily_maintenance(); $$
);

-- Cada 5 minutos: la Edge Function send-push envía lo que toca.
select cron.schedule(
  'a-medias-push',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);

-- Primer relleno de turnos (por si ya hay datos)
select public.daily_maintenance();

commit;

-- Copia este valor: es PUSH_CRON_SECRET para la Edge Function send-push
select decrypted_secret as push_cron_secret from vault.decrypted_secrets where name = 'push_cron_secret';
