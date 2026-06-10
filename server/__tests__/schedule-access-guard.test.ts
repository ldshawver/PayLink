/**
 * Schedule Access Guard Tests — server/__tests__/schedule-access-guard.test.ts
 *
 * Run with:  npx tsx server/__tests__/schedule-access-guard.test.ts
 *
 * Exercises the REAL production decision function from
 * server/auth/schedule-access-guard.ts — the guard that protects
 * `POST /api/schedules` against the CRITICAL tenant-isolation vulnerability
 * (the route previously trusted req.body.companyId verbatim).
 *
 * No database required: the decision function is pure; the route handler
 * supplies the DB-resolved facts (isPlatformUser, requestor companyId, and the
 * canAccessCompany result for the target company).
 *
 * Exit code 0 = all tests pass. Exit code 1 = one or more failed.
 */

import assert from "node:assert/strict";
import { evaluateScheduleAccess } from "../auth/schedule-access-guard.js";

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

console.log("\n── Positive: tenant admin scheduling inside an accessible company ─────────");

test("1. tenant admin creates schedule in OWN company → ALLOWED", () => {
  const d = evaluateScheduleAccess({
    isPlatformUser: false,
    requestorCompanyId: "company-A",
    targetCompanyId: "company-A",
    targetCompanyAccessible: true,
  });
  assert.equal(d.allowed, true);
});

test("tenant admin creates schedule in an accessible enterprise-sibling company → ALLOWED", () => {
  const d = evaluateScheduleAccess({
    isPlatformUser: false,
    requestorCompanyId: "company-A",
    targetCompanyId: "company-sibling",
    targetCompanyAccessible: true, // canAccessCompany resolved true (same-tenant sibling / CUA grant)
  });
  assert.equal(d.allowed, true);
});

console.log("\n── CRITICAL: tenant isolation — no cross-tenant schedule writes ───────────");

test("2. tenant admin creates schedule in ANOTHER tenant's company → 403", () => {
  const d = evaluateScheduleAccess({
    isPlatformUser: false,
    requestorCompanyId: "company-A",
    targetCompanyId: "company-B", // different tenant
    targetCompanyAccessible: false,
  });
  assert.equal(d.allowed, false);
  assert.equal(d.status, 403);
});

test("3. tenant admin creates schedule with an invalid / unknown company → 403", () => {
  const d = evaluateScheduleAccess({
    isPlatformUser: false,
    requestorCompanyId: "company-A",
    targetCompanyId: "does-not-exist",
    targetCompanyAccessible: false, // canAccessCompany resolves false for unknown company
  });
  assert.equal(d.allowed, false);
  assert.equal(d.status, 403);
});

test("tenant admin with NO company scope → 403", () => {
  const d = evaluateScheduleAccess({
    isPlatformUser: false,
    requestorCompanyId: null,
    targetCompanyId: "company-A",
    targetCompanyAccessible: true,
  });
  assert.equal(d.allowed, false);
  assert.equal(d.status, 403);
});

test("tenant admin with empty/missing target companyId → 403", () => {
  const d = evaluateScheduleAccess({
    isPlatformUser: false,
    requestorCompanyId: "company-A",
    targetCompanyId: null,
    targetCompanyAccessible: false,
  });
  assert.equal(d.allowed, false);
  assert.equal(d.status, 403);
});

console.log("\n── Platform staff behavior is intentionally unchanged by this fix ─────────");

test("4. platform admin creates schedule in any company → ALLOWED (unchanged)", () => {
  const d = evaluateScheduleAccess({
    isPlatformUser: true,
    requestorCompanyId: null,
    targetCompanyId: "company-B",
    targetCompanyAccessible: false, // irrelevant for platform users
  });
  assert.equal(d.allowed, true);
});

console.log("\n── 5. Tenant isolation matrix: A and B must not reach each other ──────────");

test("5a. tenant-A admin → company-A = ALLOWED, → company-B = BLOCKED", () => {
  const own = evaluateScheduleAccess({
    isPlatformUser: false,
    requestorCompanyId: "company-A",
    targetCompanyId: "company-A",
    targetCompanyAccessible: true,
  });
  const cross = evaluateScheduleAccess({
    isPlatformUser: false,
    requestorCompanyId: "company-A",
    targetCompanyId: "company-B",
    targetCompanyAccessible: false,
  });
  assert.equal(own.allowed, true);
  assert.equal(cross.allowed, false);
  assert.equal(cross.status, 403);
});

test("5b. tenant-B admin → company-B = ALLOWED, → company-A = BLOCKED", () => {
  const own = evaluateScheduleAccess({
    isPlatformUser: false,
    requestorCompanyId: "company-B",
    targetCompanyId: "company-B",
    targetCompanyAccessible: true,
  });
  const cross = evaluateScheduleAccess({
    isPlatformUser: false,
    requestorCompanyId: "company-B",
    targetCompanyId: "company-A",
    targetCompanyAccessible: false,
  });
  assert.equal(own.allowed, true);
  assert.equal(cross.allowed, false);
  assert.equal(cross.status, 403);
});

console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("\nFailed tests:");
  errors.forEach((e) => console.error(`  • ${e}`));
  process.exit(1);
}
