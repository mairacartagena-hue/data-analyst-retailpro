// Contactos: cruce de cuentas con personas fuera del hogar (con o sin la app).

import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, rpc, setupDb } from "./harness";

const MAY = "00000000-0000-0000-0000-00000000000a";
const BREI = "00000000-0000-0000-0000-00000000000b";
const JUAN = "00000000-0000-0000-0000-00000000000c"; // usa la app en otro hogar

describe("contactos fuera del hogar", () => {
  let db: PGlite;
  let hh: string, mayAcc: string, juanAcc: string, cat: string, ana: string, juanForMay: string;
  const balance = async (uid: string, acc: string) =>
    Number((await as<{ balance: string }>(db, uid, `select balance::text from public.account_balances() where account_id = $1`, [acc]))[0]?.balance);
  const net = async (uid: string, contact: string) => Number((await as<{ n: string }>(db, uid, `select public.contact_net($1)::text n`, [contact]))[0].n);

  beforeAll(async () => {
    db = await setupDb();
    await db.exec(`insert into auth.users values ('${MAY}'), ('${BREI}'), ('${JUAN}')`);
    await as(db, MAY, `select public.create_household('Casa', 'May')`);
    const code = (await db.query<{ invite_code: string }>(`select invite_code from households`)).rows[0].invite_code;
    await as(db, BREI, `select public.join_household($1, 'Brei')`, [code]);
    await as(db, JUAN, `select public.create_household('Casa Juan', 'Juan')`);
    hh = (await db.query<{ id: string }>(`select household_id id from household_members where user_id = $1`, [MAY])).rows[0].id;
    const jhh = (await db.query<{ id: string }>(`select household_id id from household_members where user_id = $1`, [JUAN])).rows[0].id;
    const acc = async (uid: string, h: string, name: string) => (await as<{ id: string }>(db, uid, `insert into accounts (household_id, owner_user_id, name, kind, visibility, opening_balance, opening_at)
      values ($1, $2, $3, 'DEPOSIT', 'PRIVATE', 1000000, '2026-01-01') returning id`, [h, uid, name]))[0].id;
    mayAcc = await acc(MAY, hh, "Ahorros May");
    juanAcc = await acc(JUAN, jhh, "Ahorros Juan");
    cat = await rpc<string>(db, MAY, "save_category", { name: "Comida", kind: "EXPENSE", responsibility: "PRIVATE" });
    ana = await rpc<string>(db, MAY, "save_contact", { name: "Ana" });
  }, 30_000);

  it("solo su dueño ve el contacto", async () => {
    expect(await as(db, MAY, `select 1 from contacts`)).toHaveLength(1);
    expect(await as(db, BREI, `select 1 from contacts`)).toHaveLength(0);
    await expect(as(db, MAY, `insert into contacts (owner_user_id, name) values ($1, 'X')`, [MAY])).rejects.toThrow();
  });

  it("una parte de un gasto a cargo de un contacto: no cuenta en la categoría y queda a mi favor", async () => {
    const tx = await rpc<string>(db, MAY, "save_transaction", {
      kind: "EXPENSE", amount: 100_000, account_id: mayAcc, description: "Cena", occurred_on: "2026-10-20",
      splits: [{ amount: 40_000, category_id: cat }, { amount: 60_000, contact_id: ana, category_id: cat }],
    });
    const splits = (await db.query<{ amount: string; category_id: string | null; contact_id: string | null; responsible_user_id: string }>(
      `select amount::text, category_id, contact_id, responsible_user_id from transaction_splits where transaction_id = $1 order by amount`, [tx])).rows;
    expect(splits).toEqual([
      { amount: "40000", category_id: cat, contact_id: null, responsible_user_id: MAY },
      { amount: "60000", category_id: null, contact_id: ana, responsible_user_id: MAY },
    ]);
    expect(await net(MAY, ana)).toBe(60_000);
    // La pareja no ve el asiento del contacto
    expect(await as(db, BREI, `select 1 from contact_ledger`)).toHaveLength(0);
    // Editar el gasto rehace el asiento
    await rpc(db, MAY, "save_transaction", {
      id: tx, kind: "EXPENSE", amount: 100_000, account_id: mayAcc, description: "Cena", occurred_on: "2026-10-20",
      splits: [{ amount: 50_000, category_id: cat }, { amount: 50_000, contact_id: ana }],
    });
    expect(await net(MAY, ana)).toBe(50_000);
    expect(await as(db, MAY, `select 1 from contact_ledger where kind = 'SPLIT'`)).toHaveLength(1);
    // La parte del contacto no puede recibir categoría después
    const split = (await db.query<{ id: string }>(`select id from transaction_splits where contact_id is not null`)).rows[0].id;
    await expect(as(db, MAY, `select public.set_split_category($1, $2)`, [split, cat])).rejects.toThrow(/es de un contacto/);
  });

  it("préstamo, cobro (entra a la cuenta sin ser ingreso) y perdón", async () => {
    await rpc(db, MAY, "add_contact_entry", { contact_id: ana, kind: "LOAN", in_favor: true, amount: 20_000, description: "Taxi" });
    expect(await net(MAY, ana)).toBe(70_000);
    const before = await balance(MAY, mayAcc);
    await rpc(db, MAY, "settle_contact", { contact_id: ana, mode: "RECEIVED", amount: 30_000, account_id: mayAcc });
    expect(await balance(MAY, mayAcc)).toBe(before + 30_000);
    expect((await db.query(`select 1 from transactions where kind = 'ADJUSTMENT' and direction = 'IN'`)).rows).toHaveLength(1);
    await expect(rpc(db, MAY, "settle_contact", { contact_id: ana, mode: "FORGIVEN", amount: 50_000 })).rejects.toThrow(/no puedes saldar más/);
    await rpc(db, MAY, "settle_contact", { contact_id: ana, mode: "FORGIVEN", amount: 40_000 });
    expect(await net(MAY, ana)).toBe(0);
    await expect(rpc(db, MAY, "settle_contact", { contact_id: ana, mode: "PAID", amount: 1, account_id: mayAcc })).rejects.toThrow(/No le debes nada/);
  });

  it("borrar el gasto quita el asiento; un contacto con asientos no se borra", async () => {
    await expect(as(db, MAY, `select public.delete_contact($1)`, [ana])).rejects.toThrow(/archívalo/);
    const empty = await rpc<string>(db, MAY, "save_contact", { name: "Vacío" });
    await as(db, MAY, `select public.delete_contact($1)`, [empty]);
    expect(await as(db, MAY, `select 1 from contacts where id = $1`, [empty])).toHaveLength(0);
  });

  it("la pareja no puede ajustar un gasto del hogar con parte de un contacto", async () => {
    const tx = await rpc<string>(db, MAY, "save_transaction", {
      kind: "EXPENSE", scope: "HOUSEHOLD", amount: 10_000, account_id: mayAcc, occurred_on: "2026-10-21",
      splits: [{ amount: 10_000, contact_id: ana }],
    });
    await expect(rpc(db, BREI, "save_transaction", {
      id: tx, kind: "EXPENSE", amount: 10_000, splits: [{ amount: 10_000, responsible_user_id: BREI }],
    })).rejects.toThrow(/parte de un contacto/);
    await as(db, MAY, `select public.delete_transaction($1)`, [tx]);
    expect(await net(MAY, ana)).toBe(0);
  });

  it("con alguien de otro hogar: se vinculan con un código y cada uno ve el mismo saldo", async () => {
    juanForMay = await rpc<string>(db, MAY, "save_contact", { name: "Juan" });
    await rpc(db, MAY, "add_contact_entry", { contact_id: juanForMay, kind: "LOAN", in_favor: true, amount: 80_000, description: "Concierto" });
    const code = (await as<{ c: string }>(db, MAY, `select public.contact_link_code($1) c`, [juanForMay]))[0].c;
    expect(code).toHaveLength(10);
    // Brei es del hogar: no puede usar el código
    await expect(rpc(db, BREI, "link_contact", { code })).rejects.toThrow(/es de tu hogar/);
    expect((await as<{ n: string }>(db, JUAN, `select public.contact_link_preview($1) n`, [code.toLowerCase()]))[0].n).toBe("May");
    // Antes de vincular, Juan no ve nada
    expect(await as(db, JUAN, `select 1 from contact_ledger`)).toHaveLength(0);
    const mayForJuan = await rpc<string>(db, JUAN, "link_contact", { code });
    expect(await as(db, JUAN, `select name from contacts`)).toEqual([{ name: "May" }]);
    // El código ya no sirve
    await expect(rpc(db, BREI, "link_contact", { code })).rejects.toThrow(/no existe o ya se usó/);
    expect(await net(MAY, juanForMay)).toBe(80_000);
    expect(await net(JUAN, mayForJuan)).toBe(-80_000);
    // Juan ve los asientos de May, pero no sus movimientos ni sus otros contactos
    expect(await as(db, JUAN, `select 1 from contact_ledger`)).toHaveLength(1);
    expect(await as(db, JUAN, `select 1 from transactions`)).toHaveLength(0);
    expect(await as(db, JUAN, `select 1 from contact_ledger where contact_id = $1`, [ana])).toHaveLength(0);

    // Juan anota un encargo a su favor: May lo ve y le baja el saldo
    await rpc(db, JUAN, "add_contact_entry", { contact_id: mayForJuan, kind: "ERRAND", in_favor: true, amount: 30_000 });
    expect(await net(MAY, juanForMay)).toBe(50_000);

    // El pago lo registra quien paga (Juan); May marca en qué cuenta le entró
    await expect(rpc(db, MAY, "settle_contact", { contact_id: juanForMay, mode: "RECEIVED", amount: 10_000, account_id: mayAcc }))
      .rejects.toThrow(/lo registra quien paga/);
    const juanBefore = await balance(JUAN, juanAcc);
    const pay = await rpc<string>(db, JUAN, "settle_contact", { contact_id: mayForJuan, mode: "PAID", amount: 50_000, account_id: juanAcc });
    expect(await balance(JUAN, juanAcc)).toBe(juanBefore - 50_000);
    expect(await net(MAY, juanForMay)).toBe(0);
    const mayBefore = await balance(MAY, mayAcc);
    await rpc(db, MAY, "receive_contact_payment", { entry_id: pay, account_id: mayAcc });
    expect(await balance(MAY, mayAcc)).toBe(mayBefore + 50_000);
    await expect(rpc(db, MAY, "receive_contact_payment", { entry_id: pay, account_id: mayAcc })).rejects.toThrow(/ya está/);
    // Juan no puede marcar su propio pago como recibido
    await expect(rpc(db, JUAN, "receive_contact_payment", { entry_id: pay, account_id: juanAcc })).rejects.toThrow(/no existe/);

    // Desvincular: cada uno vuelve a ver solo lo suyo
    await as(db, JUAN, `select public.unlink_contact($1)`, [mayForJuan]);
    expect(await as(db, JUAN, `select 1 from contact_ledger where owner_user_id = $1`, [MAY])).toHaveLength(0);
    expect(await net(MAY, juanForMay)).toBe(80_000);
  });
});
