/**
 * SaaS PR 2 — static wiring guard for stored-resource ownership.
 *
 * Complements tests/saas-pr2-stored-ownership-db.test.ts (real HTTP, disposable
 * DB, not CI-gated) with source-level assertions that run in the required suite:
 *  - the legacy company-less bypass shapes (`!isPlatformUser(u.role) && u.companyId
 *    && x !== u.companyId`, `isPlatformUser = !user?.companyId`, `u?.companyId &&
 *    x !== u.companyId`, `!user?.companyId || …`) do not reappear in server code;
 *  - canAccessStoredCompany() never treats a NULL owner or missing actor as open;
 *  - every repaired list endpoint scopes through resolveListScope() BEFORE its query;
 *  - every repaired by-id route authorizes the STORED owner before reading/mutating;
 *  - system documents are platform-admin-only; the public proposal approval alias
 *    requires the share token.
 *
 * Run: npx tsx tests/saas-pr2-stored-ownership-static.test.ts
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
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
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
  return stripComments(routes.slice(start, next === -1 ? undefined : next));
}
/** `needle` must occur in the handler before the first occurrence of every `later` marker. */
function before(block: string, needle: string | RegExp, later: string[]) {
  const i = typeof needle === "string" ? block.indexOf(needle) : block.search(needle);
  assert.ok(i >= 0, `missing ${needle}`);
  for (const l of later) {
    const j = block.indexOf(l);
    if (j >= 0) assert.ok(i < j, `${needle} must come before ${l}`);
  }
}

// ── 1. Legacy company-less bypass shapes ─────────────────────────────────────
function serverFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "__tests__" && e.name !== "node_modules") out.push(...serverFiles(p)); }
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}
/**
 * Files exempt from the legacy-shape scan, each with a reason.
 * server/auth/authorization.ts is the advisory role_permissions scope evaluator
 * (checkPermission); every route that consults it has already applied company
 * isolation first, so its department/company flag comparison is not a tenant
 * authorization boundary.
 */
