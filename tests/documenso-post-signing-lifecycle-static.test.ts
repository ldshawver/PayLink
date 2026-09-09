/**
 * Static regression checks for the Documenso post-signing lifecycle work.
 *
 * Covers:
 *  - the public return/status page is never blank and shows "You have signed this document",
 *    the remaining-signer roster, the fully-signed state, and a signed-document link;
 *  - the public status API returns a real signer roster (real signers only), remaining count,
 *    viewerSigned, and a token-scoped completed-document URL;
 *  - pull-sync (syncDocumensoContractStatus) updates signer + contract status forward-only,
 *    ignores email-less placeholder signers for completion, records signing_last_synced_at,
 *    and converges completion via the same activateContractAfterVerifiedCompletion transition;
 *  - the admin contract GET triggers a safe reconcile, and there is an admin "Refresh status"
 *    endpoint + button;
 *  - a ~15-minute periodic reconcile loop exists and is webhook-independent;
 *  - the fully-signed contract is emailed to every real signer exactly once, gated on
 *    contractor_contracts.signed_contract_emailed_at (claimed atomically);
 *  - the auth whitelist actually reaches the Documenso webhook + public signing routes;
 *  - the Documenso webhook no longer treats a single recipient.signed event as completion;
 *  - existing idempotency guards and tenant/company/public-token scoping are preserved.
 *
 * Run: npx tsx tests/documenso-post-signing-lifecycle-static.test.ts
 */
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const index = fs.readFileSync("server/index.ts", "utf8");
const page = fs.readFileSync("client/src/pages/contract-signing.tsx", "utf8");
const hub = fs.readFileSync("client/src/pages/contractor-hub.tsx", "utf8");
const notifications = fs.readFileSync("server/notifications.ts", "utf8");
const migration = fs.readFileSync("migrations/0024_documenso_post_signing_lifecycle.sql", "utf8");

let passCount = 0;
function ok(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  passCount++;
  console.log(`PASS: ${name}`);
}

// ── Migration / schema (additive only) ───────────────────────────────────────
ok("migration adds contract_signers.viewed_at / declined_at",
  /ADD COLUMN IF NOT EXISTS viewed_at/.test(migration) && /ADD COLUMN IF NOT EXISTS declined_at/.test(migration));
ok("migration adds contractor_contracts.signed_contract_emailed_at",
  /ADD COLUMN IF NOT EXISTS signed_contract_emailed_at/.test(migration));
ok("migration is additive only (no DROP TABLE / DELETE outside the disposable-only rollback block)",
  !/^\s*(DROP TABLE|DELETE FROM)/im.test(migration.split("ROLLBACK")[0]));
ok("boot DDL adds the same columns via ADD COLUMN IF NOT EXISTS",
  index.includes("contract_signers.viewed_at") && index.includes("contractor_contracts.signed_contract_emailed_at") && index.includes("contractor_contracts.signing_last_synced_at"));

// ── Auth whitelist actually reaches the webhook + public signing routes ───────
ok("webhook whitelist entry uses the mount-stripped path (/webhooks/documenso, not /api/webhooks/documenso)",
  routes.includes('req.path === "/webhooks/documenso"') && !routes.includes('req.path === "/api/webhooks/documenso"'));
ok("public signing routes are exempted from the requireAuth gate (exact prefixes only)",
  routes.includes('req.path.startsWith("/signing/contracts/")') && routes.includes('req.path.startsWith("/public/sign/contracts/")'));
ok("the exemption stays narrow — not the broad /public/ or /signing/ namespace",
  !/req\.path\.startsWith\("\/public\/"\)/.test(routes) && !/req\.path\.startsWith\("\/signing\/"\)/.test(routes));

// ── Webhook: a single recipient.signed event is NOT document completion ───────
ok("webhook completion is document-level only (recipient.signed no longer forces completion)",
  routes.includes('const completed = status === "completed" || /document\\.(completed|signed)/i.test(eventType);') &&
  !/\/recipient\.\*signed\|document\.\*completed/.test(routes));
ok("webhook still delegates per-signer + completion reconciliation to syncDocumensoContractStatus",
  /const completed = status === "completed" \|\| \/document\\\.\(completed\|signed\)\/i\.test\(eventType\);\s*\n\s*await syncDocumensoContractStatus\(contractSig\.related_record_id\)/.test(routes));

// ── Pull-sync: forward-only per-signer transitions ───────────────────────────
ok("per-signer sync never regresses a terminal signer",
  routes.includes("AND status NOT IN ('signed','declined','canceled','cancelled','voided','replaced','expired')"));
