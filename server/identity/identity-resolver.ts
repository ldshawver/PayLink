/**
 * Shared identity resolver — server/identity/identity-resolver.ts
 *
 * PR 1 of the SaaS identity/onboarding architecture cleanup
 * (docs/saas-identity-onboarding-architecture.md).
 *
 * This module is PURE and dependency-free so it can be exercised directly by
 * tests. It answers one question deterministically:
 *
 *   "Given every place an email for this person could live, which single email
 *    is authoritative, and do the sources disagree?"
 *
 * Rules (from the PR 1 brief):
 *   - Deterministic precedence, never name matching.
 *   - Prefer the canonical contractor/profile email (workers.email) when the
 *     app has one; otherwise fall through worker work/home email, then the
 *     linked login account's email, then the linked global person's email.
 *   - If sources disagree, still return a single deterministic answer AND
 *     report the conflicting values so a later cleanup pass (or an admin) can
 *     reconcile them. We never silently merge or "average" identities.
 *
 * Tenant scoping is the CALLER's responsibility: the caller must only pass in
 * emails it loaded with a company/tenant-scoped query (see
 * loadWorkerSignerEmailSources in server/identity/identity-db.ts). This module
 * never reaches across a boundary because it never touches the database.
 */

export type SignerEmailSourceKey =
  | "worker_email"
  | "worker_work_email"
  | "worker_home_email"
  | "linked_user_email"
  | "linked_person_email";

export interface SignerEmailSources {
  /** workers.email — treated as the canonical contractor/profile email. */
  workerEmail?: string | null;
  /** workers.work_email */
  workerWorkEmail?: string | null;
  /** workers.home_email */
  workerHomeEmail?: string | null;
  /** users.email for the login account linked to this worker (users.worker_id = worker.id). */
  linkedUserEmail?: string | null;
  /** persons.email for the global identity linked to this worker (workers.person_id = persons.id). */
  linkedPersonEmail?: string | null;
}

export interface ResolvedSignerEmail {
  /** The chosen email in its original (non-normalized) form, or null if none exists anywhere. */
  email: string | null;
  /** Which source won, or null when there is no email at all. */
  source: SignerEmailSourceKey | null;
  /**
   * Distinct normalized emails present in the OTHER sources that differ from
   * the chosen one. Empty when every populated source agrees. Never a reason
   * to block on its own — reported for cleanup/audit.
   */
  conflicts: string[];
  /** True when at least one source had a usable email. */
  hasEmail: boolean;
}

/** Lower-case + trim. Null/blank normalize to "". */
export function normalizeEmail(email: string | null | undefined): string {
  return (email || "").trim().toLowerCase();
}

/** Deterministic precedence order, highest authority first. */
const PRECEDENCE: ReadonlyArray<{ key: SignerEmailSourceKey; get: (s: SignerEmailSources) => string | null | undefined }> = [
  { key: "worker_email", get: (s) => s.workerEmail },
  { key: "worker_work_email", get: (s) => s.workerWorkEmail },
  { key: "worker_home_email", get: (s) => s.workerHomeEmail },
  { key: "linked_user_email", get: (s) => s.linkedUserEmail },
  { key: "linked_person_email", get: (s) => s.linkedPersonEmail },
];

/**
 * Resolve the authoritative email for a contractor/employee signer from all
 * known sources. Pure — no DB, no network.
 */
export function resolveSignerEmail(sources: SignerEmailSources): ResolvedSignerEmail {
  let chosen: { key: SignerEmailSourceKey; raw: string } | null = null;
  for (const entry of PRECEDENCE) {
    const raw = (entry.get(sources) || "").trim();
    if (raw && normalizeEmail(raw)) {
      chosen = { key: entry.key, raw };
      break;
    }
  }

  if (!chosen) {
    return { email: null, source: null, conflicts: [], hasEmail: false };
  }

  const chosenNorm = normalizeEmail(chosen.raw);
  const conflicts: string[] = [];
  for (const entry of PRECEDENCE) {
    if (entry.key === chosen.key) continue;
    const norm = normalizeEmail(entry.get(sources));
    if (norm && norm !== chosenNorm && !conflicts.includes(norm)) {
      conflicts.push(norm);
    }
  }

  return { email: chosen.raw, source: chosen.key, conflicts, hasEmail: true };
}

/**
 * Convenience: does any source carry a usable email? Used by the UI-facing
 * "No email on file" check so the client and server agree on the answer.
 */
export function hasAnySignerEmail(sources: SignerEmailSources): boolean {
  return resolveSignerEmail(sources).hasEmail;
}
