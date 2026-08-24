/**
 * Phase 0.5 — cross-tenant negative tests, batch 4: the next highest-risk
 * unresolved routes selected from the committed storage-scope-trace
 * manifest (docs/saas-readiness/storage-scope-trace-manifest.json) and
 * route-security manifest, plus manual source reading, excluding every
 * route already covered by batch 1
 * (tests/cross-tenant-worker-routes-db.test.ts, PR #84/#85), batch 2
 * (tests/cross-tenant-batch-2-routes-db.test.ts, PR #87/#88), or batch 3
 * (tests/cross-tenant-batch-3-routes-db.test.ts, PR #89/#90).
 *
 * Routes tested (manifest disposition | confidence | source):
 *   1. GET   /api/companies/:id/tax-liability     | unresolved | n/a (manual) | server/routes.ts:7742
 *   2. GET   /api/companies/:id/quarterly-taxes   | unresolved | n/a (manual) | server/routes.ts:7761
 *   3. GET   /api/check-templates                 | unresolved | n/a (manual) | server/routes.ts:20738
 *   4. POST  /api/check-templates                 | unresolved | n/a (manual) | server/routes.ts:20767
 *   5. PATCH /api/payroll-payment-methods/:id     | unresolved | n/a (manual) | server/routes.ts:22673
 *   6. PATCH /api/payroll-payment-records/:id     | unresolved | n/a (manual) | server/routes.ts:22828
 *   7. DELETE /api/payroll-payment-records/:id    | unresolved | n/a (manual) | server/routes.ts:22836
 *   8. GET   /api/worker-memberships              | unresolved | n/a (manual) | server/routes.ts:9747
 *   9. POST  /api/worker-memberships              | unresolved | n/a (manual) | server/routes.ts:9758
 *  10. PATCH /api/worker-memberships/:id          | unresolved | n/a (manual) | server/routes.ts:9768
 *  11. DELETE /api/worker-memberships/:id         | unresolved | n/a (manual) | server/routes.ts:9779
 *
 * Selection rationale (manual source reading, cross-referenced against the
 * committed storage-scope-trace and route-security manifests — see the
 * findings doc for the full writeup):
 *   1-2. Direct siblings of the already-fixed GET /api/workers/:id/ytd-taxes
 *        (PR #85) and GET /api/companies/:id/ytd-taxes (PR #89/#90) —
 *        req.params.id (target company) is fed straight into
 *        storage.getCompanyTaxLiability / storage.getPayrollRuns with no
 *        comparison to the acting user's own companyId anywhere in either
 *        handler. Explicitly named as the strongest remaining candidates in
 *        the batch-3 findings doc's deferred-follow-ups section.
 *   3-4. GET/POST /api/check-templates (the list/create siblings of the
 *        already-fixed by-id GET/PATCH/DELETE, PR #89/#90) — also
 *        explicitly named in the batch-3 findings doc's deferred
 *        follow-ups. GET accepts an unrestricted ?companyId= filter, and
 *        omitting it falls through to storage.getCheckTemplates() with no
 *        argument, which returns every company's templates unfiltered.
 *        POST accepts a client-supplied companyId with no comparison to
 *        the acting user's own company.
 *   5. PATCH /api/payroll-payment-methods/:id — sibling of the
 *      already-fixed DELETE (PR #89/#90): storage.updatePayrollPaymentMethod
 *      is called with req.body applied verbatim, no ownership check and no
 *      companyId-immutability guard. Bank-based payment-method
 *      configuration (ACH/digital-wallet settings).
 *   6-7. PATCH/DELETE /api/payroll-payment-records/:id — no
 *        company-ownership check of any kind on either verb; these are
 *        actual payment-transaction records (gross/net pay, tax withheld,
 *        funding account, check number). GET and GET .../ytd-summary on
 *        this same resource already force-scope correctly and were
 *        confirmed NOT to need testing here.
 *   8-11. GET/POST/PATCH/DELETE /api/worker-memberships[/:id] — the most
 *         permissive gap found in this batch: none of the four verbs has
 *         any requireRole at all (requireAuth only), and none compares a
 *         target row's companyId to the acting user's own. GET/POST accept
 *         an unrestricted companyId (query param / body respectively, with
 *         GET's omitted-companyId case returning every company's
 *         memberships unfiltered, same shape as check-templates).
 *         /api/my/memberships (the self-service sibling) was read and
 *         confirmed correctly self-scoped by workerId on every verb — not
 *         included here.
 *
 * Deliberately excluded from this batch (already covered):
 *   GET/POST /api/workers, PATCH/DELETE /api/workers/:id,
 *   GET /api/workers/:id/ytd-taxes (batch 1, PR #84/#85);
 *   GET/PATCH/DELETE /api/payroll-runs/:id[/summary], PATCH/DELETE
 *   /api/invoices/:id, POST /api/contractor-invoices/:id/mark-paid,
 *   POST /api/contractor-trade-compensation/:id/approve,
 *   GET /api/dam-documents/:id, PATCH /api/companies/:id (batch 2,
 *   PR #87/#88); GET /api/companies/:id/ytd-taxes,
 *   GET/PATCH/DELETE /api/check-templates/:id,
 *   PATCH /api/contractor-invoices/:id, GET /api/wage-history,
 *   DELETE /api/payroll-payment-methods/:id, GET /api/payroll-summary
 *   (batch 3, PR #89/#90).
 *
 * GET /api/payroll-payment-records and GET
 * /api/payroll-payment-records/ytd-summary were read and confirmed
 * correctly force-scoped for every non-platform role (client-supplied
 * ?companyId= is always overridden to the caller's own company) —
 * deliberately not included as test cases beyond a single own-tenant sanity
 * check, since manual reading found no defect to verify.
 *
 * Methodology matches tests/cross-tenant-batch-3-routes-db.test.ts exactly:
 * boots the REAL, unmodified application server (server/index.ts) against a
 * disposable Postgres database, creates two synthetic tenants with real
 * authenticated sessions via the real POST /api/auth/login route, and
 * exercises each route's actual authorization logic over real HTTP
 * requests. Not a mock.
 *
 * This is a TEST-FIRST / AUDIT-FIRST branch: no runtime repair is made here
 * for any defect this file verifies. Verified defects are documented in
 * docs/saas-readiness/phase-0.5-batch-4-cross-tenant-findings.md.
 *
 * SAFETY: requires TEST_DATABASE_URL to point at a disposable database,
 * refuses staging/production-shaped names/hosts, aborts if TEST_DATABASE_URL
 * equals DATABASE_URL, and verifies current_database() before any write.
 * Cleanup is the same generic FK-aware cascade delete rooted at the two
 * synthetic company ids (scripts/cross-tenant-negative-tests/cascade-cleanup.ts),
 * run in a `finally` block and independently re-verified afterward. The
 * server harness is the PR #86-fixed process-group-aware harness — stop()
 * signals the whole process group, not just the tracked pid, so no
 * child/orphan process or held port survives this run. Session cookies,
 * password hashes, and the connection string are never logged — only
 * PASS/FAIL/INCONCLUSIVE/EXPECTED GLOBAL/N/A outcomes and non-sensitive
 * route response shapes (booleans/status codes), never actual dollar
 * amounts or document contents.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable_db npx tsx tests/cross-tenant-batch-4-routes-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import fs from "node:fs";
import { startTestServer, login, apiRequest, type TestServer, type Session } from "../scripts/cross-tenant-negative-tests/server-harness";
import { cascadeDelete, verifyZeroResidue } from "../scripts/cross-tenant-negative-tests/cascade-cleanup";

const FORBIDDEN_PATTERNS = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];
const MANIFEST_PATH = "docs/saas-readiness/cross-tenant-batch-4-test-manifest.json";

type Disposition = "PASS" | "FAIL" | "INCONCLUSIVE" | "EXPECTED GLOBAL" | "N/A";

interface CaseResult {
  case: string;
  disposition: Disposition;
  detail: string;
}

interface RouteResult {
  id: string;
  source: string;
  cases: CaseResult[];
}

async function main() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    console.log("TEST_DATABASE_URL not set — skipping cross-tenant batch-4 tests (0 run).");
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

  function record(routeId: string, source: string, caseResults: CaseResult[]) {
    routeResults.push({ id: routeId, source, cases: caseResults });
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
    await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2), ($3, $4)`, [companyA, `CT4 Test Tenant A ${suffix}`, companyB, `CT4 Test Tenant B ${suffix}`]);

    const pwPlain = crypto.randomBytes(12).toString("hex");
    const pwHash = await bcrypt.hash(pwPlain, 10);

    const userAAdmin = crypto.randomUUID();
    const userAEmployee = crypto.randomUUID();
    const userBAdmin = crypto.randomUUID();
    const usernameAAdmin = `ct4_a_admin_${suffix}`;
    const usernameAEmployee = `ct4_a_employee_${suffix}`;
    const usernameBAdmin = `ct4_b_admin_${suffix}`;
    const nonexistentId = crypto.randomUUID();

    const workerAEmployeeSelf = crypto.randomUUID();
    const workerAOther = crypto.randomUUID();
    const workerBOther = crypto.randomUUID();
    await pool.query(
      `INSERT INTO workers (id, company_id, first_name, last_name, worker_type, pay_rate, employee_number) VALUES
       ($1,$2,'CT4','EmployeeSelfA','employee','0','9401'),
       ($3,$2,'CT4','OtherA','employee','0','9402'),
       ($4,$5,'CT4','OtherB','employee','0','9403')`,
      [workerAEmployeeSelf, companyA, workerAOther, workerBOther, companyB],
    );

    await pool.query(
      `INSERT INTO users (id, username, password, role, company_id, worker_id, first_name, last_name, is_active) VALUES
       ($1,$2,$3,'admin',$4,NULL,'CT4','AdminA', true),
       ($5,$6,$3,'employee',$4,$7,'CT4','EmployeeA', true),
       ($8,$9,$3,'admin',$10,NULL,'CT4','AdminB', true)`,
      [userAAdmin, usernameAAdmin, pwHash, companyA, userAEmployee, usernameAEmployee, workerAEmployeeSelf, userBAdmin, usernameBAdmin, companyB],
    );

    // ── Payroll runs + items + taxes (for tax-liability / quarterly-taxes) ────
    const year = new Date().getFullYear();
    const today = new Date().toISOString().slice(0, 10);
    const runA = crypto.randomUUID();
    const runB = crypto.randomUUID();
    await pool.query(
      `INSERT INTO payroll_runs (id, company_id, period_start, period_end, pay_date, status) VALUES
       ($1,$2,$3,$3,$3,'processed'), ($4,$5,$3,$3,$3,'processed')`,
      [runA, companyA, today, runB, companyB],
    );
    const itemA = crypto.randomUUID();
    const itemB = crypto.randomUUID();
    await pool.query(
      `INSERT INTO payroll_items (id, payroll_run_id, worker_id, gross_pay, deductions, net_pay) VALUES
       ($1,$2,$3,'3000.00','0','3000.00'), ($4,$5,$6,'9000.00','0','9000.00')`,
      [itemA, runA, workerAOther, itemB, runB, workerBOther],
    );
    await pool.query(
      `INSERT INTO payroll_item_taxes (payroll_item_id, tax_code, tax_name, taxable_wages, amount, is_employer_paid, state_code) VALUES
       ($1,'FED_WH','Federal Withholding','3000.00','311.11',false,NULL),
       ($2,'FED_WH','Federal Withholding','9000.00','933.33',false,NULL)`,
      [itemA, itemB],
    );

    // ── Check templates ────────────────────────────────────────────────────
    const checkTplA = crypto.randomUUID();
    const checkTplB = crypto.randomUUID();
    await pool.query(
      `INSERT INTO check_templates (id, company_id, name, template_type) VALUES
       ($1,$2,'CT4 Template A','standard'), ($3,$4,'CT4 Template B','standard')`,
      [checkTplA, companyA, checkTplB, companyB],
    );

    // ── Payroll payment methods ────────────────────────────────────────────
    const paymentMethodA = crypto.randomUUID();
    const paymentMethodB = crypto.randomUUID();
    await pool.query(
      `INSERT INTO payroll_payment_methods (id, company_id, code, name, category) VALUES
       ($1,$2,'CT4-CASH-A','CT4 Cash A','cash'), ($3,$4,'CT4-CASH-B','CT4 Cash B','cash')`,
      [paymentMethodA, companyA, paymentMethodB, companyB],
    );

    // ── Payroll payment records ────────────────────────────────────────────
    const paymentRecordA = crypto.randomUUID();
    const paymentRecordADelete = crypto.randomUUID();
    const paymentRecordB = crypto.randomUUID();
    await pool.query(
      `INSERT INTO payroll_payment_records (id, company_id, payroll_run_id, worker_id, gross_pay_amount, net_pay_amount, status, memo) VALUES
       ($1,$2,$3,$4,'3000.00','2688.89','pending','CT4 record A'),
       ($5,$2,$3,$4,'3000.00','2688.89','pending','CT4 record A-delete'),
       ($6,$7,$8,$9,'9000.00','8066.67','pending','CT4 record B')`,
      [paymentRecordA, companyA, runA, workerAOther, paymentRecordADelete, paymentRecordB, companyB, runB, workerBOther],
    );

    // ── Worker memberships ──────────────────────────────────────────────────
    const membershipA = crypto.randomUUID();
    const membershipADelete = crypto.randomUUID();
    const membershipB = crypto.randomUUID();
    await pool.query(
      `INSERT INTO worker_memberships (id, company_id, worker_id, organization, membership_number) VALUES
       ($1,$2,$3,'CT4 Org A','A-001'),
       ($4,$2,$3,'CT4 Org A-delete','A-002'),
       ($5,$6,$7,'CT4 Org B','B-001')`,
      [membershipA, companyA, workerAOther, membershipADelete, membershipB, companyB, workerBOther],
    );

    // ── Boot the real server against this disposable database ────────────────
    server = await startTestServer(testDatabaseUrl);
    const baseUrl = server.baseUrl;

    const sessionAAdmin: Session = await login(baseUrl, usernameAAdmin, pwPlain);
    const sessionAEmployee: Session = await login(baseUrl, usernameAEmployee, pwPlain);

    // ══════════════════════ 1. GET /api/companies/:id/tax-liability ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "GET", `/api/companies/${companyA}/tax-liability`, sessionAAdmin);
      const list1 = Array.isArray(r1.body) ? (r1.body as Array<{ taxCode?: string; totalAmount?: number }>) : [];
      const ownAmount1 = list1.find((x) => x.taxCode === "FED_WH")?.totalAmount;
      cases.push({ case: "1. Tenant A admin reads Tenant A's own tax liability", disposition: r1.status === 200 && Math.round(ownAmount1 ?? -1) === 311 ? "PASS" : "FAIL", detail: `status=${r1.status} amount=${ownAmount1}` });

      const r2 = await apiRequest(baseUrl, "GET", `/api/companies/${companyB}/tax-liability`, sessionAAdmin);
      const list2 = Array.isArray(r2.body) ? (r2.body as Array<{ totalAmount?: number }>) : [];
      const leaked = r2.status === 200 && list2.some((x) => Math.round(x.totalAmount ?? -1) === 933);
      cases.push({
        case: "2. Tenant A admin reads Tenant B's company tax liability by ID",
        disposition: leaked ? "FAIL" : r2.status === 403 || r2.status === 404 ? "PASS" : "INCONCLUSIVE",
        detail: leaked ? `VERIFIED DEFECT: no comparison of req.params.id to the acting user's own companyId exists anywhere in this handler (server/routes.ts:7742) — storage.getCompanyTaxLiability is fed the raw path param. status=200, returned Tenant B's federal-withholding total ($933.33) to a Tenant A admin.` : `status=${r2.status}`,
      });

      const r3 = await apiRequest(baseUrl, "GET", `/api/companies/${nonexistentId}/tax-liability`, sessionAAdmin);
      const list3 = Array.isArray(r3.body) ? r3.body : [];
      cases.push({ case: "3. Nonexistent company id — no company-existence check exists; storage.getCompanyTaxLiability returns [] rather than a 404, but no data is leaked", disposition: r3.status === 200 && Array.isArray(r3.body) && list3.length === 0 ? "PASS" : "FAIL", detail: `status=${r3.status}` });

      const rEmp = await apiRequest(baseUrl, "GET", `/api/companies/${companyA}/tax-liability`, sessionAEmployee);
      cases.push({ case: "4. Unauthorized same-tenant role (employee)", disposition: rEmp.status === 403 ? "PASS" : "FAIL", detail: `status=${rEmp.status}` });

      const r6 = await apiRequest(baseUrl, "GET", `/api/companies/${companyA}/tax-liability`, null);
      cases.push({ case: "5. Missing authentication", disposition: r6.status === 401 ? "PASS" : "FAIL", detail: `status=${r6.status}` });

      record("GET /api/companies/:id/tax-liability", "server/routes.ts:7742", cases);
    }

    // ══════════════════════ 2. GET /api/companies/:id/quarterly-taxes ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "GET", `/api/companies/${companyA}/quarterly-taxes?year=${year}`, sessionAAdmin);
      const totals1 = Array.isArray((r1.body as any)?.totals) ? (r1.body as any).totals as Array<{ taxCode?: string; totalAmount?: number }> : [];
      const ownAmount1 = totals1.find((x) => x.taxCode === "FED_WH")?.totalAmount;
      cases.push({ case: "1. Tenant A admin reads Tenant A's own quarterly taxes", disposition: r1.status === 200 && Math.round(ownAmount1 ?? -1) === 311 ? "PASS" : "FAIL", detail: `status=${r1.status} amount=${ownAmount1}` });

      const r2 = await apiRequest(baseUrl, "GET", `/api/companies/${companyB}/quarterly-taxes?year=${year}`, sessionAAdmin);
      const totals2 = Array.isArray((r2.body as any)?.totals) ? (r2.body as any).totals as Array<{ totalAmount?: number }> : [];
      const leaked = r2.status === 200 && totals2.some((x) => Math.round(x.totalAmount ?? -1) === 933);
      cases.push({
        case: "2. Tenant A admin reads Tenant B's company quarterly taxes by ID",
        disposition: leaked ? "FAIL" : r2.status === 403 || r2.status === 404 ? "PASS" : "INCONCLUSIVE",
        detail: leaked ? `VERIFIED DEFECT: no comparison of req.params.id to the acting user's own companyId exists anywhere in this handler (server/routes.ts:7761) — storage.getPayrollRuns(req.params.id) is fed the raw path param. status=200, returned Tenant B's federal-withholding total ($933.33) to a Tenant A admin.` : `status=${r2.status}`,
      });

      const r3 = await apiRequest(baseUrl, "GET", `/api/companies/${nonexistentId}/quarterly-taxes?year=${year}`, sessionAAdmin);
      const totals3 = Array.isArray((r3.body as any)?.totals) ? (r3.body as any).totals : [];
      cases.push({ case: "3. Nonexistent company id — no company-existence check exists; storage.getPayrollRuns returns [] rather than a 404, but no data is leaked", disposition: r3.status === 200 && Array.isArray(totals3) && totals3.length === 0 ? "PASS" : "FAIL", detail: `status=${r3.status}` });

      const rEmp = await apiRequest(baseUrl, "GET", `/api/companies/${companyA}/quarterly-taxes?year=${year}`, sessionAEmployee);
      cases.push({ case: "4. Unauthorized same-tenant role (employee)", disposition: rEmp.status === 403 ? "PASS" : "FAIL", detail: `status=${rEmp.status}` });

      const r6 = await apiRequest(baseUrl, "GET", `/api/companies/${companyA}/quarterly-taxes?year=${year}`, null);
      cases.push({ case: "5. Missing authentication", disposition: r6.status === 401 ? "PASS" : "FAIL", detail: `status=${r6.status}` });

      record("GET /api/companies/:id/quarterly-taxes", "server/routes.ts:7761", cases);
    }

    // ══════════════════════ 3. GET /api/check-templates (list) ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "GET", `/api/check-templates?companyId=${companyA}`, sessionAAdmin);
      const list1 = Array.isArray(r1.body) ? (r1.body as Array<{ name?: string }>) : [];
      cases.push({ case: "1. Tenant A admin lists Tenant A's own check templates", disposition: r1.status === 200 && list1.some((x) => x.name === "CT4 Template A") && !list1.some((x) => x.name === "CT4 Template B") ? "PASS" : "FAIL", detail: `status=${r1.status} count=${list1.length}` });

      const r2 = await apiRequest(baseUrl, "GET", `/api/check-templates?companyId=${companyB}`, sessionAAdmin);
      const list2 = Array.isArray(r2.body) ? (r2.body as Array<{ name?: string }>) : [];
      const leaked2 = r2.status === 200 && list2.some((x) => x.name === "CT4 Template B");
      cases.push({
        case: "2. Tenant A admin lists Tenant B's check templates via ?companyId=",
        disposition: leaked2 ? "FAIL" : r2.status === 403 || (r2.status === 200 && list2.length === 0) ? "PASS" : "INCONCLUSIVE",
        detail: leaked2 ? `VERIFIED DEFECT: ?companyId= is applied verbatim with no comparison to the acting user's own companyId (server/routes.ts:20738). status=200, returned Tenant B's check template list.` : `status=${r2.status} count=${list2.length}`,
      });

      const r3 = await apiRequest(baseUrl, "GET", `/api/check-templates`, sessionAAdmin);
      const list3 = Array.isArray(r3.body) ? (r3.body as Array<{ name?: string }>) : [];
      const leaked3 = r3.status === 200 && list3.some((x) => x.name === "CT4 Template B");
      cases.push({
        case: "3. Tenant A admin omits companyId entirely",
        disposition: leaked3 ? "FAIL" : r3.status === 200 && list3.every((x) => x.name !== "CT4 Template B") ? "PASS" : "INCONCLUSIVE",
        detail: leaked3 ? `VERIFIED DEFECT: storage.getCheckTemplates() with no argument returns every company's templates unfiltered (server/storage.ts) — a bigger leak than case 2, no companyId guess required. status=200, list included Tenant B's template.` : `status=${r3.status} count=${list3.length}`,
      });

      cases.push({ case: "4. Role-gate check — not applicable: this route has no requireRole at all (requireAuth only)", disposition: "N/A", detail: "no requireRole present" });

      const r5 = await apiRequest(baseUrl, "GET", `/api/check-templates?companyId=${companyA}`, null);
      cases.push({ case: "5. Missing authentication", disposition: r5.status === 401 ? "PASS" : "FAIL", detail: `status=${r5.status}` });

      record("GET /api/check-templates", "server/routes.ts:20738", cases);
    }

    // ══════════════════════ 4. POST /api/check-templates (create) ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "POST", `/api/check-templates`, sessionAAdmin, { companyId: companyA, name: `CT4 Created A ${suffix}`, templateType: "standard" });
      cases.push({ case: "1. Tenant A admin creates a check template with their own companyId", disposition: r1.status === 201 ? "PASS" : "FAIL", detail: `status=${r1.status}` });

      const r2 = await apiRequest(baseUrl, "POST", `/api/check-templates`, sessionAAdmin, { companyId: companyB, name: `CT4 Injected Into B ${suffix}`, templateType: "standard" });
      const createdForeign = r2.status === 201 && (r2.body as any)?.companyId === companyB;
      cases.push({
        case: "2. Tenant A admin creates a check template with Tenant B's companyId in the body",
        disposition: createdForeign ? "FAIL" : r2.status === 403 || r2.status === 400 ? "PASS" : "INCONCLUSIVE",
        detail: createdForeign ? `VERIFIED DEFECT: companyId from the request body is used verbatim with no comparison to the acting user's own company (server/routes.ts:20767). status=201, created a new row owned by Tenant B.` : `status=${r2.status}`,
      });

      cases.push({ case: "3. Role-gate check — not applicable: this route has no requireRole at all (requireAuth only)", disposition: "N/A", detail: "no requireRole present" });

      const r4 = await apiRequest(baseUrl, "POST", `/api/check-templates`, null, { companyId: companyA, name: "x" });
      cases.push({ case: "4. Missing authentication", disposition: r4.status === 401 ? "PASS" : "FAIL", detail: `status=${r4.status}` });

      record("POST /api/check-templates", "server/routes.ts:20767", cases);
    }

    // ══════════════════════ 5. PATCH /api/payroll-payment-methods/:id ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "PATCH", `/api/payroll-payment-methods/${paymentMethodA}`, sessionAAdmin, { name: "CT4 Cash A Renamed" });
      cases.push({ case: "1. Tenant A admin updates Tenant A's own payment method", disposition: r1.status === 200 ? "PASS" : "FAIL", detail: `status=${r1.status}` });

      const beforeB = await pool.query("SELECT name, company_id FROM payroll_payment_methods WHERE id = $1", [paymentMethodB]);
      const r2 = await apiRequest(baseUrl, "PATCH", `/api/payroll-payment-methods/${paymentMethodB}`, sessionAAdmin, { name: "CT4 Hijacked B" });
      const afterB = await pool.query("SELECT name FROM payroll_payment_methods WHERE id = $1", [paymentMethodB]);
      const changedB = afterB.rows[0]?.name !== beforeB.rows[0]?.name;
      if (changedB) await pool.query("UPDATE payroll_payment_methods SET name = $1 WHERE id = $2", [beforeB.rows[0]?.name, paymentMethodB]);
      cases.push({
        case: "2. Tenant A admin updates Tenant B's payment method by ID",
        disposition: changedB ? "FAIL" : r2.status === 403 || r2.status === 404 ? "PASS" : "INCONCLUSIVE",
        detail: changedB ? `VERIFIED DEFECT: no company-ownership check exists in this handler (server/routes.ts:22673) — storage.updatePayrollPaymentMethod(id, data) applies any field to any payment-method id with no comparison to the acting user's company. status=${r2.status}, name changed. Restored immediately after detection.` : `status=${r2.status}`,
      });

      const beforeA = await pool.query("SELECT company_id FROM payroll_payment_methods WHERE id = $1", [paymentMethodA]);
      const r3 = await apiRequest(baseUrl, "PATCH", `/api/payroll-payment-methods/${paymentMethodA}`, sessionAAdmin, { companyId: companyB });
      const afterA = await pool.query("SELECT company_id FROM payroll_payment_methods WHERE id = $1", [paymentMethodA]);
      const reassigned = afterA.rows[0]?.company_id !== beforeA.rows[0]?.company_id;
      if (reassigned) await pool.query("UPDATE payroll_payment_methods SET company_id = $1 WHERE id = $2", [companyA, paymentMethodA]);
      cases.push({
        case: "3. Tenant A's own payment method ID + Tenant B's companyId in the update body",
        disposition: reassigned ? "FAIL" : "PASS",
        detail: reassigned ? `VERIFIED DEFECT: companyId is not immutable through this endpoint — the same defect shape already fixed on PATCH /api/check-templates/:id (PR #89/#90). status=${r3.status}, companyId changed. Restored immediately after detection.` : `companyId in the request body did not change the row (status=${r3.status}).`,
      });

      const r4 = await apiRequest(baseUrl, "PATCH", `/api/payroll-payment-methods/${nonexistentId}`, sessionAAdmin, { name: "x" });
      cases.push({ case: "4. Nonexistent payment method id", disposition: r4.status === 404 ? "PASS" : "FAIL", detail: `status=${r4.status}` });

      const rEmp = await apiRequest(baseUrl, "PATCH", `/api/payroll-payment-methods/${paymentMethodA}`, sessionAEmployee, { name: "x" });
      cases.push({ case: "5. Unauthorized same-tenant role (employee)", disposition: rEmp.status === 403 ? "PASS" : "FAIL", detail: `status=${rEmp.status}` });

      const r6 = await apiRequest(baseUrl, "PATCH", `/api/payroll-payment-methods/${paymentMethodA}`, null, { name: "x" });
      cases.push({ case: "6. Missing authentication", disposition: r6.status === 401 ? "PASS" : "FAIL", detail: `status=${r6.status}` });

      record("PATCH /api/payroll-payment-methods/:id", "server/routes.ts:22673", cases);
    }

    // ══════════════════════ 6. PATCH /api/payroll-payment-records/:id ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "PATCH", `/api/payroll-payment-records/${paymentRecordA}`, sessionAAdmin, { memo: "CT4 record A updated" });
      cases.push({ case: "1. Tenant A admin updates Tenant A's own payment record", disposition: r1.status === 200 ? "PASS" : "FAIL", detail: `status=${r1.status}` });

      const beforeB = await pool.query("SELECT memo FROM payroll_payment_records WHERE id = $1", [paymentRecordB]);
      const r2 = await apiRequest(baseUrl, "PATCH", `/api/payroll-payment-records/${paymentRecordB}`, sessionAAdmin, { memo: "CT4 hijacked B" });
      const afterB = await pool.query("SELECT memo FROM payroll_payment_records WHERE id = $1", [paymentRecordB]);
      const changedB = afterB.rows[0]?.memo !== beforeB.rows[0]?.memo;
      if (changedB) await pool.query("UPDATE payroll_payment_records SET memo = $1 WHERE id = $2", [beforeB.rows[0]?.memo, paymentRecordB]);
      cases.push({
        case: "2. Tenant A admin updates Tenant B's payment record by ID",
        disposition: changedB ? "FAIL" : r2.status === 403 || r2.status === 404 ? "PASS" : "INCONCLUSIVE",
        detail: changedB ? `VERIFIED DEFECT: no company-ownership check exists in this handler (server/routes.ts:22828) — storage.updatePayrollPaymentRecord(id, data) applies any field to any payment-record id with no comparison to the acting user's company. status=${r2.status}, memo changed. Restored immediately after detection.` : `status=${r2.status}`,
      });

      const beforeA = await pool.query("SELECT company_id FROM payroll_payment_records WHERE id = $1", [paymentRecordA]);
      const r3 = await apiRequest(baseUrl, "PATCH", `/api/payroll-payment-records/${paymentRecordA}`, sessionAAdmin, { companyId: companyB });
      const afterA = await pool.query("SELECT company_id FROM payroll_payment_records WHERE id = $1", [paymentRecordA]);
      const reassigned = afterA.rows[0]?.company_id !== beforeA.rows[0]?.company_id;
      if (reassigned) await pool.query("UPDATE payroll_payment_records SET company_id = $1 WHERE id = $2", [companyA, paymentRecordA]);
      cases.push({
        case: "3. Tenant A's own payment record ID + Tenant B's companyId in the update body",
        disposition: reassigned ? "FAIL" : "PASS",
        detail: reassigned ? `VERIFIED DEFECT: companyId is not immutable through this endpoint. status=${r3.status}, companyId changed. Restored immediately after detection.` : `companyId in the request body did not change the row (status=${r3.status}).`,
      });

      const r4 = await apiRequest(baseUrl, "PATCH", `/api/payroll-payment-records/${nonexistentId}`, sessionAAdmin, { memo: "x" });
      cases.push({ case: "4. Nonexistent payment record id", disposition: r4.status === 404 ? "PASS" : "FAIL", detail: `status=${r4.status}` });

      const rEmp = await apiRequest(baseUrl, "PATCH", `/api/payroll-payment-records/${paymentRecordA}`, sessionAEmployee, { memo: "x" });
      cases.push({ case: "5. Unauthorized same-tenant role (employee)", disposition: rEmp.status === 403 ? "PASS" : "FAIL", detail: `status=${rEmp.status}` });

      const r6 = await apiRequest(baseUrl, "PATCH", `/api/payroll-payment-records/${paymentRecordA}`, null, { memo: "x" });
      cases.push({ case: "6. Missing authentication", disposition: r6.status === 401 ? "PASS" : "FAIL", detail: `status=${r6.status}` });

      record("PATCH /api/payroll-payment-records/:id", "server/routes.ts:22828", cases);
    }

    // ══════════════════════ 7. DELETE /api/payroll-payment-records/:id ══════════════════════
    {
      const cases: CaseResult[] = [];
      const beforeB = await pool.query("SELECT 1 FROM payroll_payment_records WHERE id = $1", [paymentRecordB]);
      const r1 = await apiRequest(baseUrl, "DELETE", `/api/payroll-payment-records/${paymentRecordB}`, sessionAAdmin);
      const afterB = await pool.query("SELECT 1 FROM payroll_payment_records WHERE id = $1", [paymentRecordB]);
      const deletedB = beforeB.rows.length > 0 && afterB.rows.length === 0;
      cases.push({
        case: "1. Tenant A admin deletes Tenant B's payment record by ID",
        disposition: deletedB ? "FAIL" : r1.status === 403 ? "PASS" : "INCONCLUSIVE",
        detail: deletedB ? `VERIFIED DEFECT: no company-ownership check exists in this handler (server/routes.ts:22836) — storage.deletePayrollPaymentRecord(id) deletes any payment-record id with no comparison to the acting user's company. status=${r1.status}, row no longer exists (was present before this request: true).` : `status=${r1.status} rowStillExists=${afterB.rows.length > 0}`,
      });

      const r2 = await apiRequest(baseUrl, "DELETE", `/api/payroll-payment-records/${nonexistentId}`, sessionAAdmin);
      cases.push({ case: "2. Nonexistent payroll payment record id — storage.deletePayrollPaymentRecord has no existence check, so this always reports success rather than 404; informational, not a leak", disposition: r2.status === 200 ? "PASS" : r2.status === 404 ? "PASS" : "INCONCLUSIVE", detail: `status=${r2.status}` });

      const rEmp = await apiRequest(baseUrl, "DELETE", `/api/payroll-payment-records/${paymentRecordADelete}`, sessionAEmployee);
      cases.push({ case: "3. Unauthorized same-tenant role (employee) — requireRole(\"admin\") excludes both employee and manager", disposition: rEmp.status === 403 ? "PASS" : "FAIL", detail: `status=${rEmp.status}` });

      const r4 = await apiRequest(baseUrl, "DELETE", `/api/payroll-payment-records/${paymentRecordADelete}`, null);
      cases.push({ case: "4. Missing authentication", disposition: r4.status === 401 ? "PASS" : "FAIL", detail: `status=${r4.status}` });

      const r5 = await apiRequest(baseUrl, "DELETE", `/api/payroll-payment-records/${paymentRecordADelete}`, sessionAAdmin);
      cases.push({ case: "5. Tenant A admin deletes Tenant A's own payment record", disposition: r5.status === 200 ? "PASS" : "FAIL", detail: `status=${r5.status}` });

      record("DELETE /api/payroll-payment-records/:id", "server/routes.ts:22836", cases);
    }

    // ══════════════════════ 8. GET /api/worker-memberships ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "GET", `/api/worker-memberships?companyId=${companyA}`, sessionAAdmin);
      const list1 = Array.isArray(r1.body) ? (r1.body as Array<{ organization?: string }>) : [];
      cases.push({ case: "1. Tenant A admin lists Tenant A's own worker memberships", disposition: r1.status === 200 && list1.some((x) => x.organization === "CT4 Org A") && !list1.some((x) => x.organization === "CT4 Org B") ? "PASS" : "FAIL", detail: `status=${r1.status} count=${list1.length}` });

      const r2 = await apiRequest(baseUrl, "GET", `/api/worker-memberships?companyId=${companyB}`, sessionAAdmin);
      const list2 = Array.isArray(r2.body) ? (r2.body as Array<{ organization?: string }>) : [];
      const leaked2 = r2.status === 200 && list2.some((x) => x.organization === "CT4 Org B");
      cases.push({
        case: "2. Tenant A admin lists Tenant B's worker memberships via ?companyId=",
        disposition: leaked2 ? "FAIL" : r2.status === 403 || (r2.status === 200 && list2.length === 0) ? "PASS" : "INCONCLUSIVE",
        detail: leaked2 ? `VERIFIED DEFECT: no requireRole and no companyId comparison exist on this route (server/routes.ts:9747) — ?companyId= is applied verbatim. status=200, returned Tenant B's worker-membership list to a Tenant A admin.` : `status=${r2.status} count=${list2.length}`,
      });

      const r3 = await apiRequest(baseUrl, "GET", `/api/worker-memberships`, sessionAAdmin);
      const list3 = Array.isArray(r3.body) ? (r3.body as Array<{ organization?: string }>) : [];
      const leaked3 = r3.status === 200 && list3.some((x) => x.organization === "CT4 Org B");
      cases.push({
        case: "3. Tenant A admin omits companyId entirely",
        disposition: leaked3 ? "FAIL" : r3.status === 200 && list3.every((x) => x.organization !== "CT4 Org B") ? "PASS" : "INCONCLUSIVE",
        detail: leaked3 ? `VERIFIED DEFECT: storage.getWorkerMemberships() with no argument returns every company's memberships unfiltered. status=200, list included Tenant B's membership.` : `status=${r3.status} count=${list3.length}`,
      });

      const r4 = await apiRequest(baseUrl, "GET", `/api/worker-memberships?companyId=${companyA}`, null);
      cases.push({ case: "4. Missing authentication", disposition: r4.status === 401 ? "PASS" : "FAIL", detail: `status=${r4.status}` });

      record("GET /api/worker-memberships", "server/routes.ts:9747", cases);
    }

    // ══════════════════════ 9. POST /api/worker-memberships ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "POST", `/api/worker-memberships`, sessionAAdmin, { companyId: companyA, workerId: workerAOther, organization: `CT4 Created A ${suffix}` });
      cases.push({ case: "1. Tenant A admin creates a worker membership with their own companyId", disposition: r1.status === 201 ? "PASS" : "FAIL", detail: `status=${r1.status}` });

      const r2 = await apiRequest(baseUrl, "POST", `/api/worker-memberships`, sessionAAdmin, { companyId: companyB, workerId: workerBOther, organization: `CT4 Injected Into B ${suffix}` });
      const createdForeign = r2.status === 201 && (r2.body as any)?.companyId === companyB;
      cases.push({
        case: "2. Tenant A admin creates a worker membership with Tenant B's companyId in the body",
        disposition: createdForeign ? "FAIL" : r2.status === 403 || r2.status === 400 ? "PASS" : "INCONCLUSIVE",
        detail: createdForeign ? `VERIFIED DEFECT: companyId from the request body is used verbatim with no comparison to the acting user's own company (server/routes.ts:9758). status=201, created a new row owned by Tenant B.` : `status=${r2.status}`,
      });

      cases.push({ case: "3. Role-gate check — not applicable: this route has no requireRole at all (requireAuth only)", disposition: "N/A", detail: "no requireRole present" });

      const r4 = await apiRequest(baseUrl, "POST", `/api/worker-memberships`, null, { companyId: companyA, organization: "x" });
      cases.push({ case: "4. Missing authentication", disposition: r4.status === 401 ? "PASS" : "FAIL", detail: `status=${r4.status}` });

      record("POST /api/worker-memberships", "server/routes.ts:9758", cases);
    }

    // ══════════════════════ 10. PATCH /api/worker-memberships/:id ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "PATCH", `/api/worker-memberships/${membershipA}`, sessionAAdmin, { organization: "CT4 Org A Renamed" });
      cases.push({ case: "1. Tenant A admin updates Tenant A's own worker membership", disposition: r1.status === 200 ? "PASS" : "FAIL", detail: `status=${r1.status}` });

      const beforeB = await pool.query("SELECT organization FROM worker_memberships WHERE id = $1", [membershipB]);
      const r2 = await apiRequest(baseUrl, "PATCH", `/api/worker-memberships/${membershipB}`, sessionAAdmin, { organization: "CT4 Hijacked B" });
      const afterB = await pool.query("SELECT organization FROM worker_memberships WHERE id = $1", [membershipB]);
      const changedB = afterB.rows[0]?.organization !== beforeB.rows[0]?.organization;
      if (changedB) await pool.query("UPDATE worker_memberships SET organization = $1 WHERE id = $2", [beforeB.rows[0]?.organization, membershipB]);
      cases.push({
        case: "2. Tenant A admin updates Tenant B's worker membership by ID",
        disposition: changedB ? "FAIL" : r2.status === 403 || r2.status === 404 ? "PASS" : "INCONCLUSIVE",
        detail: changedB ? `VERIFIED DEFECT: no company-ownership check exists in this handler (server/routes.ts:9768) — storage.updateWorkerMembership(id, data) applies any field to any membership id with no comparison to the acting user's company. status=${r2.status}, organization changed. Restored immediately after detection.` : `status=${r2.status}`,
      });

      const beforeA = await pool.query("SELECT company_id FROM worker_memberships WHERE id = $1", [membershipA]);
      const r3 = await apiRequest(baseUrl, "PATCH", `/api/worker-memberships/${membershipA}`, sessionAAdmin, { companyId: companyB });
      const afterA = await pool.query("SELECT company_id FROM worker_memberships WHERE id = $1", [membershipA]);
      const reassigned = afterA.rows[0]?.company_id !== beforeA.rows[0]?.company_id;
      if (reassigned) await pool.query("UPDATE worker_memberships SET company_id = $1 WHERE id = $2", [companyA, membershipA]);
      cases.push({
        case: "3. Tenant A's own worker membership ID + Tenant B's companyId in the update body",
        disposition: reassigned ? "FAIL" : "PASS",
        detail: reassigned ? `VERIFIED DEFECT: companyId is not immutable through this endpoint. status=${r3.status}, companyId changed. Restored immediately after detection.` : `companyId in the request body did not change the row (status=${r3.status}).`,
      });

      const r4 = await apiRequest(baseUrl, "PATCH", `/api/worker-memberships/${nonexistentId}`, sessionAAdmin, { organization: "x" });
      cases.push({ case: "4. Nonexistent worker membership id", disposition: r4.status === 404 ? "PASS" : "FAIL", detail: `status=${r4.status}` });

      const r5 = await apiRequest(baseUrl, "PATCH", `/api/worker-memberships/${membershipA}`, null, { organization: "x" });
      cases.push({ case: "5. Missing authentication", disposition: r5.status === 401 ? "PASS" : "FAIL", detail: `status=${r5.status}` });

      cases.push({ case: "6. Role-gate check — not applicable: this route has no requireRole at all (requireAuth only)", disposition: "N/A", detail: "no requireRole present" });

      record("PATCH /api/worker-memberships/:id", "server/routes.ts:9768", cases);
    }

    // ══════════════════════ 11. DELETE /api/worker-memberships/:id ══════════════════════
    {
      const cases: CaseResult[] = [];
      const beforeB = await pool.query("SELECT 1 FROM worker_memberships WHERE id = $1", [membershipB]);
      const r1 = await apiRequest(baseUrl, "DELETE", `/api/worker-memberships/${membershipB}`, sessionAAdmin);
      const afterB = await pool.query("SELECT 1 FROM worker_memberships WHERE id = $1", [membershipB]);
      const deletedB = beforeB.rows.length > 0 && afterB.rows.length === 0;
      cases.push({
        case: "1. Tenant A admin deletes Tenant B's worker membership by ID",
        disposition: deletedB ? "FAIL" : r1.status === 403 ? "PASS" : "INCONCLUSIVE",
        detail: deletedB ? `VERIFIED DEFECT: no company-ownership check exists in this handler (server/routes.ts:9779) — storage.deleteWorkerMembership(id) deletes any membership id with no comparison to the acting user's company. status=${r1.status}, row no longer exists (was present before this request: true).` : `status=${r1.status} rowStillExists=${afterB.rows.length > 0}`,
      });

      const r2 = await apiRequest(baseUrl, "DELETE", `/api/worker-memberships/${nonexistentId}`, sessionAAdmin);
      cases.push({ case: "2. Nonexistent worker membership id — storage.deleteWorkerMembership has no existence check, so this always reports success rather than 404; informational, not a leak", disposition: r2.status === 200 ? "PASS" : r2.status === 404 ? "PASS" : "INCONCLUSIVE", detail: `status=${r2.status}` });

      const r3 = await apiRequest(baseUrl, "DELETE", `/api/worker-memberships/${membershipADelete}`, null);
      cases.push({ case: "3. Missing authentication", disposition: r3.status === 401 ? "PASS" : "FAIL", detail: `status=${r3.status}` });

      const r4 = await apiRequest(baseUrl, "DELETE", `/api/worker-memberships/${membershipADelete}`, sessionAAdmin);
      cases.push({ case: "4. Tenant A admin deletes Tenant A's own worker membership", disposition: r4.status === 200 ? "PASS" : "FAIL", detail: `status=${r4.status}` });

      cases.push({ case: "5. Role-gate check — not applicable: this route has no requireRole at all (requireAuth only)", disposition: "N/A", detail: "no requireRole present" });

      record("DELETE /api/worker-memberships/:id", "server/routes.ts:9779", cases);
    }

    // ── Print + write the machine-readable manifest ───────────────────────────
    console.log("\n=== Cross-tenant batch-4 route test matrix ===\n");
    const summary: Record<Disposition, number> = { PASS: 0, FAIL: 0, INCONCLUSIVE: 0, "EXPECTED GLOBAL": 0, "N/A": 0 };
    for (const r of routeResults) {
      console.log(`${r.id}  (${r.source})`);
      for (const c of r.cases) {
        summary[c.disposition]++;
        const mark = c.disposition === "PASS" ? "✓" : c.disposition === "N/A" ? "•" : "✗";
        console.log(`  ${mark} [${c.disposition}] ${c.case}`);
      }
      console.log("");
    }
    console.log(`Summary: ${summary.PASS} PASS, ${summary.FAIL} FAIL, ${summary.INCONCLUSIVE} INCONCLUSIVE, ${summary["EXPECTED GLOBAL"]} EXPECTED GLOBAL, ${summary["N/A"]} N/A`);

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
    console.log(`Manifest written to ${MANIFEST_PATH}`);

    if (summary.FAIL === 0) {
      console.log("\nAll cases PASS — no cross-tenant authorization gaps found in this batch.");
    } else {
      console.log(`\n${summary.FAIL} verified defect(s) found — see docs/saas-readiness/phase-0.5-batch-4-cross-tenant-findings.md. This is an audit-only branch; no repair is made here.`);
    }
  } finally {
    if (server) {
      try {
        await server.stop();
      } catch (e) {
        harnessOk = false;
        console.error("Failed to stop test server cleanly:", e);
      }
    }
    try {
      const deletions = await cleanupFixtures(pool, companyIds);
      console.log(`Cleanup verified: zero synthetic rows remain. Deleted: ${deletions.map((d) => `${d.table}(${d.count})`).join(", ")}`);
    } catch (e) {
      harnessOk = false;
      console.error("Cleanup verification failed:", e);
    }
    await pool.end();
  }

  if (!harnessOk) {
    process.exitCode = 1;
  }
}

async function cleanupFixtures(pool: Pool, companyIds: string[]): Promise<Array<{ table: string; column: string; count: number }>> {
  const deletions = await cascadeDelete(pool, "companies", companyIds);
  const leftovers = await verifyZeroResidue(pool, "companies", companyIds);
  if (leftovers.length > 0) {
    throw new Error(`Cleanup verification failed — leftover rows: ${leftovers.join("; ")}`);
  }
  return deletions;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
