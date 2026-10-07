/**
 * Stored-Resource Ownership Guard Tests — server/__tests__/stored-resource-guard.test.ts
 *
 * Run with:  npx tsx server/__tests__/stored-resource-guard.test.ts
 *
 * Exercises the REAL decision functions from server/auth/stored-resource-guard.ts
 * (SaaS PR 2): list company scope (a missing companyId never means every
 * tenant; a supplied one is authorized first; company-less non-platform actors
 * are denied), stored-owner by-id decisions, ownership-field stripping and the
 * compliance worker projection.
 *
 * Pure — no database. Exit code 0 = all pass, 1 = failures.
 */

import assert from "node:assert/strict";
import {
  normalizeListCompanyId, decideListScope, decideStoredResourceAccess,
  stripOwnershipFields, toComplianceWorker, OWNERSHIP_IMMUTABLE_FIELDS,
} from "../auth/stored-resource-guard.js";

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

const A1 = "company-a1", B1 = "company-b1";

console.log("\n── normalizeListCompanyId ──────────────────────────────────────────────");
test("absent / blank / 'all' / non-string → not supplied", () => {
  for (const v of [undefined, null, "", "   ", "all", ["a", "b"], 42, {}]) {
    assert.equal(normalizeListCompanyId(v), undefined, JSON.stringify(v));
  }
});
test("a real id is trimmed and kept", () => {
  assert.equal(normalizeListCompanyId(` ${A1} `), A1);
});

console.log("\n── decideListScope ─────────────────────────────────────────────────────");
const base = { isPlatform: false, requestedCompanyId: undefined, requestedAccessible: false, defaultCompanyId: A1, allowPlatformAll: true };
test("tenant, no companyId → own company only (NEVER all tenants)", () => {
  assert.deepEqual(decideListScope(base), { allowed: true, companyId: A1 });
});
test("tenant, companyId=own (accessible) → that company", () => {
  assert.deepEqual(decideListScope({ ...base, requestedCompanyId: A1, requestedAccessible: true }), { allowed: true, companyId: A1 });
});
test("tenant, companyId=foreign (not accessible) → 403 before any query", () => {
  const d = decideListScope({ ...base, requestedCompanyId: B1, requestedAccessible: false });
  assert.equal(d.allowed, false);
  assert.equal((d as any).status, 403);
});
test("tenant with explicit grant → granted company allowed", () => {
  assert.deepEqual(decideListScope({ ...base, requestedCompanyId: B1, requestedAccessible: true }), { allowed: true, companyId: B1 });
});
test("company-less non-platform, no companyId, no unambiguous grant → 403 (not platform)", () => {
  const d = decideListScope({ ...base, defaultCompanyId: null });
  assert.equal(d.allowed, false);
  assert.equal((d as any).status, 403);
});
test("company-less non-platform naming a company it cannot access → 403", () => {
  const d = decideListScope({ ...base, defaultCompanyId: null, requestedCompanyId: B1 });
  assert.equal(d.allowed, false);
});
test("company-less non-platform with a single explicit grant → that company", () => {
  assert.deepEqual(decideListScope({ ...base, defaultCompanyId: B1 }), { allowed: true, companyId: B1 });
});
test("platform, no companyId, endpoint allows all → every company (undefined)", () => {
  assert.deepEqual(decideListScope({ ...base, isPlatform: true, defaultCompanyId: null }), { allowed: true, companyId: undefined });
});
test("platform, no companyId, endpoint requires one → 400", () => {
  const d = decideListScope({ ...base, isPlatform: true, defaultCompanyId: null, allowPlatformAll: false });
  assert.equal(d.allowed, false);
  assert.equal((d as any).status, 400);
});
test("platform, any companyId → that company", () => {
  assert.deepEqual(decideListScope({ ...base, isPlatform: true, requestedCompanyId: B1 }), { allowed: true, companyId: B1 });
});
test("tenant result is never 'all' (companyId undefined) for any input", () => {
  for (const requestedCompanyId of [undefined, A1, B1]) for (const requestedAccessible of [true, false])
    for (const defaultCompanyId of [null, A1]) for (const allowPlatformAll of [true, false]) {
      const d = decideListScope({ isPlatform: false, requestedCompanyId, requestedAccessible, defaultCompanyId, allowPlatformAll });
      if (d.allowed) assert.notEqual(d.companyId, undefined);
    }
});

console.log("\n── decideStoredResourceAccess ──────────────────────────────────────────");
const r = { exists: true, storedCompanyId: A1, isPlatform: false, storedAccessible: true, label: "Pay method" };
test("missing resource → 404 with label", () => {
  const d = decideStoredResourceAccess({ ...r, exists: false });
  assert.equal((d as any).status, 404);
  assert.match((d as any).message, /Pay method not found/);
});
test("stored owner accessible → allowed", () => {
  assert.deepEqual(decideStoredResourceAccess(r), { allowed: true });
});
test("stored owner NOT accessible → 403", () => {
  const d = decideStoredResourceAccess({ ...r, storedCompanyId: B1, storedAccessible: false });
  assert.equal((d as any).status, 403);
});
test("NULL / unresolved stored owner → 403 for tenants (never 'shared')", () => {
  for (const storedCompanyId of [null, undefined, ""]) {
    const d = decideStoredResourceAccess({ ...r, storedCompanyId, storedAccessible: true });
    assert.equal((d as any).status, 403, String(storedCompanyId));
  }
});
test("platform → allowed for any existing owner, including NULL", () => {
  assert.deepEqual(decideStoredResourceAccess({ ...r, isPlatform: true, storedCompanyId: B1, storedAccessible: false }), { allowed: true });
  assert.deepEqual(decideStoredResourceAccess({ ...r, isPlatform: true, storedCompanyId: null }), { allowed: true });
});
test("platform still gets 404 for a missing resource", () => {
  assert.equal((decideStoredResourceAccess({ ...r, isPlatform: true, exists: false }) as any).status, 404);
});

console.log("\n── stripOwnershipFields ────────────────────────────────────────────────");
test("drops identity / ownership / re-parenting fields", () => {
  const out = stripOwnershipFields({ id: "x", companyId: B1, workerId: "w", payrollRunId: "r", payrollItemId: "i", userId: "u", createdAt: 1, createdBy: "c", grossPay: "10" });
  assert.deepEqual(out, { grossPay: "10" });
  for (const f of OWNERSHIP_IMMUTABLE_FIELDS) assert.ok(!(f in out));
});
test("extra blocked fields (e.g. review state for non-managers)", () => {
  assert.deepEqual(stripOwnershipFields({ status: "approved", reviewNote: "x", reason: "r" }, ["status", "reviewNote"]), { reason: "r" });
});
test("non-object bodies → empty", () => {
  for (const b of [null, undefined, "str", 5, [1, 2]]) assert.deepEqual(stripOwnershipFields(b), {});
});

console.log("\n── toComplianceWorker ──────────────────────────────────────────────────");
test("projection carries no SSN / bank / tax / address / pay", () => {
  const w = { id: "w1", companyId: A1, firstName: "F", lastName: "L", workerType: "contractor", employeeNumber: "7", status: "active",
    ssn: "900-00-0001", bankAccountNumber: "123", bankRoutingNumber: "021000021", address: "1 Private Ln", payRate: "41", taxId: "x" } as any;
  const p = toComplianceWorker(w);
  assert.deepEqual(Object.keys(p).sort(), ["companyId", "employeeNumber", "firstName", "id", "lastName", "status", "workerType"]);
  assert.ok(!JSON.stringify(p).includes("900-00-0001"));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
