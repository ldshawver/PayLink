/**
 * PR-C1 — POST /api/platform/audit/licensing/:companyId/gate-override
 * (platform_super_admin break-glass): authorization, value allowlist, explicit
 * transitions, demo / integrity-repair protection, mandatory audit row, and
 * rollback-on-audit-failure. In-memory fake pg client, no database. The
 * real-Postgres equivalent is tests/tenant-gate-override-db.test.ts.
 *
 * Run: npx tsx tests/tenant-gate-override.test.ts
 */
import fs from "node:fs";
import { applyGateOverride, checkGateOverrideTransition, GATE_OVERRIDE_STATUSES, GATE_OVERRIDE_TRANSITIONS } from "../server/tenant-gate-override";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

type Company = { id: string; subscription_status: string | null; is_demo: boolean; trial_end?: string | null; gate_override_reason: string | null };
type State = { company: Company; tenant: { id: string; status: string } | null; primary: boolean; audit: any[] };
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
        return { rows: params[0] === working.company.id ? [{ ...working.company }] : [] };
      }
      if (t.startsWith("UPDATE companies SET subscription_status")) { working.company.subscription_status = params[0]; working.company.gate_override_reason = params[1]; return { rows: [], rowCount: 1 }; }
      if (t.startsWith("UPDATE companies SET gate_override_reason")) { working.company.gate_override_reason = params[0]; return { rows: [], rowCount: 1 }; }
      if (t.startsWith("SELECT tc.tenant_id")) {
        return { rows: working.tenant ? [{ tenant_id: working.tenant.id, primary_company_id: working.primary ? working.company.id : "other-company" }] : [] };
      }
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

const base = (sub: string | null = "active_paid", extra: Partial<Company> = {}): State => ({
  company: { id: "c1", subscription_status: sub, is_demo: false, trial_end: null, gate_override_reason: null, ...extra },
  tenant: { id: "t1", status: "active" }, primary: true, audit: [],
});
const SA = { userId: "u-sa", role: "platform_super_admin" };
const REASON = "Platform override by super admin";

