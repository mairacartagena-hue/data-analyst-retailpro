import { describe, expect, it } from "vitest";
import { contactIdOf, contactKey, contactNet, contactRows, contactSummaries, contactTotals } from "@/lib/finance/contacts";
import type { Contact, ContactEntry } from "@/lib/types";

const ME = "me";
const JUAN = "juan";
const contact = (id: string, name: string, linked: string | null = null, owner = ME): Contact =>
  ({ id, owner_user_id: owner, name, linked_user_id: linked, link_code: null, archived: false, created_at: "2026-01-01" });
let n = 0;
const entry = (contact_id: string, owner: string, amount: number, in_favor: boolean, occurred_on = "2026-10-01"): ContactEntry => ({
  id: `e${++n}`, contact_id, owner_user_id: owner, amount, in_favor, kind: "LOAN", transaction_id: null, received_transaction_id: null,
  description: null, occurred_on, created_by: owner, created_at: `2026-10-01T00:00:0${n}`,
});

describe("cruce con contactos", () => {
  it("suma lo mío y, si está vinculado, lo del otro al revés", () => {
    const juan = contact("c1", "Juan", JUAN);
    const entries = [
      entry("c1", ME, 80_000, true), // le presté
      entry("cj", JUAN, 30_000, true), // Juan anotó que yo le debo un encargo
      entry("c2", ME, 5_000, true), // otro contacto
    ];
    const rows = contactRows(juan, entries, ME);
    expect(rows.map((r) => [r.mine, r.mineInFavor])).toEqual([[false, false], [true, true]]); // el más nuevo primero
    expect(contactNet(rows)).toBe(50_000);
  });

  it("sin vínculo no se mezclan los del otro", () => {
    expect(contactNet(contactRows(contact("c1", "Juan"), [entry("cj", JUAN, 30_000, true)], ME))).toBe(0);
  });

  it("resumen: primero los que tienen saldo; los archivados en cero se ocultan", () => {
    const a = contact("a", "Ana");
    const b = { ...contact("b", "Beto"), archived: true };
    const z = contact("z", "Zoe");
    const s = contactSummaries([a, b, z], [entry("z", ME, 10_000, false)], ME);
    expect(s.map((x) => [x.contact.name, x.net])).toEqual([["Zoe", -10_000], ["Ana", 0]]);
    expect(contactTotals(s)).toEqual({ owedToMe: 0, iOwe: 10_000 });
  });

  it("clave de contacto en el desglose", () => {
    expect(contactIdOf(contactKey("x"))).toBe("x");
    expect(contactIdOf("user-id")).toBeNull();
  });
});
