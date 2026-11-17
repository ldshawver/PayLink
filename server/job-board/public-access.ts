/**
 * Job board — public discovery, access requests and limited applicant
 * identities (migration 0030).
 *
 * Security model
 * - The company code is DISCOVERY ONLY. It never authenticates, never grants
 *   submission authority, and is stored only as a SHA-256 lookup hash.
 * - Unknown, disabled, suspended, tenant-inconsistent and private boards all
 *   produce the same generic outcome (`null` → the route answers one fixed
 *   404 body). Callers add a response-time floor so timing does not separate
 *   them either.
 * - Anonymous visitors see only the allowlisted public projection of
 *   `public` employee/contractor postings. `access_required` / NULL /
 *   `invite_only` postings are never projected publicly.
 * - Access-request submission always answers the same generic acknowledgement,
 *   whether or not a row was written (unknown code, closed requests, duplicate
 *   pending request, existing applicant) — no account/request existence leak.
 * - Approving an APPLICANT request creates a `job_applicants` identity in
 *   `pending_activation` and a single-use, expiring activation token (hash
 *   only). It never creates a worker, contractor, proposal, contract,
 *   invoice, payroll or payment record.
 * - Approving a CONTRACTOR request forwards the person into the EXISTING
 *   contractor_access_requests queue (pending). The existing reviewed flow
 *   creates the contractor worker + account invite; nothing here does.
 * - Activation consumes the token exactly once (row lock), verifies the
 *   applicant's email by token possession, creates a `users` row with role
 *   'applicant' (no worker_id) and activates the identity. Invalid, expired,
 *   revoked and replayed tokens fail with one generic message.
 * - No outbound email/SMS is sent from this module: the activation link is
 *   returned once to the approving administrator to deliver to the
 *   applicant's email address.
 */
import crypto from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { dateOnlyString, submissionCta, submissionsOpen } from "./rules";
import { canManage, fail, requireGate, requireManage, run, tx, UUID_RE, type JobBoardActor, type JobBoardDeps } from "./service";

type Q = Pool | PoolClient;

// ── Constants ───────────────────────────────────────────────────────────────
export const PUBLIC_NOT_AVAILABLE = "This job board is not available.";
export const ACCESS_REQUEST_ACK = "Thank you. If this board accepts requests, the company will review yours and contact you by email.";
export const ACTIVATION_FAILED = "This link is invalid or has expired. Ask the company for a new invitation.";
export const ACTIVATION_TTL_HOURS = 72;
export const CODE_MIN = 6;
export const CODE_MAX = 32;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

// ── Pure helpers ────────────────────────────────────────────────────────────
export function normalizeCode(raw: unknown): string | null {
  const s = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.length >= CODE_MIN && s.length <= CODE_MAX ? s : null;
}
export function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}
export function codeLookupHash(code: string): string {
  return sha256Hex(`job-board-code:${code}`);
}
export function generateCode(): string {
  const bytes = crypto.randomBytes(10);
  let out = "";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out; // 10 chars ≈ 50 bits
}
export function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}
export function tokenHash(token: string): string {
  return sha256Hex(`job-board-token:${token}`);
}
export function hashIp(ip: string | null | undefined, salt: string): string | null {
  return ip ? sha256Hex(`${salt}:${ip}`) : null;
}
export function normalizeEmail(raw: unknown): string | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  return s;
}

/** Wait until at least `floorMs` have passed since `startedAt` (timing equalization). */
export async function responseFloor(startedAt: number, floorMs: number): Promise<void> {
  const left = floorMs - (Date.now() - startedAt);
  if (left > 0) await new Promise((r) => setTimeout(r, left));
}

/** Effective public visibility; NULL (never chosen) behaves as access_required. */
export function effectivePublicVisibility(p: { public_visibility?: string | null }): "public" | "access_required" | "invite_only" {
  const v = p.public_visibility;
  return v === "public" || v === "invite_only" ? v : "access_required";
}

/**
 * The ONLY projection anonymous visitors ever receive. Allowlisted fields:
 * reference, title, approved public description, classification + CTA,
 * schedule, location TYPE, compensation only when the administrator enabled
 * it, deadline, required skills. Nothing else — no internal description,
 * notes, company/tenant ids, attachments, submissions or counts.
 */
export function projectPostForPublic(p: Record<string, any>) {
  const showPay = p.public_show_compensation === true && p.compensation_type !== "undisclosed";
  return {
    ref: p.id,
    title: p.title,
    description: p.public_description ?? null,
    workerClassification: p.worker_classification,
    cta: submissionCta(p),
    scheduleType: p.schedule_type,
    workLocationType: p.work_location_type,
    compensation: showPay ? { type: p.compensation_type, min: p.compensation_min ?? null, max: p.compensation_max ?? null, currency: p.currency ?? "USD" } : null,
    applicationDeadline: p.application_deadline ?? null,
    requiredSkills: Array.isArray(p.required_skills) ? p.required_skills : [],
    startDate: dateOnlyString(p.start_date),
  };
}
export const PUBLIC_POST_FIELDS = ["ref", "title", "description", "workerClassification", "cta", "scheduleType", "workLocationType",
  "compensation", "applicationDeadline", "requiredSkills", "startDate"] as const;

