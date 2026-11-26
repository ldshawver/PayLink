/**
 * Contractor onboarding — PR 1: administrator creates a pending contractor.
 *
 * Input is exactly first name, last name and email. The company is the
 * authenticated administrator's own (never taken from the request). In ONE
 * transaction this:
 *   1. serializes on (company, lower(email)) with a transaction-scoped
 *      advisory lock, so two concurrent submissions cannot both create;
 *   2. refuses a second worker with the same email in the same company (409);
 *      the same email in another company is independent and never revealed;
 *   3. allocates the company-scoped YYNN employee number
 *      (server/employee-numbers.ts; counter row locked once migration 0041
 *      is applied, UNIQUE (company_id, employee_number));
 *   4. inserts the worker as an INACTIVE invoiced contractor
 *      (status 'inactive_temporary', is_active false) — fail closed: nothing
 *      that requires an active worker (bids, payroll, payments) accepts it
 *      until onboarding is verified and a later PR activates it;
 *   5. inserts worker_onboarding + the checklist steps + an audit event.
 *
 * Nothing is emailed here; the expiring account-setup invitation is PR 2.
 * Audit metadata carries ids and the employee number only — never names,
 * email addresses or any other personal value.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { allocateEmployeeNumber, EmployeeNumberExhaustedError } from "../employee-numbers";

export const CONTRACTOR_ONBOARDING_PACKAGE = "contractor_hub_v2";

export interface OnboardingStepDef {
  key: string; type: string; title: string; sequence: number; assignedToRole: "worker" | "admin";
  dependsOn?: string[];
}
/** Checklist for the contractor hub. Every step is required. */
export const CONTRACTOR_ONBOARDING_STEPS: readonly OnboardingStepDef[] = [
  { key: "account_setup", type: "account_setup", title: "Set up your account", sequence: 1, assignedToRole: "worker" },
  { key: "contractor_agreement", type: "documenso_signature", title: "Independent contractor agreement", sequence: 2, assignedToRole: "worker", dependsOn: ["account_setup"] },
  { key: "government_id", type: "private_upload", title: "Government-issued ID", sequence: 3, assignedToRole: "worker", dependsOn: ["account_setup"] },
  { key: "emergency_contact", type: "form", title: "Emergency contact", sequence: 4, assignedToRole: "worker", dependsOn: ["account_setup"] },
  { key: "w9", type: "documenso_signature", title: "Form W-9", sequence: 5, assignedToRole: "worker", dependsOn: ["account_setup"] },
  { key: "admin_review", type: "review", title: "Administrator review", sequence: 6, assignedToRole: "admin",
    dependsOn: ["contractor_agreement", "government_id", "emergency_contact", "w9"] },
] as const;

export interface CreateContractorInput { firstName: string; lastName: string; email: string }
export type CreateValidation = { ok: true; value: CreateContractorInput } | { ok: false; message: string };

const NAME_MAX = 100;
const EMAIL_MAX = 254;
// Deliberately simple: one @, no spaces, a dot in the domain. Deliverability is proven by the invite.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

export function normalizeCreateInput(body: unknown): CreateValidation {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");
  const firstName = str(b.firstName), lastName = str(b.lastName);
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (!firstName || !lastName || !email) return { ok: false, message: "First name, last name and email are required." };
  if (firstName.length > NAME_MAX || lastName.length > NAME_MAX) return { ok: false, message: `Names must be ${NAME_MAX} characters or fewer.` };
  if (CONTROL_RE.test(firstName) || CONTROL_RE.test(lastName)) return { ok: false, message: "Names contain characters that are not allowed." };
  if (email.length > EMAIL_MAX || !EMAIL_RE.test(email)) return { ok: false, message: "Enter a valid email address." };
  return { ok: true, value: { firstName, lastName, email } };
}

export type CreateOutcome =
  | { ok: true; workerId: string; onboardingId: string; employeeNumber: string; status: string }
  | { ok: false; status: 409; code: "duplicate_email"; message: string; workerId: string; onboardingId: string | null }
  | { ok: false; status: 409; code: "numbers_exhausted"; message: string };

const firstRow = <T>(r: any): T | undefined => (Array.isArray(r) ? r[0] : r?.rows?.[0]);

export const DUPLICATE_EMAIL_MESSAGE = "A worker with this email already exists in your company.";

