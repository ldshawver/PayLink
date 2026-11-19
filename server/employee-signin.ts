/**
 * Company-scoped employee / time-clock sign-in, per-company employee numbers,
 * and hashed PINs (migration 0031).
 *
 * Sign-in = company sign-in code + employee number + PIN.
 *   - The code is tenant ROUTING, not a credential: it only selects which
 *     company's employee numbers are searched. It is random, non-sequential and
 *     unrelated to any id. Admins can view and regenerate it.
 *   - The company can come from (in priority order) a valid kiosk binding
 *     cookie (admin-bound, cannot be overridden from the device), a code typed
 *     at sign-in, or a "remembered company" cookie. A browser-supplied
 *     company_id is NEVER accepted.
 *   - Every failure (unknown code, unknown number, wrong PIN, inactive,
 *     disabled) returns the same generic 401 body, after a bcrypt compare
 *     against a dummy hash when there is nothing to compare, so the response
 *     does not reveal which part was wrong.
 *   - Failed attempts are audited (employee_signin_events) without PINs or
 *     codes, and a per-(company, employee number) lockout applies on top of the
 *     per-IP rate limit.
 *
 * Until migration 0031 is recorded in paylink_migrations.applied the legacy
 * behaviour (global number lookup) stays in place — that is the backward-
 * compatibility path for deploying code before the migration. PIN hashing and
 * the response scrubbing work either way (pin_hash is added by boot DDL).
 */
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { db } from "./db";

type Exec = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

function rows<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  const rr = (r as { rows?: unknown[] })?.rows;
  return Array.isArray(rr) ? (rr as T[]) : [];
}
const first = <T>(r: unknown): T | undefined => rows<T>(r)[0];

// ── Schema readiness ───────────────────────────────────────────────────────
let readyCache: { value: boolean; at: number } | null = null;
let readyInflight: Promise<boolean> | null = null;
/** True once migration 0031 is recorded. Positive results are cached; negative ones for 5 s only. */
export async function companySigninReady(): Promise<boolean> {
  const now = Date.now();
  if (readyCache && (readyCache.value || now - readyCache.at < 5_000)) return readyCache.value;
  if (readyInflight) return readyInflight;
  readyInflight = (async () => {
    try {
      const r = first<{ ok: boolean }>(await db.execute(sql`
        SELECT (to_regclass('paylink_migrations.applied') IS NOT NULL
                AND EXISTS (SELECT 1 FROM paylink_migrations.applied WHERE version = '0031')) AS ok`));
      return !!r?.ok;
    } catch {
      return false;
    }
  })().then((v) => { readyCache = { value: v, at: Date.now() }; readyInflight = null; return v; });
  return readyInflight;
}
/** Test hook. */
export function resetSigninReadinessCache() { readyCache = null; }

// ── Codes ──────────────────────────────────────────────────────────────────
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function normalizeSigninCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const n = raw.toUpperCase().replace(/[\s-]/g, "");
  return /^[A-HJ-NP-Z2-9]{8}$/.test(n) ? n : null;
}
export function formatSigninCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
export function generateSigninCode(): string {
  let out = "";
  while (out.length < 8) {
    const b = crypto.randomBytes(1)[0];
    if (b < 248) out += CODE_ALPHABET[b % 31]; // rejection sampling: no modulo bias
  }
  return out;
}

export interface CompanySigninCode { companyId: string; code: string; codeVersion: number; rotatedAt: string | null }

async function insertNewCode(exec: Exec, companyId: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const code = generateSigninCode();
    const r = rows(await exec.execute(sql`
      INSERT INTO company_signin_codes (company_id, code) VALUES (${companyId}, ${code})
      ON CONFLICT DO NOTHING RETURNING company_id`));
    if (r.length) return;
    const exists = first(await exec.execute(sql`SELECT 1 FROM company_signin_codes WHERE company_id = ${companyId}`));
    if (exists) return; // someone else created it concurrently
  }
  throw new Error("Could not generate a unique sign-in code");
}

/** The company's code, creating one if the company has none yet (companies created after 0031). */
export async function getOrCreateSigninCode(companyId: string): Promise<CompanySigninCode> {
  let r = first<any>(await db.execute(sql`SELECT * FROM company_signin_codes WHERE company_id = ${companyId}`));
  if (!r) {
    await insertNewCode(db, companyId);
    r = first<any>(await db.execute(sql`SELECT * FROM company_signin_codes WHERE company_id = ${companyId}`));
  }
  return { companyId, code: r.code, codeVersion: r.code_version, rotatedAt: r.rotated_at ?? null };
}