export function projectBranding(s: Record<string, any>) {
  return {
    displayName: s.display_name || "Job board",
    tagline: s.tagline ?? null,
    brandColor: s.brand_color ?? null,
    acceptsContractorRequests: s.accept_contractor_requests === true,
    acceptsApplicantRequests: s.accept_applicant_requests === true,
  };
}

// ── Readiness ───────────────────────────────────────────────────────────────
export async function publicAccessSchemaReady(pool: Pool): Promise<boolean> {
  const r = await pool.query(
    `SELECT to_regclass('public.job_board_settings') a, to_regclass('public.job_applicants') b,
            to_regclass('public.job_board_access_requests') c, to_regclass('public.job_board_invitations') d,
            to_regclass('public.job_post_access_grants') e, to_regclass('public.job_board_access_events') f`);
  const x = r.rows[0] ?? {};
  return !!(x.a && x.b && x.c && x.d && x.e && x.f);
}

// ── Audit ───────────────────────────────────────────────────────────────────
export async function accessEvent(q: Q, e: {
  tenantId: string; companyId: string; type: string; accessRequestId?: string | null; applicantId?: string | null;
  invitationId?: string | null; jobPostId?: string | null; actorUserId?: string | null; details?: Record<string, unknown> | null;
}) {
  await q.query(
    `INSERT INTO job_board_access_events (tenant_id, company_id, event_type, access_request_id, applicant_id, invitation_id, job_post_id, actor_user_id, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [e.tenantId, e.companyId, e.type, e.accessRequestId ?? null, e.applicantId ?? null, e.invitationId ?? null, e.jobPostId ?? null,
      e.actorUserId ?? null, e.details ? JSON.stringify(e.details) : null]);
}

// ── Board resolution (generic on every failure) ─────────────────────────────
interface Board { companyId: string; tenantId: string; settings: Record<string, any> }

/**
 * Code → board, or null for: malformed code, unknown code, disabled board,
 * company/tenant mismatch, or a tenant the gate does not allow (suspended,
 * cancelled, expired). Every null is indistinguishable to the caller.
 */
export async function resolveBoard(deps: JobBoardDeps, rawCode: unknown): Promise<Board | null> {
  const code = normalizeCode(rawCode);
  const hash = codeLookupHash(code ?? "invalid-code-placeholder"); // always hash (timing)
  const r = await deps.pool.query(`SELECT * FROM job_board_settings WHERE code_lookup_hash = $1 LIMIT 1`, [hash]);
  const s = r.rows[0];
  if (!code || !s || s.board_enabled !== true) return null;
  const tenant = await deps.tenantIdForCompany(s.company_id).catch(() => null);
  if (!tenant || tenant !== s.tenant_id) return null;
  const gate = await deps.tenantGate(s.company_id).catch(() => ({ allowed: false }));
  if (!gate.allowed) return null;
  return { companyId: s.company_id, tenantId: s.tenant_id, settings: s };
}

// ── Public (anonymous) ──────────────────────────────────────────────────────
export async function publicBoard(deps: JobBoardDeps, rawCode: unknown) {
  const board = await resolveBoard(deps, rawCode);
  if (!board) return null;
  const now = deps.now?.() ?? new Date();
  const r = await deps.pool.query(
    `SELECT * FROM job_posts WHERE company_id = $1 AND status = 'published' AND public_visibility = 'public'
      ORDER BY application_deadline NULLS LAST, published_at DESC LIMIT 200`, [board.companyId]);
  const postings = r.rows.filter((p: any) => submissionsOpen(p, now).ok).map(projectPostForPublic);
  return { branding: projectBranding(board.settings), postings };
}

export async function publicPosting(deps: JobBoardDeps, rawCode: unknown, ref: unknown) {
  const board = await resolveBoard(deps, rawCode);
  if (!board || !UUID_RE.test(String(ref ?? ""))) return null;
  const r = await deps.pool.query(
    `SELECT * FROM job_posts WHERE id = $1 AND company_id = $2 AND status = 'published' AND public_visibility = 'public'`, [ref, board.companyId]);
  const p = r.rows[0];
  if (!p || !submissionsOpen(p, deps.now?.()).ok) return null;
  return { branding: projectBranding(board.settings), posting: projectPostForPublic(p) };
}

export interface AccessRequestInput {
  code: unknown; kind: unknown; firstName: unknown; lastName: unknown; email: unknown; phone?: unknown; message?: unknown; postingRef?: unknown;
}

/** Field validation errors are about the caller's own input only — never about the board or other people. */
export function validateAccessRequestInput(b: AccessRequestInput):
  { ok: true; v: { kind: "contractor" | "applicant"; firstName: string; lastName: string; email: string; phone: string | null; message: string | null; postingRef: string | null } }
  | { ok: false; message: string } {
  const kind = b.kind === "contractor" || b.kind === "applicant" ? b.kind : null;
  if (!kind) return { ok: false, message: "Choose whether you are requesting contractor or employment access" };
  const first = String(b.firstName ?? "").trim().slice(0, 100);
  const last = String(b.lastName ?? "").trim().slice(0, 100);
  if (!first || !last) return { ok: false, message: "Enter your first and last name" };
  const email = normalizeEmail(b.email);
  if (!email) return { ok: false, message: "Enter a valid email address" };
  const phone = b.phone ? String(b.phone).trim().slice(0, 40) || null : null;
  const message = b.message ? String(b.message).trim().slice(0, 2000) || null : null;
  const postingRef = b.postingRef && UUID_RE.test(String(b.postingRef)) ? String(b.postingRef) : null;
  return { ok: true, v: { kind, firstName: first, lastName: last, email, phone, message, postingRef } };
}

/**
 * Always resolves to the same generic acknowledgement. A row is written only
 * when the board exists, is enabled and accepts this kind, and no pending
 * request (or active applicant identity) already exists for that email.
 */
export async function submitPublicAccessRequest(deps: JobBoardDeps, input: AccessRequestInput, ctx: { ipHash: string | null; userAgent: string | null }): Promise<void> {
  const val = validateAccessRequestInput(input);
  if (!val.ok) return;
  const v = val.v;
  const board = await resolveBoard(deps, input.code);
  if (!board) return;
  const accepts = v.kind === "contractor" ? board.settings.accept_contractor_requests : board.settings.accept_applicant_requests;
  if (accepts !== true) return;
  await tx(deps.pool, async (c) => {
    let postId: string | null = null;
    if (v.postingRef) {
      const p = await c.query(`SELECT id, worker_classification, public_visibility, status FROM job_posts WHERE id = $1 AND company_id = $2`, [v.postingRef, board.companyId]);
      const row = p.rows[0];
      const wantCls = v.kind === "contractor" ? "contractor" : "employee";
      if (row && row.status === "published" && row.worker_classification === wantCls && row.public_visibility !== "invite_only") postId = row.id;
    }
    if (v.kind === "applicant") {
      const a = await c.query(`SELECT status FROM job_applicants WHERE company_id = $1 AND email_normalized = $2`, [board.companyId, v.email]);
      if (a.rows[0]?.status === "active") return; // already has access — silent
    }
    const ins = await c.query(
      `INSERT INTO job_board_access_requests (tenant_id, company_id, request_kind, job_post_id, email_normalized, first_name, last_name, phone, message, source_ip_hash, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (company_id, request_kind, email_normalized) WHERE status = 'pending' DO NOTHING
       RETURNING id`,
      [board.tenantId, board.companyId, v.kind, postId, v.email, v.firstName, v.lastName, v.phone, v.message, ctx.ipHash, ctx.userAgent ? String(ctx.userAgent).slice(0, 300) : null]);
    if (ins.rows[0]) {
      await accessEvent(c, { tenantId: board.tenantId, companyId: board.companyId, type: "access_request_submitted", accessRequestId: ins.rows[0].id, jobPostId: postId, details: { kind: v.kind } });
    }
  });
}

// ── Applicant identity: see ./applicant-visibility.ts ───────────────────────
export { loadApplicantIdentity, applicantCanSeePost, APPLICANT_VISIBLE_SQL, type ApplicantIdentity } from "./applicant-visibility";

// ── Activation (token → applicant user) ─────────────────────────────────────
export interface ActivationInput { token: unknown; username: unknown; password: unknown }

export function validateActivationCredentials(username: unknown, password: unknown): { ok: true; username: string; password: string } | { ok: false; message: string } {
  const u = String(username ?? "").trim();
  if (!/^[A-Za-z0-9._-]{4,40}$/.test(u)) return { ok: false, message: "Choose a username of 4–40 letters, numbers, dots, dashes or underscores" };
  const p = String(password ?? "");
  if (p.length < 12 || p.length > 200) return { ok: false, message: "Choose a password of at least 12 characters" };
  return { ok: true, username: u, password: p };
}

/**
 * Consume an activation token exactly once and activate the applicant.
 * Returns { ok:false, generic:true } for every token problem (unknown,
 * expired, revoked, consumed, wrong purpose, disabled applicant, suspended
 * tenant) so a caller cannot tell them apart.
 */
export async function activateApplicant(deps: JobBoardDeps, input: ActivationInput, hashPassword: (p: string) => Promise<string>):
  Promise<{ ok: true; username: string } | { ok: false; status: number; message: string }> {
  const cred = validateActivationCredentials(input.username, input.password);
  if (!cred.ok) return { ok: false, status: 400, message: cred.message };
  const raw = String(input.token ?? "");
  if (raw.length < 20 || raw.length > 200) return { ok: false, status: 400, message: ACTIVATION_FAILED };
  const pwHash = await hashPassword(cred.password);
  const now = deps.now?.() ?? new Date();
  try {
    return await tx(deps.pool, async (c) => {
      const r = await c.query(`SELECT * FROM job_board_invitations WHERE token_hash = $1 FOR UPDATE`, [tokenHash(raw)]);
      const inv = r.rows[0];
      const generic = { ok: false as const, status: 400, message: ACTIVATION_FAILED };
      if (!inv || inv.purpose !== "applicant_activation" || inv.consumed_at || inv.revoked_at || new Date(inv.expires_at).getTime() <= now.getTime()) return generic;
      const ar = await c.query(`SELECT * FROM job_applicants WHERE id = $1 FOR UPDATE`, [inv.applicant_id]);
      const ap = ar.rows[0];
      if (!ap || ap.status !== "pending_activation" || ap.company_id !== inv.company_id) return generic;
      const gate = await deps.tenantGate(ap.company_id).catch(() => ({ allowed: false }));
      if (!gate.allowed) return generic;
      const taken = await c.query(`SELECT 1 FROM users WHERE lower(username) = lower($1)`, [cred.username]);
      if (taken.rows.length) return { ok: false as const, status: 409, message: "That username is not available. Choose another." };
      const userId = crypto.randomUUID();
      await c.query(
        `INSERT INTO users (id, username, password, role, company_id, worker_id, email, first_name, last_name, email_verified_at)
         VALUES ($1,$2,$3,'applicant',$4,NULL,$5,$6,$7,now())`,
        [userId, cred.username, pwHash, ap.company_id, ap.email_normalized, ap.first_name, ap.last_name]);
      await c.query(
        `UPDATE job_applicants SET user_id = $2, status = 'active', email_verified_at = now(), activated_at = now(), updated_at = now() WHERE id = $1`,
        [ap.id, userId]);
      await c.query(`UPDATE job_board_invitations SET consumed_at = now() WHERE id = $1`, [inv.id]);
      await accessEvent(c, { tenantId: ap.tenant_id, companyId: ap.company_id, type: "invitation_consumed", applicantId: ap.id, invitationId: inv.id, actorUserId: userId });
      await accessEvent(c, { tenantId: ap.tenant_id, companyId: ap.company_id, type: "applicant_activated", applicantId: ap.id, actorUserId: userId, details: { emailVerifiedBy: "single_use_token" } });
      return { ok: true as const, username: cred.username };
    });
  } catch (e: any) {
    if (e?.code === "23505") return { ok: false, status: 409, message: "That username is not available. Choose another." };
    throw e;
  }
}

// ── Administrator ───────────────────────────────────────────────────────────
function projectSettings(s: any | null) {
  return {
    boardEnabled: s?.board_enabled === true,
    codeHint: s?.code_hint ?? null,
    codeRotatedAt: s?.code_rotated_at ?? null,
    displayName: s?.display_name ?? null,
    tagline: s?.tagline ?? null,
    brandColor: s?.brand_color ?? null,
    acceptContractorRequests: s?.accept_contractor_requests === true,
    acceptApplicantRequests: s?.accept_applicant_requests === true,
    updatedAt: s?.updated_at ?? null,
  };
}

async function ensureSettings(deps: JobBoardDeps, c: PoolClient, companyId: string): Promise<any> {
  const tenantId = await deps.tenantIdForCompany(companyId);
  if (!tenantId) fail(409, "This company is not attached to a tenant");
  await c.query(`INSERT INTO job_board_settings (tenant_id, company_id) VALUES ($1,$2) ON CONFLICT (company_id) DO NOTHING`, [tenantId, companyId]);
  const r = await c.query(`SELECT * FROM job_board_settings WHERE company_id = $1 FOR UPDATE`, [companyId]);
  if (r.rows[0].tenant_id !== tenantId) fail(404, "Company not found");
  return r.rows[0];
}

export function getBoardSettings(deps: JobBoardDeps, actor: JobBoardActor, companyId: string) {
  return run(async () => {
    await requireManage(actor, companyId, "Company not found");
    const r = await deps.pool.query(`SELECT * FROM job_board_settings WHERE company_id = $1`, [companyId]);
    return { body: projectSettings(r.rows[0] ?? null) };
  });
}

export function updateBoardSettings(deps: JobBoardDeps, actor: JobBoardActor, companyId: string, body: Record<string, unknown>) {
  return run(async () => {
    await requireManage(actor, companyId, "Company not found");
    await requireGate(deps, companyId);
    const sets: string[] = []; const params: unknown[] = [];
    const add = (col: string, v: unknown) => { params.push(v); sets.push(`${col} = $${params.length + 1}`); };
    const bool = (k: string) => { if (k in (body ?? {})) { if (typeof body[k] !== "boolean") fail(400, `Invalid ${k}`); return true; } return false; };
    if (bool("boardEnabled")) add("board_enabled", body.boardEnabled);
    if (bool("acceptContractorRequests")) add("accept_contractor_requests", body.acceptContractorRequests);
    if (bool("acceptApplicantRequests")) add("accept_applicant_requests", body.acceptApplicantRequests);
    if ("displayName" in body) add("display_name", body.displayName ? String(body.displayName).trim().slice(0, 120) || null : null);
    if ("tagline" in body) add("tagline", body.tagline ? String(body.tagline).trim().slice(0, 240) || null : null);
    if ("brandColor" in body) {
      const c = body.brandColor ? String(body.brandColor).trim() : null;
      if (c && !/^#[0-9A-Fa-f]{6}$/.test(c)) fail(400, "Brand colour must look like #1A2B3C");
      add("brand_color", c);
    }
    if (!sets.length) fail(400, "No settings supplied");
    return tx(deps.pool, async (c) => {
      const before = await ensureSettings(deps, c, companyId);
      if (body.boardEnabled === true && !before.code_lookup_hash) fail(409, "Generate a board code before enabling the public board");
      const u = await c.query(`UPDATE job_board_settings SET ${sets.join(", ")}, updated_by_user_id = $${params.length + 2}, updated_at = now() WHERE company_id = $1 RETURNING *`,
        [companyId, ...params, actor.userId]);
      await accessEvent(c, { tenantId: before.tenant_id, companyId, type: "board_settings_updated", actorUserId: actor.userId,
        details: { fields: Object.keys(body).filter((k) => k !== "companyId") } });
      return { body: projectSettings(u.rows[0]) };
    });
  });
}

/** Rotate the discovery code. The plaintext is returned ONCE; only its hash is stored. */
export function rotateBoardCode(deps: JobBoardDeps, actor: JobBoardActor, companyId: string) {
  return run(async () => {
    await requireManage(actor, companyId, "Company not found");
    await requireGate(deps, companyId);
    return tx(deps.pool, async (c) => {
      const s = await ensureSettings(deps, c, companyId);
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateCode();
        try {
          await c.query("SAVEPOINT rotate");
          await c.query(`UPDATE job_board_settings SET code_lookup_hash = $2, code_hint = $3, code_rotated_at = now(), updated_by_user_id = $4, updated_at = now() WHERE company_id = $1`,
            [companyId, codeLookupHash(code), code.slice(-3), actor.userId]);
          await c.query("RELEASE SAVEPOINT rotate");
          await accessEvent(c, { tenantId: s.tenant_id, companyId, type: "board_code_rotated", actorUserId: actor.userId, details: { hint: code.slice(-3) } });
          return { body: { code, codeHint: code.slice(-3), notice: "Copy this code now — it is shown only once." } };
        } catch (e: any) {
          await c.query("ROLLBACK TO SAVEPOINT rotate");
          if (e?.code !== "23505") throw e;
        }
      }
      fail(503, "Could not generate a unique code; try again");
    });
  });
}

function projectRequest(r: any) {
  return {
    id: r.id, kind: r.request_kind, status: r.status, firstName: r.first_name, lastName: r.last_name, email: r.email_normalized,
    phone: r.phone, message: r.message, jobPostId: r.job_post_id, jobTitle: r.job_title ?? null,
    reviewedAt: r.reviewed_at, decisionNote: r.decision_note, applicantId: r.applicant_id,
    contractorAccessRequestId: r.contractor_access_request_id, createdAt: r.created_at,
  };
}

export function listAccessRequests(deps: JobBoardDeps, actor: JobBoardActor, companyId: string, status?: string) {
  return run(async () => {
    await requireManage(actor, companyId, "Company not found");
    const st = status && ["pending", "approved", "denied", "withdrawn", "expired"].includes(status) ? status : null;
    const r = await deps.pool.query(
      `SELECT r.*, p.title AS job_title FROM job_board_access_requests r LEFT JOIN job_posts p ON p.id = r.job_post_id AND p.company_id = r.company_id
        WHERE r.company_id = $1 AND ($2::text IS NULL OR r.status = $2) ORDER BY r.created_at DESC LIMIT 500`, [companyId, st]);
    return { body: r.rows.map(projectRequest) };
  });
}

async function loadRequestForReview(deps: JobBoardDeps, c: PoolClient, actor: JobBoardActor, id: string) {
  if (!UUID_RE.test(String(id))) fail(404, "Request not found");
  const r = await c.query(`SELECT * FROM job_board_access_requests WHERE id = $1 FOR UPDATE`, [id]);
  const req = r.rows[0];
  if (!req) fail(404, "Request not found");
  await requireManage(actor, req.company_id, "Request not found");
  if ((await deps.tenantIdForCompany(req.company_id)) !== req.tenant_id) fail(404, "Request not found");
  if (req.status !== "pending") fail(409, `This request is already ${req.status}`);
  await requireGate(deps, req.company_id);
  return req;
}

/** Issue a fresh single-use activation token (revoking any live one). Returns the plaintext once. */
async function issueActivation(c: PoolClient, applicant: any, actorUserId: string, accessRequestId: string | null) {
  await c.query(
    `UPDATE job_board_invitations SET revoked_at = now(), revoked_by_user_id = $2
      WHERE applicant_id = $1 AND purpose = 'applicant_activation' AND consumed_at IS NULL AND revoked_at IS NULL`, [applicant.id, actorUserId]);
  const token = generateToken();
  const ins = await c.query(
    `INSERT INTO job_board_invitations (tenant_id, company_id, purpose, access_request_id, applicant_id, email_normalized, token_hash, expires_at, created_by_user_id)
     VALUES ($1,$2,'applicant_activation',$3,$4,$5,$6, now() + ($7 || ' hours')::interval, $8) RETURNING id, expires_at`,
    [applicant.tenant_id, applicant.company_id, accessRequestId, applicant.id, applicant.email_normalized, tokenHash(token), String(ACTIVATION_TTL_HOURS), actorUserId]);
  await accessEvent(c, { tenantId: applicant.tenant_id, companyId: applicant.company_id, type: "invitation_issued", applicantId: applicant.id,
    invitationId: ins.rows[0].id, accessRequestId, actorUserId, details: { purpose: "applicant_activation", expiresAt: ins.rows[0].expires_at } });
  return { token, expiresAt: ins.rows[0].expires_at as Date };
}

async function grantPostings(c: PoolClient, applicant: any, postIds: string[], source: "access_approval" | "invitation", actorUserId: string) {
  const granted: string[] = [];
  for (const pid of postIds) {
    const p = await c.query(`SELECT id, worker_classification FROM job_posts WHERE id = $1 AND company_id = $2`, [pid, applicant.company_id]);
    if (!p.rows[0]) fail(400, "Every posting must belong to this company");
    if (p.rows[0].worker_classification !== "employee") fail(409, "Applicants can only be granted employee positions");
    const g = await c.query(
      `INSERT INTO job_post_access_grants (tenant_id, company_id, job_post_id, applicant_id, grant_source, granted_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (job_post_id, applicant_id) WHERE revoked_at IS NULL DO NOTHING RETURNING id`,
      [applicant.tenant_id, applicant.company_id, pid, applicant.id, source, actorUserId]);
    if (g.rows[0]) {
      granted.push(pid);
      await accessEvent(c, { tenantId: applicant.tenant_id, companyId: applicant.company_id, type: "posting_grant_created", applicantId: applicant.id, jobPostId: pid, actorUserId });
    }
  }
  return granted;
}

/**
 * Approve. Applicant → applicant identity + activation token (+ optional
 * posting grants); NEVER a worker. Contractor → forwarded into the existing
 * contractor_access_requests queue; NEVER a worker here.
 */
export function approveAccessRequest(deps: JobBoardDeps, actor: JobBoardActor, id: string, body: { postingIds?: unknown; note?: unknown } = {}, baseUrl = "") {
  return run(async () => {
    const postingIds = Array.isArray(body?.postingIds) ? Array.from(new Set((body.postingIds as unknown[]).map(String))) : [];
    if (postingIds.some((p) => !UUID_RE.test(p)) || postingIds.length > 50) fail(400, "Invalid posting list");
    const note = body?.note ? String(body.note).trim().slice(0, 2000) : null;
    return tx(deps.pool, async (c) => {
      const req = await loadRequestForReview(deps, c, actor, id);
      if (req.request_kind === "applicant") {
        let ar = await c.query(`SELECT * FROM job_applicants WHERE company_id = $1 AND email_normalized = $2 FOR UPDATE`, [req.company_id, req.email_normalized]);
        let applicant = ar.rows[0];
        if (applicant?.status === "disabled") fail(409, "This applicant's access was disabled. Re-enable is not supported; deny this request.");
        if (!applicant) {
          ar = await c.query(
            `INSERT INTO job_applicants (tenant_id, company_id, email_normalized, first_name, last_name, created_from_request_id)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [req.tenant_id, req.company_id, req.email_normalized, req.first_name, req.last_name, req.id]);
          applicant = ar.rows[0];
          await accessEvent(c, { tenantId: req.tenant_id, companyId: req.company_id, type: "applicant_created", applicantId: applicant.id, accessRequestId: req.id, actorUserId: actor.userId });
        }
        const toGrant = postingIds.length ? postingIds : req.job_post_id ? [req.job_post_id] : [];
        const granted = await grantPostings(c, applicant, toGrant, "access_approval", actor.userId);
        let activation: { token: string; expiresAt: Date } | null = null;
        if (applicant.status === "pending_activation") activation = await issueActivation(c, applicant, actor.userId, req.id);
        await c.query(`UPDATE job_board_access_requests SET status = 'approved', reviewed_at = now(), reviewed_by_user_id = $2, decision_note = $3, applicant_id = $4, updated_at = now() WHERE id = $1`,
          [req.id, actor.userId, note, applicant.id]);
        await accessEvent(c, { tenantId: req.tenant_id, companyId: req.company_id, type: "access_request_approved", accessRequestId: req.id, applicantId: applicant.id, actorUserId: actor.userId,
          details: { kind: "applicant", grantedPostings: granted.length } });
        return { body: {
          kind: "applicant", applicantId: applicant.id, applicantStatus: applicant.status, grantedPostings: granted,
          activationUrl: activation ? `${baseUrl}/jobs/activate?token=${encodeURIComponent(activation.token)}` : null,
          activationExpiresAt: activation?.expiresAt ?? null,
          deliveryNotice: activation ? "Send this one-time link to the applicant's email address only. It expires and works once. No email was sent automatically." : null,
        } };
      }
      // Contractor → existing contractor access-request queue (pending review).
      const existing = await c.query(`SELECT id, company_id FROM contractor_access_requests WHERE LOWER(email) = $1 AND status = 'pending' FOR UPDATE`, [req.email_normalized]);
      let carId: string;
      if (existing.rows[0]) {
        if (existing.rows[0].company_id && existing.rows[0].company_id !== req.company_id) {
          fail(409, "A contractor access request for this email is already pending review elsewhere. Ask the contractor to try again later.");
        }
        carId = existing.rows[0].id;
        await c.query(`UPDATE contractor_access_requests SET company_id = $2, updated_at = now() WHERE id = $1`, [carId, req.company_id]);
      } else {
        const ins = await c.query(
          `INSERT INTO contractor_access_requests (company_id, email, first_name, last_name, phone, message, requested_company_hint, status, review_note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8) RETURNING id`,
          [req.company_id, req.email_normalized, req.first_name, req.last_name, req.phone, req.message, "Job board access request", "Forwarded from the public job board"]);
        carId = ins.rows[0].id;
      }
      await c.query(`UPDATE job_board_access_requests SET status = 'approved', reviewed_at = now(), reviewed_by_user_id = $2, decision_note = $3, contractor_access_request_id = $4, updated_at = now() WHERE id = $1`,
        [req.id, actor.userId, note, carId]);
      await accessEvent(c, { tenantId: req.tenant_id, companyId: req.company_id, type: "access_request_approved", accessRequestId: req.id, actorUserId: actor.userId,
        details: { kind: "contractor", forwardedTo: "contractor_access_requests" } });
      return { body: { kind: "contractor", contractorAccessRequestId: carId, nextStep: "Review and approve this contractor in Access Requests to send their account invitation." } };
    });
  });
}