async function main() {
  console.log("Authorization — platform_super_admin only (service layer)");
  for (const role of ["platform_admin", "platform_auditor", "platform_billing", "platform_support", "tenant_admin", "admin", "manager", "employee", null]) {
    const f = fakePool(base("suspended"));
    const r = await applyGateOverride(f.pool, "c1", { subscriptionStatus: "active_paid", reason: REASON }, { userId: "u1", role });
    ok(`${role ?? "no role"} → 403, no query issued`, !r.ok && r.status === 403 && f.log.length === 0 && f.committed.company.subscription_status === "suspended");
  }
  {
    const f = fakePool(base("suspended"));
    const r = await applyGateOverride(f.pool, "c1", { subscriptionStatus: "active_paid", reason: REASON }, { userId: "", role: "platform_super_admin" });
    ok("super admin role without a user id → 403", !r.ok && r.status === 403 && f.log.length === 0);
  }

  console.log("\nValue allowlist (derived from the Platform Audit UI)");
  ok("accepted values are exactly the UI's six", JSON.stringify([...GATE_OVERRIDE_STATUSES].sort()) === JSON.stringify(["active_paid", "cancelled", "grace", "past_due", "suspended", "trial_active"]));
  const ui = fs.readFileSync("client/src/pages/platform-audit.tsx", "utf8");
  const offered = [...ui.matchAll(/<SelectItem value="([a-z_]+)">\1<\/SelectItem>/g)].map((m) => m[1]);
  ok("every UI-offered override value is accepted by the service", offered.length === 6 && offered.every((v) => (GATE_OVERRIDE_STATUSES as readonly string[]).includes(v)), offered.join(","));
  for (const bad of ["canceled", "active", "trialing", "trial_expired", "grace_period", "demo", "ACTIVE_PAID", " active_paid", "bogus", 1, true, {}, ["active_paid"]]) {
    const f = fakePool(base("suspended"));
    const r = await applyGateOverride(f.pool, "c1", { subscriptionStatus: bad, reason: REASON }, SA);
    ok(`${JSON.stringify(bad)} → 400 before any query`, !r.ok && r.status === 400 && f.log.length === 0);
  }
  for (const id of ["", "../x", "c1; DROP TABLE companies", "a".repeat(65), "c 1"]) {
    const f = fakePool(base());
    const r = await applyGateOverride(f.pool, id, { subscriptionStatus: "suspended", reason: REASON }, SA);
    ok(`malformed company id ${JSON.stringify(id.slice(0, 20))} → 400`, !r.ok && r.status === 400 && f.log.length === 0);
  }

  console.log("\nReason validation");
  for (const [label, reason] of [["missing", undefined], ["blank", "   "], ["null", null]] as const) {
    const f = fakePool(base());
    const r = await applyGateOverride(f.pool, "c1", { subscriptionStatus: "suspended", reason }, SA);
    ok(`status change with ${label} reason → 400`, !r.ok && r.status === 400 && f.log.length === 0);
  }
  {
    const f = fakePool(base());
    const r = await applyGateOverride(f.pool, "c1", { subscriptionStatus: "suspended", reason: "x".repeat(501) }, SA);
    ok("over-long reason → 400", !r.ok && r.status === 400);
  }
  {
    const f = fakePool(base());
    const r = await applyGateOverride(f.pool, "c1", { subscriptionStatus: "suspended", reason: 42 }, SA);
    ok("non-string reason → 400", !r.ok && r.status === 400);
  }
  {
    const f = fakePool(base("active_paid", { is_demo: true }));
    const r = await applyGateOverride(f.pool, "c1", { reason: "Integrity-Repair: keep" }, SA);
    ok("reason may not forge the integrity-repair marker (case-insensitive)", !r.ok && r.status === 400 && f.committed.company.gate_override_reason === null);
  }

  console.log("\nTransitions — reinstatement is explicit, softening is not possible");
  const cases: Array<[string | null, string, boolean]> = [
    ["suspended", "active_paid", true], ["cancelled", "active_paid", true], ["canceled", "active_paid", true],
    ["past_due", "active_paid", true], ["trial_expired", "active_paid", true], ["grace_period", "active_paid", true],
    ["suspended", "trial_active", true],
    // A suspension/cancellation must not be softened into a status the write
    // middleware does not block.
    ["suspended", "past_due", false], ["suspended", "grace", false], ["cancelled", "past_due", false],
    ["cancelled", "grace", false], ["cancelled", "trial_active", false], ["cancelled", "suspended", false],
    ["canceled", "trial_active", false], ["trial_expired", "trial_active", false], ["trial_expired", "grace", false],
    ["active_paid", "trial_active", false],
    // Unknown stored values may only be made more restrictive.
    ["weird_legacy", "active_paid", false], [null, "active_paid", false], ["weird_legacy", "grace", false],
    ["weird_legacy", "suspended", true], [null, "cancelled", true],
    ["active_paid", "grace", true], ["active_paid", "past_due", true], ["grace", "past_due", true], ["past_due", "grace", true],
    ["active_paid", "suspended", true], ["trial_active", "cancelled", true], ["active_paid", "cancelled", true],
  ];
  for (const [from, to, expected] of cases) {
    const r = checkGateOverrideTransition(from, to, false);
    ok(`${from ?? "(null)"} → ${to} ${expected ? "allowed" : "rejected"}`, r.ok === expected);
  }
  ok("same value is a no-op", (() => { const r = checkGateOverrideTransition("suspended", "suspended", false); return r.ok && r.noop; })());
  ok("no target is reachable from 'unknown' except suspended/cancelled", Object.entries(GATE_OVERRIDE_TRANSITIONS).every(([to, from]) => !from.includes("unknown") || to === "suspended" || to === "cancelled"));
  ok("no softening target (past_due/grace/trial_active) reachable from cancelled", ["past_due", "grace", "trial_active"].every((to) => !GATE_OVERRIDE_TRANSITIONS[to as keyof typeof GATE_OVERRIDE_TRANSITIONS].includes("cancelled")));
  ok("past_due and grace not reachable from suspended", !GATE_OVERRIDE_TRANSITIONS.past_due.includes("suspended") && !GATE_OVERRIDE_TRANSITIONS.grace.includes("suspended"));
  {
    const f = fakePool(base("suspended"));
    const r = await applyGateOverride(f.pool, "c1", { subscriptionStatus: "past_due", reason: REASON }, SA);
    ok("rejected transition → 409, rolled back, no audit row", !r.ok && r.status === 409 && f.log.includes("ROLLBACK") && f.committed.company.subscription_status === "suspended" && f.committed.audit.length === 0);
  }

  console.log("\nDemo companies — only suspend / cancel");
  for (const to of ["active_paid", "trial_active", "grace", "past_due"]) {
    ok(`demo → ${to} rejected`, !checkGateOverrideTransition("suspended", to, true).ok && !checkGateOverrideTransition("cancelled", to, true).ok);
  }
  ok("demo → suspended / cancelled allowed", checkGateOverrideTransition("active_paid", "suspended", true).ok && checkGateOverrideTransition("active_paid", "cancelled", true).ok);
  {
    const f = fakePool(base("suspended", { is_demo: true }));
    const r = await applyGateOverride(f.pool, "c1", { subscriptionStatus: "active_paid", reason: REASON }, SA);
    ok("suspended demo cannot be reinstated via override (409)", !r.ok && r.status === 409 && f.committed.company.subscription_status === "suspended");
  }
  {
    const s = base("active_paid", { is_demo: true }); s.tenant!.status = "demo";
    const f = fakePool(s);
    const r = await applyGateOverride(f.pool, "c1", { subscriptionStatus: "suspended", reason: REASON }, SA);
    ok("suspending a demo: mirror reads suspended, is_demo untouched", r.ok && f.committed.tenant!.status === "suspended" && f.committed.company.is_demo === true);
  }

  console.log("\nIntegrity-repair companies are inert");
  {
    const f = fakePool(base("active_paid", { is_demo: true, gate_override_reason: "integrity-repair: parent of 5 rows" }));
    const r1 = await applyGateOverride(f.pool, "c1", { subscriptionStatus: "suspended", reason: REASON }, SA);
    const r2 = await applyGateOverride(f.pool, "c1", { reason: null }, SA);
    ok("status override refused (409), marker kept", !r1.ok && r1.status === 409 && f.committed.company.gate_override_reason === "integrity-repair: parent of 5 rows");
    ok("clearing the reason refused (409), marker kept — no demo-purge eligibility", !r2.ok && r2.status === 409 && f.committed.company.gate_override_reason === "integrity-repair: parent of 5 rows");
    ok("no audit row, nothing committed", f.committed.audit.length === 0 && f.committed.company.subscription_status === "active_paid");
  }

  console.log("\nAudit row + mirror in the same transaction");
  {
    const s = base("suspended", { gate_override_reason: "old reason" }); s.tenant!.status = "suspended";
    const f = fakePool(s);
    const r = await applyGateOverride(f.pool, "c1", { subscriptionStatus: "active_paid", reason: "  Paid by wire 2026-10-21  " }, SA);
    const row = f.committed.audit[0];
    const note = row ? JSON.parse(row.params[4]) : {};
    ok("reinstatement commits", r.ok && r.statusChanged && f.committed.company.subscription_status === "active_paid");
    ok("gate_override_reason stored trimmed", f.committed.company.gate_override_reason === "Paid by wire 2026-10-21");
    ok("tenants.status mirror updated in-transaction to active", f.committed.tenant!.status === "active");
    ok("exactly one gate_override audit row", f.committed.audit.length === 1 && /'gate_override'/.test(row.text));
    ok("audit: actor, target company, previous and new value", row.params[0] === "u-sa" && row.params[1] === "company:c1" && row.params[2] === "suspended" && row.params[3] === "active_paid" && row.params[5] === "c1" && row.params[6] === "t1");
    ok("audit: reason, previous reason and role recorded", note.reason === "Paid by wire 2026-10-21" && note.previousReason === "old reason" && note.role === "platform_super_admin");
    ok("audit: timestamp set explicitly (created_at = NOW())", /created_at\) VALUES .*NOW\(\)\)$/.test(row.text));
    const i = (p: string) => f.log.findIndex((l) => l.startsWith(p));
    ok("BEGIN < company UPDATE < audit INSERT < COMMIT", i("BEGIN") < i("UPDATE companies") && i("UPDATE companies") < i("INSERT INTO authorization_audit_log") && i("INSERT INTO authorization_audit_log") < i("COMMIT"));
    ok("company row read first after BEGIN and locked FOR UPDATE", f.log[1].startsWith("SELECT id, subscription_status") && /FROM companies WHERE id = \$1 FOR UPDATE/.test(fs.readFileSync("server/tenant-gate-override.ts", "utf8")));
    ok("connection released", f.released() === 1);
  }
  {
    const s = base("active_paid"); s.primary = false;
    const f = fakePool(s);
    const r = await applyGateOverride(f.pool, "c1", { subscriptionStatus: "suspended", reason: REASON }, SA);
    ok("non-primary company: company suspended, tenant mirror NOT rewritten", r.ok && f.committed.company.subscription_status === "suspended" && f.committed.tenant!.status === "active" && f.committed.audit.length === 1);
  }
  {
    const s = base("active_paid"); s.tenant = null;
    const f = fakePool(s);
    const r = await applyGateOverride(f.pool, "c1", { subscriptionStatus: "cancelled", reason: REASON }, SA);
    ok("company with no tenant: change + audit (tenant_id null)", r.ok && f.committed.company.subscription_status === "cancelled" && f.committed.audit[0].params[6] === null);
  }
  {
    const f = fakePool(base());
    const r = await applyGateOverride(f.pool, "nope", { subscriptionStatus: "suspended", reason: REASON }, SA);
    ok("unknown company → 404, rolled back", !r.ok && r.status === 404 && f.log.includes("ROLLBACK"));
  }
  {
    const f = fakePool(base("past_due", { gate_override_reason: "x" }));
    const r = await applyGateOverride(f.pool, "c1", { reason: null }, SA);
    ok("reason-only clear is audited (status unchanged)", r.ok && !r.statusChanged && f.committed.company.gate_override_reason === null && f.committed.audit.length === 1 && f.committed.audit[0].params[2] === "past_due" && f.committed.audit[0].params[3] === "past_due");
  }
  {
    const f = fakePool(base("suspended"));
    const r = await applyGateOverride(f.pool, "c1", { subscriptionStatus: "suspended", reason: REASON }, SA);
    ok("same-status save (UI pre-selects current) is a status no-op but audited", r.ok && !r.statusChanged && f.committed.audit.length === 1);
  }

  console.log("\nRollback when the audit insert fails");
  {
    const s = base("suspended", { gate_override_reason: "before" }); s.tenant!.status = "suspended";
    const f = fakePool(s, { failAudit: true });
    let threw = false;
    try { await applyGateOverride(f.pool, "c1", { subscriptionStatus: "active_paid", reason: REASON }, SA); } catch { threw = true; }
    ok("failure propagates (route returns 500)", threw);
    ok("subscription_status NOT changed", f.committed.company.subscription_status === "suspended");
    ok("gate_override_reason NOT changed", f.committed.company.gate_override_reason === "before");
    ok("tenants.status mirror NOT changed", f.committed.tenant!.status === "suspended");
    ok("ROLLBACK issued, no COMMIT, connection released", f.log.includes("ROLLBACK") && !f.log.includes("COMMIT") && f.released() === 1);
  }

  console.log("\nRoute wiring (static)");
  const routes = fs.readFileSync("server/routes.ts", "utf8");
  const m = routes.match(/app\.post\("\/api\/platform\/audit\/licensing\/:companyId\/gate-override",[\s\S]*?\n {2}\}\);/);
  ok("route guarded by requirePlatformAudit", !!m && /gate-override", requirePlatformAudit, async/.test(m[0]));
  ok("route delegates to applyGateOverride with the session user's role", !!m && /applyGateOverride\(db\.\$client[\s\S]*role: \(req as any\)\.user\?\.role/.test(m[0]));
  ok("route performs no direct SQL write and no best-effort mirror", !!m && !/UPDATE companies/.test(m[0]) && !/mirrorTenantStatusFromCompany/.test(m[0]));
  ok("route does not echo raw DB error messages", !!m && !/e\?\.message \|\|/.test(m[0]));
  const guard = routes.match(/function requirePlatformAudit\([\s\S]*?\n {2}\}/);
  ok("requirePlatformAudit checks platform_super_admin on both branches", !!guard && (guard[0].match(/role !== "platform_super_admin"/g) || []).length === 2);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
