/**
 * Job board — the EMPLOYEE application path (migration 0029).
 *
 * Physically separate from the contractor proposal path in ./service.ts:
 *   - only postings with worker_classification = 'employee' (also enforced by
 *     the DB trigger trg_employment_applications_employee_only);
 *   - nothing here reads or writes contractor_job_bids, contractor_proposals,
 *     contractor_contracts, invoices or contractor_payments — advancing or
 *     hiring an applicant only changes employment_applications;
 *   - creating a worker record is a separate, explicit, final administrator
 *     action (convertApplicationToWorker) that writes worker_type from the
 *     posting's classification and refuses any other type;
 *   - résumés and other application documents are PRIVATE HR RECORDS: stored
 *     under PRIVATE_HR_STORAGE_DIR (not the job-attachment store, never
 *     /uploads), readable only by an administrator/manager of the company or
 *     the applicant, and every administrator read is written to
 *     employment_application_events.
 *
 * Authorization is re-derived from stored rows on every call; other
 * applicants' rows answer 404 so existence never leaks.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";
import {
  APPLICATION_CONSENT_VERSION, APPLICATION_DOCUMENT_TYPES, applicationIsApplicantEditable, applicationVisibleToAdmin,
  decideApplicationTransition, decideFill, normalizeApplicationInput, normalizeScreeningAnswer, normalizeScreeningQuestion,
  projectApplicationForAdmin, projectApplicationForApplicant, submissionsOpen, validateApplicationConsent, workerEligibleForPost,
  type ApplicationAction,
} from "./rules";
import {
  activeCandidateWorkerIds, assertTenantConsistent, canManage, event as postEvent, fail, loadPost, notifyCompanyAdmins,
  notifyWorkers, requireGate, requireManage, requireWorker, run, tx, UUID_RE,
  type JobBoardActor, type JobBoardDeps, type UploadedFile,
} from "./service";
import { applicantCanSeePost } from "./applicant-visibility";

type Q = import("pg").Pool | PoolClient;
const NOT_FOUND_APP = "Application not found";
const NOT_FOUND_POST = "Job posting not found";
const NOT_FOUND_DOC = "Document not found";

// ── Primitives ──────────────────────────────────────────────────────────────
async function loadApplication(deps: JobBoardDeps, q: Q, id: string, lock: "" | "FOR UPDATE" = ""): Promise<any> {
  if (!UUID_RE.test(String(id))) fail(404, NOT_FOUND_APP);
  const r = await q.query(`SELECT * FROM employment_applications WHERE id = $1 ${lock}`, [id]);
  const a = r.rows[0];
  if (!a) fail(404, NOT_FOUND_APP);
  await assertTenantConsistent(deps, a);
  return a;
}

function requireEmployeePost(post: any) {
  if (post.worker_classification !== "employee") fail(409, "This is contractor work — submit a proposal instead of an application");
}

/** The applicant must own the application AND still be a worker of its company. */
/** Company the caller belongs to as a submitter: its worker's company, else its applicant identity's. */
function submitterCompany(actor: JobBoardActor): string | null {
  return actor.worker?.companyId ?? actor.applicant?.companyId ?? null;
}

/** The applicant must own the application AND still belong to its company (worker or applicant identity). */
function requireOwnApplication(a: any, actor: JobBoardActor) {
  if (a.applicant_user_id !== actor.userId || submitterCompany(actor) !== a.company_id) fail(404, NOT_FOUND_APP);
}

