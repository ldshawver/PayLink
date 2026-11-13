/**
 * Contractor Hub job board — transactional service (migration 0029).
 *
 * Every operation re-derives authorization from STORED data:
 *   posting/bid id → load row → stored company_id (+ tenant consistency) →
 *   actor.canManageCompany(company)  (administrators/managers), or
 *   actor.contractor (worker id + worker company) for contractor operations.
 * Request-supplied company ids are only ever used for list scoping after the
 * route has authorized them. Cross-company / cross-tenant / other-contractor
 * rows answer 404 so existence never leaks.
 *
 * State changes validate through ./rules, run inside one transaction with row
 * locks taken in a fixed order (posting → bid) and write an immutable event to
 * contractor_job_bid_events in the same transaction. Notifications are in-app
 * only (contractor_notifications), written after commit, best-effort, and never
 * carry bid amounts or documents.
 *
 * Dependencies are injected (pool, tenant gate, tenant lookup) so the DB test
 * suite drives the real SQL against a disposable database.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import {
  awardProposalAmount, bidIsContractorEditable, bidVisibleToAdmin, contractorEligibleForPost,
  dateOnlyString, decideAward, decideBidTransition, decidePostEdit, decidePostTransition, effectiveMaxAwards,
  isoDate, MATERIAL_POST_FIELDS, normalizeBidInput, normalizePostInput, POST_FIELD_COLUMNS,
  projectBidForAdmin, projectBidForContractor, projectPostForAdmin, projectPostForContractor,
  submissionsOpen, validateBidForSubmit, validatePostShape,
  type BidAction, type ContractorIdentity, type PostAction, type PostField,
} from "./rules";

// ── Types ───────────────────────────────────────────────────────────────────
type Q = Pool | PoolClient;

export interface JobBoardActor {
  userId: string;
  /** true only for an administrator/manager role WITH access to that company (fail closed). */
  canManageCompany(companyId: string): Promise<boolean>;
  /** The caller's contractor identity (users.worker_id → workers), or null. */
  contractor: ContractorIdentity | null;
}

export interface JobBoardDeps {
  pool: Pool;
  tenantGate(companyId: string): Promise<{ allowed: boolean; reason?: string }>;
  tenantIdForCompany(companyId: string): Promise<string | null>;
  now?: () => Date;
}

export type Result<T = unknown> = { ok: true; status: number; body: T } | { ok: false; status: number; message: string };

export class JobBoardError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function fail(status: number, message: string): never {
  throw new JobBoardError(status, message);
}
const NOT_FOUND_POST = "Job posting not found";
const NOT_FOUND_BID = "Bid not found";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function run(fn: () => Promise<{ status?: number; body: unknown }>): Promise<Result> {
  try {
    const r = await fn();
    return { ok: true, status: r.status ?? 200, body: r.body };
  } catch (e: any) {
    if (e instanceof JobBoardError) return { ok: false, status: e.status, message: e.message };
    if (e?.code === "23505") return { ok: false, status: 409, message: "This action conflicts with an existing record" };
    if (e?.code === "23514") return { ok: false, status: 400, message: "The values supplied are not allowed" };
    throw e;
  }
}

async function tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** True once migration 0029 has been applied. Routes answer 503 until then. */
export async function jobBoardSchemaReady(pool: Pool): Promise<boolean> {
  const r = await pool.query(`SELECT to_regclass('public.contractor_job_posts') AS a, to_regclass('public.contractor_job_bid_events') AS b`);
  return !!(r.rows[0]?.a && r.rows[0]?.b);
}

// ── Loading + authorization primitives ──────────────────────────────────────
async function loadPost(deps: JobBoardDeps, q: Q, id: string, lock: "" | "FOR UPDATE" | "FOR SHARE" = ""): Promise<any> {
  if (!UUID_RE.test(String(id))) fail(404, NOT_FOUND_POST);
  const r = await q.query(`SELECT * FROM contractor_job_posts WHERE id = $1 ${lock}`, [id]);
  const post = r.rows[0];
  if (!post) fail(404, NOT_FOUND_POST);
  await assertTenantConsistent(deps, post);
  return post;
}

async function loadBid(deps: JobBoardDeps, q: Q, id: string, lock: "" | "FOR UPDATE" = ""): Promise<any> {
  if (!UUID_RE.test(String(id))) fail(404, NOT_FOUND_BID);
  const r = await q.query(`SELECT * FROM contractor_job_bids WHERE id = $1 ${lock}`, [id]);
  const bid = r.rows[0];
  if (!bid) fail(404, NOT_FOUND_BID);
  await assertTenantConsistent(deps, bid);
  return bid;
}

/** A row stamped with a tenant must still belong to that tenant (company moved → unreachable, fail closed). */
async function assertTenantConsistent(deps: JobBoardDeps, row: { tenant_id: string | null; company_id: string }) {
  if (!row.tenant_id) return;
  const current = await deps.tenantIdForCompany(row.company_id);
  if (current !== row.tenant_id) fail(404, "Not found");
}

async function canManage(actor: JobBoardActor, companyId: string): Promise<boolean> {
  try { return await actor.canManageCompany(companyId); } catch { return false; }
}

async function requireManage(actor: JobBoardActor, companyId: string, notFound: string) {
  if (!(await canManage(actor, companyId))) fail(404, notFound);
}

async function requireGate(deps: JobBoardDeps, companyId: string) {
  let g: { allowed: boolean; reason?: string };
  try { g = await deps.tenantGate(companyId); } catch { g = { allowed: false, reason: "Account status could not be verified" }; }
  if (!g.allowed) fail(403, g.reason || "This company's account is not active");
}

function requireContractor(actor: JobBoardActor): ContractorIdentity {
  const c = actor.contractor;
  if (!c || c.workerType !== "contractor" || !c.companyId) fail(403, "Only contractors can do this");
  return c!;
}

async function isInvited(q: Q, postId: string, workerId: string): Promise<boolean> {
  const r = await q.query(`SELECT 1 FROM contractor_job_invitations WHERE job_post_id = $1 AND contractor_id = $2 AND status = 'invited'`, [postId, workerId]);
  return r.rows.length > 0;
}

async function contractorCanSeePost(q: Q, post: any, who: ContractorIdentity): Promise<{ eligible: boolean; hasBid: boolean }> {
  if (!who.companyId || who.companyId !== post.company_id) return { eligible: false, hasBid: false };
  const hasBidRow = await q.query(`SELECT 1 FROM contractor_job_bids WHERE job_post_id = $1 AND contractor_id = $2 LIMIT 1`, [post.id, who.workerId]);
  const hasBid = hasBidRow.rows.length > 0;
  const eligible = post.status === "published" && contractorEligibleForPost(post, who, await isInvited(q, post.id, who.workerId));
  return { eligible, hasBid };
}

/** The contractor must own the bid AND still belong to the bid's company. */
function requireOwnBid(bid: any, who: ContractorIdentity) {
  if (bid.contractor_id !== who.workerId || bid.company_id !== who.companyId) fail(404, NOT_FOUND_BID);
}

