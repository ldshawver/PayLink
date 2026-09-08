/**
 * Static regression checks for the duplicate-signing-email defect: MyPayLink was asking Documenso
 * to send its native "Please sign" email (via sendDocumentForSignature -> /envelope/distribute) AND
 * separately sending its own SMTP "Please sign" email with the same subject to the same recipient.
 * Run: npx tsx tests/documenso-single-notification-static.test.ts
 */
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const documensoService = fs.readFileSync("server/services/documenso.ts", "utf8");

let passCount = 0;
function ok(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  passCount++;
  console.log(`PASS: ${name}`);
}

// ── Documenso's distribute call is what actually notifies recipients ───────
ok(
  "createDocumensoDocument still calls /envelope/distribute (the actual send that emails recipients)",
  documensoService.includes('"/envelope/distribute"') || documensoService.includes("/envelope/distribute")
);

// ── send-for-signature no longer also sends a MyPayLink "Please sign" email ────
{
  const sendForSigStart = routes.indexOf('app.post("/api/contractor-contracts/:id/send-for-signature"');
  const sendForSigEnd = routes.indexOf('app.post("/api/contractor-contracts/:id/replace-signing-request"');
  const sendForSigBody = routes.slice(sendForSigStart, sendForSigEnd);
  ok(
    "send-for-signature route no longer sends a second MyPayLink 'Please sign' email",
    sendForSigStart >= 0 && sendForSigEnd > sendForSigStart && !/sendGenericNotificationEmail\(\{\s*\n\s*recipientName:.*\n\s*email,\s*\n\s*title: `Please sign/.test(sendForSigBody)
  );
  ok(
    "send-for-signature still generates a MyPayLink public signing token/URL per recipient (kept for the post-sign redirect and in-app links, just not emailed separately)",
    sendForSigBody.includes("myPayLinkSigningUrl") && sendForSigBody.includes("buildContractSigningUrl")
  );
}

// ── replace-signing-request no longer also sends a MyPayLink "Please sign" email ──
{
  const replaceStart = routes.indexOf('app.post("/api/contractor-contracts/:id/replace-signing-request"');
  const replaceEnd = routes.indexOf("// ── Invoice: Download (JSON export)", replaceStart);
  const replaceBody = routes.slice(replaceStart, replaceEnd > 0 ? replaceEnd : replaceStart + 6000);
  ok(
    "replace-signing-request route no longer sends a second MyPayLink 'Please sign' email",
    replaceStart >= 0 && !/sendGenericNotificationEmail\(\{\s*\n\s*recipientName:.*\n\s*email,\s*\n\s*title: `Please sign/.test(replaceBody)
  );
}

// ── Exactly one "Please sign" subject template remains reachable from these two send paths ─
{
  const pleaseSignSubjectCount = (routes.match(/subject:\s*`Please sign: \$\{contract\.title\}`/g) || []).length;
  // Both send-for-signature and replace-signing-request still pass this subject to Documenso's
  // own meta.subject (used by its native email) — that's the one remaining "Please sign" send.
  ok(
    "exactly two call sites pass a 'Please sign' subject to Documenso (send + replace), matching the two legitimate distinct envelopes — no extra MyPayLink duplicate subject remains",
    pleaseSignSubjectCount === 2
  );
}

console.log(`\ndocumenso-single-notification-static.test.ts: ${passCount} checks passed.`);
