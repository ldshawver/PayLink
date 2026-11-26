/**
 * Session hardening: production secret resolution, rolling idle timeout,
 * failed-login lockout, and the optional single-active-session switch.
 *
 * Pure helpers live here so tests can exercise them without booting Express
 * or touching a database. Routes and server/index.ts call into this module.
 */
import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";

export const DEV_SESSION_SECRET = "paylink-dev-secret";
export const DEFAULT_SESSION_IDLE_MINUTES = 30;
/** Idle window must stay inside (0, 24h]. Unparseable values fall back to the default. */
const MAX_IDLE_MINUTES = 24 * 60;

const ACCOUNT_FAILURE_THRESHOLD = 5;
const IP_FAILURE_THRESHOLD = 20;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const BASE_LOCK_MS = 15 * 60 * 1000;
const MAX_LOCK_MS = 24 * 60 * 60 * 1000;
const MAX_LOCKOUT_KEYS = 20_000;

export class ProductionSessionSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionSessionSecretError";
  }
}

/**
 * Production must not boot on a missing, blank, or well-known development
 * secret. Development and tests keep the historical fallback so local boot
 * does not require extra configuration.
 */
export function resolveSessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = (env.SESSION_SECRET ?? "").trim();
  const production = env.NODE_ENV === "production";
  if (production && (!secret || secret === DEV_SESSION_SECRET)) {
    throw new ProductionSessionSecretError(
      "FATAL: Refusing to start in production without SESSION_SECRET set to a value other than the development fallback. " +
        "Set SESSION_SECRET to a long random string before starting the server.",
    );
  }
  return secret || DEV_SESSION_SECRET;
}

export function resolveSessionIdleMinutes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.SESSION_IDLE_MINUTES ?? "").trim();
  if (!raw) return DEFAULT_SESSION_IDLE_MINUTES;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > MAX_IDLE_MINUTES) {
    return DEFAULT_SESSION_IDLE_MINUTES;
  }
  return n;
}

export function sessionIdleMs(env: NodeJS.ProcessEnv = process.env): number {
  return resolveSessionIdleMinutes(env) * 60 * 1000;
}

/** Default off. Set SINGLE_SESSION_PER_USER=true to keep only the newest login. */
export function singleSessionPerUserEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.SINGLE_SESSION_PER_USER ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function idleExpired(lastActivityAt: unknown, now: number, idleMs: number): boolean {
  if (typeof lastActivityAt !== "number" || !Number.isFinite(lastActivityAt)) return false;
  return now - lastActivityAt > idleMs;
}

export function clearSessionCookie(res: Response): void {
  const isProduction = process.env.NODE_ENV === "production";
  res.clearCookie("connect.sid", {
    path: "/",
    domain: isProduction ? ".mypaylink.app" : undefined,
    sameSite: "lax",
    secure: isProduction,
  });
}

export function clientIp(req: Pick<Request, "ip" | "socket">): string {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  return String(ip).slice(0, 64);
}

export function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!req.session || typeof req.session.regenerate !== "function") {
      reject(new Error("Session store cannot rotate the session id"));
      return;
    }
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

export function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

export interface GrantedSessionFields {
  userId: string;
  username: string;
  mfaEnrollmentRequired?: boolean;
}

/**
 * Rotate the session id, then attach the authenticated identity. Call this
 * only after the credential check succeeds so a pre-login cookie cannot be
 * fixed to the account (session fixation).
 */
export async function grantAuthenticatedSession(
  req: Request,
  fields: GrantedSessionFields,
  bindActiveSession?: (userId: string, sessionId: string) => Promise<void>,
): Promise<void> {
  await regenerateSession(req);
  req.session.userId = fields.userId;
  req.session.username = fields.username;
  if (fields.mfaEnrollmentRequired) req.session.mfaEnrollmentRequired = true;
  req.session.lastActivityAt = Date.now();
  if (bindActiveSession) await bindActiveSession(fields.userId, req.sessionID);
  await saveSession(req);
}

/** Rotate before storing the pending MFA challenge, which is still a credential. */
export async function grantPendingMfaSession(req: Request, userId: string): Promise<void> {
  await regenerateSession(req);
  req.session.pendingMfaUserId = userId;
  req.session.lastActivityAt = Date.now();
  await saveSession(req);
}

export interface SessionControlOptions {
  idleMs: number;
  singleSession: boolean;
  now?: number;
  loadActiveSessionId?: (userId: string) => Promise<string | null>;
}

/**
 * Rolling idle timeout for every role, plus the optional single-session check.
 * A session with no lastActivityAt (issued before this shipped) starts its
 * clock on the next request instead of being signed out immediately.
 */