async function event(q: Q, e: {
  post: { id: string; company_id: string; tenant_id: string | null };
  bidId?: string | null; type: string; oldStatus?: string | null; newStatus?: string | null;
  actorUserId?: string | null; actorWorkerId?: string | null; details?: Record<string, unknown> | null;
}) {
  await q.query(
    `INSERT INTO contractor_job_bid_events (tenant_id, company_id, job_post_id, bid_id, event_type, old_status, new_status, actor_user_id, actor_worker_id, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [e.post.tenant_id, e.post.company_id, e.post.id, e.bidId ?? null, e.type, e.oldStatus ?? null, e.newStatus ?? null,
      e.actorUserId ?? null, e.actorWorkerId ?? null, e.details ? JSON.stringify(e.details) : null],
  );
}

async function snapshotBid(q: Q, bid: any, userId: string) {
  const snap: Record<string, unknown> = {};
  for (const k of ["status", "cover_message", "proposed_scope", "proposed_amount", "rate_type", "hourly_rate", "estimated_hours",
    "estimated_start_date", "estimated_completion_date", "recurrence_terms", "assumptions", "exclusions"]) snap[k] = bid[k];
  await q.query(
    `INSERT INTO contractor_job_bid_versions (tenant_id, company_id, job_post_id, bid_id, revision_number, snapshot, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [bid.tenant_id, bid.company_id, bid.job_post_id, bid.id, bid.revision_number, JSON.stringify(snap), userId],
  );
}

// ── Notifications (in-app only; after commit; best-effort) ──────────────────
interface Note { companyId: string; type: string; title: string; body?: string; entityType: string; entityId: string; actionUrl?: string }

async function notifyWorkers(pool: Pool, workerIds: string[], n: Note) {
  if (!workerIds.length) return;
  try {
    await pool.query(
      `INSERT INTO contractor_notifications (worker_id, user_id, company_id, notification_type, title, body, entity_type, entity_id, action_url)
       SELECT w.id, (SELECT u.id FROM users u WHERE u.worker_id = w.id LIMIT 1), $2::varchar, $3::text, $4::text, $5::text, $6::text, $7::varchar, $8::text
         FROM workers w WHERE w.id = ANY($1::varchar[]) AND w.company_id = $2::varchar`,
      [workerIds, n.companyId, n.type, n.title, n.body ?? null, n.entityType, n.entityId, n.actionUrl ?? "/contractor-hub?section=jobs"],
    );
  } catch (e) {
    console.error("[job-board] contractor notification failed:", (e as Error)?.message);
  }
}

async function notifyCompanyAdmins(pool: Pool, n: Note) {
  try {
    await pool.query(
      `INSERT INTO contractor_notifications (worker_id, user_id, company_id, notification_type, title, body, entity_type, entity_id, action_url)
       SELECT NULL, u.id, $1::varchar, $2::text, $3::text, $4::text, $5::text, $6::varchar, $7::text FROM users u
        WHERE u.company_id = $1::varchar AND u.role IN ('admin','manager','owner','tenant_owner','tenant_admin','tenant_manager')
        LIMIT 25`,
      [n.companyId, n.type, n.title, n.body ?? null, n.entityType, n.entityId, n.actionUrl ?? "/contractor-hub?section=jobs"],
    );
  } catch (e) {
    console.error("[job-board] admin notification failed:", (e as Error)?.message);
  }
}

async function activeBidderIds(pool: Pool, postId: string): Promise<string[]> {
  const r = await pool.query(
    `SELECT contractor_id FROM contractor_job_bids WHERE job_post_id = $1 AND status IN ('submitted','under_review','shortlisted','revision_requested','draft')`,
    [postId],
  );
  return r.rows.map((x: any) => x.contractor_id);
}

/** Contractors who can see a freshly published posting (company-bound; capped). */
async function eligibleContractorIds(pool: Pool, post: any): Promise<string[]> {
  const r = await pool.query(
    `SELECT w.id, w.company_id, w.worker_type, w.worker_group, w.status,
            EXISTS (SELECT 1 FROM contractor_job_invitations i WHERE i.job_post_id = $2 AND i.contractor_id = w.id AND i.status = 'invited') AS invited
       FROM workers w WHERE w.company_id = $1 AND w.worker_type = 'contractor' LIMIT 2000`,
    [post.company_id, post.id],
  );
  return r.rows
    .filter((w: any) => contractorEligibleForPost(post, { workerId: w.id, companyId: w.company_id, workerType: w.worker_type, workerGroup: w.worker_group, status: w.status }, w.invited))
    .map((w: any) => w.id);
}

// ── Postings (administrator) ────────────────────────────────────────────────
async function validateCostJob(q: Q, companyId: string, costJobId: unknown) {
  if (costJobId == null) return;
  const r = await q.query(`SELECT 1 FROM jobs WHERE id = $1 AND company_id = $2`, [costJobId, companyId]);
  if (!r.rows.length) fail(400, "Invalid cost job");
}

export function createPost(deps: JobBoardDeps, actor: JobBoardActor, companyId: string, body: Record<string, unknown>) {
  return run(async () => {
    await requireManage(actor, companyId, "Company not found");
    await requireGate(deps, companyId);
    const n = normalizePostInput(body, { partial: false });
    if (!n.ok) fail(n.status, n.message);
    const values = (n as any).values as Record<string, unknown>;
    const merged = { location_type: "onsite", work_type: "one_time", budget_type: "contractor_quote", visibility: "all_eligible", eligible_groups: [], awards_made: 0, ...values };
    const shape = validatePostShape(merged, { forPublish: false });
    if (!shape.ok) fail(shape.status, shape.message);
    const tenantId = await deps.tenantIdForCompany(companyId);
    return tx(deps.pool, async (c) => {
      await validateCostJob(c, companyId, values.cost_job_id);
      const cols = Object.keys(values);
      const params = cols.map((k) => (k === "eligible_groups" ? JSON.stringify(values[k]) : values[k]));
      const ins = await c.query(
        `INSERT INTO contractor_job_posts (tenant_id, company_id, created_by_user_id${cols.map((k) => ", " + k).join("")})
         VALUES ($1, $2, $3${cols.map((_, i) => `, $${i + 4}`).join("")}) RETURNING *`,
        [tenantId, companyId, actor.userId, ...params],
      );
      const post = ins.rows[0];
      await event(c, { post, type: "post_created", newStatus: "draft", actorUserId: actor.userId, details: { fields: (n as any).fields } });
      return { status: 201, body: projectPostForAdmin(post) };
    });
  });
}

export function listPostsForAdmin(deps: JobBoardDeps, actor: JobBoardActor, companyId: string, opts: { status?: string } = {}) {
  return run(async () => {
    await requireManage(actor, companyId, "Company not found");
    const status = opts.status && opts.status !== "all" ? opts.status : null;
    const r = await deps.pool.query(
      `SELECT p.*, (
          SELECT json_build_object(
            'total', count(*) FILTER (WHERE b.revision_number > 0),
            'awaitingReview', count(*) FILTER (WHERE b.status IN ('submitted','under_review')),
            'shortlisted', count(*) FILTER (WHERE b.status = 'shortlisted'),
            'awarded', count(*) FILTER (WHERE b.status IN ('awarded','converted_to_proposal','converted_to_contract')))
          FROM contractor_job_bids b WHERE b.job_post_id = p.id) AS bid_counts
         FROM contractor_job_posts p
        WHERE p.company_id = $1
          AND ($2::text IS NULL OR p.status = $2)
          AND ($2::text IS NOT NULL OR $3::boolean OR p.status <> 'archived')
        ORDER BY p.updated_at DESC NULLS LAST LIMIT 500`,
      [companyId, status, opts.status === "all"],
    );
    return { body: r.rows.map(projectPostForAdmin) };
  });
}

export function getPost(deps: JobBoardDeps, actor: JobBoardActor, id: string) {
  return run(async () => {
    const post = await loadPost(deps, deps.pool, id);
    const attachments = await deps.pool.query(
      `SELECT id, file_name, content_type, file_size, created_at FROM contractor_job_attachments
        WHERE job_post_id = $1 AND bid_id IS NULL AND removed_at IS NULL ORDER BY created_at`, [post.id]);
    const att = attachments.rows.map((a: any) => ({ id: a.id, fileName: a.file_name, contentType: a.content_type, fileSize: a.file_size, createdAt: a.created_at }));
    if (await canManage(actor, post.company_id)) {
      return { body: { ...projectPostForAdmin(post), attachments: att, viewer: "admin" } };
    }
    const who = actor.contractor;
    if (!who) fail(404, NOT_FOUND_POST);
    const vis = await contractorCanSeePost(deps.pool, post, who!);
    if (!vis.eligible && !vis.hasBid) fail(404, NOT_FOUND_POST);
    if (!vis.hasBid) {
      const g = await deps.tenantGate(post.company_id).catch(() => ({ allowed: false }));
      if (!g.allowed) fail(404, NOT_FOUND_POST);
    }
    const mine = await deps.pool.query(
      `SELECT * FROM contractor_job_bids WHERE job_post_id = $1 AND contractor_id = $2 ORDER BY (status = 'withdrawn'), updated_at DESC LIMIT 1`,
      [post.id, who!.workerId]);
    const company = await deps.pool.query(`SELECT name FROM companies WHERE id = $1`, [post.company_id]);
    return {
      body: {
        ...projectPostForContractor({ ...post, company_name: company.rows[0]?.name }),
        attachments: att,
        acceptingBids: submissionsOpen(post, deps.now?.()).ok && vis.eligible,
        myBid: mine.rows[0] ? projectBidForContractor(mine.rows[0]) : null,
        viewer: "contractor",
      },
    };
  });
}

export function updatePost(deps: JobBoardDeps, actor: JobBoardActor, id: string, body: Record<string, unknown>) {
  return run(async () => {
    const n = normalizePostInput(body, { partial: true });
    if (!n.ok) fail(n.status, n.message);
    const values = (n as any).values as Record<string, unknown>;
    const fields = (n as any).fields as PostField[];
    if (!fields.length) fail(400, "No editable fields supplied");
    const out = await tx(deps.pool, async (c) => {
      const post = await loadPost(deps, c, id, "FOR UPDATE");
      await requireManage(actor, post.company_id, NOT_FOUND_POST);
      await requireGate(deps, post.company_id);
      const edit = decidePostEdit(post.status);
      if (!edit.ok) fail(edit.status, edit.message);
      if ("cost_job_id" in values) await validateCostJob(c, post.company_id, values.cost_job_id);
      const merged = { ...post, ...values };
      const shape = validatePostShape(merged, { forPublish: post.status === "published" });
      if (!shape.ok) fail(shape.status, shape.message);

      const changed: Record<string, { from: unknown; to: unknown }> = {};
      for (const f of fields) {
        const col = POST_FIELD_COLUMNS[f];
        const isDateCol = col === "estimated_start_date" || col === "estimated_end_date";
        const before = isDateCol ? (dateOnlyString(post[col]) ?? "") : normalizeForCompare(post[col]);
        const after = isDateCol ? (dateOnlyString(values[col]) ?? "") : normalizeForCompare(values[col]);
        if (before !== after) changed[f] = { from: post[col] ?? null, to: values[col] ?? null };
      }
      const changedFields = Object.keys(changed) as PostField[];
      if (!changedFields.length) return { post, material: [] as string[] };

      const cols = changedFields.map((f) => POST_FIELD_COLUMNS[f]);
      const params = cols.map((k) => (k === "eligible_groups" ? JSON.stringify(values[k]) : values[k]));
      const upd = await c.query(
        `UPDATE contractor_job_posts SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1 RETURNING *`,
        [post.id, ...params],
      );
      const material = changedFields.filter((f) => MATERIAL_POST_FIELDS.has(f));
      await event(c, { post, type: "post_updated", oldStatus: post.status, newStatus: post.status, actorUserId: actor.userId, details: { changed } });
      if (edit.audited && material.length) {
        await event(c, { post, type: "post_material_change", oldStatus: post.status, newStatus: post.status, actorUserId: actor.userId, details: { fields: material } });
      }
      return { post: upd.rows[0], material: edit.audited ? material : [] };
    });
    if (out.material.length) {
      await notifyWorkers(deps.pool, await activeBidderIds(deps.pool, out.post.id), {
        companyId: out.post.company_id, type: "job_post_changed", title: `Job posting updated: ${out.post.title}`,
        body: "The posting you bid on has changed. Review the updated details and revise your bid if needed.",
        entityType: "job_post", entityId: out.post.id,
      });
    }
    return { body: projectPostForAdmin(out.post) };
  });
}

function normalizeForCompare(v: unknown): string {
  if (v == null || v === "") return "";
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v) || typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  if (/^-?\d+(\.\d+)?$/.test(s)) return String(Number(s));
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return new Date(s).toISOString();
  return s;
}

