/**
 * DB-facing side of the shared identity resolver — server/identity/identity-db.ts
 *
 * PR 1 of the SaaS identity/onboarding architecture cleanup. Everything here is
 * tenant/company-scoped by an explicit `companyId` argument — the pure
 * precedence logic lives in ./identity-resolver.ts.
 */
import crypto from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  resolveSignerEmail,
  type SignerEmailSources,
  type ResolvedSignerEmail,
  normalizeEmail,
} from "./identity-resolver";

function firstRow<T = any>(res: any): T | undefined {
  return (res?.rows?.[0] as T | undefined) ?? undefined;
}

export interface WorkerSignerIdentity {
  found: boolean;
  workerId: string;
  companyId: string | null;
  workerType: string | null;
  firstName: string | null;
  lastName: string | null;
  sources: SignerEmailSources;
  resolved: ResolvedSignerEmail;
}

/**
 * Load every email source for a worker, STRICTLY scoped to `companyId`, and run
 * the deterministic resolver over them. Used by the contractor signer path and
 * the contract detail endpoint so the UI and the send/request-signature path
 * agree on which email (if any) is on file.
 *
 * The `persons` row is global by design, but it is only reached here via
 * `workers.person_id` for a worker we already proved belongs to `companyId`, so
 * no cross-tenant identity is read.
 */
export async function loadWorkerSignerIdentity(
  workerId: string | null | undefined,
  companyId: string | null | undefined,
): Promise<WorkerSignerIdentity> {
  const empty: WorkerSignerIdentity = {
    found: false,
    workerId: String(workerId || ""),
    companyId: companyId ?? null,
    workerType: null,
    firstName: null,
    lastName: null,
    sources: {},
    resolved: resolveSignerEmail({}),
  };
  if (!workerId || !companyId) return empty;

  const res = await db.execute(sql`
    SELECT
      w.id                AS worker_id,
      w.company_id        AS company_id,
      w.worker_type       AS worker_type,
      w.first_name        AS first_name,
      w.last_name         AS last_name,
      w.email             AS worker_email,
      w.work_email        AS worker_work_email,
      w.home_email        AS worker_home_email,
      u.email             AS linked_user_email,
      p.email             AS linked_person_email
    FROM workers w
    LEFT JOIN users u   ON u.worker_id = w.id
    LEFT JOIN persons p ON p.id = w.person_id
    WHERE w.id = ${workerId} AND w.company_id = ${companyId}
    LIMIT 1
  `);
  const row = firstRow<any>(res);
  if (!row) return empty;

  const sources: SignerEmailSources = {
    workerEmail: row.worker_email ?? null,
    workerWorkEmail: row.worker_work_email ?? null,
    workerHomeEmail: row.worker_home_email ?? null,
    linkedUserEmail: row.linked_user_email ?? null,
    linkedPersonEmail: row.linked_person_email ?? null,
  };

  return {
    found: true,
    workerId: row.worker_id,
    companyId: row.company_id ?? null,
    workerType: row.worker_type ?? null,
    firstName: row.first_name ?? null,
    lastName: row.last_name ?? null,
    sources,
    resolved: resolveSignerEmail(sources),
  };
}

// ── Account invites ─────────────────────────────────────────────────────────

/** sha256 of the raw token — the raw token is only ever in the emailed link. */
export function hashInviteToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/** A fresh URL-safe invite token (raw). */
export function generateInviteToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days, matches contract signer tokens

export type RelationshipKind = "employee" | "contractor" | "vendor" | "customer_owner" | "platform";

/**
 * The `identity_links.subject_type` an accepted invite of a given relationship
 * kind should link to. employee/contractor bind to the `worker` subject; vendor
 * binds to the `vendor` subject; anything else records no subject link.
 */
export function inviteSubjectType(relationshipKind: string): "worker" | "vendor" | null {
  if (relationshipKind === "vendor") return "vendor";
  if (relationshipKind === "employee" || relationshipKind === "contractor") return "worker";
  return null;
}

export interface CreateInviteInput {
  companyId: string;
  email: string;
  relationshipKind: RelationshipKind;
  relationshipId?: string | null;
  role: string;
  invitedByUserId: string | null;
}

export interface CreatedInvite {
  id: string;
  rawToken: string;
  expiresAt: Date;
}

