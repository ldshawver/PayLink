/**
 * SaaS PR 1 — static wiring guard for the company-authorization boundary.
 *
 * Complements tests/saas-pr1-company-authz-db.test.ts (real HTTP, disposable DB,
 * not CI-gated) with source-level assertions that run in the required suite, so
 * a regression reintroducing the audit's takeover primitives fails CI:
 *  - canAccessCompany() has no enterprise-sibling branch and no NULL-company bypass;
 *  - the org-hierarchy routes are registered through the shared guarded registrar;
 *  - enterprise and company-creation writes are platform-admin-only;
 *  - PATCH /api/companies/:id applies the tenant field allowlist;
 *  - the scheduling picker never returns full worker objects.
 *
 * Run: npx tsx tests/saas-pr1-company-authz-static.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const routes = fs.readFileSync(path.resolve("server/routes.ts"), "utf8");
let passed = 0, failed = 0;
const errors: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ✓  ${name}`); passed++; }
  catch (e: any) { console.error(`  ✗  ${name}\n       ${e.message}`); errors.push(name); failed++; }
}
function fnBody(src: string, signature: string): string {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `missing: ${signature}`);
  const open = src.indexOf("{\n", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unterminated: ${signature}`);
}
function routeBlock(method: string, p: string): string {
  const sig = `app.${method}("${p}"`;
  const start = routes.indexOf(sig);
  assert.ok(start >= 0, `route not found: ${method.toUpperCase()} ${p}`);
  const next = routes.indexOf("\n  app.", start + sig.length);
  return routes.slice(start, next === -1 ? undefined : next);
}

const cac = fnBody(routes, "async function canAccessCompany(");
const cacCode = cac.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

test("canAccessCompany has no enterprise-sibling grant", () => {
  assert.ok(!/enterprise_id/.test(cacCode), "canAccessCompany must not consult enterprise_id");
});
test("canAccessCompany does not treat a NULL companyId as platform", () => {
  assert.ok(!/!u\.companyId\s*\|\|/.test(cacCode), "found `!u.companyId ||` bypass");
  assert.ok(!/startsWith\("platform_"\)/.test(cacCode), "platform bypass must use the explicit role list");
  assert.ok(/isPlatformCompanyBypassRole\(u\.role\)/.test(cacCode));
});
test("canAccessCompany explicit grants come from company_user_access for THIS user", () => {
  assert.ok(/FROM company_user_access\s+WHERE user_id = \$\{u\.id\}/.test(cacCode));
  assert.ok(!/SELECT id FROM users WHERE company_id/.test(cacCode), "legacy any-user-of-company grant must be gone");
});
test("enterprise reach is confined to resolveSchedulingCompanyIds", () => {
  const sched = fnBody(routes, "async function resolveSchedulingCompanyIds(");
  assert.ok(/enterprise_id/.test(sched));
});
const ORG_PATHS: Array<[string, string]> = [
  ["/api/departments", "orgDepartments"], ["/api/branches", "orgBranches"], ["/api/divisions", "orgDivisions"],
  ["/api/positions", "orgPositions"], ["/api/cost-centers", "orgCostCenters"], ["/api/jobs", "orgJobs"],
  ["/api/legal-entities", "orgLegalEntities"],
];
test("every org hierarchy route is a literal registration bound to the guarded handlers", () => {
  for (const [p, v] of ORG_PATHS) {
    assert.ok(routes.includes(`const ${v} = orgResourceHandlers({`), `${v} not built by orgResourceHandlers`);
    for (const [m, suffix, h] of [["get", "", "list"], ["post", "", "create"], ["patch", "/:id", "update"], ["delete", "/:id", "remove"]]) {
      const b = routeBlock(m, `${p}${suffix}`);
      assert.ok(b.split("\n")[0].trimEnd().endsWith(`${v}.${h});`), `${m.toUpperCase()} ${p}${suffix} must use ${v}.${h}`);
      assert.equal(routes.split(`app.${m}("${p}${suffix}"`).length - 1, 1, `duplicate ${m} ${p}${suffix}`);
    }
  }
});
test("org PATCH/DELETE authorize the stored owner via evaluateOrgMutation", () => {
  const reg = fnBody(routes, "function orgResourceHandlers(");
  assert.ok((reg.match(/loadOrgRowCompany\(/g) ?? []).length >= 2);
  assert.ok((reg.match(/evaluateOrgMutation\(/g) ?? []).length >= 2);
  assert.ok(/evaluateOrgCreate\(/.test(reg));
  assert.ok(/companyId = await resolveTenantCompanyId\(user\);/.test(reg) && /if \(!companyId\) return res\.json\(\[\]\);/.test(reg));
});
test("legal entities require admin/manager to read", () => {
  assert.ok(routeBlock("get", "/api/legal-entities").startsWith('app.get("/api/legal-entities", requireRole("admin", "manager")'));
});
test("enterprise writes are platform-admin only", () => {
  for (const m of ["post", "patch", "delete"]) {
    const p = m === "post" ? "/api/enterprises" : "/api/enterprises/:id";
    assert.ok(routeBlock(m, p).startsWith(`app.${m}("${p}", requirePlatformAdminRole()`), `${m} ${p}`);
  }
});
test("POST /api/companies is platform-admin only", () => {
  assert.ok(routeBlock("post", "/api/companies").startsWith('app.post("/api/companies", requirePlatformAdminRole()'));
});
test("PATCH /api/companies/:id applies the tenant allowlist", () => {
  const b = routeBlock("patch", "/api/companies/:id");
  assert.ok(/filterTenantCompanyPatch\(/.test(b));
  assert.ok(/canAccessCompany\(actingUser, existing\.id\)/.test(b));
});
test("scheduling picker returns projections, never full workers", () => {
  const b = routeBlock("get", "/api/workers");
  const i = b.indexOf("if (forScheduling");
  const seg = b.slice(i, b.indexOf("let effectiveCompanyId", i));
  assert.ok(/toSchedulingWorker\(/.test(seg));
  assert.ok(!/return res\.json\(allWorkers\)/.test(seg));
  assert.ok(!/storage\.getWorkers\(\)\s*;/.test(seg), "unscoped getWorkers() in scheduling branch");
});
test("schedule writes use the scheduling-only scope", () => {
  assert.ok(/canScheduleIntoCompany\(schedCreator, companyId\)/.test(routeBlock("post", "/api/schedules")));
  assert.ok(/canScheduleIntoCompany\(schedCreator, schedWorker\.companyId\)/.test(routeBlock("post", "/api/schedules")));
  assert.ok(/canScheduleIntoCompany\(actor, companyId\)/.test(routeBlock("post", "/api/schedules/copy-week")));
  assert.ok(/canScheduleIntoCompany\(publishUser, publishCompanyId\)/.test(routeBlock("post", "/api/schedules/publish")));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) { for (const e of errors) console.error(`  - ${e}`); process.exit(1); }
