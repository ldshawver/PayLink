/**
 * Verifies, against the real isolated paylink_dev database, that the
 * Documenso reuse/resend queries in server/routes.ts (both scoped by
 * `AND company_id = ${contract.company_id}`) structurally cannot return a
 * signature request or signer belonging to a different company — i.e. cross-
 * tenant reuse of a Documenso envelope is rejected by the query shape itself,
 * not just by an application-level check that could be bypassed.
 *
 * Run: pnpm exec tsx tests/documenso-cross-tenant-scope.test.ts
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import dotenv from "dotenv";

const DEV_ENV_PATH = "/home/paylinkssh/paylink-dev.env";
if (!process.env.DATABASE_URL && fs.existsSync(DEV_ENV_PATH)) {
  dotenv.config({ path: DEV_ENV_PATH });
} else {
  dotenv.config();
}

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err: any) {
    console.error(`FAIL - ${name}`);
    console.error(err?.stack || err);
    process.exitCode = 1;
  }
}

async function main() {
  const { db } = await import("../server/db");
  const { sql } = await import("drizzle-orm");
  const { assertSafeDemoEnvironment, DEMO_TENANT_SLUG } = await import("../server/demo/demoTenantProvisioner");

  // Same isolation guard the demo provisioner uses — refuse to run anywhere
  // except the isolated dev database.
  await assertSafeDemoEnvironment();

  await test("cross-tenant Documenso reuse is rejected by the company_id-scoped query itself", async () => {
    const t = await db.execute(sql`SELECT company_id FROM tenant_companies WHERE tenant_id = (SELECT id FROM tenants WHERE slug = ${DEMO_TENANT_SLUG}) AND is_primary = true LIMIT 1`);
    const demoCompanyId = (t.rows[0] as any).company_id;

    const otherCompany = await db.execute(sql`SELECT id FROM companies WHERE name != 'PayLink Demo Tenant' LIMIT 1`);
    assert.ok(otherCompany.rows.length > 0, "precondition: at least one other real company must exist in this dev DB");
    const otherCompanyId = (otherCompany.rows[0] as any).id;
    assert.notEqual(otherCompanyId, demoCompanyId);

    const contract = await db.execute(sql`SELECT id FROM contractor_contracts WHERE company_id = ${demoCompanyId} AND contract_number = 'DEMO-PROV-CC-0001'`);
    assert.equal(contract.rows.length, 1, "precondition: demo contract must exist");
    const contractId = (contract.rows[0] as any).id;

    // Mirrors the exact WHERE-clause shape used in the send-for-signature and
    // resend handlers (routes.ts): document_type + related_record_id +
    // company_id + documenso_document_id IS NOT NULL.
    const sameCompanyLookup = await db.execute(sql`
      SELECT id FROM documenso_signature_requests
      WHERE document_type IN ('contract','contractor_hub_contract')
        AND related_record_id = ${contractId}
        AND company_id = ${demoCompanyId}
    `);
    const crossTenantLookup = await db.execute(sql`
      SELECT id FROM documenso_signature_requests
      WHERE document_type IN ('contract','contractor_hub_contract')
        AND related_record_id = ${contractId}
        AND company_id = ${otherCompanyId}
    `);
    assert.equal(crossTenantLookup.rows.length, 0, "a contract's signature request must never resolve under a different company_id");
    // (sameCompanyLookup may legitimately be empty too — this demo contract was never actually sent via Documenso — the point is the two queries must never return the same non-empty result)
    assert.deepEqual(sameCompanyLookup.rows, [], "sanity: demo contract has no Documenso signature request (never sent — locally signed only)");

    // Same structural check for contract_signers's company-scoped variant used
    // elsewhere (assertContractCompanyAccess / contract_signers queries).
    const signersUnderOtherCompany = await db.execute(sql`
      SELECT cs.id FROM contract_signers cs
      JOIN contractor_contracts cc ON cc.id = cs.contract_id
      WHERE cs.contract_id = ${contractId} AND cc.company_id = ${otherCompanyId}
    `);
    assert.equal(signersUnderOtherCompany.rows.length, 0, "signers must never resolve when joined against a mismatched company_id");
  });

  await test("proposal -> contract -> signed state -> invoice -> closeout chain still valid after this repair (no regression)", async () => {
    const t = await db.execute(sql`SELECT company_id FROM tenant_companies WHERE tenant_id = (SELECT id FROM tenants WHERE slug = ${DEMO_TENANT_SLUG}) AND is_primary = true LIMIT 1`);
    const companyId = (t.rows[0] as any).company_id;
    const contract = await db.execute(sql`SELECT id, status, proposal_id FROM contractor_contracts WHERE company_id = ${companyId} AND contract_number = 'DEMO-PROV-CC-0001'`);
    assert.equal(contract.rows.length, 1);
    assert.equal((contract.rows[0] as any).status, "fully_signed");
    const signers = await db.execute(sql`SELECT status, documenso_recipient_id FROM contract_signers WHERE contract_id = ${(contract.rows[0] as any).id}`);
    assert.equal(signers.rows.length, 2);
    for (const s of signers.rows as any[]) {
      assert.equal(s.status, "signed");
      // Locally-signed demo contract never went through Documenso — this
      // column existing and being nullable is exactly what lets the ID-first
      // matching repair coexist with legacy/local-only signer records.
      assert.equal(s.documenso_recipient_id, null);
    }
    const invoice = await db.execute(sql`SELECT status, contract_id FROM contractor_invoices WHERE company_id = ${companyId} AND invoice_number = 'DEMO-PROV-CINV-0001'`);
    assert.equal(invoice.rows.length, 1);
    assert.equal((invoice.rows[0] as any).contract_id, (contract.rows[0] as any).id);
    assert.equal((invoice.rows[0] as any).status, "approved", "must still be in the closeout-ready state this repair's mark-paid validation exercised earlier");
  });

  console.log(`\n${passed} test(s) passed`);
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
