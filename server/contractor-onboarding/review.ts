/**
 * Contractor onboarding — PR 7: administrator review queue.
 *
 * Approve: admin only, after re-entering their password (recent authentication,
 * checked by the route via reauthenticateReviewer), typing the exact phrase
 * APPROVAL_PHRASE and writing a reviewer note. Under a row lock on the
 * onboarding, ADI re-assesses (fresh, inside the transaction); any blocking
 * finding refuses approval, and the reviewer must explicitly confirm the two
 * human-only checks (government ID, W-9). Then, atomically: ID + W-9 steps
 * reviewed, admin_review completed (with the note), onboarding 'verified' with
 * approver + time, audit. Repeat → already_verified.
 * Request changes: reopens one submitted/completed item for the contractor with
 * a short note. Repeat of the same request → already_changes_requested.
 * Notes are stored on the step (review_notes) but never written to audit
 * metadata or logs.
 *
 * This is the ONLY path that moves a contractor onboarding to 'verified'; the
 * legacy /api/worker-onboarding/* write routes refuse contractor packages
 * (isContractorOnboarding).
 */
import { sql } from "drizzle-orm";
import bcrypt from "bcrypt";
import { db } from "../db";
import { CONTRACTOR_ONBOARDING_PACKAGE } from "./create";
import { assessOnboarding, type Assessment, type Finding } from "./adi";

const rowsOf = <T>(r: any): T[] => (Array.isArray(r) ? r : r?.rows ?? []);
const firstRow = <T>(r: any): T | undefined => (Array.isArray(r) ? r[0] : r?.rows?.[0]);
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
export const REOPENABLE = ["government_id", "emergency_contact", "contractor_agreement", "w9"] as const;
type Reopenable = typeof REOPENABLE[number];
/** The reviewer must type exactly this (case-sensitive, no extra text) to approve. */
export const APPROVAL_PHRASE = "APPROVE ONBOARDING";

const validNote = (v: unknown): string | null => {
  const note = typeof v === "string" ? v.trim() : "";
  return !note || note.length > 500 || CONTROL_RE.test(note) ? null : note;
};

export interface QueueRow {
  onboardingId: string; workerId: string; firstName: string; lastName: string; employeeNumber: string | null;
  status: string; ready: boolean; verified: boolean; counts: Assessment["counts"];
}

/** Every unverified contractor onboarding in the company, with ADI's summary. Ready ones first. */
export async function listReviewQueue(companyId: string): Promise<QueueRow[]> {
  const rows = rowsOf<any>(await db.execute(sql`
    SELECT o.id, o.worker_id, w.first_name, w.last_name, w.employee_number
      FROM worker_onboarding o JOIN workers w ON w.id = o.worker_id AND w.company_id = o.company_id
     WHERE o.company_id = ${companyId} AND o.package_key = ${CONTRACTOR_ONBOARDING_PACKAGE} AND o.status <> 'verified'
     ORDER BY o.created_at LIMIT 200`));
  const out: QueueRow[] = [];
  for (const r of rows) {
    const a = await assessOnboarding(db, companyId, r.id);
    if (!a) continue;
    out.push({ onboardingId: r.id, workerId: r.worker_id, firstName: r.first_name, lastName: r.last_name, employeeNumber: r.employee_number,
      status: a.status, ready: a.ready, verified: a.verified, counts: a.counts });
  }
  return out.sort((a, b) => Number(b.ready) - Number(a.ready));
}

export type ReviewInput =
  | { decision: "approve"; confirmIdVerified: boolean; confirmW9Reviewed: boolean; confirmationPhrase: string; note: string }
  | { decision: "request_changes"; step: Reopenable; note: string };