async function appEvent(q: Q, e: {
  app: { id: string; company_id: string; tenant_id: string | null; job_post_id: string };
  type: string; oldStatus?: string | null; newStatus?: string | null; actorUserId?: string | null; details?: Record<string, unknown> | null;
}) {
  await q.query(
    `INSERT INTO employment_application_events (tenant_id, company_id, job_post_id, application_id, event_type, old_status, new_status, actor_user_id, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [e.app.tenant_id, e.app.company_id, e.app.job_post_id, e.app.id, e.type, e.oldStatus ?? null, e.newStatus ?? null,
      e.actorUserId ?? null, e.details ? JSON.stringify(e.details) : null],
  );
}

async function assertMayApply(deps: JobBoardDeps, post: any, actor: JobBoardActor): Promise<{ workerId: string | null; applicantId: string | null }> {
  if (!actor.worker && actor.applicant) {
    // Limited applicant identity: only employee postings explicitly made available to it.
    if (actor.applicant.companyId !== post.company_id) fail(404, NOT_FOUND_POST);
    if (!(await applicantCanSeePost(deps.pool, { ...post, status: "published" }, actor.applicant))) {
      if (post.worker_classification !== "employee") fail(404, NOT_FOUND_POST);
      fail(404, NOT_FOUND_POST);
    }
    const open0 = submissionsOpen(post, deps.now?.());
    if (!open0.ok) fail(open0.status, open0.message);
    await requireGate(deps, post.company_id);
    return { workerId: null, applicantId: actor.applicant.applicantId };
  }
  const who = requireWorker(actor);
  if (who.companyId !== post.company_id) fail(404, NOT_FOUND_POST);
  // Visibility first (a posting the caller cannot see stays a 404), then the path check.
  if (!workerEligibleForPost({ ...post, status: "published" }, who, false)) fail(404, NOT_FOUND_POST);
  requireEmployeePost(post);
  const open = submissionsOpen(post, deps.now?.());
  if (!open.ok) fail(open.status, open.message);
  await requireGate(deps, post.company_id);
  return { workerId: who.workerId, applicantId: null };
}

async function activeQuestions(q: Q, postId: string) {
  const r = await q.query(
    `SELECT * FROM job_screening_questions WHERE job_post_id = $1 AND archived_at IS NULL ORDER BY position, created_at`, [postId]);
  return r.rows;
}

/** Upsert supplied screening answers (prompt copied so later question edits never rewrite history). */
async function saveAnswers(c: PoolClient, app: any, raw: unknown, opts: { enforceRequired: boolean }) {
  const questions = await activeQuestions(c, app.job_post_id);
  const supplied = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  for (const k of Object.keys(supplied)) {
    if (!questions.some((q: any) => q.id === k)) fail(400, "Unknown screening question");
  }
  for (const q of questions) {
    const has = Object.prototype.hasOwnProperty.call(supplied, q.id);
    if (!has && !opts.enforceRequired) continue;
    let value: string | null;
    if (has) {
      const n = normalizeScreeningAnswer({ ...q, required: opts.enforceRequired && q.required }, supplied[q.id]);
      if (!n.ok) fail(400, `Screening question "${String(q.prompt).slice(0, 60)}" ${n.message}`);
      value = (n as any).value;
    } else {
      const prev = await c.query(`SELECT answer FROM employment_application_answers WHERE application_id = $1 AND question_id = $2`, [app.id, q.id]);
      value = prev.rows[0]?.answer ?? null;
      if (q.required && value == null) fail(400, `Answer the required screening question "${String(q.prompt).slice(0, 60)}"`);
      continue;
    }
    await c.query(
      `INSERT INTO employment_application_answers (tenant_id, company_id, application_id, question_id, question_prompt, answer)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (application_id, question_id) DO UPDATE SET answer = EXCLUDED.answer, question_prompt = EXCLUDED.question_prompt, updated_at = now()`,
      [app.tenant_id, app.company_id, app.id, q.id, q.prompt, value]);
  }
}

async function loadAnswers(q: Q, appId: string) {
  const r = await q.query(
    `SELECT question_id, question_prompt, answer FROM employment_application_answers WHERE application_id = $1 ORDER BY created_at`, [appId]);
  return r.rows.map((x: any) => ({ questionId: x.question_id, prompt: x.question_prompt, answer: x.answer }));
}

// ── Screening questions (administrator) ─────────────────────────────────────
export function addScreeningQuestion(deps: JobBoardDeps, actor: JobBoardActor, postId: string, body: Record<string, unknown>) {
  return run(async () => {
    const n = normalizeScreeningQuestion(body);
    if (!n.ok) fail(n.status, n.message);
    const v = (n as any).values;
    return tx(deps.pool, async (c) => {
      const post = await loadPost(deps, c, postId, "FOR UPDATE");
      await requireManage(actor, post.company_id, NOT_FOUND_POST);
      requireEmployeePost(post);
      if (!["draft", "published", "paused"].includes(post.status)) fail(409, `Cannot change questions on a ${post.status} posting`);
      await requireGate(deps, post.company_id);
      const ins = await c.query(
        `INSERT INTO job_screening_questions (tenant_id, company_id, job_post_id, prompt, answer_type, options, required, position, created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [post.tenant_id, post.company_id, post.id, v.prompt, v.answer_type, JSON.stringify(v.options), v.required, v.position, actor.userId]);
      const q = ins.rows[0];
      await postEvent(c, { post, type: "screening_question_added", actorUserId: actor.userId, details: { questionId: q.id, required: q.required } });
      return { status: 201, body: { id: q.id, prompt: q.prompt, answerType: q.answer_type, options: q.options, required: q.required, position: q.position } };
    });
  });
}

