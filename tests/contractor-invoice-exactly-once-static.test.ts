/**
 * Static + pure-logic checks for the Documenso-completion exactly-once
 * auto-invoice hardening (DB uniqueness backstop + conflict recovery).
 * These do not require a database connection.
 * Run: npx tsx tests/contractor-invoice-exactly-once-static.test.ts
 */
import fs from "node:fs";
import assert from "node:assert/strict";
import {
  autoCreateProposalBackedInvoice,
  isUniqueConstraintViolation,
  AUTO_INVOICE_UNIQUE_INDEX,
  type ContractForInvoice,
  type ProposalForInvoice,
} from "../server/contract-signing-flow";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const bootMigrations = fs.readFileSync("server/index.ts", "utf8");
const schema = fs.readFileSync("shared/schema.ts", "utf8");
const migrationFile = fs.readFileSync("migrations/0014_contractor_invoice_exactly_once.sql", "utf8");

let passCount = 0;
function ok(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  passCount++;
  console.log(`PASS: ${name}`);
}

async function okAsync(name: string, fn: () => Promise<void>) {
  await fn();
  passCount++;
  console.log(`PASS: ${name}`);
}

// ── The Documenso completion flow invokes the exactly-once helper ──────────
ok(
  "Documenso webhook completion routes invoice creation through the exactly-once helper",
  routes.includes("if (contract.proposal_id) {\n                await autoCreateContractInvoiceExactlyOnce(contract.id);")
);
ok(
  "the exactly-once helper is also reused by the public signing completion and admin fully-signed paths (single implementation, not duplicated)",
  routes.includes("autoCreateContractInvoiceExactlyOnce(signer.contract_id)") &&
    routes.includes("autoCreateContractInvoiceExactlyOnce(req.params.id)")
);

// ── The helper uses a PostgreSQL transaction ────────────────────────────────
ok(
  "autoCreateContractInvoiceExactlyOnce wraps its work in db.transaction",
  routes.includes("async function autoCreateContractInvoiceExactlyOnce") &&
    routes.includes("return db.transaction(async (tx) => {")
);

// ── Lock/check/insert sequence happens in the correct order ────────────────
{
  const fnStart = routes.indexOf("async function autoCreateContractInvoiceExactlyOnce");
  const fnBody = routes.slice(fnStart, fnStart + 2000);
  const lockIndex = fnBody.indexOf("FOR UPDATE");
  const checkIndex = fnBody.indexOf("findExistingInvoice");
  const insertIndex = fnBody.indexOf("createInvoice: async");
  ok(
    "lock (FOR UPDATE) is acquired before the existing-invoice check, which is wired before the insert dependency",
    lockIndex >= 0 && checkIndex > lockIndex && insertIndex > checkIndex
  );
}
ok(
  "the pure helper itself checks for an existing invoice before attempting to insert",
  (() => {
    const src = fs.readFileSync("server/contract-signing-flow.ts", "utf8");
    const checkIdx = src.indexOf("const existingInvoice = await deps.findExistingInvoice");
    const insertIdx = src.indexOf("invoice = await deps.createInvoice(invoiceValues);");
    return checkIdx >= 0 && insertIdx > checkIdx;
  })()
);

// ── Lock identity includes tenant/company scope and contract/signature-request identity
ok(
  "the row lock is scoped by both proposal id and company_id (tenant-scoped, not global)",
  routes.includes("WHERE id = ${contract.proposal_id} AND company_id = ${contract.company_id}") &&
    routes.includes("FOR UPDATE")
);

// ── Migration creates the intended partial unique index ────────────────────
ok(
  "migration adds a nullable idempotency column, not a NOT NULL one",
  migrationFile.includes("ADD COLUMN IF NOT EXISTS documenso_completion_idempotency_key TEXT") &&
    !/documenso_completion_idempotency_key TEXT NOT NULL/i.test(migrationFile)
);
ok(
  "migration backstop is a partial unique index (populated values only), preserving historical NULL rows",
  migrationFile.includes(`CREATE UNIQUE INDEX IF NOT EXISTS ${AUTO_INVOICE_UNIQUE_INDEX}`) &&
    migrationFile.includes("ON contractor_invoices (company_id, documenso_completion_idempotency_key)") &&
    migrationFile.includes("WHERE documenso_completion_idempotency_key IS NOT NULL")
);
ok("migration performs no destructive statements", !/\bDROP\s+(TABLE|COLUMN)\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i.test(migrationFile));
ok(
  "the same additive DDL is mirrored into this repo's real boot-time auto-migration mechanism",
  bootMigrations.includes("ALTER TABLE contractor_invoices ADD COLUMN IF NOT EXISTS documenso_completion_idempotency_key TEXT") &&
    bootMigrations.includes(`CREATE UNIQUE INDEX IF NOT EXISTS ${AUTO_INVOICE_UNIQUE_INDEX}`)
);
ok(
  "schema.ts declares the new nullable idempotency column on contractorInvoices",
  schema.includes('documensoCompletionIdempotencyKey: text("documenso_completion_idempotency_key")')
);

