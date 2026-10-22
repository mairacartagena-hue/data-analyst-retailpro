-- 0002 · Seguridad a nivel de fila (RLS)
-- Cada usuario solo lee y escribe los datos de su hogar.

create or replace function public.is_member(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members
    where household_id = p_household_id
      and user_id = auth.uid()
  );
$$;

revoke all on function public.is_member(uuid) from public;
grant execute on function public.is_member(uuid) to authenticated, service_role;

alter table public.households            enable row level security;
alter table public.members               enable row level security;
alter table public.pets                  enable row level security;
alter table public.tasks                 enable row level security;
alter table public.task_occurrences      enable row level security;
alter table public.shopping_lists        enable row level security;
alter table public.pantry_products       enable row level security;
alter table public.shopping_items        enable row level security;
alter table public.reminders             enable row level security;
alter table public.pet_events            enable row level security;
alter table public.notes                 enable row level security;
alter table public.push_subscriptions    enable row level security;
alter table public.suggestion_dismissals enable row level security;
alter table public.push_log              enable row level security; -- sin políticas: solo service_role

-- Hogares: se crean y se unen por RPC; aquí solo leer y editar el nombre.
create policy "miembros leen su hogar" on public.households
  for select to authenticated using (public.is_member(id));
create policy "miembros editan su hogar" on public.households
  for update to authenticated using (public.is_member(id)) with check (public.is_member(id));

-- Miembros: se insertan y borran por RPC (create_household, join_household, leave_household).
create policy "miembros leen su hogar" on public.members
  for select to authenticated using (public.is_member(household_id));
create policy "miembros editan su hogar" on public.members
  for update to authenticated using (public.is_member(household_id)) with check (public.is_member(household_id));

-- Tablas de datos del hogar: acceso completo para los miembros.
do $$
declare t text;
begin
  foreach t in array array[
    'pets','tasks','task_occurrences','shopping_lists','pantry_products',
    'shopping_items','reminders','pet_events','notes','suggestion_dismissals'
  ] loop
    execute format(
      'create policy "miembros gestionan datos del hogar" on public.%I for all to authenticated
         using (public.is_member(household_id)) with check (public.is_member(household_id))',
      t
    );
  end loop;
end $$;

-- Suscripciones push: cada quien las suyas.
create policy "cada quien sus suscripciones" on public.push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