export async function enforceSessionControls(
  req: Request,
  res: Response,
  next: NextFunction,
  options: SessionControlOptions,
): Promise<void> {
  const sess = req.session;
  if (!sess) return next();
  const tracked = !!(sess.userId || sess.pendingMfaUserId);
  const now = options.now ?? Date.now();
  if (tracked && idleExpired(sess.lastActivityAt, now, options.idleMs)) {
    sess.destroy(() => {
      clearSessionCookie(res);
      if (!res.headersSent) {
        res.status(401).json({
          message: "Signed out after a period of inactivity.",
          reason: "idle_timeout",
        });
      }
    });
    return;
  }
  if (tracked) sess.lastActivityAt = now;

  if (options.singleSession && sess.userId && options.loadActiveSessionId) {
    let active: string | null = null;
    try {
      active = await options.loadActiveSessionId(sess.userId);
    } catch {
      console.error("[session] single-session lookup failed");
      sess.destroy(() => {
        clearSessionCookie(res);
        if (!res.headersSent) {
          res.status(401).json({
            message: "Session could not be verified. Please sign in again.",
            reason: "session_check_failed",
          });
        }
      });
      return;
    }
    if (active && active !== req.sessionID) {
      sess.destroy(() => {
        clearSessionCookie(res);
        if (!res.headersSent) {
          res.status(401).json({
            message: "Your account was signed in on another device.",
            reason: "session_superseded",
          });
        }
      });
      return;
    }
  }
  next();
}

// ── Failed-login lockout ────────────────────────────────────────────────────

interface LockoutRecord {
  failures: number;
  windowStart: number;
  lockedUntil: number;
  lockLevel: number;
}

export interface LockoutDecision {
  locked: boolean;
  retryAfterSeconds: number;
  scope: "account" | "ip" | null;
}

export interface LoginLockout {
  normalizeAccount(account: string): string;
  inspect(account: string, ip: string): LockoutDecision;
  recordFailure(account: string, ip: string): void;
  recordSuccess(account: string): void;
  size(): number;
}

function lockDurationMs(level: number): number {
  const shift = Math.min(Math.max(level, 1) - 1, 6);
  return Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** shift);
}

/**
 * Per-account and per-IP failed-login backoff. In-memory and per-process,
 * same durability as the existing login rate limiter: a restart clears it.
 * Five failures in 15 minutes lock the account for 15 minutes; further
 * failures double that up to 24 hours. Twenty failures lock the IP the same way.
 */
export function createLoginLockout(now: () => number = Date.now): LoginLockout {
  const accounts = new Map<string, LockoutRecord>();
  const ips = new Map<string, LockoutRecord>();

  function sweep(map: Map<string, LockoutRecord>, t: number) {
    if (map.size < MAX_LOCKOUT_KEYS) return;
    for (const [key, rec] of map) {
      if (rec.lockedUntil <= t && t - rec.windowStart > FAILURE_WINDOW_MS) map.delete(key);
    }
  }

  function retryAfter(rec: LockoutRecord | undefined, t: number): number {
    if (!rec || rec.lockedUntil <= t) return 0;
    return Math.max(1, Math.ceil((rec.lockedUntil - t) / 1000));
  }

  function bump(map: Map<string, LockoutRecord>, key: string, threshold: number, t: number) {
    sweep(map, t);
    let rec = map.get(key);
    if (!rec) rec = { failures: 0, windowStart: t, lockedUntil: 0, lockLevel: 0 };
    if (rec.lockedUntil > t) {
      rec.lockLevel += 1;
      rec.lockedUntil = t + lockDurationMs(rec.lockLevel);
      map.set(key, rec);
      return;
    }
    if (t - rec.windowStart > FAILURE_WINDOW_MS) {
      rec.failures = 0;
      rec.windowStart = t;
    }
    rec.failures += 1;
    if (rec.failures >= threshold) {
      rec.lockLevel += 1;
      rec.lockedUntil = t + lockDurationMs(rec.lockLevel);
      rec.failures = 0;
      rec.windowStart = t;
    }
    map.set(key, rec);
  }

  return {
    normalizeAccount(account: string) {
      return String(account ?? "").trim().toLowerCase().slice(0, 200);
    },
    inspect(account: string, ip: string): LockoutDecision {
      const t = now();
      const accountWait = retryAfter(accounts.get(this.normalizeAccount(account)), t);
      if (accountWait > 0) return { locked: true, retryAfterSeconds: accountWait, scope: "account" };
      const ipWait = retryAfter(ips.get(ip || "unknown"), t);
      if (ipWait > 0) return { locked: true, retryAfterSeconds: ipWait, scope: "ip" };
      return { locked: false, retryAfterSeconds: 0, scope: null };
    },
    recordFailure(account: string, ip: string) {
      const t = now();
      bump(accounts, this.normalizeAccount(account), ACCOUNT_FAILURE_THRESHOLD, t);
      bump(ips, ip || "unknown", IP_FAILURE_THRESHOLD, t);
    },
    recordSuccess(account: string) {
      accounts.delete(this.normalizeAccount(account));
    },
    size() {
      return accounts.size + ips.size;
    },
  };
}

export const loginLockout = createLoginLockout();

let dummyPasswordHash: string | null = null;

/**
 * Always runs a bcrypt compare, including when the account does not exist,
 * so a missing user is not obviously faster than a wrong password.
 * Returns false when there is no real hash.
 */
export async function passwordsMatch(password: string, storedHash: string | null | undefined): Promise<boolean> {
  if (!dummyPasswordHash) {
    dummyPasswordHash = await bcrypt.hash("paylink-login-timing-padding", 10);
  }
  const ok = await bcrypt.compare(password, storedHash || dummyPasswordHash);
  return !!storedHash && ok;
}
