import type { SupabaseClient } from "@supabase/supabase-js";
import type { FinanceState } from "@/lib/data/FinanceProvider";

/** Busca una categoría por nombre (del mismo tipo) o la crea sin presupuesto. */
export async function ensureCategory(
  state: FinanceState, sb: SupabaseClient, name: string, icon: string, kind: "EXPENSE" | "INCOME" = "EXPENSE",
): Promise<string> {
  const existing = state.categories.find(
    (c) => !c.archived && (c.kind ?? "EXPENSE") === kind && c.name.toLowerCase() === name.toLowerCase(),
  );
  if (existing) return existing.id;
  const { data, error } = await sb.rpc("save_category", { p: { name, icon, kind } });
  if (error) throw error;
  return data as string;
}
