// Criterios de aceptación de la organización hogar / personal, probados contra las migraciones reales.
// May (miembro A) y Brei (miembro B) con cuentas personales y privadas.

import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, rpc, setupDb } from "./harness";

const MAY = "00000000-0000-0000-0000-00000000000a";
const BREI = "00000000-0000-0000-0000-00000000000b";

interface Home { hh: string; mayAcc: string; mayAcc2: string; breiAcc: string }

async function household(db: PGlite): Promise<Home> {
  await db.exec(`insert into auth.users values ('${MAY}'), ('${BREI}')`);
  await as(db, MAY, `select public.create_household('Casa', 'May')`);
  const code = (await db.query<{ invite_code: string }>(`select invite_code from households`)).rows[0].invite_code;
  await as(db, BREI, `select public.join_household($1, 'Brei')`, [code]);
  const hh = (await db.query<{ id: string }>(`select id from households`)).rows[0].id;
  const acc = async (uid: string, name: string) =>
    (await as<{ id: string }>(db, uid, `insert into accounts (household_id, owner_user_id, name, kind, visibility, opening_balance, opening_at)
      values ($1, $2, $3, 'DEPOSIT', 'PRIVATE', 1000000, '2026-01-01') returning id`, [hh, uid, name]))[0].id;
  return { hh, mayAcc: await acc(MAY, "Ahorros May"), mayAcc2: await acc(MAY, "Nequi May"), breiAcc: await acc(BREI, "Ahorros Brei") };
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

describe("datos existentes (antes de 0017)", () => {
  it("el ámbito de cada movimiento conserva exactamente lo que la pareja veía", async () => {
    const t: Record<string, string> = {};
    const db = await setupDb({
      until: "0017",
      before: async (db) => {
        const h = await household(db);
        const shared = await rpc<string>(db, MAY, "save_category", { name: "Mercado", responsibility: "FIXED_AMOUNTS", is_shared_progress: true });
        const mine = await rpc<string>(db, MAY, "save_category", { name: "Gimnasio May", responsibility: "MEMBER_A_100" });
        const priv = await rpc<string>(db, MAY, "save_category", { name: "Ropa", responsibility: "PRIVATE" });
        const tx = (p: object) => rpc<string>(db, MAY, "save_transaction", { account_id: h.mayAcc, occurred_on: "2026-10-05", ...p });
        t.shared = await tx({ kind: "EXPENSE", amount: 100, splits: [{ amount: 100, category_id: shared }] });
        t.mine = await tx({ kind: "EXPENSE", amount: 200, splits: [{ amount: 200, category_id: mine }] });
        t.priv = await tx({ kind: "EXPENSE", amount: 300, splits: [{ amount: 300, category_id: priv }] });
        t.incShared = await tx({ kind: "INCOME", amount: 400, is_shared: true });
        t.incPriv = await tx({ kind: "INCOME", amount: 500 });
        t.forBrei = await tx({ kind: "EXPENSE", amount: 60, splits: [{ amount: 60, category_id: mine, responsible_user_id: BREI }] });
      },
    });
    const scope = async (id: string) => (await db.query<{ scope: string }>(`select scope from transactions where id = $1`, [id])).rows[0].scope;
    expect(await scope(t.shared)).toBe("HOUSEHOLD");
    expect(await scope(t.mine)).toBe("PERSONAL");
    expect(await scope(t.priv)).toBe("PERSONAL");
    expect(await scope(t.incShared)).toBe("HOUSEHOLD");
    expect(await scope(t.incPriv)).toBe("PERSONAL");
    expect(ids(await as<{ id: string }>(db, BREI, `select id from transactions`))).toEqual([t.shared, t.incShared, t.forBrei].sort());
  });
});

describe("hogar y personal", () => {
  let db: PGlite;
  let h: Home;
  const catId = async (name: string) => (await db.query<{ id: string }>(`select id from categories where name = $1`, [name])).rows[0].id;
  let hipoteca: string, remodel: string, mercado: string, ropa: string;

  beforeAll(async () => {
    db = await setupDb();
    h = await household(db);
    await as(db, MAY, `select public.add_suggested_categories()`);
    hipoteca = await catId("Crédito hipotecario");
    remodel = await catId("Crédito de remodelación");
    mercado = await catId("Mercado");
    const vivienda = await catId("Vivienda y hogar");
    await rpc(db, MAY, "save_category", { id: hipoteca, name: "Crédito hipotecario", responsibility: "MEMBER_A_100", is_shared_progress: true, parent_id: vivienda });
    await rpc(db, MAY, "save_category", { id: remodel, name: "Crédito de remodelación", responsibility: "MEMBER_B_100", is_shared_progress: true, parent_id: vivienda });
    ropa = await rpc<string>(db, MAY, "save_category", { name: "Ropa May", responsibility: "PRIVATE" });
  }, 30_000);

  it("categorías sugeridas con subcategorías, sin duplicar; las de ingresos son personales", async () => {
    const before = (await db.query(`select id from categories`)).rows.length;
    expect((await as<{ n: number }>(db, MAY, `select public.add_suggested_categories() as n`))[0].n).toBe(0);
    expect((await db.query(`select id from categories`)).rows.length).toBe(before);
    const parent = (await db.query<{ name: string }>(`select p.name from categories c join categories p on p.id = c.parent_id where c.name = 'Mercado'`)).rows[0];
    expect(parent.name).toBe("Alimentación");
    expect(await as(db, BREI, `select name from categories where kind = 'INCOME'`)).toHaveLength(0);
    await expect(rpc(db, MAY, "save_category", { name: "Nieta", responsibility: "FIXED_AMOUNTS", parent_id: mercado })).rejects.toThrow(/no puede tener subcategorías/);
  });

  it("hipoteca 100 % May y remodelación 100 % Brei: del hogar, las ven los dos y no generan deuda", async () => {
    const hip = await rpc<string>(db, MAY, "save_transaction", { kind: "DEBT_PAYMENT", scope: "HOUSEHOLD", amount: 2_000_000, account_id: h.mayAcc, occurred_on: "2026-10-05", splits: [{ amount: 2_000_000, category_id: hipoteca }] });
    const rem = await rpc<string>(db, BREI, "save_transaction", { kind: "DEBT_PAYMENT", scope: "HOUSEHOLD", amount: 800_000, account_id: h.breiAcc, occurred_on: "2026-10-06", splits: [{ amount: 800_000, category_id: remodel }] });
    for (const uid of [MAY, BREI]) {
      expect(ids(await as<{ id: string }>(db, uid, `select id from transactions where id in ($1, $2)`, [hip, rem]))).toEqual([hip, rem].sort());
      const resp = await as<{ responsible_user_id: string }>(db, uid, `select responsible_user_id from transaction_splits where transaction_id in ($1, $2) order by amount desc`, [hip, rem]);
      expect(resp.map((r) => r.responsible_user_id)).toEqual([MAY, BREI]);
    }
    expect((await db.query(`select id from cross_ledger`)).rows).toHaveLength(0);
  });

  it("cada cuenta conserva su titular y su privacidad aunque pague gastos del hogar", async () => {
    expect((await as<{ id: string }>(db, BREI, `select id from public.account_labels()`)).some((l) => l.id === h.mayAcc)).toBe(false);
    expect((await as<{ id: string }>(db, BREI, `select id from accounts`)).some((a) => a.id === h.mayAcc)).toBe(false);
    expect((await db.query<{ o: string }>(`select owner_user_id o from accounts where id = $1`, [h.mayAcc])).rows[0].o).toBe(MAY);
  });

  it("lo personal de May no lo ve Brei: ni el movimiento, ni sus partes, ni en las barras del hogar", async () => {
    const p = await rpc<string>(db, MAY, "save_transaction", { kind: "EXPENSE", scope: "PERSONAL", amount: 150_000, account_id: h.mayAcc, occurred_on: "2026-10-07", splits: [{ amount: 150_000, category_id: ropa }] });
    await rpc(db, MAY, "save_transaction", { kind: "EXPENSE", scope: "PERSONAL", amount: 7_000, account_id: h.mayAcc, occurred_on: "2026-10-07", splits: [{ amount: 7_000, category_id: mercado }] });
    expect(await as(db, BREI, `select id from transactions where id = $1`, [p])).toHaveLength(0);
    expect(await as(db, BREI, `select id from transaction_splits where transaction_id = $1`, [p])).toHaveLength(0);
    const sp = await as<{ t: number | null }>(db, BREI, `select sum(total)::int t from public.category_daily_spending('2026-10-01','2026-10-31') where category_id = $1`, [mercado]);
    expect(sp[0].t).toBeNull();
    // Brei tampoco puede editarlo
    await expect(rpc(db, BREI, "save_transaction", { id: p, kind: "EXPENSE", amount: 1, account_id: h.mayAcc, splits: [{ amount: 1 }] })).rejects.toThrow(/Solo quien registró/);
  });

  it("una categoría personal no se usa en un movimiento del hogar", async () => {
    await expect(rpc(db, MAY, "save_transaction", { kind: "EXPENSE", scope: "HOUSEHOLD", amount: 10, account_id: h.mayAcc, splits: [{ amount: 10, category_id: ropa }] })).rejects.toThrow(/es personal/);
  });

  it("pagado por May y asignado a Brei: la deuda en el cruce es opcional; Brei ajusta y May sigue siendo quien pagó", async () => {
    const noDebt = await rpc<string>(db, MAY, "save_transaction", { kind: "EXPENSE", scope: "HOUSEHOLD", amount: 50_000, creates_debt: false, account_id: h.mayAcc, splits: [{ amount: 50_000, category_id: mercado, responsible_user_id: BREI }] });
    expect((await db.query(`select id from cross_ledger where transaction_id = $1`, [noDebt])).rows).toHaveLength(0);
    const cross = await rpc<string>(db, MAY, "save_transaction", { kind: "EXPENSE", scope: "HOUSEHOLD", amount: 30_000, creates_debt: true, account_id: h.mayAcc, splits: [{ amount: 30_000, category_id: mercado, responsible_user_id: BREI }] });
    expect((await db.query(`select creditor_user_id, debtor_user_id, amount::int, kind from cross_ledger where transaction_id = $1`, [cross])).rows)
      .toEqual([{ creditor_user_id: MAY, debtor_user_id: BREI, amount: 30_000, kind: "CROSS_PAYMENT" }]);

    await rpc(db, BREI, "save_transaction", { id: cross, kind: "EXPENSE", amount: 32_000, description: "Mercado corregido", account_id: h.breiAcc, creates_debt: true, splits: [{ amount: 32_000, category_id: mercado, responsible_user_id: BREI }] });
    expect((await db.query(`select payer_user_id, created_by, account_id, amount::int, updated_by, scope from transactions where id = $1`, [cross])).rows[0])
      .toEqual({ payer_user_id: MAY, created_by: MAY, account_id: h.mayAcc, amount: 32_000, updated_by: BREI, scope: "HOUSEHOLD" });
    expect((await db.query(`select creditor_user_id, amount::int from cross_ledger where transaction_id = $1`, [cross])).rows).toEqual([{ creditor_user_id: MAY, amount: 32_000 }]);
    await expect(as(db, BREI, `select public.delete_transaction($1)`, [cross])).rejects.toThrow(/Solo quien registró/);
  });

  it("transferencias, reembolsos y ajustes: saldos correctos y no inflan ingresos ni gastos", async () => {
    const bal = async () => Object.fromEntries((await as<{ account_id: string; balance: number }>(db, MAY, `select account_id, balance::int as balance from public.account_balances()`)).map((r) => [r.account_id, r.balance]));
    const before = await bal();
    await rpc(db, MAY, "save_transaction", { kind: "TRANSFER", amount: 100_000, account_id: h.mayAcc, to_account_id: h.mayAcc2 });
    await rpc(db, MAY, "save_transaction", { kind: "REFUND", scope: "HOUSEHOLD", amount: 5_000, account_id: h.mayAcc, occurred_on: "2026-10-08", splits: [{ amount: 5_000, category_id: mercado }] });
    await rpc(db, MAY, "save_transaction", { kind: "ADJUSTMENT", amount: 1_000, direction: "OUT", account_id: h.mayAcc2 });
    const after = await bal();
    expect(after[h.mayAcc] - before[h.mayAcc]).toBe(-100_000 + 5_000);
    expect(after[h.mayAcc2] - before[h.mayAcc2]).toBe(100_000 - 1_000);
    await expect(rpc(db, MAY, "save_transaction", { kind: "ADJUSTMENT", amount: 1, account_id: h.mayAcc })).rejects.toThrow(/suma o resta/);
    const sp = await as<{ t: number }>(db, MAY, `select sum(total)::int t from public.category_daily_spending('2026-10-08','2026-10-08') where category_id = $1`, [mercado]);
    expect(sp[0].t).toBe(-5_000);
  });

  it("reembolso de una parte de Brei: si se pide, May se la debe", async () => {
    const r = await rpc<string>(db, MAY, "save_transaction", { kind: "REFUND", scope: "HOUSEHOLD", amount: 2_000, account_id: h.mayAcc, splits: [{ amount: 2_000, category_id: mercado, responsible_user_id: BREI }] });
    expect((await db.query(`select creditor_user_id, debtor_user_id, kind from cross_ledger where transaction_id = $1`, [r])).rows)
      .toEqual([{ creditor_user_id: BREI, debtor_user_id: MAY, kind: "REFUND" }]);
  });

  it("compromisos: los del hogar los ven los dos, los personales solo su dueño; el pago se enlaza a su vencimiento", async () => {
    const hhSp = (await as<{ id: string }>(db, MAY, `insert into scheduled_payments (household_id, scope, name, amount, category_id, frequency, day_of_month, kind)
      values ($1, 'HOUSEHOLD', 'Cuota hipoteca', 2000000, $2, 'MONTHLY', 5, 'DEBT_PAYMENT') returning id`, [h.hh, hipoteca]))[0].id;
    const mySp = (await as<{ id: string }>(db, MAY, `insert into scheduled_payments (household_id, scope, name, amount, frequency, due_date)
      values ($1, 'PERSONAL', 'Curso', 300000, 'ONCE', '2026-10-20') returning id`, [h.hh]))[0].id;
    expect(ids(await as<{ id: string }>(db, BREI, `select id from scheduled_payments`))).toEqual([hhSp]);
    await expect(as(db, BREI, `insert into scheduled_payments (household_id, scope, owner_user_id, name, amount, frequency, due_date)
      values ($1, 'PERSONAL', $2, 'x', 1, 'ONCE', '2026-10-20')`, [h.hh, MAY])).rejects.toThrow(/row-level security/);
    const paid = await rpc<string>(db, BREI, "save_transaction", { kind: "DEBT_PAYMENT", scope: "HOUSEHOLD", amount: 2_000_000, account_id: h.breiAcc, scheduled_payment_id: hhSp, scheduled_for: "2026-11-05", creates_debt: false, splits: [{ amount: 2_000_000, category_id: hipoteca, responsible_user_id: MAY }] });
    expect((await db.query(`select scheduled_payment_id, scheduled_for::text from transactions where id = $1`, [paid])).rows[0]).toEqual({ scheduled_payment_id: hhSp, scheduled_for: "2026-11-05" });
    await expect(rpc(db, BREI, "save_transaction", { kind: "EXPENSE", amount: 1, account_id: h.breiAcc, scheduled_payment_id: mySp, scheduled_for: "2026-10-20", splits: [{ amount: 1 }] })).rejects.toThrow(/no existe/);
  });

  it("presupuestos: los del hogar los ven los dos; los personales (y sus límites) solo su dueño", async () => {
    const hhPlan = await rpc<string>(db, BREI, "save_budget_plan", { scope: "HOUSEHOLD", name: "Comida", amount: 1_500_000, categories: [{ category_id: await catId("Alimentación") }] });
    const myPlan = await rpc<string>(db, MAY, "save_budget_plan", { scope: "PERSONAL", name: "Mis gustos", amount: 400_000, categories: [{ category_id: ropa, amount: 200_000 }] });
    expect(ids(await as<{ id: string }>(db, BREI, `select id from budget_plans`))).toEqual([hhPlan]);
    expect(await as(db, BREI, `select * from budget_plan_categories where plan_id = $1`, [myPlan])).toHaveLength(0);
    expect(await as(db, MAY, `select id from budget_plans`)).toHaveLength(2);
    await expect(rpc(db, MAY, "save_budget_plan", { scope: "HOUSEHOLD", name: "x", amount: 1, categories: [{ category_id: ropa }] })).rejects.toThrow(/personal/);
    await expect(as(db, BREI, `select public.delete_budget_plan($1)`, [myPlan])).rejects.toThrow(/no existe/);
    await expect(rpc(db, BREI, "save_budget_plan", { id: hhPlan, scope: "PERSONAL", name: "Comida", amount: 1, categories: [{ category_id: mercado }] })).resolves.toBe(hhPlan);
    await expect(rpc(db, MAY, "save_budget_plan", { id: hhPlan, scope: "HOUSEHOLD", name: "Comida", amount: 1, categories: [{ category_id: mercado }] })).rejects.toThrow(/no existe/);
  });

  it("metas: las personales son privadas; a las del hogar aportan los dos", async () => {
    const g = (await as<{ id: string }>(db, MAY, `insert into savings_goals (household_id, scope, name, target_amount) values ($1, 'HOUSEHOLD', 'Viaje', 5000000) returning id`, [h.hh]))[0].id;
    const p = (await as<{ id: string }>(db, MAY, `insert into savings_goals (household_id, scope, name, target_amount) values ($1, 'PERSONAL', 'Moto', 9000000) returning id`, [h.hh]))[0].id;
    await as(db, BREI, `insert into savings_contributions (goal_id, household_id, amount) values ($1, $2, 100000)`, [g, h.hh]);
    await expect(as(db, BREI, `insert into savings_contributions (goal_id, household_id, amount) values ($1, $2, 1)`, [p, h.hh])).rejects.toThrow(/row-level security/);
    expect(ids(await as<{ id: string }>(db, BREI, `select id from savings_goals`))).toEqual([g]);
    expect(await as(db, MAY, `select * from savings_contributions`)).toHaveLength(1);
  });

  it("captura automática: llega personal y pendiente; 'aplicar siempre' recuerda el ámbito y si genera deuda; no duplica pagos de deuda", async () => {
    const token = (await as<{ t: string }>(db, MAY, `select public.create_ingest_token() as t`))[0].t;
    await db.exec(`update accounts set last4 = '1234' where id = '${h.mayAcc}'`);
    const ingest = async (ev: object) => (await as<{ r: { result: string; transaction_id: string } }>(db, null, `select public.ingest_event($1, $2::jsonb) as r`, [token, JSON.stringify(ev)]))[0].r;
    const ev = (n: number, at: string) => ({ channel: "GMAIL", external_id: `e${n}`, parsed: { kind: "PURCHASE", amount: 45_000, merchant: "Exito Calle 80", merchant_norm: "exito calle 80", last4: "1234", occurred_at: at } });

    const r1 = await ingest(ev(1, "2026-10-10T15:00:00Z"));
    expect((await db.query(`select scope, status from transactions where id = $1`, [r1.transaction_id])).rows[0]).toEqual({ scope: "PERSONAL", status: "PENDING_REVIEW" });
    expect(await as(db, BREI, `select id from transactions where id = $1`, [r1.transaction_id])).toHaveLength(0);

    await rpc(db, MAY, "save_transaction", { id: r1.transaction_id, kind: "EXPENSE", scope: "HOUSEHOLD", amount: 45_000, account_id: h.mayAcc, creates_debt: false, merchant: "Exito Calle 80", splits: [{ amount: 45_000, category_id: mercado, responsible_user_id: BREI }] });
    await as(db, MAY, `select public.remember_merchant($1, true)`, [r1.transaction_id]);
    const r2 = await ingest(ev(2, "2026-10-17T15:00:00Z"));
    expect((await db.query(`select scope, status, creates_debt from transactions where id = $1`, [r2.transaction_id])).rows[0]).toEqual({ scope: "HOUSEHOLD", status: "CONFIRMED", creates_debt: false });
    expect((await db.query(`select id from cross_ledger where transaction_id = $1`, [r2.transaction_id])).rows).toHaveLength(0);

    const manual = await rpc<string>(db, MAY, "save_transaction", { kind: "DEBT_PAYMENT", scope: "HOUSEHOLD", amount: 777_000, account_id: h.mayAcc, occurred_on: "2026-10-20", description: "Banco Davivienda credito", splits: [{ amount: 777_000, category_id: hipoteca }] });
    const r3 = await ingest({ channel: "GMAIL", external_id: "e3", parsed: { kind: "PURCHASE", amount: 777_000, merchant: "Davivienda", merchant_norm: "davivienda", last4: "1234", occurred_at: "2026-10-20T14:00:00Z" } });
    expect(r3).toMatchObject({ result: "MERGED", transaction_id: manual });
  });

  it("un aviso pendiente se une con un pago de deuda registrado a mano", async () => {
    const token = (await as<{ t: string }>(db, MAY, `select public.create_ingest_token() as t`))[0].t;
    const manual = await rpc<string>(db, MAY, "save_transaction", { kind: "DEBT_PAYMENT", scope: "HOUSEHOLD", amount: 100_000, account_id: h.mayAcc, occurred_on: "2026-09-01", description: "Cuota carro", splits: [{ amount: 100_000, category_id: hipoteca }] });
    const r = (await as<{ r: { transaction_id: string } }>(db, null, `select public.ingest_event($1, $2::jsonb) as r`, [token, JSON.stringify({ channel: "GMAIL", external_id: "m1", parsed: { kind: "PURCHASE", amount: 101_500, merchant: "Finanzauto", merchant_norm: "finanzauto", last4: "1234", occurred_at: "2026-09-02T14:00:00Z" } })]))[0].r;
    await as(db, MAY, `select public.merge_pending_into($1, $2)`, [r.transaction_id, manual]);
    expect((await db.query(`select amount::int, kind from transactions where id = $1`, [manual])).rows[0]).toEqual({ amount: 101_500, kind: "DEBT_PAYMENT" });
  });

  it("las migraciones 0017 y 0018 se pueden volver a correr", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.join(__dirname, "../../supabase/migrations");
    for (const f of ["0017_household_personal.sql", "0018_budgets_goals.sql"]) {
      await db.exec(fs.readFileSync(path.join(dir, f), "utf8"));
    }
    expect((await db.query(`select count(*)::int n from transactions where scope is null`)).rows[0]).toEqual({ n: 0 });
  });
});
