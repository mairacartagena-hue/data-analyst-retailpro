-- 0061 · Saldo que se ve en la app del banco al cerrar. Se puede correr más de una vez.
--
-- El cierre compara la app con el extracto, que trae el saldo a su fecha de corte. Lo que la persona ve en la app del
-- banco es otro dato y de otra fecha (casi siempre posterior). Se guarda aparte, con el mismo signo que statement_balance
-- (en tarjetas y créditos la deuda va en negativo), y el momento en que se miró, para saber si lo que no cuadra venía del
-- corte o apareció después.
-- Las conciliaciones anteriores quedan sin este dato.
alter table public.account_reconciliations add column if not exists bank_balance bigint;
alter table public.account_reconciliations add column if not exists bank_balance_at timestamptz;
