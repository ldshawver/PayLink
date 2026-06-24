/**
 * Static regression checks for contractor contract signing + Documenso callback flow.
 * Run: npx tsx tests/contract-documenso-static.test.ts
 */
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");
function ok(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

ok("contract signing authorization uses company_user_access", routes.includes("FROM company_user_access cua"));
ok("contract signing authorization no longer references missing user_company_access", !routes.includes("FROM user_company_access uca"));
ok("contract Documenso send creates public MyPayLink signer tokens", routes.includes("const signerTokens = new Map") && routes.includes("myPayLinkSigningUrl: buildContractSigningUrl(appBaseUrl, token)"));
ok("contract Documenso return URL prefers public token route", routes.includes("const primaryReturnUrl = signerTokens.get") && routes.includes("returnUrl: primaryReturnUrl"));
ok("contract Documenso send persists contract metadata", routes.includes("metadata: { externalId: contractId, contractId, companyId: contract.company_id }"));
ok("Documenso webhook handles contract signature request table", routes.includes("FROM documenso_signature_requests") && routes.includes("document_type IN ('contract', 'contractor_hub_contract')"));
ok("Documenso contract completion creates invoice", routes.includes("INSERT INTO contractor_invoices") && routes.includes("converted_to_invoice_id = ${invoiceId}"));
const verifyIndex = routes.indexOf("const signatureValid = verifyWebhookSecret");
const webhookInsertIndex = routes.indexOf("INSERT INTO webhook_events", verifyIndex);
const contractMutationIndex = routes.indexOf("UPDATE contractor_contracts SET status = 'fully_signed'", verifyIndex);
ok("Documenso webhook validates signature before event insert", verifyIndex >= 0 && webhookInsertIndex > verifyIndex);
ok("Documenso webhook validates signature before contract mutation", verifyIndex >= 0 && contractMutationIndex > verifyIndex);
ok("Documenso contract invoice count is company-scoped", routes.includes("WHERE contractor_id = ${contractorId} AND company_id = ${contract.company_id}"));
ok("Documenso duplicate already-signed contracts do not re-run completion side effects", routes.includes("const wasAlreadyFullySigned = contract.status === \"fully_signed\"") && routes.includes("if (!wasAlreadyFullySigned && contract.proposal_id)"));

ok("public signing endpoint exposes Documenso metadata", routes.includes("documensoSigningUrl: row.documenso_signing_url") && routes.includes("documensoRecipientId: row.documenso_recipient_id"));
ok("resend refreshes persisted Documenso signer metadata", routes.includes("const resendResult = await resendDocumensoDocument(sigReq.documenso_document_id)") && routes.includes("documenso_recipient_ids = COALESCE"));
