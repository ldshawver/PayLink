/**
 * Private personnel documents — who may upload, list and open them.
 *
 * Access (server-side, every request):
 *   - the worker the document belongs to (their own login: users.worker_id), or
 *   - an ADMIN or MANAGER of the SAME company (home company, or an active
 *     company_user_access grant with role admin/manager/owner for it).
 *   Platform roles do NOT get implicit access to these files.
 * Every upload, view and download — allowed or denied — is written to
 * private_document_access_log (ids, role, action, outcome only). A denied or
 * non-existent id returns the same 404.
 */
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { CONTRACTOR_ONBOARDING_PACKAGE } from "../contractor-onboarding/create";
import { detectType, PRIVATE_DOC_MAX_BYTES, readAndOpen, sealAndWrite, discard, storeStatus, STORE_STATUS_MESSAGE } from "./store";

export const PRIVATE_DOC_KINDS = ["government_id_front", "government_id_back", "signed_contractor_agreement", "signed_w9"] as const;
export type PrivateDocKind = typeof PRIVATE_DOC_KINDS[number];
export const KIND_LABEL: Record<PrivateDocKind, string> = {
  government_id_front: "Government ID (front)",
  government_id_back: "Government ID (back)",
  signed_contractor_agreement: "Signed contractor agreement",
  signed_w9: "Signed W-9",
};
/** Kinds a person may upload by hand. Signed documents only ever come from Documenso. */
export const UPLOADABLE_KINDS: readonly PrivateDocKind[] = ["government_id_front", "government_id_back"];

export type Actor = { id: string; role: string; companyId: string | null; workerId: string | null };
export type Fail = { ok: false; status: number; code: string; message: string };
const fail = (status: number, code: string, message: string): Fail => ({ ok: false, status, code, message });
export const NOT_FOUND_MESSAGE = "Document not found.";
const notFound = () => fail(404, "not_found", NOT_FOUND_MESSAGE);

const firstRow = <T>(r: any): T | undefined => (Array.isArray(r) ? r[0] : r?.rows?.[0]);
const rowsOf = <T>(r: any): T[] => (Array.isArray(r) ? r : r?.rows ?? []);

let readyCache = false;
export async function privateDocsReady(): Promise<boolean> {
  if (readyCache) return true;
  const r = firstRow<{ ok: boolean }>(await db.execute(sql`
    SELECT (to_regclass('public.private_personnel_documents') IS NOT NULL
            AND to_regclass('paylink_migrations.applied') IS NOT NULL
            AND EXISTS (SELECT 1 FROM paylink_migrations.applied WHERE version = '0034')) AS ok`));
  readyCache = !!r?.ok;
  return readyCache;
}

/** Fail-closed configuration check shared by upload and download. */
export async function privateDocsUnavailable(): Promise<Fail | null> {
  if (!(await privateDocsReady())) return fail(503, "private_docs_not_configured", "Private document storage is not available yet: database migration 0034 has not been applied.");
  const s = storeStatus();
  if (!s.ok) return fail(503, "private_docs_not_configured", STORE_STATUS_MESSAGE[s.reason]);
  return null;
}

/** Owner, or an admin/manager of the same company. No platform bypass. */
export async function canAccessWorkerPrivateDocs(actor: Actor, companyId: string, workerId: string): Promise<boolean> {
  if (actor.workerId && actor.workerId === workerId && actor.companyId === companyId) return true;
  if (actor.role !== "admin" && actor.role !== "manager") return false;
  if (actor.companyId === companyId) return true;
  const g = firstRow(await db.execute(sql`
    SELECT 1 FROM company_user_access
     WHERE user_id = ${actor.id} AND company_id = ${companyId} AND is_active = TRUE AND role IN ('admin','manager','owner') LIMIT 1`));
  return !!g;
}

