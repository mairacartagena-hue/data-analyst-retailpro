-- 0047 · El primer barrido también trae SMS y notificaciones del celular
-- MacroDroid solo captura lo que llega desde que se instala, así que lo anterior lo sube la persona desde la app
-- (copia de los SMS o avisos pegados). Entra por el mismo camino que el webhook, pero con la sesión de la app
-- en vez del token. Solo canales del celular; Gmail sigue llegando por el Apps Script.
-- Lo repetido no se duplica (external_id). Se puede correr más de una vez.

create or replace function public.ingest_import_event(p_event jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_hh uuid := public.my_household_id();
begin
  if v_uid is null or v_hh is null then raise exception 'No perteneces a un hogar'; end if;
  if coalesce(p_event->>'channel', '') not in ('ANDROID_SMS', 'ANDROID_NOTIFICATION') then
    raise exception 'Solo se pueden subir SMS o notificaciones';
  end if;
  if nullif(p_event->>'external_id', '') is null then raise exception 'Falta el identificador del aviso'; end if;
  return _ingest_core(v_uid, v_hh, p_event);
end;
$$;
revoke all on function public.ingest_import_event(jsonb) from public, anon;
grant execute on function public.ingest_import_event(jsonb) to authenticated;
