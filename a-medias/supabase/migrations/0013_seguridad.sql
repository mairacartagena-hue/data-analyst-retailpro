-- 0013 · Seguridad: quitar permisos de ejecución a funciones internas y fijar search_path
-- Las funciones que usa la app (create_household, join_household, change_turn, etc.) se quedan igual.

revoke execute on function public.fill_household_from_parent() from public, anon, authenticated;
revoke execute on function public.item_after_bought() from public, anon, authenticated;
revoke execute on function public.item_before_bought() from public, anon, authenticated;
revoke execute on function public.occurrence_after_update() from public, anon, authenticated;
revoke execute on function public.occurrence_before_update() from public, anon, authenticated;
revoke execute on function public.pantry_after_change() from public, anon, authenticated;
revoke execute on function public.tasks_after_change() from public, anon, authenticated;
revoke execute on function public.sync_pantry(uuid) from public, anon, authenticated;
revoke execute on function public.is_member(uuid) from public, anon;

alter function public.gen_invite_code() set search_path = public;
alter function public.tasks_normalizar() set search_path = public;
alter function public.set_updated_at() set search_path = public;
alter function public.item_before_bought() set search_path = public;
alter function public.hoy_bogota() set search_path = public;
