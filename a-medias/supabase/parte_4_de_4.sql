begin;
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
create extension if not exists pg_cron;
create extension if not exists pg_net;
select vault.create_secret('https://qrciymjmmpfremtjaiof.supabase.co', 'project_url')
where not exists (select 1 from vault.secrets where name = 'project_url');
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'push_cron_secret')
where not exists (select 1 from vault.secrets where name = 'push_cron_secret');
select cron.schedule(
  'a-medias-diario',
  '5 5 * * *',
  $$ select public.daily_maintenance(); $$
);
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
select public.daily_maintenance();
commit;
select decrypted_secret as push_cron_secret from vault.decrypted_secrets where name = 'push_cron_secret';
