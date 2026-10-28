-- 0042 · Suscripciones: solo compras. Se puede correr más de una vez.
--
-- La captura marcaba como suscripción (#suscripcion) cualquier gasto que se repetía cada mes por un monto parecido,
-- también transferencias a personas (ej. lo que se le envía cada mes a un familiar). Una regla en la tabla quita la
-- marca a todo lo que no sea una compra, venga de la captura o de una edición. Además se limpia lo que ya estaba marcado.

create or replace function public.transactions_subscription_only_purchases()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if '#suscripcion' = any (new.tags) and new.movement_type is not null and new.movement_type <> 'PURCHASE' then
    new.tags := array_remove(new.tags, '#suscripcion');
  end if;
  return new;
end;
$$;
revoke all on function public.transactions_subscription_only_purchases() from public, anon, authenticated;

drop trigger if exists subscription_only_purchases on public.transactions;
create trigger subscription_only_purchases
  before insert or update of tags, movement_type on public.transactions
  for each row execute function public.transactions_subscription_only_purchases();

update public.transactions
   set tags = array_remove(tags, '#suscripcion')
 where '#suscripcion' = any (tags) and movement_type is not null and movement_type <> 'PURCHASE';
