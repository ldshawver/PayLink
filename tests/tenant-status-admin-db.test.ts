/**
 * PR-C1 — real-Postgres proof that a platform tenant status change and its
 * authorization_audit_log row commit together, and that an audit failure
 * rolls the status change back (companies.subscription_status and the
 * tenants.status mirror both unchanged).
 *
 * SAFETY: requires TEST_DATABASE_URL pointing at a disposable database built
 * via `drizzle-kit push`. Refuses staging/production-shaped names/hosts,
 * verifies current_database() before any write, never prints a URL, drops
 * fixtures in finally. Skips (exit 0) when TEST_DATABASE_URL is unset.
 *
 * Run: TEST_DATABASE_URL=postgresql://user@host/disposable npx tsx tests/tenant-status-admin-db.test.ts
 */
import { Pool } from "pg";
import assert from "node:assert/strict";

const FORBIDDEN = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.log("SKIP: TEST_DATABASE_URL not set — PR-C1 DB invariants not run (this is not a failure).");
    process.exit(0);
  }
  const parsed = new URL(url);
  const dbName = parsed.pathname.replace(/^\//, "");
  for (const p of FORBIDDEN) {
    if (p.test(dbName) || p.test(parsed.hostname)) throw new Error("Refusing to run against a staging/production-shaped database.");
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) throw new Error("TEST_DATABASE_URL equals this process's DATABASE_URL.");

  // server/db.ts (used by checkTenantGate) reads DATABASE_URL at import time,
  // and every server module below imports it transitively — so all server
  // imports are dynamic and happen only after the checks above.
  process.env.DATABASE_URL = url;
  const { applyTenantPatch } = await import("../server/tenant-status-admin");
  const { checkTenantGate } = await import("../server/tenant-enforcement");
  // checkTenantGate fails OPEN (allowed: true) on any query error, so an
  // "allowed" result only counts if its error path never fired.
  let gateErrors = 0;
  const origError = console.error;
  console.error = (...args: unknown[]) => { if (String(args[0]).includes("[TenantGate] check failed")) gateErrors++; origError(...args); };
  const { mapSubscriptionStatusToTenantStatus } = await import("../server/tenant-context");
  const pool = new Pool({ connectionString: url, max: 4 });
  const cur = (await pool.query("SELECT current_database() d")).rows[0].d;
  assert.equal(cur, dbName, "current_database() must match TEST_DATABASE_URL");

  let pass = 0, fail = 0;
  const ok = (n: string, c: boolean) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`); } };
  const tag = `prc1-${Date.now()}`;
  let tenantId = "", companyId = "";
  const extraTenants: string[] = [], extraCompanies: string[] = [];
  const fixture = async (label: string, status: string, sub: string, isDemo: boolean, trialEnd: Date | null) => {
    const c = (await pool.query(`INSERT INTO companies (name, subscription_status, is_demo, trial_end) VALUES ($1, $2, $3, $4) RETURNING id`, [`${tag} ${label} co`, sub, isDemo, trialEnd])).rows[0].id;
    const t = (await pool.query(`INSERT INTO tenants (name, slug, status) VALUES ($1, $1, $2) RETURNING id`, [`${tag}-${label}`, status])).rows[0].id;
    await pool.query(`INSERT INTO tenant_companies (tenant_id, company_id, is_primary) VALUES ($1, $2, true)`, [t, c]);
    extraTenants.push(t); extraCompanies.push(c);
    return { t, c };
  };
  // Same SELECT + mapping the TenantStatusMirrorReconcile job runs.
  const reconcileExpected = async (t: string) => {
    const row = (await pool.query(`SELECT c.subscription_status, c.is_demo, c.trial_end FROM tenants t JOIN tenant_companies tc ON tc.tenant_id = t.id AND tc.is_primary = TRUE JOIN companies c ON c.id = tc.company_id WHERE t.id = $1`, [t])).rows[0];
    return mapSubscriptionStatusToTenantStatus(row.subscription_status, row.is_demo, row.trial_end);
  };
  const tenantStatus = async (t: string) => (await pool.query(`SELECT status FROM tenants WHERE id = $1`, [t])).rows[0].status;

  try {
    companyId = (await pool.query(`INSERT INTO companies (name, subscription_status, is_demo) VALUES ($1, 'active_paid', false) RETURNING id`, [`${tag} co`])).rows[0].id;
    tenantId = (await pool.query(`INSERT INTO tenants (name, slug, status) VALUES ($1, $1, 'active') RETURNING id`, [tag])).rows[0].id;
    await pool.query(`INSERT INTO tenant_companies (tenant_id, company_id, is_primary) VALUES ($1, $2, true)`, [tenantId, companyId]);
    const state = async () => {
      const t = (await pool.query(`SELECT status FROM tenants WHERE id = $1`, [tenantId])).rows[0].status;
      const c = (await pool.query(`SELECT subscription_status FROM companies WHERE id = $1`, [companyId])).rows[0].subscription_status;
      const a = (await pool.query(`SELECT change_type, before_value, after_value, actor_user_id FROM authorization_audit_log WHERE tenant_id = $1 ORDER BY created_at`, [tenantId])).rows;
      return { t, c, a };
    };

    console.log("Committed change + audit");
    let r = await applyTenantPatch(pool, tenantId, { status: "suspended" }, { userId: `${tag}-admin`, role: "platform_admin" });
    let s = await state();
    ok("platform_admin suspend succeeds", r.ok);
    ok("companies.subscription_status = suspended", s.c === "suspended");
    ok("tenants.status mirror = suspended", s.t === "suspended");
    ok("one audit row active → suspended by the actor", s.a.length === 1 && s.a[0].change_type === "tenant_status_change" && s.a[0].before_value === "active" && s.a[0].after_value === "suspended" && s.a[0].actor_user_id === `${tag}-admin`);

    console.log("\nRead-only platform role");
    r = await applyTenantPatch(pool, tenantId, { status: "active" }, { userId: `${tag}-aud`, role: "platform_auditor" });
    s = await state();
    ok("platform_auditor rejected 403, state unchanged, no audit row", !r.ok && r.status === 403 && s.t === "suspended" && s.a.length === 1);

    console.log("\nRollback on audit failure");
    // Force the audit insert to fail inside the transaction with a CHECK
    // constraint scoped to this fixture's tenant id only.
    await pool.query(`ALTER TABLE authorization_audit_log ADD CONSTRAINT prc1_block_audit CHECK (tenant_id IS DISTINCT FROM '${tenantId}') NOT VALID`);
    let threw = false;
    try { await applyTenantPatch(pool, tenantId, { status: "active" }, { userId: `${tag}-admin`, role: "platform_super_admin" }); } catch { threw = true; }
    await pool.query(`ALTER TABLE authorization_audit_log DROP CONSTRAINT prc1_block_audit`);
    s = await state();
    ok("audit failure surfaces as an error", threw);
    ok("companies.subscription_status rolled back (still suspended)", s.c === "suspended");
    ok("tenants.status rolled back (still suspended)", s.t === "suspended");
    ok("no partial audit row", s.a.length === 1);

    console.log("\nTransition rules on real rows");
    r = await applyTenantPatch(pool, tenantId, { status: "cancelled" }, { userId: `${tag}-admin`, role: "platform_admin" });
    r = await applyTenantPatch(pool, tenantId, { status: "suspended" }, { userId: `${tag}-admin`, role: "platform_admin" });
    s = await state();
    ok("cancelled → suspended rejected 409", !r.ok && r.status === 409 && s.t === "cancelled");
    r = await applyTenantPatch(pool, tenantId, { status: "demo" }, { userId: `${tag}-admin`, role: "platform_admin" });
    ok("→ demo rejected", !r.ok);
    const isDemo = (await pool.query(`SELECT is_demo FROM companies WHERE id = $1`, [companyId])).rows[0].is_demo;
    ok("companies.is_demo never set by this route", isDemo === false);

    console.log("\nInvalid statuses");
    r = await applyTenantPatch(pool, tenantId, { status: "canceled" }, { userId: `${tag}-admin`, role: "platform_admin" });
    ok("misspelled 'canceled' rejected 400", !r.ok && r.status === 400);
    r = await applyTenantPatch(pool, tenantId, { status: "bogus" }, { userId: `${tag}-admin`, role: "platform_admin" });
    ok("unknown status rejected 400", !r.ok && r.status === 400);

    console.log("\nDemo tenants — enforcement wins over demo classification");
    const future = new Date(Date.now() + 86_400_000), past = new Date(Date.now() - 86_400_000);
    const demo = await fixture("demo", "demo", "active_paid", true, future);
    const other = await fixture("other", "active", "active_paid", false, null);
    ok("active demo: gate allows", (await checkTenantGate(demo.c)).allowed === true);
    ok("active demo: effective status is demo", (await reconcileExpected(demo.t)) === "demo");
    r = await applyTenantPatch(pool, demo.t, { status: "suspended" }, { userId: `${tag}-admin`, role: "platform_admin" });
    let g = await checkTenantGate(demo.c);
    ok("suspend demo commits; is_demo preserved", r.ok && (await pool.query(`SELECT is_demo FROM companies WHERE id = $1`, [demo.c])).rows[0].is_demo === true);
    ok("suspended demo: mirror = suspended", (await tenantStatus(demo.t)) === "suspended");
    ok("suspended demo: reconcile computes the same value (no flip back to demo)", (await reconcileExpected(demo.t)) === "suspended");
    ok("suspended demo: gate BLOCKS (code suspended)", g.allowed === false && g.code === "suspended");
    r = await applyTenantPatch(pool, demo.t, { status: "active" }, { userId: `${tag}-admin`, role: "platform_super_admin" });
    ok("suspended demo cannot be reactivated (409)", !r.ok && r.status === 409);
    r = await applyTenantPatch(pool, demo.t, { status: "cancelled" }, { userId: `${tag}-admin`, role: "platform_admin" });
    g = await checkTenantGate(demo.c);
    ok("cancelled demo: mirror and reconcile = cancelled, gate BLOCKS (code cancelled)", r.ok && (await tenantStatus(demo.t)) === "cancelled" && (await reconcileExpected(demo.t)) === "cancelled" && g.allowed === false && g.code === "cancelled");
    const demoAudit = (await pool.query(`SELECT before_value, after_value FROM authorization_audit_log WHERE tenant_id = $1 AND change_type = 'tenant_status_change' ORDER BY created_at`, [demo.t])).rows;
    ok("demo audit trail: demo → suspended → cancelled", demoAudit.length === 2 && demoAudit[0].before_value === "demo" && demoAudit[0].after_value === "suspended" && demoAudit[1].after_value === "cancelled");

    const expired = await fixture("expired", "demo", "active_paid", true, past);
    g = await checkTenantGate(expired.c);
    ok("expired demo: gate BLOCKS (code trial_expired)", g.allowed === false && g.code === "trial_expired");
    ok("expired demo: effective status suspended, not demo/active", (await reconcileExpected(expired.t)) === "suspended");
    r = await applyTenantPatch(pool, expired.t, { status: "active" }, { userId: `${tag}-admin`, role: "platform_super_admin" });
    ok("expired demo cannot be reactivated (409)", !r.ok && r.status === 409);

    console.log("\nCross-tenant isolation");
    const otherSub = (await pool.query(`SELECT subscription_status FROM companies WHERE id = $1`, [other.c])).rows[0].subscription_status;
    const otherAudit = Number((await pool.query(`SELECT count(*) FROM authorization_audit_log WHERE tenant_id = $1`, [other.t])).rows[0].count);
    ok("other tenant untouched by all of the above (status, company, audit)", (await tenantStatus(other.t)) === "active" && otherSub === "active_paid" && otherAudit === 0);
    ok("non-demo active tenant: gate still allows", (await checkTenantGate(other.c)).allowed === true);
    ok("checkTenantGate never hit its fail-open error path (allowed results are genuine)", gateErrors === 0);
  } finally {
    for (const t of extraTenants) {
      await pool.query(`DELETE FROM authorization_audit_log WHERE tenant_id = $1`, [t]);
      await pool.query(`DELETE FROM tenant_companies WHERE tenant_id = $1`, [t]);
      await pool.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    }
    for (const c of extraCompanies) await pool.query(`DELETE FROM companies WHERE id = $1`, [c]);
    await pool.query(`ALTER TABLE authorization_audit_log DROP CONSTRAINT IF EXISTS prc1_block_audit`).catch(() => {});
    if (tenantId) {
      await pool.query(`DELETE FROM authorization_audit_log WHERE tenant_id = $1`, [tenantId]);
      await pool.query(`DELETE FROM tenant_companies WHERE tenant_id = $1`, [tenantId]);
      await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    }
    if (companyId) await pool.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
    await pool.end();
    const { db } = await import("../server/db");
    await (db as any).$client.end().catch(() => {});
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
