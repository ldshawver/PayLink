/**
 * App Doctor issue revalidation — pure decision logic.
 * server/app-doctor/revalidation-logic.ts
 *
 * PURE and dependency-free so it can be unit-tested directly. Given evidence
 * collected about an existing App Doctor report vs. the CURRENTLY deployed app,
 * decide whether the issue still reproduces.
 *
 * IMPORTANT: this module never decides AI health. An external-AI outage is
 * recorded separately (app_doctor_reports.ai_last_error*) and must never cause
 * an issue to be archived. The only inputs here are reproduction signals.
 */

export type RevalidationStatus = "reproduced" | "not_reproduced" | "inconclusive";

export type EndpointReproResult =
  | "error" // a server probe of the reported route returned 5xx
  | "ok" // a server probe returned a non-5xx response
  | "not_applicable" // route is a frontend path / not probeable server-side
  | "unknown"; // probe could not run (auth-gated, network, disabled)

export interface RevalidationEvidence {
  /** Occurrences of the SAME fingerprint recorded after the report's last review/update. */
  newerOccurrences: number;
  /** Asset hashes (e.g. "schedule-B0MWJpMM") referenced by the report's text/context. */
  referencedAssetHashes: string[];
  /** Asset hashes present in the CURRENT deployed build. */
  currentAssetHashes: string[];
  /** Result of a read-only server-side probe of the reported route, if any. */
  endpointRepro: EndpointReproResult;
  /** Count of matching lines in recent diagnostic logs (last N hours). */
  recentLogMatches: number;
  /** True when the app version/commit changed since the report was created. */
  buildChangedSinceReport: boolean;
}

export interface RevalidationDecision {
  status: RevalidationStatus;
  /** Human-readable reasons, most significant first. */
  reasons: string[];
  /** True when the issue should stay in the active window. */
  keepActive: boolean;
}

/** Normalize a free-text status value to the canonical vocabulary. */
export function normalizeRevalidationStatus(v: string | null | undefined): RevalidationStatus | null {
  const s = (v || "").trim().toLowerCase();
  if (s === "reproduced" || s === "not_reproduced" || s === "inconclusive") return s;
  return null;
}

/**
 * Extract asset-hash tokens like `schedule-B0MWJpMM` from arbitrary report text
 * (`/assets/schedule-B0MWJpMM.js`, bare `schedule-B0MWJpMM.js`, or the stem).
 * Returns distinct stems (without extension, without the `/assets/` prefix).
 */
export function extractAssetHashes(...texts: Array<string | null | undefined>): string[] {
  const joined = texts.filter(Boolean).join("\n");
  const out = new Set<string>();
  const re = /(?:\/assets\/)?([a-zA-Z0-9][a-zA-Z0-9._-]*-[A-Za-z0-9_-]{6,12})\.(?:js|css|mjs)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(joined)) !== null) {
    out.add(m[1]);
  }
  return [...out];
}

/**
 * Decide whether an issue still reproduces.
 *
 * Precedence (a single positive reproduction signal wins):
 *   1. a newer occurrence of the same fingerprint     → reproduced
 *   2. a server probe of the route returned 5xx        → reproduced
 *   3. recent diagnostic logs still match              → reproduced
 *   4. every referenced build asset hash is gone from the current build,
 *      AND no reproduction signal above                → not_reproduced
 *   5. the route probed OK, the build changed since the report, and nothing
 *      recent matches                                  → not_reproduced
 *   6. otherwise                                        → inconclusive
 */
export function decideRevalidation(ev: RevalidationEvidence): RevalidationDecision {
  const reasons: string[] = [];

  if (ev.newerOccurrences > 0) {
    reasons.push(`${ev.newerOccurrences} newer occurrence(s) of the same fingerprint since last review`);
    return { status: "reproduced", reasons, keepActive: true };
  }
  if (ev.endpointRepro === "error") {
    reasons.push("a read-only probe of the reported route returned a 5xx error");
    return { status: "reproduced", reasons, keepActive: true };
  }
  if (ev.recentLogMatches > 0) {
    reasons.push(`${ev.recentLogMatches} matching line(s) in recent diagnostic logs`);
    return { status: "reproduced", reasons, keepActive: true };
  }

  const referenced = ev.referencedAssetHashes.filter(Boolean);
  const current = new Set(ev.currentAssetHashes.filter(Boolean));
  const staleRefs = referenced.filter((h) => !current.has(h));
  const allRefsStale = referenced.length > 0 && staleRefs.length === referenced.length;

  if (allRefsStale) {
    reasons.push(
      `every build asset the issue references (${staleRefs.join(", ")}) is absent from the current build, and no reproduction signal was found`,
    );
    return { status: "not_reproduced", reasons, keepActive: false };
  }

  if (ev.endpointRepro === "ok" && ev.buildChangedSinceReport) {
    reasons.push("the reported route now responds without error and the app build changed since the report was filed");
    return { status: "not_reproduced", reasons, keepActive: false };
  }

  // Not enough to confirm resolution — keep the issue visible.
  if (referenced.length > 0 && staleRefs.length > 0) {
    reasons.push(`${staleRefs.length}/${referenced.length} referenced asset hash(es) are stale, but not all — inconclusive`);
  }
  if (ev.endpointRepro === "not_applicable") {
    reasons.push("the reported route is a frontend path and cannot be probed server-side");
  }
  if (ev.endpointRepro === "unknown") {
    reasons.push("the route probe could not run (auth-gated or disabled)");
  }
  if (reasons.length === 0) {
    reasons.push("no reproduction signal and no proof of resolution");
  }
  return { status: "inconclusive", reasons, keepActive: true };
}

/**
 * Should the refreshed issue's severity be raised? Returns the new severity or
 * null to leave it unchanged. Only ever RAISES (never lowers) on revalidation —
 * lowering severity is a human decision.
 */
export function escalatedSeverity(
  current: string | null | undefined,
  newerOccurrenceMaxSeverity: string | null | undefined,
): string | null {
  const rank: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
  const c = rank[(current || "").toLowerCase()] ?? 2;
  const n = rank[(newerOccurrenceMaxSeverity || "").toLowerCase()] ?? 0;
  if (n > c) {
    return (newerOccurrenceMaxSeverity || "").toLowerCase();
  }
  return null;
}