ok("per-signer sync only advances pending/sent -> viewed -> signed (or applies declined/canceled)",
  routes.includes("${status} IN ('signed','declined','canceled')") &&
  routes.includes("(${status} = 'viewed' AND status IN ('pending','sent','unsent','draft'))"));
ok("per-signer sync records viewed_at / declined_at",
  routes.includes("viewed_at = CASE WHEN ${status} IN ('viewed','signed') THEN COALESCE(viewed_at, NOW())") &&
  routes.includes("declined_at = CASE WHEN ${status} = 'declined' THEN COALESCE(declined_at, NOW())"));

// ── Pull-sync: ignore email-less placeholder signers for completion ──────────
ok("completion counts exclude email-less, non-recipient-mapped placeholder signers",
  routes.includes("(email IS NOT NULL OR documenso_recipient_id IS NOT NULL) AND status = 'signed') AS signed_required") &&
  routes.includes("(email IS NOT NULL OR documenso_recipient_id IS NOT NULL) AND status NOT IN ('canceled','cancelled','expired','declined','replaced','voided')) AS active_required"));

// ── Pull-sync: convergence + observability ───────────────────────────────────
ok("sync records signing_last_synced_at",
  routes.includes("UPDATE contractor_contracts SET signing_last_synced_at = NOW() WHERE id = ${contractId}"));