async function logAccess(tx: any, d: { id: string; company_id: string; worker_id: string }, actor: Actor, action: "upload" | "view" | "download", outcome: "allowed" | "denied") {
  await tx.execute(sql`
    INSERT INTO private_document_access_log (document_id, company_id, worker_id, actor_user_id, actor_role, action, outcome)
    VALUES (${d.id}, ${d.company_id}, ${d.worker_id}, ${actor.id}, ${actor.role}, ${action}, ${outcome})`);
}

export type DocMeta = { id: string; kind: PrivateDocKind; label: string; mimeType: string; byteSize: number; uploadedAt: string };
const toMeta = (r: any): DocMeta => ({
  id: r.id, kind: r.document_kind, label: KIND_LABEL[r.document_kind as PrivateDocKind] ?? r.document_kind,
  mimeType: r.mime_type, byteSize: r.byte_size, uploadedAt: new Date(r.created_at).toISOString(),
});

/** Active documents for one worker (metadata only — no contents, no names). Caller has authorized. */
export async function listWorkerPrivateDocs(companyId: string, workerId: string): Promise<DocMeta[]> {
  if (!(await privateDocsReady())) return [];
  const rows = rowsOf<any>(await db.execute(sql`
    SELECT id, document_kind, mime_type, byte_size, created_at FROM private_personnel_documents
     WHERE company_id = ${companyId} AND worker_id = ${workerId} AND status = 'active' ORDER BY document_kind`));
  return rows.map(toMeta);
}

/**
 * Store one file for (company, worker, kind). The caller must already have
 * established that `actor` may upload for this worker. Replaces any active file
 * of the same kind (the old row is kept as 'superseded', never overwritten).
 */
export async function storePrivateDocument(args: {
  actor: Actor; companyId: string; workerId: string; kind: PrivateDocKind; file: Buffer; onboardingId?: string | null;
}): Promise<{ ok: true; document: DocMeta } | Fail> {
  const unavailable = await privateDocsUnavailable();
  if (unavailable) return unavailable;
  if (!args.file?.length) return fail(400, "empty_file", "Choose a file to upload.");
  if (args.file.length > PRIVATE_DOC_MAX_BYTES) return fail(413, "too_large", "The file is larger than 10 MB.");
  const type = detectType(args.file);
  if (!type) return fail(415, "unsupported_type", "Upload a JPEG, PNG, HEIC or PDF file.");

  const documentId = crypto.randomUUID();
  const binding = { documentId, companyId: args.companyId, workerId: args.workerId, kind: args.kind };
  const sealed = sealAndWrite(args.file, binding);
  try {
    const doc = await db.transaction(async (tx) => {
      // Serialize per (worker, kind); the partial unique index is the backstop.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ppd:${args.workerId}:${args.kind}`}))`);
      await tx.execute(sql`
        UPDATE private_personnel_documents SET status = 'superseded', superseded_at = NOW()
         WHERE worker_id = ${args.workerId} AND company_id = ${args.companyId} AND document_kind = ${args.kind} AND status = 'active'`);
      const row = firstRow<any>(await tx.execute(sql`
        INSERT INTO private_personnel_documents
               (id, company_id, worker_id, onboarding_id, document_kind, mime_type, byte_size, ciphertext_sha256, enc_key_id, enc_iv, enc_tag, uploaded_by_user_id)
        VALUES (${documentId}, ${args.companyId}, ${args.workerId}, ${args.onboardingId ?? null}, ${args.kind}, ${type.mime}, ${sealed.size},
                ${sealed.ciphertextSha256}, ${sealed.keyId}, ${sealed.iv}, ${sealed.tag}, ${args.actor.id})
        RETURNING id, document_kind, mime_type, byte_size, created_at, company_id, worker_id`))!;
      await logAccess(tx, row, args.actor, "upload", "allowed");
      if (args.onboardingId && (args.kind === "government_id_front" || args.kind === "government_id_back")) {
        const step = firstRow<any>(await tx.execute(sql`
          UPDATE onboarding_steps SET status = 'submitted', submitted_at = NOW(), updated_at = NOW()
           WHERE onboarding_id = ${args.onboardingId} AND company_id = ${args.companyId} AND step_key = 'government_id'
             AND status NOT IN ('completed')
          RETURNING id`));
        await tx.execute(sql`
          INSERT INTO onboarding_audit_log (company_id, worker_id, onboarding_id, step_id, actor_user_id, actor_type, event_type, after_json)
          VALUES (${args.companyId}, ${args.workerId}, ${args.onboardingId}, ${step?.id ?? null}, ${args.actor.id},
                  ${args.actor.workerId === args.workerId ? "worker" : "admin"}, 'private_document_uploaded',
                  ${JSON.stringify({ kind: args.kind, documentId })})`);
      }
      return row;
    });
    return { ok: true, document: toMeta(doc) };
  } catch (e) {
    discard(documentId);
    throw e;
  }
}

