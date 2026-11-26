/**
 * Contractor onboarding — PR 6: verified Documenso completion.
 *
 * A webhook is only a TRIGGER. It must carry the shared secret, be recent
 * (createdAt within the window), and not have been seen before (SHA-256 of the
 * raw body, migration 0044). Nothing in its payload is trusted or stored.
 *
 * Completion itself always re-reads the document FROM DOCUMENSO and requires:
 *   - the request is one of ours (onboarding document types, live, in a company)
 *   - Documenso's document id == the one we created
 *   - status COMPLETED
 *   - created from the template recorded at send time
 *   - signed by THIS contractor (recipient email == worker email, status SIGNED)
 *   - the signed PDF downloads and is a PDF
 *   - the private store accepts it (encrypted; kind signed_*)
 * Then, in ONE transaction: request → completed (+ private document id), step →
 * completed, onboarding document → signed, audit. A claim ('completing')
 * makes it exactly-once under concurrent webhooks / refreshes.
 * A rejected document frees the step for a new send. Anything unverifiable
 * leaves the step open and is reported with a reason code — never completed.
 */
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { getDocumensoDocument, downloadCompletedDocumensoPdf, verifyWebhookSecret } from "../services/documenso";
import { storePrivateDocument, privateDocsUnavailable, type PrivateDocKind } from "../private-documents/service";
import { ESIGN_KINDS, type EsignKind } from "./esign";

export const WEBHOOK_MAX_AGE_MS = 15 * 60 * 1000;
export const WEBHOOK_MAX_SKEW_MS = 2 * 60 * 1000;
export const COMPLETING_STALE_MS = 5 * 60 * 1000;
const HANDLED_EVENTS = new Set(["DOCUMENT_COMPLETED", "DOCUMENT_SIGNED", "DOCUMENT_RECIPIENT_COMPLETED", "DOCUMENT_REJECTED"]);
const SIGNED_KIND: Record<EsignKind, PrivateDocKind> = { contractor_agreement: "signed_contractor_agreement", w9: "signed_w9" };
const SYSTEM_ACTOR = { id: "system:documenso", role: "system", companyId: null, workerId: null };

export type RemoteDoc = { id: string; status: string; templateId: string | null; recipients: Array<{ email: string; status: string }> };
export type CompletionClient = { get(documentId: string): Promise<RemoteDoc>; downloadPdf(documentId: string): Promise<Buffer | null> };
export const realCompletionClient: CompletionClient = {
  async get(id) {
    const d = await getDocumensoDocument(id);
    const raw: any = d.rawResponse || {};
    const tpl = raw.templateId ?? raw.template?.id ?? null;
    return {
      id: String(d.id), status: String(raw.status ?? d.status ?? "").toUpperCase(),
      templateId: tpl == null ? null : String(tpl),
      recipients: (raw.recipients || []).map((r: any) => ({ email: String(r.email || ""), status: String(r.signingStatus ?? r.status ?? "").toUpperCase() })),
    };
  },
  downloadPdf: downloadCompletedDocumensoPdf,
};

const firstRow = <T>(r: any): T | undefined => (Array.isArray(r) ? r[0] : r?.rows?.[0]);
const kindOf = (documentType: string): EsignKind | null =>
  (Object.keys(ESIGN_KINDS) as EsignKind[]).find((k) => ESIGN_KINDS[k].documentType === documentType) ?? null;

export type CompletionOutcome =
  | "completed" | "already_completed" | "not_completed" | "declined" | "not_ours"
  | "in_progress" | "verification_failed" | "pdf_unavailable" | "store_unavailable" | "documenso_unreachable";

async function audit(tx: any, step: any, eventType: string, after: Record<string, unknown>) {
  await tx.execute(sql`
    INSERT INTO onboarding_audit_log (company_id, worker_id, onboarding_id, step_id, actor_user_id, actor_type, event_type, after_json)
    VALUES (${step.company_id}, ${step.worker_id}, ${step.onboarding_id}, ${step.id}, NULL, 'system', ${eventType}, ${JSON.stringify(after)})`);
}

