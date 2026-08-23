/**
 * Phase 0.5 — cross-tenant negative tests, batch 2: the next nine
 * highest-risk routes selected from the committed storage-scope-trace
 * manifest (docs/saas-readiness/storage-scope-trace-manifest.json),
 * prioritized payroll/tax > payment/invoice mutations > compensation >
 * contract/document access > company/tenant administration, excluding the
 * five worker routes already covered by
 * tests/cross-tenant-worker-routes-db.test.ts (saas/phase0.5-worker-tenant-hardening).
 *
 * Routes tested (manifest id | disposition | confidence | source):
 *   1. GET  /api/payroll-runs/:id/summary            | needs-runtime-hardening | high   | server/routes.ts:5714
 *   2. PATCH /api/payroll-runs/:id                    | needs-runtime-hardening | high   | server/routes.ts:8209
 *   3. DELETE /api/payroll-runs/:id                   | needs-runtime-hardening | high   | server/routes.ts:5752
 *   4. PATCH /api/invoices/:id                        | needs-runtime-hardening | high   | server/routes.ts:24833
 *   5. DELETE /api/invoices/:id                       | needs-runtime-hardening | high   | server/routes.ts:24849
 *   6. POST  /api/contractor-invoices/:id/mark-paid   | needs-runtime-hardening | high   | server/routes.ts:10866
 *   7. POST  /api/contractor-trade-compensation/:id/approve | needs-negative-test | medium | server/routes.ts:22524
 *   8. GET  /api/dam-documents/:id                    | needs-negative-test    | medium | server/routes.ts:16609
 *   9. PATCH /api/companies/:id                       | needs-runtime-hardening | high   | server/routes.ts:2128
 *
 * Why each was chosen (priority order, per this batch's selection criteria):
 *   1-3. Payroll run data/mutations — the highest-risk category. #1 mirrors
 *        the exact already-fixed GET .../ytd-taxes pattern (id-only fetch,
 *        no company comparison anywhere in route or storage layer) and was
 *        flagged "high" confidence for that reason. #2/#3 already show a
 *        company-ownership guard in the route source, but #2 applies
 *        req.body to storage.updatePayrollRun(id, req.body) verbatim with
 *        no companyId-immutability check — the exact shape of the
 *        already-fixed PATCH /api/workers/:id defect — so it's tested for
 *        that specific gap empirically, not assumed safe from the guard's
 *        presence alone.
 *   4-5. Invoice mutations — no company-ownership check of any kind is
 *        visible in either route handler; storage.updateInvoice applies
 *        data verbatim. High-confidence, direct financial-record risk.
 *   6.   POST mark-paid — id-only fetch (storage.getContractorInvoice), no
 *        company comparison anywhere, then mutates payment status and
 *        triggers a notification/email side effect using the fetched
 *        record's own data — a real payment-state mutation, not just a read.
 *   7.   The only category-3 (compensation) candidate in the manifest.
 *        Route source shows an explicit canAccessCompany() guard — tested
 *        to confirm that guard actually holds under a live cross-tenant
 *        attempt, not just to assume it from static reading.
 *   8.   Document-hub read fitting the pattern that mattered most in batch
 *        1 (id-only fetch of sensitive per-tenant data) — route source
 *        shows explicit ownership checks (worker match or
 *        canAccessCompany), tested the same way as #7.
 *   9.   PATCH /api/companies/:id has requireRole("admin","manager") and
 *        NO company-ownership comparison anywhere — an admin/manager in
 *        any tenant can target any other company's :id. storage.updateCompany
 *        applies data verbatim. Highest-severity candidate in this batch:
 *        arbitrary cross-tenant company-record mutation, not just a read.
 *
 * Methodology matches tests/cross-tenant-worker-routes-db.test.ts exactly:
 * boots the REAL, unmodified application server (server/index.ts) against a
 * disposable Postgres database, creates two synthetic tenants with real
 * authenticated sessions via the real POST /api/auth/login route, and
 * exercises each route's actual authorization logic over real HTTP
 * requests. Not a mock.
 *
 * This is a TEST-FIRST / AUDIT-FIRST branch: no runtime repair is made here
 * for any defect this file verifies. Verified defects are documented in
 * docs/saas-readiness/phase-0.5-batch-2-cross-tenant-findings.md and this
 * file preserves the minimal reproducing case as a FAIL, exactly as batch 1
 * did before its follow-up hardening branch.
 *
 * SAFETY: requires TEST_DATABASE_URL to point at a disposable database,
 * refuses staging/production-shaped names/hosts, aborts if TEST_DATABASE_URL
 * equals DATABASE_URL, and verifies current_database() before any write.
 * Cleanup is the same generic FK-aware cascade delete rooted at the two
 * synthetic company ids (scripts/cross-tenant-negative-tests/cascade-cleanup.ts),
 * run in a `finally` block and independently re-verified afterward. Session
 * cookies, password hashes, and the connection string are never logged —
 * only PASS/FAIL/INCONCLUSIVE/EXPECTED GLOBAL/N/A outcomes and
 * non-sensitive route response shapes (booleans/status codes), never actual
 * dollar amounts or document contents.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable_db npx tsx tests/cross-tenant-batch-2-routes-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import fs from "node:fs";
import { startTestServer, login, apiRequest, type TestServer, type Session } from "../scripts/cross-tenant-negative-tests/server-harness";
import { cascadeDelete, verifyZeroResidue } from "../scripts/cross-tenant-negative-tests/cascade-cleanup";

const FORBIDDEN_PATTERNS = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];
const MANIFEST_PATH = "docs/saas-readiness/cross-tenant-batch-2-test-manifest.json";

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
    console.log("TEST_DATABASE_URL not set — skipping cross-tenant batch-2 tests (0 run).");
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
    await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2), ($3, $4)`, [companyA, `CT2 Test Tenant A ${suffix}`, companyB, `CT2 Test Tenant B ${suffix}`]);

    const pwPlain = crypto.randomBytes(12).toString("hex");
    const pwHash = await bcrypt.hash(pwPlain, 10);

    const userAAdmin = crypto.randomUUID();
    const userAEmployee = crypto.randomUUID();
    const userBAdmin = crypto.randomUUID();
    const userPlatformOwner = crypto.randomUUID();
    const usernameAAdmin = `ct2_a_admin_${suffix}`;
    const usernameAEmployee = `ct2_a_employee_${suffix}`;
    const usernameBAdmin = `ct2_b_admin_${suffix}`;
    const usernamePlatformOwner = `ct2_platform_owner_${suffix}`;
    // A random id never inserted into any table — used to test the "nonexistent
    // resource" case for each route, distinct from a real foreign-tenant id.
    const nonexistentId = crypto.randomUUID();

    // A worker per tenant for the contractor_invoices.contractor_id FK target, plus a
    // distinct worker for the Tenant A employee session — deliberately NOT null and NOT
    // the same worker any fixture document is linked to, so a same-tenant-employee
    // ownership check is tested against a real, non-matching worker_id rather than a
    // null-vs-null coincidence that would pass a loose `!==` comparison for the wrong reason.
    const workerAContractor = crypto.randomUUID();
    const workerBContractor = crypto.randomUUID();
    const workerAEmployeeSelf = crypto.randomUUID();
    await pool.query(
      `INSERT INTO workers (id, company_id, first_name, last_name, worker_type, pay_rate, employee_number) VALUES
       ($1,$2,'CT2','ContractorA','contractor','0','9101'),
       ($3,$4,'CT2','ContractorB','contractor','0','9102'),
       ($5,$2,'CT2','EmployeeSelfA','employee','0','9103')`,
      [workerAContractor, companyA, workerBContractor, companyB, workerAEmployeeSelf],
    );

    await pool.query(
      `INSERT INTO users (id, username, password, role, company_id, worker_id, first_name, last_name, is_active) VALUES
       ($1,$2,$3,'admin',$4,NULL,'CT2','AdminA', true),
       ($5,$6,$3,'employee',$4,$7,'CT2','EmployeeA', true),
       ($8,$9,$3,'admin',$10,NULL,'CT2','AdminB', true),
       ($11,$12,$3,'platform_owner',NULL,NULL,'CT2','PlatformOwner', true)`,
      [userAAdmin, usernameAAdmin, pwHash, companyA, userAEmployee, usernameAEmployee, workerAEmployeeSelf, userBAdmin, usernameBAdmin, companyB, userPlatformOwner, usernamePlatformOwner],
    );

    // ── Payroll runs + a summary row per tenant (draft status — mutable, not locked/paid) ──
    const runATarget = crypto.randomUUID();
    const runADelete = crypto.randomUUID();
    const runB = crypto.randomUUID();
    const year = new Date().getFullYear();
    await pool.query(
      `INSERT INTO payroll_runs (id, company_id, period_start, period_end, pay_date, status) VALUES
       ($1,$2,$3,$4,$5,'draft'), ($6,$2,$3,$4,$5,'draft'), ($7,$8,$3,$4,$5,'draft')`,
      [runATarget, companyA, `${year}-03-01`, `${year}-03-15`, `${year}-03-15`, runADelete, runB, companyB],
    );
    const summaryATarget = crypto.randomUUID();
    const summaryB = crypto.randomUUID();
    await pool.query(
      `INSERT INTO payroll_summaries (id, payroll_run_id, company_id, total_gross, total_net) VALUES
       ($1,$2,$3,'1111.11','999.99'), ($4,$5,$6,'7777.77','6666.66')`,
      [summaryATarget, runATarget, companyA, summaryB, runB, companyB],
    );

    // ── Invoices ───────────────────────────────────────────────────────────
    const invoiceATarget = crypto.randomUUID();
    const invoiceADelete = crypto.randomUUID();
    const invoiceB = crypto.randomUUID();
    await pool.query(
      `INSERT INTO invoices (id, company_id, invoice_number, status, issue_date, due_date) VALUES
       ($1,$2,'CT2-INV-A1','draft',$3,$4), ($5,$2,'CT2-INV-A2','draft',$3,$4), ($6,$7,'CT2-INV-B1','draft',$3,$4)`,
      [invoiceATarget, companyA, `${year}-03-01`, `${year}-03-31`, invoiceADelete, invoiceB, companyB],
    );

    // ── Contractor invoices, status='approved' (required by mark-paid's own guard) ──
    const ctrInvA = crypto.randomUUID();
    const ctrInvB = crypto.randomUUID();
    await pool.query(
      `INSERT INTO contractor_invoices (id, company_id, contractor_id, invoice_date, amount, status) VALUES
       ($1,$2,$3,$4,'500.00','approved'), ($5,$6,$7,$4,'800.00','approved')`,
      [ctrInvA, companyA, workerAContractor, `${year}-03-01`, ctrInvB, companyB, workerBContractor],
    );

    // ── Contractor trade compensation (not yet approved) ──────────────────
    const tradeCompA = crypto.randomUUID();
    const tradeCompB = crypto.randomUUID();
    await pool.query(
      `INSERT INTO contractor_trade_compensation (id, company_id, contractor_user_id, item_name, quantity, unit_value, total_value) VALUES
       ($1,$2,$3,'CT2 fixture trade item A','1','100','100'), ($4,$5,$6,'CT2 fixture trade item B','1','200','200')`,
      [tradeCompA, companyA, crypto.randomUUID(), tradeCompB, companyB, crypto.randomUUID()],
    );

    // ── DAM documents, company-owned (not worker-owned) ───────────────────
    const damDocA = crypto.randomUUID();
    const damDocB = crypto.randomUUID();
    await pool.query(
      `INSERT INTO dam_documents (id, company_id, owner_type, title, file_path) VALUES
       ($1,$2,'company','CT2 fixture doc A','/uploads/ct2-fixture-a.pdf'), ($3,$4,'company','CT2 fixture doc B','/uploads/ct2-fixture-b.pdf')`,
      [damDocA, companyA, damDocB, companyB],
    );

    // ── Boot the real server against this disposable database ────────────────
    server = await startTestServer(testDatabaseUrl);
    const baseUrl = server.baseUrl;

    const sessionAAdmin: Session = await login(baseUrl, usernameAAdmin, pwPlain);
    const sessionAEmployee: Session = await login(baseUrl, usernameAEmployee, pwPlain);
    const sessionPlatformOwner: Session = await login(baseUrl, usernamePlatformOwner, pwPlain);

    // ══════════════════════ 1. GET /api/payroll-runs/:id/summary ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "GET", `/api/payroll-runs/${runATarget}/summary`, sessionAAdmin);
      const g1 = (r1.body as { totalGross?: string } | undefined)?.totalGross;
      cases.push({
        case: "1. Tenant A admin reads a Tenant A payroll run's summary (own data, not Tenant B's)",
        disposition: r1.status === 200 && g1 === "1111.11" ? "PASS" : "FAIL",
        detail: `status=${r1.status} totalGross=${g1}`,
      });

      const r2 = await apiRequest(baseUrl, "GET", `/api/payroll-runs/${runB}/summary`, sessionAAdmin);
      const g2 = (r2.body as { totalGross?: string } | undefined)?.totalGross;
      const leaked = r2.status === 200 && g2 !== undefined;
      cases.push({
        case: "2. Tenant A admin reads a Tenant B payroll run's summary by ID",
        disposition: leaked ? "FAIL" : r2.status === 403 || r2.status === 404 ? "PASS" : "INCONCLUSIVE",
        detail: leaked
          ? `VERIFIED DEFECT: no company comparison exists anywhere in this handler (server/routes.ts:5714-5722) or in storage.getPayrollSummary (id-only lookup) — a Tenant A admin received Tenant B's real payroll summary totals for a run ID they don't own. status=${r2.status}, totalGross was present and nonzero (redacted — exact figure withheld per this file's own SAFETY note).`
          : `status=${r2.status} totalGrossLeaked=${leaked}`,
      });

      const r3 = await apiRequest(baseUrl, "GET", `/api/payroll-runs/${nonexistentId}/summary`, sessionAAdmin);
      cases.push({
        case: "3. Nonexistent payroll run id — indistinguishable from a foreign-tenant id (both 404)",
        disposition: r3.status === 404 && r3.status === r2.status ? "PASS" : "FAIL",
        detail: `status=${r3.status} (foreign-tenant case status was ${r2.status})`,
      });

      const rEmp = await apiRequest(baseUrl, "GET", `/api/payroll-runs/${runATarget}/summary`, sessionAEmployee);
      cases.push({ case: "4. Unauthorized same-tenant role (employee)", disposition: rEmp.status === 403 ? "PASS" : "FAIL", detail: `status=${rEmp.status}` });

      const r6 = await apiRequest(baseUrl, "GET", `/api/payroll-runs/${runATarget}/summary`, null);
      cases.push({ case: "5. Missing authentication", disposition: r6.status === 401 ? "PASS" : "FAIL", detail: `status=${r6.status}` });

      record("GET /api/payroll-runs/:id/summary", "server/routes.ts:5714", "needs-runtime-hardening", cases);
    }

    // ══════════════════════ 2. PATCH /api/payroll-runs/:id ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "PATCH", `/api/payroll-runs/${runATarget}`, sessionAAdmin, { periodStart: `${year}-03-02` });
      cases.push({ case: "1. Tenant A admin updates a Tenant A payroll run", disposition: r1.status === 200 ? "PASS" : "FAIL", detail: `status=${r1.status}` });

      const beforeB = (await pool.query(`SELECT status FROM payroll_runs WHERE id = $1`, [runB])).rows[0];
      const r2 = await apiRequest(baseUrl, "PATCH", `/api/payroll-runs/${runB}`, sessionAAdmin, { status: "processed" });
      const afterB = (await pool.query(`SELECT status FROM payroll_runs WHERE id = $1`, [runB])).rows[0];
      const unchangedB = beforeB.status === afterB.status;
      cases.push({
        case: "2. Tenant A admin updates a Tenant B payroll run by ID",
        disposition: r2.status === 403 && unchangedB ? "PASS" : "FAIL",
        detail: `status=${r2.status} rowUnchanged=${unchangedB}`,
      });

      // Tenant A's own run + Tenant B's companyId in the same body as another field change —
      // proves whether companyId is immutable through this endpoint, and whether a rejection
      // (if any) is atomic (no partial update of the other field).
      const before3 = (await pool.query(`SELECT company_id, period_start FROM payroll_runs WHERE id = $1`, [runATarget])).rows[0];
      const r3 = await apiRequest(baseUrl, "PATCH", `/api/payroll-runs/${runATarget}`, sessionAAdmin, { companyId: companyB, periodStart: `${year}-03-09` });
      const after3 = (await pool.query(`SELECT company_id, period_start FROM payroll_runs WHERE id = $1`, [runATarget])).rows[0];
      const reassigned = before3.company_id !== after3.company_id;
      if (reassigned) {
        // Restore immediately so cleanup and later cases aren't affected by the defect being demonstrated.
        await pool.query(`UPDATE payroll_runs SET company_id = $1 WHERE id = $2`, [companyA, runATarget]);
      }
      cases.push({
        case: "3. Tenant A's own payroll run ID + Tenant B's companyId in the update body",
        disposition: !reassigned ? "PASS" : "FAIL",
        detail: reassigned
          ? `VERIFIED DEFECT: the ownership guard (server/routes.ts:8213-8218) checks the EXISTING row's companyId before the update, but storage.updatePayrollRun(id, req.body) (server/storage.ts:1564-1567) applies req.body verbatim with no field allowlist or companyId-immutability check — the same defect shape already fixed on PATCH /api/workers/:id (saas/phase0.5-worker-tenant-hardening). status=${r3.status}, companyId changed ${before3.company_id} -> ${after3.company_id}, restored immediately after detection.`
          : `companyId in the request body did not change the row (status=${r3.status}) — reassignment not reproducible.`,
      });

      const rNonexistent = await apiRequest(baseUrl, "PATCH", `/api/payroll-runs/${nonexistentId}`, sessionAAdmin, { periodStart: `${year}-03-05` });
      cases.push({ case: "4. Nonexistent payroll run id", disposition: rNonexistent.status === 404 ? "PASS" : "FAIL", detail: `status=${rNonexistent.status}` });

      const rEmp = await apiRequest(baseUrl, "PATCH", `/api/payroll-runs/${runATarget}`, sessionAEmployee, { periodStart: `${year}-03-03` });
      cases.push({ case: "5. Unauthorized same-tenant role (employee)", disposition: rEmp.status === 403 ? "PASS" : "FAIL", detail: `status=${rEmp.status}` });

      const r6 = await apiRequest(baseUrl, "PATCH", `/api/payroll-runs/${runATarget}`, null, { periodStart: `${year}-03-04` });
      cases.push({ case: "6. Missing authentication", disposition: r6.status === 401 ? "PASS" : "FAIL", detail: `status=${r6.status}` });

      record("PATCH /api/payroll-runs/:id", "server/routes.ts:8209", "needs-runtime-hardening", cases);
    }

    // ══════════════════════ 3. DELETE /api/payroll-runs/:id ══════════════════════
    {
      const cases: CaseResult[] = [];
      const beforeB = (await pool.query(`SELECT id FROM payroll_runs WHERE id = $1`, [runB])).rows[0];
      const r1 = await apiRequest(baseUrl, "DELETE", `/api/payroll-runs/${runB}`, sessionAAdmin);
      const afterB = (await pool.query(`SELECT id FROM payroll_runs WHERE id = $1`, [runB])).rows[0];
      cases.push({
        case: "1. Tenant A admin deletes a Tenant B payroll run by ID",
        disposition: r1.status === 403 && !!beforeB && !!afterB ? "PASS" : "FAIL",
        detail: `status=${r1.status} rowStillExists=${!!afterB}`,
      });

      const rEmp = await apiRequest(baseUrl, "DELETE", `/api/payroll-runs/${runADelete}`, sessionAEmployee);
      cases.push({ case: "2. Unauthorized same-tenant role (employee)", disposition: rEmp.status === 403 ? "PASS" : "FAIL", detail: `status=${rEmp.status}` });

      const r6 = await apiRequest(baseUrl, "DELETE", `/api/payroll-runs/${runADelete}`, null);
      cases.push({ case: "3. Missing authentication", disposition: r6.status === 401 ? "PASS" : "FAIL", detail: `status=${r6.status}` });

      const r4 = await apiRequest(baseUrl, "DELETE", `/api/payroll-runs/${runADelete}`, sessionAAdmin);
      cases.push({ case: "4. Tenant A admin deletes a Tenant A payroll run", disposition: r4.status === 200 ? "PASS" : "FAIL", detail: `status=${r4.status}` });

      record("DELETE /api/payroll-runs/:id", "server/routes.ts:5752", "needs-runtime-hardening", cases);
    }

    // ══════════════════════ 4. PATCH /api/invoices/:id ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "PATCH", `/api/invoices/${invoiceATarget}`, sessionAAdmin, { notes: "ct2-updated" });
      cases.push({ case: "1. Tenant A admin updates a Tenant A invoice", disposition: r1.status === 200 ? "PASS" : "FAIL", detail: `status=${r1.status}` });

      const beforeB = (await pool.query(`SELECT notes FROM invoices WHERE id = $1`, [invoiceB])).rows[0];
      const r2 = await apiRequest(baseUrl, "PATCH", `/api/invoices/${invoiceB}`, sessionAAdmin, { notes: "ct2-hacked-by-a" });
      const afterB = (await pool.query(`SELECT notes FROM invoices WHERE id = $1`, [invoiceB])).rows[0];
      const unchangedB = beforeB.notes === afterB.notes;
      cases.push({
        case: "2. Tenant A admin updates a Tenant B invoice by ID",
        disposition: unchangedB ? "PASS" : "FAIL",
        detail: unchangedB
          ? `status=${r2.status} rowUnchanged=true`
          : `VERIFIED DEFECT: no company-ownership check of any kind exists in this handler (server/routes.ts:24833-24847) — storage.updateInvoice(id, data) (server/storage.ts:3172-3175) applies the update body to any invoice id with no comparison to the acting user's company at all. status=${r2.status}, notes changed from Tenant B's original value.`,
      });

      const rNonexistent = await apiRequest(baseUrl, "PATCH", `/api/invoices/${nonexistentId}`, sessionAAdmin, { notes: "ct2-nonexistent" });
      cases.push({ case: "3. Nonexistent invoice id", disposition: rNonexistent.status === 404 ? "PASS" : "FAIL", detail: `status=${rNonexistent.status}` });

      const rEmp = await apiRequest(baseUrl, "PATCH", `/api/invoices/${invoiceATarget}`, sessionAEmployee, { notes: "ct2-emp" });
      cases.push({ case: "4. Unauthorized same-tenant role (employee)", disposition: rEmp.status === 403 ? "PASS" : "FAIL", detail: `status=${rEmp.status}` });

      const r6 = await apiRequest(baseUrl, "PATCH", `/api/invoices/${invoiceATarget}`, null, { notes: "ct2-noauth" });
      cases.push({ case: "5. Missing authentication", disposition: r6.status === 401 ? "PASS" : "FAIL", detail: `status=${r6.status}` });

      record("PATCH /api/invoices/:id", "server/routes.ts:24833", "needs-runtime-hardening", cases);
    }

    // ══════════════════════ 5. DELETE /api/invoices/:id ══════════════════════
    {
      const cases: CaseResult[] = [];
      const beforeB = (await pool.query(`SELECT id FROM invoices WHERE id = $1`, [invoiceB])).rows[0];
      const r1 = await apiRequest(baseUrl, "DELETE", `/api/invoices/${invoiceB}`, sessionAAdmin);
      const afterB = (await pool.query(`SELECT id FROM invoices WHERE id = $1`, [invoiceB])).rows[0];
      cases.push({
        case: "1. Tenant A admin deletes a Tenant B invoice by ID",
        disposition: !!afterB ? "PASS" : "FAIL",
        detail: !!afterB
          ? `status=${r1.status} rowStillExists=true`
          : `VERIFIED DEFECT: no company-ownership check exists in this handler (server/routes.ts:24849-24853) — storage.deleteInvoice(id) (server/storage.ts:3176-3179) deletes any invoice id with no comparison to the acting user's company. status=${r1.status}, row no longer exists.`,
      });

      const rNonexistent = await apiRequest(baseUrl, "DELETE", `/api/invoices/${nonexistentId}`, sessionAAdmin);
      cases.push({ case: "2. Nonexistent invoice id", disposition: rNonexistent.status === 404 ? "PASS" : "FAIL", detail: `status=${rNonexistent.status}` });

      const rEmp = await apiRequest(baseUrl, "DELETE", `/api/invoices/${invoiceADelete}`, sessionAEmployee);
      cases.push({ case: "3. Unauthorized same-tenant role (employee)", disposition: rEmp.status === 403 ? "PASS" : "FAIL", detail: `status=${rEmp.status}` });

      const r6 = await apiRequest(baseUrl, "DELETE", `/api/invoices/${invoiceADelete}`, null);
      cases.push({ case: "4. Missing authentication", disposition: r6.status === 401 ? "PASS" : "FAIL", detail: `status=${r6.status}` });

      const r4 = await apiRequest(baseUrl, "DELETE", `/api/invoices/${invoiceADelete}`, sessionAAdmin);
      cases.push({ case: "5. Tenant A admin deletes a Tenant A invoice", disposition: r4.status === 200 ? "PASS" : "FAIL", detail: `status=${r4.status}` });

      record("DELETE /api/invoices/:id", "server/routes.ts:24849", "needs-runtime-hardening", cases);
    }

    // ══════════════════════ 6. POST /api/contractor-invoices/:id/mark-paid ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "POST", `/api/contractor-invoices/${ctrInvA}/mark-paid`, sessionAAdmin, { paymentReference: "ct2-a-ref" });
      cases.push({ case: "1. Tenant A admin marks a Tenant A contractor invoice paid", disposition: r1.status === 200 ? "PASS" : "FAIL", detail: `status=${r1.status}` });

      const beforeB = (await pool.query(`SELECT status, paid_at FROM contractor_invoices WHERE id = $1`, [ctrInvB])).rows[0];
      const r2 = await apiRequest(baseUrl, "POST", `/api/contractor-invoices/${ctrInvB}/mark-paid`, sessionAAdmin, { paymentReference: "ct2-hacked" });
      const afterB = (await pool.query(`SELECT status, paid_at FROM contractor_invoices WHERE id = $1`, [ctrInvB])).rows[0];
      const unchangedB = beforeB.status === afterB.status && beforeB.paid_at === afterB.paid_at;
      cases.push({
        case: "2. Tenant A admin marks a Tenant B contractor invoice paid by ID",
        disposition: unchangedB ? "PASS" : "FAIL",
        detail: unchangedB
          ? `status=${r2.status} rowUnchanged=true`
          : `VERIFIED DEFECT: no company-ownership check exists in this handler (server/routes.ts:10866-10877) — storage.getContractorInvoice (id-only) and storage.updateContractorInvoice apply with no comparison to the acting user's company. A Tenant A admin changed a Tenant B contractor invoice's payment status. status=${r2.status}, statusBefore=${beforeB.status} statusAfter=${afterB.status}.`,
      });

      const rNonexistent = await apiRequest(baseUrl, "POST", `/api/contractor-invoices/${nonexistentId}/mark-paid`, sessionAAdmin, {});
      cases.push({ case: "3. Nonexistent contractor invoice id", disposition: rNonexistent.status === 404 ? "PASS" : "FAIL", detail: `status=${rNonexistent.status}` });

      const rEmp = await apiRequest(baseUrl, "POST", `/api/contractor-invoices/${ctrInvA}/mark-paid`, sessionAEmployee, {});
      cases.push({ case: "4. Unauthorized same-tenant role (employee)", disposition: rEmp.status === 403 ? "PASS" : "FAIL", detail: `status=${rEmp.status}` });

      const r6 = await apiRequest(baseUrl, "POST", `/api/contractor-invoices/${ctrInvA}/mark-paid`, null, {});
      cases.push({ case: "5. Missing authentication", disposition: r6.status === 401 ? "PASS" : "FAIL", detail: `status=${r6.status}` });

      record("POST /api/contractor-invoices/:id/mark-paid", "server/routes.ts:10866", "needs-runtime-hardening", cases);
    }

    // ══════════════════════ 7. POST /api/contractor-trade-compensation/:id/approve ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "POST", `/api/contractor-trade-compensation/${tradeCompA}/approve`, sessionAAdmin, {});
      cases.push({ case: "1. Tenant A admin approves a Tenant A trade-compensation item", disposition: r1.status === 200 ? "PASS" : "FAIL", detail: `status=${r1.status}` });

      const beforeB = (await pool.query(`SELECT approved_at FROM contractor_trade_compensation WHERE id = $1`, [tradeCompB])).rows[0];
      const r2 = await apiRequest(baseUrl, "POST", `/api/contractor-trade-compensation/${tradeCompB}/approve`, sessionAAdmin, {});
      const afterB = (await pool.query(`SELECT approved_at FROM contractor_trade_compensation WHERE id = $1`, [tradeCompB])).rows[0];
      const unchangedB = (beforeB.approved_at?.getTime?.() ?? beforeB.approved_at) === (afterB.approved_at?.getTime?.() ?? afterB.approved_at);
      cases.push({
        case: "2. Tenant A admin approves a Tenant B trade-compensation item by ID",
        disposition: r2.status === 403 && unchangedB ? "PASS" : "FAIL",
        detail: `status=${r2.status} rowUnchanged=${unchangedB}`,
      });

      const rEmp = await apiRequest(baseUrl, "POST", `/api/contractor-trade-compensation/${tradeCompA}/approve`, sessionAEmployee, {});
      cases.push({ case: "3. Unauthorized same-tenant role (employee) — already approved by case 1, expect a role/state rejection either way", disposition: rEmp.status === 403 ? "PASS" : "FAIL", detail: `status=${rEmp.status}` });

      const r6 = await apiRequest(baseUrl, "POST", `/api/contractor-trade-compensation/${tradeCompA}/approve`, null, {});
      cases.push({ case: "4. Missing authentication", disposition: r6.status === 401 ? "PASS" : "FAIL", detail: `status=${r6.status}` });

      record("POST /api/contractor-trade-compensation/:id/approve", "server/routes.ts:22524", "needs-negative-test", cases);
    }

    // ══════════════════════ 8. GET /api/dam-documents/:id ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "GET", `/api/dam-documents/${damDocA}`, sessionAAdmin);
      const title1 = (r1.body as { title?: string } | undefined)?.title;
      cases.push({
        case: "1. Tenant A admin reads a Tenant A document (own data, not Tenant B's)",
        disposition: r1.status === 200 && title1 === "CT2 fixture doc A" ? "PASS" : "FAIL",
        detail: `status=${r1.status}`,
      });

      const r2 = await apiRequest(baseUrl, "GET", `/api/dam-documents/${damDocB}`, sessionAAdmin);
      const title2 = (r2.body as { title?: string } | undefined)?.title;
      const leaked = r2.status === 200 && title2 !== undefined;
      cases.push({
        case: "2. Tenant A admin reads a Tenant B document by ID",
        disposition: leaked ? "FAIL" : r2.status === 403 || r2.status === 404 ? "PASS" : "INCONCLUSIVE",
        detail: leaked
          ? `VERIFIED DEFECT: canAccessCompany() check (server/routes.ts:16621) did not block this request. status=${r2.status}`
          : `status=${r2.status}`,
      });

      const rEmp = await apiRequest(baseUrl, "GET", `/api/dam-documents/${damDocA}`, sessionAEmployee);
      cases.push({
        case: "3. Same-tenant employee reads a company-owned (not their own) document",
        disposition: rEmp.status === 403 ? "PASS" : "FAIL",
        detail: `status=${rEmp.status} — expected 403: employee is neither the doc's worker_id/related_contractor_id nor an admin/manager/tenant_*/platform_* role (server/routes.ts:16617-16620)`,
      });

      const r6 = await apiRequest(baseUrl, "GET", `/api/dam-documents/${damDocA}`, null);
      cases.push({ case: "4. Missing authentication", disposition: r6.status === 401 ? "PASS" : "FAIL", detail: `status=${r6.status}` });

      record("GET /api/dam-documents/:id", "server/routes.ts:16609", "needs-negative-test", cases);
    }

    // ══════════════════════ 9. PATCH /api/companies/:id ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "PATCH", `/api/companies/${companyA}`, sessionAAdmin, { name: `CT2 Test Tenant A ${suffix} (renamed)` });
      cases.push({ case: "1. Tenant A admin updates their own company (Tenant A)", disposition: r1.status === 200 ? "PASS" : "FAIL", detail: `status=${r1.status}` });

      const beforeB = (await pool.query(`SELECT name FROM companies WHERE id = $1`, [companyB])).rows[0];
      const r2 = await apiRequest(baseUrl, "PATCH", `/api/companies/${companyB}`, sessionAAdmin, { name: "ct2-hacked-tenant-b" });
      const afterB = (await pool.query(`SELECT name FROM companies WHERE id = $1`, [companyB])).rows[0];
      const unchangedB = beforeB.name === afterB.name;
      if (!unchangedB) {
        // Restore immediately so cleanup and later cases aren't affected by the defect being demonstrated.
        await pool.query(`UPDATE companies SET name = $1 WHERE id = $2`, [beforeB.name, companyB]);
      }
      cases.push({
        case: "2. Tenant A admin updates Tenant B's company record directly by ID",
        disposition: r2.status === 403 && unchangedB ? "PASS" : "FAIL",
        detail: unchangedB
          ? `status=${r2.status} rowUnchanged=true`
          : `VERIFIED DEFECT: PATCH /api/companies/:id (server/routes.ts:2128) has requireRole("admin","manager") but NO comparison of req.params.id to the acting user's own companyId anywhere in the handler — any tenant admin/manager can target any other company's :id. storage.updateCompany(id, data) (server/storage.ts:1116-1119) applies the body verbatim. status=${r2.status}, Tenant B's company name was changed by a Tenant A admin, restored immediately after detection.`,
      });

      const rNonexistent = await apiRequest(baseUrl, "PATCH", `/api/companies/${nonexistentId}`, sessionAAdmin, { name: "ct2-nonexistent" });
      cases.push({ case: "3. Nonexistent company id", disposition: rNonexistent.status === 404 ? "PASS" : "FAIL", detail: `status=${rNonexistent.status}` });

      // Tenant-admin vs platform-owner boundary: the same cross-tenant edit that's
      // correctly forbidden for a Tenant A admin (case 2) must remain available to a
      // platform-scoped role — platform users are never company-scoped. Restored
      // immediately after to keep fixture state clean for the rest of this run.
      const beforePlatform = (await pool.query(`SELECT name FROM companies WHERE id = $1`, [companyB])).rows[0];
      const rPlatform = await apiRequest(baseUrl, "PATCH", `/api/companies/${companyB}`, sessionPlatformOwner, { name: "ct2-platform-owner-edit" });
      const afterPlatform = (await pool.query(`SELECT name FROM companies WHERE id = $1`, [companyB])).rows[0];
      const platformChanged = beforePlatform.name !== afterPlatform.name;
      if (platformChanged) {
        await pool.query(`UPDATE companies SET name = $1 WHERE id = $2`, [beforePlatform.name, companyB]);
      }
      cases.push({
        case: "4. Platform-owner updates Tenant B's company directly (tenant-admin vs platform-owner boundary)",
        disposition: rPlatform.status === 200 && platformChanged ? "PASS" : "FAIL",
        detail: `status=${rPlatform.status} rowChanged=${platformChanged}`,
      });

      const rEmp = await apiRequest(baseUrl, "PATCH", `/api/companies/${companyA}`, sessionAEmployee, { name: "ct2-emp-attempt" });
      cases.push({ case: "5. Unauthorized same-tenant role (employee)", disposition: rEmp.status === 403 ? "PASS" : "FAIL", detail: `status=${rEmp.status}` });

      const r6 = await apiRequest(baseUrl, "PATCH", `/api/companies/${companyA}`, null, { name: "ct2-noauth" });
      cases.push({ case: "6. Missing authentication", disposition: r6.status === 401 ? "PASS" : "FAIL", detail: `status=${r6.status}` });

      record("PATCH /api/companies/:id", "server/routes.ts:2128", "needs-runtime-hardening", cases);
    }

    // ── Write the machine-readable manifest ───────────────────────────────────
    const summary: Record<Disposition, number> = { PASS: 0, FAIL: 0, INCONCLUSIVE: 0, "EXPECTED GLOBAL": 0, "N/A": 0 };
    console.log("=== Cross-tenant batch-2 route test matrix ===\n");
    for (const route of routeResults) {
      console.log(`${route.id}  (${route.source})`);
      for (const c of route.cases) {
        summary[c.disposition]++;
        const mark = c.disposition === "PASS" ? "✓" : c.disposition === "N/A" ? "•" : "✗";
        console.log(`  ${mark} [${c.disposition}] ${c.case}`);
      }
      console.log("");
    }

    fs.writeFileSync(
      MANIFEST_PATH,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString().slice(0, 10),
          sourceRouteManifest: "docs/saas-readiness/storage-scope-trace-manifest.json",
          summary,
          routes: routeResults,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`Summary: ${summary.PASS} PASS, ${summary.FAIL} FAIL, ${summary.INCONCLUSIVE} INCONCLUSIVE, ${summary["EXPECTED GLOBAL"]} EXPECTED GLOBAL, ${summary["N/A"]} N/A`);
    console.log(`Manifest written to ${MANIFEST_PATH}`);

    if (summary.FAIL > 0) {
      console.error(`\n${summary.FAIL} verified authorization gap(s) found — see ${MANIFEST_PATH} and docs/saas-readiness/phase-0.5-batch-2-cross-tenant-findings.md. Not fixed in this branch (test-first/audit-first phase).`);
      process.exitCode = 1;
    } else {
      console.log(`\nAll cases PASS — no cross-tenant authorization gaps found in this batch.`);
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
    process.exit(process.exitCode ?? 0);
  });
