/**
 * Per-user password reset. The raw token is emailed once; the database stores
 * only its SHA-256 hash. Tokens expire and are single-use. Responses from the
 * public request endpoint are identical whether or not an account matched.
 */
import crypto from "crypto";
import { sql } from "drizzle-orm";
import { db } from "./db";

export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;
export const FORGOT_PASSWORD_MESSAGE =
  "If an account matches that username or email, a reset link is on its way.";

export function generatePasswordResetToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashPasswordResetToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export function passwordMeetsPolicy(password: unknown): password is string {
  return typeof password === "string"
    && password.length >= MIN_PASSWORD_LENGTH
    && password.length <= MAX_PASSWORD_LENGTH;
}

export interface ResetUserRow {
  id: string;
  username: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  isActive: boolean;
}

/**
 * Prefer one exact username match. Otherwise one exact email match.
 * Several rows, a disabled account, or no row all mean "do not send".
 */
export function chooseResetUser(rows: ResetUserRow[], identifier: string): ResetUserRow | null {
  const key = identifier.trim().toLowerCase();
  if (!key) return null;
  const active = rows.filter((row) => row.isActive !== false);
  const byUsername = active.filter((row) => row.username.trim().toLowerCase() === key);
  if (byUsername.length === 1) return byUsername[0];
  if (byUsername.length > 1) return null;
  const byEmail = active.filter((row) => (row.email || "").trim().toLowerCase() === key);
  if (byEmail.length === 1 && byEmail[0].email) return byEmail[0];
  return null;
}

export function createIdentifierRateLimit(max: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return {
    allowed(identifier: string): boolean {
      const key = identifier.trim().toLowerCase().slice(0, 200);
      const t = now();
      const recent = (hits.get(key) || []).filter((ts) => t - ts < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(t);
      hits.set(key, recent);
      return true;
    },
  };
}

/** 3 reset emails per identifier per hour, independent of the IP limiter. */
export const resetIdentifierLimit = createIdentifierRateLimit(3, 60 * 60 * 1000);

export async function findResetUsers(identifier: string): Promise<ResetUserRow[]> {
  const key = identifier.trim().toLowerCase();
  const result = await db.execute(sql`
    SELECT id, username, email, first_name, last_name, is_active
    FROM users
    WHERE lower(username) = ${key} OR lower(email) = ${key}
    LIMIT 5
  `);
  return (result.rows as any[]).map((row) => ({
    id: String(row.id),
    username: String(row.username ?? ""),
    email: row.email ? String(row.email) : null,
    firstName: row.first_name ? String(row.first_name) : null,
    lastName: row.last_name ? String(row.last_name) : null,
    isActive: row.is_active !== false,
  }));
}

export async function createPasswordReset(userId: string): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = generatePasswordResetToken();
  const tokenHash = hashPasswordResetToken(rawToken);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
  await db.execute(sql`
    UPDATE password_reset_tokens SET consumed_at = NOW()
    WHERE user_id = ${userId} AND consumed_at IS NULL
  `);
  await db.execute(sql`
    INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
    VALUES (${userId}, ${tokenHash}, ${expiresAt})
  `);
  return { rawToken, expiresAt };
}

export async function getLivePasswordReset(rawToken: string): Promise<{ id: string; userId: string } | null> {
  if (!rawToken || typeof rawToken !== "string" || rawToken.length < 20 || rawToken.length > 200) return null;
  const result = await db.execute(sql`
    SELECT id, user_id, expires_at, consumed_at
    FROM password_reset_tokens
    WHERE token_hash = ${hashPasswordResetToken(rawToken)}
    LIMIT 1
  `);
  const row = result.rows[0] as any;
  if (!row || row.consumed_at) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
  return { id: String(row.id), userId: String(row.user_id) };
}

async function writePasswordAudit(tx: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> }, actorUserId: string, userId: string, changeType: string) {
  await tx.execute(sql`
    INSERT INTO authorization_audit_log (actor_user_id, target_user_id, target_resource, change_type, note)
    VALUES (${actorUserId}, ${userId}, 'users', ${changeType}, 'password changed; the secret is not stored in the audit log')
  `);
}

/** Consumes the token and sets the password in one transaction. A second use fails. */
export async function consumePasswordReset(resetId: string, userId: string, passwordHash: string): Promise<void> {
  await db.transaction(async (tx) => {
    const updated = await tx.execute(sql`
      UPDATE password_reset_tokens SET consumed_at = NOW()
      WHERE id = ${resetId} AND user_id = ${userId} AND consumed_at IS NULL
      RETURNING id
    `);
    if (!updated.rows[0]) throw new Error("reset token already used");
    await tx.execute(sql`UPDATE users SET password = ${passwordHash} WHERE id = ${userId}`);
    await tx.execute(sql`
      UPDATE password_reset_tokens SET consumed_at = NOW()
      WHERE user_id = ${userId} AND consumed_at IS NULL
    `);
    await writePasswordAudit(tx, userId, userId, "password_reset");
  });
}

/** Platform-admin emergency path. Does not accept or echo the shared RECOVERY_TOKEN. */
export async function setPasswordByPlatformAdmin(actorUserId: string, userId: string, passwordHash: string): Promise<boolean> {
  let found = false;
  await db.transaction(async (tx) => {
    const updated = await tx.execute(sql`UPDATE users SET password = ${passwordHash} WHERE id = ${userId} RETURNING id`);
    if (!updated.rows[0]) return;
    found = true;
    await tx.execute(sql`
      UPDATE password_reset_tokens SET consumed_at = NOW()
      WHERE user_id = ${userId} AND consumed_at IS NULL
    `);
    await writePasswordAudit(tx, actorUserId, userId, "platform_admin_password_set");
  });
  return found;
}

/** Best-effort. A missing session table must not undo a password change that already committed. */
export async function revokeUserSessions(userId: string): Promise<void> {
  try {
    await db.execute(sql`DELETE FROM session WHERE sess::jsonb->>'userId' = ${userId}`);
  } catch {
    console.error("[password-reset] session revoke skipped");
  }
}
