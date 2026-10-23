-- 0017 · Categorías para la comida natural de mascotas
alter table public.shopping_items drop constraint if exists shopping_items_categoria_check;
alter table public.shopping_items add constraint shopping_items_categoria_check
  check (categoria in ('Abarrotes', 'Frutas y verduras', 'Carnes', 'Lácteos', 'Aseo', 'Otros', 'Proteína', 'Carbohidratos', 'Hueso carnoso', 'Vísceras'));
alter table public.pantry_products drop constraint if exists pantry_products_categoria_check;
alter table public.pantry_products add constraint pantry_products_categoria_check
  check (categoria in ('Abarrotes', 'Frutas y verduras', 'Carnes', 'Lácteos', 'Aseo', 'Otros', 'Proteína', 'Carbohidratos', 'Hueso carnoso', 'Vísceras'));
