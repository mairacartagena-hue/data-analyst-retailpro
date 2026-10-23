-- 0018 · Cada alimento de la lista puede guardar la mascota a la que es
alter table public.shopping_items add column if not exists pet_id uuid references public.pets (id) on delete set null;