export function transitionPost(deps: JobBoardDeps, actor: JobBoardActor, id: string, action: PostAction, opts: { reason?: string } = {}) {
  return run(async () => {
    const out = await tx(deps.pool, async (c) => {
      const post = await loadPost(deps, c, id, "FOR UPDATE");
      await requireManage(actor, post.company_id, NOT_FOUND_POST);
      const d = decidePostTransition(post.status, action);
      if (!d.ok) fail(d.status, d.message);
      const to = (d as any).to as string;
      if (action === "publish" || action === "reopen") {
        await requireGate(deps, post.company_id);
        const shape = validatePostShape(post, { forPublish: true });
        if (!shape.ok) fail(shape.status, shape.message);
        const max = effectiveMaxAwards(post);
        if (max != null && post.awards_made >= max) fail(409, "This posting has reached its award limit — raise the limit before reopening");
        const today = isoDate(deps.now?.() ?? new Date());
        if (post.work_type === "recurring" && post.estimated_end_date && String(isoDateOf(post.estimated_end_date)) < today) {
          fail(409, "This posting's end date has passed — extend it before reopening");
        }
      }
      const reason = opts.reason ? String(opts.reason).slice(0, 500) : null;
      const upd = await c.query(
        `UPDATE contractor_job_posts SET status = $2,
            published_at = CASE WHEN $2 = 'published' AND published_at IS NULL THEN now() ELSE published_at END,
            closed_at    = CASE WHEN $2 = 'closed' THEN now() WHEN $2 = 'published' THEN NULL ELSE closed_at END,
            close_reason = CASE WHEN $2 = 'closed' THEN COALESCE($3, 'closed_by_admin') WHEN $2 = 'published' THEN NULL ELSE close_reason END,
            archived_at  = CASE WHEN $2 = 'archived' THEN now() ELSE archived_at END,
            updated_at = now()
          WHERE id = $1 RETURNING *`,
        [post.id, to, reason],
      );
      await event(c, { post, type: `post_${action === "reopen" ? "reopened" : to}`, oldStatus: post.status, newStatus: to, actorUserId: actor.userId, details: reason ? { reason } : null });
      return { before: post, post: upd.rows[0] };
    });
    if (action === "publish" && !out.before.published_at) {
      await notifyWorkers(deps.pool, await eligibleContractorIds(deps.pool, out.post), {
        companyId: out.post.company_id, type: "job_published", title: `New job posted: ${out.post.title}`,
        body: "A new job is open for bids in Contractor Hub.", entityType: "job_post", entityId: out.post.id,
      });
    }
    if (out.post.status === "closed") {
      await notifyWorkers(deps.pool, await activeBidderIds(deps.pool, out.post.id), {
        companyId: out.post.company_id, type: "job_closed", title: `Job posting closed: ${out.post.title}`,
        body: "This posting is no longer accepting bids.", entityType: "job_post", entityId: out.post.id,
      });
    }
    return { body: projectPostForAdmin(out.post) };
  });
}

function isoDateOf(v: unknown): string {
  return dateOnlyString(v) ?? "";
}

export function listPostEvents(deps: JobBoardDeps, actor: JobBoardActor, id: string) {
  return run(async () => {
    const post = await loadPost(deps, deps.pool, id);
    await requireManage(actor, post.company_id, NOT_FOUND_POST);
    const r = await deps.pool.query(
      `SELECT id, bid_id, event_type, old_status, new_status, actor_user_id, actor_worker_id, details, created_at
         FROM contractor_job_bid_events WHERE job_post_id = $1 AND company_id = $2 ORDER BY created_at, id`,
      [post.id, post.company_id]);
    return {
      body: r.rows.map((e: any) => ({
        id: e.id, bidId: e.bid_id, eventType: e.event_type, oldStatus: e.old_status, newStatus: e.new_status,
        actorUserId: e.actor_user_id, actorWorkerId: e.actor_worker_id, details: e.details, createdAt: e.created_at,
      })),
    };
  });
}

// ── Contractor discovery + bids ─────────────────────────────────────────────
export function listAvailablePosts(deps: JobBoardDeps, actor: JobBoardActor) {
  return run(async () => {
    const who = requireContractor(actor);
    const g = await deps.tenantGate(who.companyId!).catch(() => ({ allowed: false }));
    if (!g.allowed) return { body: [] };
    const r = await deps.pool.query(
      `SELECT p.*, c.name AS company_name, b.id AS my_bid_id, b.status AS my_bid_status,
              EXISTS (SELECT 1 FROM contractor_job_invitations i WHERE i.job_post_id = p.id AND i.contractor_id = $2 AND i.status = 'invited') AS invited
         FROM contractor_job_posts p
         JOIN companies c ON c.id = p.company_id
         LEFT JOIN contractor_job_bids b ON b.job_post_id = p.id AND b.contractor_id = $2 AND b.status <> 'withdrawn'
        WHERE p.company_id = $1 AND p.status = 'published'
        ORDER BY p.submission_deadline NULLS LAST, p.published_at DESC LIMIT 500`,
      [who.companyId, who.workerId],
    );
    const now = deps.now?.() ?? new Date();
    const rows = [];
    for (const p of r.rows) {
      if (p.tenant_id && (await deps.tenantIdForCompany(p.company_id)) !== p.tenant_id) continue;
      if (!contractorEligibleForPost(p, who, p.invited)) continue;
      const open = submissionsOpen(p, now).ok;
      if (!open && !p.my_bid_id) continue;
      rows.push({ ...projectPostForContractor(p), acceptingBids: open, myBidId: p.my_bid_id, myBidStatus: p.my_bid_status, invited: p.invited });
    }
    return { body: rows };
  });
}

export function listMyBids(deps: JobBoardDeps, actor: JobBoardActor) {
  return run(async () => {
    const who = requireContractor(actor);
    const r = await deps.pool.query(
      `SELECT b.*, p.title AS job_title, p.status AS job_status
         FROM contractor_job_bids b JOIN contractor_job_posts p ON p.id = b.job_post_id AND p.company_id = b.company_id
        WHERE b.contractor_id = $1 AND b.company_id = $2
        ORDER BY b.updated_at DESC NULLS LAST LIMIT 500`,
      [who.workerId, who.companyId],
    );
    return { body: r.rows.map(projectBidForContractor) };
  });
}

