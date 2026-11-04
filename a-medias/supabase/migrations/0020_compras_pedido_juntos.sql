-- 0020 · Un producto de la lista de compras puede ser pedido por los dos (Juntos)
alter table public.shopping_items
  add column if not exists pedido_juntos boolean not null default false;