export interface RotateOptions { revokeKiosks?: boolean; endEmployeeSessions?: boolean }
/**
 * New code + bumped version. The version bump invalidates every "remembered
 * company" cookie for this company. Kiosk bindings and active employee
 * sessions are left alone unless explicitly requested.
 */
export async function rotateSigninCode(companyId: string, actorUserId: string, opts: RotateOptions) {
  return db.transaction(async (tx) => {
    const existing = first<any>(await tx.execute(sql`SELECT * FROM company_signin_codes WHERE company_id = ${companyId} FOR UPDATE`));
    if (!existing) await insertNewCode(tx, companyId);
    let code = "";
    for (let i = 0; i < 20; i++) {
      code = generateSigninCode();
      const clash = first(await tx.execute(sql`SELECT 1 FROM company_signin_codes WHERE code = ${code}`));
      if (!clash) break;
    }
    const updated = first<any>(await tx.execute(sql`
      UPDATE company_signin_codes
         SET code = ${code}, code_version = code_version + 1, rotated_at = now(), rotated_by_user_id = ${actorUserId}
       WHERE company_id = ${companyId}
       RETURNING *`));
    let kiosksRevoked = 0;
    if (opts.revokeKiosks) {
      kiosksRevoked = rows(await tx.execute(sql`
        UPDATE time_clock_kiosk_bindings SET revoked_at = now(), revoked_by_user_id = ${actorUserId}
         WHERE company_id = ${companyId} AND revoked_at IS NULL RETURNING id`)).length;
    }
    let sessionsEnded = 0;
    if (opts.endEmployeeSessions) {
      // Only PIN-capable worker accounts (employees/contractors) of THIS company — never admins.
      sessionsEnded = rows(await tx.execute(sql`
        DELETE FROM session
         WHERE sess->>'userId' IN (
           SELECT u.id FROM users u JOIN workers w ON w.id = u.worker_id
            WHERE w.company_id = ${companyId} AND u.role IN ('employee','contractor'))
        RETURNING sid`)).length;
    }
    return { code: updated.code as string, codeVersion: updated.code_version as number, kiosksRevoked, sessionsEnded };
  });
}

// ── Remembered company (signed, HttpOnly cookie) ───────────────────────────
export const REMEMBER_COOKIE = "pl_signin_company";
export const KIOSK_COOKIE = "pl_time_clock_kiosk";
const REMEMBER_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;

function rememberKey(): Buffer {
  const secret = process.env.SESSION_SECRET || process.env.APP_SECRET || "paylink-dev-secret";
  return crypto.createHmac("sha256", secret).update("paylink:company-signin-remember:v1").digest();
}
export function signRememberToken(companyId: string, codeVersion: number): string {
  const payload = Buffer.from(JSON.stringify({ c: companyId, v: codeVersion })).toString("base64url");
  const mac = crypto.createHmac("sha256", rememberKey()).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}
export function verifyRememberToken(token: string | undefined | null): { companyId: string; codeVersion: number } | null {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [payload, mac] = token.split(".", 2);
  const expected = crypto.createHmac("sha256", rememberKey()).update(payload).digest();
  let given: Buffer;
  try { given = Buffer.from(mac, "base64url"); } catch { return null; }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof p?.c !== "string" || !Number.isInteger(p?.v)) return null;
    return { companyId: p.c, codeVersion: p.v };
  } catch { return null; }
}

function cookieOptions(maxAge: number) {
  const isProduction = process.env.NODE_ENV === "production";
  return { httpOnly: true, secure: isProduction, sameSite: "lax" as const, path: "/", maxAge };
}
function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}
export function setRememberCookie(res: Response, companyId: string, codeVersion: number) {
  res.cookie(REMEMBER_COOKIE, signRememberToken(companyId, codeVersion), cookieOptions(REMEMBER_MAX_AGE_MS));
}
export function clearRememberCookie(res: Response) {
  res.clearCookie(REMEMBER_COOKIE, { ...cookieOptions(0), maxAge: undefined });
}

