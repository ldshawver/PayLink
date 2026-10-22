/**
 * P0-D — real server, real HTTP, disposable database: a tenant whose
 * companies.subscription_status is "cancelled" OR "canceled" is refused on
 * protected writes (requireActiveSubscription) and by checkTenantGate, while
 * reads, logout and the exempt billing path stay reachable; a Stripe
 * payment_failed event never moves either spelling (or suspended) into the
 * access-granting grace_period. An active tenant is the positive control.
 *
 * Run: TEST_DATABASE_URL=postgresql://user@host/disposable npx tsx tests/cancelled-status-enforcement-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { startTestServer, login, apiRequest, type TestServer } from "../scripts/cross-tenant-negative-tests/server-harness";
import { cascadeDelete, verifyZeroResidue } from "../scripts/cross-tenant-negative-tests/cascade-cleanup";

const FORBIDDEN_PATTERNS = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) { console.log(`  ✓  ${name}`); passed++; }
  else { console.error(`  ✗  ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
};

async function main() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    console.log("TEST_DATABASE_URL not set — skipping cancelled-status-enforcement DB tests (0 run).");
    return;
  }
  const parsed = new URL(testDatabaseUrl);
  for (const p of FORBIDDEN_PATTERNS) {
    if (p.test(parsed.pathname.slice(1)) || p.test(parsed.hostname)) throw new Error("TEST_DATABASE_URL looks like staging/production. Refusing to run.");
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === testDatabaseUrl) throw new Error("TEST_DATABASE_URL is identical to DATABASE_URL. Refusing.");
  // Never let the billing handler reach a real mail server.
  for (const k of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_PASSWORD"]) delete process.env[k];

  const pool = new Pool({ connectionString: testDatabaseUrl, max: 6 });
  const sfx = crypto.randomBytes(4).toString("hex");
  const companies: Record<string, string> = {};
  let server: TestServer | undefined;

  try {
    const dbName = (await pool.query("SELECT current_database() AS n")).rows[0]?.n as string;
    if (dbName !== parsed.pathname.slice(1) || FORBIDDEN_PATTERNS.some((p) => p.test(dbName))) throw new Error("current_database() mismatch or protected. Refusing.");

    const statuses = { active: "active_paid", cancelled: "cancelled", canceled: "canceled", upper: "CANCELED", suspended: "suspended" };
    const pw = crypto.randomBytes(10).toString("hex");
    const pwHash = await bcrypt.hash(pw, 10);
    for (const [label, status] of Object.entries(statuses)) {
      const id = crypto.randomUUID();
      companies[label] = id;
      await pool.query(`INSERT INTO companies (id, name, subscription_status, stripe_customer_id) VALUES ($1, $2, $3, $4)`, [id, `P0D ${label} ${sfx}`, status, `cus_p0d_${label}_${sfx}`]);
      await pool.query(`INSERT INTO users (id, username, password, role, company_id, is_active) VALUES ($1, $2, $3, 'admin', $4, true)`, [crypto.randomUUID(), `p0d_${label}_${sfx}`, pwHash, id]);
    }

    process.env.DATABASE_URL = testDatabaseUrl;
    const { checkTenantGate } = await import("../server/tenant-enforcement");
    const { handleTenantBillingEvent } = await import("../server/billingLifecycle");

    console.log("\n── checkTenantGate ──");
    for (const label of ["cancelled", "canceled", "upper"]) {
      const g = await checkTenantGate(companies[label]);
      check(`${statuses[label as keyof typeof statuses]} → blocked, code cancelled`, g.allowed === false && g.code === "cancelled", JSON.stringify(g));
    }
    check("suspended → blocked, code suspended", (await checkTenantGate(companies.suspended)).code === "suspended");
    check("active_paid → allowed (control)", (await checkTenantGate(companies.active)).allowed === true);

    server = await startTestServer(testDatabaseUrl);
    const base = server.baseUrl;

    console.log("\n── requireActiveSubscription on a protected write (POST /api/workers) ──");
    const sActive = await login(base, `p0d_active_${sfx}`, pw);
    const rActive = await apiRequest(base, "POST", "/api/workers", sActive, {});
    check("active tenant is not refused by the subscription gate (control)", !["tenant_cancelled", "tenant_suspended"].includes((rActive.body as any)?.reason), `status=${rActive.status} body=${JSON.stringify(rActive.body)}`);
    for (const label of ["cancelled", "canceled", "upper"]) {
      const s = await login(base, `p0d_${label}_${sfx}`, pw);
      const r = await apiRequest(base, "POST", "/api/workers", s, { firstName: "X", lastName: "Y" });
      check(`${statuses[label as keyof typeof statuses]}: write → 403 tenant_cancelled`, r.status === 403 && (r.body as any)?.reason === "tenant_cancelled", `status=${r.status} body=${JSON.stringify(r.body)}`);
      const n = (await pool.query(`SELECT count(*)::int n FROM workers WHERE company_id = $1`, [companies[label]])).rows[0].n;
      check(`${statuses[label as keyof typeof statuses]}: no worker row written`, n === 0);
      const g = await apiRequest(base, "GET", "/api/auth/me", s);
      check(`${statuses[label as keyof typeof statuses]}: reads still reachable (GET /api/auth/me 200)`, g.status === 200, `status=${g.status}`);
      const b = await apiRequest(base, "POST", "/api/billing/activate", s, {});
      check(`${statuses[label as keyof typeof statuses]}: exempt billing path not refused by the subscription gate`, (b.body as any)?.reason !== "tenant_cancelled", `status=${b.status}`);
      const lo = await apiRequest(base, "POST", "/api/auth/logout", s);
      check(`${statuses[label as keyof typeof statuses]}: logout allowed`, lo.status < 400, `status=${lo.status}`);
    }
    const sSusp = await login(base, `p0d_suspended_${sfx}`, pw);
    const rSusp = await apiRequest(base, "POST", "/api/workers", sSusp, { firstName: "X", lastName: "Y" });
    check("suspended: write → 403 tenant_suspended (unchanged)", rSusp.status === 403 && (rSusp.body as any)?.reason === "tenant_suspended", `status=${rSusp.status}`);

    console.log("\n── Stripe invoice.payment_failed ──");
    const auditCount = async (id: string) => (await pool.query(`SELECT count(*)::int n FROM authorization_audit_log WHERE company_id = $1`, [id])).rows[0].n;
    for (const label of ["cancelled", "canceled", "suspended"]) {
      await handleTenantBillingEvent("invoice.payment_failed", { customer: `cus_p0d_${label}_${sfx}` });
      const row = (await pool.query(`SELECT subscription_status, grace_period_end FROM companies WHERE id = $1`, [companies[label]])).rows[0];
      check(`${statuses[label as keyof typeof statuses]}: stays ${statuses[label as keyof typeof statuses]}, no grace period, no audit row`, row.subscription_status === statuses[label as keyof typeof statuses] && row.grace_period_end === null && (await auditCount(companies[label])) === 0, JSON.stringify(row));
    }
    await handleTenantBillingEvent("invoice.payment_failed", { customer: `cus_p0d_active_${sfx}` });
    const act = (await pool.query(`SELECT subscription_status, grace_period_end FROM companies WHERE id = $1`, [companies.active])).rows[0];
    check("active_paid → grace_period with an end date + audit row (control, behaviour unchanged)", act.subscription_status === "grace_period" && act.grace_period_end !== null && (await auditCount(companies.active)) === 1);
  } finally {
    if (server) await server.stop();
    const ids = Object.values(companies);
    try {
      await pool.query(`DELETE FROM authorization_audit_log WHERE company_id = ANY($1::varchar[])`, [ids]);
      await pool.query(`DELETE FROM session WHERE sess->>'userId' IN (SELECT id FROM users WHERE username LIKE $1)`, [`p0d_%_${sfx}`]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE username LIKE $1`, [`p0d_%_${sfx}`]);
      await cascadeDelete(pool, "companies", ids);
      const residue = await verifyZeroResidue(pool, "companies", ids);
      const strayUsers = (await pool.query(`SELECT count(*)::int n FROM users WHERE username LIKE $1`, [`p0d_%_${sfx}`])).rows[0].n;
      if (strayUsers) residue.push(`test users: ${strayUsers}`);
      if (residue.length) { console.error("CLEANUP RESIDUE:", residue.join("; ")); failed++; } else console.log("cleanup: zero residue confirmed");
    } catch (e) { console.error("cleanup error:", (e as Error).message); failed++; }
    await pool.end();
    try { const { db } = await import("../server/db"); await (db as any).$client.end(); } catch { /* not loaded */ }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
