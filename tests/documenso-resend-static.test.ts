/**
 * Static regression checks for Documenso contract resend diagnostics/self-heal.
 * Run: npx tsx tests/documenso-resend-static.test.ts
 */
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const documenso = fs.readFileSync("server/services/documenso.ts", "utf8");
const hub = fs.readFileSync("client/src/pages/contractor-hub.tsx", "utf8");
function ok(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

ok("pending signer resend still calls Documenso redistribute", routes.includes("documensoResult = await resendDocumensoDocument(sigReq.documenso_document_id)"));
ok("signed signer resend is blocked before Documenso", routes.includes('if (signer.status === "signed") return res.status(400).json({ message: "Signed signers cannot be resent" })'));
ok("completed document resend is blocked with user-safe message", routes.includes('"This contract has already been completed."') && routes.includes("getDocumensoResendBlockReason(remote.status"));
ok("missing recipient id refreshes local metadata", routes.includes("refreshDocumensoContractRecipientMetadata") && routes.includes("documenso_recipient_id = COALESCE(${r.id}"));
ok("stale recipient id retries after refresh", routes.includes("retriedAfterRefresh = true") && routes.includes("documenso_recipient_refresh"));
ok("wrong email cannot be accepted as resent", routes.includes("linksByEmail.get(email)") && routes.includes("Recipient not found"));
ok("duplicate signer records are detected", routes.includes("duplicateEmails") && routes.includes("HAVING COUNT(*) > 1"));
ok("duplicate identity email mismatches are detected", routes.includes("possibleIdentityMismatches") && routes.includes("COUNT(DISTINCT lower(trim(email))) > 1"));
ok("actual Documenso errors are serialized", documenso.includes("serializeDocumensoError") && documenso.includes("httpStatus") && documenso.includes("responseBody") && documenso.includes("requestId"));
ok("Contractor Hub does not show generic recipient id present", !hub.includes("recipient id present") && hub.includes("Recipient missing remotely"));