// ── Kiosk bindings ─────────────────────────────────────────────────────────
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export async function createKioskBinding(companyId: string, label: string, actorUserId: string) {
  const token = crypto.randomBytes(32).toString("base64url");
  const r = first<any>(await db.execute(sql`
    INSERT INTO time_clock_kiosk_bindings (company_id, label, token_hash, created_by_user_id)
    VALUES (${companyId}, ${label}, ${sha256(token)}, ${actorUserId})
    RETURNING id, company_id, label, created_at`));
  return { token, binding: r };
}
export function setKioskCookie(res: Response, token: string) {
  res.cookie(KIOSK_COOKIE, token, cookieOptions(REMEMBER_MAX_AGE_MS));
}
export function clearKioskCookie(res: Response) {
  res.clearCookie(KIOSK_COOKIE, { ...cookieOptions(0), maxAge: undefined });
}
export async function listKioskBindings(companyId: string) {
  return rows<any>(await db.execute(sql`
    SELECT id, label, created_at, created_by_user_id, last_seen_at, revoked_at
      FROM time_clock_kiosk_bindings WHERE company_id = ${companyId}
     ORDER BY revoked_at NULLS FIRST, created_at DESC LIMIT 200`));
}
export async function revokeKioskBinding(companyId: string, bindingId: string, actorUserId: string) {
  return rows(await db.execute(sql`
    UPDATE time_clock_kiosk_bindings SET revoked_at = now(), revoked_by_user_id = ${actorUserId}
     WHERE id = ${bindingId} AND company_id = ${companyId} AND revoked_at IS NULL RETURNING id`)).length > 0;
}
async function resolveKiosk(req: Request): Promise<{ companyId: string; bindingId: string; label: string } | null> {
  const token = readCookie(req, KIOSK_COOKIE);
  if (!token || token.length > 200) return null;
  const r = first<any>(await db.execute(sql`
    UPDATE time_clock_kiosk_bindings SET last_seen_at = now()
     WHERE token_hash = ${sha256(token)} AND revoked_at IS NULL
     RETURNING id, company_id, label`));
  return r ? { companyId: r.company_id, bindingId: r.id, label: r.label } : null;
}

// ── Company context for a sign-in request ──────────────────────────────────
export type CompanySource = "kiosk" | "code" | "remembered";
export interface SigninCompany { companyId: string; codeVersion: number; source: CompanySource; kioskBindingId?: string }

/**
 * Kiosk binding wins and cannot be overridden from the device. Otherwise a
 * typed code, otherwise a remembered-company cookie whose version still
 * matches (a rotated code invalidates it). Never reads a company id from the
 * request body/query.
 */
export async function resolveSigninCompany(req: Request, typedCode: unknown): Promise<SigninCompany | null> {
  const kiosk = await resolveKiosk(req);
  if (kiosk) {
    const c = first<any>(await db.execute(sql`SELECT code_version FROM company_signin_codes WHERE company_id = ${kiosk.companyId}`));
    return c ? { companyId: kiosk.companyId, codeVersion: c.code_version, source: "kiosk", kioskBindingId: kiosk.bindingId } : null;
  }
  const normalized = normalizeSigninCode(typedCode);
  if (normalized) {
    const c = first<any>(await db.execute(sql`SELECT company_id, code_version FROM company_signin_codes WHERE code = ${normalized}`));
    return c ? { companyId: c.company_id, codeVersion: c.code_version, source: "code" } : null;
  }
  if (typedCode !== undefined && typedCode !== null && typedCode !== "") return null; // malformed code typed: no fallback
  const remembered = verifyRememberToken(readCookie(req, REMEMBER_COOKIE));
  if (remembered) {
    const c = first<any>(await db.execute(sql`SELECT code_version FROM company_signin_codes WHERE company_id = ${remembered.companyId}`));
    if (c && c.code_version === remembered.codeVersion) return { companyId: remembered.companyId, codeVersion: c.code_version, source: "remembered" };
  }
  return null;
}

/** What the sign-in screen may show: never the code itself. */
export async function describeSigninContext(req: Request) {
  if (!(await companySigninReady())) return { companyScoped: false, kiosk: false, remembered: false, companyName: null as string | null };
  const kiosk = await resolveKiosk(req);
  if (kiosk) {
    const c = first<any>(await db.execute(sql`SELECT name FROM companies WHERE id = ${kiosk.companyId}`));
    return { companyScoped: true, kiosk: true, kioskLabel: kiosk.label, remembered: true, companyName: c?.name ?? null };
  }
  const remembered = verifyRememberToken(readCookie(req, REMEMBER_COOKIE));
  if (remembered) {
    const c = first<any>(await db.execute(sql`
      SELECT co.name FROM company_signin_codes s JOIN companies co ON co.id = s.company_id
       WHERE s.company_id = ${remembered.companyId} AND s.code_version = ${remembered.codeVersion}`));
    if (c) return { companyScoped: true, kiosk: false, remembered: true, companyName: c.name as string };
  }
  return { companyScoped: true, kiosk: false, remembered: false, companyName: null };
}

