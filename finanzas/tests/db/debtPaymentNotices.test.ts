// Los pagos y abonos del cruce no se duplican con el aviso del banco (llegue antes o después).

import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, rpc, setupDb } from "./harness";

const MAY = "00000000-0000-0000-0000-00000000000a";
const BREI = "00000000-0000-0000-0000-00000000000b";

describe("pagos del cruce y avisos del banco", () => {
  let db: PGlite;
  let hh: string, mayAcc: string, breiAcc: string, ana: string;
  const tokens: Record<string, string> = {};
  let n = 0;
  const balance = async (uid: string, acc: string) =>
    Number((await as<{ balance: string }>(db, uid, `select balance::text from public.account_balances() where account_id = $1`, [acc]))[0]?.balance);
  const notice = async (uid: string, last4: string, kind: string, amount: number, day: string, merchant = "Transferencia") =>
    (await as<{ r: { result: string; transaction_id: string } }>(db, null, `select public.ingest_event($1, $2::jsonb) as r`, [tokens[uid], JSON.stringify({
      channel: "GMAIL", external_id: `n${++n}`,
      parsed: { kind, amount, merchant, merchant_norm: merchant.toLowerCase(), last4, occurred_at: `${day}T15:00:00Z` },
    })]))[0].r;
  const count = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows.length;

  beforeAll(async () => {
    db = await setupDb();
    await db.exec(`insert into auth.users values ('${MAY}'), ('${BREI}')`);
    await as(db, MAY, `select public.create_household('Casa', 'May')`);
    const code = (await db.query<{ invite_code: string }>(`select invite_code from households`)).rows[0].invite_code;
    await as(db, BREI, `select public.join_household($1, 'Brei')`, [code]);
    hh = (await db.query<{ id: string }>(`select id from households`)).rows[0].id;
    const acc = async (uid: string, name: string, last4: string) => (await as<{ id: string }>(db, uid, `insert into accounts (household_id, owner_user_id, name, kind, visibility, opening_balance, opening_at, last4)
      values ($1, $2, $3, 'DEPOSIT', 'BALANCE_ONLY', 1000000, '2026-01-01', $4) returning id`, [hh, uid, name, last4]))[0].id;
    mayAcc = await acc(MAY, "Ahorros May", "1111");
    breiAcc = await acc(BREI, "Ahorros Brei", "2222");
    for (const u of [MAY, BREI]) tokens[u] = (await as<{ t: string }>(db, u, `select public.create_ingest_token() as t`))[0].t;
    ana = await rpc<string>(db, MAY, "save_contact", { name: "Ana" });
    await rpc(db, MAY, "add_contact_entry", { contact_id: ana, kind: "LOAN", in_favor: true, amount: 100_000, description: "Préstamo" });
  }, 30_000);

  it("contacto: abono registrado y luego llega el aviso de entrada → se une, la plata entra una sola vez", async () => {
    const before = await balance(MAY, mayAcc);
    await rpc(db, MAY, "settle_contact", { contact_id: ana, mode: "RECEIVED", amount: 30_000, account_id: mayAcc, occurred_on: "2026-11-01" });
    const r = await notice(MAY, "1111", "TRANSFER_IN", 30_000, "2026-11-02");
    expect(r.result).toBe("MERGED");
    expect(await balance(MAY, mayAcc)).toBe(before + 30_000);
    expect(await count(`select 1 from transactions where kind = 'INCOME'`)).toBe(0);
  });

  it("contacto: llega primero el aviso de entrada y luego se registra el abono → el aviso se une al abono", async () => {
    const r = await notice(MAY, "1111", "TRANSFER_IN", 25_000, "2026-11-03");
    expect(r.result).toBe("ACCEPTED");
    const before = await balance(MAY, mayAcc); // ya incluye el aviso
    const entry = await rpc<string>(db, MAY, "settle_contact", { contact_id: ana, mode: "RECEIVED", amount: 25_000, account_id: mayAcc, occurred_on: "2026-11-03" });
    expect(await count(`select 1 from transactions where id = $1`, [r.transaction_id])).toBe(0);
    expect(await balance(MAY, mayAcc)).toBe(before); // no entra dos veces
    const tx = (await db.query<{ transaction_id: string }>(`select transaction_id from contact_ledger where id = $1`, [entry])).rows[0].transaction_id;
    expect((await db.query<{ transaction_id: string }>(`select transaction_id from ingest_logs where external_id = 'n2'`)).rows).toEqual([{ transaction_id: tx }]);
  });

  it("una compra por el mismo monto no se confunde con el abono", async () => {
    const r = await notice(MAY, "1111", "PURCHASE", 10_000, "2026-11-04", "Tienda");
    await rpc(db, MAY, "settle_contact", { contact_id: ana, mode: "FORGIVEN", amount: 10_000 }); // sin plata
    await rpc(db, MAY, "add_contact_entry", { contact_id: ana, kind: "LOAN", in_favor: false, amount: 50_000 });
    // Le pago 10.000 a Ana el mismo día: la compra de 10.000 sigue siendo una compra
    await rpc(db, MAY, "settle_contact", { contact_id: ana, mode: "PAID", amount: 10_000, account_id: mayAcc, occurred_on: "2026-11-04" });
    expect(await count(`select 1 from transactions where id = $1`, [r.transaction_id])).toBe(1);
  });

  it("pareja: cobrar y luego llega el aviso → se une", async () => {
    await as(db, MAY, `select public.add_ledger_entry('LOAN', $1, $2, 40000, 'Taxi', '2026-11-01')`, [MAY, BREI]);
    const before = await balance(MAY, mayAcc);
    await rpc(db, MAY, "resolve_debt", { mode: "PAID", amount: 40_000, account_id: mayAcc, occurred_on: "2026-11-05" });
    expect((await notice(MAY, "1111", "TRANSFER_IN", 40_000, "2026-11-05")).result).toBe("MERGED");
    expect(await balance(MAY, mayAcc)).toBe(before + 40_000);
  });

  it("pareja: a Brei le llegó primero el aviso de entrada y luego May registra el pago a su cuenta → se une", async () => {
    await as(db, BREI, `select public.add_ledger_entry('LOAN', $1, $2, 60000, 'Mercado', '2026-11-01')`, [BREI, MAY]);
    const r = await notice(BREI, "2222", "TRANSFER_IN", 60_000, "2026-11-06");
    const breiBefore = await balance(BREI, breiAcc);
    await rpc(db, MAY, "save_transaction", { kind: "SETTLEMENT", amount: 60_000, occurred_on: "2026-11-06", account_id: mayAcc, to_account_id: breiAcc, counterparty_user_id: BREI });
    expect(await count(`select 1 from transactions where id = $1`, [r.transaction_id])).toBe(0);
    expect(await balance(BREI, breiAcc)).toBe(breiBefore);
  });
});
