/**
 * P0-C — real server, real HTTP, disposable database: tenant gating fails
 * closed. When the eligibility lookup errors (a real query failure, induced by
 * renaming a column the gates read), protected writes get a generic 503 and
 * GET /api/auth/me reports tenantGate { allowed: false, code: gate_unavailable }
 * without any database detail, while anonymous public endpoints, /health and
 * logout keep working. NULL / unrecognised statuses, a missing company row,
 * trial_expired and an expired "grace" are denied; suspended and cancelled stay
 * denied; active, unexpired grace_period and an unexpired demo stay allowed.
 * A suspended tenant's user cannot write by targeting another company it has
 * access to, the other tenant is untouched, and a platform admin can still
 * reinstate the suspended tenant.
 *
 * Run: TEST_DATABASE_URL=postgresql://user@host/disposable npx tsx tests/tenant-gate-fail-closed-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { startTestServer, login, apiRequest, type TestServer, type Session } from "../scripts/cross-tenant-negative-tests/server-harness";
import { cascadeDelete, verifyZeroResidue } from "../scripts/cross-tenant-negative-tests/cascade-cleanup";

const FORBIDDEN_PATTERNS = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) { console.log(`  ✓  ${name}`); passed++; }
  else { console.error(`  ✗  ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
};

const LEAK = /column|relation|grace_period_end|zz_gpe|syntax|postgres|sql|stack/i;

async function main() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    console.log("TEST_DATABASE_URL not set — skipping tenant-gate-fail-closed DB tests (0 run).");
    return;
  }
  const parsed = new URL(testDatabaseUrl);
  for (const p of FORBIDDEN_PATTERNS) {
    if (p.test(parsed.pathname.slice(1)) || p.test(parsed.hostname)) throw new Error("TEST_DATABASE_URL looks like staging/production. Refusing to run.");
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === testDatabaseUrl) throw new Error("TEST_DATABASE_URL is identical to DATABASE_URL. Refusing.");
  for (const k of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_PASSWORD"]) delete process.env[k];

  const pool = new Pool({ connectionString: testDatabaseUrl, max: 6 });
  const sfx = crypto.randomBytes(4).toString("hex");
  const companies: Record<string, string> = {};
  let server: TestServer | undefined;
  let columnRenamed = false;

  try {
    const dbName = (await pool.query("SELECT current_database() AS n")).rows[0]?.n as string;
    if (dbName !== parsed.pathname.slice(1) || FORBIDDEN_PATTERNS.some((p) => p.test(dbName))) throw new Error("current_database() mismatch or protected. Refusing.");

    // Boot first: startup DDL adds columns the fixtures below rely on.
    server = await startTestServer(testDatabaseUrl);
    const base = server.baseUrl;

    const day = 86_400_000;
    const past = new Date(Date.now() - 2 * day), future = new Date(Date.now() + 10 * day);
    const fixtures: Record<string, { status: string | null; demo?: boolean; trialEnd?: Date; graceEnd?: Date }> = {
      active: { status: "active_paid" },
      bystander: { status: "active_paid" },
      suspended: { status: "suspended" },
      canceled: { status: "canceled" },
      unknown: { status: "pending_review" },
      nullst: { status: null },
      trialExpired: { status: "trial_expired" },
      trialLapsed: { status: "trialing", trialEnd: past },
      graceExpired: { status: "grace", graceEnd: past },
      graceOk: { status: "grace_period", graceEnd: future },
      demo: { status: "active_paid", demo: true, trialEnd: future },
    };
    const pw = crypto.randomBytes(10).toString("hex");
    const pwHash = await bcrypt.hash(pw, 10);
    const userName = (label: string) => `zzgate_${label}_${sfx}`;
    for (const [label, f] of Object.entries(fixtures)) {
      const id = crypto.randomUUID();
      companies[label] = id;
      await pool.query(
        `INSERT INTO companies (id, name, subscription_status, is_demo, trial_end, grace_period_end) VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, `ZZ GATE ${label} ${sfx}`, f.status, f.demo === true, f.trialEnd ?? null, f.graceEnd ?? null],
      );
      await pool.query(`INSERT INTO users (id, username, password, role, company_id, is_active) VALUES ($1, $2, $3, 'admin', $4, true)`, [crypto.randomUUID(), userName(label), pwHash, id]);
    }
    // A tenant user whose company row does not exist (users.company_id has no FK).
    await pool.query(`INSERT INTO users (id, username, password, role, company_id, is_active) VALUES ($1, $2, $3, 'admin', $4, true)`, [crypto.randomUUID(), userName("orphan"), pwHash, `zz-missing-${sfx}`]);
    await pool.query(`INSERT INTO users (id, username, password, role, company_id, is_active) VALUES ($1, $2, $3, 'platform_admin', NULL, true)`, [crypto.randomUUID(), userName("platform"), pwHash]);
    // The suspended tenant's admin also has explicit access to the bystander company.
    const suspendedUserId = (await pool.query(`SELECT id FROM users WHERE username = $1`, [userName("suspended")])).rows[0].id;
    await pool.query(`INSERT INTO company_user_access (user_id, company_id, role, is_active) VALUES ($1, $2, 'admin', true)`, [suspendedUserId, companies.bystander]);

    process.env.DATABASE_URL = testDatabaseUrl;
    const { checkTenantGate } = await import("../server/tenant-enforcement");
    const sub = async (label: string) => (await pool.query(`SELECT subscription_status FROM companies WHERE id = $1`, [companies[label]])).rows[0].subscription_status as string | null;
    const workerCount = async (label: string) => (await pool.query(`SELECT count(*)::int n FROM workers WHERE company_id = $1`, [companies[label]])).rows[0].n as number;
    const S: Record<string, Session> = {};
    for (const label of [...Object.keys(fixtures), "orphan", "platform"]) S[label] = await login(base, userName(label), pw);
    const write = (label: string, body: Record<string, unknown> = { firstName: "Zz", lastName: "Gate" }) => apiRequest(base, "POST", "/api/workers", S[label], body);
    const gateRefusal = (r: { status: number; body: unknown }) => r.status === 403 || r.status === 503 ? ((r.body as any)?.reason ?? "refused") : null;
    const me = async (label: string) => ((await apiRequest(base, "GET", "/api/auth/me", S[label])).body as any)?.tenantGate;

    console.log("\n── 1. checkTenantGate classification ──");
    const expectGate: Record<string, [boolean, string | undefined]> = {
      active: [true, undefined], graceOk: [true, undefined], demo: [true, undefined],
      suspended: [false, "suspended"], canceled: [false, "cancelled"], unknown: [false, "tenant_inactive"], nullst: [false, "tenant_inactive"],
      trialExpired: [false, "trial_expired"], trialLapsed: [false, "trial_expired"], graceExpired: [false, "grace_expired"],
    };
    for (const [label, [allowed, code]] of Object.entries(expectGate)) {
      const g = await checkTenantGate(companies[label]);
      check(`${label} (${fixtures[label].status}) → ${allowed ? "allowed" : `blocked ${code}`}`, g.allowed === allowed && g.code === code, JSON.stringify(g));
    }
    const gMissing = await checkTenantGate(`zz-missing-${sfx}`);
    check("missing company → blocked tenant_inactive", !gMissing.allowed && gMissing.code === "tenant_inactive");
    const gUnknownMe = await me("unknown");
    check("GET /api/auth/me reports the same gate to the client (unknown → tenant_inactive)", gUnknownMe?.allowed === false && gUnknownMe?.code === "tenant_inactive", JSON.stringify(gUnknownMe));

    console.log("\n── 2. requireActiveSubscription on a protected write (POST /api/workers) ──");
    const expectWrite: Record<string, string | null> = {
      active: null, graceOk: null,
      suspended: "tenant_suspended", canceled: "tenant_cancelled", unknown: "tenant_inactive", nullst: "tenant_inactive",
      orphan: "tenant_inactive", trialExpired: "refused", trialLapsed: "refused", graceExpired: "tenant_grace_expired",
    };
    for (const [label, want] of Object.entries(expectWrite)) {
      const r = await write(label);
      const got = gateRefusal(r);
      check(`${label}: ${want ? `write refused (${want})` : "write not refused by the gate"}`, want ? got === want : got === null || !["tenant_inactive", "tenant_suspended", "tenant_cancelled", "tenant_grace_expired", "refused"].includes(got), `status=${r.status} body=${JSON.stringify(r.body)}`);
      if (want && label !== "orphan") check(`${label}: no worker row written`, (await workerCount(label)) === 0);
    }
    check("expired \"grace\" keeps its stored status (no lifecycle write)", (await sub("graceExpired")) === "grace");
    check("lapsed trial is recorded as trial_expired (existing transition)", (await sub("trialLapsed")) === "trial_expired");
    check("unknown / NULL statuses are left as stored", (await sub("unknown")) === "pending_review" && (await sub("nullst")) === null);
    for (const label of ["unknown", "suspended"]) {
      const lo = await apiRequest(base, "GET", "/api/auth/me", S[label]);
      check(`${label}: reads still reachable (GET /api/auth/me 200)`, lo.status === 200, `status=${lo.status}`);
    }

    console.log("\n── 3. Cross-tenant ──");
    const rX = await write("suspended", { firstName: "Zz", lastName: "Cross", companyId: companies.bystander });
    check("suspended tenant's user cannot write by targeting another company it can access", rX.status === 403 && (rX.body as any)?.reason === "tenant_suspended", `status=${rX.status}`);
    check("no worker written in the other company", (await workerCount("bystander")) === 0);
    const rB = await write("bystander");
    check("other tenant's own writes are unaffected", gateRefusal(rB) === null || !(gateRefusal(rB) as string).startsWith("tenant_"), `status=${rB.status} body=${JSON.stringify(rB.body)}`);
    check("other tenant's status untouched", (await sub("bystander")) === "active_paid" && (await checkTenantGate(companies.bystander)).allowed);

    console.log("\n── 4. Database failure while reading eligibility ──");
    await pool.query(`ALTER TABLE companies RENAME COLUMN grace_period_end TO zz_gpe_tmp`);
    columnRenamed = true;
    const gErr = await checkTenantGate(companies.active);
    check("checkTenantGate → blocked gate_unavailable (was allowed: true)", gErr.allowed === false && gErr.code === "gate_unavailable", JSON.stringify(gErr));
    check("gate reason carries no database detail", !LEAK.test(String(gErr.reason)) && gErr.details === undefined);
    const rErr = await write("active");
    check("active tenant write → 503 generic", rErr.status === 503 && (rErr.body as any)?.message === "Unable to verify subscription status. Please try again.", `status=${rErr.status} body=${JSON.stringify(rErr.body)}`);
    check("503 body carries no database detail", !LEAK.test(JSON.stringify(rErr.body)));
    check("no worker row written during the failure", (await workerCount("active")) === 0);
    const meErr = await apiRequest(base, "GET", "/api/auth/me", S.active);
    const tg = (meErr.body as any)?.tenantGate;
    check("GET /api/auth/me → tenantGate blocked gate_unavailable", meErr.status === 200 && tg?.allowed === false && tg?.code === "gate_unavailable", `status=${meErr.status} ${JSON.stringify(tg)}`);
    check("/api/auth/me carries no database detail", !LEAK.test(JSON.stringify(tg)));
    const health = await fetch(`${base}/health`);
    check("public /health still answers", health.status < 500, String(health.status));
    const anon = await apiRequest(base, "POST", "/api/analytics/event", null, { event: "zz_gate_probe" });
    check("anonymous public write is not refused by the tenant gate", ![403, 503].includes(anon.status) || !/subscription|tenant/i.test(JSON.stringify(anon.body)), `status=${anon.status}`);
    const lo = await apiRequest(base, "POST", "/api/auth/logout", S.graceOk);
    check("logout still works (exempt path)", lo.status < 400, `status=${lo.status}`);
    await pool.query(`ALTER TABLE companies RENAME COLUMN zz_gpe_tmp TO grace_period_end`);
    columnRenamed = false;
    check("after recovery the active tenant is allowed again", (await checkTenantGate(companies.active)).allowed === true);

    console.log("\n── 5. Administrative recovery ──");
    const rRe = await apiRequest(base, "PUT", `/api/platform/companies/${companies.suspended}/license`, S.platform, { status: "active", reason: "zz gate test reinstatement" });
    check("platform admin (no company scope) can reinstate the suspended tenant", rRe.status === 200 && (await sub("suspended")) === "active_paid", `status=${rRe.status} body=${JSON.stringify(rRe.body)}`);
    check("reinstated tenant passes the gate", (await checkTenantGate(companies.suspended)).allowed === true);
    const rAfter = await write("suspended");
    check("reinstated tenant's write is no longer refused by the gate", gateRefusal(rAfter) === null || !(gateRefusal(rAfter) as string).startsWith("tenant_"), `status=${rAfter.status} body=${JSON.stringify(rAfter.body)}`);
  } finally {
    if (columnRenamed) await pool.query(`ALTER TABLE companies RENAME COLUMN zz_gpe_tmp TO grace_period_end`).catch((e) => { console.error("COLUMN RESTORE FAILED:", (e as Error).message); failed++; });
    if (server) await server.stop();
    const ids = Object.values(companies);
    try {
      await pool.query(`DELETE FROM authorization_audit_log WHERE company_id = ANY($1::varchar[])`, [ids]);
      await pool.query(`DELETE FROM company_user_access WHERE company_id = ANY($1::varchar[])`, [ids]);
      await pool.query(`DELETE FROM session WHERE sess->>'userId' IN (SELECT id FROM users WHERE username LIKE $1)`, [`zzgate_%_${sfx}`]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE username LIKE $1`, [`zzgate_%_${sfx}`]);
      await cascadeDelete(pool, "companies", ids);
      const residue = await verifyZeroResidue(pool, "companies", ids);
      const strayUsers = (await pool.query(`SELECT count(*)::int n FROM users WHERE username LIKE $1`, [`zzgate_%_${sfx}`])).rows[0].n;
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
