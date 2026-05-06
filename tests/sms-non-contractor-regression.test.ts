/**
 * Non-contractor SMS regression sweep.
 *
 * Reviewer (round 8) flagged: the new global /app/* URL allowlist in
 * sendViaTwilio could block legitimate non-contractor SMS templates if
 * any of them carry non-/app links. This test calls the real non-
 * contractor SMS helpers (sendApprovalReminderSms, sendScheduleSms-
 * Notification, sendShiftMarketplaceSms) with realistic payloads built
 * the same way server/routes.ts builds them today, and verifies that
 * the central guard ACCEPTS each one.
 *
 * Strategy (same as tests/sms-safety.test.ts): we do not mock twilio.
 * Instead we let the real send path attempt delivery with test creds
 * that Twilio rejects. The relevant assertion is *which* error comes
 * back:
 *   - "non-app URL"        => the guard blocked us (FAIL for + cases,
 *                             PASS for - cases)
 *   - any other error      => the guard passed and we reached Twilio
 *                             (PASS for + cases)
 *
 * If a future change reintroduces a non-/app URL into one of these
 * payloads (e.g. the recent "/attendance" -> "/app/attendance" fix),
 * this test fails loudly.
 *
 * Run: npx tsx tests/sms-non-contractor-regression.test.ts
 */
import "dotenv/config";
// Path-only fixture URLs use https://app.example.com — clear APP_BASE_URL
// so the host check is opt-in per assertion (round 11+ host-allowlist
// cases below set it explicitly and restore it afterward).
delete process.env.APP_BASE_URL;

let pass = 0;
let fail = 0;
const log = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  \u2713 ${name}`); }
  else    { fail++; console.error(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`); }
};

const isGuardBlock = (err: string | undefined) =>
  !!err && /non-app URL/i.test(err);

(async () => {
  console.log("=== non-contractor SMS guard regression sweep ===\n");

  // Force Twilio to "configured" with bogus creds so the guard runs and
  // any post-guard failure is a Twilio rejection (not "Twilio not configured").
  process.env.TWILIO_ACCOUNT_SID = "ACtestguardregression0000000000000000";
  process.env.TWILIO_AUTH_TOKEN = "tok-test-not-real";
  process.env.TWILIO_PHONE_NUMBER = "+15555550000";

  const {
    sendApprovalReminderSms,
    sendScheduleSmsNotification,
    sendShiftMarketplaceSms,
  } = await import("../server/notifications.js");

  // --- Approval reminder: post-fix path is /app/attendance ----------------
  const r1 = await sendApprovalReminderSms({
    recipientName: "Manager One",
    email: null,
    phone: "+15555551111",
    companyName: "Acme",
    pendingPunches: 2, pendingTimecards: 1, pendingAmendments: 0, pendingExpenses: 0,
    dashboardUrl: "https://app.example.com/app/attendance?tab=pending-approvals",
  });
  log(
    "approval-reminder /app/attendance URL is NOT blocked by guard",
    r1.sent === false && !isGuardBlock(r1.error),
    `result=${JSON.stringify(r1)}`,
  );

  // Pre-fix path: must be blocked
  const r1bad = await sendApprovalReminderSms({
    recipientName: "Manager One",
    email: null,
    phone: "+15555551111",
    companyName: "Acme",
    pendingPunches: 2, pendingTimecards: 0, pendingAmendments: 0, pendingExpenses: 0,
    dashboardUrl: "https://app.example.com/attendance?tab=pending-approvals",
  });
  log(
    "approval-reminder with pre-fix /attendance URL IS blocked by guard",
    r1bad.sent === false && isGuardBlock(r1bad.error),
    `result=${JSON.stringify(r1bad)}`,
  );

  // --- Schedule published: post-fix path is /app/schedule ----------------
  const r2 = await sendScheduleSmsNotification({
    workerName: "Worker A",
    email: null,
    phone: "+15555552222",
    companyName: "Acme",
    shifts: [{ date: "2026-05-10", startTime: "09:00", endTime: "17:00" }],
    scheduleViewUrl: "https://app.example.com/app/schedule",
  });
  log(
    "schedule-published /app/schedule URL is NOT blocked by guard",
    r2.sent === false && !isGuardBlock(r2.error),
    `result=${JSON.stringify(r2)}`,
  );

  const r2bad = await sendScheduleSmsNotification({
    workerName: "Worker A",
    email: null,
    phone: "+15555552222",
    companyName: "Acme",
    shifts: [{ date: "2026-05-10", startTime: "09:00", endTime: "17:00" }],
    scheduleViewUrl: "https://app.example.com/schedule",
  });
  log(
    "schedule-published with pre-fix /schedule URL IS blocked by guard",
    r2bad.sent === false && isGuardBlock(r2bad.error),
    `result=${JSON.stringify(r2bad)}`,
  );

  // --- Shift marketplace: routes.ts already passes /app/schedule URLs ----
  const r3 = await sendShiftMarketplaceSms({
    recipientName: "Worker B",
    email: null,
    phone: "+15555553333",
    subject: "New shift available",
    bodyText: "PayLink: open shift available. Claim: https://app.example.com/app/schedule?tab=marketplace",
  });
  log(
    "shift-marketplace /app/schedule URL is NOT blocked by guard",
    r3.sent === false && !isGuardBlock(r3.error),
    `result=${JSON.stringify(r3)}`,
  );

  // Negative: shift marketplace body with /api download link must be blocked
  const r3bad = await sendShiftMarketplaceSms({
    recipientName: "Worker B",
    email: null,
    phone: "+15555553333",
    subject: "Shift",
    bodyText: "PayLink: see attached. https://app.example.com/api/dam-documents/abc/download",
  });
  log(
    "shift-marketplace with /api download URL IS blocked by guard",
    r3bad.sent === false && isGuardBlock(r3bad.error),
    `result=${JSON.stringify(r3bad)}`,
  );

  // --- Host allowlist (round-11 hardening) -------------------------------
  // When APP_BASE_URL is set, the guard rejects /app/* URLs whose host is
  // not in the allowlist (anti-spoofing). When APP_BASE_URL is unset, host
  // is not enforced (covered by the prior assertions above using
  // app.example.com without APP_BASE_URL configured).
  const prevBase = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = "https://paylink.example.com";

  const r4 = await sendShiftMarketplaceSms({
    recipientName: "Worker C",
    email: null,
    phone: "+15555554444",
    subject: "Match",
    bodyText: "PayLink: claim shift at https://paylink.example.com/app/schedule?tab=marketplace",
  });
  log(
    "host-allowlist: matching APP_BASE_URL host passes the guard",
    r4.sent === false && !isGuardBlock(r4.error),
    `result=${JSON.stringify(r4)}`,
  );

  const r5 = await sendShiftMarketplaceSms({
    recipientName: "Worker C",
    email: null,
    phone: "+15555554444",
    subject: "Phish",
    bodyText: "PayLink: claim shift at https://attacker.example.com/app/schedule?tab=marketplace",
  });
  log(
    "host-allowlist: spoofed host with /app/* path IS blocked",
    r5.sent === false && /outside the PayLink domain/i.test(r5.error || ""),
    `result=${JSON.stringify(r5)}`,
  );

  if (prevBase === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = prevBase;

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("Fatal:", e); process.exit(1); });