// ── PINs ───────────────────────────────────────────────────────────────────
const DUMMY_HASH = bcrypt.hashSync("paylink-dummy-pin-never-valid", 10);
export const PIN_FORMAT = /^\d{4,8}$/;

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

/**
 * Verify a PIN against a worker row (snake_case or camelCase). Prefers the
 * bcrypt hash; a worker that only has a legacy plaintext PIN is verified in
 * constant time and upgraded (hash written, plaintext cleared) on success.
 */
export async function verifyWorkerPin(worker: any, pin: string): Promise<boolean> {
  const hash: string | null = worker?.pin_hash ?? worker?.pinHash ?? null;
  if (hash) return bcrypt.compare(pin, hash);
  const legacy: string | null = worker?.pin ?? null;
  if (!legacy) { await bcrypt.compare(pin, DUMMY_HASH); return false; }
  const a = Buffer.from(sha256(`pin:${pin}`)), b = Buffer.from(sha256(`pin:${legacy}`));
  const ok = crypto.timingSafeEqual(a, b);
  await bcrypt.compare(pin, DUMMY_HASH); // keep timing comparable to the hashed path
  if (ok && worker?.id) {
    const h = await hashPin(pin);
    await db.execute(sql`UPDATE workers SET pin_hash = ${h}, pin = NULL WHERE id = ${worker.id} AND pin_hash IS NULL`).catch(() => {});
  }
  return ok;
}
export async function burnDummyCompare(pin: string) { await bcrypt.compare(pin, DUMMY_HASH); }

/**
 * Normalize PIN fields on any worker write: a supplied non-empty `pin` becomes
 * a bcrypt `pinHash` (plaintext column set NULL); a client-supplied `pinHash`
 * is always discarded. `pin` missing or "" = no change (forms send the whole
 * record); explicit `pin: null` = remove the PIN.
 */
export async function preparePinFields<T extends Record<string, any>>(data: T): Promise<T> {
  const out: Record<string, any> = { ...data };
  delete out.pinHash; delete out.pin_hash; delete out.hasPin;
  if (Object.prototype.hasOwnProperty.call(out, "pin")) {
    const raw = out.pin;
    if (raw === null) { out.pin = null; out.pinHash = null; }
    else if (raw === undefined || String(raw).trim() === "") delete out.pin;
    else {
      out.pinHash = await hashPin(String(raw).trim());
      out.pin = null;
    }
  }
  return out as T;
}

// ── Audit + lockout ────────────────────────────────────────────────────────
export type SigninChannel = "pin_login" | "time_clock_auth" | "time_clock_sign_in" | "time_clock_punch" | "time_clock_session" | "time_clock_break" | "time_clock_punches";
const LOCK_WINDOW_MIN = 15;
export const LOCK_THRESHOLD = 10;

function ipHash(req: Request): string {
  const ip = String(req.ip || req.socket?.remoteAddress || "");
  return crypto.createHmac("sha256", rememberKey()).update(`ip:${ip}`).digest("hex").slice(0, 32);
}
export async function recordSigninEvent(req: Request, e: {
  companyId: string | null; workerId?: string | null; channel: SigninChannel;
  outcome: "success" | "failure" | "locked" | "rate_limited"; reason?: string; employeeNumber?: string | null;
}) {
  try {
    await db.execute(sql`
      INSERT INTO employee_signin_events (company_id, worker_id, channel, outcome, reason, employee_number, ip_hash, user_agent)
      VALUES (${e.companyId}, ${e.workerId ?? null}, ${e.channel}, ${e.outcome}, ${e.reason ?? null},
              ${e.employeeNumber ? String(e.employeeNumber).slice(0, 32) : null}, ${ipHash(req)},
              ${String(req.headers["user-agent"] || "").slice(0, 200)})`);
  } catch (err) {
    console.warn("[signin] audit write failed:", (err as Error)?.message);
  }
}
async function isLocked(companyId: string, employeeNumber: string): Promise<boolean> {
  const r = first<{ n: number }>(await db.execute(sql`
    SELECT count(*)::int AS n FROM employee_signin_events
     WHERE company_id = ${companyId} AND employee_number = ${employeeNumber}
       AND outcome = 'failure' AND created_at > now() - make_interval(mins => ${LOCK_WINDOW_MIN})`));
  return (r?.n ?? 0) >= LOCK_THRESHOLD;
}

