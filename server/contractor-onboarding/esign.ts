/**
 * Contractor onboarding — PR 3: independent contractor agreement and W-9 via
 * Documenso TEMPLATES configured per company.
 *
 * Fail closed, in this order (each with an administrator-readable message):
 *   1. migration 0033 not applied                     → 503 esign_not_configured
 *   2. CONTRACTOR_ONBOARDING_ESIGN_ENABLED != "true"  → 503 esign_disabled
 *      (real Documenso delivery is OFF by default)
 *   3. Documenso URL / API key missing                → 503 esign_not_configured
 *   4. onboarding not in the caller's company (or not the caller's own, for a
 *      contractor)                                     → 404, non-revealing
 *   5. account setup not completed                    → 409 step_blocked
 *   6. no enabled + approved template for that kind   → 409 template_not_configured
 *
 * Idempotent: the step row is locked, then the active request is read in a
 * separate statement (see invite.ts for why). A partial unique index (0033)
 * allows only one live request per step, so a race can never produce two
 * Documenso documents for the same step. A failed call marks the request
 * 'error' (retryable); nothing is half-sent.
 *
 * What leaves the server: template id, template recipient slot, the signer's
 * name and email — to Documenso only. Never stored: Documenso's raw response
 * or signing tokens. Never logged or audited: names, emails, URLs, field values.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { CONTRACTOR_ONBOARDING_PACKAGE } from "./create";
import {
  createDocumentFromDocumensoTemplate, getDocumensoDocument, validateDocumensoConfig,
  type TemplateDocumentRequest, type TemplateDocumentResult,
} from "../services/documenso";

export const ESIGN_KINDS = {
  contractor_agreement: { stepKey: "contractor_agreement", documentType: "contractor_onboarding_agreement", label: "Independent contractor agreement" },
  w9: { stepKey: "w9", documentType: "contractor_onboarding_w9", label: "Form W-9" },
} as const;
export type EsignKind = keyof typeof ESIGN_KINDS;
export const isEsignKind = (k: unknown): k is EsignKind => typeof k === "string" && Object.prototype.hasOwnProperty.call(ESIGN_KINDS, k);

export const ESIGN_CREATING_STALE_MS = 2 * 60 * 1000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type DocumensoTemplateClient = {
  create(req: TemplateDocumentRequest): Promise<TemplateDocumentResult>;
  get(documentId: string): Promise<{ recipients: Array<{ email: string; signingUrl?: string; status?: string }> }>;
};
const realClient: DocumensoTemplateClient = {
  create: createDocumentFromDocumensoTemplate,
  get: async (id) => getDocumensoDocument(id),
};

const firstRow = <T>(r: any): T | undefined => (Array.isArray(r) ? r[0] : r?.rows?.[0]);
const rowsOf = <T>(r: any): T[] => (Array.isArray(r) ? r : r?.rows ?? []);

export function isEsignSendingEnabled(): boolean {
  return String(process.env.CONTRACTOR_ONBOARDING_ESIGN_ENABLED || "").trim().toLowerCase() === "true";
}

let tablesReadyCache = false;
export async function esignTablesReady(): Promise<boolean> {
  if (tablesReadyCache) return true;
  const r = firstRow<{ ok: boolean }>(await db.execute(sql`
    SELECT (to_regclass('public.contractor_onboarding_esign_templates') IS NOT NULL
            AND to_regclass('paylink_migrations.applied') IS NOT NULL
            AND EXISTS (SELECT 1 FROM paylink_migrations.applied WHERE version = '0033')) AS ok`));
  tablesReadyCache = !!r?.ok;
  return tablesReadyCache;
}

export type Fail = { ok: false; status: number; code: string; message: string };
const fail = (status: number, code: string, message: string): Fail => ({ ok: false, status, code, message });
const NOT_FOUND = fail(404, "not_found", "Onboarding record not found.");

export interface EsignServerStatus { tablesReady: boolean; sendingEnabled: boolean; documensoConfigured: boolean }
export async function esignServerStatus(): Promise<EsignServerStatus> {
  return { tablesReady: await esignTablesReady(), sendingEnabled: isEsignSendingEnabled(), documensoConfigured: validateDocumensoConfig().ok };
}

// ── Template mappings (administrator) ────────────────────────────────────────
export interface TemplateMapping {
  kind: EsignKind; label: string; templateId: string | null; templateRecipientId: string | null;
  enabled: boolean; approvedAt: string | null; updatedAt: string | null;
}
export async function listTemplateMappings(companyId: string): Promise<TemplateMapping[]> {
  const rows = (await esignTablesReady())
    ? rowsOf<any>(await db.execute(sql`SELECT * FROM contractor_onboarding_esign_templates WHERE company_id = ${companyId}`))
    : [];
  return (Object.keys(ESIGN_KINDS) as EsignKind[]).map((kind) => {
    const r = rows.find((x) => x.document_kind === kind);
    return {
      kind, label: ESIGN_KINDS[kind].label, templateId: r?.template_id ?? null, templateRecipientId: r?.template_recipient_id ?? null,
      enabled: !!r?.enabled, approvedAt: r?.approved_at ? new Date(r.approved_at).toISOString() : null,
      updatedAt: r?.updated_at ? new Date(r.updated_at).toISOString() : null,
    };
  });
}

export type SetMappingInput = { templateId: string; templateRecipientId: string | null; enabled: boolean };
export function normalizeMappingInput(body: unknown): { ok: true; value: SetMappingInput } | { ok: false; message: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const templateId = typeof b.templateId === "string" ? b.templateId.trim() : typeof b.templateId === "number" ? String(b.templateId) : "";
  const rid = b.templateRecipientId;
  const templateRecipientId = rid == null || rid === "" ? null : typeof rid === "string" || typeof rid === "number" ? String(rid).trim() : "\u0000";
  if (!ID_RE.test(templateId)) return { ok: false, message: "Enter the Documenso template ID (letters, numbers, - or _)." };
  if (templateRecipientId !== null && !ID_RE.test(templateRecipientId)) return { ok: false, message: "The template recipient ID may contain only letters, numbers, - or _." };
  if (typeof b.enabled !== "boolean") return { ok: false, message: "Choose whether this template is enabled." };
  return { ok: true, value: { templateId, templateRecipientId, enabled: b.enabled } };
}

/** Upsert one mapping. Enabling it records the acting administrator's approval. */
export async function setTemplateMapping(args: { companyId: string; actorUserId: string; kind: EsignKind; input: SetMappingInput }): Promise<{ ok: true; mapping: TemplateMapping } | Fail> {
  if (!(await esignTablesReady())) return fail(503, "esign_not_configured", "E-signature templates are not available yet: database migration 0033 has not been applied.");
  const { companyId, actorUserId, kind, input } = args;
  await db.transaction(async (tx) => {
    const before = firstRow<any>(await tx.execute(sql`
      SELECT template_id, template_recipient_id, enabled FROM contractor_onboarding_esign_templates
       WHERE company_id = ${companyId} AND document_kind = ${kind} FOR UPDATE`));
    const changedTemplate = !before || before.template_id !== input.templateId || (before.template_recipient_id ?? null) !== input.templateRecipientId;
    await tx.execute(sql`
      INSERT INTO contractor_onboarding_esign_templates
             (company_id, document_kind, template_id, template_recipient_id, enabled, approved_by_user_id, approved_at, updated_by_user_id)
      VALUES (${companyId}, ${kind}, ${input.templateId}, ${input.templateRecipientId}, ${input.enabled},
              ${input.enabled ? actorUserId : null}, ${input.enabled ? sql`NOW()` : null}, ${actorUserId})
      ON CONFLICT (company_id, document_kind) DO UPDATE SET
             template_id = EXCLUDED.template_id, template_recipient_id = EXCLUDED.template_recipient_id,
             enabled = EXCLUDED.enabled,
             approved_by_user_id = CASE WHEN EXCLUDED.enabled AND (${changedTemplate} OR NOT contractor_onboarding_esign_templates.enabled)
                                        THEN EXCLUDED.approved_by_user_id
                                        WHEN EXCLUDED.enabled THEN contractor_onboarding_esign_templates.approved_by_user_id ELSE NULL END,
             approved_at = CASE WHEN EXCLUDED.enabled AND (${changedTemplate} OR NOT contractor_onboarding_esign_templates.enabled)
                                THEN NOW()
                                WHEN EXCLUDED.enabled THEN contractor_onboarding_esign_templates.approved_at ELSE NULL END,
             updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = NOW()`);
    await tx.execute(sql`
      INSERT INTO authorization_audit_log (actor_user_id, target_resource, change_type, before_value, after_value, company_id)
      VALUES (${actorUserId}, 'contractor_onboarding_esign_templates', 'contractor_onboarding_esign_template_set',
              ${before ? JSON.stringify({ kind, templateId: before.template_id, templateRecipientId: before.template_recipient_id, enabled: before.enabled }) : null},
              ${JSON.stringify({ kind, ...input })}, ${companyId})`);
  });
  const mapping = (await listTemplateMappings(companyId)).find((m) => m.kind === kind)!;
  return { ok: true, mapping };
}

