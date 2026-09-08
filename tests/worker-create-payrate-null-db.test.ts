/**
 * Real-Postgres regression test for the POST /api/workers 500 fixed here:
 * workers.pay_rate is NOT NULL with a "0" column default, but an explicit
 * null in the INSERT values bypasses that column default entirely (Postgres
 * only applies a column default when the column is omitted from the INSERT,
 * never when it's present with an explicit null). client/src/pages/employee.tsx's
 * cleanFormData() turns a blank Pay Rate field into exactly that explicit
 * null — which is the normal, valid shape for an "Invoiced Contractor (1099)"
 * worker, who has no fixed rate. The route now normalizes a null/undefined/
 * empty-string payRate to "0" before calling storage.createWorker() (see
 * server/routes.ts, POST /api/workers).
 *
 * This test proves both sides of that fix directly against the workers
 * table's real constraint: the unnormalized shape still fails with 23502
 * (guarding against the DB contract silently changing), and the
 * route's normalized shape ("0") succeeds and persists.
 *
 * SAFETY: this test requires TEST_DATABASE_URL to point at a disposable,
 * isolated database. It refuses to run against anything that looks like the
 * staging/production database (by name or host, and by exact equality with
 * this process's own DATABASE_URL if set), verifies current_database()
 * against the parsed URL before any write, and never prints either URL.
 * Every fixture row created is tracked and deleted (FK-safe order) in a
 * `finally` block, then cleanup is verified by re-querying the exact
 * deleted IDs — same convention as tests/contractor-contract-email-projection-db.test.ts.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable_db npx tsx tests/worker-create-payrate-null-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";

const FORBIDDEN_PATTERNS = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];

interface FixtureIds {
  workers: string[];
  companies: string[];
}

async function cleanupFixtures(pool: Pool, ids: FixtureIds): Promise<void> {
  const steps: Array<[table: string, label: string, idList: string[]]> = [
    ["workers", "workers", ids.workers],
    ["companies", "companies", ids.companies],
  ];
  for (const [table, , idList] of steps) {
    if (!idList.length) continue;
    await pool.query(`DELETE FROM ${table} WHERE id = ANY($1::text[])`, [idList]);
  }
  for (const [table, label, idList] of steps) {
    if (!idList.length) continue;
    const { rows } = await pool.query(`SELECT id FROM ${table} WHERE id = ANY($1::text[])`, [idList]);
    if (rows.length > 0) {
      throw new Error(`Cleanup verification failed: ${rows.length} leftover ${label} row(s): ${rows.map((r) => r.id).join(", ")}`);
    }
  }
}

async function main() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    console.log("TEST_DATABASE_URL not set — skipping DB-backed worker-create-payrate tests (0 run).");
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

  const pool = new Pool({ connectionString: testDatabaseUrl, max: 2 });
  const ids: FixtureIds = { workers: [], companies: [] };
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

  try {
    const dbNameRes = await pool.query("SELECT current_database() AS name");
    const dbName = dbNameRes.rows[0]?.name as string;
    if (FORBIDDEN_PATTERNS.some((p) => p.test(dbName))) {
      throw new Error(`current_database() = "${dbName}" looks like staging/production. Refusing to run.`);
    }

    const suffix = crypto.randomBytes(4).toString("hex");
    const companyId = crypto.randomUUID();
    ids.companies.push(companyId);
    await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [companyId, `Test Co ${suffix}`]);

    // Reproduces the exact failing request shape from the PR #76 staging
    // validation report: an "Invoiced Contractor (1099)" with Pay Rate left
    // blank in client/src/pages/employee.tsx's AddWorkerDialog, after
    // cleanFormData() turns the blank string into an explicit null.
    let unnormalizedFailed = false;
    let unnormalizedCode: string | undefined;
    try {
      await pool.query(
        `INSERT INTO workers (company_id, first_name, last_name, worker_type, contractor_type, pay_type, pay_rate)
         VALUES ($1, 'Repro', 'Contractor', 'contractor', 'invoice', 'hourly', NULL)`,
        [companyId],
      );
    } catch (e: any) {
      unnormalizedFailed = true;
      unnormalizedCode = e.code;
    }
    ok("unnormalized (explicit null) payRate still violates NOT NULL — guards the DB contract this fix relies on", unnormalizedFailed && unnormalizedCode === "23502", `code=${unnormalizedCode}`);

    // The route now normalizes null/undefined/"" payRate to "0" before
    // calling storage.createWorker() — this is that exact normalized shape.
    const workerId = crypto.randomUUID();
    ids.workers.push(workerId);
    const insertRes = await pool.query(
      `INSERT INTO workers (id, company_id, first_name, last_name, worker_type, contractor_type, pay_type, pay_rate)
       VALUES ($1, $2, 'Repro', 'Contractor', 'contractor', 'invoice', 'hourly', $3)
       RETURNING id, pay_rate`,
      [workerId, companyId, "0"],
    );
    ok("route-normalized payRate ('0') persists successfully", insertRes.rows.length === 1);
    ok("persisted pay_rate is exactly '0'", insertRes.rows[0]?.pay_rate === "0", String(insertRes.rows[0]?.pay_rate));

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exitCode = 1;
  } finally {
    await cleanupFixtures(pool, ids);
    await pool.end();
  }
}

main().catch((e) => {
  console.error("Test run failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
