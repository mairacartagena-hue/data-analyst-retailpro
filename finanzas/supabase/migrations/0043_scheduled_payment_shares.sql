-- 0043 · Vencimientos compartidos. Se puede correr más de una vez.
--
-- Un vencimiento del hogar puede repartirse entre los dos con montos fijos: share_a es lo que pone el miembro A y
-- share_b lo del miembro B (en pesos). Sin reparto, ambos quedan vacíos y lo asume responsible_user_id (o nadie).

alter table public.scheduled_payments add column if not exists share_a bigint;
alter table public.scheduled_payments add column if not exists share_b bigint;

alter table public.scheduled_payments drop constraint if exists scheduled_payments_shares_check;
alter table public.scheduled_payments add constraint scheduled_payments_shares_check check (
  (share_a is null and share_b is null)
  or (share_a is not null and share_b is not null and share_a >= 0 and share_b >= 0 and scope = 'HOUSEHOLD')
);
