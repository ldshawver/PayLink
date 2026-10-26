/**
 * Admin vs billing suspension source — real server, real HTTP, disposable
 * database: POST /api/provisioning/event tenant.suspended is CSRF-protected,
 * authorization-checked and audited (admin_suspension); a Stripe payment /
 * subscription.updated active never lifts an admin suspension (including one
 * that re-labels an earlier billing suspension, and legacy provisioning
 * suspensions written before this change); billing suspensions are still
 * lifted; an explicit platform_admin unsuspend works and is audited.
 *
 * SAFETY: TEST_DATABASE_URL must point at a disposable database. Refuses
 * staging/production-shaped names/hosts, verifies current_database(), never
 * prints a URL, deletes every fixture and verifies zero residue.
 *
 * Run: TEST_DATABASE_URL=postgresql://user@host/disposable npx tsx tests/admin-suspension-source-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { startTestServer, login, apiRequest, type TestServer, type Session } from "../scripts/cross-tenant-negative-tests/server-harness";
import { cascadeDelete, verifyZeroResidue } from "../scripts/cross-tenant-negative-tests/cascade-cleanup";

const FORBIDDEN = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];
let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) { console.log(`  ✓  ${name}`); passed++; }
  else { console.error(`  ✗  ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
};

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) { console.log("TEST_DATABASE_URL not set — skipping admin-suspension-source DB tests (0 run)."); return; }
  const parsed = new URL(url);
  const dbName = parsed.pathname.slice(1);
  if (FORBIDDEN.some((p) => p.test(dbName) || p.test(parsed.hostname))) throw new Error("TEST_DATABASE_URL looks like staging/production. Refusing.");
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) throw new Error("TEST_DATABASE_URL equals DATABASE_URL. Refusing.");
  for (const k of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_PASSWORD"]) delete process.env[k];

  const pool = new Pool({ connectionString: url, max: 6 });
  if ((await pool.query("SELECT current_database() d")).rows[0].d !== dbName) throw new Error("current_database() mismatch. Refusing.");
  const sfx = crypto.randomBytes(4).toString("hex");
  const companyIds: string[] = [], tenantIds: string[] = [];
  let server: TestServer | undefined;
  const pw = crypto.randomBytes(10).toString("hex");

  try {
    const hash = await bcrypt.hash(pw, 10);
    const mk = async (label: string, sub: string) => {
      const c = crypto.randomUUID();
      await pool.query(`INSERT INTO companies (id, name, subscription_status, is_demo, stripe_customer_id) VALUES ($1,$2,$3,false,$4)`,
        [c, `ZZ ASUS ${label} ${sfx}`, sub, `cus_asus_${label}_${sfx}`]);
      const t = (await pool.query(`INSERT INTO tenants (name, slug, status) VALUES ($1,$1,'active') RETURNING id`, [`zz-asus-${label}-${sfx}`])).rows[0].id;
      await pool.query(`INSERT INTO tenant_companies (tenant_id, company_id, is_primary) VALUES ($1,$2,true)`, [t, c]);
      companyIds.push(c); tenantIds.push(t);
      return { c, t, cus: `cus_asus_${label}_${sfx}` };
    };
    const ids: Record<string, string> = {};
    for (const role of ["platform_super_admin", "platform_admin", "platform_auditor"]) {
      ids[role] = crypto.randomUUID();
      await pool.query(`INSERT INTO users (id, username, password, role, company_id, is_active) VALUES ($1,$2,$3,$4,NULL,true)`, [ids[role], `zzasus_${role}_${sfx}`, hash, role]);
    }
    const sub = async (c: string) => (await pool.query(`SELECT subscription_status FROM companies WHERE id=$1`, [c])).rows[0].subscription_status as string;
    const tstat = async (t: string) => (await pool.query(`SELECT status FROM tenants WHERE id=$1`, [t])).rows[0].status as string;
    const audits = async (c: string) => (await pool.query(`SELECT actor_user_id, target_resource, change_type, before_value, after_value, note, tenant_id, created_at FROM authorization_audit_log WHERE company_id=$1 ORDER BY created_at, change_type`, [c])).rows;
    const types = async (c: string) => (await audits(c)).map((a: any) => a.change_type).join(",");

    process.env.DATABASE_URL = url;
    const { handleTenantBillingEvent, getSuspensionSource } = await import("../server/billingLifecycle");
    const { checkTenantGate } = await import("../server/tenant-enforcement");
    const { db } = await import("../server/db");
    const source = (c: string) => getSuspensionSource(db as any, c);
    server = await startTestServer(url);
    const base = server.baseUrl;
    const S: Record<string, Session> = {};
    const csrf: Record<string, string> = {};
    for (const r of Object.keys(ids)) {
      S[r] = await login(base, `zzasus_${r}_${sfx}`, pw);
      const res = await fetch(`${base}/api/auth/me`, { headers: { cookie: S[r].cookie } });
      csrf[r] = (res.headers.get("set-cookie") || "").match(/csrf_token=([0-9a-f]+)/)?.[1] || "";
    }
    const provEvent = async (role: string, companyId: string, event: string, payload?: Record<string, unknown>, opts: { csrf?: string | null } = {}) => {
      const token = opts.csrf === undefined ? csrf[role] : opts.csrf;
      const headers: Record<string, string> = { cookie: `${S[role].cookie}${token ? `; csrf_token=${token}` : ""}`, "content-type": "application/json" };
      if (token) headers["x-csrf-token"] = token;
      const r = await fetch(`${base}/api/provisioning/event`, { method: "POST", headers, body: JSON.stringify({ companyId, event, payload }) });
      let body: any; try { body = await r.json(); } catch { body = undefined; }
      return { status: r.status, body };
    };
    const patchTenant = async (role: string, tenantId: string, body: Record<string, unknown>) => {
      const r = await fetch(`${base}/api/tenants/${tenantId}`, {
        method: "PATCH",
        headers: { cookie: `${S[role].cookie}; csrf_token=${csrf[role]}`, "x-csrf-token": csrf[role], "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: r.status };
    };
    const pay = async (cus: string) => {
      await handleTenantBillingEvent("invoice.payment_succeeded", { customer: cus });
      await handleTenantBillingEvent("invoice.paid", { customer: cus });
      await handleTenantBillingEvent("customer.subscription.updated", { customer: cus, status: "active" });
    };

    const bystander = await mk("bystander", "active_paid");

    console.log("\n── 1. CSRF + authorization on POST /api/provisioning/event ──");
    const cs = await mk("csrf", "active_paid");
    const n1 = await provEvent("platform_admin", cs.c, "tenant.suspended", { reason: "x" }, { csrf: null });
    const n2 = await provEvent("platform_admin", cs.c, "tenant.suspended", { reason: "x" }, { csrf: "0".repeat(csrf.platform_admin.length || 64) });
    check("missing CSRF token → 403, company untouched, no audit", n1.status === 403 && /CSRF/i.test(n1.body?.message ?? "") && (await sub(cs.c)) === "active_paid" && (await audits(cs.c)).length === 0, `${n1.status} ${JSON.stringify(n1.body)}`);
    check("wrong CSRF token → 403, untouched", n2.status === 403 && (await sub(cs.c)) === "active_paid");
    const n3 = await provEvent("platform_auditor", cs.c, "tenant.suspended", { reason: "x" });
    check("platform_auditor (valid CSRF) → 403, untouched", n3.status === 403 && (await sub(cs.c)) === "active_paid" && (await audits(cs.c)).length === 0, String(n3.status));
    const n4 = await provEvent("platform_admin", cs.c, "agreement.signed");
    check("other provisioning events still work with a CSRF token (200)", n4.status === 200 && n4.body?.success === true, `${n4.status} ${JSON.stringify(n4.body)}`);

    console.log("\n── 2. Admin suspension: audited, not lifted by payment ──");
    const a = await mk("admin", "active_paid");
    const s1 = await provEvent("platform_admin", a.c, "tenant.suspended", { reason: "chargeback fraud" });
    const aRows = await audits(a.c);
    const row = aRows[0] ?? {};
    check("platform_admin suspend → 200, suspended, mirror suspended, gate blocks", s1.status === 200 && s1.body?.success === true && (await sub(a.c)) === "suspended" && (await tstat(a.t)) === "suspended" && !(await checkTenantGate(a.c)).allowed, `${s1.status} ${JSON.stringify(s1.body)}`);
    check("audit row: who/source/reason/previous/new/tenant/when",
      aRows.length === 1 && row.actor_user_id === ids.platform_admin && row.change_type === "admin_suspension" && row.target_resource === "companies.subscription_status"
      && row.before_value === "active_paid" && row.after_value === "suspended" && /^source=admin; via=provisioning; role=platform_admin; reason=chargeback fraud$/.test(row.note) && row.tenant_id === a.t && row.created_at instanceof Date,
      JSON.stringify(aRows));
    const gate = (await pool.query(`SELECT lifecycle_state FROM tenant_commercial_gates WHERE company_id=$1`, [a.c])).rows[0]?.lifecycle_state;
    check("provisioning gate lifecycle_state = suspended", gate === "suspended", String(gate));
    check("classified as admin", (await source(a.c)) === "admin");
    await pay(a.cus);
    check("payment_succeeded / invoice.paid / subscription.updated active → still suspended, gate blocks", (await sub(a.c)) === "suspended" && !(await checkTenantGate(a.c)).allowed);
    check("…each Stripe reactivation attempt audited as lifecycle_reactivation_refused (invoice.paid is not a tenant lifecycle event)", (await types(a.c)) === "admin_suspension,lifecycle_reactivation_refused,lifecycle_reactivation_refused", await types(a.c));
    await handleTenantBillingEvent("customer.subscription.deleted", { customer: a.cus });
    await pay(a.cus);
    check("subscription.deleted on an admin-suspended tenant is a no-op; a later payment still does not lift it", (await sub(a.c)) === "suspended" && (await source(a.c)) === "admin");

    console.log("\n── 3. Billing suspension re-labelled by an admin suspension ──");
    const rl = await mk("relabel", "active_paid");
    await handleTenantBillingEvent("customer.subscription.deleted", { customer: rl.cus });
    const rlMid = await source(rl.c);
    const s3 = await provEvent("platform_admin", rl.c, "tenant.suspended", { reason: "abuse while unpaid" });
    const rlRow = (await audits(rl.c)).find((x: any) => x.change_type === "admin_suspension");
    check("billing-suspended → admin suspend: 200, no status change, admin_suspension row suspended → suspended", rlMid === "billing" && s3.status === 200 && rlRow?.before_value === "suspended" && rlRow?.after_value === "suspended" && (await source(rl.c)) === "admin", `${rlMid} ${s3.status} ${JSON.stringify(rlRow)}`);
    await pay(rl.cus);
    check("…a payment then does NOT lift it", (await sub(rl.c)) === "suspended");

    console.log("\n── 4. Billing suspension still lifted (no regression) ──");
    const b = await mk("billing", "active_paid");
    await handleTenantBillingEvent("customer.subscription.deleted", { customer: b.cus });
    const bMid = await sub(b.c), bSrc = await source(b.c);
    await handleTenantBillingEvent("invoice.payment_succeeded", { customer: b.cus });
    check("subscription.deleted → suspended (billing) → payment_succeeded → active_paid", bMid === "suspended" && bSrc === "billing" && (await sub(b.c)) === "active_paid" && (await checkTenantGate(b.c)).allowed);
    const g = await mk("grace", "grace_period");
    await pool.query(`UPDATE companies SET grace_period_end = NOW() - interval '1 day' WHERE id = $1`, [g.c]);
    const { checkAndSuspendExpiredGracePeriods } = await import("../server/billingLifecycle");
    await checkAndSuspendExpiredGracePeriods();
    const gMid = await sub(g.c);
    await handleTenantBillingEvent("customer.subscription.updated", { customer: g.cus, status: "active" });
    check("grace expiry sweep → suspended (billing) → subscription.updated active → active_paid", gMid === "suspended" && (await sub(g.c)) === "active_paid");
    const ab = await mk("adminThenBilling", "active_paid");
    await provEvent("platform_admin", ab.c, "tenant.suspended", { reason: "temporary hold" });
    await patchTenant("platform_admin", ab.t, { status: "active", statusReason: "hold released" });
    await handleTenantBillingEvent("customer.subscription.deleted", { customer: ab.cus });
    const abSrc = await source(ab.c);
    await handleTenantBillingEvent("invoice.payment_succeeded", { customer: ab.cus });
    check("admin suspend → admin unsuspend → later billing suspension is billing and IS lifted by payment", abSrc === "billing" && (await sub(ab.c)) === "active_paid", abSrc);

    console.log("\n── 5. Legacy provisioning suspension (pre-change rows, no backfill) ──");
    const lg = await mk("legacy", "active_paid");
    await handleTenantBillingEvent("customer.subscription.deleted", { customer: lg.cus });
    await pool.query(`UPDATE authorization_audit_log SET created_at = NOW() - interval '2 days' WHERE company_id = $1`, [lg.c]);
    await pool.query(`INSERT INTO tenant_provisioning_audit_logs (company_id, event_type, status, details, triggered_by, created_at) VALUES ($1,'tenant.suspended','success','Tenant suspended','admin', NOW() - interval '1 day')`, [lg.c]);
    check("old billing row + newer legacy provisioning 'tenant.suspended' row → admin", (await source(lg.c)) === "admin");
    await pay(lg.cus);
    check("…not lifted by payment", (await sub(lg.c)) === "suspended");
    const nt = await mk("noTrail", "suspended");
    check("suspended with no trail → unknown, not lifted by payment (unchanged #181 behavior)", (await source(nt.c)) === "unknown" && (await (pay(nt.cus).then(() => sub(nt.c)))) === "suspended");

    console.log("\n── 6. Explicit admin unsuspend ──");
    const u0 = await patchTenant("platform_auditor", a.t, { status: "active" });
    check("platform_auditor cannot unsuspend (403), still suspended", u0.status === 403 && (await sub(a.c)) === "suspended");
    const u1 = await patchTenant("platform_admin", a.t, { status: "active", statusReason: "fraud review cleared" });
    const uRow = (await audits(a.c)).filter((x: any) => x.change_type === "tenant_status_change").pop() ?? {};
    check("PATCH /api/tenants/:id (platform_admin) → 200, active_paid, gate allows", u1.status === 200 && (await sub(a.c)) === "active_paid" && (await checkTenantGate(a.c)).allowed, String(u1.status));
    check("unsuspend audit row: who/source/reason/previous/new",
      uRow.actor_user_id === ids.platform_admin && uRow.before_value === "suspended" && uRow.after_value === "active" && uRow.note === "source=admin; role=platform_admin; reason=fraud review cleared" && uRow.tenant_id === a.t, JSON.stringify(uRow));
    const u2 = await patchTenant("platform_admin", a.t, { status: "suspended", statusReason: 7 });
    check("non-string statusReason → 400", u2.status === 400);

    console.log("\n── 7. Shared transition policy ──");
    const cn = await mk("cancelled", "cancelled");
    const c1 = await provEvent("platform_admin", cn.c, "tenant.suspended", { reason: "x" });
    check("cancelled → tenant.suspended refused 409 (never softened to reactivatable suspended), no audit", c1.status === 409 && (await sub(cn.c)) === "cancelled" && (await audits(cn.c)).length === 0, `${c1.status} ${JSON.stringify(c1.body)}`);
    const ir = await mk("integrity", "active_paid");
    await pool.query(`UPDATE companies SET gate_override_reason = 'integrity-repair: protected parent' WHERE id = $1`, [ir.c]);
    const i1 = await provEvent("platform_admin", ir.c, "tenant.suspended");
    check("integrity-repair record → 409, untouched", i1.status === 409 && (await sub(ir.c)) === "active_paid");

    console.log("\n── 8. Isolation ──");
    check("bystander untouched", (await sub(bystander.c)) === "active_paid" && (await tstat(bystander.t)) === "active" && (await audits(bystander.c)).length === 0);
  } finally {
    if (server) await server.stop();
    await pool.query(`DELETE FROM authorization_audit_log WHERE company_id = ANY($1::varchar[]) OR tenant_id = ANY($2::varchar[])`, [companyIds, tenantIds]);
    await pool.query(`DELETE FROM tenant_provisioning_audit_logs WHERE company_id = ANY($1::varchar[])`, [companyIds]).catch(() => {});
    await pool.query(`DELETE FROM integration_events WHERE company_id = ANY($1::varchar[])`, [companyIds]).catch(() => {});
    await pool.query(`DELETE FROM session WHERE sess->>'userId' IN (SELECT id FROM users WHERE username LIKE $1)`, [`zzasus_%_${sfx}`]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE username LIKE $1`, [`zzasus_%_${sfx}`]);
    await pool.query(`DELETE FROM tenant_companies WHERE tenant_id = ANY($1::varchar[])`, [tenantIds]);
    await pool.query(`DELETE FROM tenants WHERE id = ANY($1::varchar[])`, [tenantIds]);
    await cascadeDelete(pool, "companies", companyIds);
    const residue = await verifyZeroResidue(pool, "companies", companyIds);
    const strayT = Number((await pool.query(`SELECT count(*) FROM tenants WHERE id = ANY($1::varchar[])`, [tenantIds])).rows[0].count);
    const strayU = Number((await pool.query(`SELECT count(*) FROM users WHERE username LIKE $1`, [`zzasus_%_${sfx}`])).rows[0].count);
    const strayP = Number((await pool.query(`SELECT count(*) FROM tenant_provisioning_audit_logs WHERE company_id = ANY($1::varchar[])`, [companyIds])).rows[0].count);
    if (residue.length || strayT || strayU || strayP) { console.error(`CLEANUP RESIDUE: ${residue.join("; ")} tenants=${strayT} users=${strayU} provisioning_logs=${strayP}`); failed++; }
    else console.log("cleanup: zero residue confirmed");
    await pool.end();
    try { const { db } = await import("../server/db"); await (db as any).$client.end(); } catch { /* not loaded */ }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
