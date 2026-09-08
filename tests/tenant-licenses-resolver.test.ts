/**
 * Behavioural tests for the shared license resolver
 * (server/licensing/license-resolver.ts). PR 4 — SaaS tenant licenses
 * (migration 0022).
 *
 * These import and call the REAL exported functions the routes and the narrow
 * gate use, so the test and the implementation cannot drift. Pure — no DB, no
 * network.
 *
 * Key guarantees pinned here:
 *   - a company with NO tenant_licenses row is never gate-blocked by PR 4,
 *     regardless of its legacy company state;
 *   - only an EXPLICIT tenant_licenses record can make the narrow gate block;
 *   - fallback precedence is record → company_gate → legacy-active.
 *
 * Run: npx tsx tests/tenant-licenses-resolver.test.ts
 */
import {
  resolveLicense,
  normalizeCompanyStatus,
  normalizeLicenseStatus,
  BLOCKING_LICENSE_STATUSES,
  LICENSE_STATUSES,
} from "../server/licensing/license-resolver";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const NOW = new Date("2026-06-15T00:00:00Z");
const future = new Date("2026-07-15T00:00:00Z").toISOString();
const past = new Date("2026-05-15T00:00:00Z").toISOString();

console.log("legacy / missing tenant_licenses row — never gate-blocked by PR 4");
{
  const r = resolveLicense(null, null, NOW);
  ok("no record + no company → legacy-active default", r.effectiveStatus === "active" && r.source === "legacy_default", JSON.stringify(r));
  ok("no record → isLegacy true, hasLicenseRecord false", r.isLegacy && !r.hasLicenseRecord);
  ok("no record → narrow gate never blocks", r.gateBlocks === false);
}
{
  const r = resolveLicense(null, { subscriptionStatus: "active_paid" }, NOW);
  ok("no record + company active_paid → company_gate active", r.effectiveStatus === "active" && r.source === "company_gate");
  ok("no record + company active_paid → gate does not block", r.gateBlocks === false);
}
{
  // The critical safety case: an existing SUSPENDED company with no license row.
  const r = resolveLicense(null, { subscriptionStatus: "suspended" }, NOW);
  ok("no record + company suspended → effectiveStatus reflects company (suspended)", r.effectiveStatus === "suspended" && r.source === "company_gate", JSON.stringify(r));
  ok("no record + company suspended → PR4 narrow gate STILL does not block (legacy)", r.gateBlocks === false);
  ok("no record + company suspended → isLegacy true", r.isLegacy);
}
{
  const r = resolveLicense(null, { subscriptionStatus: "trial_expired" }, NOW);
  ok("no record + company trial_expired → expired, not gate-blocked", r.effectiveStatus === "expired" && r.gateBlocks === false);
}
{
  const r = resolveLicense(null, { subscriptionStatus: "weird_unknown_value" }, NOW);
  ok("no record + unknown company status → falls to active (never invents a block)", r.effectiveStatus === "active" && r.gateBlocks === false);
}
{
  const r = resolveLicense(null, { isDemo: true, subscriptionStatus: "suspended" }, NOW);
  ok("no record + is_demo → active regardless of subscription_status", r.effectiveStatus === "active" && r.gateBlocks === false);
}

console.log("\nexplicit tenant_licenses record — the only thing that can block the narrow gate");
{
  const r = resolveLicense({ status: "active", planType: "pro" }, { subscriptionStatus: "trial_active" }, NOW);
  ok("record present → record wins over company_gate", r.effectiveStatus === "active" && r.source === "tenant_licenses");
  ok("record active → not gate-blocked", r.gateBlocks === false);
  ok("record plan surfaces", r.planType === "pro");
}
for (const s of ["expired", "suspended", "cancelled", "inactive"]) {
  const r = resolveLicense({ status: s }, { subscriptionStatus: "active_paid" }, NOW);
  ok(`record status '${s}' → effectiveStatus '${s}' and narrow gate BLOCKS`, r.effectiveStatus === s && r.gateBlocks === true, JSON.stringify(r));
  ok(`record status '${s}' → hasLicenseRecord true, isLegacy false`, r.hasLicenseRecord && !r.isLegacy);
}
{
  const r = resolveLicense({ status: "trialing", trialEnd: future }, null, NOW);
  ok("record trialing + future trial_end → trialing, not blocked", r.effectiveStatus === "trialing" && r.gateBlocks === false);
  ok("record trialing → trial.daysRemaining is positive", (r.trial.daysRemaining ?? -1) > 0 && r.trial.isTrial);
}
{
  const r = resolveLicense({ status: "trialing", trialEnd: past }, null, NOW);
  ok("record trialing + PAST trial_end → effective 'expired' and gate BLOCKS", r.effectiveStatus === "expired" && r.gateBlocks === true, JSON.stringify(r));
}
{
  const r = resolveLicense({ status: "garbage_status" }, { subscriptionStatus: "active_paid" }, NOW);
  ok("record with unrecognized status → normalized to 'inactive' (conservative) and blocks", r.effectiveStatus === "inactive" && r.gateBlocks === true);
}

console.log("\nnormalization helpers");
ok("BLOCKING_LICENSE_STATUSES = expired/suspended/cancelled/inactive",
  JSON.stringify([...BLOCKING_LICENSE_STATUSES].sort()) === JSON.stringify(["cancelled", "expired", "inactive", "suspended"]));
ok("'active' is NOT a blocking status", !BLOCKING_LICENSE_STATUSES.includes("active" as any));
ok("'trialing' is NOT a blocking status", !BLOCKING_LICENSE_STATUSES.includes("trialing" as any));
ok("LICENSE_STATUSES has exactly the 6 documented values",
  JSON.stringify([...LICENSE_STATUSES].sort()) === JSON.stringify(["active", "cancelled", "expired", "inactive", "suspended", "trialing"]));
ok("normalizeCompanyStatus: active_paid → active", normalizeCompanyStatus("active_paid") === "active");
ok("normalizeCompanyStatus: trial_active → trialing", normalizeCompanyStatus("trial_active") === "trialing");
ok("normalizeCompanyStatus: trial_expired → expired", normalizeCompanyStatus("trial_expired") === "expired");
ok("normalizeCompanyStatus: grace_period → active (legacy gate still governs grace)", normalizeCompanyStatus("grace_period") === "active");
ok("normalizeCompanyStatus: canceled/cancelled → cancelled", normalizeCompanyStatus("canceled") === "cancelled" && normalizeCompanyStatus("cancelled") === "cancelled");
ok("normalizeCompanyStatus: unknown → active (never a spurious block)", normalizeCompanyStatus("anything-else") === "active");
ok("normalizeCompanyStatus: null → active", normalizeCompanyStatus(null) === "active");
ok("normalizeLicenseStatus: passes through the 6 values", LICENSE_STATUSES.every((s) => normalizeLicenseStatus(s) === s));
ok("normalizeLicenseStatus: trial_active → trialing", normalizeLicenseStatus("trial_active") === "trialing");
ok("normalizeLicenseStatus: unknown → inactive (conservative for an explicit record)", normalizeLicenseStatus("mystery") === "inactive");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
