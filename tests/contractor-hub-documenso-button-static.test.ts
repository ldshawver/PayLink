/**
 * Static regression checks for Contractor Hub Documenso button visibility.
 * Run: npx tsx tests/contractor-hub-documenso-button-static.test.ts
 */
import fs from "node:fs";

const page = fs.readFileSync("client/src/pages/contractor-hub.tsx", "utf8");
const policy = fs.readFileSync("client/src/lib/contractSignatureActions.ts", "utf8");
function ok(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

ok("Documenso button uses explicit visibility gate", page.includes("const canSendViaDocumenso = canShowSignatureActions"));
ok("Documenso button is not hidden only because signer list is empty", page.includes("{canSendViaDocumenso && (") && !page.includes("isAdmin && signers.length > 0 && ![\"void\",\"terminated\",\"completed\",\"fully_signed\"]"));
ok("Documenso button explains missing signer requirement", page.includes("getDocumensoDisabledReason") && policy.includes("Add at least one signer with an email before sending."));
ok("Documenso button remains disabled until signer requirement is met", page.includes("disabled={sendViaDocumensoMutation.isPending || !!documensoDisabledReason}"));
ok("Documenso button label says Send via Documenso", page.includes('"Send via Documenso"'));
ok("Internal signing button label says Sign Internally", page.includes("Sign Internally"));
ok("Signature actions support draft pending awaiting signatures", policy.includes('["draft", "pending", "awaiting_signatures", "sent", "partially_signed"]'));

console.log("\nContractor Hub Documenso button checks passed.");