export const GENERIC_SIGNIN_FAILURE = "Invalid company code, employee number, or PIN.";
export const LOCKED_MESSAGE = "Too many sign-in attempts. Please wait 15 minutes and try again.";

export type ResolvedWorker = { worker: any; company: SigninCompany | null; legacy: boolean };
export type PinAuthResult = ({ ok: true } & ResolvedWorker) | { ok: false; status: 400 | 401 | 429; message: string };

/**
 * The single verification path for every PIN-based route. Never writes the
 * response; see authenticateWorkerByPin for the sending wrapper.
 */
export async function verifyWorkerSignin(
  req: Request,
  input: { companyCode?: unknown; employeeNumber?: unknown; pin?: unknown; channel: SigninChannel },
): Promise<PinAuthResult> {
  const employeeNumber = typeof input.employeeNumber === "string" ? input.employeeNumber.trim() : "";
  const pin = typeof input.pin === "string" ? input.pin.trim() : (typeof input.pin === "number" ? String(input.pin) : "");
  if (!employeeNumber || !pin || employeeNumber.length > 32 || pin.length > 32) {
    return { ok: false, status: 400, message: "Company code, employee number and PIN are required" };
  }
  const fail = { ok: false as const, status: 401 as const, message: GENERIC_SIGNIN_FAILURE };

  if (!(await companySigninReady())) {
    // Legacy (pre-0031) behaviour, kept only as the deploy-before-migration path.
    const candidates = rows<any>(await db.execute(sql`
      SELECT * FROM workers WHERE employee_number = ${employeeNumber} LIMIT 25`));
    for (const w of candidates) {
      if (w.is_active !== false && await verifyWorkerPin(w, pin)) return { ok: true, worker: toCamel(w), company: null, legacy: true };
    }
    if (!candidates.length) await burnDummyCompare(pin);
    return fail;
  }

  const company = await resolveSigninCompany(req, input.companyCode);
  if (!company) {
    await burnDummyCompare(pin);
    await recordSigninEvent(req, { companyId: null, channel: input.channel, outcome: "failure", reason: "company_unresolved", employeeNumber });
    return fail;
  }
  if (await isLocked(company.companyId, employeeNumber)) {
    await burnDummyCompare(pin);
    await recordSigninEvent(req, { companyId: company.companyId, channel: input.channel, outcome: "locked", employeeNumber });
    return { ok: false, status: 429, message: LOCKED_MESSAGE };
  }
  const w = first<any>(await db.execute(sql`
    SELECT * FROM workers WHERE company_id = ${company.companyId} AND employee_number = ${employeeNumber} LIMIT 1`));
  const ok = w ? await verifyWorkerPin(w, pin) : (await burnDummyCompare(pin), false);
  const active = !!w && w.is_active !== false;
  if (!ok || !active) {
    await recordSigninEvent(req, {
      companyId: company.companyId, workerId: w?.id ?? null, channel: input.channel, outcome: "failure",
      reason: !w ? "unknown_number" : !ok ? "bad_pin" : "inactive", employeeNumber,
    });
    return fail;
  }
  await recordSigninEvent(req, { companyId: company.companyId, workerId: w.id, channel: input.channel, outcome: "success", employeeNumber });
  return { ok: true, worker: toCamel(w), company, legacy: false };
}

/** Remember the company on this device when the code was typed (kiosks keep their binding). */
export function applySigninSuccess(res: Response, r: ResolvedWorker) {
  if (r.company?.source === "code") setRememberCookie(res, r.company.companyId, r.company.codeVersion);
}

/** Verify and, on failure, send the generic response. Returns null when a response was sent. */
export async function authenticateWorkerByPin(
  req: Request, res: Response,
  input: { companyCode?: unknown; employeeNumber?: unknown; pin?: unknown; channel: SigninChannel },
): Promise<ResolvedWorker | null> {
  const r = await verifyWorkerSignin(req, input);
  if (!r.ok) { res.status(r.status).json({ message: r.message }); return null; }
  applySigninSuccess(res, r);
  return r;
}

function toCamel(row: any): any {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) out[k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())] = v;
  return out;
}

/** Username for a PIN-created account: unique across companies, reveals no ids. */
export function pinAccountUsername(employeeNumber: string): string {
  return `emp${employeeNumber}-${crypto.randomBytes(4).toString("hex")}`;
}

