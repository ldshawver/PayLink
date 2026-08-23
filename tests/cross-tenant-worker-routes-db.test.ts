/**
 * Phase 0.5s — cross-tenant negative tests for the five worker routes
 * identified by the Phase 0.5r storage-scope trace
 * (docs/saas-readiness/storage-scope-trace-manifest.json): GET /api/workers,
 * POST /api/workers, PATCH /api/workers/:id, DELETE /api/workers/:id, and
 * GET /api/workers/:id/ytd-taxes.
 *
 * This test boots the REAL, unmodified application server (server/index.ts)
 * against a disposable Postgres database, creates two synthetic tenants with
 * real authenticated sessions (via the real POST /api/auth/login route, not
 * a mock), and exercises each route's actual authorization logic over real
 * HTTP requests. It is deliberately not a mock — the whole point is to
 * observe what the real route does, not what we assume it does.
 *
 * Originally an audit test documenting two verified authorization gaps
 * (PR #84 / docs/saas-readiness/phase-0.5s-cross-tenant-findings.md):
 * PATCH /api/workers/:id allowed a tenant admin to reassign a worker to
 * another tenant via companyId in the update body, and
 * GET /api/workers/:id/ytd-taxes had no tenant ownership check at all. Both
 * are now repaired (saas/phase0.5-worker-tenant-hardening) and this file
 * carries forward as their regression coverage — the two matrix cases that
 * previously FAILed now assert the fixed (safe) behavior instead. It is
 * registered in the "db" suite (blocksMerge: false, per
 * scripts/test-suites.json), requires an explicit TEST_DATABASE_URL, and
 * skips cleanly when that is absent.
 *
 * SAFETY: requires TEST_DATABASE_URL to point at a disposable database,
 * refuses staging/production-shaped names/hosts, aborts if TEST_DATABASE_URL
 * equals DATABASE_URL, and verifies current_database() before any write.
 * Cleanup is a generic FK-aware cascade delete rooted at the two synthetic
 * company ids (scripts/cross-tenant-negative-tests/cascade-cleanup.ts) run in
 * a `finally` block — this also correctly removes side-effect rows the real
 * server creates on its own (observed: default departments/locations
 * auto-provisioned at startup), which a hand-maintained table list would
 * miss. Cleanup is then verified by re-querying for any remaining row.
 * Session cookies, password hashes, and the connection string are never
 * logged — only PASS/FAIL/INCONCLUSIVE outcomes and non-sensitive route
 * response shapes.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable_db npx tsx tests/cross-tenant-worker-routes-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import fs from "node:fs";
import { startTestServer, login, apiRequest, type TestServer, type Session } from "../scripts/cross-tenant-negative-tests/server-harness";
import { cascadeDelete, verifyZeroResidue } from "../scripts/cross-tenant-negative-tests/cascade-cleanup";

const FORBIDDEN_PATTERNS = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];
const MANIFEST_PATH = "docs/saas-readiness/cross-tenant-test-manifest.json";

type Disposition = "PASS" | "FAIL" | "INCONCLUSIVE" | "EXPECTED GLOBAL" | "N/A";

interface CaseResult {
  case: string;
  disposition: Disposition;
  detail: string;
}

interface RouteResult {
  id: string;
  source: string;
  storageScopeTraceDisposition: string;
  cases: CaseResult[];
}

/**
 * Every fixture row this test creates — companies, users, workers, and the
 * payroll fixture — is transitively keyed by company_id (directly or, for
 * payroll_items/payroll_item_taxes, through payroll_runs), as is anything
 * the running application server itself adds as a side effect (observed:
 * default departments/locations auto-provisioned on server startup). So a
 * single FK-aware cascade delete rooted at the two synthetic company ids is
 * both sufficient and more correct than a hand-maintained table list — see
 * scripts/cross-tenant-negative-tests/cascade-cleanup.ts.
 */
async function cleanupFixtures(pool: Pool, companyIds: string[]): Promise<Array<{ table: string; column: string; count: number }>> {
  const deletions = await cascadeDelete(pool, "companies", companyIds);
  const leftovers = await verifyZeroResidue(pool, "companies", companyIds);
  if (leftovers.length > 0) {
    throw new Error(`Cleanup verification failed — leftover rows: ${leftovers.join("; ")}`);
  }
  return deletions;
}

