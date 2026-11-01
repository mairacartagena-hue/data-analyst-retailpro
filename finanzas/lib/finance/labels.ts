import type { AccountLabel, Category, Member } from "@/lib/types";

export function accountLabel(labels: AccountLabel[], id: string | null): string {
  if (!id) return "—";
  const l = labels.find((x) => x.id === id);
  if (!l) return "Cuenta privada";
  return l.last4 ? `${l.name} ··${l.last4}` : l.name;
}

export function categoryLabel(categories: Category[], id: string | null): { name: string; icon: string } {
  if (!id) return { name: "Sin categoría", icon: "·" };
  const c = categories.find((x) => x.id === id);
  if (!c) return { name: "Privado", icon: "🔒" };
  // Una subcategoría sin ícono usa el de su categoría principal
  const parentIcon = !c.icon && c.parent_id ? categories.find((x) => x.id === c.parent_id)?.icon : null;
  return { name: c.name, icon: c.icon || parentIcon || "•" };
}

export function memberBySlot(me: Member, partner: Member | null, slot: "A" | "B"): Member | null {
  return [me, partner].find((m) => m?.slot === slot) ?? null;
}

/**
 * Cuentas para los filtros: solo las de los miembros del hogar y sin archivar.
 * Con `space = "HOUSEHOLD"` quedan las cuentas del hogar: las que la pareja puede ver
 * (no privadas o con el nombre visible en lo compartido) y las que pagaron algo del hogar.
 * Si dos cuentas se llaman igual, se agrega el nombre de su dueño.
 */
export function householdAccountOptions(
  labels: AccountLabel[],
  ctx: {
    members: (Member | null)[];
    accounts: { id: string; archived: boolean; visibility: string; reveal_in_shared: boolean }[];
    space?: "HOUSEHOLD" | "PERSONAL" | "";
    /** Movimientos visibles (para saber qué cuentas pagaron algo del hogar). */
    transactions?: { scope: string; account_id: string | null; to_account_id: string | null }[];
  },
): { id: string; label: string }[] {
  const owners = new Map(ctx.members.filter((m): m is Member => !!m).map((m) => [m.user_id, m.display_name]));
  const byId = new Map(ctx.accounts.map((a) => [a.id, a]));
  const usedInHousehold = new Set<string>();
  for (const t of ctx.transactions ?? []) {
    if (t.scope !== "HOUSEHOLD") continue;
    if (t.account_id) usedInHousehold.add(t.account_id);
    if (t.to_account_id) usedInHousehold.add(t.to_account_id);
  }
  const list = labels.filter((l) => {
    if (!owners.has(l.owner_user_id)) return false;
    const a = byId.get(l.id);
    if (a?.archived) return false;
    if (ctx.space === "HOUSEHOLD") {
      // Una cuenta de la pareja que no está en `accounts` es privada con el nombre visible en lo compartido
      const shared = a ? a.visibility !== "PRIVATE" || a.reveal_in_shared : true;
      return shared || usedInHousehold.has(l.id);
    }
    return true;
  });
  const base = (l: AccountLabel) => (l.last4 ? `${l.name} ··${l.last4}` : l.name);
  const count = new Map<string, number>();
  for (const l of list) count.set(base(l), (count.get(base(l)) ?? 0) + 1);
  return list
    .map((l) => ({ id: l.id, label: (count.get(base(l)) ?? 0) > 1 ? `${base(l)} · ${owners.get(l.owner_user_id)}` : base(l) }))
    .sort((x, y) => x.label.localeCompare(y.label, "es"));
}
