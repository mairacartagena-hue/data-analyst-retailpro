-- 0016 · Responsable de cada producto de mascotas (una persona o rotar)
alter table public.pantry_products add column if not exists responsable_id uuid references public.members (id) on delete set null;
alter table public.pantry_products add column if not exists rota boolean not null default false;
