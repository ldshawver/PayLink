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
      if (t.startsWith("SELECT is_demo FROM companies")) return { rows: [{ is_demo: working.company.is_demo }] };
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

  console.log("\nRoute wiring (static)");
  const routes = fs.readFileSync("server/routes.ts", "utf8");
  ok("PATCH /api/tenants/:id uses requirePlatformAdminRole()", /app\.patch\("\/api\/tenants\/:id",\s*requireAuth,\s*requirePlatformAdminRole\(\)/.test(routes));
  ok("PATCH /api/tenants/:id delegates to applyTenantPatch", /app\.patch\("\/api\/tenants\/:id"[\s\S]{0,400}applyTenantPatch\(db\.\$client/.test(routes));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
