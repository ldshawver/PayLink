/**
 * Release B2 — real-Postgres invariants the vendor/expense Cut Check route relies
 * on (migrations/0017_expense_payments.sql + the FOR UPDATE / partial unique-index
 * primitives that make issuance atomic, concurrency-safe and idempotent).
 * Raw SQL only; does NOT boot the app.
 *
 * The full HTTP behavioural proofs (concurrent no-overpay, rollback on failure,
 * idempotency exactly-once, 409 on key reuse, partial/full, void/reissue, preview
 * + reprint zero-write, cross-company rejection, post-commit notification failure)
 * run as the staging synthetic financial acceptance.
 *
 * SAFETY: requires TEST_DATABASE_URL pointing at a disposable database. Refuses
 * staging/production-shaped names/hosts and equality with this process's own
 * DATABASE_URL, verifies current_database() before any write, never prints a URL,
 * and drops every fixture in a finally block. Skips (exit 0) when unset.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable npx tsx tests/vendor-expense-cut-check-db.test.ts
 */
import { Pool } from "pg";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  recomputeExpensePaymentStatus, toCents, isUniqueConstraintViolation,
} from "../server/expense-payments.ts";

const FORBIDDEN = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.log("SKIP: TEST_DATABASE_URL not set — Release B2 DB invariants not run (this is not a failure).");
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
  const RUN = `zzz_relB2_${Date.now()}`;
  const CO = `${RUN}_co`, CO2 = `${RUN}_co2`, W = `${RUN}_w`, RS = `${RUN}_rs`, EXP = `${RUN}_exp`;

  try {
    // ── apply the migration to the disposable DB (must be idempotent) ──
    const migration = fs.readFileSync("migrations/0017_expense_payments.sql", "utf8");
    await pool.query(migration);
    await pool.query(migration); // second apply must be a no-op

    const cols = (await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='expense_payments' AND column_name = ANY($1::text[])`,
      [["company_id", "expense_id", "remittance_source_id", "amount", "payment_method", "status", "reference_number",
        "idempotency_key", "idempotency_fingerprint", "voided_at", "voided_by_user_id", "void_reason",
        "reverses_payment_id", "reissued_by_payment_id"]],
    )).rows.map((r) => r.column_name).sort();
    ok("migration creates expense_payments with all 14 lifecycle columns (idempotently)", cols.length === 14);
    ok("company-scoped partial unique index on idempotency_key exists",
      (await pool.query(`SELECT indexdef FROM pg_indexes WHERE indexname='uq_expense_payments_company_idempotency_key'`)).rows[0]?.indexdef?.includes("WHERE (idempotency_key IS NOT NULL)"));
    ok("active-only check-number unique index exists (excludes voided rows)",
      (await pool.query(`SELECT indexdef FROM pg_indexes WHERE indexname='uq_expense_payments_funding_check_number'`)).rows[0]?.indexdef?.match(/status <> 'void'|status <> 'void'::text/));
    ok("FKs point at companies + expenses with NO cascade",
      (await pool.query(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='expense_payments'::regclass AND contype='f'`))
        .rows.every((r) => !/ON DELETE CASCADE/i.test(r.d)) &&
      (await pool.query(`SELECT count(*)::int n FROM pg_constraint WHERE conrelid='expense_payments'::regclass AND contype='f'`)).rows[0].n >= 2);

    // ── fixture chain: company → worker → remittance source → approved expense ──
    await pool.query(`INSERT INTO companies (id, name) VALUES ($1,'zzz B2 Co'),($2,'zzz B2 Co2')`, [CO, CO2]);
    await pool.query(`INSERT INTO workers (id, company_id, first_name, last_name) VALUES ($1,$2,'Zzz','Vendor')`, [W, CO]);
    await pool.query(`INSERT INTO remittance_sources (id, company_id, name, status, routing_number, account_number, last_check_number)
                      VALUES ($1,$2,'zzz B2 bank','enabled','123456789','1234567890', 7000)`, [RS, CO]);
    await pool.query(`INSERT INTO expenses (id, company_id, submitter_id, expense_date, amount, vendor, status, payment_status)
                      VALUES ($1,$2,$3,'2026-01-01','1000.00','Zzz Vendor Co','approved','unpaid')`, [EXP, CO, W]);

    // ── the company-scoped partial unique index = idempotency exactly-once ──
    await pool.query(`INSERT INTO expense_payments (company_id, expense_id, remittance_source_id, amount, idempotency_key, status)
                      VALUES ($1,$2,$3,'100.00','KEY-A','completed')`, [CO, EXP, RS]);
    let dup = false;
    try {
      await pool.query(`INSERT INTO expense_payments (company_id, expense_id, remittance_source_id, amount, idempotency_key, status)
                        VALUES ($1,$2,$3,'200.00','KEY-A','completed')`, [CO, EXP, RS]);
    } catch (e) { dup = isUniqueConstraintViolation(e); }
    ok("same company + same idempotency_key is rejected (23505)", dup);
    await pool.query(`INSERT INTO expenses (id, company_id, submitter_id, expense_date, amount, status, payment_status)
                      VALUES ($1,$2,$3,'2026-01-01','50.00','approved','unpaid')`, [`${EXP}_2`, CO2, W]);
    await pool.query(`INSERT INTO expense_payments (company_id, expense_id, amount, idempotency_key, status)
                      VALUES ($1,$2,'30.00','KEY-A','completed')`, [CO2, `${EXP}_2`]);
    ok("different company + same key is allowed", true);
    await pool.query(`INSERT INTO expense_payments (company_id, expense_id, amount, status) VALUES ($1,$2,'40.00','completed'),($1,$2,'50.00','completed')`, [CO, EXP]);
    ok("NULL idempotency_key rows never conflict", true);

    // ── active check-number uniqueness per funding account ──
    await pool.query(`INSERT INTO expense_payments (company_id, expense_id, remittance_source_id, amount, reference_number, status)
                      VALUES ($1,$2,$3,'10.00','007001','completed')`, [CO, EXP, RS]);
    let dupCheck = false;
    try {
      await pool.query(`INSERT INTO expense_payments (company_id, expense_id, remittance_source_id, amount, reference_number, status)
                        VALUES ($1,$2,$3,'11.00','007001','completed')`, [CO, EXP, RS]);
    } catch (e) { dupCheck = isUniqueConstraintViolation(e); }
    ok("a second ACTIVE payment with the same funding account + check number is rejected", dupCheck);
    await pool.query(`INSERT INTO expense_payments (company_id, expense_id, remittance_source_id, amount, reference_number, status)
                      VALUES ($1,$2,$3,'11.00','007001','void')`, [CO, EXP, RS]);
    ok("a VOIDED payment may reuse that check number (only one active at a time)",
      (await pool.query(`SELECT count(*)::int n FROM expense_payments WHERE remittance_source_id=$1 AND reference_number='007001' AND status<>'void'`, [RS])).rows[0].n === 1);

    // ── SELECT ... FOR UPDATE serialises two issuers on the same expense ──
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query("BEGIN");
      await a.query(`SELECT * FROM expenses WHERE id=$1 FOR UPDATE`, [EXP]);
      await b.query("BEGIN");
      let state = "pending";
      const bLock = b.query(`SELECT * FROM expenses WHERE id=$1 FOR UPDATE`, [EXP]).then(() => { state = "acquired"; });
      await new Promise((r) => setTimeout(r, 250));
      ok("a second FOR UPDATE on the locked expense is blocked until the first tx ends", state === "pending");
      await a.query("ROLLBACK");
      await bLock;
      ok("the blocked FOR UPDATE proceeds once the lock is released", state === "acquired");
      await b.query("ROLLBACK");
    } finally { a.release(); b.release(); }

    // ── the check-counter row (remittance_sources) locks independently ──
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      await c1.query("BEGIN");
      await c1.query(`SELECT id, last_check_number FROM remittance_sources WHERE id=$1 FOR UPDATE`, [RS]);
      await c2.query("BEGIN");
      let st = "pending";
      const p = c2.query(`SELECT id, last_check_number FROM remittance_sources WHERE id=$1 FOR UPDATE`, [RS]).then(() => { st = "acquired"; });
      await new Promise((r) => setTimeout(r, 200));
      ok("two concurrent check-number allocations cannot both hold the counter row", st === "pending");
      await c1.query("ROLLBACK"); await p; await c2.query("ROLLBACK");
    } finally { c1.release(); c2.release(); }

    // ── authoritative balance = amount - SUM(non-void); status recompute ──
    await pool.query(`DELETE FROM expense_payments WHERE expense_id=$1`, [EXP]);
    await pool.query(`INSERT INTO expense_payments (company_id, expense_id, remittance_source_id, amount, reference_number, status)
                      VALUES ($1,$2,$3,'400.00','007010','completed'),($1,$2,$3,'600.00','007011','completed'),($1,$2,$3,'999.00','007012','void')`, [CO, EXP, RS]);
    const paid = toCents((await pool.query(`SELECT COALESCE(SUM(amount),0)::numeric paid FROM expense_payments WHERE expense_id=$1 AND status<>'void'`, [EXP])).rows[0].paid);
    ok("void payments are excluded from the paid total", paid === 100000);
    ok("recomputeExpensePaymentStatus(1000, 1000) === paid", recomputeExpensePaymentStatus(100000, paid) === "paid");
    ok("recomputeExpensePaymentStatus(1000, 400) === partially_paid", recomputeExpensePaymentStatus(100000, 40000) === "partially_paid");
    ok("recomputeExpensePaymentStatus after reversing everything === unpaid", recomputeExpensePaymentStatus(100000, 0) === "unpaid");

    // ── void keeps the original row + monetary fields, records who/when/reason ──
    const [p] = (await pool.query(`INSERT INTO expense_payments (company_id, expense_id, remittance_source_id, amount, payment_method, reference_number, status)
                                   VALUES ($1,$2,$3,'250.00','check','007020','completed') RETURNING *`, [CO, EXP, RS])).rows;
    await pool.query(`UPDATE expense_payments SET status='void', voided_at=NOW(), voided_by_user_id=$2, void_reason=$3 WHERE id=$1 AND status<>'void'`, [p.id, `${RUN}_u`, "lost in mail"]);
    const [pv] = (await pool.query(`SELECT * FROM expense_payments WHERE id=$1`, [p.id])).rows;
    ok("voided payment keeps amount + method + check number, records reason/actor/time",
      pv.amount === p.amount && pv.payment_method === "check" && pv.reference_number === "007020" &&
      pv.status === "void" && pv.void_reason === "lost in mail" && !!pv.voided_at && pv.voided_by_user_id === `${RUN}_u`);
    const again = await pool.query(`UPDATE expense_payments SET status='void', voided_at=NOW() WHERE id=$1 AND status<>'void'`, [p.id]);
    ok("re-voiding the same payment is a no-op (0 rows updated) — repeated void is idempotent", again.rowCount === 0);

    // ── reissue linkage: replacement.reverses_payment_id + original.reissued_by_payment_id ──
    const [orig] = (await pool.query(`INSERT INTO expense_payments (company_id, expense_id, remittance_source_id, amount, reference_number, status)
                                      VALUES ($1,$2,$3,'250.00','007030','void') RETURNING *`, [CO, EXP, RS])).rows;
    const [repl] = (await pool.query(`INSERT INTO expense_payments (company_id, expense_id, remittance_source_id, amount, reference_number, status, reverses_payment_id)
                                      VALUES ($1,$2,$3,'250.00','007031','completed',$4) RETURNING *`, [CO, EXP, RS, orig.id])).rows;
    await pool.query(`UPDATE expense_payments SET reissued_by_payment_id=$2 WHERE id=$1`, [orig.id, repl.id]);
    const chain = (await pool.query(`SELECT id, reverses_payment_id, reissued_by_payment_id FROM expense_payments WHERE id = ANY($1)`, [[orig.id, repl.id]])).rows;
    const o = chain.find((r) => r.id === orig.id), r = chain.find((r) => r.id === repl.id);
    ok("original -> replacement and replacement -> original links are both recorded",
      o.reissued_by_payment_id === repl.id && r.reverses_payment_id === orig.id && !o.reverses_payment_id);
    ok("the original (voided) row is never deleted by reissue",
      (await pool.query(`SELECT count(*)::int n FROM expense_payments WHERE id=$1`, [orig.id])).rows[0].n === 1);

    // ── transaction rollback leaves NOTHING behind (payment + counter + audit) ──
    const beforeCount = (await pool.query(`SELECT count(*)::int n FROM expense_payments WHERE expense_id=$1`, [EXP])).rows[0].n;
    const beforeCounter = (await pool.query(`SELECT last_check_number FROM remittance_sources WHERE id=$1`, [RS])).rows[0].last_check_number;
    const tx = await pool.connect();
    try {
      await tx.query("BEGIN");
      await tx.query(`UPDATE remittance_sources SET last_check_number = last_check_number + 1 WHERE id=$1`, [RS]);
      await tx.query(`INSERT INTO expense_payments (company_id, expense_id, remittance_source_id, amount, reference_number, status) VALUES ($1,$2,$3,'123.00','009999','completed')`, [CO, EXP, RS]);
      await tx.query(`INSERT INTO expense_approval_actions (object_type, object_id, action_type) VALUES ('expense',$1,'check_issued')`, [EXP]);
      await tx.query("ROLLBACK");
    } finally { tx.release(); }
    ok("ROLLBACK reverts the payment insert, the check-counter increment AND the audit row together",
      (await pool.query(`SELECT count(*)::int n FROM expense_payments WHERE expense_id=$1`, [EXP])).rows[0].n === beforeCount &&
      (await pool.query(`SELECT last_check_number FROM remittance_sources WHERE id=$1`, [RS])).rows[0].last_check_number === beforeCounter &&
      (await pool.query(`SELECT count(*)::int n FROM expense_approval_actions WHERE object_id=$1`, [EXP])).rows[0].n === 0);

    // ── rollback verification: table can be dropped cleanly (0017 rollback block) ──
    // (not executed here — proven on the disposable-clone rehearsal; dropping it now
    //  would break the fixture cleanup below.)
  } finally {
    await pool.query(`DELETE FROM expense_payments WHERE company_id LIKE $1`, [`${RUN}%`]);
    await pool.query(`DELETE FROM expense_approval_actions WHERE object_id LIKE $1`, [`${RUN}%`]);
    await pool.query(`DELETE FROM expenses WHERE company_id LIKE $1`, [`${RUN}%`]);
    await pool.query(`DELETE FROM remittance_sources WHERE company_id LIKE $1`, [`${RUN}%`]);
    await pool.query(`DELETE FROM workers WHERE company_id LIKE $1`, [`${RUN}%`]);
    await pool.query(`DELETE FROM companies WHERE id LIKE $1`, [`${RUN}%`]);
    const left = (await pool.query(
      `SELECT (SELECT count(*)::int FROM expense_payments WHERE company_id LIKE $1) p,
              (SELECT count(*)::int FROM expenses WHERE company_id LIKE $1) e,
              (SELECT count(*)::int FROM companies WHERE id LIKE $1) c,
              (SELECT count(*)::int FROM remittance_sources WHERE company_id LIKE $1) r,
              (SELECT count(*)::int FROM workers WHERE company_id LIKE $1) w,
              (SELECT count(*)::int FROM expense_approval_actions WHERE object_id LIKE $1) a`, [`${RUN}%`])).rows[0];
    if (Object.values(left).some((n) => n !== 0)) throw new Error(`Fixture residue: ${JSON.stringify(left)}`);
    await pool.end();
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
