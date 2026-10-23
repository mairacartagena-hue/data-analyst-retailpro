-- 0014 · Comida de mascotas en la Despensa: a qué mascota es, marca y tipo
alter table public.pantry_products add column if not exists pet_id uuid references public.pets (id) on delete set null;
alter table public.pantry_products add column if not exists marca text;
alter table public.pantry_products add column if not exists tipo_comida text;
