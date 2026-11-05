-- 0022 · Tienda donde se compra cada producto de la lista (opcional)
alter table public.shopping_items
  add column if not exists tienda text;
