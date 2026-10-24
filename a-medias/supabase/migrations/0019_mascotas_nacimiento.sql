-- 0019 · Fecha de nacimiento de las mascotas
-- Si no se sabe la fecha exacta, se guarda una fecha estimada a partir de la
-- edad aproximada y fecha_nacimiento_aproximada = true.

alter table public.pets
  add column if not exists fecha_nacimiento date,
  add column if not exists fecha_nacimiento_aproximada boolean not null default false;

alter table public.pets
  drop constraint if exists pets_nacimiento_no_futuro;
alter table public.pets
  add constraint pets_nacimiento_no_futuro
  check (fecha_nacimiento is null or fecha_nacimiento <= (now() at time zone 'America/Bogota')::date + 1);
