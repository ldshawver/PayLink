/**
 * Contractor onboarding — welcome email after verified completion.
 *
 * QUEUE: `queueWelcomeEmail(tx, …)` (welcome-queue.ts — database only, no mail
 * code, so the approval path stays network-free) runs INSIDE the approval transaction in
 * review.ts — the only path that moves a contractor onboarding to 'verified'.
 * It inserts ONE email_outbox row per onboarding (unique dedupe_key, ON
 * CONFLICT DO NOTHING), so a replayed or concurrent approval can never create a
 * second logical message. The row holds delivery state only: no address, no
 * body, no token.
 *
 * DELIVER: `drainWelcomeOutbox(…)` (the orchestrator job, only when enabled)
 * claims due rows with FOR UPDATE SKIP LOCKED and, per row, in one transaction:
 *   1. re-checks eligibility with the shared gate evaluator — the onboarding
 *      must still be verified with every document present and no open review
 *      (activation is a separate step, so `worker_status` alone is tolerated);
 *   2. finds the ONE active login account bound to that worker + company
 *      (never creates an account);
 *   3. revokes any pending setup token for (worker, purpose) and stores
 *      sha256 of a fresh one bound to user, worker, company, purpose, outbox;
 *   4. marks the row 'sending' and counts the attempt.
 * The email is sent after that commits. Success → 'sent'. Failure → the
 * undelivered token is revoked and the row goes back to 'failed' with
 * exponential backoff ('dead' after max_attempts). A failure is never recorded
 * as sent. A process crash between send and record leaves 'sending'; after
 * SENDING_STALE_MS it is retried (at-least-once delivery, still one live link).
 *
 * USE: `completePasswordSetup(…)` consumes a token exactly once under a row
 * lock and sets the password of the bound, still-matching user. Every failure
 * answers the same generic message.
 *
 * Audit rows (onboarding_audit_log) carry ids, attempt numbers and fixed codes
 * only — never the token, address, password, PIN, tax/ID values or notes.
 */
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { evaluateContractorGate } from "./gate";
import { escapeHtml } from "./invite";
import { WELCOME_KIND, audit, tablesReady } from "./welcome-queue";

export { WELCOME_KIND, MAX_ATTEMPTS, queueWelcomeEmail } from "./welcome-queue";

type Exec = { execute: (q: any) => Promise<any> };
const firstRow = <T>(r: any): T | undefined => (Array.isArray(r) ? r[0] : r?.rows?.[0]);
const rowsOf = <T>(r: any): T[] => (Array.isArray(r) ? r : r?.rows ?? []);

export const SETUP_PURPOSE = "contractor_welcome_password_setup";
export const SETUP_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;
export const SENDING_STALE_MS = 10 * 60 * 1000;
export const SETUP_PATH = "/contractor-password-setup";
export const GENERIC_INVALID = "This link is invalid or has expired. Ask your company administrator for a new one.";
/** Gate codes that do not block the welcome email: activation is a separate, later step. */
const TOLERATED_GATE_CODES = new Set(["worker_status"]);

export const welcomeEmailEnabled = () => process.env.CONTRACTOR_WELCOME_EMAIL_ENABLED === "true";
export const hashSetupToken = (raw: string) => crypto.createHash("sha256").update(raw, "utf8").digest("hex");
const backoffMs = (attempt: number) => Math.min(60 * 60 * 1000, 2 ** Math.max(0, attempt - 1) * 60 * 1000);

// ─── message ─────────────────────────────────────────────────────────────────

export interface WelcomeEmail { to: string; subject: string; text: string; html: string }

