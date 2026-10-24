-- 0020 · Comentarios en los movimientos.
-- Cada comentario lo ve quien puede ver el movimiento (misma regla que can_see_transaction):
-- los del hogar los ven los dos; los personales, solo su dueño (y quien participa en una parte).
-- Cada persona escribe y borra solo los suyos. Se puede volver a correr sin problema.

create table if not exists public.transaction_comments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists transaction_comments_tx_idx on public.transaction_comments (transaction_id, created_at);
create index if not exists transaction_comments_household_idx on public.transaction_comments (household_id);

alter table public.transaction_comments enable row level security;
revoke all on public.transaction_comments from anon;

drop policy if exists "ver comentarios" on public.transaction_comments;
create policy "ver comentarios" on public.transaction_comments for select to authenticated
  using (public.can_see_transaction(transaction_id));

drop policy if exists "comentar" on public.transaction_comments;
create policy "comentar" on public.transaction_comments for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.can_see_transaction(transaction_id)
    and household_id = (select t.household_id from public.transactions t where t.id = transaction_id)
  );

drop policy if exists "borrar mis comentarios" on public.transaction_comments;
create policy "borrar mis comentarios" on public.transaction_comments for delete to authenticated
  using (author_id = auth.uid());

-- Sin política de actualización: un comentario no se edita (se borra y se escribe de nuevo).

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                     and schemaname = 'public' and tablename = 'transaction_comments') then
    alter publication supabase_realtime add table public.transaction_comments;
  end if;
end $$;
