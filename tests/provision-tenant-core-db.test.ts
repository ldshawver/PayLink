/**
 * Tenant-core provisioning — DB integration (server/provisioning/tenant-core.ts).
 *
 * Proves, against the real server (POST /api/trial/signup, POST /api/demo/provision)
 * and the real helpers, that:
 *   A. trial signup and demo provisioning create the same tenant core:
 *      tenants + primary tenant_companies + tenant_licenses + onboarding_progress
 *      + an explicit admin company_user_access grant (no server restart needed);
 *   B. trial signup is atomic — a failure late in the transaction leaves no
 *      company / user / tenant / license / onboarding / grant rows behind,
 *      including while other signups run concurrently;
 *   C. concurrent signups for one email create exactly one account (409 for the
 *      rest) and a sequential retry is a 409 with no new rows;
 *   D. provisionTenantCore is idempotent (no duplicate links/grants/onboarding)
 *      and refuses an admin from another company;
 *   E. licensing behavior is preserved: trial → 'trialing', demo → 'active'
 *      (never blocked), and tenants are isolated from each other.
 *
 * Fault injection is a trigger created in the disposable database only.
 *
 * SAFETY: requires TEST_DATABASE_URL pointing at a disposable database. Refuses
 * staging/production-shaped names/hosts, verifies current_database(), and skips
 * (exit 0, visible message) when TEST_DATABASE_URL is unset.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable npx tsx tests/provision-tenant-core-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import { startTestServer, type TestServer } from "../scripts/cross-tenant-negative-tests/server-harness";

const FORBIDDEN = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.log("SKIP: TEST_DATABASE_URL not set — tenant-core provisioning DB tests not run (this is not a failure).");
    process.exit(0);
  }
  const parsed = new URL(url);
  const dbName = parsed.pathname.replace(/^\//, "");
  for (const p of FORBIDDEN) if (p.test(dbName) || p.test(parsed.hostname)) throw new Error("Refusing to run against a staging/production-shaped database.");
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) throw new Error("TEST_DATABASE_URL equals this process's DATABASE_URL.");

  const pool = new Pool({ connectionString: url, max: 4 });
  const q = (s: string, p: any[] = []) => pool.query(s, p);
  const cur = (await q("SELECT current_database() AS n")).rows[0]?.n;
  if (cur !== dbName || FORBIDDEN.some((p) => p.test(cur))) throw new Error(`current_database()="${cur}" is not the disposable database.`);

  // In-process helpers (D) talk to the same disposable database.
  process.env.DATABASE_URL = url;
  const { db } = await import("../server/db");
  const { provisionTenantCore } = await import("../server/provisioning/tenant-core");
  const { provisionDemoTenant } = await import("../server/demo-seed");

  const sfx = crypto.randomBytes(4).toString("hex");
  const mail = (k: string) => `zzptc-${k}-${sfx}@example.invalid`;
  const createdCompanyIds = new Set<string>();
  let server: TestServer | undefined;
  // POST /api/trial/signup is limited to 10/hour per IP (in-memory, per process)
  // and every test request comes from 127.0.0.1, so each section that signs up
  // runs on a fresh server process instead of touching the limiter.
  async function freshServer() {
    if (server) await server.stop();
    server = await startTestServer(url!);
  }

  async function post(path: string, body: unknown, cookie?: string) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (cookie) headers.cookie = cookie;
    const res = await fetch(`${server!.baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    const setCookie = res.headers.get("set-cookie") ?? "";
    let json: any; try { json = await res.json(); } catch { json = undefined; }
    return { status: res.status, body: json, cookie: setCookie.split(";")[0] };
  }
  async function get(path: string, cookie: string) {
    const res = await fetch(`${server!.baseUrl}${path}`, { headers: { cookie } });
    let json: any; try { json = await res.json(); } catch { json = undefined; }
    return { status: res.status, body: json };
  }
  const signup = (k: string, extra: Record<string, unknown> = {}) => post("/api/trial/signup", {
    companyName: `ZZPTC ${k} ${sfx}`, firstName: "Zz", lastName: k, email: mail(k),
    termsAccepted: true, password: "Synthetic-Pass-1", ...extra,
  });
  async function login(username: string) {
    const r = await post("/api/auth/login", { username, password: "Synthetic-Pass-1" });
    return r.status === 200 ? r.cookie : "";
  }

  /** The tenant-core shape of one company, as counts + key fields. */
  async function core(companyId: string) {
    const admin = (await q(`SELECT id, role FROM users WHERE company_id=$1 AND role='admin' ORDER BY created_at LIMIT 1`, [companyId])).rows[0];
    const links = (await q(`SELECT tenant_id, is_primary FROM tenant_companies WHERE company_id=$1`, [companyId])).rows;
    const tenant = links[0] ? (await q(`SELECT status, primary_admin_user_id FROM tenants WHERE id=$1`, [links[0].tenant_id])).rows[0] : undefined;
    const lic = (await q(`SELECT status, plan_type, source, tenant_id, trial_end FROM tenant_licenses WHERE company_id=$1`, [companyId])).rows;
    const onb = (await q(`SELECT user_id FROM onboarding_progress WHERE company_id=$1`, [companyId])).rows;
    const cua = (await q(`SELECT user_id, company_id, role, is_active, is_default_company, worker_type FROM company_user_access WHERE company_id=$1 AND user_id=$2`, [companyId, admin?.id ?? null])).rows;
    const adminCuaAll = admin ? (await q(`SELECT company_id FROM company_user_access WHERE user_id=$1`, [admin.id])).rows : [];
    return { admin, links, tenant, lic, onb, cua, adminCuaAll };
  }
  function assertCore(label: string, c: Awaited<ReturnType<typeof core>>, licStatus: string, tenantStatus: string) {
    check(`${label}: exactly one primary tenant_companies link`, c.links.length === 1 && c.links[0].is_primary === true, JSON.stringify(c.links));
    check(`${label}: tenant status '${tenantStatus}', primary admin = company admin`, c.tenant?.status === tenantStatus && c.tenant?.primary_admin_user_id === c.admin?.id);
    check(`${label}: one license, status '${licStatus}', linked to the tenant`, c.lic.length === 1 && c.lic[0].status === licStatus && c.lic[0].tenant_id === c.links[0]?.tenant_id, JSON.stringify(c.lic));
    check(`${label}: one onboarding_progress row for the admin`, c.onb.length === 1 && c.onb[0].user_id === c.admin?.id);
    check(`${label}: explicit admin grant on own company (admin/manager, active, default)`,
      c.cua.length === 1 && c.cua[0].role === "admin" && c.cua[0].worker_type === "manager" && c.cua[0].is_active === true && c.cua[0].is_default_company === true, JSON.stringify(c.cua));
    check(`${label}: admin holds no grant on any other company`, c.adminCuaAll.length === 1);
  }
  const companyIdsByName = async (prefix: string) =>
    (await q(`SELECT id FROM companies WHERE name LIKE $1`, [`${prefix}%`])).rows.map((r) => r.id as string);

  try {
    // Fault injection (disposable DB only): fail the LAST statement of any
    // signup whose company is named "ZZFAIL…", after every tenant-core row exists.
    await q(`CREATE OR REPLACE FUNCTION zzptc_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM companies WHERE id = NEW.company_id AND name LIKE 'ZZFAIL%') THEN
          RAISE EXCEPTION 'zzptc injected failure';
        END IF;
        RETURN NEW;
      END $$`);
    await q(`DROP TRIGGER IF EXISTS zzptc_fail ON analytics_events`);
    await q(`CREATE TRIGGER zzptc_fail BEFORE INSERT ON analytics_events FOR EACH ROW EXECUTE FUNCTION zzptc_fail()`);

    await freshServer();

    // ── A. Trial signup ────────────────────────────────────────────────────
    console.log("\nA. trial signup creates the full tenant core");
    const t1 = await signup("t1");
    check("trial signup → 200 with companyId (response shape unchanged)", t1.status === 200 && typeof t1.body?.companyId === "string" && typeof t1.body?.trialEnd === "string", `status=${t1.status}`);
    const T1 = t1.body?.companyId as string; createdCompanyIds.add(T1);
    const c1 = await core(T1);
    assertCore("trial", c1, "trialing", "trial");
    check("trial: license plan 'starter', source 'trial_signup', trial_end set", c1.lic[0]?.plan_type === "starter" && c1.lic[0]?.source === "trial_signup" && !!c1.lic[0]?.trial_end);
    check("trial: one trial_signups row", Number((await q(`SELECT count(*) FROM trial_signups WHERE email=$1`, [mail("t1")])).rows[0].count) === 1);

    // ── A. Demo provisioning ──────────────────────────────────────────────
    console.log("\nA. demo provisioning creates the same tenant core");
    const d1 = await post("/api/demo/provision", {});
    check("demo provision → 200 (response shape unchanged)", d1.status === 200 && d1.body?.isDemo === true && typeof d1.body?.user?.id === "string", `status=${d1.status}`);
    const D1 = d1.body?.companyId as string; createdCompanyIds.add(D1);
    const cd = await core(D1);
    assertCore("demo", cd, "active", "demo");
    check("demo: license plan 'professional', source 'demo_provision', no own trial window", cd.lic[0]?.plan_type === "professional" && cd.lic[0]?.source === "demo_provision" && cd.lic[0]?.trial_end === null);
    const sharedDemo = (await q(`SELECT id FROM tenants WHERE slug='demo-tenant'`)).rows[0]?.id;
    check("demo: own tenant, not the shared seeded 'demo-tenant'", !!cd.links[0] && cd.links[0].tenant_id !== sharedDemo);
    const d2 = await post("/api/demo/provision", {});
    const D2 = d2.body?.companyId as string; createdCompanyIds.add(D2);
    const cd2 = await core(D2);
    check("two demos get two distinct tenants", d2.status === 200 && cd2.links[0]?.tenant_id && cd2.links[0].tenant_id !== cd.links[0]?.tenant_id);

    // ── E. Licensing preserved + isolation over HTTP ──────────────────────
    console.log("\nE. licensing behavior + tenant isolation");
    const demoMe = await get("/api/auth/me", d1.cookie);
    check("demo admin /api/auth/me: license 'active' (as the legacy is_demo gate resolved)", demoMe.status === 200 && demoMe.body?.license?.status === "active", JSON.stringify(demoMe.body?.license));
    await q(`UPDATE users SET email_verified_at = NOW() WHERE id = $1`, [c1.admin.id]);
    const t1Username = (await q(`SELECT username FROM users WHERE id=$1`, [c1.admin.id])).rows[0].username;
    const t1Cookie = await login(t1Username);
    check("trial admin can log in once verified", !!t1Cookie);
    const trialMe = await get("/api/auth/me", t1Cookie);
    check("trial admin /api/auth/me: license 'trialing'", trialMe.body?.license?.status === "trialing", JSON.stringify(trialMe.body?.license));
    check("trial admin → own company 200", (await get(`/api/companies/${T1}`, t1Cookie)).status === 200);
    const tx1 = await get(`/api/companies/${D1}`, t1Cookie);
    check("trial admin → demo company denied", tx1.status === 403 || tx1.status === 404, `status=${tx1.status}`);
    const dx1 = await get(`/api/companies/${T1}`, d1.cookie);
    check("demo admin → trial company denied", dx1.status === 403 || dx1.status === 404, `status=${dx1.status}`);
    const dx2 = await get(`/api/companies/${D2}`, d1.cookie);
    check("demo admin → other demo company denied", dx2.status === 403 || dx2.status === 404, `status=${dx2.status}`);
    const wl = await get(`/api/workers?companyId=${D1}`, t1Cookie);
    check("trial admin → ?companyId=<demo> denied", wl.status === 403, `status=${wl.status}`);

    // ── B. Atomic rollback ────────────────────────────────────────────────
    console.log("\nB. a failed signup rolls back completely");
    const f1 = await signup("f1", { companyName: `ZZFAIL f1 ${sfx}` });
    check("injected failure → 500", f1.status === 500, `status=${f1.status}`);
    const failIds = await companyIdsByName(`ZZFAIL f1 ${sfx}`);
    const orphanCounts = async (email: string, slugLike: string) => ({
      companies: failIds.length,
      users: Number((await q(`SELECT count(*) FROM users WHERE email=$1`, [email])).rows[0].count),
      trial: Number((await q(`SELECT count(*) FROM trial_signups WHERE email=$1`, [email])).rows[0].count),
      tenants: Number((await q(`SELECT count(*) FROM tenants WHERE billing_contact_email=$1 OR slug LIKE $2`, [email, slugLike])).rows[0].count),
    });
    const oc = await orphanCounts(mail("f1"), `zzfail-f1-${sfx}%`);
    check("no company/user/trial_signup/tenant rows remain", oc.companies === 0 && oc.users === 0 && oc.trial === 0 && oc.tenants === 0, JSON.stringify(oc));
    const after = await signup("f1");
    check("same email can sign up after the failed attempt (nothing half-created)", after.status === 200, `status=${after.status}`);
    if (after.body?.companyId) createdCompanyIds.add(after.body.companyId);

    // ── B. Concurrency: failures interleaved with successes ───────────────
    console.log("\nB. concurrent signups: failures never leak, successes complete");
    await freshServer();
    const keys = Array.from({ length: 4 }, (_, i) => i);
    const results = await Promise.all([
      ...keys.map((i) => signup(`ok${i}`)),
      ...keys.map((i) => signup(`bad${i}`, { companyName: `ZZFAIL bad${i} ${sfx}` })),
    ]);
    const okRes = results.slice(0, 4), badRes = results.slice(4);
    check("4 concurrent good signups → 200", okRes.every((r) => r.status === 200), okRes.map((r) => r.status).join(","));
    check("4 concurrent failing signups → 500", badRes.every((r) => r.status === 500), badRes.map((r) => r.status).join(","));
    check("no rows from any failed concurrent signup", (await companyIdsByName(`ZZFAIL bad`)).length === 0
      && Number((await q(`SELECT count(*) FROM users WHERE email LIKE $1`, [`zzptc-bad%-${sfx}@%`])).rows[0].count) === 0
      && Number((await q(`SELECT count(*) FROM tenants WHERE billing_contact_email LIKE $1`, [`zzptc-bad%-${sfx}@%`])).rows[0].count) === 0);
    const okTenants = new Set<string>();
    let okComplete = true;
    for (const r of okRes) {
      const cid = r.body?.companyId as string; createdCompanyIds.add(cid);
      const c = await core(cid);
      okComplete &&= c.links.length === 1 && c.lic.length === 1 && c.onb.length === 1 && c.cua.length === 1 && c.adminCuaAll.length === 1;
      if (c.links[0]) okTenants.add(c.links[0].tenant_id);
    }
    check("each concurrent success has a complete, separate tenant core", okComplete && okTenants.size === 4);

    // ── C. Duplicate requests ─────────────────────────────────────────────
    console.log("\nC. duplicate / retried signups");
    await freshServer();
    const same = await Promise.all(Array.from({ length: 5 }, () => signup("dup")));
    const codes = same.map((r) => r.status).sort();
    check("5 concurrent signups, same email → exactly one 200, rest 409", codes.filter((c) => c === 200).length === 1 && codes.filter((c) => c === 409).length === 4, codes.join(","));
    const dupCounts = async () => ({
      users: Number((await q(`SELECT count(*) FROM users WHERE email=$1`, [mail("dup")])).rows[0].count),
      trial: Number((await q(`SELECT count(*) FROM trial_signups WHERE email=$1`, [mail("dup")])).rows[0].count),
      tenants: Number((await q(`SELECT count(*) FROM tenants WHERE billing_contact_email=$1`, [mail("dup")])).rows[0].count),
      companies: (await companyIdsByName(`ZZPTC dup ${sfx}`)).length,
    });
    const dc = await dupCounts();
    check("exactly one user / trial_signup / tenant / company for that email", dc.users === 1 && dc.trial === 1 && dc.tenants === 1 && dc.companies === 1, JSON.stringify(dc));
    for (const id of await companyIdsByName(`ZZPTC dup ${sfx}`)) createdCompanyIds.add(id);
    const retry = await signup("dup");
    check("sequential retry → 409 (existing message)", retry.status === 409 && /already exists/.test(retry.body?.message ?? ""), `status=${retry.status}`);
    check("retry created nothing", JSON.stringify(await dupCounts()) === JSON.stringify(dc));

    // ── D. Helper idempotency + guard (in-process, own transactions) ──────
    console.log("\nD. provisionTenantCore idempotency + cross-company guard");
    const again = await db.transaction((tx) => provisionTenantCore(tx, T1, c1.admin.id, {
      tenant: { name: "ignored", slug: `zzptc-again-${sfx}`, status: "trial" },
      license: { status: "trialing", planType: "starter", source: "trial_signup", reason: "trial signup" },
    }));
    const c1b = await core(T1);
    check("re-running on a provisioned company creates nothing", !again.tenantCreated && !again.licenseCreated && !again.onboardingCreated && !again.accessGrantCreated, JSON.stringify(again));
    check("…and reuses the existing tenant (no duplicate link/grant/onboarding)", again.tenantId === c1.links[0].tenant_id && c1b.links.length === 1 && c1b.cua.length === 1 && c1b.onb.length === 1);
    let crossErr = "";
    try {
      await db.transaction((tx) => provisionTenantCore(tx, D1, c1.admin.id, {
        tenant: { name: "x", slug: `zzptc-cross-${sfx}`, status: "demo" },
        license: { status: "active", planType: "professional", source: "demo_provision", reason: "demo provision" },
      }));
    } catch (e) { crossErr = e instanceof Error ? e.message : String(e); }
    check("admin of company A cannot be granted company B (throws, rolled back)", /does not belong/.test(crossErr)
      && Number((await q(`SELECT count(*) FROM company_user_access WHERE user_id=$1 AND company_id=$2`, [c1.admin.id, D1])).rows[0].count) === 0);
    const helperRace = await Promise.allSettled(Array.from({ length: 4 }, () => db.transaction((tx) => provisionTenantCore(tx, T1, c1.admin.id, {
      tenant: { name: "race", slug: `zzptc-race-${crypto.randomBytes(3).toString("hex")}`, status: "trial" },
      license: { status: "trialing", planType: "starter", source: "trial_signup", reason: "trial signup" },
    }))));
    const c1c = await core(T1);
    check("4 concurrent re-provisions of one company → no duplicates", helperRace.every((r) => r.status === "fulfilled") && c1c.links.length === 1 && c1c.onb.length === 1 && c1c.cua.length === 1 && c1c.lic.length === 1);

    // ── B. Demo provisioning rollback (in-process) ────────────────────────
    console.log("\nB. a failed demo provision rolls back completely");
    const dsfx = crypto.randomBytes(4).toString("hex");
    let demoErr = "";
    try {
      await db.transaction(async (tx) => {
        await provisionDemoTenant(tx, { suffix: dsfx, companyName: `ZZPTC demo-rollback ${sfx}` });
        throw new Error("zzptc injected demo failure");
      });
    } catch (e) { demoErr = e instanceof Error ? e.message : String(e); }
    const demoLeft = {
      companies: (await companyIdsByName(`ZZPTC demo-rollback ${sfx}`)).length,
      users: Number((await q(`SELECT count(*) FROM users WHERE username LIKE $1`, [`demo%${dsfx}`])).rows[0].count),
      tenants: Number((await q(`SELECT count(*) FROM tenants WHERE slug=$1`, [`demo-${dsfx}`])).rows[0].count),
    };
    check("failed demo provision leaves no company/user/tenant rows", /injected demo failure/.test(demoErr) && demoLeft.companies === 0 && demoLeft.users === 0 && demoLeft.tenants === 0, JSON.stringify(demoLeft));
  } finally {
    if (server) await server.stop().catch(() => {});
    await q(`DROP TRIGGER IF EXISTS zzptc_fail ON analytics_events`).catch(() => {});
    await q(`DROP FUNCTION IF EXISTS zzptc_fail()`).catch(() => {});
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
