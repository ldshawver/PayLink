/**
 * Contractor access requests — PR 2 of the SaaS identity/onboarding cleanup.
 *
 * A contractor's PUBLIC request for logged-in Contractor Hub access. A public
 * submission ONLY ever creates a `pending` row (never a login account). An
 * admin/manager reviews and approves (→ create/link the contractor worker +
 * issue an account_invite from PR 1) or rejects (→ status + reason, row kept).
 *
 * Split: pure validation (`normalizeAccessRequestInput`) is dependency-free and
 * unit-tested; everything else is company/tenant-scoped DB work that reuses the
 * PR 1 invite / identity-link primitives.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  createOrRefreshInvite,
  findLinkableUserByEmail,
  upsertIdentityLink,
} from "./identity-db";
import { normalizeEmail } from "./identity-resolver";

function firstRow<T = any>(res: any): T | undefined {
  return (res?.rows?.[0] as T | undefined) ?? undefined;
}

// ── Pure input validation / sanitisation ────────────────────────────────────

export interface RawAccessRequestInput {
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  phone?: unknown;
  businessName?: unknown;
  tradeType?: unknown;
  licenseNumber?: unknown;
  requestedCompany?: unknown;
  message?: unknown;
}

export interface CleanAccessRequest {
  firstName: string;
  lastName: string;
  email: string; // lower-cased
  phone: string | null;
  businessName: string | null;
  tradeType: string | null;
  licenseNumber: string | null;
  requestedCompanyHint: string | null;
  message: string | null;
}

export type ValidationResult =
  | { ok: true; value: CleanAccessRequest }
  | { ok: false; message: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trim, collapse whitespace, cap length, strip control chars. Empty → null. */
function clean(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return s.length ? s : null;
}

export function normalizeAccessRequestInput(raw: RawAccessRequestInput): ValidationResult {
  const firstName = clean(raw.firstName, 80);
  const lastName = clean(raw.lastName, 80);
  const emailRaw = clean(raw.email, 254);
  if (!firstName || !lastName) return { ok: false, message: "First and last name are required." };
  if (!emailRaw || !EMAIL_RE.test(emailRaw)) return { ok: false, message: "A valid email address is required." };
  const message = clean(raw.message, 2000);
  return {
    ok: true,
    value: {
      firstName,
      lastName,
      email: normalizeEmail(emailRaw),
      phone: clean(raw.phone, 40),
      businessName: clean(raw.businessName, 160),
      tradeType: clean(raw.tradeType, 80),
      licenseNumber: clean(raw.licenseNumber, 80),
      requestedCompanyHint: clean(raw.requestedCompany, 160),
      message,
    },
  };
}

// ── Lightweight in-memory IP abuse guard (mirrors server/diagnostics.ts) ─────

const buckets = new Map<string, { count: number; resetAt: number }>();

/** Returns true when the caller is over the limit for this window. */
export function isRateLimited(ip: string, limit = 5, windowMs = 60 * 60 * 1000): boolean {
  const key = ip || "unknown";
  const now = Date.now();
  const cur = buckets.get(key);
  if (!cur || now > cur.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  cur.count += 1;
  return cur.count > limit;
}

// ── Public: create (or coalesce onto an existing) pending request ────────────

export interface SubmitContext {
  sourceIp: string | null;
  userAgent: string | null;
}

/**
 * Idempotent for the caller: if a pending request already exists for this email
 * it is refreshed (contact fields updated, timestamp bumped) and the SAME
 * response shape is returned — the public caller can never tell whether a row
 * was created or already existed. Never returns the row id or any internal id.
 */
export async function submitAccessRequest(
  input: CleanAccessRequest,
  ctx: SubmitContext,
): Promise<{ status: "received" }> {
  const existing = firstRow<{ id: string }>(await db.execute(sql`
    SELECT id FROM contractor_access_requests
    WHERE LOWER(email) = ${input.email} AND status = 'pending'
    LIMIT 1
  `));

  if (existing?.id) {
    await db.execute(sql`
      UPDATE contractor_access_requests
      SET first_name = ${input.firstName}, last_name = ${input.lastName},
          phone = ${input.phone}, business_name = ${input.businessName},
          trade_type = ${input.tradeType}, license_number = ${input.licenseNumber},
          requested_company_hint = ${input.requestedCompanyHint}, message = ${input.message},
          source_ip = ${ctx.sourceIp}, user_agent = ${ctx.userAgent}, updated_at = NOW()
      WHERE id = ${existing.id}
    `);
    return { status: "received" };
  }

  await db.execute(sql`
    INSERT INTO contractor_access_requests
      (email, first_name, last_name, phone, business_name, trade_type, license_number,
       requested_company_hint, message, status, source_ip, user_agent)
    VALUES
      (${input.email}, ${input.firstName}, ${input.lastName}, ${input.phone}, ${input.businessName},
       ${input.tradeType}, ${input.licenseNumber}, ${input.requestedCompanyHint}, ${input.message},
       'pending', ${ctx.sourceIp}, ${ctx.userAgent})
  `);
  return { status: "received" };
}

// ── Admin: list ─────────────────────────────────────────────────────────────

export interface AccessRequestRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  businessName: string | null;
  tradeType: string | null;
  licenseNumber: string | null;
  requestedCompanyHint: string | null;
  message: string | null;
  status: string;
  companyId: string | null;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  reviewNote: string | null;
  createdWorkerId: string | null;
  linkedUserId: string | null;
  createdAt: Date | null;
}

