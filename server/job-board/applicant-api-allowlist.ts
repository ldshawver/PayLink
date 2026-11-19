/**
 * Job-board applicant session confinement (migration 0030).
 *
 * An `applicant`-role account is a limited identity for ONE company's job
 * board: it may browse employee postings made available to it, manage its own
 * applications/documents, and use the existing feedback system for its OWN
 * submissions — nothing else. Like vendors it has a company_id but no
 * worker_id, so every other requireAuth-only /api route would otherwise reach
 * company data. Explicit method + exact-path allowlist; everything else is 403.
 *
 * Paths are relative to the /api mount (req.path inside app.use("/api", …)).
 * Every pattern is anchored at both ends — never add a prefix match here.
 */
const ID = "[0-9a-fA-F-]{36}";

export const APPLICANT_ALLOWED_API: ReadonlyArray<readonly [method: string, path: RegExp]> = [
  ["*", /^\/auth\//],
  ["*", /^\/public\/job-board\//],
  ["GET", /^\/job-posts\/available$/],
  ["GET", /^\/job-posts\/summary$/],
  ["GET", new RegExp(`^/job-posts/${ID}$`)],
  ["POST", new RegExp(`^/job-posts/${ID}/applications$`)],
  ["GET", /^\/employment-applications\/mine$/],
  ["GET", new RegExp(`^/employment-applications/${ID}$`)],
  ["PATCH", new RegExp(`^/employment-applications/${ID}$`)],
  ["POST", new RegExp(`^/employment-applications/${ID}/(submit|withdraw|documents)$`)],
  ["GET", new RegExp(`^/employment-application-documents/${ID}/download$`)],
  ["POST", new RegExp(`^/employment-application-documents/${ID}/remove$`)],
  ["GET", new RegExp(`^/job-post-attachments/${ID}/download$`)],
  // Feedback (v2.2.21) — the applicant's OWN submissions only. The handlers in
  // server/feedback-routes.ts additionally restrict applicants to tickets they
  // submitted, strip reviewer-only fields and never return internal comments.
  // Not allowed: GET /feedback (admin queue), GET/PATCH /feedback/:id.
  ["POST", /^\/feedback$/],
  ["GET", /^\/feedback\/mine$/],
  ["GET", new RegExp(`^/feedback/${ID}/comments$`)],
  ["POST", new RegExp(`^/feedback/${ID}/comments$`)],
];

export function isApplicantApiAllowed(method: string, path: string): boolean {
  const p = path.split("?")[0];
  return APPLICANT_ALLOWED_API.some(([m, re]) => (m === "*" || m === method) && re.test(p));
}
