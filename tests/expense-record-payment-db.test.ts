/**
 * Combined MyPayLink usability release — real-Postgres invariants for the
 * additive non-check expense payment path (POST /api/expenses/:id/record-payment
 * + migration 0018). Raw SQL only; does NOT boot the app — it exercises the
 * exact ledger primitives the route relies on.
 *
 * SAFETY: requires TEST_DATABASE_URL pointing at a disposable database. Refuses
 * anything staging/production-shaped, verifies current_database() before any
 * write, never prints a URL, drops every fixture in a finally block. Skips
 * (exit 0, visible message) when TEST_DATABASE_URL is unset.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable npx tsx tests/expense-record-payment-db.test.ts
 */
import { Pool } from "pg";
import assert from "node:assert/strict";
import fs from "node:fs";
import { toCents, isUniqueConstraintViolation } from "../server/expense-payments.ts";

const FORBIDDEN = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.log("SKIP: TEST_DATABASE_URL not set — expense record-payment DB invariants not run (this is not a failure).");
    process.exit(0);
  }
  const parsed = new URL(url);
  const dbName = parsed.pathname.replace(/^\//, "");
  for (const p of FORBIDDEN) {
    if (p.test(dbName) || p.test(parsed.hostname)) throw new Error("Refusing to run against a staging/production-shaped database.");
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) throw new Error("TEST_DATABASE_URL equals this process's DATABASE_URL.");

  const pool = new Pool({ connectionString: url, max: 4 });
  const cur = (await pool.query("SELECT current_database() d")).rows[0].d;
  assert.equal(cur, dbName, "current_database() must match the parsed TEST_DATABASE_URL");

  let pass = 0, fail = 0;
  const ok = (name: string, cond: boolean) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}`); } };
  const RUN = `zzz_mplusab_${Date.now()}`;

  try {
    // ── the B2 ledger (0017) then the additive 0018 layer, both idempotent ──
    await pool.query(fs.readFileSync("migrations/0017_expense_payments.sql", "utf8"));
    const migration = fs.readFileSync("migrations/0018_expense_payment_methods_and_docs.sql", "utf8");
    await pool.query(migration);
    await pool.query(migration); // second apply must be a no-op

    const cols = (await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name='expense_payments' AND column_name = ANY($1::text[])`,
      [["notes", "payment_date", "trade_compensation_id", "payee_user_id"]],
    )).rows.map((r) => r.column_name);
    ok("0018 adds notes / payment_date / trade_compensation_id / payee_user_id to expense_payments (idempotently)", cols.length === 4);
    ok("0018 adds contractor_trade_compensation.expense_payment_id",
      (await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name='contractor_trade_compensation' AND column_name='expense_payment_id'`)).rowCount === 1);
    ok("0018 partial unique index on contractor_trade_compensation(expense_payment_id) exists",
      (await pool.query(`SELECT indexdef FROM pg_indexes WHERE indexname='uq_contractor_trade_comp_expense_payment_id'`)).rows[0]?.indexdef?.includes("WHERE (expense_payment_id IS NOT NULL)"));

    // ── fixtures ──
    const CO = `${RUN}_co`;
    const EXP = `${RUN}_exp`;
    const W = `${RUN}_w`;
    await pool.query(`INSERT INTO companies (id, name) VALUES ($1,$2)`, [CO, `${RUN} Co`]);
    await pool.query(`INSERT INTO workers (id, company_id, first_name, last_name) VALUES ($1,$2,'Zzz','Payee')`, [W, CO]);
    await pool.query(`INSERT INTO expenses (id, company_id, submitter_id, expense_date, description, amount, status, payment_status)
       VALUES ($1,$2,$3,CURRENT_DATE,'Barter job — landscaping','1000.00','approved','unpaid')`,
      [EXP, CO, W]);

    const balanceCents = async () => {
      const total = toCents((await pool.query(`SELECT amount FROM expenses WHERE id=$1`, [EXP])).rows[0].amount);
      const paid = toCents((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM expense_payments WHERE expense_id=$1 AND status<>'void'`, [EXP])).rows[0].s);
      return total - paid;
    };

    // ── a cash payment reduces the balance like a check ──
    await pool.query(
      `INSERT INTO expense_payments (company_id, expense_id, amount, payment_method, status, notes, payment_date, idempotency_key, idempotency_fingerprint)
       VALUES ($1,$2,'250.00','cash','completed',NULL,NOW(),$3,'fp-cash-1')`,
      [CO, EXP, `${RUN}-cash`],
    );
    ok("a cash payment reduces the outstanding balance", (await balanceCents()) === toCents("750.00"));

    // ── idempotency: same company + same key is rejected by the partial unique index ──
    let dup = false;
    try {
      await pool.query(
        `INSERT INTO expense_payments (company_id, expense_id, amount, payment_method, status, idempotency_key, idempotency_fingerprint)
         VALUES ($1,$2,'10.00','ach','completed',$3,'fp-cash-1')`,
        [CO, EXP, `${RUN}-cash`],
      );
    } catch (e) { dup = isUniqueConstraintViolation(e); }
    ok("re-posting the same company + idempotency_key is blocked (exactly-once)", dup);

    // ── trade / barter: an approved FMV valuation binds to exactly one payment, across both ledgers ──
    const TC = `${RUN}_tc`;
    await pool.query(
      `INSERT INTO contractor_trade_compensation (id, company_id, contractor_user_id, item_name, total_value, valuation_method, approved_at)
       VALUES ($1,$2,$3,'Reclaimed lumber','300.00','fair_market_value',NOW())`,
      [TC, CO, W],
    );
    const TP = `${RUN}_tp`;
    await pool.query(
      `INSERT INTO expense_payments (id, company_id, expense_id, amount, payment_method, status, notes, payment_date, trade_compensation_id, payee_user_id, idempotency_key, idempotency_fingerprint)
       VALUES ($1,$2,$3,'300.00','trade_credit','completed','Reclaimed lumber for the deck',NOW(),$4,$5,$6,'fp-trade-1')`,
      [TP, CO, EXP, TC, W, `${RUN}-trade`],
    );
    await pool.query(
      `UPDATE contractor_trade_compensation SET expense_payment_id=$1 WHERE id=$2 AND expense_payment_id IS NULL AND contractor_payment_id IS NULL`,
      [TP, TC],
    );
    ok("the trade/barter payment reduces the balance like any other method (750 - 300 = 450)", (await balanceCents()) === toCents("450.00"));
    ok("the approved valuation is now bound to the expense payment", (await pool.query(`SELECT expense_payment_id FROM contractor_trade_compensation WHERE id=$1`, [TC])).rows[0].expense_payment_id === TP);

    let tcDup = false;
    try {
      await pool.query(`UPDATE contractor_trade_compensation SET expense_payment_id=$1 WHERE id=$2`, [`${RUN}_other`, TC]);
      // even a direct second bind on a DIFFERENT payment id must be caught by the unique index when it collides;
      // here it is a different value so it succeeds — instead prove the index rejects a duplicate VALUE:
      await pool.query(
        `INSERT INTO contractor_trade_compensation (id, company_id, contractor_user_id, item_name, total_value, valuation_method, approved_at, expense_payment_id)
         VALUES ($1,$2,$3,'dup','1.00','fair_market_value',NOW(),$4)`,
        [`${RUN}_tc2`, CO, W, `${RUN}_other`],
      );
    } catch (e) { tcDup = isUniqueConstraintViolation(e); }
    ok("two trade-compensation rows cannot point at the same expense_payment_id", tcDup);

    // ── void releases the valuation so its value is not lost ──
    await pool.query(`UPDATE contractor_trade_compensation SET expense_payment_id=$1 WHERE id=$2`, [TP, TC]); // restore
    await pool.query(`UPDATE expense_payments SET status='void', voided_at=NOW() WHERE id=$1 AND status<>'void'`, [TP]);
    await pool.query(`UPDATE contractor_trade_compensation SET expense_payment_id=NULL, updated_at=NOW() WHERE expense_payment_id=$1`, [TP]);
    ok("voiding the trade payment restores its 300 to the balance (450 + 300 = 750)", (await balanceCents()) === toCents("750.00"));
    ok("voiding the trade payment frees the valuation for re-use",
      (await pool.query(`SELECT expense_payment_id FROM contractor_trade_compensation WHERE id=$1`, [TC])).rows[0].expense_payment_id === null);
  } finally {
    await pool.query(`DELETE FROM expense_payments WHERE company_id LIKE $1`, [`${RUN}%`]);
    await pool.query(`DELETE FROM contractor_trade_compensation WHERE company_id LIKE $1`, [`${RUN}%`]);
    await pool.query(`DELETE FROM expenses WHERE company_id LIKE $1`, [`${RUN}%`]);
    await pool.query(`DELETE FROM workers WHERE company_id LIKE $1`, [`${RUN}%`]);
    await pool.query(`DELETE FROM companies WHERE id LIKE $1`, [`${RUN}%`]);
    const left = (await pool.query(
      `SELECT (SELECT count(*)::int FROM expense_payments WHERE company_id LIKE $1) p,
              (SELECT count(*)::int FROM contractor_trade_compensation WHERE company_id LIKE $1) t,
              (SELECT count(*)::int FROM expenses WHERE company_id LIKE $1) e,
              (SELECT count(*)::int FROM workers WHERE company_id LIKE $1) w,
              (SELECT count(*)::int FROM companies WHERE id LIKE $1) c`, [`${RUN}%`])).rows[0];
    if (Object.values(left).some((n) => n !== 0)) throw new Error(`Fixture residue: ${JSON.stringify(left)}`);
    await pool.end();
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
