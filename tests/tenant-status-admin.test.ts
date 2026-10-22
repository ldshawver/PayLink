/**
 * PR-C1 — PATCH /api/tenants/:id authorization, transition validation,
 * mandatory audit row, and rollback-on-audit-failure. Uses an in-memory fake
 * pg client that records every statement, so it runs in the required suite
 * with no database. The real-Postgres equivalent is
 * tests/tenant-status-admin-db.test.ts.
 *
 * Run: npx tsx tests/tenant-status-admin.test.ts
 */
import fs from "node:fs";
import { applyTenantPatch, checkTenantStatusTransition, TENANT_STATUS_TRANSITIONS } from "../server/tenant-status-admin";
import { mapSubscriptionStatusToTenantStatus } from "../server/tenant-context";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

type State = { tenant: any; company: any };
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
      if (t.startsWith("SELECT * FROM tenants")) return { rows: params[0] === working.tenant.id ? [{ ...working.tenant }] : [] };
      if (t.startsWith("SELECT company_id FROM tenant_companies")) return { rows: working.company ? [{ company_id: working.company.id }] : [] };
      if (t.startsWith("SELECT subscription_status, is_demo, trial_end FROM companies")) return { rows: [{ subscription_status: working.company.subscription_status, is_demo: working.company.is_demo, trial_end: working.company.trial_end ?? null }] };
      if (t.startsWith("UPDATE companies SET subscription_status")) { working.company.subscription_status = params[0]; return { rows: [] }; }
      if (t.startsWith("UPDATE tenants SET status")) { working.tenant.status = params[0]; return { rows: [] }; }
      if (t.startsWith("UPDATE tenants SET name")) {
        const cols = ["name", "billing_contact_name", "billing_contact_email", "default_timezone", "notes", "stripe_customer_id"];
        cols.forEach((c, i) => { if (params[i] != null) working.tenant[c] = params[i]; });
        return { rows: [{ ...working.tenant }] };
      }
      if (t.startsWith("INSERT INTO authorization_audit_log")) {
        if (opts.failAudit) throw new Error("simulated audit insert failure");
        (working as any).audit = [...((working as any).audit || []), { changeType: t.includes("tenant_status_change") ? "tenant_status_change" : "tenant_record_update", params }];
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${t}`);
    },
    release() { released++; },
  };
  return { pool: { connect: async () => client }, committed, log, released: () => released };
}

const base = (): State => ({
  tenant: { id: "t1", status: "active", name: "Acme", billing_contact_email: "billing@example.test" },
  company: { id: "c1", subscription_status: "active_paid", is_demo: false },
});

async function main() {
  console.log("Authorization — only platform_super_admin / platform_admin");
  for (const role of ["platform_auditor", "platform_sales", "platform_support", "platform_billing", "platform_implementation", "tenant_admin", "tenant_owner", "admin", "employee", null]) {
    const f = fakePool(base());
    const r = await applyTenantPatch(f.pool, "t1", { status: "suspended" }, { userId: "u1", role });
    ok(`${role ?? "no role"} is rejected with 403 and nothing is touched`, !r.ok && r.status === 403 && f.log.length === 0 && f.committed.tenant.status === "active");
  }
  for (const role of ["platform_super_admin", "platform_admin"]) {
    const f = fakePool(base());
    const r = await applyTenantPatch(f.pool, "t1", { status: "suspended" }, { userId: "u-admin", role });
    ok(`${role} can suspend an active tenant`, r.ok && f.committed.tenant.status === "suspended" && f.committed.company.subscription_status === "suspended");
  }

  console.log("\nAudit row in the same transaction");
  {
    const f = fakePool(base());
    await applyTenantPatch(f.pool, "t1", { status: "cancelled" }, { userId: "u-admin", role: "platform_admin" });
    const audit = (f.committed as any).audit || [];
    const row = audit.find((a: any) => a.changeType === "tenant_status_change");
    ok("status change writes exactly one tenant_status_change audit row", audit.filter((a: any) => a.changeType === "tenant_status_change").length === 1);
    ok("audit row records actor, before and after status", row && row.params[0] === "u-admin" && row.params[2] === "active" && row.params[3] === "cancelled");
    ok("audit insert happens between BEGIN and COMMIT", f.log.indexOf("BEGIN") < f.log.findIndex((l) => l.startsWith("INSERT INTO authorization_audit_log")) && f.log.findIndex((l) => l.startsWith("INSERT INTO authorization_audit_log")) < f.log.indexOf("COMMIT"));
    ok("connection is released", f.released() === 1);
  }
  {
    const f = fakePool(base());
    await applyTenantPatch(f.pool, "t1", { billingContactEmail: "new-billing@example.test" }, { userId: "u-admin", role: "platform_admin" });
    const audit = (f.committed as any).audit || [];
    ok("non-status edit writes a tenant_record_update row naming the field", audit.length === 1 && audit[0].changeType === "tenant_record_update" && audit[0].params[2] === "billingContactEmail");
    ok("audit row never contains the PII value", !JSON.stringify(audit).includes("new-billing@example.test"));
  }

  console.log("\nRollback when the audit insert fails");
  {
    const f = fakePool(base(), { failAudit: true });
    let threw = false;
    try { await applyTenantPatch(f.pool, "t1", { status: "suspended" }, { userId: "u-admin", role: "platform_super_admin" }); } catch { threw = true; }
    ok("failure propagates (route returns 500)", threw);
    ok("tenant status is NOT changed", f.committed.tenant.status === "active");
    ok("company subscription_status is NOT changed", f.committed.company.subscription_status === "active_paid");
    ok("ROLLBACK issued and connection released", f.log.includes("ROLLBACK") && !f.log.includes("COMMIT") && f.released() === 1);
  }

  console.log("\nTransition validation");
  const cases: Array<[string, string, boolean]> = [
    ["trial", "active", true], ["active", "suspended", true], ["suspended", "active", true], ["cancelled", "active", true],
    ["active", "trial", false], ["cancelled", "suspended", false], ["active", "demo", false], ["trial", "demo", false],
    ["demo", "active", false], ["demo", "trial", false], ["demo", "suspended", true], ["demo", "cancelled", true],
    ["weird_legacy", "active", false], ["weird_legacy", "suspended", true], ["", "trial", false],
  ];
  for (const [from, to, expected] of cases) {
    const r = checkTenantStatusTransition(from, to);
    ok(`${from || "(empty)"} → ${to} ${expected ? "allowed" : "rejected"}`, r.ok === expected);
  }
  ok("unknown target status rejected", !checkTenantStatusTransition("active", "canceled").ok && !checkTenantStatusTransition("active", "past_due").ok);
  ok("no transition table entry targets demo", Object.values(TENANT_STATUS_TRANSITIONS).every((t) => !t.includes("demo")));
  {
    const f = fakePool(base());
    const r = await applyTenantPatch(f.pool, "t1", { status: "trial" }, { userId: "u-admin", role: "platform_admin" });
    ok("disallowed transition returns 409 and rolls back", !r.ok && r.status === 409 && f.log.includes("ROLLBACK") && f.committed.tenant.status === "active");
  }
  {
    const s = base(); s.tenant.status = "suspended"; s.company.is_demo = true; s.company.subscription_status = "suspended";
    const f = fakePool(s);
    const r = await applyTenantPatch(f.pool, "t1", { status: "active" }, { userId: "u-admin", role: "platform_admin" });
    ok("a suspended demo tenant cannot be promoted to active", !r.ok && r.status === 409 && f.committed.tenant.status === "suspended");
  }
  {
    const f = fakePool(base());
    const r = await applyTenantPatch(f.pool, "t1", { status: "bogus" }, { userId: "u-admin", role: "platform_admin" });
    ok("invalid status → 400 before any query", !r.ok && r.status === 400 && f.log.length === 0);
  }
  {
    const f = fakePool(base());
    const r = await applyTenantPatch(f.pool, "nope", { status: "suspended" }, { userId: "u-admin", role: "platform_admin" });
    ok("unknown tenant → 404", !r.ok && r.status === 404);
  }
  {
    const f = fakePool(base());
    await applyTenantPatch(f.pool, "t1", { status: "active" }, { userId: "u-admin", role: "platform_admin" });
    ok("same-status PATCH is a no-op with no status audit row", !((f.committed as any).audit || []).some((a: any) => a.changeType === "tenant_status_change"));
  }

  {
    const s = base(); s.tenant.status = "demo"; s.company.is_demo = true; s.company.subscription_status = "trial_active";
    const f = fakePool(s);
    const r = await applyTenantPatch(f.pool, "t1", { status: "demo", name: "Renamed demo" }, { userId: "u-admin", role: "platform_admin" });
    ok("editing a demo tenant's name while re-sending status=demo succeeds as a status no-op", r.ok && f.committed.tenant.status === "demo" && f.committed.tenant.name === "Renamed demo" && f.committed.company.subscription_status === "trial_active");
  }

  console.log("\nDemo status — enforcement always wins over demo classification");
  const past = new Date(Date.now() - 3600_000).toISOString();
  const future = new Date(Date.now() + 3600_000).toISOString();
  const mapCases: Array<[string | null, boolean, string | null, string]> = [
    ["active_paid", true, null, "demo"], ["active_paid", true, future, "demo"], ["trial_active", true, future, "demo"],
    ["suspended", true, future, "suspended"], ["past_due", true, future, "suspended"], ["trial_expired", true, null, "suspended"],
    ["cancelled", true, future, "cancelled"], ["canceled", true, null, "cancelled"],
    ["active_paid", true, past, "suspended"], [null, true, past, "suspended"],
    ["active_paid", false, past, "active"], ["trial_active", false, null, "trial"], ["suspended", false, null, "suspended"], ["cancelled", false, null, "cancelled"],
  ];
  for (const [sub, demo, end, expected] of mapCases) {
    const got = mapSubscriptionStatusToTenantStatus(sub, demo, end);
    ok(`${demo ? "demo" : "non-demo"} ${sub ?? "(null)"}${end ? (end === past ? " expired" : " unexpired") : ""} → ${expected}`, got === expected, `got ${got}`);
  }
  {
    const s = base(); s.tenant.status = "demo"; s.company.is_demo = true; s.company.trial_end = future;
    const f = fakePool(s);
    const r = await applyTenantPatch(f.pool, "t1", { status: "suspended" }, { userId: "u-admin", role: "platform_admin" });
    const row = ((f.committed as any).audit || []).find((a: any) => a.changeType === "tenant_status_change");
    ok("suspending an active demo: company suspended, is_demo kept, mirror reads suspended (not demo)", r.ok && f.committed.company.subscription_status === "suspended" && f.committed.company.is_demo === true && f.committed.tenant.status === "suspended");
    ok("demo suspend audit row records demo → suspended", row && row.params[2] === "demo" && row.params[3] === "suspended");
  }
  {
    const s = base(); s.tenant.status = "demo"; s.company.is_demo = true;
    const f = fakePool(s);
    const r = await applyTenantPatch(f.pool, "t1", { status: "cancelled" }, { userId: "u-admin", role: "platform_super_admin" });
    ok("cancelling a demo: mirror reads cancelled", r.ok && f.committed.tenant.status === "cancelled" && f.committed.company.subscription_status === "cancelled");
  }
  {
    // Stale mirror from before this fix: tenants.status still "demo" while the
    // company is suspended. The console now shows "suspended", and its edit
    // dialog re-sends that — it must be a status no-op, not a new change.
    const s = base(); s.tenant.status = "demo"; s.company.is_demo = true; s.company.subscription_status = "suspended";
    const f = fakePool(s);
    const r = await applyTenantPatch(f.pool, "t1", { status: "suspended", notes: "note" }, { userId: "u-admin", role: "platform_admin" });
    ok("stale-mirror suspended demo: re-sending suspended is a no-op (validated against effective status)", r.ok && !((f.committed as any).audit || []).some((a: any) => a.changeType === "tenant_status_change"));
    const r2 = await applyTenantPatch(f.pool, "t1", { status: "active" }, { userId: "u-admin", role: "platform_admin" });
    ok("stale-mirror suspended demo still cannot be promoted to active", !r2.ok && r2.status === 409 && f.committed.company.subscription_status === "suspended");
  }
  {
    const s = base(); s.tenant.status = "demo"; s.company.is_demo = true; s.company.trial_end = past;
    const f = fakePool(s);
    const r = await applyTenantPatch(f.pool, "t1", { status: "suspended", name: "Old demo" }, { userId: "u-admin", role: "platform_admin" });
    ok("expired demo is effectively suspended: name edit re-sending suspended is a status no-op", r.ok && f.committed.company.subscription_status === "active_paid" && f.committed.tenant.name === "Old demo" && !((f.committed as any).audit || []).some((a: any) => a.changeType === "tenant_status_change"));
    const r2 = await applyTenantPatch(f.pool, "t1", { status: "active" }, { userId: "u-admin", role: "platform_admin" });
    ok("expired demo cannot be reactivated through this route", !r2.ok && r2.status === 409);
  }

  console.log("\nRoute wiring (static)");
  const routes = fs.readFileSync("server/routes.ts", "utf8");
  ok("PATCH /api/tenants/:id uses requirePlatformAdminRole()", /app\.patch\("\/api\/tenants\/:id",\s*requireAuth,\s*requirePlatformAdminRole\(\)/.test(routes));
  ok("PATCH /api/tenants/:id delegates to applyTenantPatch", /app\.patch\("\/api\/tenants\/:id"[\s\S]{0,400}applyTenantPatch\(db\.\$client/.test(routes));

  const enforcement = fs.readFileSync("server/tenant-enforcement.ts", "utf8");
  ok("checkTenantGate no longer short-circuits every demo to allowed", !/if \(c\.is_demo\) return \{ allowed: true \}/.test(enforcement));
  ok("checkTenantGate allows a demo only when its effective status is demo", /mapSubscriptionStatusToTenantStatus\(c\.subscription_status, true, c\.trial_end\)[\s\S]{0,80}if \(demoStatus === "demo"\) return \{ allowed: true \}/.test(enforcement));
  const orchestrator = fs.readFileSync("server/workers/orchestrator.ts", "utf8");
  ok("mirror reconcile passes trial_end so it agrees with the write path", /mapSubscriptionStatusToTenantStatus\(row\.subscription_status, row\.is_demo, row\.trial_end\)/.test(orchestrator));
  const listMatch = routes.match(/app\.get\("\/api\/tenants",[\s\S]*?\n {2}\}\);/);
  const detailMatch = routes.match(/app\.get\("\/api\/tenants\/:id",[\s\S]*?\n {2}\}\);/);
  ok("GET /api/tenants returns the effective status from the primary company", !!listMatch && /mapSubscriptionStatusToTenantStatus\(r\.primary_subscription_status, r\.primary_is_demo === true, r\.primary_trial_end\)/.test(listMatch[0]) && !/status: r\.status,/.test(listMatch[0]));
  ok("GET /api/tenants/:id returns the effective status from the primary company", !!detailMatch && /status: effectiveStatus/.test(detailMatch[0]) && /c\.is_demo, c\.trial_end/.test(detailMatch[0]));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