function mapRow(r: any): AccessRequestRow {
  return {
    id: r.id, email: r.email, firstName: r.first_name, lastName: r.last_name,
    phone: r.phone ?? null, businessName: r.business_name ?? null, tradeType: r.trade_type ?? null,
    licenseNumber: r.license_number ?? null, requestedCompanyHint: r.requested_company_hint ?? null,
    message: r.message ?? null, status: r.status, companyId: r.company_id ?? null,
    reviewedByUserId: r.reviewed_by_user_id ?? null, reviewedAt: r.reviewed_at ? new Date(r.reviewed_at) : null,
    rejectionReason: r.rejection_reason ?? null, reviewNote: r.review_note ?? null,
    createdWorkerId: r.created_worker_id ?? null, linkedUserId: r.linked_user_id ?? null,
    createdAt: r.created_at ? new Date(r.created_at) : null,
  };
}

/**
 * Requests visible to a company admin: those already assigned to their company,
 * PLUS still-unassigned pending requests (any admin can claim one by approving
 * it). Never shows requests already claimed by another company.
 */
export async function listAccessRequestsForCompany(companyId: string, status?: string): Promise<AccessRequestRow[]> {
  const statusFilter = status ? sql`AND status = ${status}` : sql``;
  const res = await db.execute(sql`
    SELECT * FROM contractor_access_requests
    WHERE (company_id = ${companyId} OR (company_id IS NULL AND status = 'pending'))
      ${statusFilter}
    ORDER BY created_at DESC
    LIMIT 500
  `);
  return (res.rows || []).map(mapRow);
}

async function loadClaimableRequest(id: string, companyId: string): Promise<any | null> {
  const r = firstRow<any>(await db.execute(sql`
    SELECT * FROM contractor_access_requests
    WHERE id = ${id} AND (company_id = ${companyId} OR company_id IS NULL)
    LIMIT 1
  `));
  return r ?? null;
}

// ── Admin: reject ───────────────────────────────────────────────────────────

export async function rejectAccessRequest(
  id: string, companyId: string, reviewerUserId: string, reason: string,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const row = await loadClaimableRequest(id, companyId);
  if (!row) return { ok: false, status: 404, message: "Request not found" };
  if (row.status !== "pending") return { ok: false, status: 409, message: `Request is already ${row.status}.` };
  await db.execute(sql`
    UPDATE contractor_access_requests
    SET status = 'rejected', rejection_reason = ${reason || "Rejected"},
        company_id = COALESCE(company_id, ${companyId}),
        reviewed_by_user_id = ${reviewerUserId}, reviewed_at = NOW(), updated_at = NOW()
    WHERE id = ${id}
  `);
  return { ok: true };
}

// ── Admin: approve ──────────────────────────────────────────────────────────

export interface ApproveResult {
  ok: true;
  outcome: "invited" | "linked" | "needs_review";
  workerId: string;
  email: string;
  reviewNote: string | null;
  invite?: { rawToken: string; expiresAt: Date }; // only when outcome === 'invited'
}
export type ApproveOutcome = ApproveResult | { ok: false; status: number; message: string };

/**
 * Approve a pending request for the reviewer's company. Reuses the existing
 * contractor worker for that email in that company if one exists, otherwise
 * creates one. Then, deterministically and company-scoped:
 *   - a single existing login account for the email, not yet bound elsewhere
 *     → link it (identity_link active, set users.worker_id), no invite.
 *   - a single account already bound to a DIFFERENT worker, OR multiple
 *     accounts share the email → do NOT auto-link; flag review_note and issue
 *     a fresh invite (a new login) so nothing ambiguous is merged.
 *   - no account → issue a fresh contractor invite.
 * A cross-company account is never found (the lookup is company-scoped) so it
 * naturally falls to the "no account → invite" path.
 */
