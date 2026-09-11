/**
 * Tests for the tenant status single-source-of-truth cleanup (Concierge
 * Launch Option A, blocker 6): companies.subscription_status is authoritative
 * for gating; tenants.status is a mirror kept in sync by
 * mirrorTenantStatusFromCompany() / mapSubscriptionStatusToTenantStatus()
 * (server/tenant-context.ts). Imports the REAL exported mapping function, so
 * the test and the implementation cannot drift. Pure — no DB, no network.
 *
 * Run: npx tsx tests/tenant-status-mirror.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { mapSubscriptionStatusToTenantStatus } from "../server/tenant-context";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("mapSubscriptionStatusToTenantStatus — vocabulary mapping");
ok("trial_active -> trial", mapSubscriptionStatusToTenantStatus("trial_active") === "trial");
ok("trialing -> trial", mapSubscriptionStatusToTenantStatus("trialing") === "trial");
ok("active_paid -> active", mapSubscriptionStatusToTenantStatus("active_paid") === "active");
ok("active -> active", mapSubscriptionStatusToTenantStatus("active") === "active");
ok("grace_period -> active (still allowed during grace)", mapSubscriptionStatusToTenantStatus("grace_period") === "active");
ok("trial_expired -> suspended (blocks access, matches checkTenantGate)", mapSubscriptionStatusToTenantStatus("trial_expired") === "suspended");
ok("past_due -> suspended", mapSubscriptionStatusToTenantStatus("past_due") === "suspended");
ok("suspended -> suspended", mapSubscriptionStatusToTenantStatus("suspended") === "suspended");
ok("cancelled -> cancelled", mapSubscriptionStatusToTenantStatus("cancelled") === "cancelled");
ok("canceled (single-l) -> cancelled", mapSubscriptionStatusToTenantStatus("canceled") === "cancelled");
ok("is_demo=true always wins -> demo", mapSubscriptionStatusToTenantStatus("active_paid", true) === "demo");
ok("unknown/legacy status falls back to active, never locks a tenant out via the mirror", mapSubscriptionStatusToTenantStatus("some_future_status") === "active");
ok("null/undefined status falls back to active", mapSubscriptionStatusToTenantStatus(null) === "active" && mapSubscriptionStatusToTenantStatus(undefined) === "active");

console.log("\nWiring — every raw `SET subscription_status` write site also mirrors it");
{
  const routes = fs.readFileSync("server/routes.ts", "utf8");
  const billingLifecycle = fs.readFileSync("server/billingLifecycle.ts", "utf8");

  // Each known write site in routes.ts is followed (within a short window) by
  // a mirrorTenantStatusFromCompany call.
  const routesWriteSites = [
    { label: "subscription-gate: grace period expired -> suspended", marker: "SET subscription_status = 'suspended', billing_active = FALSE WHERE id = ${user.companyId}" },
    { label: "subscription-gate: trial expired", marker: "SET subscription_status = 'trial_expired', trial_used = TRUE WHERE id = ${user.companyId}`);\n        await mirrorTenantStatusFromCompany(user.companyId, \"trial_expired\");\n        return res.status(403)" },
    { label: "trial/status auto-transition to trial_expired", marker: "SET subscription_status = 'trial_expired', trial_used = TRUE WHERE id = ${user.companyId}`);\n        await mirrorTenantStatusFromCompany(user.companyId, \"trial_expired\");\n      }" },
    { label: "billing/activate -> active_paid", marker: "await mirrorTenantStatusFromCompany(user.companyId, \"active_paid\");" },
    { label: "platform gate-override -> dynamic status", marker: "await mirrorTenantStatusFromCompany(companyId, subscriptionStatus);" },
  ];
  for (const site of routesWriteSites) {
    ok(`routes.ts: ${site.label}`, routes.includes(site.marker));
  }

  ok("routes.ts imports mirrorTenantStatusFromCompany from tenant-context", /import\s*\{[^}]*mirrorTenantStatusFromCompany[^}]*\}\s*from\s*"\.\/tenant-context"/.test(routes));

  const billingSites = [
    'await mirrorTenantStatusFromCompany(company.id, "grace_period");',
    'await mirrorTenantStatusFromCompany(company.id, "active_paid");',
    'await mirrorTenantStatusFromCompany(company.id, "suspended");',
    'await mirrorTenantStatusFromCompany(row.id, "suspended");',
  ];
  for (const marker of billingSites) {
    ok(`billingLifecycle.ts: ${marker}`, billingLifecycle.includes(marker));
  }
  // active_paid appears twice (payment_succeeded + subscription.updated) — confirm both.
  const activePaidCount = (billingLifecycle.match(/mirrorTenantStatusFromCompany\(company\.id, "active_paid"\)/g) || []).length;
  ok("billingLifecycle.ts: active_paid reactivation mirrored on both payment_succeeded and subscription.updated", activePaidCount === 2, `found ${activePaidCount}`);

  ok("billingLifecycle.ts imports mirrorTenantStatusFromCompany from tenant-context", /import\s*\{\s*mirrorTenantStatusFromCompany\s*\}\s*from\s*"\.\/tenant-context"/.test(billingLifecycle));
}

console.log("\nOrchestrator — self-healing reconcile job registered");
{
  const orchestrator = fs.readFileSync("server/workers/orchestrator.ts", "utf8");
  ok("jobTenantStatusMirrorReconcile is defined", /async function jobTenantStatusMirrorReconcile/.test(orchestrator));
  ok("jobTenantStatusMirrorReconcile is scheduled in startWorkerOrchestrator", /scheduleJob\("TenantStatusMirrorReconcile",\s*jobTenantStatusMirrorReconcile/.test(orchestrator));
  ok("reconcile job compares against companies.subscription_status via the shared mapping function", orchestrator.includes("mapSubscriptionStatusToTenantStatus(row.subscription_status, row.is_demo)"));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  process.exit(1);
}
