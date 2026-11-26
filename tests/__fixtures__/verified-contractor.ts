/**
 * Test fixture: give an existing contractor worker a VERIFIED Contractor Hub
 * onboarding (PR 1–7 end state + PR 9 activation), so tests that exercise the
 * marketplace routes as "an ordinary, fully onboarded contractor" pass the PR 8
 * gate. DISPOSABLE databases only. All rows cascade from companies/workers, so
 * a test's existing company cascade cleanup removes them.
 *
 * Applies the additive onboarding migrations (0042–0044) idempotently first so
 * the fixture works in a standalone run. The disposable database must already
 * have migration 0041 applied (0042 refuses to run without it).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Pool } from "pg";

const STEPS: [key: string, type: string, title: string, seq: number][] = [
  ["account_setup", "account", "Set up your account", 1],
  ["contractor_agreement", "signature", "Sign the contractor agreement", 2],
  ["government_id", "document", "Upload a government ID", 3],
  ["emergency_contact", "form", "Emergency contact", 4],
  ["w9", "signature", "Sign your W-9", 5],
  ["admin_review", "review", "Administrator review", 6],
];

export async function markContractorOnboardingVerified(pool: Pool, a: { companyId: string; workerId: string; approverUserId?: string | null }) {
  for (const m of ["0042_contractor_onboarding_esign", "0043_private_personnel_documents", "0044_contractor_onboarding_esign_events"]) {
    await pool.query(fs.readFileSync(path.join(process.cwd(), `migrations/${m}.sql`), "utf8").replace(/^\\set .*$/m, ""));
  }
  const approver = a.approverUserId ?? "fixture:approver";
  await pool.query(`UPDATE workers SET status='active', is_active=true WHERE id=$1`, [a.workerId]);
  const onb = (await pool.query(
    `INSERT INTO worker_onboarding (company_id, worker_id, package_key, status, approved_at, approved_by, completion_percent)
     VALUES ($1,$2,'contractor_hub_v2','verified',now(),$3,100) RETURNING id`, [a.companyId, a.workerId, approver])).rows[0].id as string;
  const stepIds: Record<string, string> = {};
  for (const [key, type, title, seq] of STEPS) {
    stepIds[key] = (await pool.query(
      `INSERT INTO onboarding_steps (onboarding_id, company_id, worker_id, step_key, step_type, title, sequence, status, completed_at, reviewed_at, reviewed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'completed',now(),now(),$8) RETURNING id`, [onb, a.companyId, a.workerId, key, type, title, seq, approver])).rows[0].id;
  }
  const doc = async (kind: string, mime: string) => {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO private_personnel_documents (id, company_id, worker_id, onboarding_id, document_kind, mime_type, byte_size, ciphertext_sha256, enc_key_id, enc_iv, enc_tag, uploaded_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,1,'fixture','fixture','fixture','fixture','fixture')`, [id, a.companyId, a.workerId, onb, kind, mime]);
    return id;
  };
  await doc("government_id_front", "image/jpeg");
  for (const [step, type, kind] of [["contractor_agreement", "contractor_onboarding_agreement", "signed_contractor_agreement"], ["w9", "contractor_onboarding_w9", "signed_w9"]]) {
    const fileId = await doc(kind, "application/pdf");
    await pool.query(
      `INSERT INTO documenso_signature_requests (document_type, related_record_id, company_id, status, documenso_document_id, completed_pdf_file_id, completed_at)
       VALUES ($1,$2,$3,'completed',$4,$5,now())`, [type, stepIds[step], a.companyId, `fixture_${fileId.slice(0, 8)}`, fileId]);
  }
  await pool.query(`INSERT INTO employee_contacts (worker_id, contact_type, name, phone) VALUES ($1,'emergency','Fixture Contact','5550100000')`, [a.workerId]);
  return { onboardingId: onb };
}
