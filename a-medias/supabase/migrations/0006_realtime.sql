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
