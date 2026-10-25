// Enviarle plata a la pareja para que haga una compra: sale de mi cuenta, llega a la suya (si es visible)
// y queda anotado en el cruce hasta que él compre y lo registre a mi cargo.

import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, rpc, setupDb } from "./harness";

const MAY = "00000000-0000-0000-0000-00000000000a";
const BREI = "00000000-0000-0000-0000-00000000000b";

describe("transferencia a las cuentas de la pareja", () => {
  let db: PGlite;
  let hh: string, mayAcc: string, breiAcc: string, breiPrivate: string, mercado: string;
  const balance = async (uid: string, acc: string) =>
    Number((await as<{ balance: string }>(db, uid, `select balance::text from public.account_balances() where account_id = $1`, [acc]))[0]?.balance);
  const net = async () => (await db.query<{ net: string }>(`select coalesce(sum(case when creditor_user_id = '${MAY}' then amount else -amount end), 0)::text net from cross_ledger`)).rows[0].net;

  beforeAll(async () => {
    db = await setupDb();
    await db.exec(`insert into auth.users values ('${MAY}'), ('${BREI}')`);
    await as(db, MAY, `select public.create_household('Casa', 'May')`);
    const code = (await db.query<{ invite_code: string }>(`select invite_code from households`)).rows[0].invite_code;
    await as(db, BREI, `select public.join_household($1, 'Brei')`, [code]);
    hh = (await db.query<{ id: string }>(`select id from households`)).rows[0].id;
    const acc = async (uid: string, name: string, visibility: string) =>
      (await as<{ id: string }>(db, uid, `insert into accounts (household_id, owner_user_id, name, kind, visibility, opening_balance, opening_at)
        values ($1, $2, $3, 'DEPOSIT', $4, 1000000, '2026-01-01') returning id`, [hh, uid, name, visibility]))[0].id;
    mayAcc = await acc(MAY, "Ahorros May", "PRIVATE");
    breiAcc = await acc(BREI, "Ahorros Brei", "BALANCE_ONLY");
    breiPrivate = await acc(BREI, "Privada Brei", "PRIVATE");
    mercado = await rpc<string>(db, MAY, "save_category", { name: "Mercado", responsibility: "MEMBER_A_100", is_shared_progress: true });
  }, 30_000);

  it("la plata sale de mi cuenta, llega a la suya y él me la debe en el cruce", async () => {
    await rpc(db, MAY, "save_transaction", { kind: "SETTLEMENT", amount: 300_000, occurred_on: "2026-10-25", description: "Envío para una compra", account_id: mayAcc, to_account_id: breiAcc, counterparty_user_id: BREI });
    expect(await balance(MAY, mayAcc)).toBe(700_000);
    expect(await balance(BREI, breiAcc)).toBe(1_300_000);
    expect(await net()).toBe("300000"); // Brei le debe a May
  });

  it("cuando él hace la compra y la registra a mi cargo, el cruce se compensa solo", async () => {
    await rpc(db, BREI, "save_transaction", { kind: "EXPENSE", scope: "HOUSEHOLD", amount: 120_000, occurred_on: "2026-10-26", account_id: breiAcc, splits: [{ amount: 120_000, category_id: mercado, responsible_user_id: MAY }] });
    expect(await net()).toBe("180000"); // todavía me debe lo que no gastó
  });

  it("también se puede enviar sin elegir su cuenta y queda igual en el cruce", async () => {
    const before = Number(await net());
    await rpc(db, MAY, "save_transaction", { kind: "SETTLEMENT", amount: 50_000, occurred_on: "2026-10-27", account_id: mayAcc, counterparty_user_id: BREI });
    expect(Number(await net())).toBe(before + 50_000);
  });

  it("la app solo ofrece sus cuentas visibles; las privadas de él no se ven ni su saldo", async () => {
    const seen = await as<{ id: string }>(db, MAY, `select id from public.account_labels() where owner_user_id = $1`, [BREI]);
    expect(seen.map((a) => a.id)).toEqual([breiAcc]);
    expect(await as(db, MAY, `select 1 from public.account_balances() where account_id = $1`, [breiPrivate])).toHaveLength(0);
  });

  it("un pendiente 'Cuenta ···4993' se convierte en envío a la pareja sin dejar duplicado y el aviso apunta al envío", async () => {
    await db.exec(`update accounts set last4 = '2505' where id = '${mayAcc}'`);
    const token = (await as<{ t: string }>(db, MAY, `select public.create_ingest_token() as t`))[0].t;
    const r = (await as<{ r: { transaction_id: string } }>(db, null, `select public.ingest_event($1, $2::jsonb) as r`, [token, JSON.stringify({
      channel: "GMAIL", external_id: "p1", parsed: { kind: "TRANSFER_OUT", amount: 400_000, merchant: "Cuenta ···4993", merchant_norm: "cuenta 4993", last4: "2505", occurred_at: "2026-10-26T15:00:00Z", identifiers: [{ type: "ACCOUNT", value: "4993" }] },
    })]))[0].r;
    const before = Number(await net());

    // lo que hace la app: crear el envío, mover el aviso y quitar el pendiente
    const settled = await rpc<string>(db, MAY, "save_transaction", { kind: "SETTLEMENT", amount: 400_000, occurred_on: "2026-10-26", description: "Préstamo", account_id: mayAcc, to_account_id: breiAcc, counterparty_user_id: BREI });
    await as(db, MAY, `update ingest_logs set transaction_id = $1 where transaction_id = $2`, [settled, r.transaction_id]);
    await as(db, MAY, `select public.delete_transaction($1)`, [r.transaction_id]);

    expect(Number(await net())).toBe(before + 400_000);
    expect((await db.query(`select 1 from transactions where status = 'PENDING_REVIEW'`)).rows).toHaveLength(0);
    expect((await db.query<{ transaction_id: string }>(`select transaction_id from ingest_logs where external_id = 'p1'`)).rows).toEqual([{ transaction_id: settled }]);
  });

  it("con creates_debt en falso la plata se mueve pero el cruce no cambia (y por defecto sigue anotando la deuda)", async () => {
    const before = Number(await net());
    const mayBefore = await balance(MAY, mayAcc);
    const breiBefore = await balance(BREI, breiAcc);
    await rpc(db, MAY, "save_transaction", { kind: "SETTLEMENT", amount: 80_000, occurred_on: "2026-10-28", description: "Regalo", account_id: mayAcc, to_account_id: breiAcc, counterparty_user_id: BREI, creates_debt: false });
    expect(await balance(MAY, mayAcc)).toBe(mayBefore - 80_000);
    expect(await balance(BREI, breiAcc)).toBe(breiBefore + 80_000);
    expect(Number(await net())).toBe(before);
    expect((await db.query<{ creates_debt: boolean }>(`select creates_debt from transactions where description = 'Regalo'`)).rows).toEqual([{ creates_debt: false }]);
    // la liquidación de siempre no manda creates_debt: sigue anotando
    await rpc(db, MAY, "save_transaction", { kind: "SETTLEMENT", amount: 10_000, occurred_on: "2026-10-28", account_id: mayAcc, counterparty_user_id: BREI });
    expect(Number(await net())).toBe(before + 10_000);
  });

  it("la migración 0022 se puede volver a correr", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    await db.exec(fs.readFileSync(path.join(__dirname, "../../supabase/migrations/0022_settlement_without_debt.sql"), "utf8"));
  });

  it("no se puede enviar a alguien que no es de mi hogar", async () => {
    await expect(as(db, MAY, `select public.save_transaction($1::jsonb)`, [JSON.stringify({ kind: "SETTLEMENT", amount: 1000, account_id: mayAcc, counterparty_user_id: "00000000-0000-0000-0000-0000000000ff" })])).rejects.toThrow(/pareja/);
  });
});