async function assertContractorMayBid(deps: JobBoardDeps, c: PoolClient, post: any, who: ContractorIdentity) {
  if (who.companyId !== post.company_id) fail(404, NOT_FOUND_POST);
  const invited = await isInvited(c, post.id, who.workerId);
  if (!contractorEligibleForPost({ ...post, status: "published" }, who, invited)) fail(404, NOT_FOUND_POST);
  const open = submissionsOpen(post, deps.now?.());
  if (!open.ok) fail(open.status, open.message);
  await requireGate(deps, post.company_id);
}

export function createBid(deps: JobBoardDeps, actor: JobBoardActor, postId: string, body: Record<string, unknown>) {
  return run(async () => {
    const who = requireContractor(actor);
    const n = normalizeBidInput(body);
    if (!n.ok) fail(n.status, n.message);
    const values = (n as any).values as Record<string, unknown>;
    return tx(deps.pool, async (c) => {
      const post = await loadPost(deps, c, postId, "FOR SHARE");
      await assertContractorMayBid(deps, c, post, who);
      const existing = await c.query(`SELECT id, status FROM contractor_job_bids WHERE job_post_id = $1 AND contractor_id = $2 AND status <> 'withdrawn'`, [post.id, who.workerId]);
      if (existing.rows.length) fail(409, "You already have a bid on this posting — revise it instead");
      const cols = Object.keys(values);
      const ins = await c.query(
        `INSERT INTO contractor_job_bids (tenant_id, company_id, job_post_id, contractor_id, submitted_by_user_id, status${cols.map((k) => ", " + k).join("")})
         VALUES ($1,$2,$3,$4,$5,'draft'${cols.map((_, i) => `, $${i + 6}`).join("")}) RETURNING *`,
        [post.tenant_id, post.company_id, post.id, who.workerId, actor.userId, ...cols.map((k) => values[k])],
      );
      const bid = ins.rows[0];
      await event(c, { post, bidId: bid.id, type: "bid_created", newStatus: "draft", actorUserId: actor.userId, actorWorkerId: who.workerId });
      return { status: 201, body: projectBidForContractor(bid) };
    });
  });
}

export function updateBid(deps: JobBoardDeps, actor: JobBoardActor, bidId: string, body: Record<string, unknown>) {
  return run(async () => {
    const who = requireContractor(actor);
    const n = normalizeBidInput(body);
    if (!n.ok) fail(n.status, n.message);
    const values = (n as any).values as Record<string, unknown>;
    const cols = Object.keys(values);
    if (!cols.length) fail(400, "No editable fields supplied");
    const out = await tx(deps.pool, async (c) => {
      const peek = await loadBid(deps, c, bidId);
      requireOwnBid(peek, who);
      const post = await loadPost(deps, c, peek.job_post_id, "FOR SHARE");
      const bid = await loadBid(deps, c, bidId, "FOR UPDATE");
      requireOwnBid(bid, who);
      if (!bidIsContractorEditable(bid.status)) fail(409, `A ${bid.status.replace(/_/g, " ")} bid cannot be edited`);
      await assertContractorMayBid(deps, c, post, who);

      const isRevision = bid.status === "submitted" || bid.status === "under_review";
      if (isRevision) {
        const merged = { ...bid, ...values };
        const v = validateBidForSubmit(merged);
        if (!v.ok) fail(v.status, v.message);
        const d = decideBidTransition(bid.status, "revise");
        if (!d.ok) fail(d.status, d.message);
      }
      const upd = await c.query(
        `UPDATE contractor_job_bids SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")},
            ${isRevision ? "status = 'submitted', revision_number = revision_number + 1, submitted_at = now(), submitted_by_user_id = $" + (cols.length + 2) + "," : ""}
            updated_at = now()
          WHERE id = $1 RETURNING *`,
        isRevision ? [bid.id, ...cols.map((k) => values[k]), actor.userId] : [bid.id, ...cols.map((k) => values[k])],
      );
      const after = upd.rows[0];
      if (isRevision) {
        await snapshotBid(c, after, actor.userId);
        await event(c, { post, bidId: bid.id, type: "bid_revised", oldStatus: bid.status, newStatus: after.status, actorUserId: actor.userId, actorWorkerId: who.workerId, details: { revisionNumber: after.revision_number, fields: cols } });
      } else {
        await event(c, { post, bidId: bid.id, type: "bid_draft_updated", oldStatus: bid.status, newStatus: bid.status, actorUserId: actor.userId, actorWorkerId: who.workerId, details: { fields: cols } });
      }
      return { post, bid: after, isRevision };
    });
    if (out.isRevision) {
      await notifyCompanyAdmins(deps.pool, {
        companyId: out.post.company_id, type: "job_bid_revised", title: `Bid revised: ${out.post.title}`,
        body: "A contractor revised their bid.", entityType: "job_post", entityId: out.post.id,
      });
    }
    return { body: projectBidForContractor(out.bid) };
  });
}

export function submitBid(deps: JobBoardDeps, actor: JobBoardActor, bidId: string) {
  return run(async () => {
    const who = requireContractor(actor);
    const out = await tx(deps.pool, async (c) => {
      const peek = await loadBid(deps, c, bidId);
      requireOwnBid(peek, who);
      const post = await loadPost(deps, c, peek.job_post_id, "FOR SHARE");
      const bid = await loadBid(deps, c, bidId, "FOR UPDATE");
      requireOwnBid(bid, who);
      const d = decideBidTransition(bid.status, "submit");
      if (!d.ok) fail(d.status, d.message);
      await assertContractorMayBid(deps, c, post, who);
      const v = validateBidForSubmit(bid);
      if (!v.ok) fail(v.status, v.message);
      const upd = await c.query(
        `UPDATE contractor_job_bids SET status = 'submitted', revision_number = revision_number + 1, submitted_at = now(),
            submitted_by_user_id = $2, updated_at = now() WHERE id = $1 RETURNING *`,
        [bid.id, actor.userId]);
      const after = upd.rows[0];
      await snapshotBid(c, after, actor.userId);
      await event(c, { post, bidId: bid.id, type: bid.status === "revision_requested" ? "bid_resubmitted" : "bid_submitted", oldStatus: bid.status, newStatus: "submitted", actorUserId: actor.userId, actorWorkerId: who.workerId, details: { revisionNumber: after.revision_number } });
      return { post, bid: after, resubmitted: bid.status === "revision_requested" };
    });
    await notifyCompanyAdmins(deps.pool, {
      companyId: out.post.company_id, type: out.resubmitted ? "job_bid_revised" : "job_bid_submitted",
      title: `${out.resubmitted ? "Revised bid" : "New bid"}: ${out.post.title}`, body: "A contractor submitted a bid for review.",
      entityType: "job_post", entityId: out.post.id,
    });
    return { body: projectBidForContractor(out.bid) };
  });
}

export function withdrawBid(deps: JobBoardDeps, actor: JobBoardActor, bidId: string) {
  return run(async () => {
    const who = requireContractor(actor);
    const out = await tx(deps.pool, async (c) => {
      const peek = await loadBid(deps, c, bidId);
      requireOwnBid(peek, who);
      const post = await loadPost(deps, c, peek.job_post_id, "FOR SHARE");
      const bid = await loadBid(deps, c, bidId, "FOR UPDATE");
      requireOwnBid(bid, who);
      const d = decideBidTransition(bid.status, "withdraw");
      if (!d.ok) fail(d.status, d.message);
      const upd = await c.query(`UPDATE contractor_job_bids SET status = 'withdrawn', withdrawn_at = now(), updated_at = now() WHERE id = $1 RETURNING *`, [bid.id]);
      await event(c, { post, bidId: bid.id, type: "bid_withdrawn", oldStatus: bid.status, newStatus: "withdrawn", actorUserId: actor.userId, actorWorkerId: who.workerId });
      return { post, bid: upd.rows[0], wasVisible: bidVisibleToAdmin(bid) };
    });
    if (out.wasVisible) {
      await notifyCompanyAdmins(deps.pool, {
        companyId: out.post.company_id, type: "job_bid_withdrawn", title: `Bid withdrawn: ${out.post.title}`,
        entityType: "job_post", entityId: out.post.id,
      });
    }
    return { body: projectBidForContractor(out.bid) };
  });
}

export function listBidVersions(deps: JobBoardDeps, actor: JobBoardActor, bidId: string) {
  return run(async () => {
    const bid = await loadBid(deps, deps.pool, bidId);
    if (!((await canManage(actor, bid.company_id)) && bidVisibleToAdmin(bid))) {
      if (!actor.contractor) fail(404, NOT_FOUND_BID);
      requireOwnBid(bid, actor.contractor!);
    }
    const r = await deps.pool.query(
      `SELECT revision_number, snapshot, created_at FROM contractor_job_bid_versions WHERE bid_id = $1 AND company_id = $2 ORDER BY revision_number`,
      [bid.id, bid.company_id]);
    return { body: r.rows.map((v: any) => ({ revisionNumber: v.revision_number, snapshot: v.snapshot, createdAt: v.created_at })) };
  });
}