async function main() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    console.log("TEST_DATABASE_URL not set — skipping cross-tenant worker-route tests (0 run).");
    return;
  }
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(testDatabaseUrl)) {
      throw new Error("TEST_DATABASE_URL looks like it points at staging/production. Refusing to run.");
    }
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is identical to DATABASE_URL. Refusing to run against what may be the app's real database.");
  }

  const pool = new Pool({ connectionString: testDatabaseUrl, max: 4 });
  const companyIds: string[] = [];
  const routeResults: RouteResult[] = [];
  let harnessOk = true;
  let server: TestServer | undefined;

  function record(routeId: string, source: string, disposition_of_route: string, caseResults: CaseResult[]) {
    routeResults.push({ id: routeId, source, storageScopeTraceDisposition: disposition_of_route, cases: caseResults });
  }

  try {
    const dbNameRes = await pool.query("SELECT current_database() AS name");
    const dbName = dbNameRes.rows[0]?.name as string;
    if (FORBIDDEN_PATTERNS.some((p) => p.test(dbName))) {
      throw new Error(`current_database() = "${dbName}" looks like staging/production. Refusing to run.`);
    }

    // ── Fixtures: two synthetic tenants, never real data ─────────────────────
    const suffix = crypto.randomBytes(4).toString("hex");
    const companyA = crypto.randomUUID();
    const companyB = crypto.randomUUID();
    companyIds.push(companyA, companyB);
    await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2), ($3, $4)`, [companyA, `CT Test Tenant A ${suffix}`, companyB, `CT Test Tenant B ${suffix}`]);

    const pwPlain = crypto.randomBytes(12).toString("hex");
    const pwHash = await bcrypt.hash(pwPlain, 10);

    const userAAdmin = crypto.randomUUID();
    const userAEmployee = crypto.randomUUID();
    const userBAdmin = crypto.randomUUID();

    const workerASelf = crypto.randomUUID(); // owned by userAEmployee, for the self-filter check
    const workerATarget = crypto.randomUUID(); // company A's "own record" target for update/read tests
    const workerADelete = crypto.randomUUID(); // company A's disposable delete target
    const workerB = crypto.randomUUID(); // company B's record — never expected to be reachable by tenant A

    await pool.query(
      `INSERT INTO workers (id, company_id, first_name, last_name, worker_type, pay_rate, employee_number) VALUES
       ($1,$2,'CtSelf','WorkerA','employee','0','9001'),
       ($3,$2,'CtTarget','WorkerA','employee','0','9002'),
       ($4,$2,'CtDelete','WorkerA','employee','0','9003'),
       ($5,$6,'CtOther','WorkerB','employee','0','9004')`,
      [workerASelf, companyA, workerATarget, workerADelete, workerB, companyB],
    );

    const usernameAAdmin = `ct_a_admin_${suffix}`;
    const usernameAEmployee = `ct_a_employee_${suffix}`;
    const usernameBAdmin = `ct_b_admin_${suffix}`;
    await pool.query(
      `INSERT INTO users (id, username, password, role, company_id, worker_id, first_name, last_name, is_active) VALUES
       ($1,$2,$3,'admin',$4,NULL,'CT','AdminA', true),
       ($5,$6,$3,'employee',$4,$7,'CT','EmployeeA', true),
       ($8,$9,$3,'admin',$10,NULL,'CT','AdminB', true)`,
      [userAAdmin, usernameAAdmin, pwHash, companyA, userAEmployee, usernameAEmployee, workerASelf, userBAdmin, usernameBAdmin, companyB],
    );

    // A nonzero payroll fixture for company B's worker — proves an actual
    // cross-tenant *data* leak (not just an empty/zeroed response) if tenant
    // A can read it via GET /api/workers/:id/ytd-taxes.
    const payrollRunB = crypto.randomUUID();
    const payrollItemB = crypto.randomUUID();
    const payrollItemTaxB = crypto.randomUUID();
    const year = new Date().getFullYear();
    await pool.query(
      `INSERT INTO payroll_runs (id, company_id, period_start, period_end, pay_date, status) VALUES ($1,$2,$3,$4,$5,'processed')`,
      [payrollRunB, companyB, `${year}-06-01`, `${year}-06-15`, `${year}-06-15`],
    );
    await pool.query(`INSERT INTO payroll_items (id, payroll_run_id, worker_id, gross_pay, net_pay) VALUES ($1,$2,$3,$4,$5)`, [payrollItemB, payrollRunB, workerB, "4321.00", "3500.00"]);
    await pool.query(
      // tax_code must be "fed_income_tax" — the exact string storage.getEmployeeYTD() (server/storage.ts:5007) checks; any other value is silently excluded from the totals.
      `INSERT INTO payroll_item_taxes (id, payroll_item_id, tax_code, tax_name, amount, taxable_wages) VALUES ($1,$2,'fed_income_tax','Federal Income Tax',$3,$4)`,
      [payrollItemTaxB, payrollItemB, "650.00", "4321.00"],
    );

    // ── Boot the real server against this disposable database ────────────────
    server = await startTestServer(testDatabaseUrl);
    const baseUrl = server.baseUrl;

    const sessionAAdmin: Session = await login(baseUrl, usernameAAdmin, pwPlain);
    const sessionAEmployee: Session = await login(baseUrl, usernameAEmployee, pwPlain);

    // ══════════════════════ GET /api/workers ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "GET", "/api/workers", sessionAAdmin);
      const listA = Array.isArray(r1.body) ? (r1.body as Array<{ id: string; companyId: string }>) : [];
      const containsOwn = listA.some((w) => w.id === workerATarget);
      const leaksB = listA.some((w) => w.companyId === companyB);
      cases.push({
        case: "1. Tenant A admin lists workers (own-tenant access)",
        disposition: r1.status === 200 && containsOwn && !leaksB ? "PASS" : "FAIL",
        detail: `status=${r1.status} containsOwnRecord=${containsOwn} leaksTenantB=${leaksB}`,
      });

      const r3 = await apiRequest(baseUrl, "GET", `/api/workers?companyId=${companyB}`, sessionAAdmin);
      const listA2 = Array.isArray(r3.body) ? (r3.body as Array<{ companyId: string }>) : [];
      const leaksB2 = listA2.some((w) => w.companyId === companyB);
      cases.push({
        case: "3. Tenant A admin submits Tenant B companyId as a query param",
        disposition: r3.status === 200 && !leaksB2 ? "PASS" : "FAIL",
        detail: `Non-platform role: session-derived companyId is used, client-supplied ?companyId is ignored per source (server/routes.ts:2186-2198). status=${r3.status} leaksTenantB=${leaksB2}`,
      });
      cases.push({ case: "2. by-ID access / 4. ID+companyId combos", disposition: "N/A", detail: "Route has no :id param — not applicable to a list endpoint." });

      const rEmp = await apiRequest(baseUrl, "GET", "/api/workers", sessionAEmployee);
      const listEmp = Array.isArray(rEmp.body) ? (rEmp.body as Array<{ id: string }>) : [];
      const selfOnly = listEmp.length === 1 && listEmp[0]?.id === workerASelf;
      cases.push({
        case: "5. Non-manager role (employee) within the correct tenant",
        disposition: rEmp.status === 200 && selfOnly ? "PASS" : "FAIL",
        detail: `No role rejection is used here — the route instead filters to the caller's own worker record only (server/routes.ts:2169-2173). status=${rEmp.status} selfOnly=${selfOnly} returnedCount=${listEmp.length}`,
      });

      const r6 = await apiRequest(baseUrl, "GET", "/api/workers", null);
      cases.push({ case: "6. Missing authentication", disposition: r6.status === 401 ? "PASS" : "FAIL", detail: `status=${r6.status}` });

      record("GET /api/workers", "server/routes.ts:2161", "needs-runtime-hardening", cases);
    }

    // ══════════════════════ POST /api/workers ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "POST", "/api/workers", sessionAAdmin, { companyId: companyA, firstName: "CtNew", lastName: "WorkerA", workerType: "employee", payRate: "20" });
      const createdId = (r1.body as { id?: string } | undefined)?.id;
      // No separate cleanup tracking needed — it's company_id-scoped to companyA, which the final cascade delete already covers.
      cases.push({ case: "1. Tenant A admin creates a worker in Tenant A", disposition: r1.status === 201 && !!createdId ? "PASS" : "FAIL", detail: `status=${r1.status}` });

      const beforeCountB = (await pool.query(`SELECT count(*) FROM workers WHERE company_id = $1`, [companyB])).rows[0].count;
      const r3 = await apiRequest(baseUrl, "POST", "/api/workers", sessionAAdmin, { companyId: companyB, firstName: "CtInject", lastName: "IntoB", workerType: "employee", payRate: "20" });
      const afterCountB = (await pool.query(`SELECT count(*) FROM workers WHERE company_id = $1`, [companyB])).rows[0].count;
      const noWriteOccurred = beforeCountB === afterCountB;
      const bodySafe = JSON.stringify(r3.body ?? "").length < 500 && !JSON.stringify(r3.body ?? "").match(/stack|SELECT|INSERT|password/i);
      cases.push({
        case: "3. Tenant A admin submits Tenant B companyId in the create body",
        disposition: r3.status === 403 && noWriteOccurred && bodySafe ? "PASS" : "FAIL",
        detail: `Guarded by an inline ownership check (server/routes.ts:2266-2270). status=${r3.status} noWriteOccurred=${noWriteOccurred} errorBodySafe=${bodySafe}`,
      });
      cases.push({ case: "2. / 4. by-ID combos", disposition: "N/A", detail: "Create has no existing-record ID to combine." });

      const rEmp = await apiRequest(baseUrl, "POST", "/api/workers", sessionAEmployee, { companyId: companyA, firstName: "CtBlocked", lastName: "ByRole", workerType: "employee", payRate: "20" });
      cases.push({ case: "5. Unauthorized role (employee) within the correct tenant", disposition: rEmp.status === 403 ? "PASS" : "FAIL", detail: `requireRole("admin","manager") — employee is neither. status=${rEmp.status}` });

      const r6 = await apiRequest(baseUrl, "POST", "/api/workers", null, { companyId: companyA, firstName: "X", lastName: "Y" });
      cases.push({ case: "6. Missing authentication", disposition: r6.status === 401 ? "PASS" : "FAIL", detail: `status=${r6.status}` });

      record("POST /api/workers", "server/routes.ts:2260", "needs-runtime-hardening", cases);
    }

    // ══════════════════════ PATCH /api/workers/:id ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "PATCH", `/api/workers/${workerATarget}`, sessionAAdmin, { lastName: "UpdatedByA" });
      cases.push({ case: "1. Tenant A admin updates a Tenant A worker", disposition: r1.status === 200 ? "PASS" : "FAIL", detail: `status=${r1.status}` });

      // Omitting companyId entirely must preserve the worker's existing company.
      const rOmit = await apiRequest(baseUrl, "PATCH", `/api/workers/${workerATarget}`, sessionAAdmin, { lastName: "OmitCompanyId" });
      const afterOmit = (await pool.query(`SELECT company_id, last_name FROM workers WHERE id = $1`, [workerATarget])).rows[0];
      cases.push({
        case: "Omitting companyId preserves the worker's existing company",
        disposition: rOmit.status === 200 && afterOmit.company_id === companyA && afterOmit.last_name === "OmitCompanyId" ? "PASS" : "FAIL",
        detail: `status=${rOmit.status} companyId=${afterOmit.company_id} lastNameUpdated=${afterOmit.last_name === "OmitCompanyId"}`,
      });

      // Submitting the SAME companyId is a harmless no-op — it must not be rejected.
      const rSame = await apiRequest(baseUrl, "PATCH", `/api/workers/${workerATarget}`, sessionAAdmin, { companyId: companyA, lastName: "SameCompanyId" });
      const afterSame = (await pool.query(`SELECT company_id, last_name FROM workers WHERE id = $1`, [workerATarget])).rows[0];
      cases.push({
        case: "Submitting the same (current) companyId succeeds and does not change tenancy",
        disposition: rSame.status === 200 && afterSame.company_id === companyA && afterSame.last_name === "SameCompanyId" ? "PASS" : "FAIL",
        detail: `status=${rSame.status} companyId=${afterSame.company_id}`,
      });

      const beforeB = (await pool.query(`SELECT last_name FROM workers WHERE id = $1`, [workerB])).rows[0];
      const r2 = await apiRequest(baseUrl, "PATCH", `/api/workers/${workerB}`, sessionAAdmin, { lastName: "HackedByA" });
      const afterB = (await pool.query(`SELECT last_name FROM workers WHERE id = $1`, [workerB])).rows[0];
      const unchanged = beforeB.last_name === afterB.last_name;
      cases.push({
        case: "2. Tenant A admin accesses a Tenant B worker by ID",
        disposition: (r2.status === 403 || r2.status === 404) && unchanged ? "PASS" : "FAIL",
        detail: `Guarded by an inline ownership check (server/routes.ts:2317-2326). status=${r2.status} rowUnchanged=${unchanged}`,
      });

      // 4a. Tenant A's own record ID + Tenant B's companyId, combined with another field
      // change in the SAME request — proves the whole request is rejected atomically, not
      // just the companyId field (no partial update).
      const before4a = (await pool.query(`SELECT company_id, last_name FROM workers WHERE id = $1`, [workerATarget])).rows[0];
      const r4a = await apiRequest(baseUrl, "PATCH", `/api/workers/${workerATarget}`, sessionAAdmin, { companyId: companyB, lastName: "ShouldNotApply" });
      const after4a = (await pool.query(`SELECT company_id, last_name FROM workers WHERE id = $1`, [workerATarget])).rows[0];
      const noPartialUpdate = before4a.company_id === after4a.company_id && before4a.last_name === after4a.last_name;
      cases.push({
        case: "4a. Tenant A's own worker ID + Tenant B's companyId in the update body — rejected, no partial update",
        disposition: r4a.status === 403 && noPartialUpdate ? "PASS" : "FAIL",
        detail: `Repaired: companyId is immutable through this endpoint (server/routes.ts:2317-2340) — rejected before any mutation. status=${r4a.status} companyIdUnchanged=${before4a.company_id === after4a.company_id} lastNameUnchanged=${before4a.last_name === after4a.last_name}`,
      });

      // 4b. Tenant B's record ID + Tenant A's companyId (already blocked by the ownership guard itself).
      const r4b = await apiRequest(baseUrl, "PATCH", `/api/workers/${workerB}`, sessionAAdmin, { companyId: companyA });
      const afterB2 = (await pool.query(`SELECT company_id FROM workers WHERE id = $1`, [workerB])).rows[0].company_id;
      cases.push({
        case: "4b. Tenant B's worker ID + Tenant A's companyId in the update body",
        disposition: (r4b.status === 403 || r4b.status === 404) && afterB2 === companyB ? "PASS" : "FAIL",
        detail: `status=${r4b.status} companyIdUnchanged=${afterB2 === companyB}`,
      });

      const rEmp = await apiRequest(baseUrl, "PATCH", `/api/workers/${workerATarget}`, sessionAEmployee, { lastName: "ByEmployee" });
      cases.push({ case: "5. Unauthorized role (employee) within the correct tenant", disposition: rEmp.status === 403 ? "PASS" : "FAIL", detail: `requireRole("admin","manager"). status=${rEmp.status}` });

      const r6 = await apiRequest(baseUrl, "PATCH", `/api/workers/${workerATarget}`, null, { lastName: "NoAuth" });
      cases.push({ case: "6. Missing authentication", disposition: r6.status === 401 ? "PASS" : "FAIL", detail: `status=${r6.status}` });

      record("PATCH /api/workers/:id", "server/routes.ts:2315", "repaired — companyId immutable through this endpoint", cases);
    }

    // ══════════════════════ DELETE /api/workers/:id ══════════════════════
    {
      const cases: CaseResult[] = [];
      const existsBBefore = (await pool.query(`SELECT 1 FROM workers WHERE id = $1`, [workerB])).rows.length > 0;
      const r2 = await apiRequest(baseUrl, "DELETE", `/api/workers/${workerB}`, sessionAAdmin);
      const existsBAfter = (await pool.query(`SELECT 1 FROM workers WHERE id = $1`, [workerB])).rows.length > 0;
      cases.push({
        case: "2. Tenant A admin deletes a Tenant B worker by ID",
        disposition: (r2.status === 403 || r2.status === 404) && existsBBefore && existsBAfter ? "PASS" : "FAIL",
        detail: `Guarded by an inline ownership check (server/routes.ts:2349-2354). status=${r2.status} stillExists=${existsBAfter}`,
      });

      const rEmp = await apiRequest(baseUrl, "DELETE", `/api/workers/${workerATarget}`, sessionAEmployee);
      cases.push({ case: "5. Unauthorized role (employee) within the correct tenant", disposition: rEmp.status === 403 ? "PASS" : "FAIL", detail: `requireRole("admin") only — even "manager" would be rejected here. status=${rEmp.status}` });

      const r6 = await apiRequest(baseUrl, "DELETE", `/api/workers/${workerATarget}`, null);
      cases.push({ case: "6. Missing authentication", disposition: r6.status === 401 ? "PASS" : "FAIL", detail: `status=${r6.status}` });

      // 1. Own-tenant delete, run last so it doesn't remove workerATarget before the tests above reuse it.
      const r1 = await apiRequest(baseUrl, "DELETE", `/api/workers/${workerADelete}`, sessionAAdmin);
      const goneAfter = (await pool.query(`SELECT 1 FROM workers WHERE id = $1`, [workerADelete])).rows.length === 0;
      cases.push({ case: "1. Tenant A admin deletes a Tenant A worker", disposition: r1.status === 200 && goneAfter ? "PASS" : "FAIL", detail: `status=${r1.status} rowGone=${goneAfter}` });

      cases.push({ case: "4. by-ID+companyId combos", disposition: "N/A", detail: "DELETE takes no request body — the companyId-in-body combo tested for PATCH does not apply here." });

      record("DELETE /api/workers/:id", "server/routes.ts:2343", "needs-runtime-hardening", cases);
    }

    // ══════════════════════ GET /api/workers/:id/ytd-taxes ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "GET", `/api/workers/${workerATarget}/ytd-taxes?year=${year}`, sessionAAdmin);
      const grossA = (r1.body as { grossPay?: number } | undefined)?.grossPay;
      // workerATarget has no payroll fixture of its own — any nonzero figure here could
      // only have leaked in from Tenant B's fixture, so this also proves the aggregation
      // itself is company-scoped, not just the route-level authorization check.
      cases.push({
        case: "1. Tenant A admin reads a Tenant A worker's YTD taxes (and the aggregation includes no Tenant B data)",
        disposition: r1.status === 200 && grossA === 0 ? "PASS" : "FAIL",
        detail: `status=${r1.status} grossPay=${grossA}`,
      });

      const r2 = await apiRequest(baseUrl, "GET", `/api/workers/${workerB}/ytd-taxes?year=${year}`, sessionAAdmin);
      const gross = (r2.body as { grossPay?: number } | undefined)?.grossPay;
      const leakedNonzeroData = r2.status === 200 && typeof gross === "number" && gross > 0;
      cases.push({
        case: "2. Tenant A admin reads a Tenant B worker's YTD taxes by ID — rejected",
        disposition: !leakedNonzeroData && r2.status === 404 ? "PASS" : "FAIL",
        detail: `Repaired: tenant ownership is checked before any aggregation (server/routes.ts:7795-7815). status=${r2.status} grossPayLeaked=${leakedNonzeroData}`,
      });

      // The rejection for a real-but-foreign-tenant worker id must be byte-for-byte
      // identical to a genuinely nonexistent id — same status, same body — so this
      // endpoint can't be used to enumerate which worker ids exist in another tenant.
      const randomNonexistentId = crypto.randomUUID();
      const rNonexistent = await apiRequest(baseUrl, "GET", `/api/workers/${randomNonexistentId}/ytd-taxes?year=${year}`, sessionAAdmin);
      const indistinguishable = r2.status === rNonexistent.status && JSON.stringify(r2.body) === JSON.stringify(rNonexistent.body);
      cases.push({
        case: "Foreign-tenant response is indistinguishable from a genuinely nonexistent worker",
        disposition: rNonexistent.status === 404 && indistinguishable ? "PASS" : "FAIL",
        detail: `foreignTenantStatus=${r2.status} nonexistentStatus=${rNonexistent.status} identicalBody=${indistinguishable}`,
      });

      const rEmp = await apiRequest(baseUrl, "GET", `/api/workers/${workerATarget}/ytd-taxes?year=${year}`, sessionAEmployee);
      cases.push({
        case: "5. Unauthorized same-tenant role (employee) is rejected",
        disposition: rEmp.status === 403 ? "PASS" : "FAIL",
        detail: `Repaired: role gate narrowed to requireRole("admin","manager") to match the sibling GET /api/companies/:id/ytd-taxes route (server/routes.ts:7795, 7812) — a payroll/tax report is not an ordinary self-service view. status=${rEmp.status}`,
      });

      const r6 = await apiRequest(baseUrl, "GET", `/api/workers/${workerATarget}/ytd-taxes?year=${year}`, null);
      cases.push({ case: "6. Missing authentication", disposition: r6.status === 401 ? "PASS" : "FAIL", detail: `status=${r6.status}` });

      record("GET /api/workers/:id/ytd-taxes", "server/routes.ts:7795", "repaired — tenant-scoped, admin/manager only", cases);
    }

    // ── Write the machine-readable manifest ───────────────────────────────────
    const allCases = routeResults.flatMap((r) => r.cases);
    const summary = {
      PASS: allCases.filter((c) => c.disposition === "PASS").length,
      FAIL: allCases.filter((c) => c.disposition === "FAIL").length,
      INCONCLUSIVE: allCases.filter((c) => c.disposition === "INCONCLUSIVE").length,
      "EXPECTED GLOBAL": allCases.filter((c) => c.disposition === "EXPECTED GLOBAL").length,
      "N/A": allCases.filter((c) => c.disposition === "N/A").length,
    };
    const manifest = {
      generatedAt: new Date().toISOString().slice(0, 10),
      version: 1,
      sourceStorageScopeTraceManifest: "docs/saas-readiness/storage-scope-trace-manifest.json",
      routesTested: routeResults.length,
      summary,
      routes: routeResults,
    };
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");

    console.log(`\n=== Cross-tenant worker-route test matrix ===`);
    for (const r of routeResults) {
      console.log(`\n${r.id}  (${r.source})`);
      for (const c of r.cases) {
        const marker = c.disposition === "PASS" ? "✓" : c.disposition === "FAIL" ? "✗" : "•";
        console.log(`  ${marker} [${c.disposition}] ${c.case}`);
      }
    }
    console.log(`\nSummary: ${summary.PASS} PASS, ${summary.FAIL} FAIL, ${summary.INCONCLUSIVE} INCONCLUSIVE, ${summary["EXPECTED GLOBAL"]} EXPECTED GLOBAL, ${summary["N/A"]} N/A`);
    console.log(`Manifest written to ${MANIFEST_PATH}`);

    if (summary.FAIL > 0) {
      console.error(`\n${summary.FAIL} case(s) FAILed — either a regression in the two PATCH/ytd-taxes repairs from saas/phase0.5-worker-tenant-hardening, or a new gap. See ${MANIFEST_PATH} and docs/saas-readiness/phase-0.5s-cross-tenant-findings.md.`);
      process.exitCode = 1;
    } else {
      console.log(`\nAll cases PASS — the two PATCH /api/workers/:id and GET /api/workers/:id/ytd-taxes defects verified in PR #84 are confirmed repaired.`);
    }
  } catch (e) {
    harnessOk = false;
    throw e;
  } finally {
    if (server) await server.stop();
    try {
      const deletions = await cleanupFixtures(pool, companyIds);
      if (harnessOk) console.log(`Cleanup verified: zero synthetic rows remain. Deleted: ${deletions.map((d) => `${d.table}(${d.count})`).join(", ")}`);
    } finally {
      await pool.end();
    }
  }
}

main()
  .catch((e) => {
    console.error("Test run failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => {
    // The real app server's client (fetch/undici keep-alive sockets) and/or
    // the pg Pool can leave the event loop non-empty even after every
    // resource is explicitly closed above — observed in practice: cleanup
    // completes and logs successfully, but the process does not exit on its
    // own. Force it once everything above has actually finished, rather than
    // leaving this (and anything that shells out to it, e.g. scripts/run-
    // tests.ts) to hang until an external timeout kills it.
    process.exit(process.exitCode ?? 0);
  });
