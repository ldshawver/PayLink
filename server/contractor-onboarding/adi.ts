/**
 * ADI — the onboarding assistant (PR 7).
 *
 * ADI is deterministic and runs entirely inside PayLink. It reads STRUCTURED
 * records only (step states, which private documents exist, the signature
 * requests, the emergency contact) and never opens an ID image, a signed PDF or
 * a tax value, and never calls OpenAI, xAI or any other AI service. What it does:
 *   - completeness: every required item present, with evidence (e.g. a signed
 *     agreement step must have its encrypted PDF in private storage);
 *   - conflicts: records that disagree (a step marked done with no evidence,
 *     an emergency contact who is the contractor themself, …);
 *   - review tasks: items only a person may decide (the government ID always,
 *     the W-9 always — ADI cannot verify a TIN or a photo);
 *   - guidance: what the administrator should do next, in plain words.
 * Findings never contain personal values (names, numbers, emails, file names).
 */
import { sql } from "drizzle-orm";
import { CONTRACTOR_ONBOARDING_PACKAGE } from "./create";

export type Severity = "blocking" | "review" | "info";
export interface Finding { code: string; severity: Severity; step: string | null; message: string; guidance: string }
export interface Assessment {
  onboardingId: string; status: string; ready: boolean; verified: boolean;
  findings: Finding[]; counts: Record<Severity, number>;
}

