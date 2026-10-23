-- 0008 · Duración de los productos de la lista de compras
-- Si el producto tiene duración, al marcarlo comprado pasa a la Despensa y empieza a contar.
alter table public.shopping_items add column if not exists duracion_dias integer check (duracion_dias is null or duracion_dias > 0);
