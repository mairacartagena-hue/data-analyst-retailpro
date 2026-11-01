-- 0050 · La app no guarda extractos
-- Los valores del extracto de la tarjeta (corte, fecha de pago, pago mínimo, pago total y deuda) solo se leen del PDF
-- o se escriben a mano para cruzarlos al momento con la app; no se guardan. Se borra la tabla de 0049 y lo que tenía.
-- card_statement_items.as_of se queda: es el corte del que salió una compra a cuotas y la proyección lo usa.
-- Se puede correr más de una vez.

drop table if exists public.card_statements;
