/**
 * Focused SMS safety tests — verify the central allowlist guard in
 * sendViaTwilio rejects any SMS body containing a non-`/app/` URL.
 *
 * Policy: an SMS may only carry in-app review links (paths starting with
 * /app/). Direct download endpoints (/uploads/..., /api/dam-documents/...,
 * raw API routes) and document file extensions must always be blocked.
 */
import "dotenv/config";
// These tests use https://app.example.com/... fixture URLs to exercise the
// path-only allowlist. Unset APP_BASE_URL so the host check (which is
// covered separately in tests/sms-non-contractor-regression.test.ts) does
// not reject the fixture host.
delete process.env.APP_BASE_URL;
import { sendViaTwilio, sendContractEventSms } from "../server/notifications";

let pass = 0;
let fail = 0;
const log = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else    { fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

async function expectBlocked(label: string, body: string) {
  try {
    await sendViaTwilio("+15555550100", body);
    log(label, false, "expected block but call resolved");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // We accept either an SMS-blocked rejection OR a Twilio-not-configured
    // error iff our guard never ran — but the guard runs FIRST, so any pass
    // through to "Twilio not configured" means the guard accepted the body.
    if (msg.startsWith("SMS blocked")) log(label, true);
    else log(label, false, `wrong rejection: ${msg}`);
  }
}

async function expectAllowed(label: string, body: string) {
  try {
    await sendViaTwilio("+15555550100", body);
    // If credentials happen to be set we'd actually send — treat as pass.
    log(label, true);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("SMS blocked")) log(label, false, `unexpectedly blocked: ${msg}`);
    else log(label, true); // e.g. "Twilio not configured" — guard let it through
  }
}

(async () => {
  console.log("=== SMS Safety Guard Tests ===\n");

  console.log("[1] Blocks direct /uploads URLs");
  await expectBlocked("absolute /uploads URL",     "Doc: https://app.example.com/uploads/x.pdf");
  await expectBlocked("relative /uploads path",    "See file at /uploads/proposal.pdf");

  console.log("\n[2] Blocks direct /api download endpoints");
  await expectBlocked("dam-documents download",    "Download: https://app.example.com/api/dam-documents/abc123/download");
  await expectBlocked("raw /api path",             "Hit /api/contractor-proposals/abc/pdf for PDF");

  console.log("\n[3] Allows bare extension words in prose (policy was narrowed)");
  // The original guard blocked any .pdf/.docx/.xlsx token in arbitrary text,
  // which produced false positives on legitimate SMS bodies (e.g. "your
  // invoice.pdf is ready" with a separate /app/* link). Document leakage is
  // now policed at the URL level (host + /app/* path) instead. These two
  // bodies must therefore be allowed because they carry no URL at all.
  await expectAllowed("naked .pdf reference (no URL)", "Open contract.pdf to review");
  await expectAllowed(".docx reference (no URL)",      "See agreement.docx");

  console.log("\n[4] Blocks non-/app/ URLs even on the same host");
  await expectBlocked("/admin URL",                "Visit https://app.example.com/admin/proposals/123");
  await expectBlocked("bare host URL",             "Go to https://app.example.com to review");

  console.log("\n[5] Allows /app/ in-app review links");
  await expectAllowed("/app/contractor-hub URL",   "Review: https://app.example.com/app/contractor-hub?section=proposals&id=abc");
  await expectAllowed("plain text, no URL",        "Your proposal has been approved.");

  console.log("\n[6] sendContractEventSms routes through sendViaTwilio guard");
  // A contract-event SMS that contains a non-/app URL must be blocked by the
  // central guard rather than slipped through a direct Twilio call path.
  const blockedRes = await sendContractEventSms({
    event: "contract_signed",
    phone: "+15555550100",
    recipientName: "Test",
    contractTitle: "Bad URL Contract",
    email: "test@example.com",
    entityId: "test-id-1",
    entityType: "contract",
    actionUrl: "https://app.example.com/api/dam-documents/xyz/download",
  });
  log(
    "contract event SMS with /api download URL is blocked",
    blockedRes.sent === false && /SMS blocked/i.test(blockedRes.error || ""),
    `got sent=${blockedRes.sent} error=${blockedRes.error}`,
  );
  // An /app/ URL should pass the guard (will fail later only if Twilio not configured).
  const allowedRes = await sendContractEventSms({
    event: "contract_signed",
    phone: "+15555550100",
    recipientName: "Test",
    contractTitle: "Good URL Contract",
    email: "test@example.com",
    entityId: "test-id-2",
    entityType: "contract",
    actionUrl: "https://app.example.com/app/contractor-hub?section=contracts&id=abc",
  });
  log(
    "contract event SMS with /app URL is NOT blocked by guard",
    !(allowedRes.error || "").startsWith("SMS blocked"),
    `error=${allowedRes.error}`,
  );

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
