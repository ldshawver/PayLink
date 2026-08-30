/**
 * Release B — real-Postgres invariants the contractor-payment route relies on
 * (migrations/0016_contractor_payment_lifecycle.sql + the FOR UPDATE / partial
 * unique-index primitives). Raw SQL only; does NOT boot the app.
 *
 * The full HTTP behavioural proofs (concurrent no-overpay, rollback on failure,
 * idempotency exactly-once, 409 on key reuse, void/reissue, cut-check, cross-
 * company rejection) run as the staging synthetic financial acceptance.
 *
 * SAFETY: requires TEST_DATABASE_URL pointing at a disposable database. Refuses
 * anything that looks like staging/production (by name/host, and by equality
 * with this process's own DATABASE_URL). Verifies current_database() before any
 * write, never prints a URL, and drops every fixture in a finally block.
 * Skips (exit 0) with a visible message when TEST_DATABASE_URL is unset.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable npx tsx tests/contractor-invoice-payments-db.test.ts
 */
import { Pool } from "pg";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  recomputeInvoiceStatus, toCents, fromCents, isUniqueConstraintViolation,
} from "../server/contractor-payments.ts";

const FORBIDDEN = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.log("SKIP: TEST_DATABASE_URL not set — Release B DB invariants not run (this is not a failure).");
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
  const RUN = `zzz_relB_${Date.now()}`;

  try {
    // ── apply the migration to the disposable DB (idempotent) ──
    const migration = fs.readFileSync("migrations/0016_contractor_payment_lifecycle.sql", "utf8");
    await pool.query(migration);
    await pool.query(migration); // second apply must be a no-op

    const cols = (await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='contractor_payments'
       AND column_name = ANY($1::text[])`,
      [["idempotency_key", "idempotency_fingerprint", "voided_at", "voided_by_user_id", "void_reason", "reverses_payment_id", "reissued_by_payment_id"]],
    )).rows.map((r) => r.column_name).sort();
    ok("migration adds all 7 contractor_payments lifecycle columns (idempotently)", cols.length === 7);
    ok("migration adds contractor_trade_compensation.idempotency_key",
      (await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name='contractor_trade_compensation' AND column_name='idempotency_key'`)).rowCount === 1);
    ok("company-scoped partial unique index exists",
      (await pool.query(`SELECT indexdef FROM pg_indexes WHERE indexname='uq_contractor_payments_company_idempotency_key'`)).rows[0]?.indexdef?.includes("WHERE (idempotency_key IS NOT NULL)"));

    // ── the partial unique index is what makes idempotency exactly-once ──
    await pool.query(`INSERT INTO contractor_payments (invoice_id, company_id, amount, idempotency_key, status) VALUES ($1,$2,10,'KEY-A','completed')`, [`${RUN}_i1`, `${RUN}_coA`]);
    let dup = false;
    try {
      await pool.query(`INSERT INTO contractor_payments (invoice_id, company_id, amount, idempotency_key, status) VALUES ($1,$2,20,'KEY-A','completed')`, [`${RUN}_i2`, `${RUN}_coA`]);
    } catch (e) { dup = isUniqueConstraintViolation(e); }
    ok("same company + same idempotency_key is rejected (23505)", dup);
    await pool.query(`INSERT INTO contractor_payments (invoice_id, company_id, amount, idempotency_key, status) VALUES ($1,$2,30,'KEY-A','completed')`, [`${RUN}_i3`, `${RUN}_coB`]);
    ok("different company + same key is allowed", true);
    await pool.query(`INSERT INTO contractor_payments (invoice_id, company_id, amount, status) VALUES ($1,$2,40,'completed'),($1,$2,50,'completed')`, [`${RUN}_i4`, `${RUN}_coA`]);
    ok("NULL idempotency_key rows never conflict", true);

    // ── SELECT ... FOR UPDATE blocks a concurrent writer on the same row ──
    await pool.query(
      `INSERT INTO contractor_invoices (id, company_id, contractor_id, invoice_number, invoice_date, amount, balance_due, amount_paid, status)
       VALUES ($1,$2,$3,$4,'2026-01-01','1000.00','1000.00','0','sent')`,
      [`${RUN}_inv`, `${RUN}_coA`, `${RUN}_w`, `${RUN}-INV`],
    );
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query("BEGIN");
      await a.query(`SELECT * FROM contractor_invoices WHERE id=$1 FOR UPDATE`, [`${RUN}_inv`]);
      await b.query("BEGIN");
      let blocked = "pending";
      const bLock = b.query(`SELECT * FROM contractor_invoices WHERE id=$1 FOR UPDATE`, [`${RUN}_inv`]).then(() => { blocked = "acquired"; });
      await new Promise((r) => setTimeout(r, 250));
      ok("a second FOR UPDATE on the locked invoice is blocked until the first tx ends", blocked === "pending");
      await a.query("ROLLBACK");
      await bLock;
      ok("the blocked FOR UPDATE proceeds once the lock is released", blocked === "acquired");
      await b.query("ROLLBACK");
    } finally { a.release(); b.release(); }

    // ── recomputeInvoiceStatus over authoritative non-void SUM ──
    await pool.query(`INSERT INTO contractor_payments (invoice_id, company_id, amount, status) VALUES ($1,$2,'400.00','completed'),($1,$2,'600.00','completed'),($1,$2,'999.00','void')`, [`${RUN}_inv`, `${RUN}_coA`]);
    const paid = toCents((await pool.query(`SELECT COALESCE(SUM(amount),0)::numeric paid FROM contractor_payments WHERE invoice_id=$1 AND status<>'void'`, [`${RUN}_inv`])).rows[0].paid);
    ok("void payments are excluded from the paid total", paid === 100000);
    ok("recomputeInvoiceStatus(1000.00, 1000.00) === paid", recomputeInvoiceStatus(100000, paid) === "paid");
    ok("recomputeInvoiceStatus after reversing everything === sent", recomputeInvoiceStatus(100000, 0) === "sent");

    // ── void audit columns round-trip, original monetary fields intact ──
    const [p] = (await pool.query(`INSERT INTO contractor_payments (invoice_id, company_id, amount, payment_method, status) VALUES ($1,$2,'250.00','cash','completed') RETURNING *`, [`${RUN}_inv`, `${RUN}_coA`])).rows;
    await pool.query(`UPDATE contractor_payments SET status='void', voided_at=NOW(), voided_by_user_id=$2, void_reason=$3 WHERE id=$1`, [p.id, `${RUN}_u`, "test reversal"]);
    const [pv] = (await pool.query(`SELECT * FROM contractor_payments WHERE id=$1`, [p.id])).rows;
    ok("voided payment keeps its amount + method, records reason/actor/time",
      pv.amount === p.amount && pv.payment_method === "cash" && pv.status === "void" && pv.void_reason === "test reversal" && !!pv.voided_at && pv.voided_by_user_id === `${RUN}_u`);
  } finally {
    await pool.query(`DELETE FROM contractor_payments WHERE invoice_id LIKE $1 OR company_id LIKE $1`, [`${RUN}%`]);
    await pool.query(`DELETE FROM contractor_invoices WHERE id LIKE $1 OR company_id LIKE $1`, [`${RUN}%`]);
    const left = (await pool.query(
      `SELECT (SELECT count(*)::int FROM contractor_payments WHERE company_id LIKE $1) p,
              (SELECT count(*)::int FROM contractor_invoices WHERE company_id LIKE $1) i`, [`${RUN}%`])).rows[0];
    if (left.p !== 0 || left.i !== 0) throw new Error(`Fixture residue: ${JSON.stringify(left)}`);
    await pool.end();
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