export function archiveScreeningQuestion(deps: JobBoardDeps, actor: JobBoardActor, questionId: string) {
  return run(async () => {
    if (!UUID_RE.test(String(questionId))) fail(404, "Question not found");
    return tx(deps.pool, async (c) => {
      const r = await c.query(`SELECT * FROM job_screening_questions WHERE id = $1 FOR UPDATE`, [questionId]);
      const q = r.rows[0];
      if (!q) fail(404, "Question not found");
      await requireManage(actor, q.company_id, "Question not found");
      const post = await loadPost(deps, c, q.job_post_id);
      if (!q.archived_at) {
        await c.query(`UPDATE job_screening_questions SET archived_at = now() WHERE id = $1`, [q.id]);
        await postEvent(c, { post, type: "screening_question_archived", actorUserId: actor.userId, details: { questionId: q.id } });
      }
      return { body: { id: q.id, archived: true } };
    });
  });
}

// ── Applicant ───────────────────────────────────────────────────────────────
export function listMyApplications(deps: JobBoardDeps, actor: JobBoardActor) {
  return run(async () => {
    const who = actor.worker || !actor.applicant ? requireWorker(actor) : { companyId: actor.applicant.companyId };
    const r = await deps.pool.query(
      `SELECT a.*, p.title AS job_title, p.status AS job_status
         FROM employment_applications a JOIN job_posts p ON p.id = a.job_post_id AND p.company_id = a.company_id
        WHERE a.applicant_user_id = $1 AND a.company_id = $2
        ORDER BY a.updated_at DESC NULLS LAST LIMIT 500`,
      [actor.userId, who.companyId]);
    return { body: r.rows.map(projectApplicationForApplicant) };
  });
}

export function createApplication(deps: JobBoardDeps, actor: JobBoardActor, postId: string, body: Record<string, unknown>) {
  return run(async () => {
    const n = normalizeApplicationInput(body);
    if (!n.ok) fail(n.status, n.message);
    const values = (n as any).values as Record<string, unknown>;
    return tx(deps.pool, async (c) => {
      const post = await loadPost(deps, c, postId, "FOR SHARE");
      const who = await assertMayApply(deps, post, actor);
      const existing = await c.query(
        `SELECT id FROM employment_applications WHERE job_post_id = $1 AND applicant_user_id = $2 AND status <> 'withdrawn'`, [post.id, actor.userId]);
      if (existing.rows.length) fail(409, "You already have an application for this position");
      const cols = Object.keys(values);
      const ins = await c.query(
        `INSERT INTO employment_applications (tenant_id, company_id, job_post_id, applicant_user_id, applicant_worker_id, applicant_id, status${cols.map((k) => ", " + k).join("")})
         VALUES ($1,$2,$3,$4,$5,$6,'draft'${cols.map((_, i) => `, $${i + 7}`).join("")}) RETURNING *`,
        [post.tenant_id, post.company_id, post.id, actor.userId, who.workerId, who.applicantId, ...cols.map((k) => values[k])]);
      const app = ins.rows[0];
      if (body?.answers) await saveAnswers(c, app, body.answers, { enforceRequired: false });
      await appEvent(c, { app, type: "application_created", newStatus: "draft", actorUserId: actor.userId });
      return { status: 201, body: { ...projectApplicationForApplicant(app), answers: await loadAnswers(c, app.id) } };
    });
  });
}

