/**
 * Demo Tenant Cleanup — core logic, split out from the orchestrator so it can be
 * unit-tested with injected dependencies (see tests/demo-cleanup.test.ts).
 *
 * Behaviour:
 *   - Ephemeral demo companies (POST /api/demo/provision) are removed once their
 *     trial_end has passed, with a 2-hour grace window. Canonical demo companies
 *     are protected by name.
 *   - Companies restored by an integrity repair are inert historical parents:
 *     their gate_override_reason begins with "integrity-repair". They are
 *     excluded from cleanup eligibility entirely — never deleted, archived,
 *     deactivated, relabelled, or otherwise mutated, and none of their dependent
 *     child records are touched. This keeps the NO ACTION foreign keys and the
 *     historical rows they protect intact.
 *   - Each ordinary candidate is deleted in its own statement so that one
 *     FK-blocked company cannot abort the cleanup of the others. Foreign keys
 *     are left exactly as they are — no cascade, no constraint changes.
 *   - Unexpected failures (including FK violations on non-protected companies)
 *     are surfaced as warnings.
 *   - The informational summary for skipped integrity-protected companies is
 *     sanitized (a count only, no ids / names / reasons) and throttled: emitted
 *     at most once per run, and not repeated on later runs while the protected
 *     set is unchanged.
 */

/** gate_override_reason prefix that marks a company as an inert integrity-repair parent. */
export const INTEGRITY_REPAIR_MARKER = "integrity-repair";

export interface DemoCleanupCandidate {
  id: string;
  name: string | null;
  gate_override_reason: string | null;
}

/** Mutable store for the cross-run throttle of the protected-company summary. */
export interface DemoCleanupThrottleState {
  lastProtectedSignature: string | null;
}

export interface DemoCleanupDeps {
  /**
   * Return every company that matches the base demo-expiry predicate
   * (is_demo = TRUE, trial_end past its grace window, non-canonical name).
   * Integrity-protected companies are filtered out here in code.
   */
  selectCandidates: () => Promise<DemoCleanupCandidate[]>;
  /**
   * Delete exactly one company by id, re-asserting the demo-expiry predicate in
   * SQL. Returns the number of rows removed (0 or 1). May throw on FK violation.
   */
  deleteCompany: (id: string) => Promise<number>;
  log: (message: string) => void;
  warn: (message: string) => void;
  throttle: DemoCleanupThrottleState;
}

export interface DemoCleanupResult {
  removed: number;
  protectedSkipped: number;
  failed: number;
}

/** True when the company is an inert integrity-repair parent that must never be touched. */
export function isIntegrityProtected(candidate: DemoCleanupCandidate): boolean {
  return (candidate.gate_override_reason ?? "").startsWith(INTEGRITY_REPAIR_MARKER);
}

export async function runDemoCleanup(deps: DemoCleanupDeps): Promise<DemoCleanupResult> {
  const candidates = await deps.selectCandidates();

  const protectedCandidates = candidates.filter(isIntegrityProtected);
  const ordinaryCandidates = candidates.filter((c) => !isIntegrityProtected(c));

  // Sanitized, throttled summary for the skipped integrity-protected parents:
  // a count only (no ids / names / reasons), emitted at most once per run and
  // not repeated on a later run while the protected set is unchanged. The
  // signature is tracked unconditionally so the summary re-appears if the set
  // empties and later returns.
  const protectedSignature = protectedCandidates
    .map((c) => c.id)
    .sort()
    .join(",");
  if (
    protectedCandidates.length > 0 &&
    protectedSignature !== deps.throttle.lastProtectedSignature
  ) {
    deps.log(
      `${protectedCandidates.length} integrity-protected demo company(ies) retained; ` +
        `excluded from cleanup (gate_override_reason marks them inert).`,
    );
  }
  deps.throttle.lastProtectedSignature = protectedSignature;

  let removed = 0;
  let failed = 0;

  for (const candidate of ordinaryCandidates) {
    try {
      removed += await deps.deleteCompany(candidate.id);
    } catch (e: unknown) {
      failed += 1;
      const msg = e instanceof Error ? e.message : String(e);
      deps.warn(`Failed to remove expired demo company ${candidate.id}: ${msg}`);
    }
  }

  if (removed > 0) {
    deps.log(`Removed ${removed} expired demo tenant(s).`);
  }

  return { removed, protectedSkipped: protectedCandidates.length, failed };
}
