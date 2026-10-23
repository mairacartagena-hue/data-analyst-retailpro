-- 0009 · "Va:" en Compras: quién va (o los dos) y la tarea que se crea con la fecha
alter table public.shopping_lists add column if not exists va_juntos boolean not null default false;
alter table public.shopping_lists add column if not exists tarea_id uuid references public.tasks (id) on delete set null;
