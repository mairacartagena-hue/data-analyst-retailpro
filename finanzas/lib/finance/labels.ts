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
