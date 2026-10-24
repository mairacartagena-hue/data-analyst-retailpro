-- 0005 · Ajustes de seguridad sugeridos por el asesor de Supabase.
-- search_path fijo en funciones auxiliares y ninguna función ejecutable sin sesión.

alter function public.today_bogota() set search_path = public;
alter function public.set_updated_at() set search_path = public;
alter function public.gen_invite_code() set search_path = public;

revoke all on function public.my_household_id() from public, anon;
revoke all on function public.is_member(uuid) from public, anon;
revoke all on function public.slot_user(uuid, text) from public, anon;
revoke all on function public.category_responsible(uuid) from public, anon;
revoke all on function public.can_see_category(uuid) from public, anon;
revoke all on function public.can_see_budget(uuid) from public, anon;
revoke all on function public.can_see_transaction(uuid) from public, anon;
grant execute on function public.my_household_id() to authenticated;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.slot_user(uuid, text) to authenticated;
grant execute on function public.category_responsible(uuid) to authenticated;
grant execute on function public.can_see_category(uuid) to authenticated;
grant execute on function public.can_see_budget(uuid) to authenticated;
grant execute on function public.can_see_transaction(uuid) to authenticated;
