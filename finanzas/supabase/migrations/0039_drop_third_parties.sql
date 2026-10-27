-- 0039 · Quitar "plata de terceros" (0037), que no se usa: esos pagos se manejan con una categoría y reembolsos.
-- Se puede correr más de una vez.

drop function if exists public.set_third_party(uuid, uuid, boolean);
alter table public.transactions drop column if exists third_party_id;
alter table public.merchant_memory drop column if exists third_party_id;
drop table if exists public.third_parties;
