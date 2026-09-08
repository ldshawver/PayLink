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
ok("contract Documenso return URL prefers public token route", routes.includes("const primarySignerToken = signerTokens.get") && routes.includes("returnUrl: primaryReturnUrl"));
ok("contract Documenso send persists contract metadata", routes.includes("metadata: { externalId: contractId, contractId, companyId: contract.company_id, senderName: senderIdentity.name"));
ok("Documenso webhook handles contract signature request table", routes.includes("FROM documenso_signature_requests") && routes.includes("document_type IN ('contract', 'contractor_hub_contract')"));
ok("Documenso contract completion creates invoice", routes.includes("INSERT INTO contractor_invoices") && routes.includes("converted_to_invoice_id = ${invoiceId}"));
const verifyIndex = routes.indexOf("const signatureValid = verifyWebhookSecret");
const webhookInsertIndex = routes.indexOf("INSERT INTO webhook_events", verifyIndex);
const contractMutationIndex = routes.indexOf("UPDATE contractor_contracts SET status = 'fully_signed'", verifyIndex);
ok("Documenso webhook validates signature before event insert", verifyIndex >= 0 && webhookInsertIndex > verifyIndex);
ok("Documenso webhook validates signature before contract mutation", verifyIndex >= 0 && contractMutationIndex > verifyIndex);
ok("Documenso contract invoice count is company-scoped", routes.includes("WHERE contractor_id = ${contractorId} AND company_id = ${contract.company_id}"));
ok("Documenso duplicate/replayed completion cannot regress an already active/completed/void/terminated contract (atomic WHERE guard, not a check-then-update race)", routes.includes("WHERE id = ${contract.id} AND status NOT IN ('active','completed','void','terminated')"));
ok("Documenso webhook completion always routes invoice creation through the single exactly-once verified-completion helper (idempotent even on replay)", routes.includes("await activateContractAfterVerifiedCompletion(contract.id, `webhook:") && routes.includes("autoCreateContractInvoiceExactlyOnce(activated.id)"));

ok("public signing endpoint exposes Documenso metadata", routes.includes("documensoSigningUrl: row.documenso_signing_url") && routes.includes("documensoRecipientId: row.documenso_recipient_id"));
ok("resend refreshes persisted Documenso signer metadata", routes.includes("await refreshDocumensoRecipientMappings") && routes.includes("documenso_recipient_ids ="));

const schema = fs.readFileSync("server/index.ts", "utf8") + "\n" + fs.readFileSync("migrations/0011_notification_preferences_push_enabled.sql", "utf8");
const signingFlow = fs.readFileSync("server/contract-signing-flow.ts", "utf8");
const app = fs.readFileSync("client/src/App.tsx", "utf8");
const publicSigningPage = fs.readFileSync("client/src/pages/contract-signing.tsx", "utf8");
ok("schema repair supports signer tokens and Documenso metadata", schema.includes("ALTER TABLE contract_signers ADD COLUMN IF NOT EXISTS signing_token_hash TEXT") && schema.includes("ALTER TABLE contract_signers ADD COLUMN IF NOT EXISTS signing_token_expires_at TIMESTAMP") && schema.includes("ALTER TABLE contract_signers ADD COLUMN IF NOT EXISTS documenso_recipient_id TEXT") && schema.includes("ALTER TABLE contract_signers ADD COLUMN IF NOT EXISTS documenso_signing_url TEXT") && schema.includes("ALTER TABLE documenso_signature_requests ADD COLUMN IF NOT EXISTS documenso_recipient_ids JSONB"));
ok("token security stores only hash and expiry", routes.includes('crypto.randomBytes(32).toString("base64url")') && routes.includes("signing_token_hash = ${hashSigningToken(token)}") && routes.includes("signing_token_expires_at = ${expires}") && !routes.includes("signing_token = ${token}"));
ok("public route pattern is consistent", signingFlow.includes("/sign/contracts/${encodeURIComponent(token)}") && app.includes('location.startsWith("/sign/contracts/")') && publicSigningPage.includes('/api/public/sign/contracts/${encodeURIComponent(token)}') && !publicSigningPage.includes('credentials: "include"') && routes.includes('app.get("/api/public/sign/contracts/:token"') && routes.includes('app.post("/api/public/sign/contracts/:token/complete"'));