/**
 * Create (or refresh) a pending invite for a (company, relationship) target.
 * If a pending invite already exists for that target it is re-issued with a new
 * token and a bumped expiry — so "resend" and "invite" share one path and the
 * unique partial index (uq_account_invites_pending_target) is never violated.
 */
export async function createOrRefreshInvite(input: CreateInviteInput): Promise<CreatedInvite> {
  const email = normalizeEmail(input.email);
  if (!email) throw new Error("createOrRefreshInvite: email is required");
  const rawToken = generateInviteToken();
  const tokenHash = hashInviteToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  const existing = firstRow<{ id: string }>(await db.execute(sql`
    SELECT id FROM account_invites
    WHERE status = 'pending'
      AND company_id = ${input.companyId}
      AND relationship_kind = ${input.relationshipKind}
      AND relationship_id IS NOT DISTINCT FROM ${input.relationshipId ?? null}
    LIMIT 1
  `));

  if (existing?.id) {
    await db.execute(sql`
      UPDATE account_invites
      SET token_hash = ${tokenHash},
          email = ${email},
          role = ${input.role},
          expires_at = ${expiresAt},
          last_sent_at = NOW(),
          invited_by_user_id = ${input.invitedByUserId}
      WHERE id = ${existing.id}
    `);
    return { id: existing.id, rawToken, expiresAt };
  }

  const created = firstRow<{ id: string }>(await db.execute(sql`
    INSERT INTO account_invites
      (company_id, email, relationship_kind, relationship_id, role, token_hash, status, invited_by_user_id, expires_at)
    VALUES
      (${input.companyId}, ${email}, ${input.relationshipKind}, ${input.relationshipId ?? null}, ${input.role}, ${tokenHash}, 'pending', ${input.invitedByUserId}, ${expiresAt})
    RETURNING id
  `));
  return { id: created!.id, rawToken, expiresAt };
}

export interface InviteRow {
  id: string;
  companyId: string | null;
  email: string;
  relationshipKind: string;
  relationshipId: string | null;
  role: string;
  status: string;
  invitedUserId: string | null;
  expiresAt: Date;
}

/** Look up a pending, unexpired invite by its raw token. Returns null otherwise. */
export async function getLiveInviteByToken(rawToken: string): Promise<InviteRow | null> {
  if (!rawToken) return null;
  const row = firstRow<any>(await db.execute(sql`
    SELECT id, company_id, email, relationship_kind, relationship_id, role, status, invited_user_id, expires_at
    FROM account_invites
    WHERE token_hash = ${hashInviteToken(rawToken)}
    LIMIT 1
  `));
  if (!row) return null;
  if (row.status !== "pending") return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
  return {
    id: row.id,
    companyId: row.company_id ?? null,
    email: row.email,
    relationshipKind: row.relationship_kind,
    relationshipId: row.relationship_id ?? null,
    role: row.role,
    status: row.status,
    invitedUserId: row.invited_user_id ?? null,
    expiresAt: new Date(row.expires_at),
  };
}

// ── Deterministic, company-scoped user lookup for "link existing account" ────

export type LinkableUserLookup =
  | { outcome: "none" }
  | { outcome: "ambiguous"; count: number }
  | { outcome: "found"; userId: string; username: string; isActive: boolean; alreadyLinkedWorkerId: string | null };

/**
 * Find the single login account that a given email maps to WITHIN one company.
 * Deterministic: exact (case-insensitive) email match only, never name.
 * More than one match is reported as `ambiguous` for admin review rather than
 * picked arbitrarily.
 */
export async function findLinkableUserByEmail(
  email: string | null | undefined,
  companyId: string | null | undefined,
): Promise<LinkableUserLookup> {
  const norm = normalizeEmail(email);
  if (!norm || !companyId) return { outcome: "none" };
  const res = await db.execute(sql`
    SELECT id, username, is_active, worker_id
    FROM users
    WHERE LOWER(email) = ${norm} AND company_id = ${companyId}
  `);
  const rows = (res.rows || []) as any[];
  if (rows.length === 0) return { outcome: "none" };
  if (rows.length > 1) return { outcome: "ambiguous", count: rows.length };
  const u = rows[0];
  return {
    outcome: "found",
    userId: u.id,
    username: u.username,
    isActive: u.is_active !== false,
    alreadyLinkedWorkerId: u.worker_id ?? null,
  };
}

