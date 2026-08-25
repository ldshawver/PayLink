/**
 * expandRoleForGuard() unit tests — server/__tests__/expand-role-for-guard.test.ts
 *
 * Phase 0.5, saas/phase0.5-platform-role-boundary: direct, deterministic proof
 * of the role-alias fix described in
 * docs/saas-readiness/phase-0.5-security-convergence-report.md §2.6.
 *
 * Root cause: expandRoleForGuard() (server/routes.ts) used to alias
 * platform_support and platform_implementation to ["admin", "manager", role]
 * for every requireRole()-gated route — contradicting GET
 * /api/platform/audit/roles, which has always documented both roles as
 * `aliases: []`. The fix removes that special case; both roles now fall
 * through to the function's default `return [role]`.
 *
 * This file is a plain no-DB, no-server unit test (the "required" CI-gating
 * suite) — it imports expandRoleForGuard directly rather than booting the
 * app, so it runs on every PR with zero configuration. The corresponding
 * live-HTTP, role-boundary negative tests for the 7 previously-untested
 * platform-console routes live in
 * tests/platform-role-boundary-negative-db.test.ts (disposable-Postgres "db"
 * suite), including a second, HTTP-level assertion of this same fix via GET
 * /api/debug/permissions/me's `expandedRoles` field for defense in depth.
 *
 * Run with:  npx tsx server/__tests__/expand-role-for-guard.test.ts
 * Exit code 0 = all tests pass. Exit code 1 = one or more tests failed.
 */
import assert from "node:assert/strict";
import { expandRoleForGuard } from "../routes";

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

/** Set-equality assertion — this function's alias order is an implementation detail, not a contract. */
function assertExpandsTo(role: string, expected: string[]) {
  const got = expandRoleForGuard(role);
  const gotSet = [...got].sort();
  const expectedSet = [...expected].sort();
  assert.deepStrictEqual(gotSet, expectedSet, `expandRoleForGuard(${JSON.stringify(role)}) = ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
}

console.log("\n── expandRoleForGuard(): the fix ──");

test('platform_support no longer aliases to "admin"/"manager" — carries only itself, matching GET /api/platform/audit/roles\' documented aliases:[]', () => {
  assertExpandsTo("platform_support", ["platform_support"]);
});

test('platform_implementation no longer aliases to "admin"/"manager" — carries only itself, matching GET /api/platform/audit/roles\' documented aliases:[]', () => {
  assertExpandsTo("platform_implementation", ["platform_implementation"]);
});

console.log("\n── expandRoleForGuard(): unchanged controls (out of scope for this branch) ──");

test("platform_super_admin still aliases to admin/manager/supervisor + itself (unchanged — centralized platform-owner authority, 0.5u scope)", () => {
  assertExpandsTo("platform_super_admin", ["admin", "manager", "supervisor", "platform_super_admin"]);
});

test("platform_owner still aliases to admin/manager/supervisor + itself (unchanged — known separate gap T2/PT2, not this branch's scope)", () => {
  assertExpandsTo("platform_owner", ["admin", "manager", "supervisor", "platform_owner"]);
});

test("platform_admin still aliases to admin/manager/supervisor + itself (unchanged — centralized platform-admin authority)", () => {
  assertExpandsTo("platform_admin", ["admin", "manager", "supervisor", "platform_admin"]);
});

test("system_admin still aliases to admin + itself (unchanged)", () => {
  assertExpandsTo("system_admin", ["admin", "system_admin"]);
});

test("owner still aliases to admin + itself (unchanged)", () => {
  assertExpandsTo("owner", ["admin", "owner"]);
});

test("tenant_admin still aliases to admin + itself (unchanged)", () => {
  assertExpandsTo("tenant_admin", ["admin", "tenant_admin"]);
});

test("tenant_owner still aliases to admin + itself (unchanged)", () => {
  assertExpandsTo("tenant_owner", ["admin", "tenant_owner"]);
});

test("tenant_hr_admin still aliases to admin + itself (unchanged)", () => {
  assertExpandsTo("tenant_hr_admin", ["admin", "tenant_hr_admin"]);
});

test("tenant_payroll_admin still aliases to admin + itself (unchanged)", () => {
  assertExpandsTo("tenant_payroll_admin", ["admin", "tenant_payroll_admin"]);
});

test("tenant_finance_admin still aliases to admin + itself (unchanged)", () => {
  assertExpandsTo("tenant_finance_admin", ["admin", "tenant_finance_admin"]);
});

test("tenant_manager still aliases to manager/supervisor + itself (unchanged)", () => {
  assertExpandsTo("tenant_manager", ["manager", "supervisor", "tenant_manager"]);
});

test("tenant_supervisor still aliases to manager/supervisor + itself (unchanged)", () => {
  assertExpandsTo("tenant_supervisor", ["manager", "supervisor", "tenant_supervisor"]);
});

console.log("\n── expandRoleForGuard(): roles with no special case carry only themselves ──");

test("platform_auditor (not special-cased before or after this fix) carries only itself", () => {
  assertExpandsTo("platform_auditor", ["platform_auditor"]);
});

test("platform_billing (not special-cased before or after this fix) carries only itself", () => {
  assertExpandsTo("platform_billing", ["platform_billing"]);
});

test("platform_sales (not special-cased before or after this fix) carries only itself", () => {
  assertExpandsTo("platform_sales", ["platform_sales"]);
});

test('employee (ordinary tenant role) carries only itself', () => {
  assertExpandsTo("employee", ["employee"]);
});

test("admin (legacy literal role) carries only itself — not double-expanded", () => {
  assertExpandsTo("admin", ["admin"]);
});

test("empty/unknown role string carries only itself", () => {
  assertExpandsTo("", [""]);
  assertExpandsTo("some_future_role", ["some_future_role"]);
});

console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error("\nFailed tests:");
  errors.forEach((e) => console.error(`  • ${e}`));
  process.exit(1);
}
