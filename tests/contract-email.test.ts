/**
 * Contract email helpers — proves sendContractEventEmail and
 * sendGenericNotificationEmail actually invoke the SMTP transporter
 * (regression guard: getTransporter() is async and was previously
 * called without `await`, which silently broke every send).
 *
 * Run: npx tsx tests/contract-email.test.ts
 */
import "dotenv/config";
import nodemailer from "nodemailer";

let pass = 0;
let fail = 0;
const log = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  \u2713 ${name}`); }
  else    { fail++; console.error(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`); }
};

(async () => {
  console.log("=== Contract Email Send Tests ===\n");

  // Force env-fallback path in getTransporter so it doesn't depend on DB SMTP config.
  process.env.SMTP_HOST = "smtp.test.invalid";
  process.env.SMTP_USER = "test@example.com";
  process.env.SMTP_PASS = "secret";
  process.env.SMTP_FROM = "noreply@example.com";

  // Mock nodemailer.createTransport so we can capture sendMail calls.
  const sentMessages: any[] = [];
  const fakeTransporter = {
    sendMail: async (opts: any) => { sentMessages.push(opts); return { messageId: "mock-id" }; },
  };
  const originalCreate = nodemailer.createTransport;
  (nodemailer as any).createTransport = () => fakeTransporter;

  try {
    const { sendContractEventEmail, sendGenericNotificationEmail } = await import("../server/notifications");

    // sendContractEventEmail must await the transporter and call sendMail
    const r1 = await sendContractEventEmail({
      event: "contract_signed",
      recipientName: "Alice",
      email: "alice@example.com",
      contractTitle: "Test Contract",
      entityId: "evt-1",
      entityType: "contract",
      amount: 250,
      actionUrl: "https://app.example.com/app/contractor-hub",
    });
    log("sendContractEventEmail returns sent=true", r1.sent === true, `error=${r1.error}`);
    log(
      "sendContractEventEmail invoked transporter.sendMail",
      sentMessages.length === 1 && sentMessages[0].to === "alice@example.com",
      `sentMessages=${JSON.stringify(sentMessages.map(m => m.to))}`
    );

    // sendGenericNotificationEmail must await the transporter and call sendMail
    const r2 = await sendGenericNotificationEmail({
      recipientName: "Bob",
      email: "bob@example.com",
      title: "Heads up",
      body: "This is a test notification body.",
      actionUrl: "https://app.example.com/app/contractor-hub",
    });
    log("sendGenericNotificationEmail returns sent=true", r2.sent === true, `error=${r2.error}`);
    log(
      "sendGenericNotificationEmail invoked transporter.sendMail",
      sentMessages.length === 2 && sentMessages[1].to === "bob@example.com",
      `sentMessages=${JSON.stringify(sentMessages.map(m => m.to))}`
    );

    // Regression: missing email recipient should short-circuit, not call sendMail
    const before = sentMessages.length;
    const r3 = await sendContractEventEmail({
      event: "contract_signed",
      recipientName: "Nobody",
      email: null,
      contractTitle: "No Email",
      entityId: "evt-2",
      entityType: "contract",
    });
    log(
      "sendContractEventEmail short-circuits with no email",
      r3.sent === false && sentMessages.length === before,
      `error=${r3.error} delta=${sentMessages.length - before}`
    );
  } finally {
    (nodemailer as any).createTransport = originalCreate;
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("Fatal:", e); process.exit(1); });
