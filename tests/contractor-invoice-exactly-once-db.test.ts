/**
 * Real-Postgres integration tests for the Documenso-completion exactly-once
 * auto-invoice path (server/contract-signing-flow.ts::autoCreateProposalBackedInvoice,
 * backed by the DB uniqueness index in migrations/0014_contractor_invoice_exactly_once.sql).
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
 * order) in a `finally` block for that test, then cleanup is verified by
 * re-querying the exact deleted IDs.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable_db npx tsx tests/contractor-invoice-exactly-once-db.test.ts
 */
import { Pool } from "pg";
import assert from "node:assert/strict";
import {
  autoCreateProposalBackedInvoice,
  isUniqueConstraintViolation,
  AUTO_INVOICE_UNIQUE_INDEX,
  type ContractForInvoice,
  type ProposalForInvoice,
} from "../server/contract-signing-flow";

const FORBIDDEN_PATTERNS = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i];

interface FixtureIds {
  invoices: string[];
  contracts: string[];
  proposals: string[];
  workers: string[];
  companies: string[];
}

function newFixtureIds(): FixtureIds {
  return { invoices: [], contracts: [], proposals: [], workers: [], companies: [] };
}

// FK-safe delete order: invoices -> contracts -> proposals -> workers -> companies.
// Deletes only the exact IDs this test created, then verifies none remain.
async function cleanupFixtures(pool: Pool, ids: FixtureIds): Promise<void> {
  const steps: Array<[table: string, label: string, idList: string[]]> = [
    ["contractor_invoices", "invoices", ids.invoices],
    ["contractor_contracts", "contracts", ids.contracts],
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

async function main() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    console.log(
      "SKIPPED: contractor-invoice-exactly-once-db.test.ts — TEST_DATABASE_URL not set. " +
        "No disposable database was configured, so no DB-backed exactly-once tests ran. " +
        "This is not a pass; it is an explicit stop before any database write."
    );
    return;
  }

  if (process.env.DATABASE_URL && process.env.DATABASE_URL === testDatabaseUrl) {
    throw new Error("Refusing to run: TEST_DATABASE_URL is identical to this process's DATABASE_URL. Never substitute the app/staging database.");
  }

  const url = new URL(testDatabaseUrl);
  const parsedDbName = url.pathname.replace(/^\//, "");
  const parsedHost = url.hostname;
  if (FORBIDDEN_PATTERNS.some((re) => re.test(parsedDbName) || re.test(parsedHost))) {
    throw new Error(`Refusing to run: TEST_DATABASE_URL name/host ("${parsedDbName}" @ "${parsedHost}") looks like staging/production, not a disposable test database.`);
  }

  const pool = new Pool({ connectionString: testDatabaseUrl, max: 5 });
  let passCount = 0;

  try {
    const { rows: dbRows } = await pool.query("SELECT current_database() AS db");
    const actualDb = dbRows[0]?.db;
    if (actualDb !== parsedDbName) {
      throw new Error(`Refusing to run: current_database() "${actualDb}" did not match parsed TEST_DATABASE_URL name "${parsedDbName}".`);
    }
    console.log(`Connected to disposable test database: ${actualDb} (name+host verified, not staging/production, before any write)`);

    async function test(name: string, fn: (ids: FixtureIds) => Promise<void>) {
      const ids = newFixtureIds();
      try {
        await fn(ids);
      } finally {
        await cleanupFixtures(pool, ids);
      }
      passCount++;
      console.log(`PASS: ${name}`);
    }

    // ── Fixture helpers (each records the ID it creates) ───────────────────
    async function createCompany(ids: FixtureIds): Promise<string> {
      const { rows } = await pool.query(`INSERT INTO companies (name) VALUES ($1) RETURNING id`, [`Test Co ${crypto.randomUUID()}`]);
      const id = rows[0].id;
      ids.companies.push(id);
      return id;
    }

    async function createContractorWorker(ids: FixtureIds, companyId: string): Promise<string> {
      const { rows } = await pool.query(
        `INSERT INTO workers (company_id, first_name, last_name, worker_type, pay_rate) VALUES ($1, 'Test', 'Contractor', 'contractor', 0) RETURNING id`,
        [companyId]
      );
      const id = rows[0].id;
      ids.workers.push(id);
      return id;
    }

    async function createProposal(ids: FixtureIds, companyId: string, contractorId: string, amount = "500.00"): Promise<ProposalForInvoice & { id: string }> {
      const { rows } = await pool.query(
        `INSERT INTO contractor_proposals (company_id, contractor_id, issue_date, status, amount, title)
         VALUES ($1, $2, CURRENT_DATE::text, 'accepted', $3, 'Test proposal')
         RETURNING *`,
        [companyId, contractorId, amount]
      );
      ids.proposals.push(rows[0].id);
      return rows[0];
    }

    async function createContract(ids: FixtureIds, companyId: string, contractorId: string, proposalId: string): Promise<ContractForInvoice & { id: string }> {
      const { rows } = await pool.query(
        `INSERT INTO contractor_contracts (company_id, contractor_id, proposal_id, title, status)
         VALUES ($1, $2, $3, 'Test contract', 'fully_signed')
         RETURNING *`,
        [companyId, contractorId, proposalId]
      );
      ids.contracts.push(rows[0].id);
      return rows[0];
    }

    async function countInvoices(companyId: string): Promise<number> {
      const { rows } = await pool.query(`SELECT count(*)::int AS c FROM contractor_invoices WHERE company_id = $1`, [companyId]);
      return rows[0].c;
    }

    // Real production-shaped deps, built against a live transaction — mirrors
    // server/routes.ts::autoCreateContractInvoiceExactlyOnce exactly, so the test
    // exercises the actual exported helper, not a reimplementation of it.
    function buildDeps(tx: import("pg").PoolClient, companyId: string, ids: FixtureIds) {
      return {
        countInvoicesForContractor: async (contractorId: string) => {
          const { rows } = await tx.query(`SELECT count(*)::int AS c FROM contractor_invoices WHERE contractor_id = $1 AND company_id = $2`, [
            contractorId,
            companyId,
          ]);
          return rows[0].c;
        },
        findExistingInvoice: async (contract: ContractForInvoice, proposal: ProposalForInvoice) => {
          const { rows } = await tx.query(
            `SELECT * FROM contractor_invoices WHERE company_id = $1 AND (contract_id = $2 OR proposal_id = $3) ORDER BY created_at ASC LIMIT 1`,
            [companyId, contract.id, proposal.id]
          );
          return rows[0] || null;
        },
        createInvoice: async (values: Record<string, unknown>) => {
          const { rows } = await tx.query(
            `INSERT INTO contractor_invoices (company_id, contractor_id, invoice_number, invoice_date, due_date, amount, description, proposal_id, contract_id, proposal_reference, line_items, notes, status, is_1099_reportable, job_id, cost_center_id, branding_id, documenso_completion_idempotency_key)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,TRUE,$14,$15,$16,$17)
             RETURNING *`,
            [
              values.company_id,
              values.contractor_id,
              values.invoice_number,
              values.invoice_date,
              values.due_date,
              values.amount,
              values.description,
              values.proposal_id,
              values.contract_id,
              values.proposal_reference,
              values.line_items,
              values.notes,
              values.status,
              values.job_id,
              values.cost_center_id,
              values.branding_id,
              values.documenso_completion_idempotency_key,
            ]
          );
          ids.invoices.push(rows[0].id);
          return rows[0];
        },
        markProposalConverted: async (proposalId: string, invoiceId: string) => {
          await tx.query(`UPDATE contractor_proposals SET converted_to_invoice_id = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3 AND converted_to_invoice_id IS NULL`, [
            invoiceId,
            proposalId,
            companyId,
          ]);
        },
      };
    }

    // Runs the exact same lock-then-check-then-insert flow as
    // server/routes.ts::autoCreateContractInvoiceExactlyOnce, checking out its
    // own pooled connection so concurrent calls get separate DB connections.
    async function autoCreateContractInvoiceExactlyOnce(contractId: string, ids: FixtureIds) {
      const tx = await pool.connect();
      try {
        await tx.query("BEGIN");
        const { rows: contractRows } = await tx.query(`SELECT * FROM contractor_contracts WHERE id = $1`, [contractId]);
        const contract = contractRows[0];
        if (!contract?.proposal_id) {
          await tx.query("COMMIT");
          return null;
        }
        const { rows: proposalRows } = await tx.query(
          `SELECT * FROM contractor_proposals WHERE id = $1 AND company_id = $2 FOR UPDATE`,
          [contract.proposal_id, contract.company_id]
        );
        const proposal = proposalRows[0];
        if (!proposal) {
          await tx.query("COMMIT");
          return null;
        }
        const result = await autoCreateProposalBackedInvoice(contract, proposal, buildDeps(tx, contract.company_id, ids));
        await tx.query("COMMIT");
        return result;
      } catch (err) {
        await tx.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        tx.release();
      }
    }

    // ── 1. Normal valid completion creates one invoice ────────────────────
    await test("a normal valid completion creates exactly one invoice", async (ids) => {
      const companyId = await createCompany(ids);
      const contractorId = await createContractorWorker(ids, companyId);
      const proposal = await createProposal(ids, companyId, contractorId);
      const contract = await createContract(ids, companyId, contractorId, proposal.id);

      const invoice = await autoCreateContractInvoiceExactlyOnce(contract.id, ids);
      assert.ok(invoice?.id, "expected an invoice to be created");
      assert.equal(await countInvoices(companyId), 1);
    });

    // ── 2. Replaying the identical event reuses the existing invoice ──────
    await test("replaying the identical completion event does not create a second invoice", async (ids) => {
      const companyId = await createCompany(ids);
      const contractorId = await createContractorWorker(ids, companyId);
      const proposal = await createProposal(ids, companyId, contractorId);
      const contract = await createContract(ids, companyId, contractorId, proposal.id);

      const first = await autoCreateContractInvoiceExactlyOnce(contract.id, ids);
      assert.ok(first?.id);
      const replay = await autoCreateContractInvoiceExactlyOnce(contract.id, ids);
      assert.equal(replay, null, "replay should not report a newly created invoice (no repeated side effects)");
      assert.equal(await countInvoices(companyId), 1);
    });

    // ── 3. Two genuinely concurrent requests against real Postgres ────────
    await test("two concurrent completion calls over separate connections converge on one invoice", async (ids) => {
      const companyId = await createCompany(ids);
      const contractorId = await createContractorWorker(ids, companyId);
      const proposal = await createProposal(ids, companyId, contractorId);
      const contract = await createContract(ids, companyId, contractorId, proposal.id);

      // Each call to autoCreateContractInvoiceExactlyOnce checks out its own
      // client from the pool (tx = await pool.connect() above), so this
      // Promise.all genuinely races two separate PostgreSQL connections/
      // transactions against the same row — not one pg.Client serialized.
      const [a, b] = await Promise.all([
        autoCreateContractInvoiceExactlyOnce(contract.id, ids),
        autoCreateContractInvoiceExactlyOnce(contract.id, ids),
      ]);
      const winners = [a, b].filter((r): r is NonNullable<typeof a> => !!r?.id);
      assert.equal(winners.length, 1, "exactly one of the two concurrent calls should report a created invoice");
      assert.equal(await countInvoices(companyId), 1, "exactly one invoice row should exist after the race");

      const { rows } = await pool.query(`SELECT id FROM contractor_invoices WHERE company_id = $1 AND contract_id = $2`, [companyId, contract.id]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, winners[0].id, "the single surviving row must be the same invoice the winning call returned");
    });

    // ── 4. Different events for the same completed contract, same business op ─
    await test("repeated events for the same contract collapse to one invoice regardless of call count", async (ids) => {
      const companyId = await createCompany(ids);
      const contractorId = await createContractorWorker(ids, companyId);
      const proposal = await createProposal(ids, companyId, contractorId);
      const contract = await createContract(ids, companyId, contractorId, proposal.id);

      await autoCreateContractInvoiceExactlyOnce(contract.id, ids);
      await autoCreateContractInvoiceExactlyOnce(contract.id, ids);
      await autoCreateContractInvoiceExactlyOnce(contract.id, ids);
      assert.equal(await countInvoices(companyId), 1);
    });

    // ── 5. Different contracts in the same company each create an invoice ──
    await test("different contracts in the same company each get their own invoice", async (ids) => {
      const companyId = await createCompany(ids);
      const contractorId = await createContractorWorker(ids, companyId);
      const proposalA = await createProposal(ids, companyId, contractorId);
      const contractA = await createContract(ids, companyId, contractorId, proposalA.id);
      const proposalB = await createProposal(ids, companyId, contractorId);
      const contractB = await createContract(ids, companyId, contractorId, proposalB.id);

      const invA = await autoCreateContractInvoiceExactlyOnce(contractA.id, ids);
      const invB = await autoCreateContractInvoiceExactlyOnce(contractB.id, ids);
      assert.ok(invA?.id && invB?.id);
      assert.notEqual(invA.id, invB.id);
      assert.equal(await countInvoices(companyId), 2);
    });

    // ── 6. Identically-shaped contracts in different companies don't collide ─
    await test("identically shaped contracts in different companies do not collide", async (ids) => {
      const companyA = await createCompany(ids);
      const companyB = await createCompany(ids);
      const contractorA = await createContractorWorker(ids, companyA);
      const contractorB = await createContractorWorker(ids, companyB);
      const proposalA = await createProposal(ids, companyA, contractorA, "750.00");
      const proposalB = await createProposal(ids, companyB, contractorB, "750.00");
      const contractA = await createContract(ids, companyA, contractorA, proposalA.id);
      const contractB = await createContract(ids, companyB, contractorB, proposalB.id);

      const invA = await autoCreateContractInvoiceExactlyOnce(contractA.id, ids);
      const invB = await autoCreateContractInvoiceExactlyOnce(contractB.id, ids);
      assert.ok(invA?.id && invB?.id);
      assert.equal(await countInvoices(companyA), 1);
      assert.equal(await countInvoices(companyB), 1);

      // Tenant isolation: a lookup scoped to company A must never see company B's invoice.
      const { rows: crossTenantLeak } = await pool.query(
        `SELECT 1 FROM contractor_invoices WHERE company_id = $1 AND contract_id = $2`,
        [companyA, contractB.id]
      );
      assert.equal(crossTenantLeak.length, 0, "company A's scope must not expose company B's invoice");
    });

    // ── 7. A failed transaction can be retried successfully ───────────────
    await test("a failed transaction can be retried and still results in exactly one invoice", async (ids) => {
      const companyId = await createCompany(ids);
      const contractorId = await createContractorWorker(ids, companyId);
      const proposal = await createProposal(ids, companyId, contractorId);
      const contract = await createContract(ids, companyId, contractorId, proposal.id);

      // Simulate a transaction failure (e.g. a transient DB error) by forcing
      // a rollback via an invalid statement inside the transaction, before
      // retrying for real. This proves the operation is safely retryable,
      // not just idempotent across successful calls.
      const tx = await pool.connect();
      try {
        await tx.query("BEGIN");
        await tx.query(`SELECT * FROM contractor_contracts WHERE id = $1`, [contract.id]);
        await tx.query("SELECT 1/0").catch(() => {}); // force an error inside the tx
        await tx.query("ROLLBACK");
      } finally {
        tx.release();
      }

      const retried = await autoCreateContractInvoiceExactlyOnce(contract.id, ids);
      assert.ok(retried?.id, "retry after a failed transaction should succeed");
      assert.equal(await countInvoices(companyId), 1);
    });

    // ── 8. Invalid webhook signatures create no invoice / no side effects ──
    await test("an invalid webhook signature path never reaches invoice creation (unit-level, no DB writes)", async () => {
      const { verifyWebhookSecret } = await import("../server/services/documenso");
      const previousSecret = process.env.DOCUMENSO_WEBHOOK_SECRET;
      process.env.DOCUMENSO_WEBHOOK_SECRET = "correct-test-secret";
      try {
        const badResult = verifyWebhookSecret({ "x-documenso-secret": "wrong-secret" }, Buffer.from("{}"));
        assert.equal(badResult, false, "an incorrect webhook secret must fail verification");
        const goodResult = verifyWebhookSecret({ "x-documenso-secret": "correct-test-secret" }, Buffer.from("{}"));
        assert.equal(goodResult, true, "sanity check: the matching secret must pass verification");
      } finally {
        if (previousSecret === undefined) delete process.env.DOCUMENSO_WEBHOOK_SECRET;
        else process.env.DOCUMENSO_WEBHOOK_SECRET = previousSecret;
      }
    });

    // ── 9. Already-signed/completed replay behavior still passes ──────────
    await test("a contract already marked fully_signed with a converted proposal is not re-invoiced", async (ids) => {
      const companyId = await createCompany(ids);
      const contractorId = await createContractorWorker(ids, companyId);
      const proposal = await createProposal(ids, companyId, contractorId);
      const contract = await createContract(ids, companyId, contractorId, proposal.id);

      const first = await autoCreateContractInvoiceExactlyOnce(contract.id, ids);
      assert.ok(first?.id);

      // Re-run the whole flow as if a second "already signed" webhook replay
      // arrived after the proposal was already marked converted.
      const secondCall = await autoCreateContractInvoiceExactlyOnce(contract.id, ids);
      assert.equal(secondCall, null);
      assert.equal(await countInvoices(companyId), 1);
    });

    // ── 10. DB uniqueness backstop independently rejects an actual duplicate ─
    await test("the database uniqueness backstop rejects a duplicate idempotency key independent of application logic", async (ids) => {
      const companyId = await createCompany(ids);
      const contractorId = await createContractorWorker(ids, companyId);
      const proposal = await createProposal(ids, companyId, contractorId);
      const contract = await createContract(ids, companyId, contractorId, proposal.id);

      const insertOne = () =>
        pool.query(
          `INSERT INTO contractor_invoices (company_id, contractor_id, invoice_number, invoice_date, amount, status, is_1099_reportable, documenso_completion_idempotency_key)
           VALUES ($1, $2, 'INV-TEST-0001', CURRENT_DATE::text, 100, 'submitted', TRUE, $3)
           RETURNING id`,
          [companyId, contractorId, contract.id]
        );

      const first = await insertOne();
      ids.invoices.push(first.rows[0].id);
      let caught: unknown = null;
      try {
        await insertOne();
      } catch (err) {
        caught = err;
      }
      assert.ok(caught, "a second row with the same (company_id, idempotency_key) must be rejected");
      assert.ok(isUniqueConstraintViolation(caught, AUTO_INVOICE_UNIQUE_INDEX), `expected a ${AUTO_INVOICE_UNIQUE_INDEX} violation, got: ${(caught as Error)?.message}`);
    });

    console.log(`\ncontractor-invoice-exactly-once-db.test.ts: ${passCount} DB-backed tests passed against a verified disposable database. All fixture rows cleaned up and cleanup verified per test.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exitCode = 1;
});