// ── Employee numbers ───────────────────────────────────────────────────────
export class EmployeeNumberExhaustedError extends Error {
  status = 409;
  constructor(yy: string) {
    super(`All employee numbers for 20${yy} are in use (${yy}01–${yy}99) for this company. Enter an employee number manually or contact support.`);
  }
}

/**
 * Allocate the next YYNN employee number for a company INSIDE the caller's
 * transaction (the worker insert must use the same `tx`). The counter row is
 * locked (SELECT … FOR UPDATE), and the value never goes below the company's
 * highest existing YYNN for that year. Numbers already taken (e.g. entered
 * manually) are skipped. Exhaustion (YY99) raises — the format is never
 * silently changed and numbers are never reused.
 */
export async function allocateEmployeeNumber(tx: Exec, companyId: string, now: Date = new Date()): Promise<string> {
  const yy = String(now.getUTCFullYear() % 100).padStart(2, "0");
  const pattern = `^${yy}\\d{2}$`;
  const hasCounters = first<{ ok: boolean }>(await tx.execute(sql`SELECT to_regclass('public.employee_number_counters') IS NOT NULL AS ok`))?.ok;
  if (!hasCounters) {
    // Pre-0031: serialize per company with a transaction-scoped advisory lock.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"employee-number:" + companyId}))`);
  } else {
    await tx.execute(sql`
      INSERT INTO employee_number_counters (company_id, year_prefix, last_value)
      VALUES (${companyId}, ${yy}, 0) ON CONFLICT (company_id, year_prefix) DO NOTHING`);
  }
  const counter = hasCounters
    ? first<{ last_value: number }>(await tx.execute(sql`
        SELECT last_value FROM employee_number_counters WHERE company_id = ${companyId} AND year_prefix = ${yy} FOR UPDATE`))
    : { last_value: 0 };
  const maxExisting = first<{ m: number | null }>(await tx.execute(sql`
    SELECT max(substr(employee_number, 3, 2)::int) AS m FROM workers
     WHERE company_id = ${companyId} AND employee_number ~ ${pattern}`))?.m ?? 0;
  let next = Math.max(counter?.last_value ?? 0, maxExisting ?? 0) + 1;
  while (next <= 99) {
    const candidate = `${yy}${String(next).padStart(2, "0")}`;
    const taken = first(await tx.execute(sql`SELECT 1 FROM workers WHERE company_id = ${companyId} AND employee_number = ${candidate} LIMIT 1`));
    if (!taken) {
      if (hasCounters) {
        await tx.execute(sql`UPDATE employee_number_counters SET last_value = ${next}, updated_at = now() WHERE company_id = ${companyId} AND year_prefix = ${yy}`);
      }
      return candidate;
    }
    next++;
  }
  throw new EmployeeNumberExhaustedError(yy);
}

/** Postgres unique violation on the per-company employee-number index. */
export function isEmployeeNumberConflict(e: unknown): boolean {
  const err = e as { code?: string; constraint?: string; message?: string; cause?: any };
  const c = err?.code ?? err?.cause?.code;
  const name = err?.constraint ?? err?.cause?.constraint ?? "";
  return c === "23505" && (name === "uq_workers_company_employee_number" || /uq_workers_company_employee_number/.test(String(err?.message ?? err?.cause?.message ?? "")));
}
export const EMPLOYEE_NUMBER_CONFLICT_MESSAGE = "That employee number is already in use in this company.";

/**
 * Insert a worker, allocating its employee number in the SAME transaction
 * when none is supplied. A supplied number is kept as-is (the per-company
 * unique index rejects a duplicate → isEmployeeNumberConflict). PIN fields go
 * through preparePinFields (bcrypt hash only).
 */
export async function createWorkerAllocatingNumber(data: Record<string, any>, now: Date = new Date()) {
  const { workers } = await import("@shared/schema");
  const values = await preparePinFields(data);
  return db.transaction(async (tx) => {
    const supplied = typeof values.employeeNumber === "string" ? values.employeeNumber.trim() : "";
    if (supplied) values.employeeNumber = supplied;
    else {
      if (!values.companyId) throw new Error("companyId is required to allocate an employee number");
      values.employeeNumber = await allocateEmployeeNumber(tx, values.companyId, now);
    }
    const [worker] = await tx.insert(workers).values(values as any).returning();
    return worker;
  });
}
