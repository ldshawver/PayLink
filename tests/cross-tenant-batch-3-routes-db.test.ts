/**
 * Phase 0.5 — cross-tenant negative tests, batch 3: the next highest-risk
 * unresolved / needs-runtime-hardening routes selected from the committed
 * storage-scope-trace manifest (docs/saas-readiness/storage-scope-trace-manifest.json)
 * and route-security manifest, excluding every route already covered by
 * batch 1 (tests/cross-tenant-worker-routes-db.test.ts, PR #84/#85) or
 * batch 2 (tests/cross-tenant-batch-2-routes-db.test.ts, PR #87/#88).
 *
 * Routes tested (manifest disposition | confidence | source):
 *   1. GET   /api/companies/:id/ytd-taxes         | unresolved              | n/a (manual) | server/routes.ts:7864
 *   2. GET   /api/check-templates/:id             | unresolved              | n/a (manual) | server/routes.ts:20708
 *   3. PATCH /api/check-templates/:id             | unresolved              | n/a (manual) | server/routes.ts:20738
 *   4. DELETE /api/check-templates/:id            | unresolved              | n/a (manual) | server/routes.ts:20750
 *   5. PATCH /api/contractor-invoices/:id         | unresolved              | n/a (manual) | server/routes.ts:10608
 *   6. GET   /api/wage-history                    | unresolved              | n/a (manual) | server/routes.ts:18962
 *   7. DELETE /api/payroll-payment-methods/:id    | unresolved              | n/a (manual) | server/routes.ts:22605
 *   8. GET   /api/payroll-summary                 | needs-runtime-hardening | medium       | server/routes.ts:1907
 *
 * Selection rationale (per docs/saas-readiness/storage-scope-trace-manifest.json,
 * cross-referenced against the committed route-security-manifest.json and this
 * batch's manual source reading — see the findings doc for the full writeup):
 *   1. Sibling of the already-fixed GET /api/workers/:id/ytd-taxes (PR #85) at
 *      the company level: requireRole("admin","manager") only, no comparison
 *      of req.params.id (target company) to the acting user's own companyId
 *      anywhere in the handler — storage.getWorkers(companyId) is fed the raw
 *      path param. Employee compensation/tax data category, high confidence
 *      from manual reading.
 *   2-4. check_templates carries per-tenant bank routing/check-layout
 *        configuration (checks/paystub category). All three verbs use
 *        requireAuth only — no requireRole, no company-ownership comparison
 *        anywhere — the most permissive gap found in this batch.
 *   5. Sibling of the already-fixed POST /api/contractor-invoices/:id/mark-paid
 *      (PR #88): has an owner-or-manager role check but no company-ownership
 *      comparison, and `companyId` is in the PATCH body's own allowed-fields
 *      list with no immutability guard — invoice payments/financial
 *      settlement category.
 *   6. wage_history is the definitive compensation-history record
 *      (employee wage/salary category). Non-manager tenant users are
 *      correctly self-scoped, but a manager/admin's `?workerId=` query param
 *      is passed straight to storage.getWageHistory with no company
 *      comparison.
 *   7. payroll_payment_methods carries bank-based payment configuration
 *      (payroll/financial settlement category). DELETE has a role gate but
 *      no company-ownership comparison before storage.deletePayrollPaymentMethod.
 *   8. Flagged medium-confidence "needs-runtime-hardening" in the committed
 *      storage-scope-trace manifest (client-supplied companyId feeds a
 *      company-filtered query). Included to empirically confirm whether the
 *      route's own tenant-override logic (isTenantSummaryUser) actually holds
 *      under a live cross-tenant attempt, matching the batch 1/2 precedent of
 *      testing routes whose source suggests a guard exists rather than
 *      assuming it from static reading alone.
 *
 * Deliberately excluded from this batch (already covered):
 *   GET/POST /api/workers, PATCH/DELETE /api/workers/:id,
 *   GET /api/workers/:id/ytd-taxes (batch 1, PR #84/#85);
 *   GET/PATCH/DELETE /api/payroll-runs/:id[/summary], PATCH/DELETE
 *   /api/invoices/:id, POST /api/contractor-invoices/:id/mark-paid,
 *   POST /api/contractor-trade-compensation/:id/approve,
 *   GET /api/dam-documents/:id, PATCH /api/companies/:id (batch 2, PR #87/#88).
 *
 * roles table (server/roles management: GET/PATCH/DELETE /api/roles/:id) was
 * considered and deliberately excluded — the `roles` table
 * (shared/schema.ts:1129) has no companyId/tenantId column at all and
 * `name` is globally unique; it is a platform-wide shared resource by
 * design, not a per-tenant one, so the cross-tenant isolation methodology
 * this suite uses does not apply to it. Whether tenant_admin/tenant_owner
 * should hold platform-wide role-management capability at all is a
 * different (authorization-scope, not tenant-isolation) question, out of
 * scope for this batch.
 *
 * Methodology matches tests/cross-tenant-batch-2-routes-db.test.ts exactly:
 * boots the REAL, unmodified application server (server/index.ts) against a
 * disposable Postgres database, creates two synthetic tenants with real
 * authenticated sessions via the real POST /api/auth/login route, and
 * exercises each route's actual authorization logic over real HTTP
 * requests. Not a mock.
 *
 * This is a TEST-FIRST / AUDIT-FIRST branch: no runtime repair is made here
 * for any defect this file verifies. Verified defects are documented in
 * docs/saas-readiness/phase-0.5-batch-3-cross-tenant-findings.md and this
 * file preserves the minimal reproducing case as a FAIL, exactly as batches
 * 1 and 2 did before their follow-up hardening branches.
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
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable_db npx tsx tests/cross-tenant-batch-3-routes-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import fs from "node:fs";
import { startTestServer, login, apiRequest, type TestServer, type Session } from "../scripts/cross-tenant-negative-tests/server-harness";
import { cascadeDelete, verifyZeroResidue } from "../scripts/cross-tenant-negative-tests/cascade-cleanup";

const FORBIDDEN_PATTERNS = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];
const MANIFEST_PATH = "docs/saas-readiness/cross-tenant-batch-3-test-manifest.json";

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
    console.log("TEST_DATABASE_URL not set — skipping cross-tenant batch-3 tests (0 run).");
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
    await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2), ($3, $4)`, [companyA, `CT3 Test Tenant A ${suffix}`, companyB, `CT3 Test Tenant B ${suffix}`]);

    const pwPlain = crypto.randomBytes(12).toString("hex");
    const pwHash = await bcrypt.hash(pwPlain, 10);

    const userAAdmin = crypto.randomUUID();
    const userAEmployee = crypto.randomUUID();
    const userBAdmin = crypto.randomUUID();
    const usernameAAdmin = `ct3_a_admin_${suffix}`;
    const usernameAEmployee = `ct3_a_employee_${suffix}`;
    const usernameBAdmin = `ct3_b_admin_${suffix}`;
    // A random id never inserted into any table — used for the "nonexistent
    // resource" case, distinct from a real foreign-tenant id.
    const nonexistentId = crypto.randomUUID();

    const workerAEmployeeSelf = crypto.randomUUID();
    const workerAOther = crypto.randomUUID();
    const workerBOther = crypto.randomUUID();
    const workerAContractor = crypto.randomUUID();
    const workerBContractor = crypto.randomUUID();
    await pool.query(
      `INSERT INTO workers (id, company_id, first_name, last_name, worker_type, pay_rate, employee_number) VALUES
       ($1,$2,'CT3','EmployeeSelfA','employee','0','9201'),
       ($3,$2,'CT3','OtherA','employee','0','9202'),
       ($4,$5,'CT3','OtherB','employee','0','9203'),
       ($6,$2,'CT3','ContractorA','contractor','0','9204'),
       ($7,$5,'CT3','ContractorB','contractor','0','9205')`,
      [workerAEmployeeSelf, companyA, workerAOther, workerBOther, companyB, workerAContractor, workerBContractor],
    );

    await pool.query(
      `INSERT INTO users (id, username, password, role, company_id, worker_id, first_name, last_name, is_active) VALUES
       ($1,$2,$3,'admin',$4,NULL,'CT3','AdminA', true),
       ($5,$6,$3,'employee',$4,$7,'CT3','EmployeeA', true),
       ($8,$9,$3,'admin',$10,NULL,'CT3','AdminB', true)`,
      [userAAdmin, usernameAAdmin, pwHash, companyA, userAEmployee, usernameAEmployee, workerAEmployeeSelf, userBAdmin, usernameBAdmin, companyB],
    );

    // ── Wage history — one entry per tenant, distinct wage values ─────────────
    const wageHistA = crypto.randomUUID();
    const wageHistB = crypto.randomUUID();
    await pool.query(
      `INSERT INTO wage_history (id, worker_id, company_id, wage_type, wage, effective_date) VALUES
       ($1,$2,$3,'hourly','21.11',$5), ($4,$6,$7,'hourly','29.99',$5)`,
      [wageHistA, workerAOther, companyA, wageHistB, "2026-01-01", workerBOther, companyB],
    );

    // ── Check templates ────────────────────────────────────────────────────
    const checkTplATarget = crypto.randomUUID();
    const checkTplADelete = crypto.randomUUID();
    const checkTplB = crypto.randomUUID();
    await pool.query(
      `INSERT INTO check_templates (id, company_id, name, template_type) VALUES
       ($1,$2,'CT3 Template A1','standard'), ($3,$2,'CT3 Template A-delete','standard'), ($4,$5,'CT3 Template B','standard')`,
      [checkTplATarget, companyA, checkTplADelete, checkTplB, companyB],
    );

    // ── Contractor invoices ────────────────────────────────────────────────
    const ctrInvA = crypto.randomUUID();
    const ctrInvB = crypto.randomUUID();
    await pool.query(
      `INSERT INTO contractor_invoices (id, company_id, contractor_id, invoice_date, amount, status) VALUES
       ($1,$2,$3,$4,'400.00','draft'), ($5,$6,$7,$4,'900.00','draft')`,
      [ctrInvA, companyA, workerAContractor, "2026-03-01", ctrInvB, companyB, workerBContractor],
    );

    // ── Payroll payment methods ────────────────────────────────────────────
    const paymentMethodATarget = crypto.randomUUID();
    const paymentMethodADelete = crypto.randomUUID();
    const paymentMethodB = crypto.randomUUID();
    await pool.query(
      `INSERT INTO payroll_payment_methods (id, company_id, code, name, category) VALUES
       ($1,$2,'CT3-CASH-A','CT3 Cash A','cash'), ($3,$2,'CT3-CASH-A2','CT3 Cash A delete','cash'), ($4,$5,'CT3-CASH-B','CT3 Cash B','cash')`,
      [paymentMethodATarget, companyA, paymentMethodADelete, paymentMethodB, companyB],
    );

    // ── Payroll runs + items for the payroll-summary confirm-guard-holds test ──
    const year = new Date().getFullYear();
    const runA = crypto.randomUUID();
    const runB = crypto.randomUUID();
    await pool.query(
      `INSERT INTO payroll_runs (id, company_id, period_start, period_end, pay_date, status) VALUES
       ($1,$2,$3,$4,$3,'processed'), ($5,$6,$3,$4,$3,'processed')`,
      [runA, companyA, `${year}-04-01`, `${year}-04-15`, runB, companyB],
    );
    await pool.query(
      `INSERT INTO payroll_items (id, payroll_run_id, worker_id, gross_pay, deductions, net_pay) VALUES
       ($1,$2,$3,'3000.00','0','3000.00'), ($4,$5,$6,'9000.00','0','9000.00')`,
      [crypto.randomUUID(), runA, workerAOther, crypto.randomUUID(), runB, workerBOther],
    );

    // ── Boot the real server against this disposable database ────────────────
    server = await startTestServer(testDatabaseUrl);
    const baseUrl = server.baseUrl;

    const sessionAAdmin: Session = await login(baseUrl, usernameAAdmin, pwPlain);
    const sessionAEmployee: Session = await login(baseUrl, usernameAEmployee, pwPlain);

    // ══════════════════════ 1. GET /api/companies/:id/ytd-taxes ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "GET", `/api/companies/${companyA}/ytd-taxes`, sessionAAdmin);
      const list1 = Array.isArray(r1.body) ? (r1.body as Array<{ workerId?: string }>) : [];
      const containsOnlyA = list1.every((x) => x.workerId === workerAEmployeeSelf || x.workerId === workerAOther || x.workerId === workerAContractor);
      cases.push({
        case: "1. Tenant A admin reads Tenant A's own company YTD taxes",
        disposition: r1.status === 200 && containsOnlyA ? "PASS" : "FAIL",
        detail: `status=${r1.status} entries=${list1.length} containsOnlyOwnTenant=${containsOnlyA}`,
      });

      const r2 = await apiRequest(baseUrl, "GET", `/api/companies/${companyB}/ytd-taxes`, sessionAAdmin);
      const list2 = Array.isArray(r2.body) ? (r2.body as Array<{ workerId?: string }>) : [];
      const leaked = r2.status === 200 && list2.length > 0;
      cases.push({
        case: "2. Tenant A admin reads Tenant B's company YTD taxes by ID",
        disposition: leaked ? "FAIL" : r2.status === 403 || r2.status === 404 ? "PASS" : "INCONCLUSIVE",
        detail: leaked
          ? `VERIFIED DEFECT: no comparison of req.params.id to the acting user's own companyId exists anywhere in this handler (server/routes.ts:7864-7879) — storage.getWorkers(companyId) and storage.getEmployeeYTD are both fed the raw path param. status=${r2.status}, returned ${list2.length} Tenant B worker YTD entries to a Tenant A admin.`
          : `status=${r2.status} entries=${list2.length}`,
      });

      const r3 = await apiRequest(baseUrl, "GET", `/api/companies/${nonexistentId}/ytd-taxes`, sessionAAdmin);
      const list3 = Array.isArray(r3.body) ? r3.body : [];
      cases.push({
        case: "3. Nonexistent company id — no company-existence check exists; storage.getWorkers returns an empty list rather than a 404, but no data is leaked",
        disposition: r3.status === 200 && Array.isArray(r3.body) && list3.length === 0 ? "PASS" : "FAIL",
        detail: `status=${r3.status} entries=${list3.length}`,
      });

      const rEmp = await apiRequest(baseUrl, "GET", `/api/companies/${companyA}/ytd-taxes`, sessionAEmployee);
      cases.push({ case: "4. Unauthorized same-tenant role (employee)", disposition: rEmp.status === 403 ? "PASS" : "FAIL", detail: `status=${rEmp.status}` });

      const r6 = await apiRequest(baseUrl, "GET", `/api/companies/${companyA}/ytd-taxes`, null);
      cases.push({ case: "5. Missing authentication", disposition: r6.status === 401 ? "PASS" : "FAIL", detail: `status=${r6.status}` });

      record("GET /api/companies/:id/ytd-taxes", "server/routes.ts:7864", cases);
    }

    // ══════════════════════ 2. GET /api/check-templates/:id ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "GET", `/api/check-templates/${checkTplATarget}`, sessionAAdmin);
      const name1 = (r1.body as { name?: string } | undefined)?.name;
      cases.push({
        case: "1. Tenant A admin reads Tenant A's own check template",
        disposition: r1.status === 200 && name1 === "CT3 Template A1" ? "PASS" : "FAIL",
        detail: `status=${r1.status}`,
      });

      const r2 = await apiRequest(baseUrl, "GET", `/api/check-templates/${checkTplB}`, sessionAAdmin);
      const name2 = (r2.body as { name?: string } | undefined)?.name;
      const leaked = r2.status === 200 && name2 !== undefined;
      cases.push({
        case: "2. Tenant A admin reads Tenant B's check template by ID",
        disposition: leaked ? "FAIL" : r2.status === 403 || r2.status === 404 ? "PASS" : "INCONCLUSIVE",
        detail: leaked
          ? `VERIFIED DEFECT: no company-ownership check of any kind exists in this handler (server/routes.ts:20708-20717), and the route has no requireRole either — any authenticated user of any role in any tenant can read any other tenant's check template. status=${r2.status}.`
          : `status=${r2.status}`,
      });

      const r3 = await apiRequest(baseUrl, "GET", `/api/check-templates/${nonexistentId}`, sessionAAdmin);
      cases.push({ case: "3. Nonexistent check template id", disposition: r3.status === 404 ? "PASS" : "FAIL", detail: `status=${r3.status}` });

      cases.push({
        case: "4. Role-gate check — not applicable: this route has no requireRole at all (requireAuth only), by design or omission; see finding for severity",
        disposition: "N/A",
        detail: "no role restriction exists on this route to test",
      });

      const r6 = await apiRequest(baseUrl, "GET", `/api/check-templates/${checkTplATarget}`, null);
      cases.push({ case: "5. Missing authentication", disposition: r6.status === 401 ? "PASS" : "FAIL", detail: `status=${r6.status}` });

      record("GET /api/check-templates/:id", "server/routes.ts:20708", cases);
    }

    // ══════════════════════ 3. PATCH /api/check-templates/:id ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "PATCH", `/api/check-templates/${checkTplATarget}`, sessionAAdmin, { name: "CT3 Template A1 (renamed)" });
      cases.push({ case: "1. Tenant A admin updates Tenant A's own check template", disposition: r1.status === 200 ? "PASS" : "FAIL", detail: `status=${r1.status}` });

      const beforeB = (await pool.query(`SELECT name FROM check_templates WHERE id = $1`, [checkTplB])).rows[0];
      const r2 = await apiRequest(baseUrl, "PATCH", `/api/check-templates/${checkTplB}`, sessionAAdmin, { name: "ct3-hacked-tenant-b" });
      const afterB = (await pool.query(`SELECT name FROM check_templates WHERE id = $1`, [checkTplB])).rows[0];
      const unchangedB = beforeB.name === afterB.name;
      if (!unchangedB) await pool.query(`UPDATE check_templates SET name = $1 WHERE id = $2`, [beforeB.name, checkTplB]);
      cases.push({
        case: "2. Tenant A admin updates Tenant B's check template by ID",
        disposition: unchangedB ? "PASS" : "FAIL",
        detail: unchangedB
          ? `status=${r2.status} rowUnchanged=true`
          : `VERIFIED DEFECT: no company-ownership check exists in this handler (server/routes.ts:20738-20749) — storage.updateCheckTemplate(id, data) applies any field to any check template id with no comparison to the acting user's company. status=${r2.status}, name changed. Restored immediately after detection.`,
      });

      const before3 = (await pool.query(`SELECT company_id FROM check_templates WHERE id = $1`, [checkTplATarget])).rows[0];
      const r3 = await apiRequest(baseUrl, "PATCH", `/api/check-templates/${checkTplATarget}`, sessionAAdmin, { companyId: companyB });
      const after3 = (await pool.query(`SELECT company_id FROM check_templates WHERE id = $1`, [checkTplATarget])).rows[0];
      const reassigned = before3.company_id !== after3.company_id;
      if (reassigned) await pool.query(`UPDATE check_templates SET company_id = $1 WHERE id = $2`, [companyA, checkTplATarget]);
      cases.push({
        case: "3. Tenant A's own check template ID + Tenant B's companyId in the update body",
        disposition: !reassigned ? "PASS" : "FAIL",
        detail: reassigned
          ? `VERIFIED DEFECT: companyId is not immutable through this endpoint — the same defect shape already fixed on PATCH /api/payroll-runs/:id (PR #88). status=${r3.status}, companyId changed. Restored immediately after detection.`
          : `companyId in the request body did not change the row (status=${r3.status}).`,
      });

      const r4 = await apiRequest(baseUrl, "PATCH", `/api/check-templates/${nonexistentId}`, sessionAAdmin, { name: "ct3-nonexistent" });
      cases.push({ case: "4. Nonexistent check template id", disposition: r4.status === 404 ? "PASS" : "FAIL", detail: `status=${r4.status}` });

      cases.push({
        case: "5. Role-gate check — not applicable: this route has no requireRole at all (requireAuth only)",
        disposition: "N/A",
        detail: "no role restriction exists on this route to test",
      });

      const r6 = await apiRequest(baseUrl, "PATCH", `/api/check-templates/${checkTplATarget}`, null, { name: "ct3-noauth" });
      cases.push({ case: "6. Missing authentication", disposition: r6.status === 401 ? "PASS" : "FAIL", detail: `status=${r6.status}` });

      record("PATCH /api/check-templates/:id", "server/routes.ts:20738", cases);
    }

    // ══════════════════════ 4. DELETE /api/check-templates/:id ══════════════════════
    {
      const cases: CaseResult[] = [];
      const beforeB = (await pool.query(`SELECT id FROM check_templates WHERE id = $1`, [checkTplB])).rows[0];
      const r1 = await apiRequest(baseUrl, "DELETE", `/api/check-templates/${checkTplB}`, sessionAAdmin);
      const afterB = (await pool.query(`SELECT id FROM check_templates WHERE id = $1`, [checkTplB])).rows[0];
      cases.push({
        case: "1. Tenant A admin deletes Tenant B's check template by ID",
        disposition: !!afterB ? "PASS" : "FAIL",
        detail: !!afterB
          ? `status=${r1.status} rowStillExists=true`
          : `VERIFIED DEFECT: no company-ownership check exists in this handler (server/routes.ts:20750-20758) — storage.deleteCheckTemplate(id) deletes any check template id with no comparison to the acting user's company. status=${r1.status}, row no longer exists (was present before this request: ${!!beforeB}).`,
      });

      const r2 = await apiRequest(baseUrl, "DELETE", `/api/check-templates/${nonexistentId}`, sessionAAdmin);
      const r2Body = r2.body as { success?: boolean } | undefined;
      cases.push({
        case: "2. Nonexistent check template id — storage.deleteCheckTemplate has no existence check, so this always reports success rather than 404; informational, not a leak",
        disposition: r2.status === 200 ? "PASS" : "FAIL",
        detail: `status=${r2.status} body=${JSON.stringify(r2Body)}`,
      });

      cases.push({
        case: "3. Role-gate check — not applicable: this route has no requireRole at all (requireAuth only)",
        disposition: "N/A",
        detail: "no role restriction exists on this route to test",
      });

      const r6 = await apiRequest(baseUrl, "DELETE", `/api/check-templates/${checkTplADelete}`, null);
      cases.push({ case: "4. Missing authentication", disposition: r6.status === 401 ? "PASS" : "FAIL", detail: `status=${r6.status}` });

      const r4 = await apiRequest(baseUrl, "DELETE", `/api/check-templates/${checkTplADelete}`, sessionAAdmin);
      cases.push({ case: "5. Tenant A admin deletes Tenant A's own check template", disposition: r4.status === 200 ? "PASS" : "FAIL", detail: `status=${r4.status}` });

      record("DELETE /api/check-templates/:id", "server/routes.ts:20750", cases);
    }

    // ══════════════════════ 5. PATCH /api/contractor-invoices/:id ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "PATCH", `/api/contractor-invoices/${ctrInvA}`, sessionAAdmin, { notes: "ct3-updated" });
      cases.push({ case: "1. Tenant A admin updates Tenant A's own contractor invoice", disposition: r1.status === 200 ? "PASS" : "FAIL", detail: `status=${r1.status}` });

      const beforeB = (await pool.query(`SELECT notes FROM contractor_invoices WHERE id = $1`, [ctrInvB])).rows[0];
      const r2 = await apiRequest(baseUrl, "PATCH", `/api/contractor-invoices/${ctrInvB}`, sessionAAdmin, { notes: "ct3-hacked-by-a" });
      const afterB = (await pool.query(`SELECT notes FROM contractor_invoices WHERE id = $1`, [ctrInvB])).rows[0];
      const unchangedB = beforeB.notes === afterB.notes;
      cases.push({
        case: "2. Tenant A admin updates Tenant B's contractor invoice by ID",
        disposition: unchangedB ? "PASS" : "FAIL",
        detail: unchangedB
          ? `status=${r2.status} rowUnchanged=true`
          : `VERIFIED DEFECT: no company-ownership check exists in this handler (server/routes.ts:10608-10627) — the isOwner/isManager check (line 10614-10616) is role-only, never compares existing.companyId to the acting user's company. status=${r2.status}, notes changed from Tenant B's original value.`,
      });

      const before3 = (await pool.query(`SELECT company_id FROM contractor_invoices WHERE id = $1`, [ctrInvA])).rows[0];
      const r3 = await apiRequest(baseUrl, "PATCH", `/api/contractor-invoices/${ctrInvA}`, sessionAAdmin, { companyId: companyB, notes: "ct3-reassign-attempt" });
      const after3 = (await pool.query(`SELECT company_id FROM contractor_invoices WHERE id = $1`, [ctrInvA])).rows[0];
      const reassigned = before3.company_id !== after3.company_id;
      if (reassigned) await pool.query(`UPDATE contractor_invoices SET company_id = $1 WHERE id = $2`, [companyA, ctrInvA]);
      cases.push({
        case: "3. Tenant A's own contractor invoice ID + Tenant B's companyId in the update body",
        disposition: !reassigned ? "PASS" : "FAIL",
        detail: reassigned
          ? `VERIFIED DEFECT: companyId is one of this route's own allowedFields (server/routes.ts:10619) with no immutability guard — the same defect shape already fixed on PATCH /api/payroll-runs/:id (PR #88). status=${r3.status}, companyId changed. Restored immediately after detection.`
          : `companyId in the request body did not change the row (status=${r3.status}).`,
      });

      const r4 = await apiRequest(baseUrl, "PATCH", `/api/contractor-invoices/${nonexistentId}`, sessionAAdmin, { notes: "ct3-nonexistent" });
      cases.push({ case: "4. Nonexistent contractor invoice id", disposition: r4.status === 404 ? "PASS" : "FAIL", detail: `status=${r4.status}` });

      const rEmp = await apiRequest(baseUrl, "PATCH", `/api/contractor-invoices/${ctrInvA}`, sessionAEmployee, { notes: "ct3-emp" });
      cases.push({
        case: "5. Unauthorized same-tenant role (employee, not the invoice's own contractor) — rejected by the route's internal isOwner/isManager check, not requireRole (this route has no requireRole)",
        disposition: rEmp.status === 403 ? "PASS" : "FAIL",
        detail: `status=${rEmp.status}`,
      });

      const r6 = await apiRequest(baseUrl, "PATCH", `/api/contractor-invoices/${ctrInvA}`, null, { notes: "ct3-noauth" });
      cases.push({ case: "6. Missing authentication", disposition: r6.status === 401 ? "PASS" : "FAIL", detail: `status=${r6.status}` });

      record("PATCH /api/contractor-invoices/:id", "server/routes.ts:10608", cases);
    }

    // ══════════════════════ 6. GET /api/wage-history ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "GET", `/api/wage-history?workerId=${workerAOther}`, sessionAAdmin);
      const list1 = Array.isArray(r1.body) ? (r1.body as Array<{ id?: string }>) : [];
      cases.push({
        case: "1. Tenant A admin reads Tenant A's own worker's wage history",
        disposition: r1.status === 200 && list1.some((x) => x.id === wageHistA) ? "PASS" : "FAIL",
        detail: `status=${r1.status} entries=${list1.length}`,
      });

      const r2 = await apiRequest(baseUrl, "GET", `/api/wage-history?workerId=${workerBOther}`, sessionAAdmin);
      const list2 = Array.isArray(r2.body) ? (r2.body as Array<{ id?: string }>) : [];
      const leaked = r2.status === 200 && list2.some((x) => x.id === wageHistB);
      cases.push({
        case: "2. Tenant A admin reads Tenant B's worker's wage history via ?workerId=",
        disposition: leaked ? "FAIL" : "PASS",
        detail: leaked
          ? `VERIFIED DEFECT: storage.getWageHistory(workerId) (server/storage.ts:2076-2081) is an id-only lookup with no companyId filter or comparison — the route (server/routes.ts:18962-18976) only self-scopes non-manager tenant users, never validates a manager/admin-supplied workerId against their own company. status=${r2.status}, returned Tenant B wage data to a Tenant A admin.`
          : `status=${r2.status} entries=${list2.length}`,
      });

      const r3 = await apiRequest(baseUrl, "GET", `/api/wage-history?workerId=${nonexistentId}`, sessionAAdmin);
      const list3 = Array.isArray(r3.body) ? r3.body : [];
      cases.push({
        case: "3. Nonexistent worker id — no data returned",
        disposition: r3.status === 200 && Array.isArray(r3.body) && list3.length === 0 ? "PASS" : "FAIL",
        detail: `status=${r3.status} entries=${list3.length}`,
      });

      const rEmp = await apiRequest(baseUrl, "GET", `/api/wage-history?workerId=${workerAOther}`, sessionAEmployee);
      const listEmp = Array.isArray(rEmp.body) ? (rEmp.body as Array<{ id?: string }>) : [];
      const employeeGotOwnDataOnly = listEmp.every((x) => x.id !== wageHistA);
      cases.push({
        case: "4. Same-tenant employee's ?workerId= query param is correctly overridden to their own worker id (server/routes.ts:18966-18969) — cannot view a coworker's wage history even within the same tenant",
        disposition: rEmp.status === 200 && employeeGotOwnDataOnly ? "PASS" : "FAIL",
        detail: `status=${rEmp.status} entries=${listEmp.length} gotCoworkerData=${!employeeGotOwnDataOnly}`,
      });

      const r6 = await apiRequest(baseUrl, "GET", `/api/wage-history?workerId=${workerAOther}`, null);
      cases.push({ case: "5. Missing authentication", disposition: r6.status === 401 ? "PASS" : "FAIL", detail: `status=${r6.status}` });

      record("GET /api/wage-history", "server/routes.ts:18962", cases);
    }

    // ══════════════════════ 7. DELETE /api/payroll-payment-methods/:id ══════════════════════
    {
      const cases: CaseResult[] = [];
      const beforeB = (await pool.query(`SELECT id FROM payroll_payment_methods WHERE id = $1`, [paymentMethodB])).rows[0];
      const r1 = await apiRequest(baseUrl, "DELETE", `/api/payroll-payment-methods/${paymentMethodB}`, sessionAAdmin);
      const afterB = (await pool.query(`SELECT id FROM payroll_payment_methods WHERE id = $1`, [paymentMethodB])).rows[0];
      cases.push({
        case: "1. Tenant A admin deletes Tenant B's payroll payment method by ID",
        disposition: !!afterB ? "PASS" : "FAIL",
        detail: !!afterB
          ? `status=${r1.status} rowStillExists=true`
          : `VERIFIED DEFECT: no company-ownership check exists in this handler (server/routes.ts:22605-22610) — storage.deletePayrollPaymentMethod(id) deletes any id with no comparison to the acting user's company. status=${r1.status}, row no longer exists (was present before this request: ${!!beforeB}).`,
      });

      const r2 = await apiRequest(baseUrl, "DELETE", `/api/payroll-payment-methods/${nonexistentId}`, sessionAAdmin);
      cases.push({
        case: "2. Nonexistent payroll payment method id — storage.deletePayrollPaymentMethod has no existence check, so this always reports success rather than 404; informational, not a leak",
        disposition: r2.status === 200 ? "PASS" : "FAIL",
        detail: `status=${r2.status}`,
      });

      const rEmp = await apiRequest(baseUrl, "DELETE", `/api/payroll-payment-methods/${paymentMethodADelete}`, sessionAEmployee);
      cases.push({ case: "3. Unauthorized same-tenant role (employee) — requireRole(\"admin\") excludes both employee and manager", disposition: rEmp.status === 403 ? "PASS" : "FAIL", detail: `status=${rEmp.status}` });

      const r6 = await apiRequest(baseUrl, "DELETE", `/api/payroll-payment-methods/${paymentMethodADelete}`, null);
      cases.push({ case: "4. Missing authentication", disposition: r6.status === 401 ? "PASS" : "FAIL", detail: `status=${r6.status}` });

      const r4 = await apiRequest(baseUrl, "DELETE", `/api/payroll-payment-methods/${paymentMethodADelete}`, sessionAAdmin);
      cases.push({ case: "5. Tenant A admin deletes Tenant A's own payroll payment method", disposition: r4.status === 200 ? "PASS" : "FAIL", detail: `status=${r4.status}` });

      record("DELETE /api/payroll-payment-methods/:id", "server/routes.ts:22605", cases);
    }

    // ══════════════════════ 8. GET /api/payroll-summary (confirm guard holds) ══════════════════════
    {
      const cases: CaseResult[] = [];
      const r1 = await apiRequest(baseUrl, "GET", `/api/payroll-summary?year=${year}`, sessionAAdmin);
      const b1 = r1.body as { grandTotal?: { grossPay?: number }; runCount?: number } | undefined;
      cases.push({
        case: "1. Tenant A admin reads their own payroll summary",
        disposition: r1.status === 200 && b1?.runCount === 1 && Math.round(b1?.grandTotal?.grossPay ?? 0) === 3000 ? "PASS" : "FAIL",
        detail: `status=${r1.status} runCount=${b1?.runCount} grossPay=${b1?.grandTotal?.grossPay}`,
      });

      const r2 = await apiRequest(baseUrl, "GET", `/api/payroll-summary?year=${year}&companyId=${companyB}`, sessionAAdmin);
      const b2 = r2.body as { grandTotal?: { grossPay?: number }; runCount?: number } | undefined;
      const leakedB = Math.round(b2?.grandTotal?.grossPay ?? 0) === 9000;
      cases.push({
        case: "2. Tenant A admin explicitly requests ?companyId=<Tenant B> — confirms the isTenantSummaryUser override (server/routes.ts:1914-1917) actually holds under a live attempt, not just from reading the source",
        disposition: r2.status === 200 && !leakedB && Math.round(b2?.grandTotal?.grossPay ?? 0) === 3000 ? "PASS" : leakedB ? "FAIL" : "INCONCLUSIVE",
        detail: leakedB
          ? `VERIFIED DEFECT: the ?companyId= query param overrode the tenant scope. status=${r2.status}, grossPay=${b2?.grandTotal?.grossPay} matches Tenant B's fixture value.`
          : `status=${r2.status} runCount=${b2?.runCount} grossPay=${b2?.grandTotal?.grossPay} (still scoped to Tenant A despite the injection attempt)`,
      });

      const rEmp = await apiRequest(baseUrl, "GET", `/api/payroll-summary?year=${year}`, sessionAEmployee);
      cases.push({ case: "3. Unauthorized same-tenant role (employee)", disposition: rEmp.status === 403 ? "PASS" : "FAIL", detail: `status=${rEmp.status}` });

      const r6 = await apiRequest(baseUrl, "GET", `/api/payroll-summary?year=${year}`, null);
      cases.push({ case: "4. Missing authentication", disposition: r6.status === 401 ? "PASS" : "FAIL", detail: `status=${r6.status}` });

      record("GET /api/payroll-summary", "server/routes.ts:1907", cases);
    }

    // ── Write the machine-readable manifest ───────────────────────────────────
    const summary: Record<Disposition, number> = { PASS: 0, FAIL: 0, INCONCLUSIVE: 0, "EXPECTED GLOBAL": 0, "N/A": 0 };
    console.log("=== Cross-tenant batch-3 route test matrix ===\n");
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
      console.error(`\n${summary.FAIL} verified authorization gap(s) found — see ${MANIFEST_PATH} and docs/saas-readiness/phase-0.5-batch-3-cross-tenant-findings.md. Not fixed in this branch (test-first/audit-first phase).`);
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
