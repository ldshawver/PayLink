/**
 * Contractor onboarding — PR 8: the server-side marketplace gate.
 *
 * ONE authorization service decides whether a contractor may take part in
 * gated marketplace work (job-board bids, contractor proposals, awards,
 * contracts, invoices, payments). Every gated route uses `contractorGate(...)`
 * from this module; nothing re-implements the checks.
 *
 * A contractor passes only when ALL of these are verified from stored records:
 *   worker_status      — workers.worker_type = 'contractor', status 'active', is_active
 *   company_access     — the action's company is the contractor's own company
 *                        (and, for the contractor themself, their session company)
 *   tenant_access      — both companies resolve to the same tenant
 *   contractor_agreement — step completed, Documenso request completed with its
 *                        signed PDF, and the signed copy active in private storage
 *   w9                 — same evidence as the agreement, and reviewed by an admin
 *   government_id      — ID file active in private storage, step completed and reviewed
 *   emergency_contact  — step completed and a stored emergency contact
 *   review_pending     — no open "changes requested" item
 *   admin_review       — onboarding verified (approver + time), admin_review completed
 * A contractor with no Contractor Hub onboarding at all is denied
 * (onboarding_not_started) — legacy contractors are NOT grandfathered.
 *
 * The check is read-only (SELECTs only) and deterministic. A denial answers 403
 * with stable codes and fixed guidance — never document contents, tax data,
 * identity values or reviewer notes — and is audited (action + codes only).
 *
 * Identity comes from the session and STORED records: the contractor is either
 * the session user's own worker, or the contractor_id stored on the record the
 * route acts on. Request-supplied worker/company/tenant/onboarding ids are never
 * used to pick the subject, except where an administrator names the contractor
 * a new record is FOR (that worker must be in a company the admin can access).
 */