export function denyAccessRequest(deps: JobBoardDeps, actor: JobBoardActor, id: string, body: { note?: unknown } = {}) {
  return run(async () => tx(deps.pool, async (c) => {
    const req = await loadRequestForReview(deps, c, actor, id);
    const note = body?.note ? String(body.note).trim().slice(0, 2000) : null;
    await c.query(`UPDATE job_board_access_requests SET status = 'denied', reviewed_at = now(), reviewed_by_user_id = $2, decision_note = $3, updated_at = now() WHERE id = $1`, [req.id, actor.userId, note]);
    await accessEvent(c, { tenantId: req.tenant_id, companyId: req.company_id, type: "access_request_denied", accessRequestId: req.id, actorUserId: actor.userId, details: { kind: req.request_kind } });
    return { body: { id: req.id, status: "denied" } };
  }));
}

function projectApplicant(a: any) {
  return { id: a.id, email: a.email_normalized, firstName: a.first_name, lastName: a.last_name, status: a.status,
    emailVerifiedAt: a.email_verified_at, activatedAt: a.activated_at, disabledAt: a.disabled_at, createdAt: a.created_at,
    activeGrants: a.active_grants ?? undefined };
}

export function listApplicants(deps: JobBoardDeps, actor: JobBoardActor, companyId: string) {
  return run(async () => {
    await requireManage(actor, companyId, "Company not found");
    const r = await deps.pool.query(
      `SELECT a.*, (SELECT count(*)::int FROM job_post_access_grants g WHERE g.applicant_id = a.id AND g.revoked_at IS NULL) AS active_grants
         FROM job_applicants a WHERE a.company_id = $1 ORDER BY a.created_at DESC LIMIT 500`, [companyId]);
    return { body: r.rows.map(projectApplicant) };
  });
}

