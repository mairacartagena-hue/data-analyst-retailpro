-- 0056 · Cierre de tarjetas al día de corte. Se puede correr más de una vez.
--
-- Las tarjetas se concilian con el extracto, que corta el día de corte y no el último día del mes. Se guarda la fecha
-- de corte con que se concilió para que las compras posteriores (van en el próximo extracto) no la descuadren.
-- Las conciliaciones anteriores quedan sin fecha y se siguen revisando al final del mes.
alter table public.account_reconciliations add column if not exists cut_date date;
