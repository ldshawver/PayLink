/**
 * Organization Ownership Guard Tests — server/__tests__/org-ownership-guard.test.ts
 *
 * Run with:  npx tsx server/__tests__/org-ownership-guard.test.ts
 *
 * Exercises the REAL decision functions from server/auth/org-ownership-guard.ts
 * (SaaS PR 1): platform-role bypass lists, org-hierarchy create/mutate
 * decisions (stored-owner authorization, universal rows, reassignment), and
 * the tenant-safe company PATCH allowlist that closes the enterprise-hop
 * takeover and billing self-upgrade.
 *
 * Pure — no database. Exit code 0 = all pass, 1 = failures.
 */

import assert from "node:assert/strict";
import {
  isPlatformCompanyBypassRole, isPlatformOrgAdminRole, normalizeRequestedCompanyId,
  evaluateOrgCreate, evaluateOrgMutation, filterTenantCompanyPatch, TENANT_EDITABLE_COMPANY_FIELDS,
} from "../auth/org-ownership-guard.js";

let passed = 0;
let failed = 0;
const errors: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗  ${name}`);
    console.error(`       ${err.message}`);
    errors.push(`${name}: ${err.message}`);
    failed++;
  }
}

const A1 = "company-a1", A2 = "company-a2", B1 = "company-b1";

console.log("\n── Platform role lists ─────────────────────────────────────────────────");
test("platform_super_admin / platform_admin / platform_owner bypass and administer org", () => {
  for (const r of ["platform_super_admin", "platform_admin", "platform_owner"]) {
    assert.equal(isPlatformCompanyBypassRole(r), true);
    assert.equal(isPlatformOrgAdminRole(r), true);
  }
});
test("platform_support bypasses reads but cannot administer universal rows", () => {
  assert.equal(isPlatformCompanyBypassRole("platform_support"), true);
  assert.equal(isPlatformOrgAdminRole("platform_support"), false);
});
test("tenant roles, null and unknown platform_* strings are NOT platform", () => {
  for (const r of ["admin", "tenant_owner", "tenant_admin", "manager", "employee", "", null, undefined, "platform_anything", "Platform_admin"]) {
    assert.equal(isPlatformCompanyBypassRole(r as any), false, String(r));
    assert.equal(isPlatformOrgAdminRole(r as any), false, String(r));
  }
});

console.log("\n── normalizeRequestedCompanyId ─────────────────────────────────────────");
test("undefined stays undefined (field not supplied)", () => assert.equal(normalizeRequestedCompanyId(undefined), undefined));
test("null / '' / __universal__ → null", () => {
  for (const v of [null, "", "__universal__"]) assert.equal(normalizeRequestedCompanyId(v), null);
});
test("non-string values are ignored", () => assert.equal(normalizeRequestedCompanyId(42), undefined));

console.log("\n── evaluateOrgCreate ───────────────────────────────────────────────────");
test("tenant: omitted/universal company resolves to OWN company, never NULL", () => {
  const d = evaluateOrgCreate({ isPlatformOrgAdmin: false, actorCompanyId: A1, requestedCompanyId: null, requestedCompanyAccessible: false });
  assert.deepEqual([d.allowed, d.companyId], [true, A1]);
  const d2 = evaluateOrgCreate({ isPlatformOrgAdmin: false, actorCompanyId: A1, requestedCompanyId: undefined, requestedCompanyAccessible: false });
  assert.deepEqual([d2.allowed, d2.companyId], [true, A1]);
});
test("tenant: foreign company → 403", () => {
  const d = evaluateOrgCreate({ isPlatformOrgAdmin: false, actorCompanyId: A1, requestedCompanyId: B1, requestedCompanyAccessible: false });
  assert.deepEqual([d.allowed, d.status], [false, 403]);
});
test("tenant: explicitly accessible company → allowed into that company", () => {
  const d = evaluateOrgCreate({ isPlatformOrgAdmin: false, actorCompanyId: A1, requestedCompanyId: A2, requestedCompanyAccessible: true });
  assert.deepEqual([d.allowed, d.companyId], [true, A2]);
});
test("companyless tenant user → 403 even for a named company", () => {
  const d = evaluateOrgCreate({ isPlatformOrgAdmin: false, actorCompanyId: null, requestedCompanyId: B1, requestedCompanyAccessible: false });
  assert.deepEqual([d.allowed, d.status], [false, 403]);
});
test("platform org admin may create universal rows", () => {
  const d = evaluateOrgCreate({ isPlatformOrgAdmin: true, actorCompanyId: null, requestedCompanyId: null, requestedCompanyAccessible: false });
  assert.deepEqual([d.allowed, d.companyId], [true, null]);
});

console.log("\n── evaluateOrgMutation ─────────────────────────────────────────────────");
test("tenant: row in own company, companyId not supplied → allowed, company unchanged", () => {
  const d = evaluateOrgMutation({ isPlatformOrgAdmin: false, storedCompanyId: A1, storedCompanyAccessible: true });
  assert.deepEqual([d.allowed, d.companyId], [true, A1]);
});
test("tenant: row in another tenant's company → 404 (no existence oracle)", () => {
  const d = evaluateOrgMutation({ isPlatformOrgAdmin: false, storedCompanyId: B1, storedCompanyAccessible: false });
  assert.deepEqual([d.allowed, d.status], [false, 404]);
});
test("tenant: body companyId of OWN company cannot authorize a foreign row", () => {
  const d = evaluateOrgMutation({ isPlatformOrgAdmin: false, storedCompanyId: B1, storedCompanyAccessible: false, requestedCompanyId: A1, requestedCompanyAccessible: true });
  assert.equal(d.allowed, false);
});
test("tenant: universal row → 403", () => {
  const d = evaluateOrgMutation({ isPlatformOrgAdmin: false, storedCompanyId: null, storedCompanyAccessible: false });
  assert.deepEqual([d.allowed, d.status], [false, 403]);
});
test("tenant: re-parent own row to universal (null) → 403", () => {
  const d = evaluateOrgMutation({ isPlatformOrgAdmin: false, storedCompanyId: A1, storedCompanyAccessible: true, requestedCompanyId: null });
  assert.deepEqual([d.allowed, d.status], [false, 403]);
});
test("tenant: reassign own row to another accessible company → 403", () => {
  const d = evaluateOrgMutation({ isPlatformOrgAdmin: false, storedCompanyId: A1, storedCompanyAccessible: true, requestedCompanyId: A2, requestedCompanyAccessible: true });
  assert.deepEqual([d.allowed, d.status], [false, 403]);
});
test("tenant: echoing the stored companyId is not a reassignment", () => {
  const d = evaluateOrgMutation({ isPlatformOrgAdmin: false, storedCompanyId: A1, storedCompanyAccessible: true, requestedCompanyId: A1 });
  assert.equal(d.allowed, true);
});
test("platform org admin may manage universal rows and reassign", () => {
  assert.equal(evaluateOrgMutation({ isPlatformOrgAdmin: true, storedCompanyId: null, storedCompanyAccessible: false }).allowed, true);
  const d = evaluateOrgMutation({ isPlatformOrgAdmin: true, storedCompanyId: A1, storedCompanyAccessible: false, requestedCompanyId: null });
  assert.deepEqual([d.allowed, d.companyId], [true, null]);
});

console.log("\n── filterTenantCompanyPatch ────────────────────────────────────────────");
const stored = {
  id: A1, name: "Co", enterpriseId: null, subscriptionStatus: "trial_active", isDemo: false,
  billingActive: false, trialEnd: new Date("2026-10-01T00:00:00Z"), planName: "starter", timezone: "UTC",
};
test("allowlisted fields pass through", () => {
  const r = filterTenantCompanyPatch({ name: "New", timezone: "America/Chicago" }, stored);
  assert.equal(r.allowed, true);
  assert.deepEqual(r.data, { name: "New", timezone: "America/Chicago" });
});
test("enterpriseId change (takeover entry point) → 403", () => {
  const r = filterTenantCompanyPatch({ enterpriseId: "victim-enterprise" }, stored);
  assert.deepEqual([r.allowed, r.status, r.rejectedFields], [false, 403, ["enterpriseId"]]);
});
test("subscription / billing / demo / trial self-upgrade → 403, nothing written", () => {
  const r = filterTenantCompanyPatch({ name: "ok", subscriptionStatus: "active_paid", isDemo: true, billingActive: true, trialEnd: "2099-01-01T00:00:00Z" }, stored);
  assert.equal(r.allowed, false);
  assert.deepEqual(r.rejectedFields, ["billingActive", "isDemo", "subscriptionStatus", "trialEnd"]);
  assert.equal(r.data, undefined);
});
test("unchanged echo of control fields (settings form) is dropped, not rejected", () => {
  const r = filterTenantCompanyPatch({ id: A1, name: "N", subscriptionStatus: "trial_active", isDemo: false, enterpriseId: null, trialEnd: "2026-10-01T00:00:00.000Z", createdAt: "x" }, stored);
  assert.equal(r.allowed, true);
  assert.deepEqual(r.data, { name: "N" });
});
test("unknown / Stripe / lifecycle fields → 403", () => {
  const r = filterTenantCompanyPatch({ stripeFinancialAccountId: "fa_1", gracePeriodEnd: "2099-01-01" }, stored);
  assert.deepEqual(r.rejectedFields, ["gracePeriodEnd", "stripeFinancialAccountId"]);
});
test("allowlist contains no ownership/billing/lifecycle field", () => {
  for (const f of ["enterpriseId", "subscriptionStatus", "planName", "trialStart", "trialEnd", "trialUsed",
    "billingActive", "paymentMethodOnFile", "isDemo", "stripeFinancialAccountId", "id", "createdAt"]) {
    assert.equal(TENANT_EDITABLE_COMPANY_FIELDS.has(f), false, f);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
