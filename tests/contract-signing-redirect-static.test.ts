/**
 * Static regression checks for MyPayLink contractor contract signing completion routes.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildContractDocumensoReturnUrl } from "../server/contract-signing-flow";
import { confirmationMessage, stateMessage } from "../client/src/pages/contractor-contract-signing";

const app = fs.readFileSync("client/src/App.tsx", "utf8");
const signingPage = fs.readFileSync("client/src/pages/contractor-contract-signing.tsx", "utf8");
const publicSigningPage = fs.readFileSync("client/src/pages/contract-signing.tsx", "utf8");
const routes = fs.readFileSync("server/routes.ts", "utf8");
const serverIndex = fs.readFileSync("server/index.ts", "utf8");

assert(app.includes('path="/app/contractor-hub/contracts/:id/sign"') && app.includes("ContractorContractSigningPage"), "authenticated contractor signing route renders dedicated page");
assert(routes.includes('app.get("/api/contractor-contracts/:id/signing-status"'), "completed signer redirect/status route exists");
assert.equal(confirmationMessage("partially_signed"), "Your signature was submitted. Waiting for other signer(s).", "waiting-for-others confirmation displays correctly");
assert.equal(confirmationMessage("fully_signed"), "Contract fully signed.", "fully-signed confirmation displays correctly");
assert(signingPage.includes("We could not find this contract.") && signingPage.includes("contract-signing-friendly-not-found"), "invalid contract ID renders friendly not-found page");
assert.equal(stateMessage("pending_signature"), "This contract is ready for your signature.", "pending signature state displays correctly");
assert.equal(stateMessage("already_signed"), "You already signed this contract. Waiting for other signer(s).", "already signed state displays correctly");
assert.equal(stateMessage("expired_or_canceled"), "This signing link is expired or no longer active. Please request a new signing link.", "expired/canceled state displays correctly");
assert.equal(stateMessage("not_authorized"), "You do not have access to this contract.", "not authorized state displays correctly");
assert(routes.includes("malformed_contract_id") && routes.includes("missing_contract") && routes.includes("not_authorized") && routes.includes("expired_or_canceled"), "signing status endpoint returns controlled states instead of raw 404/403");
assert(app.includes("returnTo=") && app.includes("encodeURIComponent(returnTo)") && signingPage.includes("This contract is ready for your signature."), "unauthenticated deep links preserve return URL and signing page shows ready state");
assert(serverIndex.includes('"/app"') && serverIndex.includes('"/sign"'), "server SPA fallback includes app signing and public token deep links");
assert(app.includes('location.startsWith("/sign/contracts/")') && publicSigningPage.includes('location.includes("/status")'), "frontend router handles public signing token and status routes");
const signingToken = "signer-token-not-contract-uuid";
const documensoReturnUrl = buildContractDocumensoReturnUrl("https://app.mypaylink.app/", signingToken);
assert.equal(documensoReturnUrl, "https://app.mypaylink.app/sign/contracts/signer-token-not-contract-uuid/status", "Documenso return URL targets public MyPayLink signing status route");
assert(!documensoReturnUrl.includes("/app/contractor-hub/contracts/") && !documensoReturnUrl.endsWith("/sign"), "generated Documenso return URL does not target the old authenticated signing route");
assert(routes.includes("status IN ('pending','sent','viewed','unsent','draft')") && routes.includes("COALESCE(is_required, TRUE) = TRUE"), "completion keeps pending signers pending and fully signs only after active required signers complete");
assert(routes.includes("WHERE id = ${contract.id} AND status NOT IN ('active','completed','void','terminated')"), "Documenso webhook remains idempotent for already completed contracts (atomic WHERE guard against replay)");
assert(routes.includes("newStatus === \"fully_signed\" && contractData?.proposal_id"), "invoice creation remains gated to fully signed contracts");

console.log("PASS: contractor signing redirect static checks passed");