// ── Administrative review ───────────────────────────────────────────────────
export function listBidsForPost(deps: JobBoardDeps, actor: JobBoardActor, postId: string) {
  return run(async () => {
    const post = await loadPost(deps, deps.pool, postId);
    await requireManage(actor, post.company_id, NOT_FOUND_POST);
    const r = await deps.pool.query(
      `SELECT b.*, TRIM(COALESCE(w.first_name,'') || ' ' || COALESCE(w.last_name,'')) AS contractor_name,
              (SELECT count(*)::int FROM contractor_job_attachments a WHERE a.bid_id = b.id AND a.removed_at IS NULL) AS attachment_count
         FROM contractor_job_bids b JOIN workers w ON w.id = b.contractor_id
        WHERE b.job_post_id = $1 AND b.company_id = $2 AND b.revision_number > 0
        ORDER BY b.submitted_at NULLS LAST, b.created_at`,
      [post.id, post.company_id]);
    return { body: r.rows.map((b: any) => ({ ...projectBidForAdmin(b), attachmentCount: b.attachment_count })) };
  });
}

type ReviewAction = Extract<BidAction, "review" | "shortlist" | "request_revision" | "reject">;

export function reviewBid(deps: JobBoardDeps, actor: JobBoardActor, bidId: string, action: ReviewAction, opts: { note?: string } = {}) {
  return run(async () => {
    const note = opts.note ? String(opts.note).trim().slice(0, 4000) : null;
    if (action === "request_revision" && !note) fail(400, "Explain what the contractor should revise");
    const out = await tx(deps.pool, async (c) => {
      const peek = await loadBid(deps, c, bidId);
      await requireManage(actor, peek.company_id, NOT_FOUND_BID);
      const post = await loadPost(deps, c, peek.job_post_id, "FOR SHARE");
      const bid = await loadBid(deps, c, bidId, "FOR UPDATE");
      if (bid.company_id !== post.company_id || bid.job_post_id !== post.id) fail(404, NOT_FOUND_BID);
      const d = decideBidTransition(bid.status, action);
      if (!d.ok) fail(d.status, d.message);
      if (action !== "reject") await requireGate(deps, post.company_id);
      const to = (d as any).to as string;
      const upd = await c.query(
        `UPDATE contractor_job_bids SET status = $2, reviewed_at = now(), reviewed_by_user_id = $3,
            revision_request_note = CASE WHEN $2 = 'revision_requested' THEN $4 ELSE revision_request_note END,
            rejection_reason      = CASE WHEN $2 = 'rejected' THEN $4 ELSE rejection_reason END,
            updated_at = now()
          WHERE id = $1 RETURNING *`,
        [bid.id, to, actor.userId, note]);
      await event(c, { post, bidId: bid.id, type: `bid_${to}`, oldStatus: bid.status, newStatus: to, actorUserId: actor.userId, details: note ? { note } : null });
      return { post, bid: upd.rows[0], to };
    });
    const messages: Record<string, [string, string] | undefined> = {
      shortlisted: ["job_bid_shortlisted", `Your bid was shortlisted: ${out.post.title}`],
      revision_requested: ["job_bid_revision_requested", `Revision requested on your bid: ${out.post.title}`],
      rejected: ["job_bid_rejected", `Your bid was not selected: ${out.post.title}`],
    };
    const m = messages[out.to];
    if (m) {
      await notifyWorkers(deps.pool, [out.bid.contractor_id], {
        companyId: out.post.company_id, type: m[0], title: m[1],
        body: out.to === "revision_requested" ? "Open the job in Contractor Hub to see the requested changes." : undefined,
        entityType: "job_bid", entityId: out.bid.id,
      });
    }
    return { body: projectBidForAdmin(out.bid) };
  });
}

/**
 * Award a bid exactly once and convert it into an existing-workflow proposal.
 * Retries with the same Idempotency-Key return the original result; the
 * posting row lock serializes concurrent awards against award capacity, and
 * uq_contractor_proposals_job_bid_id backs "one proposal per bid" in the DB.
 */
export function awardBid(deps: JobBoardDeps, actor: JobBoardActor, bidId: string, idempotencyKey: string) {
  return run(async () => {
    const key = String(idempotencyKey ?? "").trim();
    if (!key || key.length > 255) fail(400, "An Idempotency-Key header (max 255 characters) is required to award a bid");
    const out = await tx(deps.pool, async (c) => {
      const peek = await loadBid(deps, c, bidId);
      await requireManage(actor, peek.company_id, NOT_FOUND_BID);
      const post = await loadPost(deps, c, peek.job_post_id, "FOR UPDATE");
      const bid = await loadBid(deps, c, bidId, "FOR UPDATE");
      if (bid.company_id !== post.company_id || bid.job_post_id !== post.id) fail(404, NOT_FOUND_BID);
      if ((bid.tenant_id ?? null) !== (post.tenant_id ?? null)) fail(404, NOT_FOUND_BID);

      // Replay of this exact award.
      if (bid.award_idempotency_key === key) {
        return { replayed: true, post, bid, closed: false };
      }
      const keyUsed = await c.query(`SELECT 1 FROM contractor_job_bids WHERE company_id = $1 AND award_idempotency_key = $2 AND id <> $3`, [bid.company_id, key, bid.id]);
      if (keyUsed.rows.length) fail(409, "This Idempotency-Key was already used for a different award");

      const d = decideBidTransition(bid.status, "award");
      if (!d.ok) fail(d.status, d.message);
      const cap = decideAward(post);
      if (!cap.ok) fail(cap.status, cap.message);
      await requireGate(deps, post.company_id);

      const w = await c.query(`SELECT id, company_id, worker_type FROM workers WHERE id = $1`, [bid.contractor_id]);
      if (!w.rows[0] || w.rows[0].company_id !== post.company_id || w.rows[0].worker_type !== "contractor") {
        fail(409, "This contractor is no longer an active contractor for this company");
      }

      // Existing proposal workflow — same numbering scheme as POST /api/contractor-proposals.
      const cnt = await c.query(`SELECT COUNT(*)::int AS c FROM contractor_proposals WHERE contractor_id = $1`, [bid.contractor_id]);
      const proposalNumber = `CP-${String(bid.contractor_id).slice(-4).toUpperCase()}-${String(Number(cnt.rows[0].c) + 1).padStart(4, "0")}`;
      const amount = awardProposalAmount(bid);
      const scheduleNotes = [
        bid.estimated_start_date ? `Estimated start: ${isoDateOf(bid.estimated_start_date)}` : null,
        bid.estimated_completion_date ? `Estimated completion: ${isoDateOf(bid.estimated_completion_date)}` : null,
        post.work_type === "recurring" ? `Recurring (${post.recurrence_frequency ?? "custom"})${bid.recurrence_terms ? ": " + bid.recurrence_terms : ""}` : null,
      ].filter(Boolean).join("\n") || null;
      const prop = await c.query(
        `INSERT INTO contractor_proposals (
            company_id, contractor_id, proposal_number, title, description, scope_of_work, assumptions, exclusions,
            schedule_notes, issue_date, subtotal, amount, currency, payment_terms, job_id, estimated_hours,
            status, notes, job_post_id, job_bid_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13,$14,$15,'draft',$16,$17,$18)
         RETURNING id, proposal_number`,
        [post.company_id, bid.contractor_id, proposalNumber, post.title, post.summary,
          bid.proposed_scope || post.scope_of_work, bid.assumptions, bid.exclusions, scheduleNotes,
          isoDate(deps.now?.() ?? new Date()), amount, post.currency || "USD", post.payment_terms, post.cost_job_id,
          bid.estimated_hours, `Generated from job board award (posting ${post.id}, bid revision ${bid.revision_number}).`,
          post.id, bid.id],
      );
      const proposalId = prop.rows[0].id as string;
      await c.query(
        `INSERT INTO proposal_approval_events (proposal_id, event_type, old_status, new_status, actor_user_id, notes)
         VALUES ($1, 'created', NULL, 'draft', $2, $3)`,
        [proposalId, actor.userId, "Created from an awarded job-board bid"]);

      const updBid = await c.query(
        `UPDATE contractor_job_bids SET status = 'converted_to_proposal', awarded_at = now(), awarded_by_user_id = $2,
            reviewed_at = now(), reviewed_by_user_id = $2, award_idempotency_key = $3, converted_proposal_id = $4, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [bid.id, actor.userId, key, proposalId]);
      const close = (cap as any).closeAfter as boolean;
      const updPost = await c.query(
        `UPDATE contractor_job_posts SET awards_made = awards_made + 1,
            status = CASE WHEN $2 THEN 'closed' ELSE status END,
            closed_at = CASE WHEN $2 THEN now() ELSE closed_at END,
            close_reason = CASE WHEN $2 THEN 'award_capacity_reached' ELSE close_reason END,
            updated_at = now()
          WHERE id = $1 RETURNING *`,
        [post.id, close]);

      await event(c, { post, bidId: bid.id, type: "bid_awarded", oldStatus: bid.status, newStatus: "awarded", actorUserId: actor.userId, details: { awardsMade: updPost.rows[0].awards_made } });
      await event(c, { post, bidId: bid.id, type: "bid_converted_to_proposal", oldStatus: "awarded", newStatus: "converted_to_proposal", actorUserId: actor.userId, details: { proposalId, proposalNumber: prop.rows[0].proposal_number } });
      if (close) await event(c, { post, type: "post_closed", oldStatus: post.status, newStatus: "closed", actorUserId: actor.userId, details: { reason: "award_capacity_reached" } });
      return { replayed: false, post: updPost.rows[0], bid: updBid.rows[0], closed: close };
    });

    if (!out.replayed) {
      await notifyWorkers(deps.pool, [out.bid.contractor_id], {
        companyId: out.post.company_id, type: "job_bid_awarded", title: `You were awarded: ${out.post.title}`,
        body: "Review the generated proposal in Contractor Hub to continue.", entityType: "contractor_proposal",
        entityId: out.bid.converted_proposal_id, actionUrl: "/contractor-hub?section=proposals",
      });
      if (out.closed) {
        const others = (await activeBidderIds(deps.pool, out.post.id)).filter((id) => id !== out.bid.contractor_id);
        await notifyWorkers(deps.pool, others, {
          companyId: out.post.company_id, type: "job_closed", title: `Job posting closed: ${out.post.title}`,
          body: "This posting is no longer accepting bids.", entityType: "job_post", entityId: out.post.id,
        });
      }
    }
    return {
      status: out.replayed ? 200 : 201,
      body: { replayed: out.replayed, bid: projectBidForAdmin(out.bid), proposalId: out.bid.converted_proposal_id, post: projectPostForAdmin(out.post) },
    };
  });
}

// ── Invitations ─────────────────────────────────────────────────────────────
export function inviteContractors(deps: JobBoardDeps, actor: JobBoardActor, postId: string, contractorIds: unknown) {
  return run(async () => {
    if (!Array.isArray(contractorIds) || !contractorIds.length || contractorIds.length > 200) fail(400, "Provide 1–200 contractor ids");
    const ids = Array.from(new Set((contractorIds as unknown[]).map(String)));
    if (ids.some((i) => !UUID_RE.test(i))) fail(400, "Invalid contractor id");
    const out = await tx(deps.pool, async (c) => {
      const post = await loadPost(deps, c, postId, "FOR UPDATE");
      await requireManage(actor, post.company_id, NOT_FOUND_POST);
      if (!["draft", "published", "paused"].includes(post.status)) fail(409, `Cannot invite contractors to a ${post.status} posting`);
      await requireGate(deps, post.company_id);
      const w = await c.query(`SELECT id FROM workers WHERE id = ANY($1::varchar[]) AND company_id = $2 AND worker_type = 'contractor'`, [ids, post.company_id]);
      if (w.rows.length !== ids.length) fail(400, "Every invited contractor must be a contractor of this company");
      const invited: string[] = [];
      for (const id of ids) {
        const r = await c.query(
          `INSERT INTO contractor_job_invitations (tenant_id, company_id, job_post_id, contractor_id, invited_by_user_id)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (job_post_id, contractor_id) DO UPDATE
             SET status = 'invited', invited_at = now(), invited_by_user_id = EXCLUDED.invited_by_user_id, revoked_at = NULL, revoked_by_user_id = NULL
             WHERE contractor_job_invitations.status = 'revoked'
           RETURNING id`,
          [post.tenant_id, post.company_id, post.id, id, actor.userId]);
        if (r.rows.length) {
          invited.push(id);
          await event(c, { post, type: "contractor_invited", actorUserId: actor.userId, details: { contractorId: id } });
        }
      }
      return { post, invited };
    });
    if (out.post.status === "published") {
      await notifyWorkers(deps.pool, out.invited, {
        companyId: out.post.company_id, type: "job_invited", title: `You're invited to bid: ${out.post.title}`,
        entityType: "job_post", entityId: out.post.id,
      });
    }
    return { status: 201, body: { invited: out.invited.length } };
  });
}

