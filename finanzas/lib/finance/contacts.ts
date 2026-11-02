// Cruce con contactos fuera del hogar. La base (contact_net) es la que manda; esto replica la regla para la pantalla.
//
// Cada persona anota los asientos en su propio contacto. Si el contacto está vinculado (usa la app en otro hogar),
// también llegan los que el otro anotó en el contacto que me tiene a mí: esos se leen al revés.

import type { Contact, ContactEntry } from "@/lib/types";

export interface ContactRow extends ContactEntry {
  /** Desde mi punto de vista: true = el contacto me debe este monto (o me lo descuenta si es un pago mío). */
  mineInFavor: boolean;
  /** Lo anoté yo (en mi contacto) o lo anotó el contacto vinculado. */
  mine: boolean;
}

/** Asientos de un contacto (los míos y, si está vinculado, los del otro al revés), del más nuevo al más viejo. */
export function contactRows(contact: Contact, entries: ContactEntry[], me: string): ContactRow[] {
  const rows: ContactRow[] = [];
  for (const e of entries) {
    if (e.contact_id === contact.id && e.owner_user_id === me) rows.push({ ...e, mineInFavor: e.in_favor, mine: true });
    else if (contact.linked_user_id && e.owner_user_id === contact.linked_user_id && e.owner_user_id !== me) {
      rows.push({ ...e, mineInFavor: !e.in_favor, mine: false });
    }
  }
  return rows.sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at));
}

/** Neto con el contacto: positivo = me debe · negativo = le debo. */
export function contactNet(rows: Pick<ContactRow, "amount" | "mineInFavor">[]): number {
  return rows.reduce((n, r) => n + (r.mineInFavor ? r.amount : -r.amount), 0);
}

export interface ContactSummary {
  contact: Contact;
  rows: ContactRow[];
  net: number;
}

/** Contactos con su saldo: primero los que tienen saldo pendiente, luego por nombre. Los archivados sin saldo se omiten. */
export function contactSummaries(contacts: Contact[], entries: ContactEntry[], me: string, includeArchived = false): ContactSummary[] {
  return contacts
    .filter((c) => c.owner_user_id === me)
    .map((c) => {
      const rows = contactRows(c, entries, me);
      return { contact: c, rows, net: contactNet(rows) };
    })
    .filter((s) => includeArchived || !s.contact.archived || s.net !== 0)
    .sort((a, b) => Number(b.net !== 0) - Number(a.net !== 0) || a.contact.name.localeCompare(b.contact.name, "es"));
}

/** Total que me deben y que debo a contactos (para resúmenes). */
export function contactTotals(summaries: ContactSummary[]): { owedToMe: number; iOwe: number } {
  let owedToMe = 0;
  let iOwe = 0;
  for (const s of summaries) {
    if (s.net > 0) owedToMe += s.net;
    else iOwe += -s.net;
  }
  return { owedToMe, iOwe };
}

/** Prefijo con que una parte del desglose apunta a un contacto en vez de a un miembro del hogar. */
export const CONTACT_PREFIX = "contact:";
export const contactKey = (id: string) => `${CONTACT_PREFIX}${id}`;
export const contactIdOf = (responsible: string): string | null =>
  responsible.startsWith(CONTACT_PREFIX) ? responsible.slice(CONTACT_PREFIX.length) : null;
