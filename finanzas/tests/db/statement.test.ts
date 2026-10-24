// Importar un extracto: lo que la app registra por cada línea que falta debe ser aceptado por la base
// y, al volver a conciliar, ya no debe faltar nada (ni duplicarse si se importa dos veces).

import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, rpc, setupDb } from "./harness";
import type { Account, Transaction } from "@/lib/types";
import { monthRange } from "@/lib/finance/reconcile";
import { bankCharges, isBankLine, parseStatement, reconcileStatement, registerPayload } from "@/lib/finance/statement";

const MAY = "00000000-0000-0000-0000-00000000000a";

const CSV = `FECHA;DESCRIPCIÓN;VALOR;SALDO
02/10/2026;COMPRA TIENDA D1;-45.000,00;955.000,00
05/10/2026;PAGO PSE DAVIVIENDA;-1.043.000,00;-88.000,00
06/10/2026;ABONO INTERESES AHORROS;1.250,50;-86.749,00
06/10/2026;IMPTO GOBIERNO 4X1000;-4.372,00;-91.121,00
30/10/2026;CUOTA DE MANEJO;-18.900,00;-110.021,00
15/10/2026;CONSIGNACION DE UN AMIGO;200.000,00;89.979,00
`;

describe("importar extracto", () => {
  let db: PGlite;
  let acc: string;
  let account: Account;
  const range = monthRange("2026-10");
  const load = async () => {
    const rows = await as<Record<string, unknown>>(db, MAY, `select t.*, coalesce((select jsonb_agg(to_jsonb(s)) from transaction_splits s where s.transaction_id = t.id), '[]'::jsonb) splits from transactions t`);
    // Supabase entrega las fechas como texto YYYY-MM-DD; PGlite como Date
    const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
    return rows.map((r) => ({ ...r, amount: Number(r.amount), occurred_on: day(r.occurred_on), tags: r.tags ?? [] })) as unknown as Transaction[];
  };
  const ensure = async (name: string, icon: string, kind?: string) => {
    const found = (await db.query<{ id: string }>(`select id from categories where name = $1 and not archived`, [name])).rows[0];
    return found?.id ?? (await rpc<string>(db, MAY, "save_category", { name, icon, ...(kind ? { kind } : {}) }));
  };

  beforeAll(async () => {
    db = await setupDb();
    await db.exec(`insert into auth.users values ('${MAY}')`);
    await as(db, MAY, `select public.create_household('Casa', 'May')`);
    const hh = (await db.query<{ id: string }>(`select id from households`)).rows[0].id;
    acc = (await as<{ id: string }>(db, MAY, `insert into accounts (household_id, owner_user_id, name, kind, visibility, opening_balance, opening_at)
      values ($1, $2, 'Ahorros', 'DEPOSIT', 'PRIVATE', 1000000, '2026-01-01') returning id`, [hh, MAY]))[0].id;
    account = { id: acc, kind: "DEPOSIT", gmf_mode: "TAXED" } as unknown as Account;
    // La compra de D1 ya estaba registrada en la app (un día antes); la consignación también
    const cat = await ensure("Mercado", "🛒");
    await rpc(db, MAY, "save_transaction", { kind: "EXPENSE", amount: 45_000, occurred_on: "2026-10-01", account_id: acc, splits: [{ amount: 45_000, category_id: cat }] });
    await rpc(db, MAY, "save_transaction", { kind: "INCOME", amount: 200_000, occurred_on: "2026-10-15", account_id: acc });
  }, 30_000);

  it("lee el extracto y encuentra lo que falta", async () => {
    const parsed = parseStatement(CSV);
    expect(parsed.lines).toHaveLength(6);
    const r = reconcileStatement(account, await load(), parsed.lines, range);
    expect(r.matched).toHaveLength(2); // D1 (1 día de diferencia) y la consignación
    expect(r.missing.map((l) => l.description)).toEqual(["PAGO PSE DAVIVIENDA", "ABONO INTERESES AHORROS", "IMPTO GOBIERNO 4X1000", "CUOTA DE MANEJO"]);
    expect(r.duplicates).toHaveLength(0);
  });

  it("registra los gastos bancarios e intereses con los parámetros de la app y quedan conciliados", async () => {
    const parsed = parseStatement(CSV);
    const ctx = {
      accountId: acc, userId: MAY,
      bankCategoryId: await ensure("Gastos bancarios", "🏦"),
      unknownCategoryId: await ensure("No identificado", "❓"),
      interestCategoryId: await ensure("Intereses", "💰", "INCOME"),
    };
    const missing = reconcileStatement(account, await load(), parsed.lines, range).missing;
    for (const l of missing.filter(isBankLine)) await rpc(db, MAY, "save_transaction", registerPayload(l, ctx));

    const after = reconcileStatement(account, await load(), parsed.lines, range);
    expect(after.missing.map((l) => l.description)).toEqual(["PAGO PSE DAVIVIENDA"]); // el que no es del banco lo categoriza la persona
    const gmf = (await load()).filter((t) => t.tags.includes("#gmf"));
    expect(gmf).toHaveLength(1);
    expect(Number(gmf[0].amount)).toBe(4372);
    const interest = (await db.query<{ amount: string; name: string }>(`select t.amount, c.name from transactions t join categories c on c.id = t.income_category_id where t.kind = 'INCOME'`)).rows;
    expect(interest.map((i) => ({ amount: Number(i.amount), name: i.name }))).toEqual([{ amount: 1251, name: "Intereses" }]);
  });

  it("un pago sin categoría clara se registra como 'No identificado' y también concilia", async () => {
    const parsed = parseStatement(CSV);
    const ctx = {
      accountId: acc, userId: MAY,
      bankCategoryId: await ensure("Gastos bancarios", "🏦"), unknownCategoryId: await ensure("No identificado", "❓"), interestCategoryId: await ensure("Intereses", "💰", "INCOME"),
    };
    const pse = reconcileStatement(account, await load(), parsed.lines, range).missing[0];
    await rpc(db, MAY, "save_transaction", registerPayload(pse, ctx));
    const after = reconcileStatement(account, await load(), parsed.lines, range);
    expect(after.missing).toHaveLength(0);
    expect(after.matched).toHaveLength(6);
  });

  it("importar el mismo archivo otra vez no propone nada nuevo ni marca duplicados", async () => {
    const after = reconcileStatement(account, await load(), parseStatement(CSV).lines, range);
    expect(after.missing).toHaveLength(0);
    expect(after.duplicates).toHaveLength(0);
    expect(after.extra).toHaveLength(0);
  });

  it("el 4x1000 registrado coincide con el estimado sobre lo que salió", async () => {
    const c = bankCharges(account, parseStatement(CSV).lines, 52_374);
    // Salidas sin contar el 4x1000: 45.000 + 1.043.000 + 18.900 = 1.106.900 → 0,4 % ≈ 4.428 (cobró 4.372)
    expect(c.gmf).toMatchObject({ charged: 4372, expected: 4428, ok: true });
  });
});