import type { NextFunction, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { CONTRACTOR_ONBOARDING_PACKAGE } from "./create";

type Exec = { execute: (q: any) => Promise<any> };
const firstRow = <T>(r: any): T | undefined => (Array.isArray(r) ? r[0] : r?.rows?.[0]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GATE_ERROR_CODE = "CONTRACTOR_ONBOARDING_INCOMPLETE";
export const GATE_CODES = [
  "worker_status", "company_access", "tenant_access", "onboarding_not_started",
  "contractor_agreement", "w9", "government_id", "emergency_contact", "review_pending", "admin_review",
] as const;
export type GateCode = typeof GATE_CODES[number];
const ONBOARDING_STEP_CODES: GateCode[] = ["contractor_agreement", "w9", "government_id", "emergency_contact", "admin_review"];

/** Fixed, value-free guidance per code. */
export const GATE_GUIDANCE: Record<GateCode, string> = {
  worker_status: "The contractor account is not active yet.",
  company_access: "This contractor does not belong to this company.",
  tenant_access: "This contractor does not belong to this organization.",
  onboarding_not_started: "Contractor onboarding has not been started. An administrator must add the contractor through Contractor Onboarding.",
  contractor_agreement: "The independent-contractor agreement must be signed and verified.",
  w9: "The W-9 must be signed, verified and reviewed.",
  government_id: "A government ID must be uploaded and approved.",
  emergency_contact: "An emergency contact must be provided.",
  review_pending: "An onboarding item was sent back for changes and is not resolved.",
  admin_review: "An administrator must approve the completed onboarding.",
};

export interface GateResult { allowed: boolean; missing: GateCode[] }

/**
 * Evaluate the gate for one contractor acting in one company. Read-only.
 * `sessionCompanyId` is the session user's company when the contractor acts
 * for themself (null when an administrator acts on their behalf).
 */
export async function evaluateContractorGate(exec: Exec, args: { workerId: string; companyId: string; sessionCompanyId?: string | null }): Promise<GateResult> {
  const { workerId, companyId } = args;
  const missing = new Set<GateCode>();
  const w = firstRow<any>(await exec.execute(sql`
    SELECT id, company_id, worker_type, status::text AS status, is_active FROM workers WHERE id = ${workerId}`));
  if (!w || w.worker_type !== "contractor" || w.status !== "active" || w.is_active === false) missing.add("worker_status");
  if (!w || w.company_id !== companyId || (args.sessionCompanyId != null && args.sessionCompanyId !== w.company_id)) missing.add("company_access");
  // Tenant: the action's company (or, for the contractor themself, their session company) vs the contractor's own.
  const tenantTarget = args.sessionCompanyId ?? companyId;
  // Full, ordered tenant sets (tenant_companies.company_id is not unique, so a
  // LIMIT 1 pick would be nondeterministic).
  const ten = firstRow<any>(await exec.execute(sql`
    SELECT (SELECT string_agg(DISTINCT tenant_id, ',' ORDER BY tenant_id) FROM tenant_companies WHERE company_id = ${tenantTarget}) AS target,
           (SELECT string_agg(DISTINCT tenant_id, ',' ORDER BY tenant_id) FROM tenant_companies WHERE company_id = ${w?.company_id ?? null}) AS own`));
  // Same company → same tenant by definition (a company without a mapping still
  // reaches only its own records). Different companies must BOTH be mapped to the
  // same, known tenant(s): a missing mapping never matches anything, so two
  // unmapped companies are never treated as one tenant. company_access above
  // still denies every cross-company action; this is defense in depth.
  if (!w || (tenantTarget !== w.company_id && (!ten?.target || !ten?.own || ten.target !== ten.own))) missing.add("tenant_access");

  // Onboarding is evaluated in the contractor's OWN company only.
  const o = w ? firstRow<any>(await exec.execute(sql`
    SELECT id, status, approved_at, approved_by FROM worker_onboarding
     WHERE worker_id = ${w.id} AND company_id = ${w.company_id} AND package_key = ${CONTRACTOR_ONBOARDING_PACKAGE}
     ORDER BY created_at DESC LIMIT 1`)) : undefined;
  if (!o) {
    missing.add("onboarding_not_started");
    for (const c of ONBOARDING_STEP_CODES) missing.add(c);
    return { allowed: false, missing: GATE_CODES.filter((c) => missing.has(c)) };
  }
  const steps = new Map<string, any>(((await exec.execute(sql`
    SELECT step_key, status, reviewed_by FROM onboarding_steps WHERE onboarding_id = ${o.id} AND company_id = ${w.company_id}`)).rows ?? []).map((s: any) => [s.step_key, s]));
  const hasPrivate = !!firstRow<any>(await exec.execute(sql`SELECT to_regclass('public.private_personnel_documents') IS NOT NULL AS ok`))?.ok;
  const docs = new Set<string>(hasPrivate ? ((await exec.execute(sql`
    SELECT document_kind FROM private_personnel_documents WHERE company_id = ${w.company_id} AND worker_id = ${w.id} AND status = 'active'`)).rows ?? []).map((d: any) => d.document_kind) : []);
  const signed = new Map<string, any>(((await exec.execute(sql`
    SELECT r.document_type, r.completed_pdf_file_id
      FROM documenso_signature_requests r JOIN onboarding_steps s ON s.id = r.related_record_id AND s.company_id = r.company_id
     WHERE s.onboarding_id = ${o.id} AND r.company_id = ${w.company_id} AND r.status = 'completed' AND r.completed_pdf_file_id IS NOT NULL`)).rows ?? []).map((r: any) => [r.document_type, r]));
  const contact = firstRow<any>(await exec.execute(sql`
    SELECT 1 AS ok FROM employee_contacts WHERE worker_id = ${w.id} AND contact_type = 'emergency' LIMIT 1`));

  const done = (k: string) => steps.get(k)?.status === "completed";
  const reviewed = (k: string) => done(k) && !!steps.get(k)?.reviewed_by;
  if (!done("contractor_agreement") || !signed.has("contractor_onboarding_agreement") || !docs.has("signed_contractor_agreement")) missing.add("contractor_agreement");
  if (!reviewed("w9") || !signed.has("contractor_onboarding_w9") || !docs.has("signed_w9")) missing.add("w9");
  if (!reviewed("government_id") || !docs.has("government_id_front")) missing.add("government_id");
  if (!done("emergency_contact") || !contact) missing.add("emergency_contact");
  if (o.status === "changes_requested") missing.add("review_pending");
  if (o.status !== "verified" || !o.approved_at || !o.approved_by || !done("admin_review")) missing.add("admin_review");
  return { allowed: missing.size === 0, missing: GATE_CODES.filter((c) => missing.has(c)) };
}

/** Audit one denial: action, actor kind and step codes only — never values. Best-effort. */
export async function auditGateDenial(a: { actorId: string; actor: "contractor" | "administrator" | "portal"; action: string; workerId: string; companyId: string; missing: GateCode[] }) {
  await db.execute(sql`
    INSERT INTO authorization_audit_log (actor_user_id, target_resource, change_type, after_value, company_id)
    VALUES (${a.actorId}, ${`worker:${a.workerId}`}, 'contractor_gate_denied', ${JSON.stringify({ action: a.action, actor: a.actor, missing: a.missing })}, ${a.companyId})`)
    .catch(() => console.error("[contractor-gate] audit write failed"));
}

/**
 * For in-handler callers: the share-token client portal and the public signing
 * link (no session), and administrator batch repairs that create records for
 * many contractors at once. Evaluates the same gate for the contractor STORED
 * on the record. Token callers answer with a generic refusal — an outside party
 * never learns the contractor's step codes; batch callers skip the record.
 */
export async function gateAllowsStoredContractor(
  action: string, workerId: string | null | undefined, companyId: string | null | undefined,
  by: { actorId: string; actor: "administrator" | "portal" } = { actorId: "portal:share-token", actor: "portal" },
): Promise<boolean> {
  if (!workerId || !companyId) return false;
  const r = await evaluateContractorGate(db, { workerId, companyId });
  if (!r.allowed) await auditGateDenial({ actorId: by.actorId, actor: by.actor, action, workerId, companyId, missing: r.missing });
  return r.allowed;
}

// ─── route middleware ─────────────────────────────────────────────────────────

/** Where the gated contractor comes from. Resolvers never read ids from the body unless stated. */
export type GateSubject =
  /** The session user's own contractor worker (body ids ignored). */
  | { self: true }
  /** contractor_id stored on the record named by a route param. */
  | { record: "contractor_job_bids" | "contractor_proposals" | "contractor_contracts" | "contractor_invoices" | "contractor_payments"; param: string }
  /** contractor_id stored on a record named in the body (admin "create from" flows). */
  | { recordFromBody: "contractor_proposals" | "contractor_contracts"; field: string }
  /** An administrator names the contractor a NEW record is for (validated against stored worker + admin's company access). */
  | { workerFromBody: string };

export interface GateDeps {
  getSessionUser(req: Request<any, any, any, any>): Promise<{ id: string; workerId?: string | null; companyId?: string | null } | undefined>;
  canAccessCompany(user: any, companyId: string): Promise<boolean>;
}

type RecordTable = "contractor_job_bids" | "contractor_proposals" | "contractor_contracts" | "contractor_invoices" | "contractor_payments";
/** Fixed queries per table — no identifier is ever built from input. */
const RECORD_LOOKUP: Record<RecordTable, (id: string) => any> = {
  contractor_job_bids: (id) => sql`SELECT contractor_id, company_id FROM contractor_job_bids WHERE id = ${id}`,
  contractor_proposals: (id) => sql`SELECT contractor_id, company_id FROM contractor_proposals WHERE id = ${id}`,
  contractor_contracts: (id) => sql`SELECT contractor_id, company_id FROM contractor_contracts WHERE id = ${id}`,
  contractor_invoices: (id) => sql`SELECT contractor_id, company_id FROM contractor_invoices WHERE id = ${id}`,
  contractor_payments: (id) => sql`SELECT contractor_id, company_id FROM contractor_payments WHERE id = ${id}`,
};

interface Subject { workerId: string; companyId: string; workerCompanyId?: string; self: boolean; named?: boolean }
async function loadSubject(user: { workerId?: string | null }, req: Request<any, any, any, any>, subjects: GateSubject[]): Promise<Subject | null> {
  for (const s of subjects) {
    if ("self" in s) {
      if (!user.workerId) continue;
      const w = firstRow<any>(await db.execute(sql`SELECT id, company_id, worker_type FROM workers WHERE id = ${user.workerId}`));
      if (w?.worker_type === "contractor" && w.company_id) return { workerId: w.id, companyId: w.company_id, self: true };
      continue;
    }
    let table: RecordTable, id: unknown;
    if ("record" in s) { table = s.record; id = (req.params as any)?.[s.param]; }
    else if ("recordFromBody" in s) { table = s.recordFromBody; id = (req.body as any)?.[s.field]; }
    else {
      const wid = (req.body as any)?.[s.workerFromBody];
      if (typeof wid !== "string" || !UUID_RE.test(wid)) continue;
      const w = firstRow<any>(await db.execute(sql`SELECT id, company_id FROM workers WHERE id = ${wid}`));
      if (!w?.company_id) continue;
      // The company the new record would belong to: an explicit body companyId
      // (checked against the contractor's own company by the gate), else the contractor's.
      const bodyCompany = (req.body as any)?.companyId;
      const companyId = typeof bodyCompany === "string" && UUID_RE.test(bodyCompany) ? bodyCompany : w.company_id;
      return { workerId: w.id, companyId, workerCompanyId: w.company_id, self: false, named: true };
    }
    if (typeof id !== "string" || !UUID_RE.test(id)) continue;
    const r = firstRow<any>(await db.execute(RECORD_LOOKUP[table as RecordTable](id)));
    if (r?.contractor_id && r.company_id) return { workerId: r.contractor_id, companyId: r.company_id, self: user.workerId === r.contractor_id };
  }
  return null;
}

/**
 * Express middleware: run AFTER auth/role/CSRF middleware and BEFORE the handler.
 * Unknown/foreign records fall through to the handler (which answers 404/403
 * exactly as before), so the gate never leaks another company's onboarding state.
 */
export function makeContractorGate(deps: GateDeps) {
  return (action: string, ...subjects: GateSubject[]) => async (req: Request<any, any, any, any>, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await deps.getSessionUser(req);
      if (!user) { next(); return; }
      const subject = await loadSubject(user, req, subjects);
      if (!subject) { next(); return; }
      if (!subject.self && (!(await deps.canAccessCompany(user, subject.companyId))
          || (subject.workerCompanyId && !(await deps.canAccessCompany(user, subject.workerCompanyId))))) {
        // An administrator naming a contractor outside their companies: answer
        // as if it does not exist (never fall through to a handler that might
        // create the record anyway).
        if (subject.named) { res.status(404).json({ message: "Contractor not found" }); return; }
        next(); return;
      }
      const result = await evaluateContractorGate(db, { workerId: subject.workerId, companyId: subject.companyId, sessionCompanyId: subject.self ? (user.companyId ?? null) : null });
      if (result.allowed) { next(); return; }
      await auditGateDenial({ actorId: user.id, actor: subject.self ? "contractor" : "administrator", action, workerId: subject.workerId, companyId: subject.companyId, missing: result.missing });
      res.setHeader("Cache-Control", "no-store");
      res.status(403).json({
        code: GATE_ERROR_CODE,
        message: subject.self
          ? "Finish contractor onboarding before doing this."
          : "This contractor has not completed verified onboarding.",
        missing: result.missing,
        guidance: result.missing.map((c) => GATE_GUIDANCE[c]),
      });
    } catch (e) {
      console.error(`[contractor-gate] ${action} check failed:`, (e as Error)?.message);
      if (!res.headersSent) res.status(503).json({ code: "CONTRACTOR_GATE_UNAVAILABLE", message: "Could not verify contractor onboarding. Try again." });
    }
  };
}
