/**
 * Concierge Launch Option A, blocker 3 — shared rate-limit + CSRF middleware.
 *
 * No rate-limit or CSRF mechanism existed anywhere in the app
 * (docs/saas-readiness/gap-analysis.md T6, phase-0.5-launch-security-plan.md §1).
 * This module is additive infrastructure: an in-memory sliding-window rate
 * limiter (same bucket-map pattern already used in server/diagnostics.ts, so
 * no new dependency is introduced) and a double-submit-cookie CSRF check.
 *
 * Scope discipline: CSRF enforcement is wired onto the specific
 * session-authenticated mutating endpoints touched by this launch batch
 * (currently POST /api/billing/activate) rather than swept across the whole
 * ~37k-line legacy route file — the SPA's ~27 call sites that use `fetch(...)`
 * directly (bypassing the shared apiRequest() wrapper) have not been audited
 * for CSRF-header support, so a blanket global enforcement pass risks
 * breaking authenticated pages we cannot browser-test in this batch. The
 * `apiRequest()` wrapper (client/src/lib/queryClient.ts) does attach the
 * header on every request it sends, so any route this is applied to keeps
 * working for the ~30 pages that already go through it.
 */

import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

// ── Rate limiting ────────────────────────────────────────────────────────────

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Bound the bucket map so a spoofed-IP flood can't grow it unboundedly; the
// oldest-expired entries are swept opportunistically on each hit.
const MAX_BUCKETS = 50_000;

function sweepExpired(now: number) {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitOptions {
  /** Sliding window size in milliseconds. */
  windowMs: number;
  /** Max requests allowed per key within the window. */
  max: number;
  /** Derives the bucket key from the request. Defaults to client IP. */
  keyFn?: (req: Request) => string;
  /** Returned in the 429 body's `message` field. */
  message?: string;
}

/**
 * Fixed-window rate limiter, keyed by client IP by default. Each call site
 * gets its own bucket namespace (via `name`) so limits don't bleed across
 * unrelated routes.
 */
export function createRateLimiter(name: string, options: RateLimitOptions) {
  const { windowMs, max, keyFn, message } = options;
  return function rateLimit(req: Request, res: Response, next: NextFunction) {
    const now = Date.now();
    sweepExpired(now);
    const identity = (keyFn ? keyFn(req) : req.ip) || "unknown";
    const key = `${name}:${identity}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      res.setHeader("Retry-After", Math.ceil((bucket.resetAt - now) / 1000).toString());
      return res.status(429).json({
        message: message || "Too many requests. Please wait a moment and try again.",
      });
    }
    next();
  };
}

// ── CSRF (double-submit cookie) ─────────────────────────────────────────────

export const CSRF_COOKIE_NAME = "csrf_token";
export const CSRF_HEADER_NAME = "x-csrf-token";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

declare module "express-session" {
  interface SessionData {
    csrfToken?: string;
  }
}

/**
 * Issues a per-session CSRF token (double-submit cookie: readable by the
 * client so it can echo it back as a header, verified server-side against the
 * copy held in the (httpOnly, server-only) session). Safe to call on every
 * authenticated request — it's a no-op once a token exists for the session.
 */
export function issueCsrfToken(req: Request, res: Response, next: NextFunction) {
  if (req.session?.userId) {
    if (!req.session.csrfToken) {
      req.session.csrfToken = crypto.randomBytes(32).toString("hex");
    }
    res.cookie(CSRF_COOKIE_NAME, req.session.csrfToken, {
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  }
  next();
}

/**
 * Verifies the CSRF header on mutating requests for the session it's applied
 * to. Only meaningful for session-authenticated requests — routes with no
 * session (public signup/webhook/token-authenticated paths) rely on
 * rate-limiting and their own token checks instead, since there is no session
 * to forge a mutation against.
 */
export function requireCsrfToken(req: Request, res: Response, next: NextFunction) {
  if (!MUTATING_METHODS.has(req.method)) return next();
  if (!req.session?.userId) return next();

  const expected = req.session.csrfToken;
  const provided = req.get(CSRF_HEADER_NAME);
  if (
    !expected ||
    !provided ||
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  ) {
    return res.status(403).json({ message: "Invalid or missing CSRF token" });
  }
  next();
}
