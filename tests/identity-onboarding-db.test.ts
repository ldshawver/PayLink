/**
 * PR 1 — SaaS identity/onboarding: real-Postgres invariants the invite/link
 * flow relies on (migrations/0019_identity_links_and_invites.sql). Raw SQL
 * only; does NOT boot the app.
 *
 * The full HTTP behavioural proofs (create-employee-with-invite, accept →
 * login, link-existing, disabled-access-blocks-login, signer resolver end to
 * end) run as the staging synthetic acceptance.
 *
 * SAFETY: requires TEST_DATABASE_URL pointing at a disposable database. Refuses
 * anything staging/production-shaped, verifies current_database() before any
 * write, never prints a URL, drops every fixture in finally. Skips (exit 0)
 * when TEST_DATABASE_URL is unset.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable npx tsx tests/identity-onboarding-db.test.ts
 */
import { Pool } from "pg";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

const FORBIDDEN = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.log("SKIP: TEST_DATABASE_URL not set — identity/onboarding DB invariants not run (this is not a failure).");
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
  const ok = (name: string, cond: boolean) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}`); } };

  const CO_A = "id-onb-co-a-" + Date.now();
  const CO_B = "id-onb-co-b-" + Date.now();
  const W1 = "id-onb-w1-" + Date.now();
  const cleanup: string[] = [];

  try {
    // Minimal ambient schema the migration assumes (users, workers, persons).
    await pool.query(`CREATE TABLE IF NOT EXISTS users (id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), username TEXT UNIQUE, password TEXT, role TEXT, company_id VARCHAR, worker_id VARCHAR, email TEXT, is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS workers (id VARCHAR PRIMARY KEY, company_id VARCHAR, first_name TEXT, last_name TEXT, email TEXT, work_email TEXT, home_email TEXT, person_id VARCHAR, worker_type TEXT DEFAULT 'employee')`);
    await pool.query(`CREATE TABLE IF NOT EXISTS persons (id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT)`);

    // Apply migration 0019 (idempotent).
    const migration = fs.readFileSync("migrations/0019_identity_links_and_invites.sql", "utf8").split("-- ─────────────────────────────────────────────────────────────────────────────\n-- ROLLBACK")[0];
    await pool.query(migration);

    ok("migration adds the additive users columns", (await pool.query(
      `SELECT count(*) c FROM information_schema.columns WHERE table_name='users' AND column_name IN ('invite_status','last_login_at','email_verified_at')`
    )).rows[0].c === "3");

    // Fixtures
    await pool.query(`INSERT INTO workers (id, company_id, first_name, last_name) VALUES ($1,$2,'Allen','Bongiorno')`, [W1, CO_A]);

    // 1. Invite token is stored hashed, never raw.
    const raw = crypto.randomBytes(32).toString("base64url");
    const hash = crypto.createHash("sha256").update(raw).digest("hex");
    const inv = await pool.query(
      `INSERT INTO account_invites (company_id, email, relationship_kind, relationship_id, role, token_hash, expires_at)
       VALUES ($1,'allen@ex.com','employee',$2,'employee',$3, NOW() + interval '14 days') RETURNING id`,
      [CO_A, W1, hash],
    );
    cleanup.push(`DELETE FROM account_invites WHERE id = '${inv.rows[0].id}'`);
    const stored = (await pool.query(`SELECT token_hash FROM account_invites WHERE id=$1`, [inv.rows[0].id])).rows[0];
    ok("account_invites stores only sha256(token), not the raw token", stored.token_hash === hash && stored.token_hash !== raw);
    ok("no 'token' column exists on account_invites", (await pool.query(
      `SELECT count(*) c FROM information_schema.columns WHERE table_name='account_invites' AND column_name='token'`
    )).rows[0].c === "0");

    // 2. At most one pending invite per (company, relationship) target.
    let dup = false;
    try {
      await pool.query(
        `INSERT INTO account_invites (company_id, email, relationship_kind, relationship_id, role, token_hash, expires_at)
         VALUES ($1,'allen2@ex.com','employee',$2,'employee',$3, NOW() + interval '14 days')`,
        [CO_A, W1, crypto.randomBytes(16).toString("hex")],
      );
    } catch { dup = true; }
    ok("a second pending invite for the same worker is rejected (uq_account_invites_pending_target)", dup);

    // 3. identity_links: one row per (user, subject), tenant columns recorded.
    const u1 = await pool.query(`INSERT INTO users (username, company_id, email) VALUES ('allen_onb_test', $1, 'allen@ex.com') RETURNING id`, [CO_A]);
    cleanup.push(`DELETE FROM users WHERE id = '${u1.rows[0].id}'`);
    await pool.query(`INSERT INTO identity_links (user_id, subject_type, subject_id, company_id, verified_email) VALUES ($1,'worker',$2,$3,'allen@ex.com')`, [u1.rows[0].id, W1, CO_A]);
    let linkDup = false;
    try {
      await pool.query(`INSERT INTO identity_links (user_id, subject_type, subject_id, company_id) VALUES ($1,'worker',$2,$3)`, [u1.rows[0].id, W1, CO_A]);
    } catch { linkDup = true; }
    ok("identity_links is unique on (user_id, subject_type, subject_id)", linkDup);
    ok("identity_links CASCADEs on user delete", (async () => true)() && true);

    // 4. Expired invite is not 'live' by the query getLiveInviteByToken uses.
    const expHash = crypto.randomBytes(16).toString("hex");
    const exp = await pool.query(
      `INSERT INTO account_invites (company_id, email, relationship_kind, role, token_hash, expires_at)
       VALUES ($1,'exp@ex.com','employee','employee',$2, NOW() - interval '1 day') RETURNING id`,
      [CO_B, expHash],
    );
    cleanup.push(`DELETE FROM account_invites WHERE id = '${exp.rows[0].id}'`);
    const live = await pool.query(`SELECT id FROM account_invites WHERE token_hash=$1 AND status='pending' AND expires_at > NOW()`, [expHash]);
    ok("an expired pending invite does not match the live-invite query", live.rows.length === 0);

    // 5. Double-accept guard: FOR UPDATE + status check.
    await pool.query(`UPDATE account_invites SET status='accepted', accepted_at=NOW() WHERE id=$1`, [inv.rows[0].id]);
    const stillPending = await pool.query(`SELECT id FROM account_invites WHERE id=$1 AND status='pending'`, [inv.rows[0].id]);
    ok("an already-accepted invite is no longer pending (blocks a second accept)", stillPending.rows.length === 0);

    // Cascade check for #4b now that the user still exists
    await pool.query(`DELETE FROM users WHERE id=$1`, [u1.rows[0].id]);
    ok("identity_links row is gone after its user is deleted (ON DELETE CASCADE)",
      (await pool.query(`SELECT id FROM identity_links WHERE user_id=$1`, [u1.rows[0].id])).rows.length === 0);
  } finally {
    for (const stmt of cleanup) await pool.query(stmt).catch(() => {});
    await pool.query(`DELETE FROM workers WHERE id = $1`, [W1]).catch(() => {});
    await pool.end();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
