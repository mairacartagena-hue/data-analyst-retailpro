// Editar una memoria de comercio actualiza los movimientos anteriores: la base acepta lo que se envía
// y el cruce con la pareja se ajusta al cambiar el responsable.

import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, rpc, setupDb } from "./harness";
import type { MerchantMemory, Transaction } from "@/lib/types";
import { applyChange, memoryChange, memoryMatches, memoryValues } from "@/lib/finance/memoryApply";

const MAY = "00000000-0000-0000-0000-00000000000a";
const BREI = "00000000-0000-0000-0000-00000000000b";

describe("editar memoria → movimientos anteriores", () => {
  let db: PGlite;
  let hh: string, acc: string, compras: string, belleza: string, token: string;
  const load = async (): Promise<Transaction[]> => {
    const rows = await as<Record<string, unknown>>(db, MAY, `select t.*, coalesce((select jsonb_agg(to_jsonb(s)) from transaction_splits s where s.transaction_id = t.id), '[]'::jsonb) splits from transactions t order by occurred_on`);
    const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
    return rows.map((r) => ({ ...r, amount: Number(r.amount), occurred_on: day(r.occurred_on), tags: r.tags ?? [], splits: (r.splits as { amount: unknown }[]).map((s) => ({ ...s, amount: Number(s.amount) })) })) as unknown as Transaction[];
  };
  const memory = async (): Promise<MerchantMemory> => (await as<MerchantMemory>(db, MAY, `select * from merchant_memory where identifier_type = 'ACCOUNT' and identifier = '3145159690'`))[0];

  beforeAll(async () => {
    db = await setupDb();
    await db.exec(`insert into auth.users values ('${MAY}'), ('${BREI}')`);
    await as(db, MAY, `select public.create_household('Casa', 'May')`);
    const code = (await db.query<{ invite_code: string }>(`select invite_code from households`)).rows[0].invite_code;
    await as(db, BREI, `select public.join_household($1, 'Brei')`, [code]);
    hh = (await db.query<{ id: string }>(`select id from households`)).rows[0].id;
    acc = (await as<{ id: string }>(db, MAY, `insert into accounts (household_id, owner_user_id, name, kind, visibility, opening_balance, opening_at, last4)
      values ($1, $2, 'Ahorros', 'DEPOSIT', 'PRIVATE', 1000000, '2026-01-01', '2505') returning id`, [hh, MAY]))[0].id;
    compras = await rpc<string>(db, MAY, "save_category", { name: "Compras", responsibility: "MEMBER_A_100" });
    belleza = await rpc<string>(db, MAY, "save_category", { name: "Belleza", responsibility: "MEMBER_A_100" });
    token = (await as<{ t: string }>(db, MAY, `select public.create_ingest_token() as t`))[0].t;

    // Tres pagos a la misma cuenta: dos confirmados y uno por revisar
    let n = 0;
    const ingest = async (amount: number, at: string) => (await as<{ r: { transaction_id: string } }>(db, null, `select public.ingest_event($1, $2::jsonb) as r`, [token, JSON.stringify({
      channel: "GMAIL", external_id: `u${++n}`,
      parsed: { kind: "TRANSFER_OUT", amount, merchant: "Cuenta ···9690", merchant_norm: "cuenta 9690", last4: "2505", occurred_at: at, identifiers: [{ type: "ACCOUNT", value: "3145159690" }] },
    })]))[0].r.transaction_id;
    const confirm = (id: string, amount: number, desc: string) => rpc(db, MAY, "save_transaction", { id, kind: "EXPENSE", amount, account_id: acc, description: desc, merchant: "Cuenta ···9690", splits: [{ amount, category_id: compras, responsible_user_id: MAY }] });
    const a = await ingest(25_000, "2026-09-26T15:00:00Z");
    await confirm(a, 25_000, "Cuenta ···9690");
    const b = await ingest(42_000, "2026-10-20T15:00:00Z");
    await confirm(b, 42_000, "Manicure de octubre");
    await ingest(30_000, "2026-10-25T15:00:00Z"); // queda pendiente
    await as(db, MAY, `select public.remember_merchant($1, false)`, [a]);
  }, 30_000);

  it("el nombre y la categoría nuevos llegan a los anteriores; los pendientes y las descripciones propias se respetan", async () => {
    const before = memoryValues(await memory(), MAY);
    const after = { ...before, label: "Lady uñas", categoryId: belleza };
    await as(db, MAY, `update merchant_memory set label = 'Lady uñas', category_id = $1 where identifier = '3145159690'`, [belleza]);

    const change = memoryChange(before, after);
    const txs = await load();
    const matched = txs.filter((t) => memoryMatches(t, { identifier_type: "ACCOUNT", identifier: "3145159690", movement_kind: null } as MerchantMemory));
    expect(matched).toHaveLength(3);
    let updated = 0;
    for (const tx of matched) {
      const r = applyChange(tx, change, null, MAY);
      if (r.payload) { await rpc(db, MAY, "save_transaction", r.payload); updated++; }
    }
    expect(updated).toBe(2);

    const after2 = await load();
    const byAmount = (a: number) => after2.find((t) => t.amount === a)!;
    expect(byAmount(25_000)).toMatchObject({ merchant: "Lady uñas", description: "Lady uñas" });
    expect(byAmount(42_000)).toMatchObject({ merchant: "Lady uñas", description: "Manicure de octubre" });
    expect(byAmount(25_000).splits[0].category_id).toBe(belleza);
    expect(byAmount(42_000).splits[0].category_id).toBe(belleza);
    expect(byAmount(30_000)).toMatchObject({ status: "PENDING_REVIEW", merchant: "Cuenta ···9690" });
  });

  it("cambiar el responsable a la pareja anota la deuda en el cruce; y se puede cambiar el espacio", async () => {
    const before = memoryValues(await memory(), MAY);
    const change = memoryChange(before, { ...before, responsibleId: BREI, scope: "HOUSEHOLD", createsDebt: true });
    const tx = (await load()).find((t) => t.amount === 42_000)!;
    const r = applyChange(tx, change, "Lady uñas", MAY);
    await rpc(db, MAY, "save_transaction", r.payload);
    const row = (await db.query<{ scope: string }>(`select scope from transactions where id = $1`, [tx.id])).rows[0];
    expect(row.scope).toBe("HOUSEHOLD");
    const ledger = (await db.query<{ debtor_user_id: string; creditor_user_id: string; amount: string }>(`select debtor_user_id, creditor_user_id, amount from cross_ledger where transaction_id = $1`, [tx.id])).rows;
    expect(ledger.map((l) => ({ ...l, amount: Number(l.amount) }))).toEqual([{ debtor_user_id: BREI, creditor_user_id: MAY, amount: 42000 }]);
  });

  it("quitar la deuda de un cambio de responsable no deja asiento en el cruce", async () => {
    const tx = (await load()).find((t) => t.amount === 25_000)!;
    const before = memoryValues(await memory(), MAY);
    const r = applyChange(tx, memoryChange(before, { ...before, responsibleId: BREI, createsDebt: false }), null, MAY);
    await rpc(db, MAY, "save_transaction", r.payload);
    expect((await db.query(`select 1 from cross_ledger where transaction_id = $1`, [tx.id])).rows).toHaveLength(0);
  });
});