const firstRow = <T>(r: any): T | undefined => (Array.isArray(r) ? r[0] : r?.rows?.[0]);
const rowsOf = <T>(r: any): T[] => (Array.isArray(r) ? r : r?.rows ?? []);
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Assess one onboarding. `exec` may be a transaction (for a re-check under lock). Null → not in this company. */
export async function assessOnboarding(exec: { execute: (q: any) => Promise<any> }, companyId: string, onboardingId: string): Promise<Assessment | null> {
  const o = firstRow<any>(await exec.execute(sql`
    SELECT o.id, o.status, o.worker_id, w.first_name, w.last_name, w.email, w.employee_number,
           w.phone, w.mobile_phone, w.home_phone
      FROM worker_onboarding o JOIN workers w ON w.id = o.worker_id AND w.company_id = o.company_id
     WHERE o.id = ${onboardingId} AND o.company_id = ${companyId} AND o.package_key = ${CONTRACTOR_ONBOARDING_PACKAGE}`));
  if (!o) return null;
  const steps = new Map(rowsOf<any>(await exec.execute(sql`
    SELECT step_key, status FROM onboarding_steps WHERE onboarding_id = ${o.id} AND company_id = ${companyId}`)).map((s) => [s.step_key, s.status]));
  const hasPrivate = !!firstRow<any>(await exec.execute(sql`SELECT to_regclass('public.private_personnel_documents') IS NOT NULL AS ok`))?.ok;
  const docs = new Set(hasPrivate ? rowsOf<any>(await exec.execute(sql`
    SELECT document_kind FROM private_personnel_documents WHERE company_id = ${companyId} AND worker_id = ${o.worker_id} AND status = 'active'`)).map((d) => d.document_kind) : []);
  const sig = new Map(rowsOf<any>(await exec.execute(sql`
    SELECT r.document_type, r.status, r.completed_pdf_file_id
      FROM documenso_signature_requests r JOIN onboarding_steps s ON s.id = r.related_record_id AND s.company_id = r.company_id
     WHERE s.onboarding_id = ${o.id} AND r.company_id = ${companyId} AND r.status = 'completed'`)).map((r) => [r.document_type, r]));
  const contact = firstRow<any>(await exec.execute(sql`
    SELECT name, phone FROM employee_contacts WHERE worker_id = ${o.worker_id} AND contact_type = 'emergency'
     ORDER BY is_primary DESC NULLS LAST, created_at DESC LIMIT 1`));
  const account = firstRow<any>(await exec.execute(sql`
    SELECT 1 AS ok FROM users WHERE worker_id = ${o.worker_id} AND company_id = ${companyId} AND role = 'contractor' AND is_active LIMIT 1`));

  const f: Finding[] = [];
  const add = (code: string, severity: Severity, step: string | null, message: string, guidance: string) => f.push({ code, severity, step, message, guidance });
  const done = (k: string) => steps.get(k) === "completed";

  // Completeness (contractor's side)
  if (!o.email) add("missing_email", "blocking", null, "No email address on file.", "Add the contractor's email before continuing.");
  if (!o.employee_number) add("missing_employee_number", "blocking", null, "No employee number assigned.", "Contact support: every contractor should receive a number when added.");
  if (!done("account_setup") || !account) add("account_not_set_up", "blocking", "account_setup", "The contractor has not set up their account.", "Send (or resend) the setup invitation.");
  if (!done("contractor_agreement")) add("agreement_not_signed", "blocking", "contractor_agreement", "The contractor agreement is not signed yet.", "Send the agreement, or use “Check status” if they have already signed.");
  if (!done("w9")) add("w9_not_signed", "blocking", "w9", "The W-9 is not signed yet.", "Send the W-9, or use “Check status” if they have already signed.");
  if (!done("emergency_contact")) add("emergency_contact_missing", "blocking", "emergency_contact", "No emergency contact has been provided.", "Ask the contractor to add one on their My Onboarding page.");
  const idStep = steps.get("government_id");
  if (idStep !== "submitted" && idStep !== "completed") add("government_id_missing", "blocking", "government_id", "No government ID has been uploaded.", "Ask the contractor to upload the front of their ID.");

  // Evidence + conflicts (records that disagree)
  if (done("contractor_agreement") && (!sig.get("contractor_onboarding_agreement")?.completed_pdf_file_id || !docs.has("signed_contractor_agreement")))
    add("agreement_evidence_missing", "blocking", "contractor_agreement", "The agreement is marked signed but its signed copy is not in private storage.", "Do not approve. Send the agreement again so a verified signed copy is stored.");
  if (done("w9") && (!sig.get("contractor_onboarding_w9")?.completed_pdf_file_id || !docs.has("signed_w9")))
    add("w9_evidence_missing", "blocking", "w9", "The W-9 is marked signed but its signed copy is not in private storage.", "Do not approve. Send the W-9 again so a verified signed copy is stored.");
  if ((idStep === "submitted" || idStep === "completed") && !docs.has("government_id_front"))
    add("government_id_evidence_missing", "blocking", "government_id", "The ID step is marked submitted but no ID file is stored.", "Ask the contractor to upload their ID again.");
  if (done("emergency_contact") && !contact)
    add("emergency_contact_evidence_missing", "blocking", "emergency_contact", "The emergency contact step is marked done but no contact is stored.", "Ask the contractor to enter their emergency contact again.");
  if (contact) {
    const own = [o.phone, o.mobile_phone, o.home_phone].map(digits).filter((d) => d.length >= 7);
    if (own.includes(digits(contact.phone))) add("emergency_contact_is_self_phone", "review", "emergency_contact", "The emergency contact's phone number is the contractor's own number.", "Confirm with the contractor, or ask them for a different contact.");
    if (norm(contact.name) && norm(contact.name) === norm(`${o.first_name} ${o.last_name}`)) add("emergency_contact_is_self_name", "review", "emergency_contact", "The emergency contact has the contractor's own name.", "Confirm with the contractor, or ask them for a different contact.");
  }

  // Human-only review tasks
  if (docs.has("government_id_front") && idStep !== "completed")
    add("review_government_id", "review", "government_id", "Government ID needs a person to check it.", "Open the ID (View ID), confirm it is unexpired and the name matches the contractor, then confirm below.");
  if (docs.has("government_id_front") && !docs.has("government_id_back"))
    add("government_id_back_missing", "info", "government_id", "Only the front of the ID was uploaded.", "Fine for passports; for a driver's license or state ID you may ask for the back.");
  if (done("w9")) add("review_w9", "review", "w9", "The W-9 needs a person to review it.", "Open the signed W-9 and check the name, tax classification and that a TIN is present. ADI does not read tax values.");

  const counts = { blocking: 0, review: 0, info: 0 } as Record<Severity, number>;
  for (const x of f) counts[x.severity]++;
  const verified = done("admin_review") && o.status === "verified";
  return { onboardingId: o.id, status: o.status, ready: counts.blocking === 0, verified, findings: f, counts };
}
