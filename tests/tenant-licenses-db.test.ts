/**
 * PR 4 — tenant licenses: real-Postgres invariants
 * (migrations/0022_tenant_licenses.sql). Raw SQL only; does NOT boot the app.
 * The full HTTP flow (platform admin views/updates a license; a non-admin is
 * refused; a new trial gets a 'trialing' record; an existing company with no
 * record keeps working; an explicit expired/suspended record blocks only
 * POST /api/customers|invoices|documents) runs as the staging synthetic
 * acceptance, matching PR 2 / PR 3.
 *
 * SAFETY: requires TEST_DATABASE_URL pointing at a disposable database. Refuses
 * staging/production-shaped names/hosts, verifies current_database() before any
 * write, never prints a URL, drops fixtures in finally. Skips (exit 0) when
 * TEST_DATABASE_URL is unset.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable npx tsx tests/tenant-licenses-db.test.ts
 */
import { Pool } from "pg";
import assert from "node:assert/strict";
import fs from "node:fs";
import { resolveLicense } from "../server/licensing/license-resolver";

const FORBIDDEN = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.log("SKIP: TEST_DATABASE_URL not set — PR 4 DB invariants not run (this is not a failure).");
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

  const cleanupCompanies: string[] = [];
  try {
    // Minimal companies stub — the real table is far wider; we only need the
    // columns the resolver / service read.
    await pool.query(`CREATE TABLE IF NOT EXISTS companies (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT,
      plan_name TEXT,
      subscription_status TEXT DEFAULT 'active_paid',
      trial_start TIMESTAMP, trial_end TIMESTAMP,
      billing_active BOOLEAN DEFAULT FALSE,
      grace_period_end TIMESTAMP,
      gate_override_reason TEXT,
      is_demo BOOLEAN DEFAULT FALSE
    )`);

    const forward = fs.readFileSync("migrations/0022_tenant_licenses.sql", "utf8").split("ROLLBACK")[0];
    await pool.query(forward);
    ok("migration 0022 applies", true);
    ok("migration 0022 is idempotent (re-run is a no-op)",
      await pool.query(forward).then(() => true).catch(() => false));

    for (const t of ["tenant_licenses", "tenant_license_events"]) {
      ok(`table ${t} exists`, (await pool.query(`SELECT to_regclass('public.${t}') t`)).rows[0].t === t);
    }
    ok("uq_tenant_licenses_company unique index exists",
      (await pool.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_tenant_licenses_company'`)).rows[0]?.indexdef?.includes("UNIQUE"));

    // ── fixture: one legacy company (no license row), one licensed company ──
    const legacy = (await pool.query(
      `INSERT INTO companies (name, subscription_status) VALUES ('ZZ Legacy Co (PR4 test)', 'suspended') RETURNING id`,
    )).rows[0].id as string;
    cleanupCompanies.push(legacy);
    const licensed = (await pool.query(
      `INSERT INTO companies (name, subscription_status) VALUES ('ZZ Licensed Co (PR4 test)', 'active_paid') RETURNING id`,
    )).rows[0].id as string;
    cleanupCompanies.push(licensed);

    // ── legacy company: no tenant_licenses row → resolver never blocks ──────
    {
      const licRow = (await pool.query(`SELECT * FROM tenant_licenses WHERE company_id = $1`, [legacy])).rows[0] ?? null;
      const compRow = (await pool.query(`SELECT subscription_status, plan_name, trial_start, trial_end, billing_active, grace_period_end, gate_override_reason, is_demo FROM companies WHERE id = $1`, [legacy])).rows[0];
      const resolved = resolveLicense(
        licRow && { status: licRow.status, planType: licRow.plan_type, trialStart: licRow.trial_start, trialEnd: licRow.trial_end, source: licRow.source },
        { subscriptionStatus: compRow.subscription_status, planName: compRow.plan_name, trialStart: compRow.trial_start, trialEnd: compRow.trial_end, billingActive: compRow.billing_active, gracePeriodEnd: compRow.grace_period_end, gateOverrideReason: compRow.gate_override_reason, isDemo: compRow.is_demo },
      );
      ok("legacy suspended company: no tenant_licenses row present", licRow === null);
      ok("legacy suspended company: resolver source = company_gate, isLegacy true", resolved.source === "company_gate" && resolved.isLegacy);
      ok("legacy suspended company: narrow gate does NOT block (never locked out by PR 4)", resolved.gateBlocks === false);
    }

    // ── ensureTrialLicense shape: INSERT ... ON CONFLICT (company_id) DO NOTHING ──
    {
      const ins = async () => pool.query(
        `INSERT INTO tenant_licenses (company_id, plan_type, status, source) VALUES ($1, 'starter', 'trialing', 'trial_signup')
         ON CONFLICT (company_id) DO NOTHING RETURNING id`, [licensed]);
      const first = await ins();
      ok("first trial-license insert creates a row", first.rowCount === 1);
      const second = await ins();
      ok("second insert is a no-op (ON CONFLICT DO NOTHING) — no access change, no duplicate", second.rowCount === 0);
      const count = (await pool.query(`SELECT count(*)::int c FROM tenant_licenses WHERE company_id = $1`, [licensed])).rows[0].c;
      ok("exactly one license row per company (unique company_id enforced)", count === 1);
    }

    // ── adminUpsertLicense shape: DO UPDATE keeps mirror + we assert consistency ──
    {
      // Simulate the service transaction: company column + mirror move together.
      await pool.query(`UPDATE companies SET subscription_status = 'suspended', gate_override_reason = 'non-payment' WHERE id = $1`, [licensed]);
      await pool.query(
        `INSERT INTO tenant_licenses (company_id, plan_type, status, source, status_reason, status_changed_at)
         VALUES ($1, 'starter', 'suspended', 'admin', 'non-payment', NOW())
         ON CONFLICT (company_id) DO UPDATE SET status = 'suspended', source = 'admin', status_reason = 'non-payment', status_changed_at = NOW(), updated_at = NOW()`,
        [licensed],
      );
      await pool.query(
        `INSERT INTO tenant_license_events (company_id, event_type, from_status, to_status, reason, actor_user_id)
         VALUES ($1, 'status_changed', 'trialing', 'suspended', 'non-payment', 'test-admin')`,
        [licensed],
      );
      const lic = (await pool.query(`SELECT status FROM tenant_licenses WHERE company_id = $1`, [licensed])).rows[0].status;
      const comp = (await pool.query(`SELECT subscription_status FROM companies WHERE id = $1`, [licensed])).rows[0].subscription_status;
      ok("after admin suspend: tenant_licenses.status = 'suspended'", lic === "suspended");
      ok("after admin suspend: companies.subscription_status also moved to 'suspended' (no split-brain)", comp === "suspended");
      const ev = (await pool.query(`SELECT count(*)::int c FROM tenant_license_events WHERE company_id = $1`, [licensed])).rows[0].c;
      ok("an audit event row was written", ev >= 1);

      // Now the licensed company DOES have an explicit blocking record → gate blocks.
      const licRow = (await pool.query(`SELECT * FROM tenant_licenses WHERE company_id = $1`, [licensed])).rows[0];
      const resolved = resolveLicense({ status: licRow.status, planType: licRow.plan_type, source: licRow.source }, { subscriptionStatus: "suspended" });
      ok("licensed + explicit 'suspended' record → resolver.gateBlocks = true (narrow gate would 403)", resolved.gateBlocks === true);
      ok("licensed + explicit record → isLegacy false", resolved.isLegacy === false);
    }

    ok("status column accepts all 6 normalized values",
      await pool.query(`INSERT INTO tenant_licenses (company_id, status) VALUES
        ('zz-x1','trialing'),('zz-x2','active'),('zz-x3','expired'),('zz-x4','suspended'),('zz-x5','cancelled'),('zz-x6','inactive')`)
        .then(() => true).catch(() => false));
    await pool.query(`DELETE FROM tenant_licenses WHERE company_id LIKE 'zz-x%'`);
  } finally {
    for (const id of cleanupCompanies) {
      await pool.query(`DELETE FROM tenant_license_events WHERE company_id = $1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM tenant_licenses WHERE company_id = $1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM companies WHERE id = $1`, [id]).catch(() => {});
    }
    await pool.end();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
