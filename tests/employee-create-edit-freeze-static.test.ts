/**
 * Employee Add/Edit freeze (prod v2.2.13) — static wiring guards.
 *
 * Root cause: seedDemoHierarchy() ran on every boot against existing
 * databases and appended a legal entity + two departments to a real tenant
 * each time, until GET /api/departments returned ~100 MB and froze the
 * Add/Edit Employee dialog. The DB-backed behaviour is covered by
 * tests/employee-create-edit-freeze-db.test.ts; this file keeps the fix
 * wired in on every PR without a database.
 *
 * Run: npx tsx tests/employee-create-edit-freeze-static.test.ts
 */
import fs from "node:fs";

let pass = 0;
let fail = 0;
function ok(name: string, result: boolean) {
  if (result) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}

const seed = fs.readFileSync("server/seed.ts", "utf8");
const routes = fs.readFileSync("server/routes.ts", "utf8");

console.log("seed.ts");
const branchStart = seed.indexOf("if (existingCompanies.length > 0) {");
const branch = branchStart >= 0 ? seed.slice(branchStart, seed.indexOf("}", branchStart)) : "";
ok("existing-companies branch found", branch.length > 0);
ok("existing-companies branch does not call seedDemoHierarchy()", branch.length > 0 && !branch.includes("seedDemoHierarchy("));
ok("seedDemoHierarchy() is called exactly once (fresh-database path only)",
  (seed.match(/await seedDemoHierarchy\(\)/g) ?? []).length === 1);

console.log("routes.ts");
const handler = (method: string, route: string) => {
  const start = routes.indexOf(`app.${method}("${route}",`);
  if (start < 0) return "";
  const next = routes.indexOf("\n  app.", start + 10);
  return routes.slice(start, next < 0 ? undefined : next);
};
ok("resolveTenantCompanyId helper exists", /async function resolveTenantCompanyId\(/.test(routes));
// SaaS PR 1 routes every org-hierarchy GET (departments and branches included)
// through the shared orgResourceHandlers().list handler, which carries the
// same invariant for all of them.
const regStart = routes.indexOf("function orgResourceHandlers(");
const regGet = regStart >= 0 ? routes.slice(regStart, routes.indexOf("const create = async", regStart)) : "";
for (const [route, handlerVar] of [["/api/departments", "orgDepartments"], ["/api/branches", "orgBranches"]]) {
  ok(`GET ${route} is served by the shared org list handler`,
    handler("get", route).split("\n")[0].trimEnd().endsWith(`${handlerVar}.list);`) && regGet.includes("const list = async"));
  ok(`GET ${route} resolves tenant company and returns [] when unresolved`,
    regGet.includes("companyId = await resolveTenantCompanyId(user);") && regGet.includes("if (!companyId) return res.json([]);"));
  ok(`GET ${route} no longer uses user.companyId ?? undefined`, !regGet.includes("user.companyId ?? undefined"));
}
for (const [m, r] of [["post", "/api/workers"], ["patch", "/api/workers/:id"], ["delete", "/api/workers/:id"]] as const) {
  const h = handler(m, r);
  // The guard may resolve the company directly, or through the shared administered-company
  // set (resolveEmployeeAdminCompanyIds), which itself starts from resolveTenantCompanyId.
  ok(`${m.toUpperCase()} ${r} guard does not skip when acting user's companyId is null`,
    (h.includes("resolveTenantCompanyId(actingUser)") || h.includes("resolveEmployeeAdminCompanyIds(actingUser)"))
      && !h.includes("&& !!actingUser?.companyId"));
}
{
  const s = routes.indexOf("async function resolveEmployeeAdminCompanyIds(");
  const body = s >= 0 ? routes.slice(s, routes.indexOf("\n}\n", s)) : "";
  ok("resolveEmployeeAdminCompanyIds starts from resolveTenantCompanyId (null company never widens)",
    s < 0 || (body.includes("await resolveTenantCompanyId(user)") && body.includes("is_active = TRUE")));
}
ok("worker account routes guard does not skip when acting user's companyId is null",
  /async function loadWorkerForAccountRoute[\s\S]*?resolveTenantCompanyId\(actingUser\)[\s\S]*?return \{ worker, companyId/.test(routes));
for (const [m, r] of [["post", "/api/employee-contacts"], ["patch", "/api/employee-contacts/:id"], ["delete", "/api/employee-contacts/:id"]] as const) {
  ok(`${m.toUpperCase()} ${r} checks contact-worker ownership`, handler(m, r).includes("canAccessContactWorker("));
}
ok("GET /api/employee-contacts scopes a manager's unfiltered list to their company",
  handler("get", "/api/employee-contacts").includes("getEmployeeContactsByCompany(tenantCompanyId)"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