export function updateApplication(deps: JobBoardDeps, actor: JobBoardActor, appId: string, body: Record<string, unknown>) {
  return run(async () => {
    const n = normalizeApplicationInput(body);
    if (!n.ok) fail(n.status, n.message);
    const values = (n as any).values as Record<string, unknown>;
    const cols = Object.keys(values);
    if (!cols.length && !body?.answers) fail(400, "No editable fields supplied");
    return tx(deps.pool, async (c) => {
      const peek = await loadApplication(deps, c, appId);
      requireOwnApplication(peek, actor);
      const post = await loadPost(deps, c, peek.job_post_id, "FOR SHARE");
      const app = await loadApplication(deps, c, appId, "FOR UPDATE");
      requireOwnApplication(app, actor);
      if (!applicationIsApplicantEditable(app.status)) fail(409, `A ${app.status.replace(/_/g, " ")} application cannot be edited`);
      await assertMayApply(deps, post, actor);
      let after = app;
      if (cols.length) {
        const upd = await c.query(
          `UPDATE employment_applications SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1 RETURNING *`,
          [app.id, ...cols.map((k) => values[k])]);
        after = upd.rows[0];
      }
      if (body?.answers) await saveAnswers(c, app, body.answers, { enforceRequired: false });
      await appEvent(c, { app, type: "application_draft_updated", oldStatus: app.status, newStatus: app.status, actorUserId: actor.userId, details: { fields: cols, answers: !!body?.answers } });
      return { body: { ...projectApplicationForApplicant(after), answers: await loadAnswers(c, app.id) } };
    });
  });
}

/** Submit: requires consent + acknowledgements and every required screening answer. */
export function submitApplication(deps: JobBoardDeps, actor: JobBoardActor, appId: string, body: Record<string, unknown> = {}) {
  return run(async () => {
    const consent = validateApplicationConsent(body?.acknowledgements);
    if (!consent.ok) fail(consent.status, consent.message);
    const out = await tx(deps.pool, async (c) => {
      const peek = await loadApplication(deps, c, appId);
      requireOwnApplication(peek, actor);
      const post = await loadPost(deps, c, peek.job_post_id, "FOR SHARE");
      const app = await loadApplication(deps, c, appId, "FOR UPDATE");
      requireOwnApplication(app, actor);
      const d = decideApplicationTransition(app.status, "submit");
      if (!d.ok) fail(d.status, d.message);
      await assertMayApply(deps, post, actor);
      await saveAnswers(c, app, body?.answers ?? {}, { enforceRequired: true });
      const upd = await c.query(
        `UPDATE employment_applications SET status = 'submitted', submitted_at = now(), consent_version = $2, consent_accepted_at = now(),
            acknowledgements = $3::jsonb, updated_at = now() WHERE id = $1 RETURNING *`,
        [app.id, APPLICATION_CONSENT_VERSION, JSON.stringify((consent as any).acknowledgements)]);
      await appEvent(c, { app, type: "application_submitted", oldStatus: app.status, newStatus: "submitted", actorUserId: actor.userId,
        details: { consentVersion: APPLICATION_CONSENT_VERSION, acknowledgements: Object.keys((consent as any).acknowledgements) } });
      return { post, app: upd.rows[0] };
    });
    await notifyCompanyAdmins(deps.pool, {
      companyId: out.post.company_id, type: "job_application_submitted", title: `New application: ${out.post.title}`,
      body: "An applicant submitted an application for review.", entityType: "job_post", entityId: out.post.id,
    });
    return { body: projectApplicationForApplicant(out.app) };
  });
}

export function withdrawApplication(deps: JobBoardDeps, actor: JobBoardActor, appId: string) {
  return run(async () => {
    return tx(deps.pool, async (c) => {
      const app = await loadApplication(deps, c, appId, "FOR UPDATE");
      requireOwnApplication(app, actor);
      const d = decideApplicationTransition(app.status, "withdraw");
      if (!d.ok) fail(d.status, d.message);
      const upd = await c.query(`UPDATE employment_applications SET status = 'withdrawn', withdrawn_at = now(), updated_at = now() WHERE id = $1 RETURNING *`, [app.id]);
      await appEvent(c, { app, type: "application_withdrawn", oldStatus: app.status, newStatus: "withdrawn", actorUserId: actor.userId });
      return { body: projectApplicationForApplicant(upd.rows[0]) };
    });
  });
}

/** Applicant reads their own; an administrator reads any SUBMITTED application of their company. */
export function getApplication(deps: JobBoardDeps, actor: JobBoardActor, appId: string) {
  return run(async () => {
    const app = await loadApplication(deps, deps.pool, appId);
    const admin = (await canManage(actor, app.company_id)) && applicationVisibleToAdmin(app);
    if (!admin) requireOwnApplication(app, actor);
    const answers = await loadAnswers(deps.pool, app.id);
    const docs = await listDocs(deps.pool, app.id);
    if (admin) {
      const name = await applicantName(deps.pool, app);
      return { body: { ...projectApplicationForAdmin({ ...app, applicant_name: name }), answers, documents: docs, viewer: "admin" } };
    }
    return { body: { ...projectApplicationForApplicant(app), answers, documents: docs, viewer: "applicant" } };
  });
}

