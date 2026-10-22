-- 0007 · Tareas programadas con pg_cron + pg_net
-- Antes de correr esta migración, activa pg_cron y pg_net (Database > Extensions)
-- y guarda en Vault la URL del proyecto y el secreto del cron (ver README):
--   select vault.create_secret('https://TU-PROYECTO.supabase.co', 'project_url');
--   select vault.create_secret('UN-SECRETO-LARGO', 'push_cron_secret');

create extension if not exists pg_cron;
create extension if not exists pg_net;

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
