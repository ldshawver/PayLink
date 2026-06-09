/**
 * User Provisioning Guard Tests — server/__tests__/user-provisioning-guard.test.ts
 *
 * Run with:  npx tsx server/__tests__/user-provisioning-guard.test.ts
 *
 * Exercises the REAL production decision function from
 * server/auth/user-provisioning-guard.ts — the guard that protects
 * `POST /api/users` and `PATCH /api/users/:id` against the CRITICAL
 * privilege-escalation / cross-tenant vulnerability.
 *
 * No database required: the decision function is pure; the route handler
 * supplies the DB-resolved facts (requestor, target, company accessibility).
 *
 * Exit code 0 = all tests pass. Exit code 1 = one or more failed.
 */

import assert from "node:assert/strict";
import { evaluateUserProvisioning } from "../auth/user-provisioning-guard.js";

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

const TENANT_ADMIN = { role: "tenant_admin", companyId: "company-A" };
const LEGACY_ADMIN = { role: "admin", companyId: "company-A" };
const PLATFORM_SA = { role: "platform_super_admin", companyId: null };

console.log("\n── CRITICAL: tenant admin must NOT escalate to platform/system roles ──────");

test("POST: tenant_admin assigning platform_super_admin → BLOCKED", () => {
  const d = evaluateUserProvisioning({
    requestor: TENANT_ADMIN,
    desiredRole: "platform_super_admin",
    desiredCompanyId: "company-A",
    desiredCompanyAccessible: true,
  });
  assert.equal(d.allowed, false);
  assert.equal(d.status, 403);
});

test("POST: legacy 'admin' assigning platform_admin → BLOCKED", () => {
  const d = evaluateUserProvisioning({
    requestor: LEGACY_ADMIN,
    desiredRole: "platform_admin",
    desiredCompanyId: "company-A",
    desiredCompanyAccessible: true,
  });
  assert.equal(d.allowed, false);
});

test("POST: tenant_admin assigning system_admin → BLOCKED", () => {
  const d = evaluateUserProvisioning({
    requestor: TENANT_ADMIN,
    desiredRole: "system_admin",
    desiredCompanyId: "company-A",
    desiredCompanyAccessible: true,
  });
  assert.equal(d.allowed, false);
});

test("PATCH: tenant_admin escalating an in-scope user to platform_super_admin → BLOCKED", () => {
  const d = evaluateUserProvisioning({
    requestor: TENANT_ADMIN,
    desiredRole: "platform_super_admin",
    targetCompanyId: "company-A",
    targetCompanyAccessible: true,
    targetRole: "employee",
  });
  assert.equal(d.allowed, false);
  assert.equal(d.status, 403);
});

console.log("\n── CRITICAL: tenant isolation — no cross-tenant / global access ───────────");

test("POST: tenant_admin creating a company-less (global) user → BLOCKED", () => {
  const d = evaluateUserProvisioning({
    requestor: TENANT_ADMIN,
    desiredRole: "employee",
    desiredCompanyId: null,
    desiredCompanyAccessible: false,
  });
  assert.equal(d.allowed, false);
});

test("POST: tenant_admin creating a user in another company → BLOCKED", () => {
  const d = evaluateUserProvisioning({
    requestor: TENANT_ADMIN,
    desiredRole: "employee",
    desiredCompanyId: "company-B",
    desiredCompanyAccessible: false,
  });
  assert.equal(d.allowed, false);
});

test("PATCH: tenant_admin editing a user in another company → BLOCKED", () => {
  const d = evaluateUserProvisioning({
    requestor: TENANT_ADMIN,
    desiredRole: "manager",
    targetCompanyId: "company-B",
    targetCompanyAccessible: false,
    targetRole: "employee",
  });
  assert.equal(d.allowed, false);
});

test("PATCH: tenant_admin editing a platform-scoped (company-less) user → BLOCKED", () => {
  const d = evaluateUserProvisioning({
    requestor: TENANT_ADMIN,
    desiredRole: "employee",
    targetCompanyId: null,
    targetCompanyAccessible: true,
    targetRole: "platform_admin",
  });
  assert.equal(d.allowed, false);
});

test("PATCH: tenant_admin moving an in-scope user to another company → BLOCKED", () => {
  const d = evaluateUserProvisioning({
    requestor: TENANT_ADMIN,
    desiredCompanyId: "company-B",
    desiredCompanyAccessible: false,
    targetCompanyId: "company-A",
    targetCompanyAccessible: true,
    targetRole: "employee",
  });
  assert.equal(d.allowed, false);
});

test("requestor with no company scope → BLOCKED", () => {
  const d = evaluateUserProvisioning({
    requestor: { role: "tenant_admin", companyId: null },
    desiredRole: "employee",
    desiredCompanyId: "company-A",
    desiredCompanyAccessible: true,
  });
  assert.equal(d.allowed, false);
});

console.log("\n── Positive: legitimate in-scope actions must still be ALLOWED ────────────");

test("POST: tenant_admin creating an employee in own company → ALLOWED", () => {
  const d = evaluateUserProvisioning({
    requestor: TENANT_ADMIN,
    desiredRole: "employee",
    desiredCompanyId: "company-A",
    desiredCompanyAccessible: true,
  });
  assert.equal(d.allowed, true);
});

test("POST: tenant_admin creating a tenant_manager in an accessible (enterprise sibling) company → ALLOWED", () => {
  const d = evaluateUserProvisioning({
    requestor: TENANT_ADMIN,
    desiredRole: "tenant_manager",
    desiredCompanyId: "company-sibling",
    desiredCompanyAccessible: true,
  });
  assert.equal(d.allowed, true);
});

test("PATCH: tenant_admin changing an in-scope user's role to supervisor → ALLOWED", () => {
  const d = evaluateUserProvisioning({
    requestor: TENANT_ADMIN,
    desiredRole: "supervisor",
    targetCompanyId: "company-A",
    targetCompanyAccessible: true,
    targetRole: "employee",
  });
  assert.equal(d.allowed, true);
});

test("PATCH: tenant_admin updating only isActive (no role/company change) on in-scope user → ALLOWED", () => {
  const d = evaluateUserProvisioning({
    requestor: TENANT_ADMIN,
    targetCompanyId: "company-A",
    targetCompanyAccessible: true,
    targetRole: "employee",
  });
  assert.equal(d.allowed, true);
});

console.log("\n── Platform staff behavior is intentionally unchanged by this fix ─────────");

test("POST: platform_super_admin creating a platform_admin (global) → ALLOWED", () => {
  const d = evaluateUserProvisioning({
    requestor: PLATFORM_SA,
    desiredRole: "platform_admin",
    desiredCompanyId: null,
    desiredCompanyAccessible: false,
  });
  assert.equal(d.allowed, true);
});

test("PATCH: platform_super_admin editing any user across tenants → ALLOWED", () => {
  const d = evaluateUserProvisioning({
    requestor: PLATFORM_SA,
    desiredRole: "tenant_admin",
    desiredCompanyId: "company-B",
    desiredCompanyAccessible: false,
    targetCompanyId: "company-B",
    targetCompanyAccessible: false,
    targetRole: "employee",
  });
  assert.equal(d.allowed, true);
});

console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("\nFailed tests:");
  errors.forEach((e) => console.error(`  • ${e}`));
  process.exit(1);
}