async function loadApplicantForAdmin(deps: JobBoardDeps, c: Q, actor: JobBoardActor, id: string, lock = "") {
  if (!UUID_RE.test(String(id))) fail(404, "Applicant not found");
  const r = await c.query(`SELECT * FROM job_applicants WHERE id = $1 ${lock}`, [id]);
  const a = r.rows[0];
  if (!a) fail(404, "Applicant not found");
  await requireManage(actor, a.company_id, "Applicant not found");
  if ((await deps.tenantIdForCompany(a.company_id)) !== a.tenant_id) fail(404, "Applicant not found");
  return a;
}

/** Disable: identity + login account off, live tokens revoked. History stays readable to admins. */
export function disableApplicant(deps: JobBoardDeps, actor: JobBoardActor, id: string, body: { reason?: unknown } = {}) {
  return run(async () => tx(deps.pool, async (c) => {
    const a = await loadApplicantForAdmin(deps, c, actor, id, "FOR UPDATE");
    if (a.status === "disabled") return { body: projectApplicant(a) };
    const reason = body?.reason ? String(body.reason).trim().slice(0, 500) : null;
    const u = await c.query(`UPDATE job_applicants SET status = 'disabled', disabled_at = now(), disabled_reason = $2, updated_at = now() WHERE id = $1 RETURNING *`, [a.id, reason]);
    if (a.user_id) await c.query(`UPDATE users SET is_active = FALSE WHERE id = $1 AND role = 'applicant'`, [a.user_id]);
    await c.query(`UPDATE job_board_invitations SET revoked_at = now(), revoked_by_user_id = $2 WHERE applicant_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`, [a.id, actor.userId]);
    await accessEvent(c, { tenantId: a.tenant_id, companyId: a.company_id, type: "applicant_disabled", applicantId: a.id, actorUserId: actor.userId });
    return { body: projectApplicant(u.rows[0]) };
  }));
}