/** Pure, so tests can inspect exactly what is sent. Only: name, company, employee number, link, expiry. */
export function buildWelcomeEmail(a: { to: string; firstName: string; companyName: string; employeeNumber: string; link: string; expiresAt: Date }): WelcomeEmail {
  const hours = Math.max(1, Math.round((a.expiresAt.getTime() - Date.now()) / 3_600_000));
  const subject = `Welcome to ${a.companyName} — your contractor onboarding is complete`;
  const text = [
    `Hi ${a.firstName},`, "",
    `${a.companyName} has verified your contractor onboarding on MyPayLink.`, "",
    `Your employee number: ${a.employeeNumber}`, "",
    "Use this link to set your password:", "",
    a.link, "",
    `The link works once and expires in ${hours} hours. If you weren't expecting this, contact ${a.companyName}.`, "",
    "MyPayLink",
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111827">`
    + `<p>Hi ${escapeHtml(a.firstName)},</p>`
    + `<p>${escapeHtml(a.companyName)} has verified your contractor onboarding on MyPayLink.</p>`
    + `<p>Your employee number: <strong>${escapeHtml(a.employeeNumber)}</strong></p>`
    + `<p><a href="${escapeHtml(a.link)}" style="display:inline-block;background:#0d9488;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Set my password</a></p>`
    + `<p style="color:#6b7280;font-size:13px">The link works once and expires in ${hours} hours. If you weren't expecting this, contact ${escapeHtml(a.companyName)}.</p></div>`;
  return { to: a.to, subject, text, html };
}

export type WelcomeMailer = (m: WelcomeEmail) => Promise<{ sent: boolean }>;

/** Default mailer: the app's configured SMTP. Never logs the address, body or error text. */
export const smtpWelcomeMailer: WelcomeMailer = async (m) => {
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

// ─── drain ───────────────────────────────────────────────────────────────────

export interface DrainResult { claimed: number; sent: number; failed: number; dead: number }

type Prepared =
  | { kind: "send"; outboxId: string; tokenId: string; email: WelcomeEmail; row: any; attempt: number }
  | { kind: "skip" };

/** One row: lock, re-check, issue token, mark sending — all in one transaction. */
async function prepare(outboxId: string, baseUrl: string, now: number): Promise<Prepared> {
  return db.transaction(async (tx) => {
    const ob = firstRow<any>(await tx.execute(sql`
      SELECT id, company_id, worker_id, subject_id AS onboarding_id, status, attempt_count, max_attempts, claimed_at, next_attempt_at
        FROM email_outbox WHERE id = ${outboxId} AND kind = ${WELCOME_KIND} FOR UPDATE SKIP LOCKED`));
    if (!ob) return { kind: "skip" as const };
    const stale = ob.status === "sending" && ob.claimed_at && now - new Date(ob.claimed_at).getTime() >= SENDING_STALE_MS;
    if (!(ob.status === "queued" || ob.status === "failed" || stale)) return { kind: "skip" as const };
    if (new Date(ob.next_attempt_at).getTime() > now && !stale) return { kind: "skip" as const };
    const attempt = Number(ob.attempt_count) + 1;

    const fail = async (code: string) => {
      const dead = attempt >= Number(ob.max_attempts);
      await tx.execute(sql`
        UPDATE email_outbox SET status = ${dead ? "dead" : "failed"}, attempt_count = ${attempt}, last_attempt_at = ${new Date(now)},
               next_attempt_at = ${new Date(now + backoffMs(attempt))}, claimed_at = NULL, last_error_code = ${code}, updated_at = NOW()
         WHERE id = ${ob.id}`);
      await revokePending(tx, ob.worker_id, "withdrawn");
      await audit(tx, ob, dead ? "welcome_email_dead" : "welcome_email_failed", { outboxId: ob.id, attempt, code });
      return { kind: "skip" as const };
    };

    // 1. eligibility: still verified, every document present, no open review.
    const onb = firstRow<any>(await tx.execute(sql`
      SELECT status FROM worker_onboarding WHERE id = ${ob.onboarding_id} AND company_id = ${ob.company_id} AND worker_id = ${ob.worker_id}`));
    if (onb?.status !== "verified") return fail("not_eligible");
    const g = await evaluateContractorGate(tx, { workerId: ob.worker_id, companyId: ob.company_id });
    if (g.missing.some((c) => !TOLERATED_GATE_CODES.has(c))) return fail("not_eligible");

    // 2. the ONE login account bound to this worker in this company.
    const users = rowsOf<any>(await tx.execute(sql`
      SELECT id FROM users WHERE worker_id = ${ob.worker_id} AND company_id = ${ob.company_id} AND is_active IS NOT FALSE`));
    if (users.length === 0) return fail("no_account");
    if (users.length > 1) return fail("ambiguous_account");
    const w = firstRow<any>(await tx.execute(sql`
      SELECT w.first_name, w.email, w.employee_number, c.name AS company_name
        FROM workers w JOIN companies c ON c.id = w.company_id WHERE w.id = ${ob.worker_id} AND w.company_id = ${ob.company_id}`));
    if (!w?.email) return fail("no_email");
    if (!w.employee_number) return fail("no_employee_number");

    // 3. one live link: revoke the previous pending token, store only the hash of the new one.
    await revokePending(tx, ob.worker_id, "replaced");
    const raw = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(now + SETUP_TOKEN_TTL_MS);
    const tok = firstRow<{ id: string }>(await tx.execute(sql`
      INSERT INTO contractor_password_setup_tokens (token_hash, purpose, company_id, worker_id, user_id, onboarding_id, outbox_id, expires_at)
      VALUES (${hashSetupToken(raw)}, ${SETUP_PURPOSE}, ${ob.company_id}, ${ob.worker_id}, ${users[0].id}, ${ob.onboarding_id}, ${ob.id}, ${expiresAt})
      RETURNING id`))!;

    // 4. claim.
    await tx.execute(sql`
      UPDATE email_outbox SET status = 'sending', attempt_count = ${attempt}, claimed_at = ${new Date(now)}, last_attempt_at = ${new Date(now)},
             last_error_code = NULL, updated_at = NOW() WHERE id = ${ob.id}`);
    await audit(tx, ob, "password_setup_token_issued", { outboxId: ob.id, tokenId: tok.id, attempt });
    const link = `${baseUrl.replace(/\/+$/, "")}${SETUP_PATH}?token=${encodeURIComponent(raw)}`;
    const email = buildWelcomeEmail({ to: String(w.email), firstName: w.first_name ?? "", companyName: w.company_name ?? "", employeeNumber: String(w.employee_number), link, expiresAt });
    return { kind: "send" as const, outboxId: ob.id, tokenId: tok.id, email, row: ob, attempt };
  });
}

async function revokePending(tx: Exec, workerId: string, reason: "replaced" | "withdrawn") {
  const revoked = rowsOf<any>(await tx.execute(sql`
    UPDATE contractor_password_setup_tokens SET status = 'revoked', revoked_at = NOW(), revoked_reason = ${reason}
     WHERE worker_id = ${workerId} AND purpose = ${SETUP_PURPOSE} AND status = 'pending'
     RETURNING id, company_id, worker_id, onboarding_id`));
  for (const t of revoked) await audit(tx, t, "password_setup_token_revoked", { tokenId: t.id, reason });
}

/**
 * Deliver due welcome messages. Each row is handled independently; a failure
 * on one never affects another. Real SMTP is used only through `mailer`.
 */
export async function drainWelcomeOutbox(o: { baseUrl: string | null; mailer?: WelcomeMailer; now?: () => number; limit?: number } ): Promise<DrainResult> {
  const res: DrainResult = { claimed: 0, sent: 0, failed: 0, dead: 0 };
  if (!o.baseUrl || !(await tablesReady(db))) return res;
  const mailer = o.mailer ?? smtpWelcomeMailer;
  const now = o.now ?? Date.now;
  const t = now();
  const due = rowsOf<{ id: string }>(await db.execute(sql`
    SELECT id FROM email_outbox
     WHERE kind = ${WELCOME_KIND}
       AND ((status IN ('queued','failed') AND next_attempt_at <= ${new Date(t)})
            OR (status = 'sending' AND claimed_at <= ${new Date(t - SENDING_STALE_MS)}))
     ORDER BY next_attempt_at LIMIT ${o.limit ?? 20}`));
  for (const { id } of due) {
    const p = await prepare(id, o.baseUrl, now());
    if (p.kind !== "send") {
      const s = firstRow<any>(await db.execute(sql`SELECT status FROM email_outbox WHERE id = ${id}`));
      if (s?.status === "failed") res.failed++; else if (s?.status === "dead") res.dead++;
      continue;
    }
    res.claimed++;
    let sent = false;
    try { sent = (await mailer(p.email)).sent === true; } catch { sent = false; }
    await db.transaction(async (tx) => {
      if (sent) {
        const ok = rowsOf<any>(await tx.execute(sql`
          UPDATE email_outbox SET status = 'sent', sent_at = NOW(), claimed_at = NULL, updated_at = NOW()
           WHERE id = ${p.outboxId} AND status = 'sending' RETURNING id`));
        if (ok.length) await audit(tx, p.row, "welcome_email_sent", { outboxId: p.outboxId, attempt: p.attempt });
      } else {
        const dead = p.attempt >= Number(p.row.max_attempts);
        await tx.execute(sql`
          UPDATE contractor_password_setup_tokens SET status = 'revoked', revoked_at = NOW(), revoked_reason = 'undelivered'
           WHERE id = ${p.tokenId} AND status = 'pending'`);
        await audit(tx, p.row, "password_setup_token_revoked", { tokenId: p.tokenId, reason: "undelivered" });
        await tx.execute(sql`
          UPDATE email_outbox SET status = ${dead ? "dead" : "failed"}, next_attempt_at = ${new Date(now() + backoffMs(p.attempt))},
                 claimed_at = NULL, last_error_code = 'send_failed', updated_at = NOW()
           WHERE id = ${p.outboxId} AND status = 'sending'`);
        await audit(tx, p.row, dead ? "welcome_email_dead" : "welcome_email_failed", { outboxId: p.outboxId, attempt: p.attempt, code: "send_failed" });
      }
    });
    if (sent) res.sent++; else if (p.attempt >= Number(p.row.max_attempts)) res.dead++; else res.failed++;
  }
  return res;
}

// ─── use ─────────────────────────────────────────────────────────────────────

export type SetupOutcome = { ok: true } | { ok: false; status: 400; message: string };
const INVALID: SetupOutcome = { ok: false, status: 400, message: GENERIC_INVALID };

/**
 * Consume a setup token exactly once and set the bound user's password.
 * Bound = same purpose, still pending, unexpired, and the user still belongs to
 * the token's worker and company. Every failure returns the same answer.
 */
export async function completePasswordSetup(a: { rawToken: unknown; password: unknown; now?: () => number }): Promise<SetupOutcome> {
  if (typeof a.rawToken !== "string" || !/^[A-Za-z0-9_-]{20,100}$/.test(a.rawToken)) return INVALID;
  if (typeof a.password !== "string" || a.password.length < 8 || a.password.length > 1024) {
    return { ok: false, status: 400, message: "Choose a password of at least 8 characters." };
  }
  if (!(await tablesReady(db))) return INVALID;
  const now = (a.now ?? Date.now)();
  const hashed = await bcrypt.hash(a.password, 10);
  return db.transaction(async (tx) => {
    const t = firstRow<any>(await tx.execute(sql`
      SELECT id, purpose, company_id, worker_id, user_id, onboarding_id, status, expires_at FROM contractor_password_setup_tokens
       WHERE token_hash = ${hashSetupToken(a.rawToken as string)} FOR UPDATE`));
    if (!t) return INVALID;
    const reject = async (reason: string) => {
      await audit(tx, t, "password_setup_rejected", { tokenId: t.id, reason });
      return INVALID;
    };
    if (t.purpose !== SETUP_PURPOSE) return reject("wrong_purpose");
    if (t.status === "used") return reject("replayed");
    if (t.status !== "pending") return reject("revoked");
    if (new Date(t.expires_at).getTime() <= now) return reject("expired");
    const bound = firstRow<any>(await tx.execute(sql`
      SELECT u.id FROM users u JOIN workers w ON w.id = u.worker_id
       WHERE u.id = ${t.user_id} AND u.worker_id = ${t.worker_id} AND u.company_id = ${t.company_id} AND w.company_id = ${t.company_id}
         AND u.is_active IS NOT FALSE
       FOR UPDATE OF u`));
    if (!bound) return reject("binding_mismatch");
    await tx.execute(sql`UPDATE users SET password = ${hashed} WHERE id = ${t.user_id}`);
    await tx.execute(sql`UPDATE contractor_password_setup_tokens SET status = 'used', used_at = NOW() WHERE id = ${t.id}`);
    // A password change ends every existing session of that account.
    await tx.execute(sql`DELETE FROM session WHERE sess->>'userId' = ${t.user_id}`);
    await audit(tx, t, "password_setup_completed", { tokenId: t.id }, { id: t.user_id, type: "worker" });
    return { ok: true as const };
  });
}

/** Administrator view: delivery state only (no address, token or error text). */
export async function welcomeStatus(companyId: string, onboardingId: string) {
  if (!(await tablesReady(db))) return null;
  return firstRow<any>(await db.execute(sql`
    SELECT status, attempt_count AS "attemptCount", max_attempts AS "maxAttempts", next_attempt_at AS "nextAttemptAt",
           sent_at AS "sentAt", last_error_code AS "lastErrorCode", created_at AS "queuedAt"
      FROM email_outbox WHERE kind = ${WELCOME_KIND} AND company_id = ${companyId} AND subject_id = ${onboardingId}`)) ?? null;
}
