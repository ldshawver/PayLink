/**
 * P0-E — real server, real HTTP, disposable database: cancelled tenants are
 * not reactivated by POST /api/billing/activate, PUT
 * /api/platform/companies/:id/license, or Stripe subscription.deleted →
 * invoice.payment_succeeded; valid billing recovery still works; explicit
 * reinstatement (PATCH /api/tenants/:id, gate override) still works and is
 * authorization-checked; audit failures roll everything back; demo and
 * integrity-repair restrictions hold; bystander tenants are untouched.
 *
 * SAFETY: TEST_DATABASE_URL must point at a disposable database. Refuses
 * staging/production-shaped names/hosts, verifies current_database(), never
 * prints a URL, deletes every fixture and verifies zero residue.
 *
 * Run: TEST_DATABASE_URL=postgresql://user@host/disposable npx tsx tests/tenant-reactivation-paths-db.test.ts
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
  if (!url) { console.log("TEST_DATABASE_URL not set — skipping tenant-reactivation-paths DB tests (0 run)."); return; }
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
    const future = new Date(Date.now() + 7 * 86_400_000);
    const mk = async (label: string, sub: string, o: { demo?: boolean; reason?: string | null } = {}) => {
      const c = crypto.randomUUID();
      await pool.query(`INSERT INTO companies (id, name, subscription_status, is_demo, trial_end, stripe_customer_id, gate_override_reason, grace_period_end) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [c, `ZZ P0E ${label} ${sfx}`, sub, !!o.demo, o.demo ? future : null, `cus_p0e_${label}_${sfx}`, o.reason ?? null, sub === "grace_period" ? future : null]);
      const t = (await pool.query(`INSERT INTO tenants (name, slug, status) VALUES ($1,$1,'active') RETURNING id`, [`zz-p0e-${label}-${sfx}`])).rows[0].id;
      await pool.query(`INSERT INTO tenant_companies (tenant_id, company_id, is_primary) VALUES ($1,$2,true)`, [t, c]);
      companyIds.push(c); tenantIds.push(t);
      return { c, t };
    };
    for (const role of ["platform_super_admin", "platform_admin", "platform_auditor", "platform_billing"]) {
      await pool.query(`INSERT INTO users (id, username, password, role, company_id, is_active) VALUES ($1,$2,$3,$4,NULL,true)`, [crypto.randomUUID(), `zzp0e_${role}_${sfx}`, hash, role]);
    }
    const sub = async (c: string) => (await pool.query(`SELECT subscription_status FROM companies WHERE id=$1`, [c])).rows[0].subscription_status as string;
    const tstat = async (t: string) => (await pool.query(`SELECT status FROM tenants WHERE id=$1`, [t])).rows[0].status as string;
    const audits = async (c: string) => (await pool.query(`SELECT actor_user_id, change_type, before_value, after_value FROM authorization_audit_log WHERE company_id=$1 ORDER BY created_at, change_type`, [c])).rows;

    process.env.DATABASE_URL = url;
    const { handleTenantBillingEvent } = await import("../server/billingLifecycle");
    const { applyBillingActivation } = await import("../server/tenant-billing-activation");
    const { checkTenantGate } = await import("../server/tenant-enforcement");
    server = await startTestServer(url);
    const base = server.baseUrl;
    const S: Record<string, Session> = {};
    for (const r of ["platform_super_admin", "platform_admin", "platform_auditor", "platform_billing"]) S[r] = await login(base, `zzp0e_${r}_${sfx}`, pw);
    const csrf: Record<string, string> = {};
    for (const r of Object.keys(S)) {
      const res = await fetch(`${base}/api/auth/me`, { headers: { cookie: S[r].cookie } });
      csrf[r] = (res.headers.get("set-cookie") || "").match(/csrf_token=([0-9a-f]+)/)?.[1] || "";
    }
    let activateCalls = 0, saw429 = false;
    const activate = async (role: string, companyId: string, note?: string) => {
      activateCalls++;
      const r = await fetch(`${base}/api/billing/activate`, {
        method: "POST",
        headers: { cookie: `${S[role].cookie}; csrf_token=${csrf[role]}`, "x-csrf-token": csrf[role], "content-type": "application/json" },
        body: JSON.stringify({ companyId, note }),
      });
      if (r.status === 429) saw429 = true;
      let body: any; try { body = await r.json(); } catch { body = undefined; }
      return { status: r.status, body };
    };
    const license = (role: string, companyId: string, body: Record<string, unknown>) => apiRequest(base, "PUT", `/api/platform/companies/${companyId}/license`, S[role], body);
    const SA_DIRECT = { userId: "zz-direct-sa", role: "platform_super_admin" };

    const bystander = await mk("bystander", "active_paid");
    const bystanderAuditBefore = (await audits(bystander.c)).length;

    console.log("\n── 1. Cancelled tenant: billing activation ──");
    const cA = await mk("cancA", "cancelled"), cB = await mk("cancB", "canceled");
    for (const [label, f, st] of [["cancelled", cA, "cancelled"], ["canceled", cB, "canceled"]] as const) {
      const r = await activate("platform_admin", f.c);
      check(`${label}: POST /api/billing/activate → 409, still ${st}, gate blocks, no audit`, r.status === 409 && (await sub(f.c)) === st && !(await checkTenantGate(f.c)).allowed && (await audits(f.c)).length === 0, `${r.status} ${JSON.stringify(r.body)}`);
    }
    const r1s = await activate("platform_super_admin", cA.c);
    check("cancelled: refused even for platform_super_admin (activation is not a reinstatement)", r1s.status === 409 && (await sub(cA.c)) === "cancelled", String(r1s.status));
    const trialC = await mk("trial", "trial_active");
    const rT = await activate("platform_admin", trialC.c, "paid by invoice");
    const aT = await audits(trialC.c);
    check("valid activation (trial_active): 200 → active_paid, mirror active, one billing_activated audit row by the actor", rT.status === 200 && (await sub(trialC.c)) === "active_paid" && (await tstat(trialC.t)) === "active" && aT.length === 1 && aT[0].change_type === "billing_activated" && aT[0].before_value === "trial_active", `${rT.status} ${JSON.stringify(aT)}`);
    const rAud = await activate("platform_auditor", trialC.c);
    const rBil = await activate("platform_billing", trialC.c);
    check("platform_auditor / platform_billing → 403", rAud.status === 403 && rBil.status === 403);

    console.log("\n── 2. Cancelled tenant: license update ──");
    const lF = await mk("licF", "cancelled");
    for (const status of ["active", "trialing", "suspended", "expired", "inactive"]) {
      const r = await license("platform_admin", lF.c, { status, reason: "probe" });
      check(`cancelled + license status=${status} → 409, company still cancelled`, r.status === 409 && (await sub(lF.c)) === "cancelled", `${r.status} ${JSON.stringify(r.body)}`);
    }
    const rLs = await license("platform_super_admin", lF.c, { status: "active" });
    check("cancelled + license active by platform_super_admin → 409 (license update is not a reinstatement)", rLs.status === 409 && (await sub(lF.c)) === "cancelled");
    const rLc = await license("platform_admin", lF.c, { status: "cancelled", notes: "note only" });
    check("cancelled + license cancelled (no-op) → 200, company untouched, no company audit", rLc.status === 200 && (await sub(lF.c)) === "cancelled" && (await audits(lF.c)).length === 0, String(rLc.status));
    const lG = await mk("licG", "active_paid");
    const rG1 = await license("platform_admin", lG.c, { status: "suspended", reason: "non-payment" });
    const rG2 = await license("platform_admin", lG.c, { status: "active", reason: "paid" });
    const aG = (await audits(lG.c)).filter((a: any) => a.change_type === "license_admin_update").map((a: any) => `${a.before_value}>${a.after_value}`);
    check("valid license workflow: active → suspended → active, each audited (license_admin_update)", rG1.status === 200 && rG2.status === 200 && (await sub(lG.c)) === "active_paid" && aG.join(",") === "active_paid>suspended,suspended>active_paid", `${rG1.status},${rG2.status} ${aG.join(",")}`);
    const rGa = await license("platform_auditor", lG.c, { status: "suspended" });
    check("platform_auditor license update → 403, unchanged", rGa.status === 403 && (await sub(lG.c)) === "active_paid");
    const ir = await mk("integrity", "active_paid", { demo: true, reason: "integrity-repair: protected parent" });
    const rI1 = await license("platform_admin", ir.c, { status: "suspended" });
    const rI2 = await license("platform_admin", ir.c, { reason: "overwrite marker" });
    const marker = (await pool.query(`SELECT gate_override_reason FROM companies WHERE id=$1`, [ir.c])).rows[0].gate_override_reason;
    check("integrity-repair: license status and reason writes refused (409), marker kept", rI1.status === 409 && rI2.status === 409 && marker === "integrity-repair: protected parent" && (await sub(ir.c)) === "active_paid", `${rI1.status},${rI2.status}`);
    const rI3 = await license("platform_admin", lG.c, { reason: "Integrity-Repair forged" });
    check("forging the integrity-repair marker via license reason → 400", rI3.status === 400);
    const rI4 = await activate("platform_admin", ir.c);
    check("integrity-repair: billing activation refused (409)", rI4.status === 409 && (await sub(ir.c)) === "active_paid");

    console.log("\n── 3. Stripe subscription.deleted → payment_succeeded ──");
    const sH = await mk("stripeCancelled", "cancelled");
    await handleTenantBillingEvent("customer.subscription.deleted", { customer: `cus_p0e_stripeCancelled_${sfx}` });
    check("cancelled + subscription.deleted → stays cancelled (not downgraded to reactivatable suspended), no audit", (await sub(sH.c)) === "cancelled" && (await audits(sH.c)).length === 0);
    await handleTenantBillingEvent("invoice.payment_succeeded", { customer: `cus_p0e_stripeCancelled_${sfx}` });
    await handleTenantBillingEvent("customer.subscription.updated", { customer: `cus_p0e_stripeCancelled_${sfx}`, status: "active" });
    const aH = await audits(sH.c);
    check("cancelled + payment_succeeded / subscription.updated active → stays cancelled; two lifecycle_reactivation_refused rows", (await sub(sH.c)) === "cancelled" && !(await checkTenantGate(sH.c)).allowed && aH.length === 2 && aH.every((a: any) => a.change_type === "lifecycle_reactivation_refused" && a.actor_user_id === "system"), JSON.stringify(aH));
    const sI = await mk("stripeRecovery", "active_paid");
    await handleTenantBillingEvent("customer.subscription.deleted", { customer: `cus_p0e_stripeRecovery_${sfx}` });
    const midI = await sub(sI.c);
    await handleTenantBillingEvent("invoice.payment_succeeded", { customer: `cus_p0e_stripeRecovery_${sfx}` });
    const aI = (await audits(sI.c)).map((a: any) => `${a.change_type}:${a.before_value}>${a.after_value}`);
    check("billing recovery preserved: active_paid → (subscription.deleted) suspended → (payment) active_paid, both audited", midI === "suspended" && (await sub(sI.c)) === "active_paid" && aI.join(",") === "lifecycle_transition:active_paid>suspended,lifecycle_transition:suspended>active_paid", aI.join(","));
    const sJ = await mk("stripeAdminSusp", "active_paid");
    const pJ = await apiRequest(base, "PATCH", `/api/tenants/${sJ.t}`, S.platform_admin, { status: "suspended" });
    await handleTenantBillingEvent("customer.subscription.deleted", { customer: `cus_p0e_stripeAdminSusp_${sfx}` });
    await handleTenantBillingEvent("invoice.payment_succeeded", { customer: `cus_p0e_stripeAdminSusp_${sfx}` });
    const aJ = (await audits(sJ.c)).map((a: any) => a.change_type);
    check("administratively suspended tenant: subscription.deleted is a no-op and payment does NOT restore access", pJ.status === 200 && (await sub(sJ.c)) === "suspended" && !(await checkTenantGate(sJ.c)).allowed && aJ.join(",") === "tenant_status_change,lifecycle_reactivation_refused", aJ.join(","));
    const sK = await mk("stripeGrace", "grace_period");
    await handleTenantBillingEvent("invoice.payment_succeeded", { customer: `cus_p0e_stripeGrace_${sfx}` });
    check("grace_period + payment_succeeded → active_paid (dunning recovery preserved)", (await sub(sK.c)) === "active_paid");
    const sL = await mk("stripeLegacySusp", "suspended");
    await handleTenantBillingEvent("invoice.payment_succeeded", { customer: `cus_p0e_stripeLegacySusp_${sfx}` });
    check("suspended with no audit trail → not restored by payment (conservative), refusal audited", (await sub(sL.c)) === "suspended" && (await audits(sL.c)).map((a: any) => a.change_type).join(",") === "lifecycle_reactivation_refused");
    const sG = await mk("stripeGraceExpired", "grace_period");
    await pool.query(`UPDATE companies SET grace_period_end = NOW() - interval '1 day' WHERE id = $1`, [sG.c]);
    const { checkAndSuspendExpiredGracePeriods } = await import("../server/billingLifecycle");
    await checkAndSuspendExpiredGracePeriods();
    const midG = await sub(sG.c);
    await handleTenantBillingEvent("invoice.payment_succeeded", { customer: `cus_p0e_stripeGraceExpired_${sfx}` });
    check("grace expiry sweep → suspended (audited) → payment restores (billing suspension)", midG === "suspended" && (await sub(sG.c)) === "active_paid");

    console.log("\n── 4. Authorized reinstatement ──");
    const rM = await mk("reinstatePatch", "cancelled");
    const pM = await apiRequest(base, "PATCH", `/api/tenants/${rM.t}`, S.platform_admin, { status: "active" });
    const aM = (await audits(rM.c)).filter((a: any) => a.change_type === "tenant_status_change");
    check("PATCH /api/tenants/:id (platform_admin) cancelled → active: 200, active_paid, audited cancelled → active", pM.status === 200 && (await sub(rM.c)) === "active_paid" && aM.length === 1 && aM[0].before_value === "cancelled" && aM[0].after_value === "active", `${pM.status} ${JSON.stringify(aM)}`);
    const rMa = await activate("platform_admin", rM.c, "billing after reinstatement");
    check("after explicit reinstatement, billing activation succeeds (no-op status, audited)", rMa.status === 200 && (await audits(rM.c)).some((a: any) => a.change_type === "billing_activated"));
    const rN = await mk("reinstateOverride", "cancelled");
    const oN = await apiRequest(base, "POST", `/api/platform/audit/licensing/${rN.c}/gate-override`, S.platform_super_admin, { subscriptionStatus: "active_paid", reason: "customer re-signed" });
    check("gate override (platform_super_admin) cancelled → active_paid with reason: 200, audited", oN.status === 200 && (await sub(rN.c)) === "active_paid" && (await audits(rN.c)).some((a: any) => a.change_type === "gate_override" && a.before_value === "cancelled"));

    console.log("\n── 5. Unauthorized reinstatement ──");
    const rU = await mk("reinstateDenied", "cancelled");
    const u1 = await apiRequest(base, "POST", `/api/platform/audit/licensing/${rU.c}/gate-override`, S.platform_admin, { subscriptionStatus: "active_paid", reason: "x" });
    const u2 = await apiRequest(base, "PATCH", `/api/tenants/${rU.t}`, S.platform_auditor, { status: "active" });
    const u3 = await apiRequest(base, "PATCH", `/api/tenants/${rU.t}`, S.platform_billing, { status: "active" });
    const u4 = await license("platform_admin", rU.c, { status: "active" });
    const u5 = await applyBillingActivation(pool as any, rU.c, {}, { userId: "zz", role: "platform_billing" });
    check("gate override by platform_admin 403; PATCH by auditor/billing 403; license 409; activation by billing role 403", u1.status === 403 && u2.status === 403 && u3.status === 403 && u4.status === 409 && !u5.ok && u5.status === 403, `${u1.status},${u2.status},${u3.status},${u4.status},${(u5 as any).status}`);
    check("…and the tenant is still cancelled with no audit rows", (await sub(rU.c)) === "cancelled" && (await audits(rU.c)).length === 0);

    console.log("\n── 6. Audit insertion failure rolls back ──");
    const fb = await mk("rbActivate", "suspended"), fl = await mk("rbLicense", "active_paid"), fs_ = await mk("rbStripe", "active_paid");
    await handleTenantBillingEvent("customer.subscription.deleted", { customer: `cus_p0e_rbStripe_${sfx}` });
    const stripeAuditBefore = (await audits(fs_.c)).length;
    await pool.query(`ALTER TABLE authorization_audit_log ADD CONSTRAINT zz_p0e_block CHECK (company_id IS NULL OR company_id NOT IN ('${fb.c}','${fl.c}','${fs_.c}')) NOT VALID`);
    let e1 = false, e3 = false;
    try { await applyBillingActivation(pool as any, fb.c, {}, SA_DIRECT); } catch { e1 = true; }
    const lr = await license("platform_admin", fl.c, { status: "suspended", reason: "rollback probe" });
    try { await handleTenantBillingEvent("invoice.payment_succeeded", { customer: `cus_p0e_rbStripe_${sfx}` }); } catch { e3 = true; }
    await pool.query(`ALTER TABLE authorization_audit_log DROP CONSTRAINT zz_p0e_block`);
    const licRow = (await pool.query(`SELECT count(*)::int n FROM tenant_licenses WHERE company_id=$1`, [fl.c])).rows[0].n;
    check("billing activation: audit failure throws; status, mirror unchanged", e1 && (await sub(fb.c)) === "suspended" && (await tstat(fb.t)) === "active");
    check("license update: audit failure → 500; company status and tenant_licenses row rolled back", lr.status === 500 && (await sub(fl.c)) === "active_paid" && licRow === 0, `${lr.status} lic=${licRow}`);
    check("Stripe reactivation: audit failure throws; still suspended; no new audit rows", e3 && (await sub(fs_.c)) === "suspended" && (await audits(fs_.c)).length === stripeAuditBefore);

    console.log("\n── 7. Demo restrictions ──");
    const dm = await mk("demo", "trial_active", { demo: true });
    const d1 = await activate("platform_admin", dm.c);
    const d2 = await license("platform_admin", dm.c, { status: "active" });
    check("demo: billing activation 409, license active 409, status unchanged", d1.status === 409 && d2.status === 409 && (await sub(dm.c)) === "trial_active", `${d1.status},${d2.status}`);
    const d3 = await license("platform_admin", dm.c, { status: "suspended", reason: "demo abuse" });
    const dmIsDemo = (await pool.query(`SELECT is_demo FROM companies WHERE id=$1`, [dm.c])).rows[0].is_demo;
    check("demo: license suspend allowed (restrictive), is_demo kept, gate blocks", d3.status === 200 && (await sub(dm.c)) === "suspended" && dmIsDemo === true && !(await checkTenantGate(dm.c)).allowed);
    const dS = await mk("demoStripe", "active_paid", { demo: true });
    await handleTenantBillingEvent("customer.subscription.deleted", { customer: `cus_p0e_demoStripe_${sfx}` });
    await handleTenantBillingEvent("invoice.payment_succeeded", { customer: `cus_p0e_demoStripe_${sfx}` });
    check("demo: Stripe payment never promotes a suspended demo back to active_paid", (await sub(dS.c)) === "suspended" && (await audits(dS.c)).some((a: any) => a.change_type === "lifecycle_reactivation_refused"));

    console.log("\n── 8. Cross-tenant isolation ──");
    check("bystander tenant untouched by every operation above", (await sub(bystander.c)) === "active_paid" && (await tstat(bystander.t)) === "active" && (await audits(bystander.c)).length === bystanderAuditBefore && (await checkTenantGate(bystander.c)).allowed);
    const otherSignups = (await pool.query(`SELECT count(*)::int n FROM trial_signups WHERE company_id = ANY($1::varchar[]) AND subscription_status = 'active_paid'`, [[bystander.c, cA.c, lF.c]])).rows[0].n;
    check("activation of one company never rewrites another company's trial_signups", otherSignups === 0);
    check(`billing/activate HTTP calls stayed under the rate limit (${activateCalls} calls, no 429)`, !saw429 && activateCalls <= 10);
  } finally {
    if (server) await server.stop();
    await pool.query(`ALTER TABLE authorization_audit_log DROP CONSTRAINT IF EXISTS zz_p0e_block`).catch(() => {});
    await pool.query(`DELETE FROM authorization_audit_log WHERE company_id = ANY($1::varchar[]) OR tenant_id = ANY($2::varchar[])`, [companyIds, tenantIds]);
    await pool.query(`DELETE FROM tenant_license_events WHERE company_id = ANY($1::varchar[])`, [companyIds]).catch(() => {});
    await pool.query(`DELETE FROM tenant_licenses WHERE company_id = ANY($1::varchar[])`, [companyIds]).catch(() => {});
    await pool.query(`DELETE FROM analytics_events WHERE company_id = ANY($1::varchar[])`, [companyIds]).catch(() => {});
    await pool.query(`DELETE FROM session WHERE sess->>'userId' IN (SELECT id FROM users WHERE username LIKE $1)`, [`zzp0e_%_${sfx}`]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE username LIKE $1`, [`zzp0e_%_${sfx}`]);
    await pool.query(`DELETE FROM tenant_companies WHERE tenant_id = ANY($1::varchar[])`, [tenantIds]);
    await pool.query(`DELETE FROM tenants WHERE id = ANY($1::varchar[])`, [tenantIds]);
    await cascadeDelete(pool, "companies", companyIds);
    const residue = await verifyZeroResidue(pool, "companies", companyIds);
    const strayT = Number((await pool.query(`SELECT count(*) FROM tenants WHERE id = ANY($1::varchar[])`, [tenantIds])).rows[0].count);
    const strayU = Number((await pool.query(`SELECT count(*) FROM users WHERE username LIKE $1`, [`zzp0e_%_${sfx}`])).rows[0].count);
    if (residue.length || strayT || strayU) { console.error(`CLEANUP RESIDUE: ${residue.join("; ")} tenants=${strayT} users=${strayU}`); failed++; }
    else console.log("cleanup: zero residue confirmed");
    await pool.end();
    try { const { db } = await import("../server/db"); await (db as any).$client.end(); } catch { /* not loaded */ }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
