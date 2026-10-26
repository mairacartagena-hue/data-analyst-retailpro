-- 0028 · Cuenta de tipo Préstamo.
-- Para plata que me prestan (familia, banco) o que le presto a alguien. Su saldo es negativo mientras se debe.
-- Recibir el préstamo = transferencia de la cuenta de préstamo a mi cuenta (no es ingreso).
-- Pagarlo = transferencia de mi cuenta a la cuenta de préstamo (no es gasto).
-- Se puede volver a correr sin problema.

alter table public.accounts drop constraint if exists accounts_kind_check;
alter table public.accounts add constraint accounts_kind_check
  check (kind in ('DEPOSIT', 'WALLET', 'CASH', 'CREDIT_CARD', 'LOAN'));