export function reissueActivation(deps: JobBoardDeps, actor: JobBoardActor, id: string, baseUrl = "") {
  return run(async () => tx(deps.pool, async (c) => {
    const a = await loadApplicantForAdmin(deps, c, actor, id, "FOR UPDATE");
    if (a.status !== "pending_activation") fail(409, "Only applicants who have not activated yet can be sent a new link");
    await requireGate(deps, a.company_id);
    const act = await issueActivation(c, a, actor.userId, null);
    return { status: 201, body: { activationUrl: `${baseUrl}/jobs/activate?token=${encodeURIComponent(act.token)}`, activationExpiresAt: act.expiresAt,
      deliveryNotice: "Send this one-time link to the applicant's email address only. Earlier links no longer work." } };
  }));
}

export function revokeInvitationToken(deps: JobBoardDeps, actor: JobBoardActor, invitationId: string) {
  return run(async () => tx(deps.pool, async (c) => {
    if (!UUID_RE.test(String(invitationId))) fail(404, "Invitation not found");
    const r = await c.query(`SELECT * FROM job_board_invitations WHERE id = $1 FOR UPDATE`, [invitationId]);
    const inv = r.rows[0];
    if (!inv) fail(404, "Invitation not found");
    await requireManage(actor, inv.company_id, "Invitation not found");
    if (inv.consumed_at) fail(409, "This invitation was already used");
    if (!inv.revoked_at) {
      await c.query(`UPDATE job_board_invitations SET revoked_at = now(), revoked_by_user_id = $2 WHERE id = $1`, [inv.id, actor.userId]);
      await accessEvent(c, { tenantId: inv.tenant_id, companyId: inv.company_id, type: "invitation_revoked", invitationId: inv.id, applicantId: inv.applicant_id, actorUserId: actor.userId });
    }
    return { body: { id: inv.id, revoked: true } };
  }));
}