export async function approveAccessRequest(
  id: string, companyId: string, reviewerUserId: string,
): Promise<ApproveOutcome> {
  const row = await loadClaimableRequest(id, companyId);
  if (!row) return { ok: false, status: 404, message: "Request not found" };
  if (row.status !== "pending") return { ok: false, status: 409, message: `Request is already ${row.status}.` };
  const email = normalizeEmail(row.email);
  if (!email) return { ok: false, status: 400, message: "Request has no usable email." };

  try {
    await db.execute(sql`BEGIN`);

    // Re-check pending under lock (guards a double-approve race).
    const locked = firstRow<{ status: string }>(await db.execute(sql`
      SELECT status FROM contractor_access_requests WHERE id = ${id} FOR UPDATE
    `));
    if (!locked || locked.status !== "pending") {
      await db.execute(sql`ROLLBACK`);
      return { ok: false, status: 409, message: "Request is no longer pending." };
    }

    // Reuse or create the contractor worker (company-scoped, exact-email match).
    let worker = firstRow<{ id: string }>(await db.execute(sql`
      SELECT id FROM workers
      WHERE company_id = ${companyId} AND worker_type = 'contractor'
        AND LOWER(COALESCE(email, work_email, '')) = ${email}
      LIMIT 1
    `));
    if (!worker?.id) {
      // Employee number: contractor-scoped, reduce not spread (matches POST /api/workers).
      const nums = (await db.execute(sql`SELECT employee_number FROM workers WHERE company_id = ${companyId}`)).rows || [];
      const highest = nums.reduce((m: number, w: any) => {
        const n = parseInt(w.employee_number || "0", 10);
        return !isNaN(n) && n > m ? n : m;
      }, 0);
      worker = firstRow<{ id: string }>(await db.execute(sql`
        INSERT INTO workers (company_id, first_name, last_name, email, phone, worker_type, contractor_type, worker_group, employee_number, pay_rate, status, is_active)
        VALUES (${companyId}, ${row.first_name}, ${row.last_name}, ${email}, ${row.phone ?? null},
                'contractor', 'invoice', 'invoiced_contractor', ${String(highest > 0 ? highest + 1 : 1001)}, '0', 'active', TRUE)
        RETURNING id
      `));
    }
    const workerId = worker!.id;

    // Deterministic, company-scoped account lookup.
    const lookup = await findLinkableUserByEmail(email, companyId);
    let outcome: ApproveResult["outcome"];
    let reviewNote: string | null = null;
    let inviteResult: { rawToken: string; expiresAt: Date } | undefined;
    let linkedUserId: string | null = null;

    if (lookup.outcome === "found" && !lookup.alreadyLinkedWorkerId) {
      await upsertIdentityLink({
        userId: lookup.userId, subjectType: "worker", subjectId: workerId, companyId,
        linkStatus: "active", verifiedEmail: email, linkedByUserId: reviewerUserId,
      });
      await db.execute(sql`UPDATE users SET worker_id = ${workerId} WHERE id = ${lookup.userId} AND worker_id IS NULL`);
      linkedUserId = lookup.userId;
      outcome = "linked";
    } else {
      if (lookup.outcome === "found" && lookup.alreadyLinkedWorkerId && lookup.alreadyLinkedWorkerId !== workerId) {
        reviewNote = "An account with this email is already linked to another worker — issued a fresh invite instead of linking.";
        outcome = "needs_review";
      } else if (lookup.outcome === "ambiguous") {
        reviewNote = `${lookup.count} accounts share this email — issued a fresh invite; link manually if appropriate.`;
        outcome = "needs_review";
      } else {
        outcome = "invited";
      }
      const inv = await createOrRefreshInvite({
        companyId, email, relationshipKind: "contractor", relationshipId: workerId,
        role: "contractor", invitedByUserId: reviewerUserId,
      });
      inviteResult = { rawToken: inv.rawToken, expiresAt: inv.expiresAt };
      await db.execute(sql`
        UPDATE contractor_access_requests SET account_invite_id = ${inv.id} WHERE id = ${id}
      `);
    }

    await db.execute(sql`
      UPDATE contractor_access_requests
      SET status = 'approved', company_id = ${companyId}, created_worker_id = ${workerId},
          linked_user_id = ${linkedUserId}, review_note = ${reviewNote},
          reviewed_by_user_id = ${reviewerUserId}, reviewed_at = NOW(), updated_at = NOW()
      WHERE id = ${id}
    `);

    await db.execute(sql`COMMIT`);
    return { ok: true, outcome, workerId, email, reviewNote, invite: inviteResult };
  } catch (e) {
    await db.execute(sql`ROLLBACK`).catch(() => {});
    throw e;
  }
}
