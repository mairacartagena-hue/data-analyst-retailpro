-- 0062 · Cuántos avisos leyó Gemini hoy para esta persona. Se puede correr más de una vez.
--
-- El webhook de captura limita las lecturas con IA por persona y por día (cupo gratuito de Gemini): antes de llamar a
-- Gemini pregunta cuántas lleva hoy, hora de Colombia. Solo cuenta; no devuelve avisos ni datos de nadie.
-- Si esta función no existe, el webhook no pone tope y sigue funcionando.
create or replace function public.ingest_gemini_today(p_token text)
returns integer
language sql
stable security definer set search_path = public, extensions
as $$
  select case
    when p_token is null or length(p_token) < 20 then 0
    else coalesce((
      select count(*)::integer
        from ingest_logs l
        join ingest_tokens t on t.user_id = l.user_id
       where t.token_hash = encode(digest(p_token, 'sha256'), 'hex')
         and l.parser = 'gemini'
         and l.received_at >= (date_trunc('day', now() at time zone 'America/Bogota') at time zone 'America/Bogota')
    ), 0)
  end
$$;
revoke all on function public.ingest_gemini_today(text) from public;
grant execute on function public.ingest_gemini_today(text) to anon, authenticated;
