import { sql } from "drizzle-orm";
import type { db as DbType } from "./db";
import { sendGenericNotificationEmail } from "./notifications";

/**
 * Send the contractor-facing email for the convert-to-contract flow.
 * Extracted from the /api/contractor-proposals/:id/convert-to-contract
 * handler so it can be unit-tested with a mocked nodemailer transporter
 * (proves contract-conversion really triggers the email path).
 *
 * Returns:
 *   - { sent: true, email } when an email was dispatched
 *   - { sent: false, reason } when no contractor email could be resolved
 *     or the underlying send call rejected
 */
export interface ConvertToContractEmailInput {
  contractorId: string;
  contract: { id: string; title: string };
  contractNumber: string;
  baseUrl: string;
}

export interface ConvertToContractEmailResult {
  sent: boolean;
  email?: string;
  reason?: string;
}

export async function sendConvertToContractEmail(
  database: typeof DbType,
  input: ConvertToContractEmailInput,
): Promise<ConvertToContractEmailResult> {
  const { contractorId, contract, contractNumber, baseUrl } = input;
  let cw: { email: string | null; first_name: string | null; last_name: string | null } | undefined;
  try {
    const cwRes = await database.execute(sql`
      SELECT COALESCE(w.work_email, w.home_email, w.email) AS email,
             w.first_name, w.last_name
      FROM workers w
      WHERE w.id = ${contractorId} LIMIT 1
    `);
    cw = cwRes.rows[0] as typeof cw;
  } catch (e) {
    return { sent: false, reason: `lookup-failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!cw?.email) return { sent: false, reason: "no-email" };
  try {
    const result = await sendGenericNotificationEmail({
      recipientName: `${cw.first_name || ""} ${cw.last_name || ""}`.trim() || "Contractor",
      email: cw.email,
      title: `Contract Created from Proposal: ${contract.title}`,
      body: `Your proposal has been converted to a contract (${contractNumber}). Log in to PayLink to review and sign.`,
      actionUrl: `${baseUrl}/app/contractor-hub?section=contracts&id=${contract.id}`,
    });
    if (!result.sent) return { sent: false, email: cw.email, reason: result.error || "send-failed" };
    return { sent: true, email: cw.email };
  } catch (e) {
    return { sent: false, email: cw.email, reason: e instanceof Error ? e.message : String(e) };
  }
}