/** Verify against Documenso and complete one signature request. Exactly-once. */
export async function completeOnboardingSignature(args: { requestId: string; client?: CompletionClient; now?: () => number }): Promise<{ outcome: CompletionOutcome; reason?: string }> {
  const client = args.client ?? realCompletionClient;
  const now = args.now ?? Date.now;

  // 1) Claim.
  const claim = firstRow<any>(await db.execute(sql`
    UPDATE documenso_signature_requests SET status = 'completing', updated_at = NOW()
     WHERE id = ${args.requestId}
       AND document_type IN ('contractor_onboarding_agreement','contractor_onboarding_w9')
       AND documenso_document_id IS NOT NULL
       AND (status = 'sent_for_signature' OR (status = 'completing' AND updated_at < ${new Date(now() - COMPLETING_STALE_MS)}))
    RETURNING id, company_id, related_record_id, document_type, documenso_document_id`));
  if (!claim) {
    const cur = firstRow<any>(await db.execute(sql`SELECT status FROM documenso_signature_requests WHERE id = ${args.requestId}
      AND document_type IN ('contractor_onboarding_agreement','contractor_onboarding_w9')`));
    if (!cur) return { outcome: "not_ours" };
    if (cur.status === "completed") return { outcome: "already_completed" };
    if (cur.status === "completing") return { outcome: "in_progress" };
    return { outcome: "not_ours", reason: `status_${cur.status}` };
  }
  const release = (status = "sent_for_signature") =>
    db.execute(sql`UPDATE documenso_signature_requests SET status = ${status}, updated_at = NOW() WHERE id = ${claim.id} AND status = 'completing'`);
  const kind = kindOf(claim.document_type)!;

  // 2) Our side of the record, company-bound.
  const step = firstRow<any>(await db.execute(sql`
    SELECT s.id, s.company_id, s.worker_id, s.onboarding_id, s.status, w.email AS worker_email,
           (SELECT d.metadata_json FROM worker_onboarding_documents d WHERE d.step_id = s.id AND d.company_id = s.company_id
              AND d.metadata_json::jsonb ->> 'signatureRequestId' = ${claim.id} ORDER BY d.created_at DESC LIMIT 1) AS meta,
           (SELECT t.template_id FROM worker_onboarding_documents d JOIN contractor_onboarding_esign_templates t ON t.id = d.template_id
             WHERE d.step_id = s.id AND d.company_id = s.company_id ORDER BY d.created_at DESC LIMIT 1) AS mapping_template_id
      FROM onboarding_steps s JOIN workers w ON w.id = s.worker_id AND w.company_id = s.company_id
     WHERE s.id = ${claim.related_record_id} AND s.company_id = ${claim.company_id} AND s.step_key = ${ESIGN_KINDS[kind].stepKey}`));
  if (!step) { await release("error"); return { outcome: "verification_failed", reason: "step_not_found" }; }
  let expectedTemplate: string | null = null;
  try { expectedTemplate = step.meta ? String(JSON.parse(step.meta).templateId ?? "") || null : null; } catch { expectedTemplate = null; }
  expectedTemplate ??= step.mapping_template_id ?? null;

  const fail = async (reason: string) => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`UPDATE documenso_signature_requests SET status = 'error', updated_at = NOW() WHERE id = ${claim.id} AND status = 'completing'`);
      await audit(tx, step, "esign_verification_failed", { kind, requestId: claim.id, reason });
    });
    console.warn(`[contractor-onboarding] signature verification failed (kind=${kind}, reason=${reason})`);
    return { outcome: "verification_failed" as const, reason };
  };

  // 3) Ask Documenso.
  let doc: RemoteDoc;
  try { doc = await client.get(claim.documenso_document_id); }
  catch (e: any) {
    await release();
    console.warn(`[contractor-onboarding] Documenso lookup failed (kind=${kind}, status=${e?.status ?? "n/a"})`);
    return { outcome: "documenso_unreachable" };
  }
  if (String(doc.id) !== String(claim.documenso_document_id)) return fail("document_mismatch");
  if (doc.status === "REJECTED") {
    await db.transaction(async (tx) => {
      await tx.execute(sql`UPDATE documenso_signature_requests SET status = 'declined', declined_at = NOW(), updated_at = NOW() WHERE id = ${claim.id}`);
      await tx.execute(sql`UPDATE onboarding_steps SET status = 'not_started', updated_at = NOW() WHERE id = ${step.id} AND status <> 'completed'`);
      await tx.execute(sql`UPDATE worker_onboarding_documents SET document_status = 'declined', updated_at = NOW() WHERE step_id = ${step.id} AND metadata_json::jsonb ->> 'signatureRequestId' = ${claim.id}`);
      await audit(tx, step, "esign_declined", { kind, requestId: claim.id });
    });
    return { outcome: "declined" };
  }
  if (doc.status !== "COMPLETED") { await release(); return { outcome: "not_completed" }; }
  if (!expectedTemplate || doc.templateId !== String(expectedTemplate)) return fail("template_mismatch");
  const email = String(step.worker_email || "").toLowerCase();
  if (!email || !doc.recipients.some((r) => r.email.toLowerCase() === email && (r.status === "SIGNED" || r.status === "COMPLETED"))) return fail("recipient_mismatch");

  // 4) The signed PDF must exist, be a PDF, and be stored privately.
  if (await privateDocsUnavailable()) { await release(); return { outcome: "store_unavailable" }; }
  let pdf: Buffer | null;
  try { pdf = await client.downloadPdf(claim.documenso_document_id); }
  catch (e: any) {
    await release();
    console.warn(`[contractor-onboarding] signed PDF download failed (kind=${kind})`);
    return { outcome: "pdf_unavailable" };
  }
  if (!pdf || pdf.length < 8 || pdf.subarray(0, 5).toString("latin1") !== "%PDF-") { await release(); return { outcome: "pdf_unavailable" }; }
  const stored = await storePrivateDocument({
    actor: SYSTEM_ACTOR, companyId: step.company_id, workerId: step.worker_id, kind: SIGNED_KIND[kind], file: pdf, onboardingId: step.onboarding_id,
  });
  if (!stored.ok) { await release(); return { outcome: "store_unavailable", reason: stored.code }; }

  // 5) Finish in one transaction (only while we still hold the claim).
  const done = await db.transaction(async (tx) => {
    const upd = firstRow<any>(await tx.execute(sql`
      UPDATE documenso_signature_requests
         SET status = 'completed', completed_at = NOW(), signed_at = COALESCE(signed_at, NOW()),
             completed_pdf_file_id = ${stored.document.id}, updated_at = NOW()
       WHERE id = ${claim.id} AND status = 'completing' RETURNING id`));
    if (!upd) return false;
    await tx.execute(sql`UPDATE onboarding_steps SET status = 'completed', completed_at = COALESCE(completed_at, NOW()), updated_at = NOW() WHERE id = ${step.id}`);
    await tx.execute(sql`
      UPDATE worker_onboarding_documents SET document_status = 'signed', signature_completed_at = NOW(), updated_at = NOW()
       WHERE step_id = ${step.id} AND metadata_json::jsonb ->> 'signatureRequestId' = ${claim.id}`);
    await audit(tx, step, "esign_completed", { kind, requestId: claim.id, privateDocumentId: stored.document.id });
    return true;
  });
  return { outcome: done ? "completed" : "already_completed" };
}

