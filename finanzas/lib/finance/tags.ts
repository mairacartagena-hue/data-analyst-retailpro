// Etiquetas del hogar: conteos, filtro e informe por etiqueta. Un movimiento puede tener varias.

import type { Tag, Transaction } from "@/lib/types";
import { isWithin, type Period } from "./periods";
import { consumptionSign } from "./spaces";

export type TxTags = Record<string, string[]>;

export const hasTag = (txTags: TxTags, txId: string, tagId: string) => (txTags[txId] ?? []).includes(tagId);

/** Nombre normalizado para comparar (sin tildes, mayúsculas ni espacios de más), como lo exige la base de datos. */
export const tagKey = (name: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** Busca una etiqueta por nombre sin importar tildes ni mayúsculas. */
export function findTagByName(tags: Tag[], name: string): Tag | undefined {
  const k = tagKey(name);
  return tags.find((t) => tagKey(t.name) === k);
}

/** Cuántos movimientos (de los que puedo ver) tiene cada etiqueta. */
export function tagUsage(txs: Transaction[], txTags: TxTags): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of txs) for (const id of txTags[t.id] ?? []) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

export interface TagTotal {
  tagId: string;
  name: string;
  color: string | null;
  count: number;
  /** Gastos netos con la etiqueta en el periodo (los reembolsos restan). */
  expense: number;
  income: number;
}

/** Informe por etiqueta: gastos netos e ingresos de los movimientos del periodo que la tienen. */
export function spendingByTag(txs: Transaction[], txTags: TxTags, tags: Tag[], period: Period): TagTotal[] {
  const byId = new Map(tags.map((t) => [t.id, t]));
  const out = new Map<string, TagTotal>();
  for (const t of txs) {
    if (!isWithin(t.occurred_on, period)) continue;
    for (const id of txTags[t.id] ?? []) {
      const tag = byId.get(id);
      if (!tag) continue;
      const row = out.get(id) ?? { tagId: id, name: tag.name, color: tag.color, count: 0, expense: 0, income: 0 };
      row.count++;
      row.expense += consumptionSign(t.kind) * t.amount;
      if (t.kind === "INCOME") row.income += t.amount;
      out.set(id, row);
    }
  }
  return [...out.values()].sort((a, b) => b.expense - a.expense || b.count - a.count || a.name.localeCompare(b.name));
}

/** Diferencia entre las etiquetas que tiene un movimiento y las que se eligieron. */
export function diffTags(current: string[], wanted: string[]): { add: string[]; remove: string[] } {
  const c = new Set(current);
  const w = new Set(wanted);
  return { add: [...w].filter((x) => !c.has(x)), remove: [...c].filter((x) => !w.has(x)) };
}

/** Colores sugeridos para las etiquetas (se pueden cambiar). */
export const TAG_COLORS = ["#6b8f5e", "#c08a3e", "#4f7cac", "#a8536a", "#7d6bb0", "#3f8f8a", "#b5654a", "#6f7d8c"];
