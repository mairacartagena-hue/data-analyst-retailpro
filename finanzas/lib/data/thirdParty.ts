import type { SupabaseClient } from "@supabase/supabase-js";
import type { Member, ThirdParty } from "@/lib/types";
import { DEFAULT_THIRD_PARTY_NAME } from "@/lib/finance/thirdParty";

/** Devuelve el tercero de la persona (por ahora solo uno); si no existe lo crea con el nombre por defecto. */
export async function ensureThirdParty(sb: SupabaseClient, me: Member, existing: ThirdParty[]): Promise<string> {
  if (existing[0]) return existing[0].id;
  const { data, error } = await sb.from("third_parties")
    .insert({ household_id: me.household_id, owner_user_id: me.user_id, name: DEFAULT_THIRD_PARTY_NAME })
    .select("id").single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export function thirdPartyName(list: ThirdParty[]): string {
  return list[0]?.name ?? DEFAULT_THIRD_PARTY_NAME;
}