export function listInvitations(deps: JobBoardDeps, actor: JobBoardActor, postId: string) {
  return run(async () => {
    const post = await loadPost(deps, deps.pool, postId);
    await requireManage(actor, post.company_id, NOT_FOUND_POST);
    const r = await deps.pool.query(
      `SELECT i.id, i.contractor_id, i.status, i.invited_at, i.revoked_at,
              TRIM(COALESCE(w.first_name,'') || ' ' || COALESCE(w.last_name,'')) AS contractor_name
         FROM contractor_job_invitations i JOIN workers w ON w.id = i.contractor_id
        WHERE i.job_post_id = $1 AND i.company_id = $2 ORDER BY i.invited_at`, [post.id, post.company_id]);
    return { body: r.rows.map((i: any) => ({ id: i.id, contractorId: i.contractor_id, contractorName: i.contractor_name, status: i.status, invitedAt: i.invited_at, revokedAt: i.revoked_at })) };
  });
}

export function revokeInvitation(deps: JobBoardDeps, actor: JobBoardActor, invitationId: string) {
  return run(async () => {
    if (!UUID_RE.test(String(invitationId))) fail(404, "Invitation not found");
    return tx(deps.pool, async (c) => {
      const r = await c.query(`SELECT * FROM contractor_job_invitations WHERE id = $1 FOR UPDATE`, [invitationId]);
      const inv = r.rows[0];
      if (!inv) fail(404, "Invitation not found");
      await requireManage(actor, inv.company_id, "Invitation not found");
      const post = await loadPost(deps, c, inv.job_post_id);
      if (inv.status === "revoked") return { body: { id: inv.id, status: "revoked" } };
      await c.query(`UPDATE contractor_job_invitations SET status = 'revoked', revoked_at = now(), revoked_by_user_id = $2 WHERE id = $1`, [inv.id, actor.userId]);
      await event(c, { post, type: "contractor_invitation_revoked", actorUserId: actor.userId, details: { contractorId: inv.contractor_id } });
      return { body: { id: inv.id, status: "revoked" } };
    });
  });
}

