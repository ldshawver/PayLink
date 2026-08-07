/**
 * Proves the resend handler's Phase A/B/C separation: every verification-only
 * outcome (no signature request, verification GET throw, non-resendable
 * document, zero recipients, no eligible signer) causes zero operational
 * writes (contract_signers / documenso_signature_requests), because Phase B
 * (the actual Documenso resend call) is never reached for any of them.
 *
 * Two genuinely live checks run against the real dev server + isolated DB
 * (no Documenso credentials configured in dev, so only "no signature
 * request" and "temporary failure" are actually reachable live — see note
 * below). The remaining failure classes (404/401/403/zero-recipients/
 * non-resendable/missing/ambiguous), which require a real Documenso success
 * response to reach, are proven with a static source-structure check instead
 * — the same technique already used by tests/documenso-signer-set-mismatch.test.ts
 * for /send-for-signature. No real Documenso envelope is created or sent.
 *
 * Run: pnpm exec tsx tests/documenso-resend-mutation-free-verification.test.ts
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
async function test(name: string, fn: () => Promise<void> | void) {
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
  await assertSafeDemoEnvironment(); // refuses to run anywhere except the isolated dev DB

  // ── Static proof: every verification-only branch sits strictly before
  //    Phase B (the real resend call) and before any operational UPDATE ──
  await test("resend handler: every verification-only outcome occurs before Phase B (resendDocumensoDocument) and before any operational UPDATE", () => {
    const routes = fs.readFileSync("server/routes.ts", "utf8");
    const handlerStart = routes.indexOf('app.post("/api/contractor-contracts/:id/resend-signing-request"');
    assert.ok(handlerStart >= 0, "resend handler not found");
    const phaseBMarker = routes.indexOf("documensoResult = await resendDocumensoDocument(sigReq.documenso_document_id);", handlerStart);
    assert.ok(phaseBMarker > handlerStart, "Phase B call site not found after handler start");
    const prePhaseBSlice = routes.slice(handlerStart, phaseBMarker);

    for (const marker of [
      "documenso_no_signature_request",
      "classifyDocumensoVerificationFailure(err)",
      "documenso_document_not_resendable",
      "documenso_document_has_no_recipients",
      "documenso_no_eligible_recipients",
    ]) {
      assert.ok(prePhaseBSlice.includes(marker), `expected '${marker}' before Phase B, not found`);
    }
    assert.ok(!/UPDATE\s+contract_signers/i.test(prePhaseBSlice), "no UPDATE contract_signers may occur before Phase B");
    assert.ok(!/UPDATE\s+documenso_signature_requests/i.test(prePhaseBSlice), "no UPDATE documenso_signature_requests may occur before Phase B");
    // The only mutating statement allowed before Phase B is the one, explicitly
    // allowed diagnostic log (documenso_resend_requested via
    // createExpenseApprovalAction) recorded at the very top of the handler.
    const insertCount = (prePhaseBSlice.match(/INSERT INTO/gi) || []).length;
    assert.equal(insertCount, 0, "no raw INSERT INTO should appear in the pre-Phase-B slice (createExpenseApprovalAction is a storage helper call, not an inline INSERT)");
  });

  await test("resend handler: refreshDocumensoRecipientMappings (which itself writes) is no longer called from Phase A", () => {
    const routes = fs.readFileSync("server/routes.ts", "utf8");
    const handlerStart = routes.indexOf('app.post("/api/contractor-contracts/:id/resend-signing-request"');
    const phaseBMarker = routes.indexOf("documensoResult = await resendDocumensoDocument(sigReq.documenso_document_id);", handlerStart);
    const prePhaseBSlice = routes.slice(handlerStart, phaseBMarker);
    assert.ok(!prePhaseBSlice.includes("refreshDocumensoRecipientMappings("), "recipient reconciliation writes must not occur during verification");
  });

  // ── Live check #1: no documenso_signature_request at all → no mutation ──
  await test("live: resend with no Documenso signature request causes zero mutation", async () => {
    const t = await db.execute(sql`SELECT company_id FROM tenant_companies WHERE tenant_id = (SELECT id FROM tenants WHERE slug = ${DEMO_TENANT_SLUG}) AND is_primary = true LIMIT 1`);
    const companyId = (t.rows[0] as any).company_id;
    const contract = await db.execute(sql`SELECT id, status FROM contractor_contracts WHERE company_id = ${companyId} AND contract_number = 'DEMO-PROV-CC-0001'`);
    const contractId = (contract.rows[0] as any).id;
    const originalStatus = (contract.rows[0] as any).status;

    // Ensure no signature request row exists for this contract (demo contract
    // is locally-signed only, never sent via Documenso).
    const existingSigReq = await db.execute(sql`SELECT id FROM documenso_signature_requests WHERE related_record_id = ${contractId}`);
    assert.equal(existingSigReq.rows.length, 0, "precondition: no signature request should exist yet");

    const signersBefore = await db.execute(sql`SELECT id, status, documenso_recipient_id, updated_at FROM contract_signers WHERE contract_id = ${contractId} ORDER BY id`);

    // Temporarily allow the resend call to reach the handler by flipping
    // status away from the terminal 'fully_signed' guard, since that guard
    // sits even before our verification phase and would otherwise mask this
    // specific check. Restored immediately after.
    await db.execute(sql`UPDATE contractor_contracts SET status = 'sent' WHERE id = ${contractId}`);
    try {
      const loginRes = await fetch("https://dev.mypaylink.app/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "demo_prov_admin", password: "DemoPass123!" }),
      });
      const cookie = loginRes.headers.getSetCookie()[0]?.split(";")[0];
      assert.ok(cookie, "login must succeed and return a session cookie");

      const resendRes = await fetch(`https://dev.mypaylink.app/api/contractor-contracts/${contractId}/resend-signing-request`, {
        method: "POST", headers: { Cookie: cookie! },
      });
      const body: any = await resendRes.json();
      assert.equal(body.code, "documenso_no_signature_request");
      assert.equal(body.success, false);
      assert.equal(body.accepted, 0);
    } finally {
      await db.execute(sql`UPDATE contractor_contracts SET status = ${originalStatus} WHERE id = ${contractId}`);
    }

    const signersAfter = await db.execute(sql`SELECT id, status, documenso_recipient_id, updated_at FROM contract_signers WHERE contract_id = ${contractId} ORDER BY id`);
    assert.deepEqual(signersBefore.rows, signersAfter.rows, "contract_signers must be byte-for-byte unchanged");
    const sigReqAfter = await db.execute(sql`SELECT id FROM documenso_signature_requests WHERE related_record_id = ${contractId}`);
    assert.equal(sigReqAfter.rows.length, 0, "no documenso_signature_requests row must have been created");
  });

  // ── Live check #2: signature request exists but Documenso is unconfigured
  //    in this dev environment → temporary_failure classification, zero
  //    mutation to contract_signers, and documenso_signature_requests.status
  //    must NOT be flipped to resend_failed merely because verification failed ──
  await test("live: resend against an unreachable/unconfigured Documenso causes zero mutation (not even resend_failed)", async () => {
    const t = await db.execute(sql`SELECT company_id FROM tenant_companies WHERE tenant_id = (SELECT id FROM tenants WHERE slug = ${DEMO_TENANT_SLUG}) AND is_primary = true LIMIT 1`);
    const companyId = (t.rows[0] as any).company_id;
    const contract = await db.execute(sql`SELECT id, status FROM contractor_contracts WHERE company_id = ${companyId} AND contract_number = 'DEMO-PROV-CC-0001'`);
    const contractId = (contract.rows[0] as any).id;
    const originalStatus = (contract.rows[0] as any).status;

    // Defensive: remove any leftover fixture from a previously-interrupted run.
    await db.execute(sql`DELETE FROM documenso_signature_requests WHERE documenso_document_id = ${"fake-doc-id-mutation-proof"}`);

    await db.execute(sql`
      INSERT INTO documenso_signature_requests (document_type, related_record_id, company_id, documenso_document_id, status)
      VALUES ('contract', ${contractId}, ${companyId}, ${"fake-doc-id-mutation-proof"}, 'sent')
    `);
    const sigReqRow = await db.execute(sql`SELECT id, status, updated_at FROM documenso_signature_requests WHERE related_record_id = ${contractId} AND documenso_document_id = ${"fake-doc-id-mutation-proof"}`);
    const sigReqBefore = sigReqRow.rows[0] as any;

    try {
      const signersBefore = await db.execute(sql`SELECT id, status, documenso_recipient_id, updated_at FROM contract_signers WHERE contract_id = ${contractId} ORDER BY id`);

      await db.execute(sql`UPDATE contractor_contracts SET status = 'sent' WHERE id = ${contractId}`);
      try {
        const loginRes = await fetch("https://dev.mypaylink.app/api/auth/login", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "demo_prov_admin", password: "DemoPass123!" }),
        });
        const cookie = loginRes.headers.getSetCookie()[0]?.split(";")[0];
        assert.ok(cookie);

        const resendRes = await fetch(`https://dev.mypaylink.app/api/contractor-contracts/${contractId}/resend-signing-request`, {
          method: "POST", headers: { Cookie: cookie! },
        });
        const body: any = await resendRes.json();
        assert.equal(body.code, "documenso_temporary_failure", `expected temporary_failure (Documenso unconfigured), got: ${JSON.stringify(body.code)}`);
        assert.equal(body.accepted, 0);
        assert.equal(body.documensoResult, "not_attempted");
      } finally {
        await db.execute(sql`UPDATE contractor_contracts SET status = ${originalStatus} WHERE id = ${contractId}`);
      }

      const signersAfter = await db.execute(sql`SELECT id, status, documenso_recipient_id, updated_at FROM contract_signers WHERE contract_id = ${contractId} ORDER BY id`);
      assert.deepEqual(signersBefore.rows, signersAfter.rows, "contract_signers must be byte-for-byte unchanged");

      const sigReqAfter = await db.execute(sql`SELECT id, status, updated_at FROM documenso_signature_requests WHERE id = ${sigReqBefore.id}`);
      assert.deepEqual(sigReqAfter.rows[0], sigReqBefore, "documenso_signature_requests row must be byte-for-byte unchanged — status must NOT be flipped to resend_failed merely because verification failed");
    } finally {
      // Cleanup: remove the temporary fixture row, guaranteed even on assertion failure.
      await db.execute(sql`DELETE FROM documenso_signature_requests WHERE id = ${sigReqBefore.id}`);
    }
  });

  console.log(`\n${passed} test(s) passed`);
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
