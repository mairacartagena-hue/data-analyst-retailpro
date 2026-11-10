-- Una tarea del hogar puede ser de varias mascotas (ej. "Cambiar la arena" de dos gatos).
-- Las tareas guardan sus mascotas en pet_ids; pet_id queda solo para medicamentos.

alter table public.tasks add column if not exists pet_ids uuid[] not null default '{}';

-- Pasar la mascota que ya tenían las tareas a la lista
update public.tasks
set pet_ids = array[pet_id], pet_id = null
where tipo = 'tarea' and pet_id is not null;

-- Al borrar una mascota, se quita de las tareas (la tarea sigue existiendo)
create or replace function public.pets_quitar_de_tareas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update tasks set pet_ids = array_remove(pet_ids, old.id)
  where old.id = any(pet_ids);
  return old;
end;
$$;

drop trigger if exists pets_quitar_de_tareas on public.pets;
create trigger pets_quitar_de_tareas before delete on public.pets
  for each row execute function public.pets_quitar_de_tareas();