// ── Questions ───────────────────────────────────────────────────────────────
export function askQuestion(deps: JobBoardDeps, actor: JobBoardActor, postId: string, question: unknown) {
  return run(async () => {
    const who = requireContractor(actor);
    const text = String(question ?? "").trim();
    if (!text || text.length > 4000) fail(400, "Enter a question (up to 4,000 characters)");
    const out = await tx(deps.pool, async (c) => {
      const post = await loadPost(deps, c, postId, "FOR SHARE");
      const vis = await contractorCanSeePost(c, post, who);
      if (!vis.eligible && !vis.hasBid) fail(404, NOT_FOUND_POST);
      if (!["published", "paused"].includes(post.status)) fail(409, `Questions are closed for a ${post.status} posting`);
      await requireGate(deps, post.company_id);
      const ins = await c.query(
        `INSERT INTO contractor_job_questions (tenant_id, company_id, job_post_id, contractor_id, asked_by_user_id, question)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [post.tenant_id, post.company_id, post.id, who.workerId, actor.userId, text]);
      await event(c, { post, type: "question_asked", actorUserId: actor.userId, actorWorkerId: who.workerId, details: { questionId: ins.rows[0].id } });
      return { post, q: ins.rows[0] };
    });
    await notifyCompanyAdmins(deps.pool, {
      companyId: out.post.company_id, type: "job_question_asked", title: `New question on: ${out.post.title}`,
      entityType: "job_post", entityId: out.post.id,
    });
    return { status: 201, body: projectQuestion(out.q, true) };
  });
}

function projectQuestion(q: any, includeAsker: boolean) {
  return {
    id: q.id, question: q.question, answer: q.answer, answeredAt: q.answered_at, isPublic: q.is_public, createdAt: q.created_at,
    ...(includeAsker ? { contractorId: q.contractor_id, contractorName: q.contractor_name ?? undefined } : {}),
  };
}

export function listQuestions(deps: JobBoardDeps, actor: JobBoardActor, postId: string) {
  return run(async () => {
    const post = await loadPost(deps, deps.pool, postId);
    if (await canManage(actor, post.company_id)) {
      const r = await deps.pool.query(
        `SELECT q.*, TRIM(COALESCE(w.first_name,'') || ' ' || COALESCE(w.last_name,'')) AS contractor_name
           FROM contractor_job_questions q JOIN workers w ON w.id = q.contractor_id
          WHERE q.job_post_id = $1 AND q.company_id = $2 ORDER BY q.created_at`, [post.id, post.company_id]);
      return { body: r.rows.map((q: any) => projectQuestion(q, true)) };
    }
    const who = actor.contractor;
    if (!who) fail(404, NOT_FOUND_POST);
    const vis = await contractorCanSeePost(deps.pool, post, who!);
    if (!vis.eligible && !vis.hasBid) fail(404, NOT_FOUND_POST);
    const r = await deps.pool.query(
      `SELECT * FROM contractor_job_questions
        WHERE job_post_id = $1 AND company_id = $2 AND (contractor_id = $3 OR (is_public AND answer IS NOT NULL))
        ORDER BY created_at`, [post.id, post.company_id, who!.workerId]);
    // Public questions never reveal who asked; a contractor's own are marked as such.
    return { body: r.rows.map((q: any) => ({ ...projectQuestion(q, false), mine: q.contractor_id === who!.workerId })) };
  });
}

export function answerQuestion(deps: JobBoardDeps, actor: JobBoardActor, questionId: string, body: { answer?: unknown; isPublic?: unknown }) {
  return run(async () => {
    if (!UUID_RE.test(String(questionId))) fail(404, "Question not found");
    const answer = String(body?.answer ?? "").trim();
    if (!answer || answer.length > 8000) fail(400, "Enter an answer (up to 8,000 characters)");
    const isPublic = body?.isPublic === true;
    const out = await tx(deps.pool, async (c) => {
      const r = await c.query(`SELECT * FROM contractor_job_questions WHERE id = $1 FOR UPDATE`, [questionId]);
      const q = r.rows[0];
      if (!q) fail(404, "Question not found");
      await requireManage(actor, q.company_id, "Question not found");
      const post = await loadPost(deps, c, q.job_post_id);
      const upd = await c.query(
        `UPDATE contractor_job_questions SET answer = $2, is_public = $3, answered_by_user_id = $4, answered_at = now(), updated_at = now()
          WHERE id = $1 RETURNING *`, [q.id, answer, isPublic, actor.userId]);
      await event(c, { post, type: q.answer ? "question_answer_updated" : "question_answered", actorUserId: actor.userId, details: { questionId: q.id, isPublic } });
      return { post, q: upd.rows[0] };
    });
    await notifyWorkers(deps.pool, [out.q.contractor_id], {
      companyId: out.post.company_id, type: "job_question_answered", title: `Your question was answered: ${out.post.title}`,
      entityType: "job_post", entityId: out.post.id,
    });
    return { body: projectQuestion(out.q, true) };
  });
}

// ── Attachments (private store) ─────────────────────────────────────────────
export const JOB_ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;
export const JOB_ATTACHMENT_EXTENSIONS = /\.(pdf|png|jpe?g|webp|heic|tiff?|docx?|xlsx?|csv|txt)$/i;

export function privateStoreRoot(): string {
  return path.resolve(process.env.PRIVATE_STORAGE_DIR || path.join(process.cwd(), "storage", "private"));
}

function resolveStorageKey(key: string): string {
  const root = privateStoreRoot();
  const abs = path.resolve(root, key);
  if (!abs.startsWith(root + path.sep)) fail(404, "Attachment not found");
  return abs;
}

async function writePrivateFile(companyId: string, originalName: string, bytes: Buffer): Promise<string> {
  const ext = (path.extname(originalName).toLowerCase().match(/^\.[a-z0-9]{1,5}$/) || [""])[0];
  const key = path.posix.join("contractor-jobs", companyId.replace(/[^A-Za-z0-9-]/g, ""), crypto.randomUUID() + ext);
  const abs = resolveStorageKey(key);
  await fs.promises.mkdir(path.dirname(abs), { recursive: true, mode: 0o700 });
  await fs.promises.writeFile(abs, bytes, { mode: 0o600, flag: "wx" });
  return key;
}

export interface UploadedFile { originalname: string; mimetype?: string; size: number; buffer: Buffer }

function checkFile(file: UploadedFile | undefined) {
  if (!file || !file.buffer?.length) fail(400, "Attach a file");
  if (file!.size > JOB_ATTACHMENT_MAX_BYTES) fail(413, "File exceeds the 15 MB limit");
  if (!JOB_ATTACHMENT_EXTENSIONS.test(file!.originalname)) fail(400, "Unsupported file type");
}

function safeName(n: string) { return path.basename(n).replace(/[^\w.\- ()]/g, "_").slice(0, 200) || "attachment"; }

function projectAttachment(a: any) {
  return { id: a.id, fileName: a.file_name, contentType: a.content_type, fileSize: a.file_size, bidId: a.bid_id, createdAt: a.created_at };
}

export function addPostAttachment(deps: JobBoardDeps, actor: JobBoardActor, postId: string, file: UploadedFile | undefined) {
  return run(async () => {
    checkFile(file);
    const post = await loadPost(deps, deps.pool, postId);
    await requireManage(actor, post.company_id, NOT_FOUND_POST);
    if (!["draft", "published", "paused"].includes(post.status)) fail(409, `Cannot attach files to a ${post.status} posting`);
    await requireGate(deps, post.company_id);
    const key = await writePrivateFile(post.company_id, file!.originalname, file!.buffer);
    return tx(deps.pool, async (c) => {
      const ins = await c.query(
        `INSERT INTO contractor_job_attachments (tenant_id, company_id, job_post_id, bid_id, storage_key, file_name, content_type, file_size, uploaded_by_user_id)
         VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8) RETURNING *`,
        [post.tenant_id, post.company_id, post.id, key, safeName(file!.originalname), file!.mimetype ?? null, file!.size, actor.userId]);
      await event(c, { post, type: "post_attachment_added", actorUserId: actor.userId, details: { attachmentId: ins.rows[0].id, fileName: ins.rows[0].file_name } });
      return { status: 201, body: projectAttachment(ins.rows[0]) };
    });
  });
}

export function addBidAttachment(deps: JobBoardDeps, actor: JobBoardActor, bidId: string, file: UploadedFile | undefined) {
  return run(async () => {
    const who = requireContractor(actor);
    checkFile(file);
    const bid = await loadBid(deps, deps.pool, bidId);
    requireOwnBid(bid, who);
    if (!bidIsContractorEditable(bid.status)) fail(409, `Cannot attach files to a ${bid.status.replace(/_/g, " ")} bid`);
    const post = await loadPost(deps, deps.pool, bid.job_post_id);
    await requireGate(deps, post.company_id);
    const key = await writePrivateFile(bid.company_id, file!.originalname, file!.buffer);
    return tx(deps.pool, async (c) => {
      const ins = await c.query(
        `INSERT INTO contractor_job_attachments (tenant_id, company_id, job_post_id, bid_id, storage_key, file_name, content_type, file_size, uploaded_by_user_id, uploaded_by_worker_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [bid.tenant_id, bid.company_id, bid.job_post_id, bid.id, key, safeName(file!.originalname), file!.mimetype ?? null, file!.size, actor.userId, who.workerId]);
      await event(c, { post, bidId: bid.id, type: "bid_attachment_added", actorUserId: actor.userId, actorWorkerId: who.workerId, details: { attachmentId: ins.rows[0].id } });
      return { status: 201, body: projectAttachment(ins.rows[0]) };
    });
  });
}

export function listBidAttachments(deps: JobBoardDeps, actor: JobBoardActor, bidId: string) {
  return run(async () => {
    const bid = await loadBid(deps, deps.pool, bidId);
    if (!((await canManage(actor, bid.company_id)) && bidVisibleToAdmin(bid))) {
      if (!actor.contractor) fail(404, NOT_FOUND_BID);
      requireOwnBid(bid, actor.contractor!);
    }
    const r = await deps.pool.query(`SELECT * FROM contractor_job_attachments WHERE bid_id = $1 AND company_id = $2 AND removed_at IS NULL ORDER BY created_at`, [bid.id, bid.company_id]);
    return { body: r.rows.map(projectAttachment) };
  });
}

/** Authorize an attachment download; returns the absolute path + headers. Never via /uploads. */
export function authorizeAttachmentDownload(deps: JobBoardDeps, actor: JobBoardActor, attachmentId: string) {
  return run(async () => {
    if (!UUID_RE.test(String(attachmentId))) fail(404, "Attachment not found");
    const r = await deps.pool.query(`SELECT * FROM contractor_job_attachments WHERE id = $1 AND removed_at IS NULL`, [attachmentId]);
    const a = r.rows[0];
    if (!a) fail(404, "Attachment not found");
    await assertTenantConsistent(deps, a);
    const admin = await canManage(actor, a.company_id);
    if (a.bid_id) {
      const bid = await loadBid(deps, deps.pool, a.bid_id);
      if (!(admin && bidVisibleToAdmin(bid))) {
        if (!actor.contractor) fail(404, "Attachment not found");
        if (bid.contractor_id !== actor.contractor!.workerId || bid.company_id !== actor.contractor!.companyId) fail(404, "Attachment not found");
      }
    } else if (!admin) {
      const post = await loadPost(deps, deps.pool, a.job_post_id);
      if (!actor.contractor) fail(404, "Attachment not found");
      const vis = await contractorCanSeePost(deps.pool, post, actor.contractor!);
      if (!vis.eligible && !vis.hasBid) fail(404, "Attachment not found");
    }
    const abs = resolveStorageKey(a.storage_key);
    if (!fs.existsSync(abs)) fail(404, "Attachment not found");
    return { body: { absPath: abs, fileName: a.file_name as string, contentType: (a.content_type as string) || "application/octet-stream" } };
  });
}