async function applicantName(q: Q, app: any): Promise<string | null> {
  const r = await q.query(
    `SELECT COALESCE(NULLIF(TRIM(COALESCE(w.first_name,'') || ' ' || COALESCE(w.last_name,'')), ''),
                     NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), '')) AS name
       FROM users u LEFT JOIN workers w ON w.id = $2 AND w.company_id = $3 WHERE u.id = $1`,
    [app.applicant_user_id, app.applicant_worker_id, app.company_id]);
  return r.rows[0]?.name ?? null;
}

// ── Administrator review ────────────────────────────────────────────────────
/** Comparison view: every submitted application for one employee posting (admin only). */
export function listApplicationsForPost(deps: JobBoardDeps, actor: JobBoardActor, postId: string) {
  return run(async () => {
    const post = await loadPost(deps, deps.pool, postId);
    await requireManage(actor, post.company_id, NOT_FOUND_POST);
    requireEmployeePost(post);
    const r = await deps.pool.query(
      `SELECT a.*,
              COALESCE(NULLIF(TRIM(COALESCE(w.first_name,'') || ' ' || COALESCE(w.last_name,'')), ''),
                       NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), '')) AS applicant_name,
              (SELECT count(*)::int FROM employment_application_documents d WHERE d.application_id = a.id AND d.removed_at IS NULL) AS document_count
         FROM employment_applications a
         LEFT JOIN users u ON u.id = a.applicant_user_id
         LEFT JOIN workers w ON w.id = a.applicant_worker_id AND w.company_id = a.company_id
        WHERE a.job_post_id = $1 AND a.company_id = $2 AND a.submitted_at IS NOT NULL
        ORDER BY a.submitted_at, a.created_at`,
      [post.id, post.company_id]);
    return { body: r.rows.map(projectApplicationForAdmin) };
  });
}

type AdminApplicationAction = Exclude<ApplicationAction, "submit" | "withdraw">;

/**
 * Advance/reject/hire an application. Status-only: creates NO proposal,
 * contract, invoice or contractor payment. "hire" consumes one opening and
 * closes the posting when every opening is filled.
 */