// ── The uniqueness identity is stable, not amount/description/timestamp ────
ok(
  "the idempotency key is derived from the contract id, not amount/description/timestamp",
  routes.includes("documenso_completion_idempotency_key: contract.id") ||
    fs.readFileSync("server/contract-signing-flow.ts", "utf8").includes("documenso_completion_idempotency_key: contract.id")
);
ok(
  "the unique index columns are company_id + the idempotency key only (no amount/description/created_at in the index)",
  /CREATE UNIQUE INDEX[^;]*ON contractor_invoices \(company_id, documenso_completion_idempotency_key\)/i.test(migrationFile) &&
    !/amount|description|created_at/i.test(migrationFile.match(/CREATE UNIQUE INDEX[^;]*;/i)?.[0] || "")
);

// ── Postgres 23505 is handled by reading and returning the winning invoice ─
{
  const src = fs.readFileSync("server/contract-signing-flow.ts", "utf8");
  ok(
    "createInvoice is wrapped in try/catch that recognizes 23505 via isUniqueConstraintViolation",
    src.includes("invoice = await deps.createInvoice(invoiceValues);") &&
      src.includes("isUniqueConstraintViolation(err, AUTO_INVOICE_UNIQUE_INDEX)")
  );
  ok(
    "on conflict, the code re-reads the winning row via findExistingInvoice rather than fabricating one",
    src.includes("const winner = await deps.findExistingInvoice(contract, proposal);") && src.includes("await deps.markProposalConverted(proposal.id, winner.id);")
  );
}

// ── Non-unique database errors are rethrown ─────────────────────────────────
ok(
  "non-unique-violation errors are rethrown, not swallowed",
  fs.readFileSync("server/contract-signing-flow.ts", "utf8").includes("throw err;")
);

// ── duplicateHash is calculate-and-forget, not enforcement ─────────────────
ok(
  "duplicateHash is computed on manual invoice submission but never queried anywhere (calculate-and-forget, not enforced)",
  /data\.duplicateHash\s*=\s*crypto\.createHash/.test(routes) &&
    !/WHERE[^;]*duplicate_hash/i.test(routes) &&
    !/duplicateHash\s*===|duplicateHash\s*==/.test(routes)
);
ok(
  "the new migration's own DDL does not rely on duplicate_hash for enforcement",
  !migrationFile.toLowerCase().includes("duplicate_hash")
);
ok(
  "the new boot-time auto-migration entries for exactly-once do not reference duplicate_hash",
  (() => {
    const marker = "Exactly-once backstop for Documenso-completion auto-invoice creation";
    const idx = bootMigrations.indexOf(marker);
    const block = bootMigrations.slice(idx, idx + 500);
    return idx >= 0 && !block.toLowerCase().includes("duplicate_hash");
  })()
);

// ── Invalid webhook signatures cannot reach invoice creation ───────────────
{
  const verifyIndex = routes.indexOf("const signatureValid = verifyWebhookSecret");
  const rejectIndex = routes.indexOf('return res.status(401).json({ message: "Invalid Documenso webhook secret" });', verifyIndex);
  const invoiceCallIndex = routes.indexOf("await autoCreateContractInvoiceExactlyOnce(contract.id);", verifyIndex);
  ok(
    "an invalid signature returns 401 before any code path can reach invoice creation",
    verifyIndex >= 0 && rejectIndex > verifyIndex && rejectIndex < invoiceCallIndex
  );
}

// ── Existing tenant-isolation checks remain present ─────────────────────────
ok(
  "webhook invoice creation still supplies a company-scoped contract/proposal idempotency lookup",
  routes.includes("SELECT * FROM contractor_invoices") && routes.includes("contract_id = ${contractForInvoice.id} OR proposal_id = ${proposalForInvoice.id}")
);
ok(
  "auto invoice count-for-contractor query remains company-scoped",
  routes.includes("WHERE contractor_id = ${contractorId} AND company_id = ${contract.company_id}")
);
ok("markProposalConverted remains company-scoped and idempotent (converted_to_invoice_id IS NULL guard)", routes.includes("converted_to_invoice_id IS NULL"));

// ── Pure-logic proof of conflict recovery, no DB needed ─────────────────────
function mockContract(): ContractForInvoice & { id: string } {
  return { id: "contract-1", company_id: "company-1", contractor_id: "worker-1", proposal_id: "proposal-1", status: "fully_signed" };
}
function mockProposal(): ProposalForInvoice & { id: string } {
  return { id: "proposal-1", contractor_id: "worker-1", amount: "100.00", converted_to_invoice_id: null };
}

