/**
 * P0-E — cancelled-tenant reactivation paths: the shared transition policy,
 * POST /api/billing/activate (applyBillingActivation), PUT
 * /api/platform/companies/:id/license (adminUpsertLicense) and the Stripe
 * lifecycle. Pure-function + fake-pg + static checks, no database. The
 * real-server proof is tests/tenant-reactivation-paths-db.test.ts.
 *
 * Run: npx tsx tests/tenant-reactivation-paths.test.ts
 */
import fs from "node:fs";
import { checkSubscriptionTransition, SUBSCRIPTION_TRANSITIONS, GATE_OVERRIDE_TRANSITIONS } from "../server/tenant-gate-override";
import { applyBillingActivation } from "../server/tenant-billing-activation";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

type Company = { id: string; subscription_status: string | null; is_demo: boolean; trial_end: string | null; gate_override_reason: string | null; billing_active?: boolean };
type State = { company: Company; tenant: { id: string; status: string } | null; audit: any[]; trialSignup: string | null };
function fakePool(initial: State, opts: { failAudit?: boolean } = {}) {
  const committed: State = JSON.parse(JSON.stringify(initial));
  let working: State = JSON.parse(JSON.stringify(initial));
  const log: string[] = [];
  let released = 0;
  const client = {
    async query(text: string, params: any[] = []) {
      const t = text.replace(/\s+/g, " ").trim();
      log.push(t.split(" ").slice(0, 3).join(" "));
      if (t === "BEGIN") { working = JSON.parse(JSON.stringify(committed)); return { rows: [] }; }
      if (t === "COMMIT") { Object.assign(committed, JSON.parse(JSON.stringify(working))); return { rows: [] }; }
      if (t === "ROLLBACK") { working = JSON.parse(JSON.stringify(committed)); return { rows: [] }; }
      if (t.startsWith("SELECT id, subscription_status, is_demo, trial_end, gate_override_reason FROM companies")) {
        if (!t.endsWith("FOR UPDATE")) throw new Error("company row must be locked FOR UPDATE");
        return { rows: params[0] === working.company.id ? [{ ...working.company }] : [] };
      }
      if (t.startsWith("UPDATE companies SET subscription_status = 'active_paid'")) { working.company.subscription_status = "active_paid"; working.company.billing_active = true; return { rows: [], rowCount: 1 }; }
      if (t.startsWith("UPDATE trial_signups")) { working.trialSignup = "active_paid"; return { rows: [], rowCount: 1 }; }
      if (t.startsWith("SELECT tc.tenant_id")) return { rows: working.tenant ? [{ tenant_id: working.tenant.id, primary_company_id: working.company.id }] : [] };
      if (t.startsWith("UPDATE tenants SET status")) { working.tenant!.status = params[0]; return { rows: [] }; }
      if (t.startsWith("INSERT INTO authorization_audit_log")) {
        if (opts.failAudit) throw new Error("simulated audit insert failure");
        working.audit.push({ text: t, params });
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${t}`);
    },
    release() { released++; },
  };
  return { pool: { connect: async () => client }, committed, log, released: () => released };
}
const base = (sub: string | null, extra: Partial<Company> = {}): State => ({
  company: { id: "c1", subscription_status: sub, is_demo: false, trial_end: null, gate_override_reason: null, billing_active: false, ...extra },
  tenant: { id: "t1", status: "trial" }, audit: [], trialSignup: null,
});
const PA = { userId: "u-pa", role: "platform_admin" };

async function main() {
  console.log("Shared transition policy — reinstatement out of cancelled is reserved");
  for (const to of ["active_paid", "trial_active", "grace", "past_due", "suspended", "trial_expired"]) {
    for (const stored of ["cancelled", "canceled", "CANCELLED"]) {
      const r = checkSubscriptionTransition(stored, to, false, { allowReinstatement: false });
      ok(`${stored} → ${to} refused (409) without allowReinstatement`, !r.ok && r.status === 409);
    }
  }
  ok("cancelled → active_paid still allowed for the explicit reinstatement path (gate override)", checkSubscriptionTransition("cancelled", "active_paid", false, { allowReinstatement: true }).ok);
  ok("canceled → cancelled is a no-op (spelling-normalized)", (() => { const r = checkSubscriptionTransition("canceled", "cancelled", false, { allowReinstatement: false }); return r.ok && r.noop; })());
  ok("legacy 'active' → active_paid allowed (canonicalization)", checkSubscriptionTransition("active", "active_paid", false, { allowReinstatement: false }).ok);
  for (const to of ["active_paid", "trial_active", "grace", "past_due", "trial_expired"]) {
    ok(`demo → ${to} refused`, !checkSubscriptionTransition("suspended", to, true, { allowReinstatement: true }).ok && !checkSubscriptionTransition("active_paid", to === "active_paid" ? "trial_active" : to, true, { allowReinstatement: true }).ok);
  }
  ok("trial_expired never reachable from past_due / suspended / cancelled (gate does not block trial_expired)", ["past_due", "suspended", "cancelled"].every((f) => !SUBSCRIPTION_TRANSITIONS.trial_expired.includes(f as any)));
  ok("SUBSCRIPTION_TRANSITIONS extends GATE_OVERRIDE_TRANSITIONS (single policy)", Object.entries(GATE_OVERRIDE_TRANSITIONS).every(([k, v]) => SUBSCRIPTION_TRANSITIONS[k] === v));
  ok("unknown target → 400", (() => { const r = checkSubscriptionTransition("active_paid", "bogus", false, { allowReinstatement: true }); return !r.ok && r.status === 400; })());

  console.log("\napplyBillingActivation — authorization and validation");
  for (const role of ["platform_auditor", "platform_billing", "platform_support", "admin", "tenant_admin", null]) {
    const f = fakePool(base("trial_active"));
    const r = await applyBillingActivation(f.pool, "c1", {}, { userId: "u", role });
    ok(`${role ?? "no role"} → 403, no query`, !r.ok && r.status === 403 && f.log.length === 0);
  }
  for (const [label, id] of [["missing", undefined], ["empty", ""], ["malformed", "c1; DROP"], ["object", { x: 1 }]] as const) {
    const f = fakePool(base("trial_active"));
    const r = await applyBillingActivation(f.pool, id as any, {}, PA);
    ok(`${label} companyId → 400, no query`, !r.ok && r.status === 400 && f.log.length === 0);
  }
  {
    const f = fakePool(base("trial_active"));
    const r = await applyBillingActivation(f.pool, "c1", { note: 7 }, PA);
    ok("non-string note → 400", !r.ok && r.status === 400);
  }

  console.log("\napplyBillingActivation — cancelled / demo / integrity-repair are refused");
  for (const st of ["cancelled", "canceled"]) {
    const f = fakePool(base(st));
    const r = await applyBillingActivation(f.pool, "c1", {}, PA);
    ok(`${st} → 409, unchanged, no audit, rolled back`, !r.ok && r.status === 409 && f.committed.company.subscription_status === st && f.committed.audit.length === 0 && f.log.includes("ROLLBACK"));
  }
  {
    const f = fakePool(base("cancelled"));
    const r = await applyBillingActivation(f.pool, "c1", {}, { userId: "u-sa", role: "platform_super_admin" });
    ok("cancelled → 409 even for platform_super_admin (reinstate via PATCH / gate override first)", !r.ok && r.status === 409);
  }
  {
    const f = fakePool(base("trial_active", { is_demo: true }));
    const r = await applyBillingActivation(f.pool, "c1", {}, PA);
    ok("demo company → 409", !r.ok && r.status === 409 && f.committed.company.subscription_status === "trial_active");
  }
  {
    const f = fakePool(base("active_paid", { is_demo: true, gate_override_reason: "integrity-repair: parent" }));
    const r = await applyBillingActivation(f.pool, "c1", {}, PA);
    ok("integrity-repair company → 409", !r.ok && r.status === 409 && f.committed.audit.length === 0);
  }
  {
    const f = fakePool(base("weird_legacy"));
    const r = await applyBillingActivation(f.pool, "c1", {}, PA);
    ok("unrecognized stored status → 409", !r.ok && r.status === 409);
  }
  {
    const f = fakePool(base("trial_active"));
    const r = await applyBillingActivation(f.pool, "nope", {}, PA);
    ok("unknown company → 404", !r.ok && r.status === 404);
  }

  console.log("\napplyBillingActivation — valid activation is transactional and audited");
  for (const st of ["trial_active", "trial_expired", "past_due", "grace_period", "suspended"]) {
    const f = fakePool(base(st));
    const r = await applyBillingActivation(f.pool, "c1", { note: " paid by card " }, PA);
    const row = f.committed.audit[0];
    ok(`${st} → active_paid with one billing_activated audit row (before=${st}, note trimmed)`, r.ok && r.statusChanged && f.committed.company.subscription_status === "active_paid" && f.committed.audit.length === 1 && /'billing_activated'/.test(row.text) && row.params[0] === "u-pa" && row.params[1] === st && row.params[2] === "paid by card" && row.params[3] === "c1" && row.params[4] === "t1");
  }
  {
    const f = fakePool(base("trial_active"));
    await applyBillingActivation(f.pool, "c1", {}, PA);
    ok("mirror re-derived in-transaction (tenant → active), trial_signups updated", f.committed.tenant!.status === "active" && f.committed.trialSignup === "active_paid");
    const i = (p: string) => f.log.findIndex((l) => l.startsWith(p));
    ok("BEGIN < UPDATE companies < audit INSERT < COMMIT; connection released", i("BEGIN") < i("UPDATE companies") && i("UPDATE companies") < i("INSERT INTO authorization_audit_log") && i("INSERT INTO authorization_audit_log") < i("COMMIT") && f.released() === 1);
  }
  {
    const f = fakePool(base("active_paid"));
    const r = await applyBillingActivation(f.pool, "c1", {}, PA);
    ok("already active_paid: status no-op but still audited", r.ok && !r.statusChanged && f.committed.audit.length === 1 && f.committed.tenant!.status === "trial");
  }
  {
    const s = base("suspended"); s.tenant!.status = "suspended";
    const f = fakePool(s, { failAudit: true });
    let threw = false;
    try { await applyBillingActivation(f.pool, "c1", {}, PA); } catch { threw = true; }
    ok("audit insert failure → throws, status/mirror/trial_signups unchanged, ROLLBACK, released", threw && f.committed.company.subscription_status === "suspended" && f.committed.tenant!.status === "suspended" && f.committed.trialSignup === null && f.log.includes("ROLLBACK") && !f.log.includes("COMMIT") && f.released() === 1);
  }

  console.log("\nLicense service (static)");
  const lic = fs.readFileSync("server/licensing/license-service.ts", "utf8");
  const upsert = lic.slice(lic.indexOf("export async function adminUpsertLicense"));
  ok("re-checks platform admin role", /LICENSE_ADMIN_ROLES\.includes\(\(actor\.role \|\| ""\) as any\)[\s\S]{0,80}throw new LicenseForbiddenError/.test(upsert));
  ok("locks the company row FOR UPDATE and reads is_demo + gate_override_reason", /SELECT id, subscription_status, plan_name, trial_end, is_demo, gate_override_reason\s+FROM companies WHERE id = \$\{companyId\} LIMIT 1 FOR UPDATE/.test(upsert));
  ok("refuses status/reason writes on integrity-repair companies (409)", /isIntegrityRepairReason\(company\.gate_override_reason\) && \(wantStatus \|\| reasonText\)[\s\S]{0,40}throw new LicenseConflictError/.test(upsert));
  ok("rejects a forged integrity-repair reason (400)", /if \(isIntegrityRepairReason\(patch\.reason\)\) \{\s*throw new LicenseValidationError/.test(upsert));
  ok("company status change goes through checkSubscriptionTransition(..., { allowReinstatement: false })", /checkSubscriptionTransition\(company\.subscription_status, mapped, company\.is_demo === true, \{ allowReinstatement: false \}\)/.test(upsert));
  ok("authorization_audit_log insert is mandatory (no try/catch swallowing it)", !/try \{\s*await exec\.execute\(sql`\s*INSERT INTO authorization_audit_log/.test(upsert) && /'license_admin_update'/.test(upsert));
  const routes = fs.readFileSync("server/routes.ts", "utf8");
  const licRoute = routes.match(/app\.put\("\/api\/platform\/companies\/:companyId\/license"[\s\S]*?\n {2}\}\);/)?.[0] ?? "";
  ok("license route maps conflict → 409 and forbidden → 403", /LicenseConflictError\) return res\.status\(409\)/.test(licRoute) && /LicenseForbiddenError\) return res\.status\(403\)/.test(licRoute));

  console.log("\nStripe lifecycle (static)");
  const billing = fs.readFileSync("server/billingLifecycle.ts", "utf8");
  ok("reactivation never from cancelled", /if \(status === "cancelled"\) refused = /.test(billing));
  ok("reactivation from suspended only when the suspension was applied by billing", /else if \(status === "suspended"\) \{\s*const source = await getSuspensionSource\(tx, companyId\);\s*if \(source === "admin"\) refused = [\s\S]{0,120}else if \(source === "unverifiable"\) refused = [\s\S]{0,200}else if \(source !== "billing"\) refused = /.test(billing));
  ok("getSuspensionSource: latest suspension audit row must be a system lifecycle_transition", /after_value = 'suspended'[\s\S]{0,700}ORDER BY created_at DESC[\s\S]{0,300}row\.change_type === "lifecycle_transition"\) return row\.actor_user_id === "system" \? "billing" : "admin"/.test(billing));
  ok("refused reactivations are audited (lifecycle_reactivation_refused)", /insertLifecycleAudit\(tx, companyId, "lifecycle_reactivation_refused"/.test(billing));
  ok("subscription.deleted leaves cancelled and suspended companies unchanged", /if \(status === "cancelled" \|\| status === "suspended"\) return null;/.test(billing));
  ok("no lifecycle status UPDATE outside a transaction", (billing.match(/await db\.execute\(sql`\s*UPDATE companies\s+SET subscription_status/g) || []).length === 0);
  ok("lifecycle audit rows written on the transaction (no best-effort logger left)", !/logBillingAuditEvent/.test(billing) && (billing.match(/await insertLifecycleAudit\(tx,/g) || []).length >= 5);
  const ras = routes.match(/async function requireActiveSubscription[\s\S]*?\n\}/)?.[0] ?? "";
  ok("requireActiveSubscription grace expiry uses the audited suspendExpiredGracePeriod()", /if \(await suspendExpiredGracePeriod\(user\.companyId\)\)/.test(ras) && !/SET subscription_status = 'suspended'/.test(ras));
  const act = routes.match(/app\.post\("\/api\/billing\/activate",[\s\S]*?\n {2}\}\);/)?.[0] ?? "";
  ok("billing/activate route: requirePlatformAdminRole + CSRF kept, delegates to applyBillingActivation, no raw status UPDATE", /requirePlatformAdminRole\(\), billingActivateRateLimit, requireCsrfToken/.test(act) && /applyBillingActivation\(db\.\$client/.test(act) && !/SET subscription_status/.test(act));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