export function transitionApplication(deps: JobBoardDeps, actor: JobBoardActor, appId: string, action: AdminApplicationAction, opts: { note?: string } = {}) {
  return run(async () => {
    if (!["review", "interview", "offer", "hire", "reject"].includes(action)) fail(400, "Unknown action");
    const note = opts.note ? String(opts.note).trim().slice(0, 4000) : null;
    const out = await tx(deps.pool, async (c) => {
      const peek = await loadApplication(deps, c, appId);
      await requireManage(actor, peek.company_id, NOT_FOUND_APP);
      if (!applicationVisibleToAdmin(peek)) fail(404, NOT_FOUND_APP);
      const post = await loadPost(deps, c, peek.job_post_id, action === "hire" ? "FOR UPDATE" : "FOR SHARE");
      requireEmployeePost(post);
      const app = await loadApplication(deps, c, appId, "FOR UPDATE");
      if (app.company_id !== post.company_id || app.job_post_id !== post.id) fail(404, NOT_FOUND_APP);
      const d = decideApplicationTransition(app.status, action);
      if (!d.ok) fail(d.status, d.message);
      if (action !== "reject") await requireGate(deps, post.company_id);
      const to = (d as any).to as string;
      let closePost = false;
      let updPost = post;
      if (action === "hire") {
        const cap = decideFill(post);
        if (!cap.ok) fail(cap.status, cap.message);
        closePost = (cap as any).closeAfter;
        const pu = await c.query(
          `UPDATE job_posts SET filled_count = filled_count + 1,
              status = CASE WHEN $2 THEN 'closed' ELSE status END,
              closed_at = CASE WHEN $2 THEN now() ELSE closed_at END,
              close_reason = CASE WHEN $2 THEN 'openings_filled' ELSE close_reason END,
              updated_at = now()
            WHERE id = $1 RETURNING *`, [post.id, closePost]);
        updPost = pu.rows[0];
      }
      const upd = await c.query(
        `UPDATE employment_applications SET status = $2, reviewed_at = now(), reviewed_by_user_id = $3,
            rejection_reason = CASE WHEN $2 = 'rejected' THEN $4 ELSE rejection_reason END,
            hired_at = CASE WHEN $2 = 'hired' THEN now() ELSE hired_at END,
            hired_by_user_id = CASE WHEN $2 = 'hired' THEN $3 ELSE hired_by_user_id END,
            updated_at = now()
          WHERE id = $1 RETURNING *`,
        [app.id, to, actor.userId, note]);
      await appEvent(c, { app, type: `application_${to}`, oldStatus: app.status, newStatus: to, actorUserId: actor.userId,
        details: { ...(note ? { note } : {}), ...(action === "hire" ? { filledCount: updPost.filled_count, workerClassification: post.worker_classification } : {}) } });
      if (closePost) {
        await postEvent(c, { post, type: "post_closed", oldStatus: post.status, newStatus: "closed", actorUserId: actor.userId, details: { reason: "openings_filled" } });
      }
      return { post: updPost, app: upd.rows[0], to, closePost };
    });
    const messages: Record<string, [string, string] | undefined> = {
      interviewing: ["job_application_interview", `Interview stage: ${out.post.title}`],
      offer_extended: ["job_application_offer", `Offer extended: ${out.post.title}`],
      hired: ["job_application_hired", `You were hired: ${out.post.title}`],
      rejected: ["job_application_not_selected", `Application update: ${out.post.title}`],
    };
    const m = messages[out.to];
    if (m && out.app.applicant_worker_id) {
      await notifyWorkers(deps.pool, [out.app.applicant_worker_id], {
        companyId: out.post.company_id, type: m[0], title: m[1], entityType: "employment_application", entityId: out.app.id,
        actionUrl: "/app/contractor-hub?section=jobs&tab=applications",
      });
    }
    if (out.closePost) {
      const others = (await activeCandidateWorkerIds(deps.pool, out.post)).filter((id) => id !== out.app.applicant_worker_id);
      await notifyWorkers(deps.pool, others, {
        companyId: out.post.company_id, type: "job_closed", title: `Position filled: ${out.post.title}`,
        body: "This position is no longer accepting applications.", entityType: "job_post", entityId: out.post.id,
      });
    }
    return { body: projectApplicationForAdmin(out.app) };
  });
}

/**
 * Explicit, final administrator action: create a worker record for a hired
 * applicant. worker_type is ALWAYS the posting's classification ('employee');
 * a request asking for any other type is refused (409), never silently
 * changed. The new record starts inactive so it cannot enter payroll until the
 * administrator completes onboarding. An applicant's existing worker record
 * (for example, a contractor who applied) is never modified.
 *
 * Idempotent: the application row is locked, and a retry after a successful
 * conversion returns the SAME worker (200, replayed) instead of creating a
 * second one (uq_employment_applications_converted backs this in the DB).
 */
