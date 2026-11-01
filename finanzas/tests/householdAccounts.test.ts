import { describe, expect, it } from "vitest";
import { householdAccountOptions } from "@/lib/finance/labels";
import type { AccountLabel, Member } from "@/lib/types";

const me = { user_id: "u1", display_name: "Ana" } as Member;
const partner = { user_id: "u2", display_name: "Leo" } as Member;
const label = (id: string, owner: string, name: string, visibility = "PUBLIC"): AccountLabel =>
  ({ id, owner_user_id: owner, name, kind: "DEPOSIT", institution: null, last4: null, visibility } as AccountLabel);
const acc = (id: string, visibility = "PUBLIC", archived = false, reveal = false) => ({ id, visibility, archived, reveal_in_shared: reveal });

describe("householdAccountOptions", () => {
  const labels = [
    label("a", "u1", "Nequi"), label("b", "u2", "Nequi"), label("c", "u1", "Billetes", "PRIVATE"),
    label("d", "u1", "Vieja"), label("e", "u3", "Ajena"), label("f", "u2", "Tarjeta", "PRIVATE"),
  ];
  const accounts = [acc("a"), acc("b"), acc("c", "PRIVATE"), acc("d", "PUBLIC", true)];

  it("deja solo las cuentas de los miembros del hogar y sin archivar", () => {
    const ids = householdAccountOptions(labels, { members: [me, partner], accounts }).map((o) => o.id);
    expect(ids.sort()).toEqual(["a", "b", "c", "f"]);
  });

  it("con dos cuentas del mismo nombre agrega el dueño", () => {
    const names = householdAccountOptions(labels, { members: [me, partner], accounts }).map((o) => o.label);
    expect(names).toContain("Nequi · Ana");
    expect(names).toContain("Nequi · Leo");
  });

  it("en Hogar quita las privadas que no pagaron nada del hogar", () => {
    const ids = householdAccountOptions(labels, { members: [me, partner], accounts, space: "HOUSEHOLD", transactions: [] }).map((o) => o.id);
    expect(ids.sort()).toEqual(["a", "b", "f"]);
    const withUse = householdAccountOptions(labels, {
      members: [me, partner], accounts, space: "HOUSEHOLD",
      transactions: [{ scope: "HOUSEHOLD", account_id: "c", to_account_id: null }],
    }).map((o) => o.id);
    expect(withUse).toContain("c");
  });
});
