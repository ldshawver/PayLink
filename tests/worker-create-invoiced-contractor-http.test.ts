/**
 * HTTP-level integration test for POST /api/workers, using the exact
 * invoiced-contractor payload that was rejected on staging during PR #78
 * validation ("Pay rate is required" for a genuine Invoiced Contractor
 * (1099) selection with Pay Rate left blank — traced to a missing
 * client-side mirror of the server's rule, not a client/server enum
 * mismatch; see PR #79, shared/worker-pay-rate-rules.ts).
 *
 * Unlike tests/worker-pay-rate-validation.test.ts (the pure function in
 * isolation) and tests/worker-create-payrate-null-db.test.ts (raw SQL
 * against the DB constraint directly), this exercises the REAL
 * POST /api/workers Express route end-to-end: real session auth, the real
 * shared/worker-pay-rate-rules.ts normalization as actually wired into
 * server/routes.ts, real storage.createWorker(), a really-persisted row.
 *
 * SAFETY: this test does NOT start a server itself. Booting the full app
 * (seeding, the worker orchestrator, a ~20-connection pool) is kept a
 * deliberate, headroom-monitored operation done separately, never
 * something a routine test run triggers automatically. It requires:
 *   - TEST_SERVER_URL: base URL of an already-running server (e.g.
 *     http://127.0.0.1:8098) that is itself configured with its own
 *     DATABASE_URL pointing at a disposable database.
 *   - TEST_DATABASE_URL: that same disposable database, for authoritative
 *     row-level verification (contractor_type/pay_rate) and cleanup — must
 *     be the exact DB the server above is using.
 *   - TEST_ADMIN_USERNAME / TEST_ADMIN_PASSWORD: an admin login on that
 *     disposable instance (e.g. seeded via its own ADMIN_PASSWORD env var).
 * If TEST_SERVER_URL or TEST_DATABASE_URL is not set, this file reports
 * the HTTP integration test was skipped and exits 0 without making any
 * request or DB connection. Refuses to run if TEST_DATABASE_URL looks like
 * staging/production, or matches this process's own DATABASE_URL.
 *
 * Every fixture (company, worker) created is deleted and cleanup is
 * verified by re-querying the exact IDs afterward.
 *
 * Run (after separately starting a disposable-DB-backed server):
 *   TEST_SERVER_URL=http://127.0.0.1:8098 \
 *   TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable_db \
 *   TEST_ADMIN_USERNAME=admin TEST_ADMIN_PASSWORD=... \
 *   npx tsx tests/worker-create-invoiced-contractor-http.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";

const FORBIDDEN_PATTERNS = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];

let pass = 0;
let fail = 0;
function ok(name: string, result: boolean, detail?: string) {
  if (result) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const serverUrl = process.env.TEST_SERVER_URL;
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!serverUrl || !testDatabaseUrl) {
    console.log("TEST_SERVER_URL / TEST_DATABASE_URL not set — skipping POST /api/workers HTTP integration test (0 run).");
    return;
  }
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(testDatabaseUrl) || pattern.test(serverUrl)) {
      throw new Error("TEST_SERVER_URL/TEST_DATABASE_URL looks like it points at staging/production. Refusing to run.");
    }
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is identical to DATABASE_URL. Refusing to run against what may be the app's real database.");
  }

  const pool = new Pool({ connectionString: testDatabaseUrl, max: 2 });
  const companyIds: string[] = [];
  const workerIds: string[] = [];

  try {
    const dbNameRes = await pool.query("SELECT current_database() AS name");
    const dbName = dbNameRes.rows[0]?.name as string;
    if (FORBIDDEN_PATTERNS.some((p) => p.test(dbName))) {
      throw new Error(`current_database() = "${dbName}" looks like staging/production. Refusing to run.`);
    }

    const adminUsername = process.env.TEST_ADMIN_USERNAME ?? "admin";
    const adminPassword = process.env.TEST_ADMIN_PASSWORD;
    if (!adminPassword) {
      throw new Error("TEST_ADMIN_PASSWORD is required when TEST_SERVER_URL is set.");
    }

    const loginRes = await fetch(`${serverUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: adminUsername, password: adminPassword }),
    });
    const setCookie = loginRes.headers.get("set-cookie");
    ok("admin login succeeds against the disposable-DB-backed server", loginRes.ok && !!setCookie, `status=${loginRes.status}`);
    const cookieMatch = setCookie?.match(/connect\.sid=[^;]+/);
    const cookie = cookieMatch ? cookieMatch[0] : undefined;
    if (!cookie) throw new Error("No session cookie returned from login — cannot continue.");

    const suffix = crypto.randomBytes(4).toString("hex");
    const companyRes = await fetch(`${serverUrl}/api/companies`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: `HttpIntegrationTestCo ${suffix}`, industry: "Other", size: "1-10" }),
    });
    const company = await companyRes.json();
    ok("test company created", companyRes.status === 201 && !!company?.id, `status=${companyRes.status}`);
    if (company?.id) companyIds.push(company.id);

    async function postWorker(body: Record<string, unknown>) {
      const res = await fetch(`${serverUrl}/api/workers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      return { status: res.status, body: json };
    }

    console.log("\nPOST /api/workers — the exact invoiced-contractor payload that failed on staging");
    {
      // Mirrors client/src/pages/employee.tsx's AddWorkerDialog submission
      // for "Invoiced Contractor (1099)" with Pay Rate left blank, after
      // cleanFormData() turns the blank string into an explicit null.
      const { status, body } = await postWorker({
        firstName: "HTTPTEST", lastName: `Contractor-${suffix}`, companyId: company.id,
        workerType: "contractor", contractorType: "invoice", workerGroup: "invoiced_contractor",
        payRate: null, payType: "hourly", status: "active", country: "US",
      });
      ok("returns 201", status === 201, `status=${status}, body=${JSON.stringify(body)}`);
      ok("returns a real UUID", typeof body?.id === "string" && body.id.length > 0, JSON.stringify(body?.id));
      ok("response payRate is normalized to '0'", body?.payRate === "0", `payRate=${body?.payRate}`);
      ok("response contractorType is 'invoice'", body?.contractorType === "invoice", `contractorType=${body?.contractorType}`);
      if (body?.id) workerIds.push(body.id);

      // Authoritative check: query the row directly, not just trust the
      // HTTP response body.
      const dbRow = await pool.query(
        "SELECT contractor_type, pay_rate FROM workers WHERE id = $1",
        [body?.id],
      );
      ok(
        "persisted row has contractor_type='invoice' and pay_rate='0'",
        dbRow.rows[0]?.contractor_type === "invoice" && dbRow.rows[0]?.pay_rate === "0",
        JSON.stringify(dbRow.rows[0]),
      );
    }

    console.log("\nPOST /api/workers — rejected cases create no row");
    {
      const { status, body } = await postWorker({
        firstName: "HTTPTEST", lastName: `Malformed-${suffix}`, companyId: company.id,
        workerType: "contractor", contractorType: "invoice", payRate: "not-a-number",
      });
      ok("malformed nonblank pay rate for an invoiced contractor is rejected (400)", status === 400, `status=${status}, body=${JSON.stringify(body)}`);
    }
    {
      const { status, body } = await postWorker({
        firstName: "HTTPTEST", lastName: `HourlyBlank-${suffix}`, companyId: company.id,
        workerType: "employee", payRate: null,
      });
      ok("blank pay rate for an hourly/salaried employee is rejected (400)", status === 400, `status=${status}, body=${JSON.stringify(body)}`);
    }
    {
      const { status, body } = await postWorker({
        firstName: "HTTPTEST", lastName: `BadWorkerType-${suffix}`, companyId: company.id,
        workerType: "manager", payRate: "20",
      });
      ok("invalid worker_type is rejected server-side (400)", status === 400, `status=${status}, body=${JSON.stringify(body)}`);
    }
    {
      const { status, body } = await postWorker({
        firstName: "HTTPTEST", lastName: `BadContractorType-${suffix}`, companyId: company.id,
        workerType: "contractor", contractorType: "salaried", payRate: "20",
      });
      ok("invalid contractor_type is rejected server-side (400)", status === 400, `status=${status}, body=${JSON.stringify(body)}`);
    }

    const countRes = await pool.query(
      "SELECT count(*)::int AS n FROM workers WHERE company_id = $1",
      [company.id],
    );
    ok("exactly one worker exists for this company (the 4 rejections created none)", countRes.rows[0]?.n === 1, `n=${countRes.rows[0]?.n}`);

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exitCode = 1;
  } finally {
    for (const id of workerIds) {
      await pool.query("DELETE FROM workers WHERE id = $1", [id]);
    }
    for (const id of companyIds) {
      await pool.query("DELETE FROM document_retention_policies WHERE company_id = $1", [id]).catch(() => {});
      await pool.query("DELETE FROM companies WHERE id = $1", [id]);
    }
    const leftoverWorkers = workerIds.length
      ? await pool.query("SELECT id FROM workers WHERE id = ANY($1::text[])", [workerIds])
      : { rows: [] };
    const leftoverCompanies = companyIds.length
      ? await pool.query("SELECT id FROM companies WHERE id = ANY($1::text[])", [companyIds])
      : { rows: [] };
    if (leftoverWorkers.rows.length > 0 || leftoverCompanies.rows.length > 0) {
      throw new Error(
        `Cleanup verification failed: ${leftoverWorkers.rows.length} leftover worker(s), ${leftoverCompanies.rows.length} leftover compan(y/ies)`,
      );
    }
    console.log("Cleanup verified: zero residual fixture rows.");
    await pool.end();
  }
}

main().catch((e) => {
  console.error("Test run failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