export function convertApplicationToWorker(deps: JobBoardDeps, actor: JobBoardActor, appId: string, body: Record<string, unknown> = {}) {
  return run(async () => {
    if (body?.confirm !== true) fail(400, "Confirm that you want to create an employee worker record for this applicant");
    const out = await tx(deps.pool, async (c) => {
      const peek = await loadApplication(deps, c, appId);
      await requireManage(actor, peek.company_id, NOT_FOUND_APP);
      const post = await loadPost(deps, c, peek.job_post_id, "FOR SHARE");
      requireEmployeePost(post);
      const app = await loadApplication(deps, c, appId, "FOR UPDATE");
      if (app.company_id !== post.company_id) fail(404, NOT_FOUND_APP);
      if (app.status !== "hired") fail(409, "Only a hired applicant can be converted to a worker record");
      const requested = body?.workerType ?? body?.workerClassification;
      if (requested != null && requested !== post.worker_classification) {
        fail(409, `Worker classification is fixed by the posting (${post.worker_classification}) and cannot be changed during conversion`);
      }
      if (app.converted_worker_id) return { app, workerId: app.converted_worker_id as string, replayed: true };
      await requireGate(deps, post.company_id);
      const u = await c.query(`SELECT first_name, last_name, email FROM users WHERE id = $1`, [app.applicant_user_id]);
      const w = app.applicant_worker_id
        ? await c.query(`SELECT first_name, last_name, email FROM workers WHERE id = $1 AND company_id = $2`, [app.applicant_worker_id, app.company_id])
        : { rows: [] as any[] };
      const src = { ...(u.rows[0] ?? {}), ...Object.fromEntries(Object.entries(w.rows[0] ?? {}).filter(([, v]) => v != null && v !== "")) };
      const first = String(body?.firstName ?? src.first_name ?? "").trim().slice(0, 100);
      const last = String(body?.lastName ?? src.last_name ?? "").trim().slice(0, 100);
      if (!first || !last) fail(400, "The applicant's first and last name are required to create a worker record");
      const workerType = post.worker_classification; // never from the request
      const payType = post.compensation_type === "salary" ? "salary" : "hourly";
      const ins = await c.query(
        `INSERT INTO workers (company_id, first_name, last_name, email, worker_type, status, is_active, job_title, pay_type, pay_rate)
         VALUES ($1,$2,$3,$4,$5::worker_type,'inactive_temporary',FALSE,$6,$7,'0') RETURNING id, worker_type`,
        [post.company_id, first, last, src.email ?? null, workerType, post.title, payType]);
      const worker = ins.rows[0];
      if (worker.worker_type !== "employee") fail(500, "Worker classification mismatch"); // defence in depth; rolls back
      const upd = await c.query(
        `UPDATE employment_applications SET converted_worker_id = $2, converted_worker_type = $3, converted_at = now(), converted_by_user_id = $4, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [app.id, worker.id, worker.worker_type, actor.userId]);
      await appEvent(c, { app, type: "application_converted_to_worker", oldStatus: app.status, newStatus: app.status, actorUserId: actor.userId,
        details: { workerId: worker.id, workerType: worker.worker_type, postingClassification: post.worker_classification } });
      return { app: upd.rows[0], workerId: worker.id as string, replayed: false };
    });
    return {
      status: out.replayed ? 200 : 201,
      body: { application: projectApplicationForAdmin(out.app), workerId: out.workerId, workerType: "employee", replayed: out.replayed, nextStep: "complete_onboarding" },
    };
  });
}

// ── Private HR documents ────────────────────────────────────────────────────
export const HR_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const HR_DOCUMENT_EXTENSIONS = /\.(pdf|docx?|rtf|txt|png|jpe?g)$/i;

/** HR documents live in their own root — never the job-attachment store, never /uploads. */
export function privateHrStoreRoot(): string {
  return path.resolve(process.env.PRIVATE_HR_STORAGE_DIR || path.join(process.cwd(), "storage", "private-hr"));
}

function resolveHrKey(key: string): string {
  const root = privateHrStoreRoot();
  const abs = path.resolve(root, key);
  if (!abs.startsWith(root + path.sep)) fail(404, NOT_FOUND_DOC);
  return abs;
}

function safeName(n: string) { return path.basename(n).replace(/[^\w.\- ()]/g, "_").slice(0, 200) || "document"; }

async function listDocs(q: Q, appId: string) {
  const r = await q.query(
    `SELECT id, document_type, file_name, content_type, file_size, created_at FROM employment_application_documents
      WHERE application_id = $1 AND removed_at IS NULL ORDER BY created_at`, [appId]);
  return r.rows.map((d: any) => ({ id: d.id, documentType: d.document_type, fileName: d.file_name, contentType: d.content_type, fileSize: d.file_size, createdAt: d.created_at }));
}

export function addApplicationDocument(deps: JobBoardDeps, actor: JobBoardActor, appId: string, file: UploadedFile | undefined, documentType: unknown) {
  return run(async () => {
    if (!file || !file.buffer?.length) fail(400, "Attach a file");
    if (file!.size > HR_DOCUMENT_MAX_BYTES) fail(413, "File exceeds the 10 MB limit");
    if (!HR_DOCUMENT_EXTENSIONS.test(file!.originalname)) fail(400, "Unsupported file type");
    const type = String(documentType ?? "resume");
    if (!(APPLICATION_DOCUMENT_TYPES as readonly string[]).includes(type)) fail(400, "Invalid documentType");
    const app = await loadApplication(deps, deps.pool, appId);
    requireOwnApplication(app, actor);
    if (!applicationIsApplicantEditable(app.status)) fail(409, "Documents can only be added before you submit");
    const post = await loadPost(deps, deps.pool, app.job_post_id);
    requireEmployeePost(post);
    await requireGate(deps, post.company_id);
    const ext = (path.extname(file!.originalname).toLowerCase().match(/^\.[a-z0-9]{1,5}$/) || [""])[0];
    const key = path.posix.join("applications", app.company_id.replace(/[^A-Za-z0-9-]/g, ""), app.id.replace(/[^A-Za-z0-9-]/g, ""), crypto.randomUUID() + ext);
    const abs = resolveHrKey(key);
    await fs.promises.mkdir(path.dirname(abs), { recursive: true, mode: 0o700 });
    await fs.promises.writeFile(abs, file!.buffer, { mode: 0o600, flag: "wx" });
    return tx(deps.pool, async (c) => {
      const ins = await c.query(
        `INSERT INTO employment_application_documents (tenant_id, company_id, job_post_id, application_id, document_type, storage_key, file_name, content_type, file_size, uploaded_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [app.tenant_id, app.company_id, app.job_post_id, app.id, type, key, safeName(file!.originalname), file!.mimetype ?? null, file!.size, actor.userId]);
      const d = ins.rows[0];
      await appEvent(c, { app, type: "document_added", oldStatus: app.status, newStatus: app.status, actorUserId: actor.userId, details: { documentId: d.id, documentType: type } });
      return { status: 201, body: { id: d.id, documentType: d.document_type, fileName: d.file_name, contentType: d.content_type, fileSize: d.file_size, createdAt: d.created_at } };
    });
  });
}

/**
 * Authorize a private HR document download. Allowed: the applicant, or an
 * administrator/manager of the company once the application is submitted.
 * Every administrator read is audited. Contractors, other applicants, other
 * companies and anonymous callers get 404 (the route itself requires auth).
 */
export function authorizeApplicationDocumentDownload(deps: JobBoardDeps, actor: JobBoardActor, documentId: string) {
  return run(async () => {
    if (!UUID_RE.test(String(documentId))) fail(404, NOT_FOUND_DOC);
    const r = await deps.pool.query(`SELECT * FROM employment_application_documents WHERE id = $1 AND removed_at IS NULL`, [documentId]);
    const d = r.rows[0];
    if (!d) fail(404, NOT_FOUND_DOC);
    await assertTenantConsistent(deps, d);
    const app = await loadApplication(deps, deps.pool, d.application_id);
    if (app.company_id !== d.company_id) fail(404, NOT_FOUND_DOC);
    const admin = (await canManage(actor, app.company_id)) && applicationVisibleToAdmin(app);
    const own = app.applicant_user_id === actor.userId && submitterCompany(actor) === app.company_id;
    if (!admin && !own) fail(404, NOT_FOUND_DOC);
    const abs = resolveHrKey(d.storage_key);
    if (!fs.existsSync(abs)) fail(404, NOT_FOUND_DOC);
    if (admin && !own) {
      await appEvent(deps.pool, { app, type: "document_viewed", oldStatus: app.status, newStatus: app.status, actorUserId: actor.userId,
        details: { documentId: d.id, documentType: d.document_type } });
    }
    return { body: { absPath: abs, fileName: d.file_name as string, contentType: (d.content_type as string) || "application/octet-stream" } };
  });
}

export function removeApplicationDocument(deps: JobBoardDeps, actor: JobBoardActor, documentId: string) {
  return run(async () => {
    if (!UUID_RE.test(String(documentId))) fail(404, NOT_FOUND_DOC);
    return tx(deps.pool, async (c) => {
      const r = await c.query(`SELECT * FROM employment_application_documents WHERE id = $1 AND removed_at IS NULL FOR UPDATE`, [documentId]);
      const d = r.rows[0];
      if (!d) fail(404, NOT_FOUND_DOC);
      const app = await loadApplication(deps, c, d.application_id, "FOR UPDATE");
      requireOwnApplication(app, actor);
      if (!applicationIsApplicantEditable(app.status)) fail(409, "Documents can only be removed before you submit");
      // Soft removal only — the file and row are retained for the HR record.
      await c.query(`UPDATE employment_application_documents SET removed_at = now(), removed_by_user_id = $2 WHERE id = $1`, [d.id, actor.userId]);
      await appEvent(c, { app, type: "document_removed", oldStatus: app.status, newStatus: app.status, actorUserId: actor.userId, details: { documentId: d.id } });
      return { body: { id: d.id, removed: true } };
    });
  });
}
