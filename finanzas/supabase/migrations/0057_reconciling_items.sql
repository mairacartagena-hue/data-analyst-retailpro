-- 0057 · Partidas conciliatorias. Se puede correr más de una vez.
--
-- Una cuenta conciliada no debe moverse: si después aparece un movimiento de antes del corte, la app avisa y deja
-- aceptarlo como partida conciliatoria; la conciliación sigue en el saldo del banco y la partida explica la diferencia.
--  · reconciled_at: momento en que se concilió (aceptar partidas cambia updated_at pero no este momento).
--  · reconciling_items: [{ transaction_id, amount, description, occurred_on }], amount = efecto sobre el saldo.
alter table public.account_reconciliations
  add column if not exists reconciled_at timestamptz,
  add column if not exists reconciling_items jsonb not null default '[]'::jsonb;
update public.account_reconciliations set reconciled_at = updated_at where reconciled_at is null;

do $$ begin
  alter table public.account_reconciliations add constraint account_reconciliations_items_array
    check (jsonb_typeof(reconciling_items) = 'array' and jsonb_array_length(reconciling_items) <= 500);
exception when duplicate_object then null;
end $$;