export function normalizeReviewInput(body: unknown): { ok: true; value: ReviewInput } | { ok: false; message: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (b.decision === "approve") {
    const note = validNote(b.note);
    if (!note) return { ok: false, message: "Add a reviewer note (up to 500 characters) describing what you checked." };
    return { ok: true, value: { decision: "approve", confirmIdVerified: b.confirmIdVerified === true, confirmW9Reviewed: b.confirmW9Reviewed === true,
      confirmationPhrase: typeof b.confirmationPhrase === "string" ? b.confirmationPhrase : "", note } };
  }
  if (b.decision === "request_changes") {
    const step = String(b.step ?? "");
    if (!(REOPENABLE as readonly string[]).includes(step)) return { ok: false, message: "Choose which item the contractor must redo." };
    const note = validNote(b.note);
    if (!note) return { ok: false, message: "Add a short note (up to 500 characters) telling the contractor what to fix." };
    return { ok: true, value: { decision: "request_changes", step: step as Reopenable, note } };
  }
  return { ok: false, message: "Choose approve or request changes." };
}

export type ReviewOutcome =
  | { ok: true; outcome: "verified" | "already_verified" | "changes_requested" | "already_changes_requested" }
  | { ok: false; status: number; code: string; message: string; findings?: Finding[] };

export async function reviewOnboarding(args: { companyId: string; onboardingId: string; actorUserId: string; input: ReviewInput }): Promise<ReviewOutcome> {
  const { companyId, onboardingId, actorUserId, input } = args;
  return db.transaction(async (tx) => {
    const locked = firstRow<any>(await tx.execute(sql`
      SELECT id, worker_id, status, current_step_key FROM worker_onboarding
       WHERE id = ${onboardingId} AND company_id = ${companyId} AND package_key = ${CONTRACTOR_ONBOARDING_PACKAGE} FOR UPDATE`));
    if (!locked) return { ok: false as const, status: 404, code: "not_found", message: "Onboarding record not found." };
    const a = (await assessOnboarding(tx, companyId, onboardingId))!;
    const audit = (eventType: string, after: Record<string, unknown>) => tx.execute(sql`
      INSERT INTO onboarding_audit_log (company_id, worker_id, onboarding_id, actor_user_id, actor_type, event_type, after_json)
      VALUES (${companyId}, ${locked.worker_id}, ${onboardingId}, ${actorUserId}, 'admin', ${eventType}, ${JSON.stringify(after)})`);

    if (input.decision === "approve") {
      if (a.verified) return { ok: true as const, outcome: "already_verified" as const };
      if (!a.ready) return { ok: false as const, status: 409, code: "not_ready", message: "This onboarding is not complete. Resolve the items ADI lists first.", findings: a.findings.filter((x) => x.severity === "blocking") };
      if (!input.confirmIdVerified || !input.confirmW9Reviewed) return { ok: false as const, status: 400, code: "confirmation_required", message: "Confirm that you checked the government ID and reviewed the W-9." };
      if (input.confirmationPhrase !== APPROVAL_PHRASE) return { ok: false as const, status: 400, code: "confirmation_phrase", message: `Type ${APPROVAL_PHRASE} exactly to approve.` };
      await tx.execute(sql`
        UPDATE onboarding_steps SET status = 'completed', completed_at = COALESCE(completed_at, NOW()), reviewed_at = NOW(), reviewed_by = ${actorUserId}, updated_at = NOW()
         WHERE onboarding_id = ${onboardingId} AND company_id = ${companyId} AND step_key IN ('government_id','w9','admin_review')`);
      await tx.execute(sql`
        UPDATE onboarding_steps SET reviewed_at = NOW(), reviewed_by = ${actorUserId}, updated_at = NOW()
         WHERE onboarding_id = ${onboardingId} AND company_id = ${companyId} AND step_key IN ('contractor_agreement','emergency_contact')`);
      await tx.execute(sql`
        UPDATE onboarding_steps SET review_notes = ${input.note}
         WHERE onboarding_id = ${onboardingId} AND company_id = ${companyId} AND step_key = 'admin_review'`);
      await tx.execute(sql`
        UPDATE worker_onboarding SET status = 'verified', approved_at = NOW(), approved_by = ${actorUserId}, completion_percent = 100,
               current_step_key = NULL, updated_at = NOW()
         WHERE id = ${onboardingId} AND company_id = ${companyId}`);
      await audit("onboarding_verified", { acknowledged: a.findings.filter((x) => x.severity === "review").map((x) => x.code) });
      return { ok: true as const, outcome: "verified" as const };
    }

    if (a.verified) return { ok: false as const, status: 409, code: "already_verified", message: "This onboarding is already verified." };
    const cur = firstRow<any>(await tx.execute(sql`
      SELECT status FROM onboarding_steps WHERE onboarding_id = ${onboardingId} AND company_id = ${companyId} AND step_key = ${input.step}`));
    if (!cur) return { ok: false as const, status: 404, code: "not_found", message: "Onboarding record not found." };
    if (cur.status === "not_started") {
      if (locked.status === "changes_requested" && locked.current_step_key === input.step) return { ok: true as const, outcome: "already_changes_requested" as const };
      return { ok: false as const, status: 409, code: "nothing_to_reopen", message: "The contractor has not submitted this item yet." };
    }
    await tx.execute(sql`
      UPDATE onboarding_steps SET status = 'not_started', completed_at = NULL, submitted_at = NULL, review_notes = ${input.note},
             reviewed_at = NOW(), reviewed_by = ${actorUserId}, updated_at = NOW()
       WHERE onboarding_id = ${onboardingId} AND company_id = ${companyId} AND step_key = ${input.step}`);
    if (input.step === "contractor_agreement" || input.step === "w9") {
      // The signed copy stays in private storage (never deleted); the request is closed so a new one can be sent.
      await tx.execute(sql`
        UPDATE documenso_signature_requests r SET status = 'voided', updated_at = NOW()
          FROM onboarding_steps s
         WHERE s.id = r.related_record_id AND s.company_id = r.company_id AND s.onboarding_id = ${onboardingId} AND s.step_key = ${input.step}
           AND r.company_id = ${companyId} AND r.status NOT IN ('error','voided','declined','expired')`);
    }
    await tx.execute(sql`UPDATE worker_onboarding SET status = 'changes_requested', current_step_key = ${input.step}, updated_at = NOW() WHERE id = ${onboardingId} AND company_id = ${companyId}`);
    await audit("changes_requested", { step: input.step });
    return { ok: true as const, outcome: "changes_requested" as const };
  });
}

