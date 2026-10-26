/**
 * Admin vs billing suspension source: applyAdminSuspension() (POST
 * /api/provisioning/event tenant.suspended), the suspension-source classifier
 * used by Stripe reactivation, CSRF on the provisioning route, and a guard
 * that every companies.subscription_status = 'suspended' writer is audited.
 * Pure-function + fake-pg + static checks, no database. The real-server proof
 * is tests/admin-suspension-source-db.test.ts.
 *
 * Run: npx tsx tests/admin-suspension-source.test.ts
 */
import fs from "node:fs";
import path from "node:path";
import { applyAdminSuspension, ADMIN_SUSPENSION_CHANGE_TYPE } from "../server/tenant-admin-suspension";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

type Company = { id: string; subscription_status: string | null; is_demo: boolean; trial_end: string | null; gate_override_reason: string | null };
type State = { company: Company; tenant: { id: string; status: string } | null; gate: string | null; audit: any[][]; provisioning: any[][] };
function fakePool(initial: State, opts: { failAudit?: boolean } = {}) {
  const committed: State = JSON.parse(JSON.stringify(initial));
  let working: State = JSON.parse(JSON.stringify(initial));
  let released = 0;
  const client = {
    async query(text: string, params: any[] = []) {
      const t = text.replace(/\s+/g, " ").trim();
      if (t === "BEGIN") { working = JSON.parse(JSON.stringify(committed)); return { rows: [] }; }
      if (t === "COMMIT") { Object.assign(committed, JSON.parse(JSON.stringify(working))); return { rows: [] }; }
      if (t === "ROLLBACK") { working = JSON.parse(JSON.stringify(committed)); return { rows: [] }; }
      if (t.startsWith("SELECT id, subscription_status, is_demo, trial_end, gate_override_reason FROM companies")) {
        if (!t.endsWith("FOR UPDATE")) throw new Error("company row must be locked FOR UPDATE");
        return { rows: params[0] === working.company.id ? [{ ...working.company }] : [] };
      }
      if (t.startsWith("UPDATE companies SET subscription_status = 'suspended'")) { working.company.subscription_status = "suspended"; return { rows: [], rowCount: 1 }; }
      if (t.startsWith("UPDATE tenant_commercial_gates SET lifecycle_state = 'suspended'")) { working.gate = "suspended"; return { rows: [], rowCount: 1 }; }
      if (t.startsWith("SELECT tc.tenant_id")) return { rows: working.tenant ? [{ tenant_id: working.tenant.id, primary_company_id: working.company.id }] : [] };
      if (t.startsWith("UPDATE tenants SET status")) { if (working.tenant) working.tenant.status = params[0]; return { rows: [] }; }
      if (t.startsWith("INSERT INTO authorization_audit_log")) {
        if (opts.failAudit) throw new Error("simulated audit insert failure");
        working.audit.push(params); return { rows: [] };
      }
      if (t.startsWith("INSERT INTO tenant_provisioning_audit_logs")) { working.provisioning.push(params); return { rows: [] }; }
      throw new Error(`unexpected query: ${t.slice(0, 80)}`);
    },
    release() { released++; },
  };
  return { pool: { connect: async () => client }, committed: () => committed, released: () => released };
}
const company = (sub: string | null, o: Partial<Company> = {}): State => ({
  company: { id: "co_1", subscription_status: sub, is_demo: false, trial_end: null, gate_override_reason: null, ...o },
  tenant: { id: "t_1", status: "active" }, gate: "active", audit: [], provisioning: [],
});
const ADMIN = { userId: "u_admin", role: "platform_admin" };