// ── identity_links ─────────────────────────────────────────────────────────

export interface UpsertIdentityLinkInput {
  userId: string;
  subjectType: "worker" | "vendor" | "customer" | "person";
  subjectId: string;
  companyId: string | null;
  tenantId?: string | null;
  linkStatus?: "active" | "pending_review" | "revoked";
  verifiedEmail?: string | null;
  linkedByUserId?: string | null;
  reviewReason?: string | null;
}

/** Idempotent: one row per (user, subject_type, subject_id). */
export async function upsertIdentityLink(input: UpsertIdentityLinkInput): Promise<void> {
  await db.execute(sql`
    INSERT INTO identity_links
      (user_id, subject_type, subject_id, company_id, tenant_id, link_status, verified_email, linked_by_user_id, review_reason)
    VALUES
      (${input.userId}, ${input.subjectType}, ${input.subjectId}, ${input.companyId ?? null}, ${input.tenantId ?? null},
       ${input.linkStatus ?? "active"}, ${input.verifiedEmail ? normalizeEmail(input.verifiedEmail) : null},
       ${input.linkedByUserId ?? null}, ${input.reviewReason ?? null})
    ON CONFLICT (user_id, subject_type, subject_id) DO UPDATE
      SET link_status = EXCLUDED.link_status,
          verified_email = COALESCE(EXCLUDED.verified_email, identity_links.verified_email),
          review_reason = EXCLUDED.review_reason,
          revoked_at = CASE WHEN EXCLUDED.link_status = 'revoked' THEN NOW() ELSE NULL END
  `);
}

// ── Worker account status (for the employee profile) ────────────────────────

export type WorkerAccountStatus = "no_login" | "invited" | "active" | "suspended";

export interface WorkerAccountState {
  workerId: string;
  status: WorkerAccountStatus;
  userId: string | null;
  username: string | null;
  inviteId: string | null;
  inviteEmail: string | null;
  inviteExpiresAt: Date | null;
}

/**
 * Derive account/access status for every worker in a company in one query.
 * Returned as a map keyed by worker id. A worker with a linked, active `users`
 * row is `active`; linked but `is_active = false` is `suspended`; a pending
 * invite (and no user yet) is `invited`; otherwise `no_login`.
 */
export async function loadWorkerAccountStates(companyId: string): Promise<Map<string, WorkerAccountState>> {
  const map = new Map<string, WorkerAccountState>();
  if (!companyId) return map;

  const users = await db.execute(sql`
    SELECT w.id AS worker_id, u.id AS user_id, u.username AS username, u.is_active AS is_active
    FROM workers w
    JOIN users u ON u.worker_id = w.id
    WHERE w.company_id = ${companyId}
  `);
  for (const r of (users.rows || []) as any[]) {
    map.set(r.worker_id, {
      workerId: r.worker_id,
      status: r.is_active === false ? "suspended" : "active",
      userId: r.user_id,
      username: r.username ?? null,
      inviteId: null,
      inviteEmail: null,
      inviteExpiresAt: null,
    });
  }

  const invites = await db.execute(sql`
    SELECT relationship_id AS worker_id, id, email, expires_at
    FROM account_invites
    WHERE company_id = ${companyId} AND relationship_kind = 'employee'
      AND status = 'pending' AND relationship_id IS NOT NULL
  `);
  for (const r of (invites.rows || []) as any[]) {
    if (map.has(r.worker_id)) continue; // an existing account wins over a stale invite
    map.set(r.worker_id, {
      workerId: r.worker_id,
      status: "invited",
      userId: null,
      username: null,
      inviteId: r.id,
      inviteEmail: r.email ?? null,
      inviteExpiresAt: r.expires_at ? new Date(r.expires_at) : null,
    });
  }

  return map;
}

/** Account/access status for one worker, company-scoped. */
export async function loadWorkerAccountState(
  workerId: string,
  companyId: string,
): Promise<WorkerAccountState> {
  const none: WorkerAccountState = {
    workerId, status: "no_login", userId: null, username: null,
    inviteId: null, inviteEmail: null, inviteExpiresAt: null,
  };
  if (!workerId || !companyId) return none;
  const map = await loadWorkerAccountStates(companyId);
  return map.get(workerId) ?? none;
}