// ── Sending ──────────────────────────────────────────────────────────────────
export type EsignActor = { type: "admin"; userId: string } | { type: "worker"; userId: string; workerId: string };
export type StartOutcome =
  | { ok: true; outcome: "sent" | "already_sent" | "in_progress"; requestId: string | null }
  | Fail;

async function audit(tx: any, o: { company_id: string; worker_id: string; id: string }, stepId: string, actor: EsignActor, eventType: string, after: Record<string, unknown>) {
  await tx.execute(sql`
    INSERT INTO onboarding_audit_log (company_id, worker_id, onboarding_id, step_id, actor_user_id, actor_type, event_type, after_json)
    VALUES (${o.company_id}, ${o.worker_id}, ${o.id}, ${stepId}, ${actor.userId}, ${actor.type}, ${eventType}, ${JSON.stringify(after)})`);
}

export async function startOnboardingSignature(args: {
  companyId: string; onboardingId: string; kind: EsignKind; actor: EsignActor; client?: DocumensoTemplateClient; now?: () => number;
}): Promise<StartOutcome> {
  const client = args.client ?? realClient;
  const now = args.now ?? Date.now;
  const k = ESIGN_KINDS[args.kind];
  if (!(await esignTablesReady())) return fail(503, "esign_not_configured", "Electronic signing is not available yet: database migration 0033 has not been applied.");
  if (!isEsignSendingEnabled()) return fail(503, "esign_disabled", "Electronic signing for onboarding is turned off on this server. A platform administrator must enable it after the Documenso templates are approved.");
  if (!validateDocumensoConfig().ok) return fail(503, "esign_not_configured", "Documenso is not configured on this server (URL or API key missing).");

  const claim = await db.transaction(async (tx) => {
    const o = firstRow<any>(await tx.execute(sql`
      SELECT o.id, o.company_id, o.worker_id, w.email, w.first_name, w.last_name
        FROM worker_onboarding o JOIN workers w ON w.id = o.worker_id AND w.company_id = o.company_id
       WHERE o.id = ${args.onboardingId} AND o.company_id = ${args.companyId} AND o.package_key = ${CONTRACTOR_ONBOARDING_PACKAGE}`));
    if (!o || (args.actor.type === "worker" && o.worker_id !== args.actor.workerId)) return { done: NOT_FOUND };
    // Lock the step first; read everything else in later statements (fresh snapshot, lock held).
    const step = firstRow<any>(await tx.execute(sql`
      SELECT id, status FROM onboarding_steps WHERE onboarding_id = ${o.id} AND company_id = ${o.company_id} AND step_key = ${k.stepKey} FOR UPDATE`));
    if (!step) return { done: NOT_FOUND };
    if (step.status === "completed") return { done: fail(409, "already_completed", `${k.label} is already complete.`) };
    const setup = firstRow<any>(await tx.execute(sql`
      SELECT status FROM onboarding_steps WHERE onboarding_id = ${o.id} AND step_key = 'account_setup'`));
    if (setup?.status !== "completed") return { done: fail(409, "step_blocked", "The contractor must set up their account before signing documents.") };
    if (!o.email) return { done: fail(409, "no_email", "Add an email address for this contractor first.") };
    const tpl = firstRow<any>(await tx.execute(sql`
      SELECT id, template_id, template_recipient_id FROM contractor_onboarding_esign_templates
       WHERE company_id = ${o.company_id} AND document_kind = ${args.kind} AND enabled AND approved_at IS NOT NULL`));
    if (!tpl) return { done: fail(409, "template_not_configured", `No approved Documenso template is set for the ${k.label.toLowerCase()}. An administrator must add and enable it in onboarding settings.`) };
    const active = firstRow<any>(await tx.execute(sql`
      SELECT id, status, updated_at FROM documenso_signature_requests
       WHERE related_record_id = ${step.id} AND document_type = ${k.documentType}
         AND status NOT IN ('error','voided','declined','expired')`));
    if (active) {
      if (active.status !== "creating") return { done: { ok: true as const, outcome: "already_sent" as const, requestId: active.id as string } };
      if (now() - new Date(active.updated_at).getTime() < ESIGN_CREATING_STALE_MS) return { done: { ok: true as const, outcome: "in_progress" as const, requestId: active.id as string } };
      await tx.execute(sql`UPDATE documenso_signature_requests SET status = 'error', updated_at = NOW() WHERE id = ${active.id}`);
    }
    const req = firstRow<{ id: string }>(await tx.execute(sql`
      INSERT INTO documenso_signature_requests (document_type, related_record_id, company_id, status, created_by_user_id)
      VALUES (${k.documentType}, ${step.id}, ${o.company_id}, 'creating', ${args.actor.userId})
      RETURNING id`))!;
    return { o, stepId: step.id as string, tpl, requestId: req.id };
  });
  if ("done" in claim) return claim.done as StartOutcome;
  const { o, stepId, tpl, requestId } = claim;

  let result: TemplateDocumentResult;
  try {
    result = await client.create({
      templateId: tpl.template_id,
      recipients: [{ templateRecipientId: tpl.template_recipient_id, name: `${o.first_name} ${o.last_name}`.trim(), email: o.email }],
      distribute: true,
    });
  } catch (e: any) {
    // Status code only — the error body may echo the signer's details.
    console.warn(`[contractor-onboarding] Documenso template send failed (kind=${args.kind}, status=${e?.status ?? "n/a"})`);
    await db.transaction(async (tx) => {
      await tx.execute(sql`UPDATE documenso_signature_requests SET status = 'error', updated_at = NOW() WHERE id = ${requestId}`);
      await audit(tx, o, stepId, args.actor, "esign_send_failed", { kind: args.kind, requestId, httpStatus: e?.status ?? null });
    });
    return fail(502, "send_failed", "Documenso did not accept the request, so nothing was sent. Check the template mapping and try again.");
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE documenso_signature_requests SET status = 'sent_for_signature', documenso_document_id = ${result.documentId},
             sent_at = NOW(), updated_at = NOW() WHERE id = ${requestId}`);
    await tx.execute(sql`
      INSERT INTO worker_onboarding_documents (company_id, worker_id, onboarding_id, step_id, document_type, document_status, template_id, metadata_json)
      VALUES (${o.company_id}, ${o.worker_id}, ${o.id}, ${stepId}, ${args.kind}, 'sent', ${tpl.id}, ${JSON.stringify({ signatureRequestId: requestId })})`);
    await tx.execute(sql`UPDATE onboarding_steps SET status = 'in_progress', updated_at = NOW() WHERE id = ${stepId} AND status <> 'completed'`);
    await audit(tx, o, stepId, args.actor, "esign_sent", { kind: args.kind, requestId });
  });
  return { ok: true, outcome: "sent", requestId };
}

/**
 * The signer's live signing link, fetched from Documenso on demand (never
 * stored). Only for the contractor themself; matched on their own email.
 */
export async function getOwnSigningLink(args: {
  companyId: string; workerId: string; kind: EsignKind; client?: DocumensoTemplateClient;
}): Promise<{ ok: true; signingUrl: string } | Fail> {
  const client = args.client ?? realClient;
  const k = ESIGN_KINDS[args.kind];
  if (!(await esignTablesReady()) || !isEsignSendingEnabled()) return fail(503, "esign_disabled", "Electronic signing is not available right now.");
  const r = firstRow<any>(await db.execute(sql`
    SELECT r.documenso_document_id, w.email
      FROM documenso_signature_requests r
      JOIN onboarding_steps s ON s.id = r.related_record_id AND s.company_id = r.company_id
      JOIN worker_onboarding o ON o.id = s.onboarding_id AND o.package_key = ${CONTRACTOR_ONBOARDING_PACKAGE}
      JOIN workers w ON w.id = o.worker_id AND w.company_id = o.company_id
     WHERE r.company_id = ${args.companyId} AND o.worker_id = ${args.workerId} AND r.document_type = ${k.documentType}
       AND r.status = 'sent_for_signature' AND r.documenso_document_id IS NOT NULL
     ORDER BY r.created_at DESC LIMIT 1`));
  if (!r) return fail(404, "not_found", "There is no document waiting for your signature.");
  try {
    const doc = await client.get(r.documenso_document_id);
    const mine = doc.recipients.find((x) => x.email && String(x.email).toLowerCase() === String(r.email || "").toLowerCase());
    if (!mine?.signingUrl) return fail(404, "not_found", "There is no document waiting for your signature.");
    return { ok: true, signingUrl: mine.signingUrl };
  } catch (e: any) {
    console.warn(`[contractor-onboarding] Documenso lookup failed (kind=${args.kind}, status=${e?.status ?? "n/a"})`);
    return fail(502, "lookup_failed", "Could not reach the signing service. Please try again shortly.");
  }
}

/** Per-onboarding e-sign state for the admin list (no Documenso ids, no URLs). */
export async function listEsignState(companyId: string): Promise<Record<string, Partial<Record<EsignKind, string>>>> {
  if (!(await esignTablesReady())) return {};
  const rows = rowsOf<any>(await db.execute(sql`
    SELECT s.onboarding_id, r.document_type, r.status
      FROM documenso_signature_requests r JOIN onboarding_steps s ON s.id = r.related_record_id AND s.company_id = r.company_id
     WHERE r.company_id = ${companyId} AND r.document_type IN ('contractor_onboarding_agreement','contractor_onboarding_w9')
       AND r.status NOT IN ('error','voided','declined','expired')`));
  const out: Record<string, Partial<Record<EsignKind, string>>> = {};
  for (const r of rows) {
    const kind = (Object.keys(ESIGN_KINDS) as EsignKind[]).find((x) => ESIGN_KINDS[x].documentType === r.document_type)!;
    (out[r.onboarding_id] ??= {})[kind] = r.status;
  }
  return out;
}

/** The contractor's own onboarding id (same company, same worker), or null. */
export async function findOwnContractorOnboardingId(companyId: string, workerId: string): Promise<string | null> {
  const r = firstRow<{ id: string }>(await db.execute(sql`
    SELECT id FROM worker_onboarding WHERE company_id = ${companyId} AND worker_id = ${workerId} AND package_key = ${CONTRACTOR_ONBOARDING_PACKAGE}
     ORDER BY created_at DESC LIMIT 1`));
  return r?.id ?? null;
}
