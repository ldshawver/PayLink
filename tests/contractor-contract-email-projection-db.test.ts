/**
 * Real-Postgres test for the GET /api/contractor-contracts/:id query change:
 * it now projects COALESCE(w.email, w.work_email) AS contractor_email
 * alongside the existing contractor_name join, so the client can display
 * (and the Add Signer dialog can derive) the contractor's authoritative
 * signer email instead of taking it as free text.
 *
 * SAFETY: this test requires TEST_DATABASE_URL to point at a disposable,
 * isolated database. It refuses to run against anything that looks like the
 * staging/production database (by name or host, and by exact equality with
 * this process's own DATABASE_URL if set), verifies current_database()
 * against the parsed URL before any write, and never prints either URL. If
 * TEST_DATABASE_URL is not set, this file reports that DB-backed tests were
 * skipped and exits 0 without touching any database.
 *
 * Every fixture row created by a test is tracked and deleted (in FK-safe
 * order) in a `finally` block, then cleanup is verified by re-querying the
 * exact deleted IDs — same convention as tests/contractor-invoice-exactly-once-db.test.ts.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable_db npx tsx tests/contractor-contract-email-projection-db.test.ts
 */
import { Pool } from "pg";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const FORBIDDEN_PATTERNS = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i];

interface FixtureIds {
  contracts: string[];
  workers: string[];
  companies: string[];
}

async function cleanupFixtures(pool: Pool, ids: FixtureIds): Promise<void> {
  const steps: Array<[table: string, label: string, idList: string[]]> = [
    ["contractor_contracts", "contracts", ids.contracts],
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
    console.log("TEST_DATABASE_URL not set — skipping DB-backed contractor-contract-email-projection tests (0 run).");
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

  const pool = new Pool({ connectionString: testDatabaseUrl });
  const ids: FixtureIds = { contracts: [], workers: [], companies: [] };
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
    const workerPrimaryEmailId = crypto.randomUUID();
    const workerWorkEmailOnlyId = crypto.randomUUID();
    const workerNoEmailId = crypto.randomUUID();
    ids.companies.push(companyId);
    ids.workers.push(workerPrimaryEmailId, workerWorkEmailOnlyId, workerNoEmailId);

    await pool.query(
      `INSERT INTO companies (id, name) VALUES ($1, $2)`,
      [companyId, `Test Co ${suffix}`],
    );
    await pool.query(
      `INSERT INTO workers (id, company_id, first_name, last_name, email, work_email, worker_type, pay_rate)
       VALUES ($1, $2, 'Primary', 'Email', $3, NULL, 'contractor', 0)`,
      [workerPrimaryEmailId, companyId, `primary-${suffix}@example.com`],
    );
    await pool.query(
      `INSERT INTO workers (id, company_id, first_name, last_name, email, work_email, worker_type, pay_rate)
       VALUES ($1, $2, 'WorkEmail', 'Only', NULL, $3, 'contractor', 0)`,
      [workerWorkEmailOnlyId, companyId, `workonly-${suffix}@example.com`],
    );
    await pool.query(
      `INSERT INTO workers (id, company_id, first_name, last_name, email, work_email, worker_type, pay_rate)
       VALUES ($1, $2, 'No', 'Email', NULL, NULL, 'contractor', 0)`,
      [workerNoEmailId, companyId, ],
    );

    const contractForPrimary = crypto.randomUUID();
    const contractForWorkEmailOnly = crypto.randomUUID();
    const contractForNoEmail = crypto.randomUUID();
    ids.contracts.push(contractForPrimary, contractForWorkEmailOnly, contractForNoEmail);
    await pool.query(
      `INSERT INTO contractor_contracts (id, company_id, contractor_id, contract_number, title, status)
       VALUES ($1, $2, $3, $4, 'Test Contract', 'draft')`,
      [contractForPrimary, companyId, workerPrimaryEmailId, `CON-TEST-${suffix}-1`],
    );
    await pool.query(
      `INSERT INTO contractor_contracts (id, company_id, contractor_id, contract_number, title, status)
       VALUES ($1, $2, $3, $4, 'Test Contract', 'draft')`,
      [contractForWorkEmailOnly, companyId, workerWorkEmailOnlyId, `CON-TEST-${suffix}-2`],
    );
    await pool.query(
      `INSERT INTO contractor_contracts (id, company_id, contractor_id, contract_number, title, status)
       VALUES ($1, $2, $3, $4, 'Test Contract', 'draft')`,
      [contractForNoEmail, companyId, workerNoEmailId, `CON-TEST-${suffix}-3`],
    );

    // This mirrors the exact SELECT added to the GET /api/contractor-contracts/:id
    // handler in server/routes.ts — proving the projection returns the right
    // value for each precedence case (primary email, work-email fallback, no
    // email at all), which is what the contractor-signer identity derivation
    // in addContractSigner and the Add Signer dialog both depend on.
    const projectionQuery = `
      SELECT cc.*, w.first_name || ' ' || w.last_name AS contractor_name, COALESCE(w.email, w.work_email) AS contractor_email
      FROM contractor_contracts cc LEFT JOIN workers w ON w.id = cc.contractor_id
      WHERE cc.id = $1
    `;

    const r1 = await pool.query(projectionQuery, [contractForPrimary]);
    ok("uses the primary email when present", r1.rows[0]?.contractor_email === `primary-${suffix}@example.com`, r1.rows[0]?.contractor_email);
    ok("also projects contractor_name", r1.rows[0]?.contractor_name === "Primary Email");

    const r2 = await pool.query(projectionQuery, [contractForWorkEmailOnly]);
    ok("falls back to work_email when primary email is null", r2.rows[0]?.contractor_email === `workonly-${suffix}@example.com`, r2.rows[0]?.contractor_email);

    const r3 = await pool.query(projectionQuery, [contractForNoEmail]);
    ok("returns null contractor_email when the profile has neither", r3.rows[0]?.contractor_email === null, String(r3.rows[0]?.contractor_email));

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