async function main() {
  console.log("\n── applyAdminSuspension: authorization + validation ──");
  for (const role of ["platform_auditor", "platform_billing", "admin", null]) {
    const f = fakePool(company("active_paid"));
    const r = await applyAdminSuspension(f.pool, "co_1", {}, { userId: "u", role });
    ok(`role ${role} → 403, nothing written`, !r.ok && r.status === 403 && f.committed().audit.length === 0 && f.committed().company.subscription_status === "active_paid");
  }
  {
    const f = fakePool(company("active_paid"));
    const r = await applyAdminSuspension(f.pool, "co_1", {}, { userId: "", role: "platform_admin" });
    ok("missing actor userId → 403", !r.ok && r.status === 403);
    const r2 = await applyAdminSuspension(f.pool, "co 1;--", {}, ADMIN);
    ok("malformed companyId → 400", !r2.ok && r2.status === 400);
    const r3 = await applyAdminSuspension(f.pool, "co_1", { reason: 5 }, ADMIN);
    const r4 = await applyAdminSuspension(f.pool, "co_1", { reason: "x".repeat(501) }, ADMIN);
    ok("non-string / over-long reason → 400", !r3.ok && r3.status === 400 && !r4.ok && r4.status === 400);
    const r5 = await applyAdminSuspension(f.pool, "co_missing", {}, ADMIN);
    ok("unknown company → 404, connection released", !r5.ok && r5.status === 404 && f.released() === 1);
  }

  console.log("\n── applyAdminSuspension: shared transition policy ──");
  for (const st of ["cancelled", "canceled", "Cancelled"]) {
    const f = fakePool(company(st));
    const r = await applyAdminSuspension(f.pool, "co_1", { reason: "abuse" }, ADMIN);
    ok(`${st} → 409 (cancelled is never softened to reactivatable suspended), nothing written`, !r.ok && r.status === 409 && f.committed().company.subscription_status === st && f.committed().audit.length === 0 && f.committed().gate === "active");
  }
  {
    const f = fakePool(company("active_paid", { gate_override_reason: "integrity-repair: parent" }));
    const r = await applyAdminSuspension(f.pool, "co_1", {}, ADMIN);
    ok("integrity-repair record → 409, untouched", !r.ok && r.status === 409 && f.committed().company.subscription_status === "active_paid" && f.committed().audit.length === 0);
  }
  for (const st of ["active_paid", "trial_active", "grace_period", "past_due", "trial_expired", "pending"]) {
    const f = fakePool(company(st));
    const r = await applyAdminSuspension(f.pool, "co_1", { reason: "chargeback fraud" }, ADMIN);
    ok(`${st} → suspended, statusChanged`, r.ok && r.statusChanged && f.committed().company.subscription_status === "suspended", JSON.stringify(r));
  }
  {
    const f = fakePool(company("trial_active", { is_demo: true }));
    const r = await applyAdminSuspension(f.pool, "co_1", {}, ADMIN);
    ok("demo company may be suspended (restrictive)", r.ok && f.committed().company.subscription_status === "suspended");
  }

  console.log("\n── applyAdminSuspension: audit row fields ──");
  {
    const f = fakePool(company("active_paid"));
    const r = await applyAdminSuspension(f.pool, "co_1", { reason: "  chargeback fraud  " }, ADMIN);
    const c = f.committed();
    const [actorId, changeType, before, note, companyId, tenantId] = c.audit[0] ?? [];
    ok("exactly one authorization_audit_log row", r.ok && c.audit.length === 1);
    ok("who = acting user id", actorId === "u_admin");
    ok("source = admin (change_type admin_suspension + note source=admin)", changeType === ADMIN_SUSPENSION_CHANGE_TYPE && /^source=admin; via=provisioning; role=platform_admin;/.test(note));
    ok("reason recorded (trimmed)", /reason=chargeback fraud$/.test(note), note);
    ok("previous state = active_paid; company + tenant ids", before === "active_paid" && companyId === "co_1" && tenantId === "t_1");
    ok("new state 'suspended' and created_at NOW() are in the INSERT", /VALUES \(\$1, 'companies\.subscription_status', \$2, \$3, 'suspended', \$4, \$5, \$6, NOW\(\)\)/.test(fs.readFileSync("server/tenant-admin-suspension.ts", "utf8")));
    ok("tenants.status mirror → suspended; provisioning gate → suspended; provisioning log row", c.tenant?.status === "suspended" && c.gate === "suspended" && c.provisioning.length === 1 && c.provisioning[0][2] === "u_admin");
  }
  {
    const f = fakePool(company("active_paid"));
    await applyAdminSuspension(f.pool, "co_1", {}, ADMIN);
    ok("no reason → recorded as (none given)", /reason=\(none given\)$/.test(f.committed().audit[0][3]));
  }
  {
    const f = fakePool(company("suspended"));
    const r = await applyAdminSuspension(f.pool, "co_1", { reason: "abuse" }, ADMIN);
    const c = f.committed();
    ok("already suspended (e.g. by billing) → no status write, but an admin_suspension row re-labels the source", r.ok && !r.statusChanged && c.audit.length === 1 && c.audit[0][1] === "admin_suspension" && c.audit[0][2] === "suspended" && c.tenant?.status === "active");
  }
  {
    const f = fakePool(company("active_paid"), { failAudit: true });
    let threw = false;
    try { await applyAdminSuspension(f.pool, "co_1", {}, ADMIN); } catch { threw = true; }
    const c = f.committed();
    ok("audit insert failure → throws, status/gate/mirror rolled back, connection released", threw && c.company.subscription_status === "active_paid" && c.gate === "active" && c.tenant?.status === "active" && f.released() === 1);
  }

  console.log("\n── static: provisioning route + service ──");
  const routes = fs.readFileSync("server/routes.ts", "utf8");
  const svc = fs.readFileSync("server/provisioning/TenantProvisioningService.ts", "utf8");
  const billing = fs.readFileSync("server/billingLifecycle.ts", "utf8");
  ok("POST /api/provisioning/event: requireAuth → requirePlatformAdminRole() → requireCsrfToken", /app\.post\("\/api\/provisioning\/event", requireAuth, requirePlatformAdminRole\(\), requireCsrfToken, async/.test(routes));
  ok("route passes the acting user (id + role) and returns the service's error status", /handleProvisioningEvent\(companyId, event, payload \|\| \{\}, "admin", actor \? \{ userId: actor\.id, role: actor\.role \} : undefined\)/.test(routes) && /if \(!result\.success && result\.status\) return res\.status\(result\.status\)\.json\(result\)/.test(routes));
  ok("tenant.suspended delegates to applyAdminSuspension; no direct companies write left", /case "tenant\.suspended": \{[\s\S]{0,600}applyAdminSuspension\(/.test(svc) && !/subscriptionStatus: "suspended"/.test(svc));
  ok("tenant.suspended without an actor is refused (403)", /if \(!actor\) return \{ success: false, status: 403/.test(svc));

  console.log("\n── static: suspension-source classifier ──");
  ok("admin_suspension is classified as an admin source", /admin_suspension: "admin"/.test(billing));
  ok("legacy provisioning 'tenant.suspended' rows are classified (no backfill needed)", /FROM tenant_provisioning_audit_logs[\s\S]{0,120}event_type = 'tenant\.suspended' AND status = 'success'/.test(billing));
  ok("only a system lifecycle_transition is a billing suspension", /row\.change_type === "lifecycle_transition"\) return row\.actor_user_id === "system" \? "billing" : "admin"/.test(billing));
  ok("Stripe reactivation refuses admin and unknown sources", /if \(source === "admin"\) refused = [\s\S]{0,80}else if \(source !== "billing"\) refused = /.test(billing));

  console.log("\n── guard: every 'suspended' writer is audited ──");
  // Any literal write of subscription_status = 'suspended' must live in a
  // module that writes the matching audited change_type in the same
  // transaction. Parameterized writers (tenant-status-admin, gate override,
  // license service) go through checkSubscriptionTransition / their own
  // audited transactions and are covered by their own tests.
  const ALLOWED = new Set(["server/billingLifecycle.ts", "server/tenant-admin-suspension.ts"]);
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "__tests__" && e.name !== "node_modules") walk(p); continue; }
      if (!/\.ts$/.test(e.name)) continue;
      const src = fs.readFileSync(p, "utf8");
      if (/SET\s+subscription_status\s*=\s*'suspended'/i.test(src) || /\.set\(\{[^}]*subscriptionStatus:\s*["']suspended["']/.test(src)) {
        if (!ALLOWED.has(p.split(path.sep).join("/"))) offenders.push(p);
      }
    }
  };
  walk("server");
  ok("no unaudited companies.subscription_status = 'suspended' writer outside the audited modules", offenders.length === 0, offenders.join(", "));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
