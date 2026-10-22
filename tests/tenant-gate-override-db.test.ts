/**
 * PR-C1 — real-Postgres proof for the platform_super_admin gate override
 * (applyGateOverride): status + gate_override_reason + tenants.status mirror +
 * authorization_audit_log row commit together; an audit failure rolls all of
 * it back; an override cannot soften a suspension/cancellation, reinstate a
 * demo, or touch an integrity-repair company; checkTenantGate agrees with the
 * resulting state; other companies/tenants are untouched.
 *
 * SAFETY: requires TEST_DATABASE_URL pointing at a disposable database built
 * via `drizzle-kit push`. Refuses staging/production-shaped names/hosts,
 * verifies current_database() before any write, never prints a URL, drops
 * fixtures in finally. Skips (exit 0) when TEST_DATABASE_URL is unset.
 *
 * Run: TEST_DATABASE_URL=postgresql://user@host/disposable npx tsx tests/tenant-gate-override-db.test.ts
 */
import { Pool } from "pg";
import assert from "node:assert/strict";

const FORBIDDEN = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.log("SKIP: TEST_DATABASE_URL not set — PR-C1 gate-override DB invariants not run (this is not a failure).");
    process.exit(0);
  }
  const parsed = new URL(url);
  const dbName = parsed.pathname.replace(/^\//, "");
  for (const p of FORBIDDEN) {
    if (p.test(dbName) || p.test(parsed.hostname)) throw new Error("Refusing to run against a staging/production-shaped database.");
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) throw new Error("TEST_DATABASE_URL equals this process's DATABASE_URL.");

  // server/db.ts reads DATABASE_URL at import time — dynamic imports only
  // after the checks above.
  process.env.DATABASE_URL = url;
  const { applyGateOverride } = await import("../server/tenant-gate-override");
  const { checkTenantGate } = await import("../server/tenant-enforcement");
  const { mapSubscriptionStatusToTenantStatus } = await import("../server/tenant-context");
  let gateErrors = 0;
  const origError = console.error;
  console.error = (...args: unknown[]) => { if (String(args[0]).includes("[TenantGate] check failed")) gateErrors++; origError(...args); };
  const pool = new Pool({ connectionString: url, max: 4 });
  const cur = (await pool.query("SELECT current_database() d")).rows[0].d;
  assert.equal(cur, dbName, "current_database() must match TEST_DATABASE_URL");

  let pass = 0, fail = 0;
  const ok = (n: string, c: boolean) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`); } };
  const tag = `prc1go-${Date.now()}`;
  const SA = { userId: `${tag}-sa`, role: "platform_super_admin" };
  const R = "Platform override by super admin";
  const tenants: string[] = [], companies: string[] = [];
  const fixture = async (label: string, sub: string, opts: { isDemo?: boolean; trialEnd?: Date | null; reason?: string | null; tenantStatus?: string } = {}) => {
    const c = (await pool.query(`INSERT INTO companies (name, subscription_status, is_demo, trial_end, gate_override_reason) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [`${tag} ${label} co`, sub, opts.isDemo ?? false, opts.trialEnd ?? null, opts.reason ?? null])).rows[0].id;
    const t = (await pool.query(`INSERT INTO tenants (name, slug, status) VALUES ($1, $1, $2) RETURNING id`, [`${tag}-${label}`, opts.tenantStatus ?? mapSubscriptionStatusToTenantStatus(sub, opts.isDemo, opts.trialEnd)])).rows[0].id;
    await pool.query(`INSERT INTO tenant_companies (tenant_id, company_id, is_primary) VALUES ($1, $2, true)`, [t, c]);
    tenants.push(t); companies.push(c);
    return { t, c };
  };
  const state = async (f: { t: string; c: string }) => {
    const c = (await pool.query(`SELECT subscription_status, gate_override_reason, is_demo FROM companies WHERE id = $1`, [f.c])).rows[0];
    const t = (await pool.query(`SELECT status FROM tenants WHERE id = $1`, [f.t])).rows[0].status;
    const a = (await pool.query(`SELECT actor_user_id, target_resource, change_type, before_value, after_value, note, company_id, tenant_id, created_at FROM authorization_audit_log WHERE company_id = $1 ORDER BY created_at`, [f.c])).rows;
    return { sub: c.subscription_status, reason: c.gate_override_reason, isDemo: c.is_demo, t, a };
  };

  try {
    console.log("Reinstatement: suspended → active_paid (committed + audited)");
    const a = await fixture("susp", "suspended");
    ok("precondition: gate blocks suspended", (await checkTenantGate(a.c)).allowed === false);
    let r = await applyGateOverride(pool, a.c, { subscriptionStatus: "active_paid", reason: "Paid by wire" }, SA);
    let s = await state(a);
    ok("override succeeds", r.ok);
    ok("companies.subscription_status = active_paid, reason stored", s.sub === "active_paid" && s.reason === "Paid by wire");
    ok("tenants.status mirror = active (same transaction)", s.t === "active");
    const row = s.a[0];
    const note = row ? JSON.parse(row.note) : {};
    ok("one gate_override audit row: actor, company, tenant, before, after, timestamp", s.a.length === 1 && row.change_type === "gate_override" && row.actor_user_id === SA.userId && row.target_resource === `company:${a.c}` && row.company_id === a.c && row.tenant_id === a.t && row.before_value === "suspended" && row.after_value === "active_paid" && row.created_at instanceof Date);
    ok("audit note records reason, previous reason and role", note.reason === "Paid by wire" && note.previousReason === null && note.role === "platform_super_admin");
    ok("gate now allows", (await checkTenantGate(a.c)).allowed === true);

    console.log("\nAuthorization (service layer)");
    for (const role of ["platform_admin", "platform_auditor", "platform_billing", "tenant_admin"]) {
      r = await applyGateOverride(pool, a.c, { subscriptionStatus: "suspended", reason: R }, { userId: `${tag}-x`, role });
      ok(`${role} → 403, state + audit unchanged`, !r.ok && r.status === 403);
    }
    s = await state(a);
    ok("after rejected roles: still active_paid with one audit row", s.sub === "active_paid" && s.a.length === 1);

    console.log("\nRollback on audit failure");
    const b = await fixture("rollback", "suspended", { reason: "before" });
    await pool.query(`ALTER TABLE authorization_audit_log ADD CONSTRAINT prc1go_block_audit CHECK (company_id IS DISTINCT FROM '${b.c}') NOT VALID`);
    let threw = false;
    try { await applyGateOverride(pool, b.c, { subscriptionStatus: "active_paid", reason: R }, SA); } catch { threw = true; }
    await pool.query(`ALTER TABLE authorization_audit_log DROP CONSTRAINT prc1go_block_audit`);
    s = await state(b);
    ok("audit failure surfaces as an error", threw);
    ok("subscription_status rolled back (still suspended)", s.sub === "suspended");
    ok("gate_override_reason rolled back", s.reason === "before");
    ok("tenants.status rolled back (still suspended)", s.t === "suspended");
    ok("no partial audit row", s.a.length === 0);
    ok("gate still blocks", (await checkTenantGate(b.c)).allowed === false);

    console.log("\nNo softening of suspension / cancellation");
    const c = await fixture("cancel", "cancelled");
    for (const to of ["past_due", "grace", "trial_active", "suspended"]) {
      r = await applyGateOverride(pool, c.c, { subscriptionStatus: to, reason: R }, SA);
      ok(`cancelled → ${to} rejected 409`, !r.ok && r.status === 409);
    }
    const d = await fixture("susp2", "suspended");
    for (const to of ["past_due", "grace"]) {
      r = await applyGateOverride(pool, d.c, { subscriptionStatus: to, reason: R }, SA);
      ok(`suspended → ${to} rejected 409`, !r.ok && r.status === 409);
    }
    ok("cancelled/suspended rows unchanged, no audit rows, gate blocks both",
      (await state(c)).sub === "cancelled" && (await state(c)).a.length === 0 && (await state(d)).sub === "suspended" && (await state(d)).a.length === 0
      && (await checkTenantGate(c.c)).code === "cancelled" && (await checkTenantGate(d.c)).code === "suspended");
    for (const bad of ["canceled", "active", "bogus"]) {
      r = await applyGateOverride(pool, d.c, { subscriptionStatus: bad, reason: R }, SA);
      ok(`unsupported value '${bad}' rejected 400`, !r.ok && r.status === 400);
    }
    r = await applyGateOverride(pool, d.c, { subscriptionStatus: "active_paid" }, SA);
    ok("status change without reason rejected 400", !r.ok && r.status === 400 && (await state(d)).sub === "suspended");
    const u = await fixture("legacy", "weird_legacy", { tenantStatus: "active" });
    r = await applyGateOverride(pool, u.c, { subscriptionStatus: "active_paid", reason: R }, SA);
    ok("unrecognized stored status → active_paid rejected 409", !r.ok && r.status === 409);

    console.log("\nRestrictive overrides take effect at the gate");
    const e = await fixture("active", "active_paid");
    r = await applyGateOverride(pool, e.c, { subscriptionStatus: "suspended", reason: R }, SA);
    ok("active → suspended: gate blocks, mirror suspended", r.ok && (await checkTenantGate(e.c)).code === "suspended" && (await state(e)).t === "suspended");
    r = await applyGateOverride(pool, e.c, { subscriptionStatus: "cancelled", reason: R }, SA);
    ok("suspended → cancelled: gate blocks (cancelled), mirror cancelled", r.ok && (await checkTenantGate(e.c)).code === "cancelled" && (await state(e)).t === "cancelled");
    ok("audit trail active_paid → suspended → cancelled", (await state(e)).a.map((x: any) => `${x.before_value}>${x.after_value}`).join(",") === "active_paid>suspended,suspended>cancelled");

    console.log("\nDemo companies");
    const future = new Date(Date.now() + 86_400_000);
    const dm = await fixture("demo", "active_paid", { isDemo: true, trialEnd: future });
    r = await applyGateOverride(pool, dm.c, { subscriptionStatus: "suspended", reason: R }, SA);
    s = await state(dm);
    ok("demo suspend: mirror suspended, is_demo kept, gate blocks", r.ok && s.t === "suspended" && s.isDemo === true && (await checkTenantGate(dm.c)).allowed === false);
    r = await applyGateOverride(pool, dm.c, { subscriptionStatus: "active_paid", reason: R }, SA);
    ok("suspended demo cannot be reinstated (409), gate still blocks", !r.ok && r.status === 409 && (await state(dm)).sub === "suspended" && (await checkTenantGate(dm.c)).allowed === false);

    console.log("\nIntegrity-repair companies are inert");
    const ir = await fixture("integrity", "active_paid", { isDemo: true, reason: "integrity-repair: protected parent" });
    r = await applyGateOverride(pool, ir.c, { subscriptionStatus: "suspended", reason: R }, SA);
    const r2 = await applyGateOverride(pool, ir.c, { reason: null }, SA);
    s = await state(ir);
    ok("override + clear both refused 409; marker and status kept; no audit", !r.ok && r.status === 409 && !r2.ok && r2.status === 409 && s.reason === "integrity-repair: protected parent" && s.sub === "active_paid" && s.a.length === 0);
    const plain = await fixture("plain", "active_paid");
    r = await applyGateOverride(pool, plain.c, { reason: "integrity-repair forged" }, SA);
    ok("forging the marker on another company refused 400", !r.ok && r.status === 400 && (await state(plain)).reason === null);

    console.log("\nTenant association — mirror follows the primary company only");
    const multi = await fixture("multi", "active_paid");
    const sec = (await pool.query(`INSERT INTO companies (name, subscription_status, is_demo) VALUES ($1, 'active_paid', false) RETURNING id`, [`${tag} secondary co`])).rows[0].id;
    companies.push(sec);
    await pool.query(`INSERT INTO tenant_companies (tenant_id, company_id, is_primary) VALUES ($1, $2, false)`, [multi.t, sec]);
    r = await applyGateOverride(pool, sec, { subscriptionStatus: "suspended", reason: R }, SA);
    const secSub = (await pool.query(`SELECT subscription_status FROM companies WHERE id = $1`, [sec])).rows[0].subscription_status;
    const secAudit = (await pool.query(`SELECT tenant_id FROM authorization_audit_log WHERE company_id = $1`, [sec])).rows;
    ok("secondary company suspended; audit row carries its tenant", r.ok && secSub === "suspended" && secAudit.length === 1 && secAudit[0].tenant_id === multi.t);
    ok("tenant mirror (primary active_paid) NOT rewritten to suspended", (await state(multi)).t === "active" && (await state(multi)).sub === "active_paid");
    r = await applyGateOverride(pool, `${tag}-missing`, { subscriptionStatus: "suspended", reason: R }, SA);
    ok("nonexistent company → 404", !r.ok && r.status === 404);

    console.log("\nCross-tenant isolation");
    const other = await fixture("other", "active_paid");
    s = await state(other);
    ok("bystander tenant untouched by all of the above", s.sub === "active_paid" && s.t === "active" && s.reason === null && s.a.length === 0 && (await checkTenantGate(other.c)).allowed === true);
    ok("checkTenantGate never hit its fail-open error path", gateErrors === 0);
  } finally {
    await pool.query(`ALTER TABLE authorization_audit_log DROP CONSTRAINT IF EXISTS prc1go_block_audit`).catch(() => {});
    for (const c of companies) await pool.query(`DELETE FROM authorization_audit_log WHERE company_id = $1`, [c]);
    for (const t of tenants) {
      await pool.query(`DELETE FROM authorization_audit_log WHERE tenant_id = $1`, [t]);
      await pool.query(`DELETE FROM tenant_companies WHERE tenant_id = $1`, [t]);
      await pool.query(`DELETE FROM tenants WHERE id = $1`, [t]);
    }
    for (const c of companies) await pool.query(`DELETE FROM companies WHERE id = $1`, [c]);
    await pool.end();
    const { db } = await import("../server/db");
    await (db as any).$client.end().catch(() => {});
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