await okAsync("autoCreateProposalBackedInvoice creates exactly one invoice on the happy path, keyed by contract id", async () => {
  let created = 0;
  const result = await autoCreateProposalBackedInvoice(mockContract(), mockProposal(), {
    countInvoicesForContractor: async () => 0,
    findExistingInvoice: async () => null,
    createInvoice: async (values) => {
      created++;
      assert.equal(values.documenso_completion_idempotency_key, "contract-1", "idempotency key must be the stable contract id, not amount/description/timestamp");
      assert.equal(values.amount, "100.00");
      return { id: "invoice-1", ...values } as any;
    },
    markProposalConverted: async () => {},
  });
  assert.equal(created, 1);
  assert.equal(result?.id, "invoice-1");
});

await okAsync("autoCreateProposalBackedInvoice does not repeat side effects when an invoice already exists", async () => {
  let createCalls = 0;
  let convertedWith: string | null = null;
  const result = await autoCreateProposalBackedInvoice(mockContract(), mockProposal(), {
    countInvoicesForContractor: async () => 1,
    findExistingInvoice: async () => ({ id: "existing-invoice" } as any),
    createInvoice: async () => {
      createCalls++;
      throw new Error("must not attempt to create a new invoice when one already exists");
    },
    markProposalConverted: async (_proposalId, invoiceId) => {
      convertedWith = invoiceId;
    },
  });
  assert.equal(result, null, "replay must not report a newly created invoice");
  assert.equal(createCalls, 0);
  assert.equal(convertedWith, "existing-invoice");
});

await okAsync(
  "autoCreateProposalBackedInvoice recovers from a Postgres 23505 unique-constraint race by reading and returning the winning row instead of throwing a 500",
  async () => {
    let findCalls = 0;
    let convertedWith: string | null = null;
    const conflictError = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      constraint: AUTO_INVOICE_UNIQUE_INDEX,
    });
    const result = await autoCreateProposalBackedInvoice(mockContract(), mockProposal(), {
      countInvoicesForContractor: async () => 0,
      findExistingInvoice: async () => {
        findCalls++;
        // First call (pre-insert check) finds nothing; the race happens at insert time.
        return findCalls === 1 ? null : ({ id: "winner-invoice" } as any);
      },
      createInvoice: async () => {
        throw conflictError;
      },
      markProposalConverted: async (_proposalId, invoiceId) => {
        convertedWith = invoiceId;
      },
    });
    assert.equal(result, null, "conflict recovery preserves the no-repeated-side-effects contract");
    assert.equal(findCalls, 2, "must re-read after the conflict to find the winning row");
    assert.equal(convertedWith, "winner-invoice", "must reuse (mark converted with) the winning row, not fabricate a new one");
  }
);

await okAsync("a non-unique-violation error from createInvoice is rethrown, not swallowed as a conflict", async () => {
  const genericError = new Error("connection reset");
  await assert.rejects(
    () =>
      autoCreateProposalBackedInvoice(mockContract(), mockProposal(), {
        countInvoicesForContractor: async () => 0,
        findExistingInvoice: async () => null,
        createInvoice: async () => {
          throw genericError;
        },
        markProposalConverted: async () => {},
      }),
    genericError
  );
});

await okAsync("a unique-violation on a DIFFERENT index/constraint is also rethrown, not mistaken for our conflict", async () => {
  const otherConflict = Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint: "some_unrelated_unique_index",
  });
  await assert.rejects(
    () =>
      autoCreateProposalBackedInvoice(mockContract(), mockProposal(), {
        countInvoicesForContractor: async () => 0,
        findExistingInvoice: async () => null,
        createInvoice: async () => {
          throw otherConflict;
        },
        markProposalConverted: async () => {},
      }),
    otherConflict
  );
});

ok(
  "isUniqueConstraintViolation only matches Postgres error code 23505",
  isUniqueConstraintViolation({ code: "23505" }) === true &&
    isUniqueConstraintViolation({ code: "23503" }) === false &&
    isUniqueConstraintViolation(new Error("plain error")) === false &&
    isUniqueConstraintViolation(null) === false
);
ok(
  "isUniqueConstraintViolation can be scoped to a specific constraint/index name",
  isUniqueConstraintViolation({ code: "23505", constraint: AUTO_INVOICE_UNIQUE_INDEX }, AUTO_INVOICE_UNIQUE_INDEX) === true &&
    isUniqueConstraintViolation({ code: "23505", constraint: "some_other_index" }, AUTO_INVOICE_UNIQUE_INDEX) === false
);

console.log(`\ncontractor-invoice-exactly-once-static.test.ts: ${passCount} checks passed.`);