export async function createContractorForOnboarding(args: {
  companyId: string; actorUserId: string; input: CreateContractorInput; ip?: string | null; userAgent?: string | null;
}): Promise<CreateOutcome> {
  const { companyId, actorUserId, input } = args;
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`contractor-onboarding:${companyId}:${input.email}`}))`);
      const dup = firstRow<{ id: string; onboarding_id: string | null }>(await tx.execute(sql`
        SELECT w.id, (SELECT o.id FROM worker_onboarding o WHERE o.worker_id = w.id AND o.package_key = ${CONTRACTOR_ONBOARDING_PACKAGE}
                       ORDER BY o.created_at DESC LIMIT 1) AS onboarding_id
          FROM workers w
         WHERE w.company_id = ${companyId}
           AND (lower(w.email) = ${input.email} OR lower(w.work_email) = ${input.email} OR lower(w.home_email) = ${input.email})
         ORDER BY w.created_at NULLS LAST LIMIT 1`));
      if (dup) {
        return { ok: false as const, status: 409 as const, code: "duplicate_email" as const, message: DUPLICATE_EMAIL_MESSAGE, workerId: dup.id, onboardingId: dup.onboarding_id };
      }
      const employeeNumber = await allocateEmployeeNumber(tx as any, companyId);
      const worker = firstRow<{ id: string }>(await tx.execute(sql`
        INSERT INTO workers (company_id, first_name, last_name, email, worker_type, contractor_type, worker_group,
                             pay_rate, status, is_active, employee_number)
        VALUES (${companyId}, ${input.firstName}, ${input.lastName}, ${input.email}, 'contractor', 'invoice', 'invoiced_contractor',
                '0', 'inactive_temporary', false, ${employeeNumber})
        RETURNING id`))!;
      const onboarding = firstRow<{ id: string }>(await tx.execute(sql`
        INSERT INTO worker_onboarding (company_id, worker_id, worker_type, package_key, status, current_step_key, completion_percent)
        VALUES (${companyId}, ${worker.id}, 'contractor', ${CONTRACTOR_ONBOARDING_PACKAGE}, 'invite_pending', 'account_setup', 0)
        RETURNING id`))!;
      for (const s of CONTRACTOR_ONBOARDING_STEPS) {
        await tx.execute(sql`
          INSERT INTO onboarding_steps (onboarding_id, company_id, worker_id, step_key, step_type, title, sequence, required,
                                        status, assigned_to_role, depends_on_step_keys)
          VALUES (${onboarding.id}, ${companyId}, ${worker.id}, ${s.key}, ${s.type}, ${s.title}, ${s.sequence}, true,
                  'not_started', ${s.assignedToRole}, ${s.dependsOn ? JSON.stringify(s.dependsOn) : null})`);
      }
      await tx.execute(sql`
        INSERT INTO onboarding_audit_log (company_id, worker_id, onboarding_id, actor_user_id, actor_type, event_type, after_json)
        VALUES (${companyId}, ${worker.id}, ${onboarding.id}, ${actorUserId}, 'admin', 'contractor_created',
                ${JSON.stringify({ employeeNumber, package: CONTRACTOR_ONBOARDING_PACKAGE })})`);
      return { ok: true as const, workerId: worker.id, onboardingId: onboarding.id, employeeNumber, status: "invite_pending" };
    });
  } catch (e) {
    if (e instanceof EmployeeNumberExhaustedError) return { ok: false, status: 409, code: "numbers_exhausted", message: e.message };
    throw e;
  }
}

export interface OnboardingListRow {
  workerId: string; onboardingId: string; firstName: string; lastName: string; email: string | null;
  employeeNumber: string | null; status: string; createdAt: string;
  steps: { key: string; title: string; status: string; assignedToRole: string }[];
}

/** Company-scoped list for the administrator's checklist view. */
export async function listContractorOnboarding(companyId: string): Promise<OnboardingListRow[]> {
  const rows = (await db.execute(sql`
    SELECT o.id AS onboarding_id, o.status, o.created_at, w.id AS worker_id, w.first_name, w.last_name, w.email, w.employee_number,
           COALESCE((SELECT json_agg(json_build_object('key', s.step_key, 'title', s.title, 'status', s.status, 'assignedToRole', s.assigned_to_role)
                                     ORDER BY s.sequence)
                       FROM onboarding_steps s WHERE s.onboarding_id = o.id), '[]'::json) AS steps
      FROM worker_onboarding o JOIN workers w ON w.id = o.worker_id AND w.company_id = o.company_id
     WHERE o.company_id = ${companyId} AND o.package_key = ${CONTRACTOR_ONBOARDING_PACKAGE}
     ORDER BY o.created_at DESC LIMIT 500`)) as any;
  const list = Array.isArray(rows) ? rows : rows.rows;
  return list.map((r: any) => ({
    workerId: r.worker_id, onboardingId: r.onboarding_id, firstName: r.first_name, lastName: r.last_name, email: r.email,
    employeeNumber: r.employee_number, status: r.status, createdAt: new Date(r.created_at).toISOString(), steps: r.steps,
  }));
}