ok("sync converges completion via activateContractAfterVerifiedCompletion",
  /if \(effectiveStatus === "fully_signed"\) \{\s*\n\s*const activated = await activateContractAfterVerifiedCompletion\(contractId, "reconciliation"\)/.test(routes));
ok("activateContractAfterVerifiedCompletion is still idempotent (only matches a 'fully_signed' row)",
  routes.includes("WHERE id = ${contractId} AND status = 'fully_signed'"));
ok("exactly-once auto-invoice on completion is preserved",
  /activateContractAfterVerifiedCompletion[\s\S]{0,600}autoCreateContractInvoiceExactlyOnce\(activated\.id\)/.test(routes));

// ── Admin contract GET triggers a safe reconcile ────────────────────────────
ok("admin contract GET reconciles Documenso-backed non-terminal contracts before returning",
  /app\.get\("\/api\/contractor-contracts\/:id",[\s\S]{0,4000}\["sent", "partially_signed", "fully_signed"\]\.includes\(String\(contract\.status\)\)[\s\S]{0,300}syncDocumensoContractStatus\(req\.params\.id\)/.test(routes));
ok("admin reconcile endpoint exists, is admin/manager gated, and is company-scoped",
  routes.includes('app.post("/api/contractor-contracts/:id/reconcile-signing", requireAuth, requireRole("admin", "manager")') &&
  /reconcile-signing[\s\S]{0,400}assertContractCompanyAccess\(req\.params\.id/.test(routes));
ok("admin reconcile endpoint does not create envelopes / rotate tokens (status sync only)",
  /reconcile-signing[\s\S]{0,600}syncDocumensoContractStatus\(req\.params\.id\)/.test(routes) &&
  !/reconcile-signing[\s\S]{0,600}(sendDocumentForSignature|resendDocumensoDocument|crypto\.randomBytes)/.test(routes));

// ── Periodic, webhook-independent reconcile loop (~15 min) ──────────────────
ok("a Documenso reconcile loop exists and runs every 15 minutes",
  routes.includes("runDocumensoSigningReconcile") && routes.includes("setInterval(runDocumensoSigningReconcile, 15 * 60 * 1000)"));
ok("the reconcile loop only scans non-terminal contracts with an active Documenso envelope",
  /runDocumensoSigningReconcile[\s\S]{0,1200}cc\.status IN \('sent', 'partially_signed', 'fully_signed'\)[\s\S]{0,600}documenso_document_id IS NOT NULL/.test(routes));

// ── Signed-contract email, exactly once, real signers only ──────────────────
ok("emailSignedContractToAllSigners claims signed_contract_emailed_at atomically (exactly once)",
  routes.includes("UPDATE contractor_contracts SET signed_contract_emailed_at = NOW(), updated_at = NOW()") &&
  routes.includes("WHERE id = ${contractId} AND signed_contract_emailed_at IS NULL"));
ok("signed-contract email targets only real, signed signers (email present, required)",
  /SELECT DISTINCT ON \(lower\(trim\(email\)\)\) name, email\s*\n\s*FROM contract_signers\s*\n\s*WHERE contract_id = \$\{contractId\}\s*\n\s*AND email IS NOT NULL\s*\n\s*AND status = 'signed'\s*\n\s*AND COALESCE\(is_required, TRUE\) = TRUE/.test(routes));
ok("total send failure releases the claim so a later reconcile retries; partial success keeps it",
  /if \(sent === 0 && signerRows\.length > 0\) \{[\s\S]{0,300}signed_contract_emailed_at = NULL/.test(routes));
ok("signed-contract email is triggered from both activation and reconcile",
  routes.includes('emailSignedContractToAllSigners(contractId, `activate:${source}`)') &&
  /\["fully_signed", "active", "completed"\]\.includes\(effectiveStatus\)[\s\S]{0,200}emailSignedContractToAllSigners\(contractId, "reconciliation"\)/.test(routes));
ok("notifications exports sendSignedContractEmail with a PDF attachment",
  notifications.includes("export async function sendSignedContractEmail") &&
  /attachments: \[\{ filename: attachmentFileName, content: attachmentBuffer, contentType: "application\/pdf" \}\]/.test(notifications));

// ── Public status API payload ──────────────────────────────────────────────
ok("public status API returns a real-signer roster + remaining + viewerSigned",
  routes.includes("signers: roster,") && routes.includes("remainingSigners,") && routes.includes("viewerSigned,"));
ok("public roster excludes email-less placeholder + inactive rows",
  /rosterRows[\s\S]{0,400}COALESCE\(is_required, TRUE\) = TRUE[\s\S]{0,120}\(email IS NOT NULL OR documenso_recipient_id IS NOT NULL\)[\s\S]{0,120}status NOT IN \('replaced','void'\)/.test(routes));
ok("public roster labels never leak a raw email (name, else masked)",
  routes.includes("return maskAuditEmail(s.email) || \"A signer\";"));
ok("completed-document URL is token-scoped and only exposed when fully signed",
  routes.includes('`/api/public/sign/contracts/${encodeURIComponent(req.params.token)}/document`') &&
  routes.includes('const completedDocumentUrl = state === "fully_signed"'));
ok("public signed-document route validates token + requires a completed contract",
  routes.includes('app.get("/api/public/sign/contracts/:token/document", getPublicSignedContractDocument)') &&
  /getPublicSignedContractDocument[\s\S]{0,2500}\["fully_signed", "completed", "active"\]\.includes\(String\(row\.contract_status\)\)/.test(routes));
ok("public token lookups stay tenant/company scoped",
  routes.includes("JOIN contractor_contracts cc ON cc.id = cs.contract_id AND cc.company_id = cs.company_id"));

// ── Public return page: never blank, correct messaging ──────────────────────
ok("return page renders 'You have signed this document'", page.includes("You have signed this document"));
ok("return page renders a fully-signed state with a signed-document button",
  page.includes("This document is fully signed") && page.includes('data-testid="button-open-signed-document"'));
ok("return page renders the signer roster (who signed / who is awaited)",
  page.includes("function SignerRoster") && page.includes('data-testid="public-contract-signer-roster"') && page.includes("Awaiting signature"));
ok("a post-signing return error shows a recoverable 'confirming' state, never a blank / scary error",
  /isPostDocumensoReturn && \(error\.status === undefined \|\| error\.status >= 500[\s\S]{0,400}Signature received/.test(page));
ok("return page briefly polls on the /status return until fully signed",
  page.includes("refetchInterval:") && page.includes('data.state !== "fully_signed"'));
ok("return page still fetches the PUBLIC endpoint without session cookies",
  page.includes("/api/public/sign/contracts/${encodeURIComponent(token)}") && !page.includes('credentials: "include"'));
// Preserved states relied on by tests/public-contract-signing-static.test.ts
ok("return page keeps the friendly invalid / expired / already-signed / fully-signed / unavailable titles",
  ["Invalid signing link", "Signing link expired", "Already signed", "Contract fully signed", "Signing service unavailable"].every(s => page.includes(s)));

// ── Admin UI: signer-level status + refresh ─────────────────────────────────
ok("admin Documenso panel shows per-signer status (not just the contract-level 'sent')",
  hub.includes('data-testid={`documenso-signer-status-${s.id}`}') && hub.includes("{s.status}"));
ok("admin panel has a 'Refresh status' control wired to the reconcile endpoint",
  hub.includes("reconcileSigningMutation") &&
  hub.includes("/api/contractor-contracts/${contract.id}/reconcile-signing") &&
  hub.includes('data-testid="btn-refresh-signing-status"'));

console.log(`\n${passCount} checks passed.`);
