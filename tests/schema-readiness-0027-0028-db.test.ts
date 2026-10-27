/**
 * Migrations 0027 + 0028 (production schema readiness) — real psql, real
 * server, disposable database.
 *
 * Two starting states, detected automatically:
 *   - PRODUCTION-SHAPED (tables absent, e.g. a schema-only restore of a
 *     production backup): reproduces the failures first — Stripe reactivation
 *     refused as "unverifiable", provisioning events 500 — then applies both
 *     migrations and proves the paths work.
 *   - DRIZZLE-PUSHED (tables present): applying both files must be a no-op
 *     whose shape checks pass, which proves the hand-written DDL equals
 *     `drizzle-kit push` of shared/schema.ts.
 * Either way: rerun is a no-op (one ledger row per version), tenant
 * provisioning writes audit rows, admin suspension is audited, a billing
 * suspension is lifted by payment again, other tenants are untouched.
 *
 * The connection must act as the app table owner (the migrations refuse any
 * other role); add `options=-c role=<owner>` to the URL when needed.
 *
 * SAFETY: refuses staging/production-shaped names, verifies
 * current_database(), never prints a URL, deletes every fixture.
 *
 * Run: TEST_DATABASE_URL=postgresql://user@host/disposable npx tsx tests/schema-readiness-0027-0028-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { execFileSync } from "node:child_process";
import { startTestServer, login, type TestServer, type Session } from "../scripts/cross-tenant-negative-tests/server-harness";
import { cascadeDelete, verifyZeroResidue } from "../scripts/cross-tenant-negative-tests/cascade-cleanup";

const FORBIDDEN = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];
const TABLES = ["tenant_provisioning_audit_logs", "tenant_commercial_gates", "tenant_implementation_projects"];
let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) { console.log(`  ✓  ${name}`); passed++; }
  else { console.error(`  ✗  ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
};

function applyMigration(url: string, file: string): { ok: boolean; out: string } {
  try {
    const out = execFileSync("psql", [url, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, out };
  } catch (e: any) {
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) { console.log("TEST_DATABASE_URL not set — skipping schema-readiness 0027/0028 DB tests (0 run)."); return; }
  const parsed = new URL(url);
  const dbName = parsed.pathname.slice(1);
  if (FORBIDDEN.some((p) => p.test(dbName) || p.test(parsed.hostname))) throw new Error("TEST_DATABASE_URL looks like staging/production. Refusing.");
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) throw new Error("TEST_DATABASE_URL equals DATABASE_URL. Refusing.");
  for (const k of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_PASSWORD"]) delete process.env[k];

  const pool = new Pool({ connectionString: url, max: 6 });
  if ((await pool.query("SELECT current_database() d")).rows[0].d !== dbName) throw new Error("current_database() mismatch. Refusing.");
  const present = async (t: string) => (await pool.query(`SELECT to_regclass($1) IS NOT NULL AS p`, [`public.${t}`])).rows[0].p as boolean;
  const ledger = async () => (await pool.query(`SELECT to_regclass('paylink_migrations.applied') IS NOT NULL AS p`)).rows[0].p
    ? (await pool.query(`SELECT version FROM paylink_migrations.applied ORDER BY version`)).rows.map((r: any) => r.version).join(",") : "";
  const objectCount = async () => Number((await pool.query(`SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'`)).rows[0].count);

  const sfx = crypto.randomBytes(4).toString("hex");
  const companyIds: string[] = [], tenantIds: string[] = [];
  let server: TestServer | undefined;
  const pw = crypto.randomBytes(10).toString("hex");

  try {
    // Boot first: the server's startup DDL adds columns (e.g. companies.stripe_customer_id)
    // that a freshly pushed database does not have yet.
    server = await startTestServer(url);
    const base = server.baseUrl;
    const hash = await bcrypt.hash(pw, 10);
    const mk = async (label: string, sub: string) => {
      const c = crypto.randomUUID();
      await pool.query(`INSERT INTO companies (id, name, subscription_status, is_demo, stripe_customer_id) VALUES ($1,$2,$3,false,$4)`,
        [c, `ZZ SR27 ${label} ${sfx}`, sub, `cus_sr27_${label}_${sfx}`]);
      const t = (await pool.query(`INSERT INTO tenants (name, slug, status) VALUES ($1,$1,'active') RETURNING id`, [`zz-sr27-${label}-${sfx}`])).rows[0].id;
      await pool.query(`INSERT INTO tenant_companies (tenant_id, company_id, is_primary) VALUES ($1,$2,true)`, [t, c]);
      companyIds.push(c); tenantIds.push(t);
      return { c, t, cus: `cus_sr27_${label}_${sfx}` };
    };
    const ids: Record<string, string> = {};
    const bystander = await mk("bystander", "active_paid");
    for (const [role, co] of [["platform_admin", null], ["company_admin", bystander.c]] as const) {
      ids[role] = crypto.randomUUID();
      await pool.query(`INSERT INTO users (id, username, password, role, company_id, is_active) VALUES ($1,$2,$3,$4,$5,true)`, [ids[role], `zzsr27_${role}_${sfx}`, hash, role, co]);
    }
    const sub = async (c: string) => (await pool.query(`SELECT subscription_status FROM companies WHERE id=$1`, [c])).rows[0].subscription_status as string;

    process.env.DATABASE_URL = url;
    const { handleTenantBillingEvent, getSuspensionSource } = await import("../server/billingLifecycle");
    const { db } = await import("../server/db");
    const source = (c: string) => getSuspensionSource(db as any, c);
    const S: Record<string, Session> = {}, csrf: Record<string, string> = {};
    for (const r of Object.keys(ids)) {
      S[r] = await login(base, `zzsr27_${r}_${sfx}`, pw);
      const res = await fetch(`${base}/api/auth/me`, { headers: { cookie: S[r].cookie } });
      csrf[r] = (res.headers.get("set-cookie") || "").match(/csrf_token=([0-9a-f]+)/)?.[1] || "";
    }
    const call = async (role: string, method: string, path: string, body?: unknown) => {
      const headers: Record<string, string> = { cookie: `${S[role].cookie}; csrf_token=${csrf[role]}`, "x-csrf-token": csrf[role], "content-type": "application/json" };
      const r = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      let j: any; try { j = await r.json(); } catch { j = undefined; }
      return { status: r.status, body: j };
    };
    const prov = (role: string, companyId: string, event: string, payload?: object) => call(role, "POST", "/api/provisioning/event", { companyId, event, payload });

    const startedAbsent = !(await present(TABLES[0]));
    console.log(`\nstarting state: ${startedAbsent ? "PRODUCTION-SHAPED (tables absent)" : "DRIZZLE-PUSHED (tables present)"}`);

    if (startedAbsent) {
      console.log("\n── 1. Reproduce the missing-table condition ──");
      check("all three tables absent", !(await present(TABLES[0])) && !(await present(TABLES[1])) && !(await present(TABLES[2])));
      const pb = await mk("preBilling", "active_paid");
      await handleTenantBillingEvent("customer.subscription.deleted", { customer: pb.cus });
      await handleTenantBillingEvent("invoice.payment_succeeded", { customer: pb.cus });
      check("billing suspension + payment → refused as unverifiable (still suspended)", (await source(pb.c)) === "unverifiable" && (await sub(pb.c)) === "suspended");
      const pa = await mk("preAdmin", "active_paid");
      const r1 = await prov("platform_admin", pa.c, "tenant.suspended", { reason: "pre" });
      const r2 = await call("platform_admin", "GET", `/api/provisioning/tenants/${pa.c}`);
      check("tenant.suspended → 500 and nothing written; provisioning status read → 500", r1.status === 500 && (await sub(pa.c)) === "active_paid" && r2.status === 500, `${r1.status} ${r2.status}`);
    }

    console.log("\n── 2. Apply 0027 + 0028 ──");
    const before = await objectCount();
    const out28first = startedAbsent ? applyMigration(url, "migrations/0028_tenant_provisioning_gates_and_projects.sql") : null;
    if (out28first) check("0028 before 0027 → fails clearly ('apply 0027 first'), nothing created", !out28first.ok && /apply 0027 first/.test(out28first.out) && (await objectCount()) === before && !(await present(TABLES[1])), out28first.out);
    const a27 = applyMigration(url, "migrations/0027_tenant_provisioning_audit_logs.sql");
    const a28 = applyMigration(url, "migrations/0028_tenant_provisioning_gates_and_projects.sql");
    check("0027 applied (shape check passed)", a27.ok, a27.out);
    check("0028 applied (enum + shape + constraint checks passed)", a28.ok, a28.out);
    check("all three tables present; ledger 0027,0028", (await present(TABLES[0])) && (await present(TABLES[1])) && (await present(TABLES[2])) && (await ledger()) === "0027,0028", await ledger());
    const after = await objectCount();
    // New public relations when created: 3 tables + 3 pkey indexes. Pushed DB: none.
    check(`public relation count ${startedAbsent ? "+6 (3 tables, 3 pkeys)" : "unchanged"}`, after - before === (startedAbsent ? 6 : 0), `${before}→${after}`);
    const b27 = applyMigration(url, "migrations/0027_tenant_provisioning_audit_logs.sql");
    const b28 = applyMigration(url, "migrations/0028_tenant_provisioning_gates_and_projects.sql");
    check("rerun of both is a no-op (succeeds, no new objects, one ledger row each)", b27.ok && b28.ok && (await objectCount()) === after && (await ledger()) === "0027,0028", `${b27.out}${b28.out}`);

    console.log("\n── 3. Tenant provisioning + audit-log insertion ──");
    const p = await mk("provision", "active_paid");
    const e1 = await prov("platform_admin", p.c, "tenant.provisioning.requested");
    const e2 = await prov("platform_admin", p.c, "agreement.signed");
    const st = await call("platform_admin", "GET", `/api/provisioning/tenants/${p.c}`);
    const logs = (await pool.query(`SELECT event_type, status FROM tenant_provisioning_audit_logs WHERE company_id=$1`, [p.c])).rows;
    const gate = (await pool.query(`SELECT agreement_status FROM tenant_commercial_gates WHERE company_id=$1`, [p.c])).rows[0];
    check("provisioning.requested + agreement.signed → 200", e1.status === 200 && e2.status === 200, `${e1.status} ${JSON.stringify(e1.body)} ${e2.status} ${JSON.stringify(e2.body)}`);
    check("gate row created; agreement_status signed", gate?.agreement_status === "signed", JSON.stringify(gate));
    check("provisioning audit rows written for this company", logs.length >= 1 && logs.some((l: any) => l.event_type === "agreement.signed"), JSON.stringify(logs));
    check("GET /api/provisioning/tenants/:companyId → 200", st.status === 200, String(st.status));
    const s1 = await prov("platform_admin", p.c, "tenant.suspended", { reason: "rehearsal" });
    const aud = (await pool.query(`SELECT change_type FROM authorization_audit_log WHERE company_id=$1 AND change_type='admin_suspension'`, [p.c])).rows.length;
    const plog = (await pool.query(`SELECT count(*)::int n FROM tenant_provisioning_audit_logs WHERE company_id=$1 AND event_type='tenant.suspended'`, [p.c])).rows[0].n;
    check("admin suspension → 200, suspended, authorization + provisioning audit rows", s1.status === 200 && (await sub(p.c)) === "suspended" && aud === 1 && plog === 1, `${s1.status} ${aud} ${plog}`);
    await handleTenantBillingEvent("invoice.payment_succeeded", { customer: p.cus });
    check("…payment does not lift it (source admin)", (await sub(p.c)) === "suspended" && (await source(p.c)) === "admin");
    const b = await mk("billing", "active_paid");
    await handleTenantBillingEvent("customer.subscription.deleted", { customer: b.cus });
    const bSrc = await source(b.c);
    await handleTenantBillingEvent("invoice.payment_succeeded", { customer: b.cus });
    check("billing suspension is verifiable again (billing) and lifted by payment", bSrc === "billing" && (await sub(b.c)) === "active_paid", bSrc);

    console.log("\n── 4. Tenant isolation ──");
    const i1 = await call("company_admin", "GET", "/api/provisioning/tenants");
    const i2 = await call("company_admin", "GET", `/api/provisioning/tenants/${p.c}`);
    const i3 = await prov("company_admin", p.c, "agreement.signed");
    check("tenant company_admin: provisioning list / other tenant detail / event → 403", i1.status === 403 && i2.status === 403 && i3.status === 403, `${i1.status} ${i2.status} ${i3.status}`);
    const by = (await pool.query(`SELECT (SELECT count(*) FROM tenant_provisioning_audit_logs WHERE company_id=$1)::int l, (SELECT count(*) FROM tenant_commercial_gates WHERE company_id=$1)::int g`, [bystander.c])).rows[0];
    check("bystander: active_paid, no provisioning rows, no gate", (await sub(bystander.c)) === "active_paid" && by.l === 0 && by.g === 0, JSON.stringify(by));
  } finally {
    if (server) await server.stop();
    await pool.query(`DELETE FROM authorization_audit_log WHERE company_id = ANY($1::varchar[]) OR tenant_id = ANY($2::varchar[])`, [companyIds, tenantIds]);
    await pool.query(`DELETE FROM tenant_provisioning_audit_logs WHERE company_id = ANY($1::varchar[])`, [companyIds]).catch(() => {});
    await pool.query(`DELETE FROM integration_events WHERE company_id = ANY($1::varchar[])`, [companyIds]).catch(() => {});
    await pool.query(`DELETE FROM session WHERE sess->>'userId' IN (SELECT id FROM users WHERE username LIKE $1)`, [`zzsr27_%_${sfx}`]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE username LIKE $1`, [`zzsr27_%_${sfx}`]);
    await pool.query(`DELETE FROM tenant_companies WHERE tenant_id = ANY($1::varchar[])`, [tenantIds]);
    await pool.query(`DELETE FROM tenants WHERE id = ANY($1::varchar[])`, [tenantIds]);
    await cascadeDelete(pool, "companies", companyIds);
    const residue = await verifyZeroResidue(pool, "companies", companyIds);
    const strayP = await pool.query(`SELECT count(*)::int n FROM tenant_provisioning_audit_logs WHERE company_id = ANY($1::varchar[])`, [companyIds]).then((r) => r.rows[0].n).catch(() => 0);
    if (residue.length || strayP) { console.error(`CLEANUP RESIDUE: ${residue.join("; ")} provisioning_logs=${strayP}`); failed++; }
    else console.log("cleanup: zero residue confirmed");
    await pool.end();
    try { const { db } = await import("../server/db"); await (db as any).$client.end(); } catch { /* not loaded */ }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