export function grantApplicantPosting(deps: JobBoardDeps, actor: JobBoardActor, postId: string, applicantId: unknown) {
  return run(async () => tx(deps.pool, async (c) => {
    const a = await loadApplicantForAdmin(deps, c, actor, String(applicantId ?? ""), "FOR UPDATE");
    if (a.status === "disabled") fail(409, "This applicant's access is disabled");
    if (!UUID_RE.test(String(postId))) fail(404, "Job posting not found");
    await requireGate(deps, a.company_id);
    const granted = await grantPostings(c, a, [postId], "invitation", actor.userId);
    return { status: 201, body: { granted: granted.length } };
  }));
}

export function revokeApplicantGrant(deps: JobBoardDeps, actor: JobBoardActor, grantId: string) {
  return run(async () => tx(deps.pool, async (c) => {
    if (!UUID_RE.test(String(grantId))) fail(404, "Grant not found");
    const r = await c.query(`SELECT * FROM job_post_access_grants WHERE id = $1 FOR UPDATE`, [grantId]);
    const g = r.rows[0];
    if (!g) fail(404, "Grant not found");
    await requireManage(actor, g.company_id, "Grant not found");
    if (!g.revoked_at) {
      await c.query(`UPDATE job_post_access_grants SET revoked_at = now(), revoked_by_user_id = $2 WHERE id = $1`, [g.id, actor.userId]);
      await accessEvent(c, { tenantId: g.tenant_id, companyId: g.company_id, type: "posting_grant_revoked", applicantId: g.applicant_id, jobPostId: g.job_post_id, actorUserId: actor.userId });
    }
    return { body: { id: g.id, revoked: true } };
  }));
}

export function listPostingGrants(deps: JobBoardDeps, actor: JobBoardActor, postId: string) {
  return run(async () => {
    if (!UUID_RE.test(String(postId))) fail(404, "Job posting not found");
    const p = await deps.pool.query(`SELECT company_id FROM job_posts WHERE id = $1`, [postId]);
    if (!p.rows[0] || !(await canManage(actor, p.rows[0].company_id))) fail(404, "Job posting not found");
    const r = await deps.pool.query(
      `SELECT g.id, g.applicant_id, g.grant_source, g.granted_at, a.email_normalized, a.first_name, a.last_name, a.status
         FROM job_post_access_grants g JOIN job_applicants a ON a.id = g.applicant_id
        WHERE g.job_post_id = $1 AND g.company_id = $2 AND g.revoked_at IS NULL ORDER BY g.granted_at`, [postId, p.rows[0].company_id]);
    return { body: r.rows.map((g: any) => ({ id: g.id, applicantId: g.applicant_id, source: g.grant_source, grantedAt: g.granted_at,
      email: g.email_normalized, name: `${g.first_name ?? ""} ${g.last_name ?? ""}`.trim(), applicantStatus: g.status })) };
  });
}
