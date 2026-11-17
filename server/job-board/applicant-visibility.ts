/**
 * Applicant visibility (migration 0030). No imports from ./service so the
 * service and public-access modules can both use it without a cycle.
 */
import type { Pool, PoolClient } from "pg";

type Q = Pool | PoolClient;

export interface ApplicantIdentity { applicantId: string; companyId: string; tenantId: string }

/** users.role = 'applicant' → its ACTIVE job_applicants identity (or null = no access). */
export async function loadApplicantIdentity(pool: Pool, userId: string): Promise<ApplicantIdentity | null> {
  const ready = await pool.query(`SELECT to_regclass('public.job_applicants') r`).then((x) => !!x.rows[0]?.r).catch(() => false);
  if (!ready) return null;
  const r = await pool.query(`SELECT id, company_id, tenant_id, status FROM job_applicants WHERE user_id = $1 LIMIT 1`, [userId]);
  const a = r.rows[0];
  if (!a || a.status !== "active") return null;
  return { applicantId: a.id, companyId: a.company_id, tenantId: a.tenant_id };
}

/**
 * Can this applicant see the posting? Employee postings of their own company
 * only, published, with an EXPLICIT public visibility of public or
 * access_required — or invite_only with an active grant. NULL (never chosen)
 * is internal-only for applicants.
 */
export async function applicantCanSeePost(q: Q, post: any, a: ApplicantIdentity): Promise<boolean> {
  if (post.company_id !== a.companyId || post.worker_classification !== "employee" || post.status !== "published") return false;
  if (post.public_visibility === "public" || post.public_visibility === "access_required") return true;
  if (post.public_visibility === "invite_only") {
    const g = await q.query(`SELECT 1 FROM job_post_access_grants WHERE job_post_id = $1 AND applicant_id = $2 AND revoked_at IS NULL`, [post.id, a.applicantId]);
    return g.rows.length > 0;
  }
  return false;
}

/** SQL fragment version of applicantCanSeePost for list queries ($company, $applicant). */
export const APPLICANT_VISIBLE_SQL = `
  p.company_id = $1 AND p.worker_classification = 'employee' AND p.status = 'published'
  AND (p.public_visibility IN ('public','access_required')
       OR (p.public_visibility = 'invite_only' AND EXISTS (
             SELECT 1 FROM job_post_access_grants g WHERE g.job_post_id = p.id AND g.applicant_id = $2 AND g.revoked_at IS NULL)))`;

