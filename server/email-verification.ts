/**
 * Email verification for new trial signups — Concierge Launch Option A,
 * blocker 5. Same shape as server/identity/identity-db.ts's account_invites
 * (sha256-hashed, single-use, expiring token; raw token only ever lives in
 * the emailed link).
 *
 * Grandfather rule: `users.email_verification_required` defaults to FALSE
 * and is only ever set TRUE by the trial-signup path. Every existing account
 * (and any account created any other way — invites, provisioning, etc.) has
 * it FALSE, so the login-time verification gate can never lock out an
 * existing user. This is deliberately a new boolean column rather than
 * reusing an existing signal (role, invite_status) — those are shared with
 * unrelated account-creation paths and would make the gate's blast radius
 * hard to reason about.
 */
import crypto from "crypto";
import { sql } from "drizzle-orm";
import { db } from "./db";

export const EMAIL_VERIFICATION_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

export function generateVerificationToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashVerificationToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export interface CreatedVerification {
  rawToken: string;
  expiresAt: Date;
}

/** Creates a fresh verification token for a user, invalidating any prior unconsumed one. */
export async function createEmailVerification(userId: string): Promise<CreatedVerification> {
  const rawToken = generateVerificationToken();
  const tokenHash = hashVerificationToken(rawToken);
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);

  await db.execute(sql`
    UPDATE email_verifications SET consumed_at = NOW()
    WHERE user_id = ${userId} AND consumed_at IS NULL
  `);
  await db.execute(sql`
    INSERT INTO email_verifications (user_id, token_hash, expires_at)
    VALUES (${userId}, ${tokenHash}, ${expiresAt})
  `);
  return { rawToken, expiresAt };
}

export interface VerificationRow {
  id: string;
  userId: string;
}

/** Looks up a pending, unexpired verification by its raw token. Returns null otherwise. */
export async function getLiveVerificationByToken(rawToken: string): Promise<VerificationRow | null> {
  if (!rawToken) return null;
  const result = await db.execute(sql`
    SELECT id, user_id, expires_at, consumed_at
    FROM email_verifications
    WHERE token_hash = ${hashVerificationToken(rawToken)}
    LIMIT 1
  `);
  const row = result.rows[0] as any;
  if (!row) return null;
  if (row.consumed_at) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
  return { id: row.id, userId: row.user_id };
}

/** Marks a verification consumed and the owning user's email verified, in one transaction. */
export async function consumeEmailVerification(verificationId: string, userId: string): Promise<void> {
  await db.execute(sql`BEGIN`);
  try {
    await db.execute(sql`UPDATE email_verifications SET consumed_at = NOW() WHERE id = ${verificationId}`);
    await db.execute(sql`UPDATE users SET email_verified_at = NOW() WHERE id = ${userId}`);
    await db.execute(sql`COMMIT`);
  } catch (e) {
    await db.execute(sql`ROLLBACK`);
    throw e;
  }
}
