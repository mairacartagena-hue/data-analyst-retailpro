-- 0001 · Esquema de A Medias
-- Zona horaria de la app: America/Bogota (UTC-5, sin horario de verano).
-- Convención de días de la semana: 1 = lunes ... 7 = domingo (ISO).

create extension if not exists pgcrypto;

-- Fecha de hoy en Bogotá
create or replace function public.hoy_bogota()
returns date
language sql
stable
as $$ select (now() at time zone 'America/Bogota')::date $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------
-- Hogares y miembros
-- ---------------------------------------------------------------
create table public.households (
  id uuid primary key default gen_random_uuid(),
  nombre text not null default 'Nuestra casa',
  codigo_invitacion text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  nombre text not null,
  color text not null check (color in ('rosa', 'bordo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- diferible para poder intercambiar colores en una sola transacción
  constraint members_color_unico unique (household_id, color) deferrable initially deferred
);
create index members_household_idx on public.members (household_id);

-- ---------------------------------------------------------------
-- Mascotas
-- ---------------------------------------------------------------
create table public.pets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  nombre text not null,
  especie text not null default 'gato' check (especie in ('gato', 'perro')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pets_household_idx on public.pets (household_id);

-- ---------------------------------------------------------------
-- Tareas (incluye medicamentos de mascotas)
-- ---------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  titulo text not null,
  tipo text not null default 'tarea' check (tipo in ('tarea', 'medicamento')),
  pet_id uuid references public.pets (id) on delete cascade,
  dosis text,
  frecuencia text not null default 'semanal'
    check (frecuencia in ('diaria', 'semanal', 'quincenal', 'mensual')),
  dias_semana smallint[] not null default '{}',
  modo text not null default 'fija' check (modo in ('fija', 'rota', 'juntos')),
  responsable_fijo uuid references public.members (id) on delete set null,
  orden_rotacion uuid[] not null default '{}',
  -- Cuando alguien cambia un turno de una tarea que rota, la rotación se
  -- recalcula desde esta fecha empezando por este miembro.
  rotacion_ancla date,
  rotacion_ancla_miembro uuid references public.members (id) on delete set null,
  fecha_inicio date not null default public.hoy_bogota(),
  hora_recordatorio time,
  horas_toma time[] not null default '{}',
  duracion_dias integer check (duracion_dias is null or duracion_dias > 0),
  fecha_fin date,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_medicamento_con_mascota check (tipo = 'tarea' or pet_id is not null)
);
create index tasks_household_idx on public.tasks (household_id);
create index tasks_pet_idx on public.tasks (pet_id);

create table public.task_occurrences (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  fecha date not null,
  hora time not null default '00:00',
  -- si la ocurrencia se movió de día (sugerencias), aquí queda el día original
  fecha_original date,
  responsable_id uuid references public.members (id) on delete set null,
  -- true si alguien cambió a mano el responsable de una tarea fija/juntos
  responsable_manual boolean not null default false,
  completada boolean not null default false,
  completada_por uuid references public.members (id) on delete set null,
  completada_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_occurrences_unica unique (task_id, fecha, hora)
);
create index task_occurrences_household_fecha_idx on public.task_occurrences (household_id, fecha);

-- ---------------------------------------------------------------
-- Compras y despensa
-- ---------------------------------------------------------------
create table public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  nombre text not null check (nombre in ('Mercado', 'Droguería', 'Para la casa')),
  quien_va uuid references public.members (id) on delete set null,
  fecha date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, nombre)
);

create table public.pantry_products (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  nombre text not null,
  categoria text not null default 'Abarrotes'
    check (categoria in ('Abarrotes', 'Frutas y verduras', 'Carnes', 'Lácteos', 'Aseo', 'Otros')),
  duracion_dias integer not null check (duracion_dias > 0),
  fecha_ultima_compra date not null default public.hoy_bogota(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pantry_household_idx on public.pantry_products (household_id);

create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.shopping_lists (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  nombre text not null,
  categoria text not null default 'Otros'
    check (categoria in ('Abarrotes', 'Frutas y verduras', 'Carnes', 'Lácteos', 'Aseo', 'Otros')),
  cantidad text,
  pedido_por uuid references public.members (id) on delete set null,
  comprado boolean not null default false,
  comprado_en timestamptz,
  es_automatico boolean not null default false,
  pantry_product_id uuid references public.pantry_products (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shopping_items_list_idx on public.shopping_items (list_id);
-- un solo ítem pendiente por producto de despensa
create unique index shopping_items_auto_pendiente_idx
  on public.shopping_items (pantry_product_id) where not comprado and pantry_product_id is not null;

-- ---------------------------------------------------------------
-- Recordatorios, eventos de mascotas, notas
-- ---------------------------------------------------------------
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  titulo text not null,
  fecha_hora timestamptz not null,
  responsables uuid[] not null default '{}', -- vacío = los dos
  repeticion text not null default 'ninguna' check (repeticion in ('ninguna', 'mensual', 'anual')),
  aviso_previo_dias integer not null default 0 check (aviso_previo_dias >= 0),
  nota text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reminders_household_idx on public.reminders (household_id);

create table public.pet_events (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  tipo text not null default 'vacuna' check (tipo in ('vacuna', 'control', 'otro')),
  titulo text not null,
  fecha date not null,
  repeticion text not null default 'ninguna' check (repeticion in ('ninguna', 'anual')),
  aviso_previo_dias integer not null default 0 check (aviso_previo_dias >= 0),
  responsable_id uuid references public.members (id) on delete set null,
  nota text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pet_events_pet_idx on public.pet_events (pet_id);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  titulo text not null,
  contenido text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notes_household_idx on public.notes (household_id);

-- ---------------------------------------------------------------
-- Push y sugerencias
-- ---------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique,
  keys jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table public.suggestion_dismissals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  occurrence_id uuid not null references public.task_occurrences (id) on delete cascade,
  fecha_destino date not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (occurrence_id, fecha_destino)
);

-- Registro interno de notificaciones ya enviadas (evita duplicados)
create table public.push_log (
  key text primary key,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'households','members','pets','tasks','task_occurrences','shopping_lists',
    'pantry_products','shopping_items','reminders','pet_events','notes',
    'push_subscriptions','suggestion_dismissals','push_log'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_updated_at', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------
-- household_id de tablas hijas se copia siempre del padre
-- (así RLS y Realtime filtran por hogar sin joins)
-- ---------------------------------------------------------------
create or replace function public.fill_household_from_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'task_occurrences' then
    select household_id into new.household_id from tasks where id = new.task_id;
  elsif tg_table_name = 'shopping_items' then
    select household_id into new.household_id from shopping_lists where id = new.list_id;
  elsif tg_table_name = 'pet_events' then
    select household_id into new.household_id from pets where id = new.pet_id;
  end if;
  return new;
end;
$$;

create trigger task_occurrences_household before insert or update of task_id on public.task_occurrences
  for each row execute function public.fill_household_from_parent();
create trigger shopping_items_household before insert or update of list_id on public.shopping_items
  for each row execute function public.fill_household_from_parent();
create trigger pet_events_household before insert or update of pet_id on public.pet_events
  for each row execute function public.fill_household_from_parent();
