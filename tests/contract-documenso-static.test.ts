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
ok("contract Documenso send includes in-app contract return URL", routes.includes("buildContractDocumensoReturnUrl(getAppBaseUrl(req), contractId)"));
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