const LEGACY_SCAN_EXEMPT = new Set(["server/auth/authorization.ts"]);
const LEGACY_PATTERNS: Array<[string, RegExp]> = [
  ["!isPlatformUser(u.role) && u.companyId …", /!isPlatformUser\(\s*\w+\??\.role\s*\)\s*&&\s*!{0,2}\w+\??\.companyId\b/],
  ["isPlatform… = !user.companyId", /\b(?:const|let)\s+\w*[Pp]latform\w*\s*=\s*!\s*\w+\??\.companyId\b/],
  ["u?.companyId && x !== u.companyId", /\b(\w+)\??\.companyId\s*&&[^;\n]*!==\s*\1!?\??\.companyId\b/],
  ["!user?.companyId || …", /!\s*(?:user|actingUser|u)\??\.companyId\s*\|\|/],
  ["sessionCompanyId && x && sessionCompanyId !== x", /\bsessionCompanyId\s*&&[^;\n]*!==/],
];
test("no legacy company-less authorization shapes in server code", () => {
  const hits: string[] = [];
  for (const f of serverFiles(path.resolve("server"))) {
    const rel = path.relative(process.cwd(), f).split(path.sep).join("/");
    if (LEGACY_SCAN_EXEMPT.has(rel)) continue;
    const lines = stripComments(fs.readFileSync(f, "utf8")).split("\n");
    lines.forEach((line, i) => {
      for (const [name, re] of LEGACY_PATTERNS) if (re.test(line)) hits.push(`${rel}:${i + 1} [${name}] ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(hits, [], `legacy shapes found — use canAccessStoredCompany()/authorizeStoredResource()/resolveListScope():\n${hits.join("\n")}`);
});
test("the legacy-shape detector actually matches the shapes it forbids", () => {
  const samples = [
    "if (!isPlatformUser(user?.role) && user?.companyId && run.companyId !== user.companyId) {",
    "const isTenant = !isPlatformUser(actingUser?.role) && !!actingUser?.companyId;",
    "const isPlatformUser = !user?.companyId;",
    "if (user?.companyId && r.companyId !== user.companyId) return res.status(403)",
    "const isAdmin = isAdminRole(user?.role) && (!user?.companyId || user.companyId === p.company_id);",
    "if (sessionCompanyId && compId && sessionCompanyId !== compId) {",
  ];
  for (const s of samples) assert.ok(LEGACY_PATTERNS.some(([, re]) => re.test(s)), s);
  assert.ok(!LEGACY_PATTERNS.some(([, re]) => re.test("if (!(await canAccessStoredCompany(user, run.companyId))) {")));
});

// ── 2. The primitives ────────────────────────────────────────────────────────
test("canAccessStoredCompany: missing actor → false, NULL owner → platform only, else canAccessCompany", () => {
  const b = stripComments(fnBody(routes, "async function canAccessStoredCompany("));
  assert.ok(/if \(!user\) return false;/.test(b));
  assert.ok(/if \(isPlatformCompanyBypassRole\(user\.role\)\) return true;/.test(b));
  assert.ok(/if \(!storedCompanyId\) return false;/.test(b));
  assert.ok(/return canAccessCompany\(user, storedCompanyId\);/.test(b));
  before(b, "if (!storedCompanyId) return false;", ["return canAccessCompany("]);
});
test("resolveListScope authorizes a supplied companyId and uses the pure decision", () => {
  const b = stripComments(fnBody(routes, "async function resolveListScope("));
  assert.ok(/normalizeListCompanyId\(requested\)/.test(b));
  assert.ok(/requestedAccessible: requestedCompanyId \? await canAccessCompany\(user, requestedCompanyId\)/.test(b));
  assert.ok(/decideListScope\(/.test(b));
  assert.ok(/isPlatformCompanyBypassRole\(user\.role\)/.test(b), "platform must come from the explicit role list, never a NULL companyId");
});
test("authorizeStoredResource uses the stored owner + pure decision", () => {
  const b = stripComments(fnBody(routes, "async function authorizeStoredResource("));
  assert.ok(/decideStoredResourceAccess\(/.test(b));
  assert.ok(/canAccessCompany\(user, storedCompanyId\)/.test(b));
  assert.ok(!/req\.(body|query|params)\??\.companyId/.test(b), "must never read a client companyId");
});
test("payroll-item owner is resolved through its payroll run", () => {
  const b = stripComments(fnBody(routes, "async function loadPayrollItemWithOwner("));
  assert.ok(/storage\.getPayrollRun\(item\.payrollRunId\)/.test(b));
  assert.ok(/companyId: run\?\.companyId \?\? null/.test(b));
});

// ── 3. Group A — list endpoints ──────────────────────────────────────────────
const LISTS: Array<[string, string]> = [
  ["/api/remittance-sources", "storage.getRemittanceSources("],
  ["/api/payroll-runs", "storage.getPayrollRuns("],
  ["/api/expenses", "storage.getExpenses("],
  ["/api/customers", "storage.getCustomers("],
  ["/api/funding-accounts", "storage.getFundingAccounts("],
  ["/api/time-off-requests", "storage.getTimeOffRequests("],
  ["/api/payroll-summary", "storage.getPayrollRuns("],
  ["/api/commissions", "storage."],
  ["/api/check-templates", "storage.getCheckTemplates("],
  ["/api/payroll-payment-methods", "storage.getPayrollPaymentMethods("],
  ["/api/payroll-payment-records", "storage.getPayrollPaymentRecords("],
  ["/api/worker-memberships", "storage.getWorkerMemberships("],
  ["/api/users", "storage.getUsers"],
];
for (const [p, query] of LISTS) {
  test(`GET ${p} scopes through resolveListScope() before querying`, () => {
    const b = routeBlock("get", p);
    before(b, "resolveListScope(", [query]);
    assert.ok(!/queryStr\(req\.query\.companyId\)\s*;\s*\n[^\n]*storage\./.test(b), "raw ?companyId must not reach storage");
  });
}
test("GET /api/1099-summaries/export authorizes the company before loading SSNs", () => {
  before(routeBlock("get", "/api/1099-summaries/export"), "canAccessStoredCompany(", ["storage.get1099Summaries(", "storage.getWorkers("]);
});

// ── 4. Groups B / C / E — by-id ──────────────────────────────────────────────
const BY_ID: Array<[string, string, string[]]> = [
  ["patch", "/api/pay-methods/:id", ["storage.updatePayMethod("]],
  ["delete", "/api/pay-methods/:id", ["storage.deletePayMethod("]],
  ["patch", "/api/payroll-items/:id", ["storage.updatePayrollItem("]],
  ["post", "/api/payroll-items/:id/amend", ["db.transaction("]],
  ["get", "/api/payroll-items/:id/taxes", ["storage.getPayrollItemTaxes("]],
  ["patch", "/api/payroll-items/:id/tax-override", ["storage.getPayrollItemTaxes(", "storage.createPayrollOverride("]],
  ["patch", "/api/time-punches/:id/approve", ["storage.updateTimePunch("]],
  ["patch", "/api/time-punches/:id", ["storage.updateTimePunch("]],
  ["delete", "/api/time-punches/:id", ["storage.deleteTimePunch("]],
  ["get", "/api/payroll-runs/:id/taxes", ["storage.getPayrollItemTaxesByRun("]],
  ["get", "/api/payroll-runs/:id/tax-snapshot", ["storage.getPayrollTaxSnapshot("]],
  ["get", "/api/payroll-runs/:id/tax-overrides", ["storage.getPayrollOverrides("]],
  ["get", "/api/payroll-runs/:id/ach-batch", ["storage.getAchBatch("]],
  ["get", "/api/payroll-runs/:id/agency-liabilities", ["storage.getPayrollItems("]],
  ["get", "/api/payroll-runs/:id/transaction-runs", ["storage.getPayrollTransactionRuns("]],
  ["get", "/api/payroll-runs/:id/compliance-events", ["storage.getComplianceAuditEvents("]],
  ["post", "/api/payroll-runs/:id/preflight", ["storage.getCompanyComplianceProfile("]],
  ["post", "/api/payroll-runs/:id/ai-review", ["storage.getWorkers("]],
  ["get", "/api/1099-summaries/:id", ["res.json(summary)"]],
  ["patch", "/api/1099-summaries/:id", ["storage.update1099Summary("]],
  ["post", "/api/1099-summaries/:id/mark-filed", ["storage.update1099Summary("]],
  ["get", "/api/time-off-requests/:id", ["res.json(item)"]],
  ["patch", "/api/time-off-requests/:id", ["storage.updateTimeOffRequest("]],
  ["delete", "/api/time-off-requests/:id", ["storage.deleteTimeOffRequest("]],
  ["get", "/api/compliance/worker/:workerId", ["storage.getWorkerComplianceProfile("]],
  ["patch", "/api/compliance/worker/:workerId/profile", ["storage.upsertWorkerComplianceProfile("]],
  ["delete", "/api/worker-documents/:id", ["storage.deleteWorkerDocument("]],
  ["patch", "/api/remittance-sources/:id", ["storage.updateRemittanceSource("]],
  ["delete", "/api/remittance-sources/:id", ["storage.deleteRemittanceSource("]],
  ["patch", "/api/customers/:id", ["storage.updateCustomer("]],
  ["delete", "/api/customers/:id", ["storage.deleteCustomer("]],
  ["patch", "/api/funding-accounts/:id", ["storage.updateFundingAccount("]],
  ["delete", "/api/funding-accounts/:id", ["storage.deleteFundingAccount("]],
  ["post", "/api/funding-accounts/:id/set-default", ["storage.updateFundingAccount("]],
  ["get", "/api/expenses/:id", ["res.json(r)"]],
  ["patch", "/api/expenses/:id", ["storage.updateExpense("]],
  ["delete", "/api/expenses/:id", ["storage.deleteExpense("]],
  ["post", "/api/expenses/:id/submit", ["storage.updateExpense("]],
  ["post", "/api/expenses/:id/approve", ["storage.updateExpense("]],
  ["post", "/api/expenses/:id/reject", ["storage.updateExpense("]],
  ["get", "/api/expenses/:id/attachments", ["storage.getExpenseAttachments("]],
  ["post", "/api/expenses/:id/attachments", ["storage.createExpenseAttachment("]],
  ["get", "/api/expenses/:id/audit", ["storage.getExpenseApprovalActions("]],
  ["patch", "/api/schedules/:id", ["storage.updateSchedule("]],
  ["delete", "/api/schedules/:id", ["storage.deleteSchedule("]],
];
for (const [m, p, laters] of BY_ID) {
  test(`${m.toUpperCase()} ${p} authorizes the STORED owner first`, () => {
    before(routeBlock(m, p), "authorizeStoredResource(", laters);
  });
}
test("DELETE /api/users/:id resolves the target and applies the provisioning decision", () => {
  const b = routeBlock("delete", "/api/users/:id");
  before(b, "storage.getUser(req.params.id)", ["storage.deleteUser("]);
  before(b, "evaluateUserProvisioning(", ["storage.deleteUser("]);
  assert.ok(/targetCompanyAccessible: await canAccessStoredCompany\(currentUser, target\.companyId\)/.test(b));
});
test("by-id PATCHes never write ownership fields from the body", () => {
  for (const [m, p] of [["patch", "/api/pay-methods/:id"], ["patch", "/api/payroll-items/:id"], ["patch", "/api/1099-summaries/:id"], ["patch", "/api/time-off-requests/:id"], ["patch", "/api/time-punches/:id"]]) {
    assert.ok(/stripOwnershipFields\(req\.body/.test(routeBlock(m, p)), `${m} ${p}`);
  }
});
test("expense PATCH cannot re-parent an expense to another company", () => {
  const b = routeBlock("patch", "/api/expenses/:id");
  const allowed = b.match(/const allowedFields = \[([\s\S]*?)\];/);
  assert.ok(allowed, "allowedFields list not found");
  assert.ok(!/"companyId"/.test(allowed![1]), "companyId must not be editable");
});
test("payroll check routes authorize the run's STORED company (no company-less bypass)", () => {
  for (const [m, p] of [["get", "/api/checks/:payrollItemId/pdf"], ["post", "/api/checks/:payrollItemId/void"],
    ["post", "/api/checks/:payrollItemId/reprint"], ["get", "/api/payroll-runs/:id/checks-pdf"], ["get", "/api/checks/calibration-pdf"]]) {
    assert.ok(/canAccessStoredCompany\(await storage\.getUser\(req\.session\.userId!\), /.test(routeBlock(m, p)), `${m} ${p}`);
  }
});
test("compliance worker read returns the minimal projection, never the full worker row", () => {
  const b = routeBlock("get", "/api/compliance/worker/:workerId");
  assert.ok(/worker: toComplianceWorker\(worker!\)/.test(b));
  assert.ok(!/events, worker \}\)/.test(b));
});
test("worker-document delete has no admin company-bypass", () => {
  const b = routeBlock("delete", "/api/worker-documents/:id");
  assert.ok(!/if \(user && !isAdminRole\(user\.role\)\)/.test(b));
  assert.ok(/loadWorkerDocumentOwner\(/.test(b));
});
test("system documents: writes are platform-admin only", () => {
  for (const [m, p] of [["post", "/api/system-documents"], ["patch", "/api/system-documents/:id"], ["delete", "/api/system-documents/:id"]]) {
    const b = routeBlock(m, p);
    assert.ok(b.startsWith(`app.${m}("${p}", requireAuth, requirePlatformAdminRole()`), `${m} ${p}`);
  }
});

// ── 5. Public proposal approval ──────────────────────────────────────────────
test("client-approve and portal approve share the share-token approval", () => {
  assert.ok(/approveProposalViaShareToken\(req, res\)/.test(routeBlock("post", "/api/contractor-proposals/:id/client-approve")));
  assert.ok(/approveProposalViaShareToken\(req, res\)/.test(routeBlock("post", "/api/portal/proposals/:id/approve")));
  const f = stripComments(fnBody(routes, "async function approveProposalViaShareToken("));
  before(f, "validatePortalToken(", ["UPDATE contractor_proposals"]);
  assert.ok(/AND share_token = \$\{token\}/.test(f), "update must re-check the token");
  assert.ok(/AND status IN \('sent', 'viewed', 'negotiated', 'countered'\)/.test(f), "update must be conditional (replay-safe)");
  assert.ok(/RETURNING id/.test(f));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