/**
 * Recent authentication for approval: the reviewer re-enters their password.
 * Failures are counted per user; after REAUTH_MAX_FAILURES in the window the
 * check refuses (429) without comparing. The password is never logged/stored.
 */
const REAUTH_WINDOW_MS = 15 * 60 * 1000;
export const REAUTH_MAX_FAILURES = 5;
const reauthFailures = new Map<string, { count: number; resetAt: number }>();
export async function reauthenticateReviewer(userId: string, password: unknown): Promise<"ok" | "invalid" | "locked"> {
  const now = Date.now();
  const f = reauthFailures.get(userId);
  if (f && f.resetAt <= now) reauthFailures.delete(userId);
  if ((reauthFailures.get(userId)?.count ?? 0) >= REAUTH_MAX_FAILURES) return "locked";
  const u = firstRow<any>(await db.execute(sql`SELECT password FROM users WHERE id = ${userId} AND is_active IS NOT FALSE`));
  const ok = typeof password === "string" && password.length > 0 && password.length <= 1024 && !!u?.password
    && await bcrypt.compare(password, u.password).catch(() => false);
  if (ok) { reauthFailures.delete(userId); return "ok"; }
  const cur = reauthFailures.get(userId) ?? { count: 0, resetAt: now + REAUTH_WINDOW_MS };
  cur.count++; reauthFailures.set(userId, cur);
  return "invalid";
}

/** True when the onboarding is a Contractor Hub package (legacy write routes must refuse it). */
export async function isContractorOnboarding(onboardingId: string): Promise<boolean> {
  return !!firstRow<any>(await db.execute(sql`
    SELECT 1 AS ok FROM worker_onboarding WHERE id = ${onboardingId} AND package_key = ${CONTRACTOR_ONBOARDING_PACKAGE}`));
}
