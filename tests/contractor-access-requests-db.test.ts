/**
 * PR 2 — contractor access requests: real-Postgres invariants
 * (migrations/0020_contractor_access_requests.sql). Raw SQL only; does NOT boot
 * the app. Full HTTP flow (public request → admin approve → invite accept →
 * contractor login → Hub scoping) runs as the staging synthetic acceptance.
 *
 * SAFETY: requires TEST_DATABASE_URL pointing at a disposable database. Refuses
 * staging/production-shaped names/hosts, verifies current_database() before any
 * write, never prints a URL, drops fixtures in finally. Skips (exit 0) when
 * TEST_DATABASE_URL is unset.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable npx tsx tests/contractor-access-requests-db.test.ts
 */
import { Pool } from "pg";
import assert from "node:assert/strict";
import fs from "node:fs";

const FORBIDDEN = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.log("SKIP: TEST_DATABASE_URL not set — PR 2 DB invariants not run (this is not a failure).");
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
  assert.equal(cur, dbName, "current_database() must match TEST_DATABASE_URL");

  let pass = 0, fail = 0;
  const ok = (n: string, c: boolean) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`); } };

  const cleanup: string[] = [];
  try {
    const migration = fs.readFileSync("migrations/0020_contractor_access_requests.sql", "utf8").split("-- ─────────────────────────────────────────────────────────────────────────────\n-- ROLLBACK")[0];
    await pool.query(migration);
    ok("migration is idempotent (re-run is a no-op)", await pool.query(migration).then(() => true).catch(() => false));

    ok("table exists", (await pool.query(`SELECT to_regclass('public.contractor_access_requests') t`)).rows[0].t === "contractor_access_requests");

    // 1. First pending request inserts.
    const email = "zz-cardb-" + Date.now() + "@example.com";
    const a = await pool.query(
      `INSERT INTO contractor_access_requests (email, first_name, last_name, status) VALUES ($1,'Al','B','pending') RETURNING id`, [email]);
    cleanup.push(`DELETE FROM contractor_access_requests WHERE email = '${email}'`);
    ok("pending request created", !!a.rows[0].id);

    // 2. Second pending request for the SAME email is rejected by the unique partial index.
    let dup = false;
    try {
      await pool.query(`INSERT INTO contractor_access_requests (email, first_name, last_name, status) VALUES ($1,'Al','B','pending')`, [email]);
    } catch { dup = true; }
    ok("a second pending request for the same email is rejected (uq_contractor_access_requests_pending_email)", dup);

    // 3. Once the first is not pending, a new pending request is allowed again (re-apply after rejection).
    await pool.query(`UPDATE contractor_access_requests SET status='rejected', rejection_reason='test' WHERE id=$1`, [a.rows[0].id]);
    const c = await pool.query(`INSERT INTO contractor_access_requests (email, first_name, last_name, status) VALUES ($1,'Al','B','pending') RETURNING id`, [email]);
    ok("after rejection, a fresh pending request for the same email is allowed", !!c.rows[0].id);

    // 4. Rejected row is retained (not deleted).
    ok("the rejected row still exists with its reason", (await pool.query(
      `SELECT rejection_reason FROM contractor_access_requests WHERE id=$1`, [a.rows[0].id])).rows[0]?.rejection_reason === "test");

    // 5. No FK forces a company_id (a public request may be unassigned).
    ok("company_id is nullable (unassigned public request)", (await pool.query(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name='contractor_access_requests' AND column_name='company_id'`
    )).rows[0].is_nullable === "YES");
  } finally {
    for (const s of cleanup) await pool.query(s).catch(() => {});
    await pool.end();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
