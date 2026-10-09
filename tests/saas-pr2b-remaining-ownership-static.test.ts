/**
 * SaaS PR 2B — static wiring guard (required suite, no DB).
 *
 * Complements tests/saas-pr2b-remaining-ownership-db.test.ts with source-level
 * assertions that keep the PR 2B repairs from silently regressing:
 *  - the global supplied-companyId gate is registered AFTER req.user is
 *    populated and BEFORE the first company-scoped route, and its pure decision
 *    denies foreign companies (reads + writes), allows scheduling reach only for
 *    reads / scheduling writes, and never treats a sentinel as a company;
 *  - every OWNED_RESOURCES entry is a compile-time constant (no request data in
 *    the owner SQL) and resolves NULL owners to platform-only;
 *  - every route PR 2 deferred to PR 2B scopes through resolveListScope /
 *    scopeCompanyRows or authorizes the stored owner (authorizeOwnedById) BEFORE
 *    it reads or mutates — except the documented intentional/safe ones;
 *  - by-id PATCH handlers strip ownership fields; enterprise siblings are no
 *    longer used as general access in the contractor lists.
 *
 * Run: npx tsx tests/saas-pr2b-remaining-ownership-static.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  decideSuppliedCompanyAccess, extractSuppliedCompanyIds, decideOwnedOrSelfAccess, OWNED_RESOURCES,
} from "../server/auth/stored-resource-guard";

const routes = fs.readFileSync(path.resolve("server/routes.ts"), "utf8");
let passed = 0, failed = 0;
const errors: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ✓  ${name}`); passed++; }
  catch (e: any) { console.error(`  ✗  ${name}\n       ${e.message}`); errors.push(name); failed++; }
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
function routeBlock(method: string, p: string): string {
  const re = new RegExp(`\\n\\s*app\\.${method}\\(\\s*["'\`]${p.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}["'\`]`);
  const m = re.exec(routes);
  assert.ok(m, `route not found: ${method.toUpperCase()} ${p}`);
  const rest = routes.slice(m!.index + m![0].length);
  const next = rest.search(/\n\s*app\.(get|post|patch|put|delete|use)\(/);
  return stripComments(m![0] + (next === -1 ? rest : rest.slice(0, next)));
}
const MUTATIONS = ["storage.update", "storage.delete", "storage.create", "UPDATE ", "DELETE FROM", "INSERT INTO", "res.json(", "res.send("];
function guardedBefore(block: string, guard: RegExp) {
  const i = block.search(guard);
  assert.ok(i >= 0, `no ownership/list-scope primitive (${guard})`);
  for (const l of MUTATIONS) {
    const j = block.indexOf(l);
    if (j >= 0 && block.slice(j - 40, j).includes("return res.status(4")) continue; // early 4xx exit
    if (j >= 0) assert.ok(i < j, `primitive must come before ${l.trim()}`);
  }
}

// ── 1. Pure decisions ─────────────────────────────────────────────────────────
test("gate: foreign company denied on reads and writes", () => {
  for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
    const d = decideSuppliedCompanyAccess({ method, path: "/pay-codes", isPlatform: false, general: { B: false }, scheduling: { B: false } });
    assert.equal(d.allowed, false, method);
  }
});
test("gate: scheduling reach → reads anywhere, writes only on scheduling paths", () => {
  const sched = { general: { S2: false }, scheduling: { S2: true }, isPlatform: false };
  assert.equal(decideSuppliedCompanyAccess({ ...sched, method: "GET", path: "/departments" }).allowed, true);
  assert.equal(decideSuppliedCompanyAccess({ ...sched, method: "POST", path: "/schedules" }).allowed, true);
  assert.equal(decideSuppliedCompanyAccess({ ...sched, method: "POST", path: "/schedules/copy-week" }).allowed, true);
  assert.equal(decideSuppliedCompanyAccess({ ...sched, method: "POST", path: "/pay-codes" }).allowed, false);
  assert.equal(decideSuppliedCompanyAccess({ ...sched, method: "POST", path: "/schedules-evil" }).allowed, false);
});
test("gate: platform and accessible companies pass", () => {
  assert.equal(decideSuppliedCompanyAccess({ method: "POST", path: "/x", isPlatform: true, general: { B: false }, scheduling: { B: false } }).allowed, true);
  assert.equal(decideSuppliedCompanyAccess({ method: "POST", path: "/x", isPlatform: false, general: { A: true }, scheduling: { A: true } }).allowed, true);
});
test("extractSuppliedCompanyIds: camel/snake, query/body, ignores sentinels/non-strings", () => {
  assert.deepEqual(extractSuppliedCompanyIds({ companyId: "A" }, { company_id: "B" }).sort(), ["A", "B"]);
  assert.deepEqual(extractSuppliedCompanyIds({ companyId: "all" }, { companyId: "__universal__" }), []);
  assert.deepEqual(extractSuppliedCompanyIds({ companyId: ["A", "B"] }, [{ companyId: "C" }]), []);
  assert.deepEqual(extractSuppliedCompanyIds({ companyId: "  " }, null), []);
});
test("owned-or-self: NULL owner platform-only; self passes; foreign denied", () => {
  const base = { exists: true, isPlatform: false, storedAccessible: false, isSelf: false };
  assert.equal(decideOwnedOrSelfAccess({ ...base, storedCompanyId: null }).allowed, false);
  assert.equal(decideOwnedOrSelfAccess({ ...base, storedCompanyId: "B" }).allowed, false);
  assert.equal(decideOwnedOrSelfAccess({ ...base, storedCompanyId: "B", isSelf: true }).allowed, true);
  assert.equal(decideOwnedOrSelfAccess({ ...base, storedCompanyId: null, isPlatform: true }).allowed, true);
  assert.equal(decideOwnedOrSelfAccess({ ...base, exists: false, storedCompanyId: "A", isSelf: true }).allowed, false);
});
test("OWNED_RESOURCES: constant identifiers only", () => {
  for (const [k, v] of Object.entries(OWNED_RESOURCES)) {
    assert.match(v.table, /^[a-z_]+$/, k);
    assert.ok(!/\$\{|req\.|\?|;/.test(v.owner), `${k} owner must be a constant SQL expression`);
  }
});

// ── 2. Wiring ─────────────────────────────────────────────────────────────────
test("gate registered after req.user population and before company routes", () => {
  const userPop = routes.indexOf("Populate req.user from session for all authenticated API routes");
  const gate = routes.indexOf("Supplied-companyId gate (SaaS PR 2B)");
  const firstScoped = routes.indexOf('app.get("/api/payroll-summary"');
  assert.ok(userPop > 0 && gate > userPop && firstScoped > gate, `order userPop=${userPop} gate=${gate} first=${firstScoped}`);
});
test("contractor lists no longer grant enterprise siblings general access", () => {
  for (const p of ["/api/contractor-proposals", "/api/contractor-contracts"]) {
    assert.ok(!/enterprise_id\s*=\s*\$\{/.test(routeBlock("get", p)), p);
  }
});

const LIST = /resolveListScope\(|scopeCompanyRows\(/;
const BYID = /authorizeOwnedById\(|canAccessStoredCompany\(/;
const LISTS = [
  "/api/time-punches/pending", "/api/clock-in-requests", "/api/schedule/labor-summary", "/api/accrual-accounts", "/api/pay-periods",
  "/api/taxes-deductions", "/api/policy-groups", "/api/pay-codes", "/api/holidays", "/api/qualifications", "/api/reviews",
  "/api/kpi-groups", "/api/qualification-groups", "/api/worker-languages", "/api/stations", "/api/receipts", "/api/receipts/export-pdf",
  "/api/contractor-invoices", "/api/recurring-expenses", "/api/expenses/export/csv", "/api/contractor-invoices/export/csv",
  "/api/contractor-contracts", "/api/document-hub/assets", "/api/dam-documents", "/api/shift-offers", "/api/secondary-wage-groups",
  "/api/currencies", "/api/recurring-schedules", "/api/remittance-agencies", "/api/pay-stub-accounts", "/api/pay-stub-amendments",
  "/api/pay-stub-transactions", "/api/earning-types", "/api/pay-period-schedules/resolve-period", "/api/pay-period-schedules",
  "/api/employee-titles", "/api/employee-groups", "/api/new-hire-defaults", "/api/tax-wizard/snapshots", "/api/schedule-preferences",
  "/api/payroll-audit", "/api/marketplace/listings", "/api/eligibility-rule-sets", "/api/schedule-audit-logs", "/api/invoice-templates",
  "/api/invoices", "/api/payments", "/api/payment-method-configs", "/api/recurring-billing", "/api/automation-rules", "/api/notifications",
  "/api/trade-transactions", "/api/trade-transactions/reporting-summary", "/api/agreement-templates", "/api/worker-agreements",
  "/api/worker-onboarding", "/api/saved-reports", "/api/dashboard/stats",
  "/api/pay-formulas", "/api/contributing-pay-codes", "/api/contributing-shifts", "/api/regular-time-policies", "/api/overtime-policies",
  "/api/premium-policies", "/api/meal-policies", "/api/break-policies", "/api/schedule-policies", "/api/exception-policies",
  "/api/accrual-policies", "/api/absence-policies", "/api/holiday-policies", "/api/rounding-policies",
];
for (const p of LISTS) test(`list scoped before query: GET ${p}`, () => guardedBefore(routeBlock("get", p), LIST));
test("list scoped before query: POST /api/pay-period-schedules/deactivate-extras", () =>
  guardedBefore(routeBlock("post", "/api/pay-period-schedules/deactivate-extras"), LIST));

const PATCH_DELETE = [
  "accrual-accounts", "taxes-deductions", "pay-codes", "worker-languages", "pay-stub-accounts", "employee-groups", "employee-titles",
  "pay-formulas", "contributing-pay-codes", "regular-time-policies", "overtime-policies", "schedule-policies", "accrual-policies",
  "schedule-preferences", "invoice-templates", "payment-method-configs", "document-retention-policies", "worker-agreements",
  "worker-onboarding", "biz-document-items", "secondary-wage-groups", "recurring-schedules", "pay-stub-amendments",
  "pay-period-schedules", "tax-wizard/snapshots", "premium-policies", "meal-policies", "break-policies", "exception-policies",
  "absence-policies", "holiday-policies", "rounding-policies", "contributing-shifts",
];
for (const f of PATCH_DELETE) {
  test(`by-id stored owner: PATCH /api/${f}/:id`, () => guardedBefore(routeBlock("patch", `/api/${f}/:id`), BYID));
  test(`by-id stored owner: DELETE /api/${f}/:id`, () => guardedBefore(routeBlock("delete", `/api/${f}/:id`), BYID));
}
const OTHER_BYID: Array<[string, string]> = [
  ["patch", "/api/pay-periods/:id"], ["patch", "/api/recurring-expenses/:id"], ["patch", "/api/payroll-reimbursements/:id"],
  ["patch", "/api/pay-stub-transactions/:id"], ["patch", "/api/document-folders/:id"], ["patch", "/api/invoice-approval-workflows/:id"],
  ["patch", "/api/document-retention-policies/:id/legal-basis"], ["delete", "/api/accrual-policy-milestones/:id"],
  ["delete", "/api/employee-wage-groups/:id"], ["delete", "/api/biz-document-attachments/:id"], ["delete", "/api/saved-reports/:id"],
  ["get", "/api/saved-reports/:id"], ["post", "/api/app-doctor/reports/:id/analyze"], ["get", "/api/worker-agreements/:id"],
  ["post", "/api/worker-agreements/:id/sign"], ["post", "/api/worker-onboarding/:id/regenerate-token"], ["post", "/api/worker-onboarding/:id/review"],
  ["patch", "/api/worker-onboarding/:id/steps/:stepId"], ["get", "/api/worker-onboarding/:id/documents"], ["get", "/api/worker-onboarding/:id/audit-log"],
  ["get", "/api/contractor-invoices/:id"], ["post", "/api/contractor-invoices/:id/approve"], ["post", "/api/contractor-invoices/:id/reject"],
  ["get", "/api/contractor-invoices/:id/audit"], ["get", "/api/contractor-invoices/:id/payments"], ["get", "/api/contractor-invoices/:id/reminder-logs"],
  ["post", "/api/contractor-invoices/:id/send-reminder"], ["post", "/api/contractor-invoices/:id/stripe-checkout-session"],
  ["get", "/api/contractor-proposals/:id/line-items"], ["post", "/api/contractor-proposals/:id/line-items"], ["get", "/api/contractor-proposals/:id/events"],
  ["get", "/api/contractor-proposals/:id/current-version"], ["delete", "/api/contractor-proposals/:id"], ["get", "/api/contractor-hub/contracts/:id/sign"],
  ["get", "/api/notification-preferences/:workerId"], ["get", "/api/permissions/effective/:userId"],
  ["get", "/api/pay-period-schedules/:companyId/resolve-debug"],
];
for (const [m, p] of OTHER_BYID) test(`by-id stored owner: ${m.toUpperCase()} ${p}`, () => guardedBefore(routeBlock(m, p), BYID));

test("by-id PATCHes strip ownership fields", () => {
  for (const f of PATCH_DELETE.filter((x) => !["pay-period-schedules", "tax-wizard/snapshots"].includes(x))) {
    assert.ok(/stripOwnershipFields\(/.test(routeBlock("patch", `/api/${f}/:id`)), f);
  }
});
test("expense categories (global table) writes are platform-only", () => {
  for (const [m, p] of [["patch", "/api/expense-categories/:id"], ["post", "/api/expense-categories"]] as const) {
    guardedBefore(routeBlock(m, p), /isPlatformCompanyBypassRole\(/);
  }
});
test("repair tickets: company-less non-platform actor denied", () => {
  assert.ok(/if \(!isPlatform && !companyId\) return res\.status\(403\)/.test(routeBlock("get", "/api/app-doctor/repair-tickets")));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) { for (const e of errors) console.error(`  - ${e}`); process.exit(1); }
