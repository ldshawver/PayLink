/**
 * Contractor onboarding — PR 2: expiring account-setup invitation.
 *
 * The email carries ONE thing: a single-use, expiring link to set a password.
 * Never a password, never a PIN. The raw token exists only in memory and in
 * that link; account_invites stores sha256(token).
 *
 * Idempotent and retry-safe:
 *   - The onboarding row is locked (FOR UPDATE) and a "sending" claim is
 *     recorded in the same transaction. A concurrent or double-clicked request
 *     sees the claim (or a send within SEND_COOLDOWN_MS) and sends nothing.
 *   - The email is sent AFTER the claim commits. Success → status 'invited',
 *     account_setup step 'in_progress'. Failure → status 'invite_failed'; the
 *     claim is released so the administrator can retry at once.
 *   - Every (re)send rotates the token on the single pending invite for this
 *     worker, so at most one link is ever live.
 *   - A claim older than SENDING_STALE_MS (crashed process) can be retried.
 *
 * Audit rows (onboarding_audit_log) carry ids, timestamps and outcome codes
 * only — never the email address, name, token or SMTP error text.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { generateInviteToken, hashInviteToken } from "../identity/identity-db";
import { CONTRACTOR_ONBOARDING_PACKAGE } from "./create";

export const SETUP_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SEND_COOLDOWN_MS = 60 * 1000;
export const SENDING_STALE_MS = 2 * 60 * 1000;

type Exec = { execute: (q: any) => Promise<any> };
const firstRow = <T>(r: any): T | undefined => (Array.isArray(r) ? r[0] : r?.rows?.[0]);

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export interface SetupEmail { to: string; subject: string; text: string; html: string }

/** Build the invitation email. Pure, so tests can inspect exactly what is sent. */
export function buildSetupInviteEmail(args: { to: string; firstName: string; companyName: string; link: string; expiresAt: Date }): SetupEmail {
  const days = Math.round((args.expiresAt.getTime() - Date.now()) / 86_400_000);
  const subject = `Set up your ${args.companyName} contractor account`;
  const text = [
    `Hi ${args.firstName},`, "",
    `${args.companyName} added you as a contractor on MyPayLink. Use this link to choose your password and start onboarding:`, "",
    args.link, "",
    `The link works once and expires in ${days} days. If you weren't expecting this, you can ignore this email.`, "",
    "MyPayLink",
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111827">`
    + `<p>Hi ${escapeHtml(args.firstName)},</p>`
    + `<p>${escapeHtml(args.companyName)} added you as a contractor on MyPayLink. Use the button below to choose your password and start onboarding.</p>`
    + `<p><a href="${escapeHtml(args.link)}" style="display:inline-block;background:#0d9488;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Set up my account</a></p>`
    + `<p style="color:#6b7280;font-size:13px">The link works once and expires in ${days} days. If you weren't expecting this, you can ignore this email.</p></div>`;
  return { to: args.to, subject, text, html };
}

export type Mailer = (m: SetupEmail) => Promise<{ sent: boolean }>;

/** Default mailer: the app's configured SMTP. Never logs the address or body. */
export const smtpMailer: Mailer = async (m) => {
  const { getTransporter } = await import("../notifications");
  const smtp = await getTransporter();
  if (!smtp) return { sent: false };
  try {
    await smtp.transporter.sendMail({ from: smtp.fromAddress, to: m.to, subject: m.subject, text: m.text, html: m.html });
    return { sent: true };
  } catch {
    return { sent: false };
  }
};

export type SendOutcome =
  | { ok: true; outcome: "sent"; expiresAt: string }
  | { ok: true; outcome: "already_sent" | "in_progress"; sentAt: string | null }
  | { ok: false; status: 404 | 409; code: "not_found" | "already_set_up" | "no_email"; message: string }
  | { ok: false; status: 502; code: "send_failed"; message: string }
  | { ok: false; status: 503; code: "not_configured"; message: string };

const NOT_FOUND = { ok: false as const, status: 404 as const, code: "not_found" as const, message: "Onboarding record not found." };

async function audit(exec: Exec, row: { company_id: string; worker_id: string; id: string }, actorUserId: string | null, actorType: "admin" | "worker" | "system", eventType: string, after: Record<string, unknown>) {
  await exec.execute(sql`
    INSERT INTO onboarding_audit_log (company_id, worker_id, onboarding_id, actor_user_id, actor_type, event_type, after_json)
    VALUES (${row.company_id}, ${row.worker_id}, ${row.id}, ${actorUserId}, ${actorType}, ${eventType}, ${JSON.stringify(after)})`);
}

export async function sendSetupInvite(args: {
  companyId: string; onboardingId: string; actorUserId: string; baseUrl: string | null; mailer?: Mailer; now?: () => number;
}): Promise<SendOutcome> {
  const mailer = args.mailer ?? smtpMailer;
  const now = args.now ?? Date.now;
  if (!args.baseUrl) return { ok: false, status: 503, code: "not_configured", message: "Invitations are not configured on this server (APP_BASE_URL is missing)." };

  // 1) Claim under a row lock, rotate the token, commit.
  const claim = await db.transaction(async (tx) => {
    const row = firstRow<any>(await tx.execute(sql`
      SELECT o.id, o.company_id, o.worker_id, o.status, o.updated_at, w.email, w.first_name, c.name AS company_name,
             (SELECT s.status FROM onboarding_steps s WHERE s.onboarding_id = o.id AND s.step_key = 'account_setup') AS setup_status,
             (SELECT max(i.last_sent_at) FROM account_invites i
               WHERE i.company_id = o.company_id AND i.relationship_kind = 'contractor' AND i.relationship_id = o.worker_id
                 AND i.status = 'pending') AS last_sent_at
        FROM worker_onboarding o
        JOIN workers w ON w.id = o.worker_id AND w.company_id = o.company_id
        JOIN companies c ON c.id = o.company_id
       WHERE o.id = ${args.onboardingId} AND o.company_id = ${args.companyId} AND o.package_key = ${CONTRACTOR_ONBOARDING_PACKAGE}
       FOR UPDATE OF o`));
    if (!row) return { done: NOT_FOUND };
    if (row.setup_status === "completed") return { done: { ok: false as const, status: 409 as const, code: "already_set_up" as const, message: "This contractor has already set up their account." } };
    if (!row.email) return { done: { ok: false as const, status: 409 as const, code: "no_email" as const, message: "Add an email address before sending an invitation." } };
    const t = now();
    if (row.status === "invite_sending" && t - new Date(row.updated_at).getTime() < SENDING_STALE_MS) {
      return { done: { ok: true as const, outcome: "in_progress" as const, sentAt: null } };
    }
    if (row.status === "invited" && row.last_sent_at && t - new Date(row.last_sent_at).getTime() < SEND_COOLDOWN_MS) {
      return { done: { ok: true as const, outcome: "already_sent" as const, sentAt: new Date(row.last_sent_at).toISOString() } };
    }
    const rawToken = generateInviteToken();
    const expiresAt = new Date(t + SETUP_INVITE_TTL_MS);
    // Exactly one pending invite per worker: revoke strays, then refresh or insert.
    const pending = firstRow<{ id: string }>(await tx.execute(sql`
      SELECT id FROM account_invites
       WHERE status = 'pending' AND company_id = ${row.company_id} AND relationship_kind = 'contractor' AND relationship_id = ${row.worker_id}
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`));
    await tx.execute(sql`
      UPDATE account_invites SET status = 'revoked', revoked_at = NOW()
       WHERE status = 'pending' AND company_id = ${row.company_id} AND relationship_kind = 'contractor' AND relationship_id = ${row.worker_id}
         AND id IS DISTINCT FROM ${pending?.id ?? null}`);
    let inviteId: string;
    if (pending) {
      await tx.execute(sql`
        UPDATE account_invites SET token_hash = ${hashInviteToken(rawToken)}, email = ${String(row.email).toLowerCase()}, role = 'contractor',
               expires_at = ${expiresAt}, last_sent_at = NULL, invited_by_user_id = ${args.actorUserId}
         WHERE id = ${pending.id}`);
      inviteId = pending.id;
    } else {
      inviteId = firstRow<{ id: string }>(await tx.execute(sql`
        INSERT INTO account_invites (company_id, email, relationship_kind, relationship_id, role, token_hash, status, invited_by_user_id, expires_at, last_sent_at)
        VALUES (${row.company_id}, ${String(row.email).toLowerCase()}, 'contractor', ${row.worker_id}, 'contractor', ${hashInviteToken(rawToken)}, 'pending',
                ${args.actorUserId}, ${expiresAt}, NULL)
        RETURNING id`))!.id;
    }
    await tx.execute(sql`UPDATE worker_onboarding SET status = 'invite_sending', invite_token_hash = NULL, invite_expires_at = ${expiresAt}, updated_at = NOW() WHERE id = ${row.id}`);
    return { send: { row, rawToken, expiresAt, inviteId } };
  });
  if ("done" in claim) return claim.done as SendOutcome;

  // 2) Send outside the transaction.
  const { row, rawToken, expiresAt, inviteId } = claim.send;
  const link = `${args.baseUrl.replace(/\/+$/, "")}/accept-invite?token=${encodeURIComponent(rawToken)}`;
  const email = buildSetupInviteEmail({ to: row.email, firstName: row.first_name, companyName: row.company_name, link, expiresAt });
  let sent = false;
  try { sent = (await mailer(email)).sent; } catch { sent = false; }

  // 3) Record the outcome (only if our claim is still the current one).
  await db.transaction(async (tx) => {
    if (sent) {
      await tx.execute(sql`UPDATE account_invites SET last_sent_at = NOW() WHERE id = ${inviteId}`);
      await tx.execute(sql`UPDATE worker_onboarding SET status = 'invited', updated_at = NOW() WHERE id = ${row.id} AND status = 'invite_sending'`);
      await tx.execute(sql`UPDATE onboarding_steps SET status = 'in_progress', updated_at = NOW() WHERE onboarding_id = ${row.id} AND step_key = 'account_setup' AND status <> 'completed'`);
      await audit(tx, row, args.actorUserId, "admin", "setup_invite_sent", { inviteId, expiresAt: expiresAt.toISOString() });
    } else {
      // The link was never delivered: kill it so no stray token stays live, and release the claim for a retry.
      await tx.execute(sql`UPDATE account_invites SET status = 'revoked', revoked_at = NOW() WHERE id = ${inviteId} AND status = 'pending'`);
      await tx.execute(sql`UPDATE worker_onboarding SET status = 'invite_failed', updated_at = NOW() WHERE id = ${row.id} AND status = 'invite_sending'`);
      await audit(tx, row, args.actorUserId, "admin", "setup_invite_failed", { inviteId });
    }
  });
  if (!sent) return { ok: false, status: 502, code: "send_failed", message: "The invitation email could not be sent. Nothing was delivered; you can retry." };
  return { ok: true, outcome: "sent", expiresAt: expiresAt.toISOString() };
}

/**
 * Called INSIDE the invite-accept transaction. If the accepted invite is a
 * contractor invite for a contractor_hub_v2 onboarding, complete the
 * account_setup step and move onboarding to 'in_progress'. Idempotent.
 */
export async function completeAccountSetupStep(tx: Exec, args: { companyId: string | null; workerId: string | null; userId: string }) {
  if (!args.companyId || !args.workerId) return;
  const row = firstRow<any>(await tx.execute(sql`
    SELECT id, company_id, worker_id FROM worker_onboarding
     WHERE company_id = ${args.companyId} AND worker_id = ${args.workerId} AND package_key = ${CONTRACTOR_ONBOARDING_PACKAGE}
     ORDER BY created_at DESC LIMIT 1 FOR UPDATE`));
  if (!row) return;
  const changed = await tx.execute(sql`
    UPDATE onboarding_steps SET status = 'completed', completed_at = NOW(), updated_at = NOW()
     WHERE onboarding_id = ${row.id} AND step_key = 'account_setup' AND status <> 'completed' RETURNING id`);
  const n = Array.isArray(changed) ? changed.length : changed?.rows?.length ?? 0;
  if (!n) return;
  await tx.execute(sql`
    UPDATE worker_onboarding SET status = 'in_progress', started_at = COALESCE(started_at, NOW()), current_step_key = 'contractor_agreement', updated_at = NOW()
     WHERE id = ${row.id}`);
  await audit(tx, row, args.userId, "worker", "account_setup_completed", { userId: args.userId });
}
