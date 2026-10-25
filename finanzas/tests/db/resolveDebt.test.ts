// Deudas a favor: "cobrar" (entra la plata y baja la deuda) o "condonar" (solo baja la deuda).

import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, rpc, setupDb } from "./harness";
import { openDebtsInFavor, type LedgerRowLite } from "@/lib/finance/crossLedger";

type Row = LedgerRowLite & { transaction_id: string | null };
const MAY = "00000000-0000-0000-0000-00000000000a";
const BREI = "00000000-0000-0000-0000-00000000000b";

describe("resolver una deuda a mi favor", () => {
  let db: PGlite;
  let hh: string, mayAcc: string, breiAcc: string, debtId: string;
  const balance = async (uid: string, acc: string) =>
    Number((await as<{ balance: string }>(db, uid, `select balance::text from public.account_balances() where account_id = $1`, [acc]))[0]?.balance);
  const net = async () => Number((await db.query<{ net: string }>(`select coalesce(sum(case when creditor_user_id = '${MAY}' then amount else -amount end), 0)::text net from cross_ledger`)).rows[0].net);
  const ledger = async () => (await db.query<Record<string, unknown>>(`select id, creditor_user_id, debtor_user_id, amount, kind, description, occurred_on, created_at, resolves_id, transaction_id from cross_ledger order by created_at, id`)).rows
    .map((r) => ({ ...r, amount: Number(r.amount), occurred_on: r.occurred_on instanceof Date ? r.occurred_on.toISOString().slice(0, 10) : String(r.occurred_on), created_at: String(r.created_at) })) as unknown as Row[];
  const resolve = (uid: string, p: object) => rpc<string>(db, uid, "resolve_debt", p);

  beforeAll(async () => {
    db = await setupDb();
    await db.exec(`insert into auth.users values ('${MAY}'), ('${BREI}')`);
    await as(db, MAY, `select public.create_household('Casa', 'May')`);
    const code = (await db.query<{ invite_code: string }>(`select invite_code from households`)).rows[0].invite_code;
    await as(db, BREI, `select public.join_household($1, 'Brei')`, [code]);
    hh = (await db.query<{ id: string }>(`select id from households`)).rows[0].id;
    const acc = async (uid: string, name: string) => (await as<{ id: string }>(db, uid, `insert into accounts (household_id, owner_user_id, name, kind, visibility, opening_balance, opening_at)
      values ($1, $2, $3, 'DEPOSIT', 'PRIVATE', 1000000, '2026-01-01') returning id`, [hh, uid, name]))[0].id;
    mayAcc = await acc(MAY, "Ahorros May");
    breiAcc = await acc(BREI, "Ahorros Brei");
    // May le envía $300.000 a Brei con deuda
    await rpc(db, MAY, "save_transaction", { kind: "SETTLEMENT", amount: 300_000, occurred_on: "2026-10-25", description: "Envío para una compra", account_id: mayAcc, to_account_id: breiAcc, counterparty_user_id: BREI });
    debtId = (await ledger())[0].id;
  }, 30_000);

  it("me la paga (una parte): sube mi saldo, baja la deuda y no cuenta como ingreso", async () => {
    const before = await balance(MAY, mayAcc);
    await resolve(MAY, { mode: "PAID", amount: 100_000, account_id: mayAcc, occurred_on: "2026-10-26", entry_id: debtId, note: "Pago de Brei" });
    expect(await balance(MAY, mayAcc)).toBe(before + 100_000);
    expect(await net()).toBe(200_000);
    const tx = (await db.query<{ kind: string; direction: string }>(`select kind, direction from transactions where description = 'Pago de Brei'`)).rows;
    expect(tx).toEqual([{ kind: "ADJUSTMENT", direction: "IN" }]); // ajuste de saldo: no es ingreso
    const row = (await ledger()).find((l) => l.kind === "PAYMENT")!;
    expect(row).toMatchObject({ creditor_user_id: BREI, debtor_user_id: MAY, amount: 100_000, resolves_id: debtId });
    expect(row.transaction_id).toBeTruthy();
    // Brei ve el asiento en el cruce pero no el ajuste de la cuenta de May
    expect(await as(db, BREI, `select 1 from cross_ledger where kind = 'PAYMENT'`)).toHaveLength(1);
    expect(await as(db, BREI, `select 1 from transactions where id = $1`, [row.transaction_id])).toHaveLength(0);
  });

  it("condonar: baja la deuda y no mueve plata", async () => {
    const before = await balance(MAY, mayAcc);
    const breiBefore = await balance(BREI, breiAcc);
    await resolve(MAY, { mode: "FORGIVEN", amount: 50_000, occurred_on: "2026-10-27", entry_id: debtId, note: "Condonada" });
    expect(await balance(MAY, mayAcc)).toBe(before);
    expect(await balance(BREI, breiAcc)).toBe(breiBefore);
    expect(await net()).toBe(150_000);
    expect((await ledger()).find((l) => l.kind === "FORGIVEN")).toMatchObject({ amount: 50_000, resolves_id: debtId, transaction_id: null });
  });

  it("la lógica de la app y la base coinciden: quedan $150.000 de esa deuda", async () => {
    const open = openDebtsInFavor(await ledger(), MAY);
    expect(open.map((d) => [d.id, d.remaining])).toEqual([[debtId, 150_000]]);
  });

  it("no se puede resolver más de lo que te deben ni sin elegir cuenta ni una deuda ajena", async () => {
    await expect(resolve(MAY, { mode: "FORGIVEN", amount: 150_001 })).rejects.toThrow(/no puedes resolver más/);
    await expect(resolve(MAY, { mode: "PAID", amount: 1000 })).rejects.toThrow(/cuenta/);
    await expect(resolve(MAY, { mode: "FORGIVEN", amount: 0 })).rejects.toThrow(/mayor que cero/);
    await expect(resolve(MAY, { mode: "OTRO", amount: 1000 })).rejects.toThrow();
    await expect(resolve(MAY, { mode: "FORGIVEN", amount: 1000, entry_id: "00000000-0000-0000-0000-0000000000ff" })).rejects.toThrow(/no existe/);
  });

  it("solo quien tiene la deuda a favor puede resolverla (Brei no)", async () => {
    await expect(resolve(BREI, { mode: "FORGIVEN", amount: 1000 })).rejects.toThrow(/no te debe nada/);
    await expect(resolve(BREI, { mode: "PAID", amount: 1000, account_id: breiAcc })).rejects.toThrow(/no te debe nada/);
  });

  it("se deshace: el perdón con delete_ledger_entry y el pago borrando su movimiento", async () => {
    const forgiven = (await ledger()).find((l) => l.kind === "FORGIVEN")!;
    await as(db, MAY, `select public.delete_ledger_entry($1)`, [forgiven.id]);
    expect(await net()).toBe(200_000);

    const pay = (await ledger()).find((l) => l.kind === "PAYMENT")!;
    await expect(as(db, MAY, `select public.delete_ledger_entry($1)`, [pay.id])).rejects.toThrow(); // un pago no se borra suelto
    const before = await balance(MAY, mayAcc);
    await as(db, MAY, `select public.delete_transaction($1)`, [pay.transaction_id]);
    expect(await balance(MAY, mayAcc)).toBe(before - 100_000);
    expect(await net()).toBe(300_000);
    expect((await ledger()).filter((l) => l.kind === "PAYMENT")).toHaveLength(0);
  });

  it("quien no es el que perdonó no puede deshacer el perdón", async () => {
    await resolve(MAY, { mode: "FORGIVEN", amount: 10_000, occurred_on: "2026-10-28" });
    const f = (await ledger()).find((l) => l.kind === "FORGIVEN")!;
    await expect(as(db, BREI, `select public.delete_ledger_entry($1)`, [f.id])).rejects.toThrow();
  });

  it("sin pareja en el hogar no se puede resolver", async () => {
    const solo = await setupDb();
    await solo.exec(`insert into auth.users values ('${MAY}')`);
    await as(solo, MAY, `select public.create_household('Casa', 'May')`);
    await expect(rpc(solo, MAY, "resolve_debt", { mode: "FORGIVEN", amount: 1000 })).rejects.toThrow(/pareja/);
  }, 30_000);

  it("la migración 0023 se puede volver a correr", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    await db.exec(fs.readFileSync(path.join(__dirname, "../../supabase/migrations/0023_resolve_debt.sql"), "utf8"));
  });
});
