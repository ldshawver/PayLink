/**
 * Static wiring checks for the contractor/profile/proposal identity fix.
 * These are deliberately supplementary to tests/contractor-proposal-identity.test.ts
 * (which exercises the real reconciliation logic behaviorally) — on their
 * own, source-string assertions can't prove the logic is correct, only that
 * routes.ts hasn't silently stopped calling it. See AGENTS.md guidance:
 * static assertions alone are not sufficient for identity/authorization
 * behavior, so they are paired with real behavioral coverage, not used
 * instead of it.
 *
 * Run: npx tsx tests/contractor-proposal-identity-wiring-static.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const routesSrc = fs.readFileSync("server/routes.ts", "utf8");

let pass = 0;
let fail = 0;
function ok(name: string, result: boolean) {
  if (result) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("Proposal creation reconciliation");
ok(
  "POST /api/contractor-proposals calls reconcileProposalContractor",
  /app\.post\("\/api\/contractor-proposals",[\s\S]{0,1500}?reconcileProposalContractor\(/.test(routesSrc),
);
ok(
  "the client-supplied companyId is threaded into the reconciliation call (not ignored)",
  /reconcileProposalContractor\(req\.body\.contractorId, req\.body\.companyId, targetWorker\)/.test(routesSrc),
);

console.log("\nContract signer identity");
ok(
  "addContractSigner calls resolveContractorSignerIdentity for the contractor role",
  /signerRole === "contractor"[\s\S]{0,500}?resolveContractorSignerIdentity\(/.test(routesSrc),
);
ok(
  "GET /api/contractor-contracts/:id projects contractor_email",
  /COALESCE\(w\.email, w\.work_email\) AS contractor_email FROM contractor_contracts cc LEFT JOIN workers w ON w\.id = cc\.contractor_id WHERE cc\.id = \$\{req\.params\.id\}/.test(routesSrc),
);

console.log("\nToken hygiene");
ok(
  "POST /send no longer echoes the raw shareToken in its response",
  /res\.json\(\{ message: "Proposal marked as sent", emailStatus \}\)/.test(routesSrc) &&
    !/res\.json\(\{ message: "Proposal marked as sent", shareToken, emailStatus \}\)/.test(routesSrc),
);
ok(
  "the dedicated /share-token endpoint (the legitimate way to fetch it) is untouched",
  /res\.json\(\{ shareToken \}\)/.test(routesSrc),
);
{
  const sendHandlerMatch = routesSrc.match(/app\.post\("\/api\/contractor-proposals\/:id\/send",[\s\S]*?\n {2}\}\);/);
  ok("the /send handler exists", !!sendHandlerMatch);
  if (sendHandlerMatch) {
    const body = sendHandlerMatch[0];
    ok("every Portal: note construction in /send is passed through redactDiagnosticText", (body.match(/Portal: \$\{redactDiagnosticText\(portalUrl\)\}/g) || []).length === 4);
    ok("no raw, unredacted Portal: ${portalUrl} remains in /send", !/Portal: \$\{portalUrl\}/.test(body));
    ok("the status transition is gated to pre-send statuses only (duplicate-send guard)", /WHERE id = \$\{req\.params\.id\} AND status = ANY\(\$\{PRE_SEND_STATUSES\}\)/.test(body));
    ok("a no-op transition (already sent) short-circuits before emailing/logging", /if \(!transitionResult\.rowCount\)/.test(body));
  }
}
{
  const resendHandlerMatch = routesSrc.match(/app\.post\("\/api\/contractor-proposals\/:id\/resend-email",[\s\S]*?\n {2}\}\);/);
  ok("the /resend-email handler exists", !!resendHandlerMatch);
  if (resendHandlerMatch) {
    const body = resendHandlerMatch[0];
    ok("every Portal: note construction in /resend-email is passed through redactDiagnosticText", (body.match(/Portal: \$\{redactDiagnosticText\(portalUrl\)\}/g) || []).length === 4);
    ok("no raw, unredacted Portal: ${portalUrl} remains in /resend-email", !/Portal: \$\{portalUrl\}/.test(body));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