/** Open a document for the actor. Every attempt on an existing document is logged; anything refused is a plain 404. */
export async function openPrivateDocument(args: { actor: Actor; documentId: string; disposition: "view" | "download" }):
  Promise<{ ok: true; body: Buffer; mimeType: string; filename: string } | Fail> {
  const unavailable = await privateDocsUnavailable();
  if (unavailable) return unavailable;
  if (!/^[0-9a-f-]{36}$/.test(args.documentId)) return notFound();
  const d = firstRow<any>(await db.execute(sql`
    SELECT id, company_id, worker_id, document_kind, mime_type, ciphertext_sha256, enc_key_id, enc_iv, enc_tag
      FROM private_personnel_documents WHERE id = ${args.documentId}`));
  if (!d) return notFound();
  const allowed = await canAccessWorkerPrivateDocs(args.actor, d.company_id, d.worker_id);
  await logAccess(db, d, args.actor, args.disposition, allowed ? "allowed" : "denied");
  if (!allowed) return notFound();
  const body = readAndOpen(
    { documentId: d.id, companyId: d.company_id, workerId: d.worker_id, kind: d.document_kind },
    { keyId: d.enc_key_id, iv: d.enc_iv, tag: d.enc_tag, ciphertextSha256: d.ciphertext_sha256 },
  );
  const ext = d.mime_type === "application/pdf" ? "pdf" : d.mime_type === "image/png" ? "png" : d.mime_type === "image/heic" ? "heic" : "jpg";
  // Generic name: never the uploader's original file name or anyone's name.
  return { ok: true, body, mimeType: d.mime_type, filename: `${String(d.document_kind).replace(/_/g, "-")}.${ext}` };
}

/** The contractor's own onboarding (id + status + steps), or null. */
export async function ownOnboardingSummary(companyId: string, workerId: string) {
  const o = firstRow<any>(await db.execute(sql`
    SELECT o.id, o.status, w.employee_number,
           COALESCE((SELECT json_agg(json_build_object('key', s.step_key, 'title', s.title, 'status', s.status) ORDER BY s.sequence)
                       FROM onboarding_steps s WHERE s.onboarding_id = o.id), '[]'::json) AS steps
      FROM worker_onboarding o JOIN workers w ON w.id = o.worker_id AND w.company_id = o.company_id
     WHERE o.company_id = ${companyId} AND o.worker_id = ${workerId} AND o.package_key = ${CONTRACTOR_ONBOARDING_PACKAGE}
     ORDER BY o.created_at DESC LIMIT 1`));
  if (!o) return null;
  return { onboardingId: o.id as string, status: o.status as string, employeeNumber: o.employee_number as string | null, steps: o.steps as { key: string; title: string; status: string }[] };
}

/** Admin/manager view: is this onboarding in the actor's company? Returns the worker or null (→ 404). */
export async function onboardingWorkerForCompany(companyId: string, onboardingId: string): Promise<{ workerId: string } | null> {
  const o = firstRow<any>(await db.execute(sql`
    SELECT worker_id FROM worker_onboarding WHERE id = ${onboardingId} AND company_id = ${companyId} AND package_key = ${CONTRACTOR_ONBOARDING_PACKAGE}`));
  return o ? { workerId: o.worker_id } : null;
}