/**
 * Accept an invite: create the login account with a password the invitee chose,
 * bind it to the invite's relationship, and record the identity link. One
 * transaction. The caller has already bcrypt-hashed the password (bcrypt lives
 * in routes.ts). Returns the new user id, or an error shape for a taken
 * username / already-used invite.
 */
export type AcceptInviteResult =
  | { ok: true; userId: string; companyId: string | null; relationshipKind: string; relationshipId: string | null }
  | { ok: false; status: number; message: string };

export async function acceptInviteWithUser(
  rawToken: string,
  username: string,
  hashedPassword: string,
): Promise<AcceptInviteResult> {
  const invite = await getLiveInviteByToken(rawToken);
  if (!invite) return { ok: false, status: 400, message: "This invite link is invalid or has expired." };

  const existingUser = firstRow<{ id: string }>(await db.execute(sql`
    SELECT id FROM users WHERE username = ${username} LIMIT 1
  `));
  if (existingUser?.id) return { ok: false, status: 409, message: "That username is already taken." };

  try {
    await db.execute(sql`BEGIN`);

    // Re-check inside the tx that the invite is still pending (guards a double-accept race).
    const stillPending = firstRow<{ id: string }>(await db.execute(sql`
      SELECT id FROM account_invites WHERE id = ${invite.id} AND status = 'pending' FOR UPDATE
    `));
    if (!stillPending) {
      await db.execute(sql`ROLLBACK`);
      return { ok: false, status: 409, message: "This invite has already been used." };
    }

    const created = firstRow<{ id: string }>(await db.execute(sql`
      INSERT INTO users (username, password, role, company_id, worker_id, is_active, invite_status, email, email_verified_at, last_login_at)
      VALUES (
        ${username}, ${hashedPassword}, ${invite.role}, ${invite.companyId},
        ${invite.relationshipKind === "employee" || invite.relationshipKind === "contractor" ? invite.relationshipId : null},
        TRUE, 'active', ${invite.email}, NOW(), NULL
      )
      RETURNING id
    `));
    const userId = created!.id;

    await db.execute(sql`
      UPDATE account_invites
      SET status = 'accepted', accepted_at = NOW(), invited_user_id = ${userId}
      WHERE id = ${invite.id}
    `);

    // Record the identity link for the relationship this invite is for.
    // employee/contractor → a `worker` subject; vendor → a `vendor` subject.
    const subjectType = inviteSubjectType(invite.relationshipKind);
    if (invite.relationshipId && subjectType) {
      await db.execute(sql`
        INSERT INTO identity_links
          (user_id, subject_type, subject_id, company_id, link_status, verified_email, linked_by_user_id)
        VALUES
          (${userId}, ${subjectType}, ${invite.relationshipId}, ${invite.companyId}, 'active', ${invite.email}, ${userId})
        ON CONFLICT (user_id, subject_type, subject_id) DO NOTHING
      `);
    }

    await db.execute(sql`COMMIT`);
    return {
      ok: true,
      userId,
      companyId: invite.companyId,
      relationshipKind: invite.relationshipKind,
      relationshipId: invite.relationshipId,
    };
  } catch (e: any) {
    await db.execute(sql`ROLLBACK`).catch(() => {});
    if (e?.code === "23505") return { ok: false, status: 409, message: "That username is already taken." };
    throw e;
  }
}

/**
 * Enable / disable a worker's login account (company-scoped). "Disable" flips
 * the linked users row to is_active = false — the existing login and requireAuth
 * checks already reject an inactive account, so no new enforcement path is
 * introduced. Also stamps invite_status for the profile display. Returns the
 * resulting status, or null if the worker has no linked account.
 */
export async function setWorkerAccountEnabled(
  workerId: string,
  companyId: string,
  enabled: boolean,
): Promise<WorkerAccountStatus | null> {
  const state = await loadWorkerAccountState(workerId, companyId);
  if (!state.userId) return null;
  await db.execute(sql`
    UPDATE users
    SET is_active = ${enabled}, invite_status = ${enabled ? "active" : "suspended"}
    WHERE id = ${state.userId} AND company_id = ${companyId}
  `);
  return enabled ? "active" : "suspended";
}
