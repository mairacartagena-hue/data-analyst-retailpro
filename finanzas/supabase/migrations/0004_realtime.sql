-- 0004 · Realtime: Saldo Seguro, barras compartidas y cruce se actualizan en vivo en ambos celulares.
-- Realtime respeta RLS: cada quien recibe solo los cambios de filas que puede ver.

alter publication supabase_realtime add table
  public.accounts,
  public.categories,
  public.category_budgets,
  public.transactions,
  public.transaction_splits,
  public.cross_ledger,
  public.household_members,
  public.period_settings,
  public.manual_assets;