let readyCache = false;
export async function completionTablesReady(): Promise<boolean> {
  if (readyCache) return true;
  const r = firstRow<{ ok: boolean }>(await db.execute(sql`
    SELECT (to_regclass('public.contractor_onboarding_esign_events') IS NOT NULL
            AND EXISTS (SELECT 1 FROM paylink_migrations.applied WHERE version = '0044')) AS ok`).catch(() => ({ rows: [{ ok: false }] })));
  readyCache = !!r?.ok;
  return readyCache;
}

export type WebhookResult = { status: number; body: Record<string, unknown> };

/** Documenso → us. Authenticate, check freshness, de-duplicate, then verify by pulling from Documenso. */
export async function handleOnboardingWebhook(args: {
  headers: Record<string, string | string[] | undefined>; rawBody: Buffer; client?: CompletionClient; now?: () => number;
}): Promise<WebhookResult> {
  const now = args.now ?? Date.now;
  if (!verifyWebhookSecret(args.headers, args.rawBody)) return { status: 401, body: { error: "invalid signature" } };
  if (!(await completionTablesReady())) return { status: 503, body: { error: "not ready" } };
  let parsed: any;
  try { parsed = JSON.parse(args.rawBody.toString("utf8")); } catch { return { status: 400, body: { error: "invalid body" } }; }
  const createdAt = Date.parse(parsed?.createdAt ?? "");
  if (!Number.isFinite(createdAt)) return { status: 400, body: { error: "missing createdAt" } };
  if (now() - createdAt > WEBHOOK_MAX_AGE_MS || createdAt - now() > WEBHOOK_MAX_SKEW_MS) return { status: 400, body: { error: "stale or future event" } };
  const event = String(parsed?.event ?? "");
  const docId = parsed?.payload?.id != null ? String(parsed.payload.id) : null;
  const sha = crypto.createHash("sha256").update(args.rawBody).digest("hex");

  // Replay protection: first delivery wins; a previous transient failure may be retried.
  const inserted = firstRow<any>(await db.execute(sql`
    INSERT INTO contractor_onboarding_esign_events (body_sha256, event_type, documenso_document_id, outcome)
    VALUES (${sha}, ${event.slice(0, 64)}, ${docId ? docId.slice(0, 128) : null}, 'received')
    ON CONFLICT (body_sha256) DO UPDATE SET outcome = 'received', received_at = NOW()
      WHERE contractor_onboarding_esign_events.outcome IN ('documenso_unreachable','pdf_unavailable','store_unavailable','in_progress')
    RETURNING id`));
  if (!inserted) return { status: 200, body: { duplicate: true } };
  const record = (outcome: string) => db.execute(sql`UPDATE contractor_onboarding_esign_events SET outcome = ${outcome}, processed_at = NOW() WHERE id = ${inserted.id}`);

  if (!HANDLED_EVENTS.has(event) || !docId) { await record("ignored"); return { status: 200, body: { ignored: true } }; }
  const req = firstRow<any>(await db.execute(sql`
    SELECT id FROM documenso_signature_requests
     WHERE documenso_document_id = ${docId} AND document_type IN ('contractor_onboarding_agreement','contractor_onboarding_w9')
     ORDER BY created_at DESC LIMIT 1`));
  if (!req) { await record("not_ours"); return { status: 200, body: { ignored: true } }; }
  const r = await completeOnboardingSignature({ requestId: req.id, client: args.client, now });
  await record(r.outcome);
  return { status: 200, body: { outcome: r.outcome } };
}

/** For the admin "check status" action: the live request of one step, company-bound. */
export async function liveRequestForStep(companyId: string, onboardingId: string, kind: EsignKind): Promise<string | null> {
  const r = firstRow<any>(await db.execute(sql`
    SELECT r.id FROM documenso_signature_requests r
      JOIN onboarding_steps s ON s.id = r.related_record_id AND s.company_id = r.company_id
     WHERE r.company_id = ${companyId} AND s.onboarding_id = ${onboardingId} AND s.step_key = ${ESIGN_KINDS[kind].stepKey}
       AND r.document_type = ${ESIGN_KINDS[kind].documentType} AND r.status NOT IN ('error','voided','declined','expired')
     ORDER BY r.created_at DESC LIMIT 1`));
  return r?.id ?? null;
}