export function removeAttachment(deps: JobBoardDeps, actor: JobBoardActor, attachmentId: string) {
  return run(async () => {
    if (!UUID_RE.test(String(attachmentId))) fail(404, "Attachment not found");
    return tx(deps.pool, async (c) => {
      const r = await c.query(`SELECT * FROM contractor_job_attachments WHERE id = $1 AND removed_at IS NULL FOR UPDATE`, [attachmentId]);
      const a = r.rows[0];
      if (!a) fail(404, "Attachment not found");
      const post = await loadPost(deps, c, a.job_post_id);
      if (a.bid_id) {
        const bid = await loadBid(deps, c, a.bid_id);
        if (!actor.contractor) fail(404, "Attachment not found");
        requireOwnBid(bid, actor.contractor!);
        if (!bidIsContractorEditable(bid.status)) fail(409, "This bid can no longer be changed");
      } else {
        await requireManage(actor, a.company_id, "Attachment not found");
      }
      // Soft removal only — the file and row are retained for audit.
      await c.query(`UPDATE contractor_job_attachments SET removed_at = now(), removed_by_user_id = $2 WHERE id = $1`, [a.id, actor.userId]);
      await event(c, { post, bidId: a.bid_id, type: "attachment_removed", actorUserId: actor.userId, actorWorkerId: actor.contractor?.workerId ?? null, details: { attachmentId: a.id } });
      return { body: { id: a.id, removed: true } };
    });
  });
}

// ── Dashboard summaries ─────────────────────────────────────────────────────
export function adminSummary(deps: JobBoardDeps, actor: JobBoardActor, companyId: string) {
  return run(async () => {
    await requireManage(actor, companyId, "Company not found");
    const r = await deps.pool.query(
      `SELECT
         (SELECT count(*)::int FROM contractor_job_posts WHERE company_id = $1 AND status = 'published') AS published,
         (SELECT count(*)::int FROM contractor_job_bids WHERE company_id = $1 AND status IN ('submitted','under_review')) AS awaiting_review,
         (SELECT count(*)::int FROM contractor_job_posts WHERE company_id = $1 AND status = 'published'
             AND submission_deadline BETWEEN now() AND now() + interval '3 days') AS closing_soon,
         (SELECT count(*)::int FROM contractor_job_bids WHERE company_id = $1 AND awarded_at >= date_trunc('month', now())) AS awards_this_month`,
      [companyId]);
    const s = r.rows[0];
    return { body: { publishedJobs: s.published, bidsAwaitingReview: s.awaiting_review, closingSoon: s.closing_soon, awardsThisMonth: s.awards_this_month } };
  });
}

export function contractorSummary(deps: JobBoardDeps, actor: JobBoardActor) {
  return run(async () => {
    const who = requireContractor(actor);
    const available = await listAvailablePosts(deps, actor);
    const r = await deps.pool.query(
      `SELECT count(*) FILTER (WHERE status IN ('draft','submitted','under_review','shortlisted','revision_requested'))::int AS active,
              count(*) FILTER (WHERE status = 'revision_requested')::int AS revision_requested,
              count(*) FILTER (WHERE status IN ('awarded','converted_to_proposal','converted_to_contract'))::int AS awarded
         FROM contractor_job_bids WHERE contractor_id = $1 AND company_id = $2`, [who.workerId, who.companyId]);
    const openJobs = available.ok ? (available.body as any[]).filter((p) => p.acceptingBids && !p.myBidId).length : 0;
    return { body: { availableJobs: openJobs, activeBids: r.rows[0].active, revisionRequested: r.rows[0].revision_requested, awardedBids: r.rows[0].awarded } };
  });
}

// ── Background maintenance (idempotent; every row keeps its own tenant/company) ──
export async function runJobBoardMaintenance(pool: Pool, now: Date = new Date()): Promise<{ expired: number; contractsLinked: number; deadlineReminders: number }> {
  if (!(await jobBoardSchemaReady(pool))) return { expired: 0, contractsLinked: 0, deadlineReminders: 0 };
  const today = isoDate(now);
  let expired = 0, contractsLinked = 0, deadlineReminders = 0;

  // 1. Fixed-term recurring postings whose end date has passed → closed.
  const toClose = await pool.query(
    `SELECT id FROM contractor_job_posts WHERE status IN ('published','paused') AND work_type = 'recurring'
        AND estimated_end_date IS NOT NULL AND estimated_end_date < $1::date LIMIT 500`, [today]);
  for (const { id } of toClose.rows) {
    const closed = await tx(pool, async (c) => {
      const r = await c.query(`SELECT * FROM contractor_job_posts WHERE id = $1 FOR UPDATE SKIP LOCKED`, [id]);
      const post = r.rows[0];
      if (!post || post.status === "closed" || post.status === "archived") return null; // raced / already handled
      await c.query(`UPDATE contractor_job_posts SET status = 'closed', closed_at = now(), close_reason = 'end_date_passed', updated_at = now() WHERE id = $1`, [post.id]);
      await event(c, { post, type: "post_closed", oldStatus: post.status, newStatus: "closed", details: { reason: "end_date_passed", automatic: true } });
      return post;
    });
    if (closed) {
      expired++;
      await notifyWorkers(pool, await activeBidderIds(pool, closed.id), {
        companyId: closed.company_id, type: "job_closed", title: `Job posting closed: ${closed.title}`,
        body: "This posting reached its end date.", entityType: "job_post", entityId: closed.id,
      });
    }
  }

  // 2. Proposals that became contracts → bid converted_to_contract (once).
  const linked = await pool.query(
    `SELECT DISTINCT ON (b.id) b.id AS bid_id, cc.id AS contract_id
       FROM contractor_job_bids b
       JOIN contractor_contracts cc ON cc.proposal_id = b.converted_proposal_id AND cc.company_id = b.company_id
      WHERE b.status = 'converted_to_proposal'
      ORDER BY b.id, cc.created_at LIMIT 500`);
  for (const row of linked.rows) {
    const ok = await tx(pool, async (c) => {
      const r = await c.query(`SELECT * FROM contractor_job_bids WHERE id = $1 FOR UPDATE SKIP LOCKED`, [row.bid_id]);
      const bid = r.rows[0];
      if (!bid || bid.status !== "converted_to_proposal") return false;
      await c.query(`UPDATE contractor_job_bids SET status = 'converted_to_contract', converted_contract_id = $2, updated_at = now() WHERE id = $1`, [bid.id, row.contract_id]);
      await event(c, { post: { id: bid.job_post_id, company_id: bid.company_id, tenant_id: bid.tenant_id }, bidId: bid.id, type: "bid_converted_to_contract", oldStatus: bid.status, newStatus: "converted_to_contract", details: { contractId: row.contract_id, automatic: true } });
      return true;
    });
    if (ok) contractsLinked++;
  }

  // 3. Deadline within 24h → remind contractors with an unsubmitted bid (once per bid).
  const due = await pool.query(
    `SELECT b.id AS bid_id, b.contractor_id, b.tenant_id, b.company_id, p.id AS post_id, p.title
       FROM contractor_job_bids b JOIN contractor_job_posts p ON p.id = b.job_post_id AND p.company_id = b.company_id
      WHERE p.status = 'published' AND p.submission_deadline BETWEEN $1::timestamp AND $1::timestamp + interval '24 hours'
        AND b.status IN ('draft','revision_requested')
        AND NOT EXISTS (SELECT 1 FROM contractor_job_bid_events e WHERE e.bid_id = b.id AND e.event_type = 'deadline_reminder_sent')
      LIMIT 500`, [now.toISOString()]);
  for (const row of due.rows) {
    await event(pool, { post: { id: row.post_id, company_id: row.company_id, tenant_id: row.tenant_id }, bidId: row.bid_id, type: "deadline_reminder_sent", details: { automatic: true } });
    await notifyWorkers(pool, [row.contractor_id], {
      companyId: row.company_id, type: "job_deadline_approaching", title: `Bid deadline approaching: ${row.title}`,
      body: "Submit your bid before the deadline.", entityType: "job_bid", entityId: row.bid_id,
    });
    deadlineReminders++;
  }
  return { expired, contractsLinked, deadlineReminders };
}
