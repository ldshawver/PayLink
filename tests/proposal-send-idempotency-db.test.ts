/**
 * Real-Postgres test for the duplicate-send guard added to
 * POST /api/contractor-proposals/:id/send: the pre-send -> 'sent' status
 * transition is now a conditional UPDATE (`WHERE status = ANY(pre-send
 * statuses)`), so a second call — a double-click, a retried request, a
 * second browser tab racing the first — cannot re-flip the status and
 * therefore cannot re-email the client or write a duplicate audit event.
 *
 * This mirrors the exact SQL shape used in server/routes.ts's /send handler
 * (routes.ts handlers aren't exported/importable, so DB-level behavioral
 * proof of the SQL itself is the strongest test available without standing
 * up the whole Express app — see tests/contractor-proposal-identity.test.ts
 * for the parts of this fix that ARE extracted into testable functions).
 *
 * SAFETY: this test requires TEST_DATABASE_URL to point at a disposable,
 * isolated database. It refuses to run against anything that looks like the
 * staging/production database (by name or host, and by exact equality with
 * this process's own DATABASE_URL if set), verifies current_database()
 * against the parsed URL before any write, and never prints either URL. If
 * TEST_DATABASE_URL is not set, this file reports that DB-backed tests were
 * skipped and exits 0 without touching any database.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable_db npx tsx tests/proposal-send-idempotency-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";

const FORBIDDEN_PATTERNS = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i];
const PRE_SEND_STATUSES = ["draft", "internal_review", "submitted"];

interface FixtureIds {
  proposals: string[];
  workers: string[];
  companies: string[];
}

async function cleanupFixtures(pool: Pool, ids: FixtureIds): Promise<void> {
  const steps: Array<[table: string, label: string, idList: string[]]> = [
    ["contractor_proposals", "proposals", ids.proposals],
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

async function attemptSendTransition(pool: Pool, proposalId: string): Promise<{ rowCount: number; status: string }> {
  const shareToken = crypto.randomBytes(32).toString("hex");
  const result = await pool.query(
    `UPDATE contractor_proposals SET status = 'sent', sent_at = NOW(), updated_at = NOW(), share_token = $2
     WHERE id = $1 AND status = ANY($3::text[])`,
    [proposalId, shareToken, PRE_SEND_STATUSES],
  );
  const after = await pool.query(`SELECT status FROM contractor_proposals WHERE id = $1`, [proposalId]);
  return { rowCount: result.rowCount ?? 0, status: after.rows[0]?.status };
}

async function main() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    console.log("TEST_DATABASE_URL not set — skipping DB-backed proposal-send-idempotency tests (0 run).");
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
  const ids: FixtureIds = { proposals: [], workers: [], companies: [] };
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
    const workerId = crypto.randomUUID();
    ids.companies.push(companyId);
    ids.workers.push(workerId);
    await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [companyId, `Test Co ${suffix}`]);
    await pool.query(
      `INSERT INTO workers (id, company_id, first_name, last_name, worker_type, pay_rate) VALUES ($1, $2, 'Test', 'Contractor', 'contractor', 0)`,
      [workerId, companyId],
    );

    // Scenario 1: a fresh draft proposal — the first /send call must
    // actually transition it and win the race.
    const draftProposalId = crypto.randomUUID();
    ids.proposals.push(draftProposalId);
    await pool.query(
      `INSERT INTO contractor_proposals (id, company_id, contractor_id, proposal_number, issue_date, status) VALUES ($1, $2, $3, $4, CURRENT_DATE, 'draft')`,
      [draftProposalId, companyId, workerId, `CP-TEST-${suffix}-1`],
    );
    const firstAttempt = await attemptSendTransition(pool, draftProposalId);
    ok("first send transitions a draft proposal to sent (rowCount=1)", firstAttempt.rowCount === 1, JSON.stringify(firstAttempt));
    ok("status is now sent", firstAttempt.status === "sent", firstAttempt.status);

    // Scenario 2: immediately calling the same transition again (simulating
    // a double-click or a race) must be a no-op — this is the actual
    // duplicate-send fix.
    const secondAttempt = await attemptSendTransition(pool, draftProposalId);
    ok("second send on an already-sent proposal is a no-op (rowCount=0)", secondAttempt.rowCount === 0, JSON.stringify(secondAttempt));
    ok("status remains sent, not re-touched", secondAttempt.status === "sent", secondAttempt.status);

    // Scenario 3: a proposal already further along the lifecycle (e.g.
    // accepted) must also refuse to be re-sent through this transition.
    const acceptedProposalId = crypto.randomUUID();
    ids.proposals.push(acceptedProposalId);
    await pool.query(
      `INSERT INTO contractor_proposals (id, company_id, contractor_id, proposal_number, issue_date, status) VALUES ($1, $2, $3, $4, CURRENT_DATE, 'accepted')`,
      [acceptedProposalId, companyId, workerId, `CP-TEST-${suffix}-2`],
    );
    const acceptedAttempt = await attemptSendTransition(pool, acceptedProposalId);
    ok("send on an accepted proposal is refused (rowCount=0)", acceptedAttempt.rowCount === 0, JSON.stringify(acceptedAttempt));
    ok("accepted status is untouched", acceptedAttempt.status === "accepted", acceptedAttempt.status);

    // Scenario 4: each of the legitimate pre-send statuses must still work.
    for (const preSendStatus of PRE_SEND_STATUSES) {
      const id = crypto.randomUUID();
      ids.proposals.push(id);
      await pool.query(
        `INSERT INTO contractor_proposals (id, company_id, contractor_id, proposal_number, issue_date, status) VALUES ($1, $2, $3, $4, CURRENT_DATE, $5)`,
        [id, companyId, workerId, `CP-TEST-${suffix}-${preSendStatus}`, preSendStatus],
      );
      const attempt = await attemptSendTransition(pool, id);
      ok(`send transitions a '${preSendStatus}' proposal (rowCount=1)`, attempt.rowCount === 1, JSON.stringify(attempt));
    }

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
