import assert from "node:assert/strict";
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const migration = fs.readFileSync("migrations/0012_documenso_sent_at_repair.sql", "utf8");
const index = fs.readFileSync("server/index.ts", "utf8");
const signingFlow = fs.readFileSync("server/contract-signing-flow.ts", "utf8");
const app = fs.readFileSync("client/src/App.tsx", "utf8");
const page = fs.readFileSync("client/src/pages/contract-signing.tsx", "utf8");
const smoke = fs.readFileSync("scripts/verify_documenso_signing.sh", "utf8");

assert(migration.includes("ALTER TABLE documenso_signature_requests") && migration.includes("ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ"), "migration repairs documenso_signature_requests.sent_at");
assert(migration.includes("ALTER TABLE contract_signers") && migration.includes("ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ"), "migration repairs contract_signers.sent_at");
assert(index.includes("documenso_signature_requests.sent_at") && index.includes("contract_signers.sent_at"), "startup schema repair adds missing sent_at columns");
assert(routes.includes("existingReqRes") && routes.includes("reusedExistingDocumensoRequest") && routes.includes("getDocumensoDocument(existingReq.documenso_document_id)"), "send path reuses existing Documenso request/document instead of blindly sending again");
assert(routes.includes("externalSendSucceeded") && routes.includes("Documenso send succeeded but local signature request persistence failed") && routes.includes("Please do not resend until this is reviewed"), "partial external success returns safe recovery message instead of generic 500");
assert(routes.includes("ON CONFLICT DO NOTHING"), "local Documenso request persistence is duplicate-tolerant");
assert(signingFlow.includes("/sign/contracts/${encodeURIComponent(tokenOrContractId)}/status"), "Documenso return URL uses public signing status route");
assert(app.includes('location.startsWith("/sign/contracts/")'), "SPA handles public signing route prefix");
assert(page.includes('location.includes("/status")') && page.includes("Signature received. We are confirming completion."), "post-sign status route renders friendly pending confirmation");
assert(page.includes("You already signed this contract. Waiting for other signer(s).") || routes.includes("You already signed this contract. Waiting for other signer(s)."), "already-signed state has required message");
assert(page.includes("Contract fully signed") || routes.includes("Contract fully signed."), "fully-signed state has required message");
assert(smoke.includes("/sign/contracts/test-invalid") && smoke.includes("raw/default 404-like page detected"), "smoke script verifies public sign route never serves raw 404");

console.log("Documenso incident static checks passed");
