/**
 * Regression test for the convert-to-contract email path.
 *
 * Proves that POST /api/contractor-proposals/:id/convert-to-contract
 * triggers a contractor email by exercising the extracted helper
 * sendConvertToContractEmail with a real DB worker row and a mocked
 * nodemailer transporter (asserts the recipient + subject + action URL
 * on the captured payload).
 *
 * Run: npx tsx tests/contract-conversion-email.test.ts
 */
import "dotenv/config";
import nodemailer, { type SendMailOptions, type SentMessageInfo } from "nodemailer";
import { sql } from "drizzle-orm";

let pass = 0;
let fail = 0;
const log = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  \u2713 ${name}`); }
  else    { fail++; console.error(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`); }
};

type CreateTransport = typeof nodemailer.createTransport;
type WritableNodemailer = { createTransport: CreateTransport };
const nm = nodemailer as unknown as WritableNodemailer;

(async () => {
  console.log("=== convert-to-contract email regression ===\n");

  process.env.SMTP_HOST = "smtp.test.invalid";
  process.env.SMTP_USER = "test@example.com";
  process.env.SMTP_PASS = "secret";
  process.env.SMTP_FROM = "noreply@example.com";

  const sentMessages: SendMailOptions[] = [];
  const fakeTransporter = {
    sendMail: async (opts: SendMailOptions): Promise<SentMessageInfo> => {
      sentMessages.push(opts);
      return { messageId: "mock-id" } as SentMessageInfo;
    },
  };
  const originalCreate = nodemailer.createTransport;
  nm.createTransport = (() => fakeTransporter) as unknown as CreateTransport;

  const cleanup: Array<() => Promise<unknown>> = [];
  try {
    const { db } = await import("../server/db.js");
    const { sendConvertToContractEmail } = await import("../server/contractor-conversion-email.js");

    // Spin up a throwaway company + contractor worker so the helper's lookup
    // returns a real row owned by this test (no leakage into other tenants).
    const stamp = Date.now().toString();
    const companyRes = await db.execute(sql`
      INSERT INTO companies (name) VALUES (${"ConvEmailTest " + stamp}) RETURNING id
    `);
    const companyId = (companyRes.rows[0] as { id: string }).id;
    cleanup.push(() => db.execute(sql`DELETE FROM companies WHERE id = ${companyId}`));
    const workerRes = await db.execute(sql`
      INSERT INTO workers (company_id, first_name, last_name, work_email, worker_type)
      VALUES (${companyId}, 'Conversion', 'Probe', 'conv-probe@example.com', 'contractor')
      RETURNING id
    `);
    const workerId = (workerRes.rows[0] as { id: string }).id;
    cleanup.push(() => db.execute(sql`DELETE FROM workers WHERE id = ${workerId}`));

    // 1. Helper sends an email when the contractor has a resolvable address.
    const ok = await sendConvertToContractEmail(db, {
      contractorId: workerId,
      contract: { id: "contract-test-1", title: "Test Service Agreement" },
      contractNumber: "CON-TEST-1",
      baseUrl: "https://app.example.com",
    });
    log("helper reports sent=true", ok.sent === true && ok.email === "conv-probe@example.com",
        `result=${JSON.stringify(ok)}`);
    log(
      "transporter.sendMail invoked exactly once",
      sentMessages.length === 1,
      `count=${sentMessages.length}`,
    );
    const msg = sentMessages[0];
    log(
      "email addressed to contractor",
      msg?.to === "conv-probe@example.com",
      `to=${String(msg?.to)}`,
    );
    log(
      "subject mentions contract creation",
      typeof msg?.subject === "string" && /Contract Created from Proposal/i.test(msg.subject),
      `subject=${String(msg?.subject)}`,
    );
    log(
      "body references the contract number",
      (typeof msg?.text === "string" && msg.text.includes("CON-TEST-1")) ||
        (typeof msg?.html === "string" && msg.html.includes("CON-TEST-1")),
      `text=${String(msg?.text).slice(0, 80)}`,
    );
    log(
      "body links to the in-app contract review URL",
      (typeof msg?.html === "string" &&
        msg.html.includes("https://app.example.com/app/contractor-hub?section=contracts&id=contract-test-1")),
      "action URL not found in HTML body",
    );

    // 2. Helper short-circuits when the contractor has no email on file.
    const noEmailRes = await db.execute(sql`
      INSERT INTO workers (company_id, first_name, last_name, worker_type)
      VALUES (${companyId}, 'NoEmail', 'Probe', 'contractor')
      RETURNING id
    `);
    const noEmailId = (noEmailRes.rows[0] as { id: string }).id;
    cleanup.push(() => db.execute(sql`DELETE FROM workers WHERE id = ${noEmailId}`));
    const before = sentMessages.length;
    const noEmail = await sendConvertToContractEmail(db, {
      contractorId: noEmailId,
      contract: { id: "contract-test-2", title: "Other" },
      contractNumber: "CON-TEST-2",
      baseUrl: "https://app.example.com",
    });
    log(
      "no contractor email -> helper returns sent=false with reason 'no-email'",
      noEmail.sent === false && noEmail.reason === "no-email",
      `result=${JSON.stringify(noEmail)}`,
    );
    log(
      "no extra sendMail call when contractor has no email",
      sentMessages.length === before,
      `delta=${sentMessages.length - before}`,
    );
  } finally {
    nm.createTransport = originalCreate;
    for (let i = cleanup.length - 1; i >= 0; i--) {
      try { await cleanup[i](); } catch (e) { console.error("cleanup error:", e); }
    }
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("Fatal:", e); process.exit(1); });
