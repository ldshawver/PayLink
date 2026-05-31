/**
 * Tenant Context Foundation — Phase 2
 *
 * Provides helpers for tenant-aware request handling:
 *
 *  - getTenantIdForCompany(companyId)         resolve company → tenant.id
 *  - getTenantForCompany(companyId)           resolve company → full tenant record
 *  - assertUserCanAccessCompany(userId, cid)  enforce tenant-level status gate
 *  - withTenantContext middleware              populate req.tenantId / req.resolvedCompanyId
 *                                             / req.accessibleCompanyIds on every /api route
 *
 * Design: additive-only for Phase 2. Routes are NOT rewritten here.
 * Middleware populates context but does NOT block (except for suspended/cancelled tenants
 * when assertUserCanAccessCompany is called explicitly). Full enforcement comes in Phase 4.
 */

import type { Request, Response, NextFunction } from "express";
import { db } from "./db";

// ── Extend Express Request type ───────────────────────────────────────────────
declare global {
  namespace Express {
    interface Request {
      /** Resolved tenant ID from tenant_companies for the session user's company. Null = unassigned. */
      tenantId?: string | null;
      /** The user's primary company ID from the session. */
      resolvedCompanyId?: string | null;
      /** All company IDs this user can access (primary + secondary via company_user_access). */
      accessibleCompanyIds?: string[];
    }
  }
}

// ── Tenant record shape ───────────────────────────────────────────────────────
export type TenantRecord = {
  id: string;
  name: string;
  slug: string;
  status: string; // active | trial | demo | suspended | cancelled
};

// ── In-memory cache: company_id → tenant (30 s TTL) ──────────────────────────
type CacheEntry = { tenantId: string | null; tenant: TenantRecord | null; expiresAt: number };
const _companyTenantCache = new Map<string, CacheEntry>();
const TENANT_CACHE_TTL_MS = 30_000;

// In-memory cache: user_id → accessible company IDs (15 s TTL)
type UserCacheEntry = { companyIds: string[]; expiresAt: number };
const _userCompanyCache = new Map<string, UserCacheEntry>();
const USER_CACHE_TTL_MS = 15_000;

/** Invalidate the company→tenant cache entry (call after tenant_companies changes). */
export function invalidateTenantCache(companyId?: string): void {
  if (companyId) {
    _companyTenantCache.delete(companyId);
  } else {
    _companyTenantCache.clear();
  }
}

/** Invalidate the user→companies cache entry (call after company_user_access changes). */
export function invalidateUserCompanyCache(userId?: string): void {
  if (userId) {
    _userCompanyCache.delete(userId);
  } else {
    _userCompanyCache.clear();
  }
}

// ── Core lookup helpers ───────────────────────────────────────────────────────

/**
 * Resolve the tenant ID for a company.
 * Returns null if the company has no tenant_companies assignment.
 * Caches result for TENANT_CACHE_TTL_MS.
 */
export async function getTenantIdForCompany(companyId: string): Promise<string | null> {
  const cached = _companyTenantCache.get(companyId);
  if (cached && Date.now() < cached.expiresAt) return cached.tenantId;

  try {
    const { rows } = await db.$client.query<{
      tenant_id: string; id: string; name: string; slug: string; status: string;
    }>(
      `SELECT tc.tenant_id, t.id, t.name, t.slug, t.status
       FROM tenant_companies tc
       JOIN tenants t ON t.id = tc.tenant_id
       WHERE tc.company_id = $1
       LIMIT 1`,
      [companyId]
    );

    const tenantId = rows.length > 0 ? rows[0].tenant_id : null;
    const tenant: TenantRecord | null = rows.length > 0
      ? { id: rows[0].id, name: rows[0].name, slug: rows[0].slug, status: rows[0].status }
      : null;

    _companyTenantCache.set(companyId, { tenantId, tenant, expiresAt: Date.now() + TENANT_CACHE_TTL_MS });
    return tenantId;
  } catch (e) {
    console.error("[TenantContext] getTenantIdForCompany error:", e);
    return null;
  }
}

/**
 * Resolve the full tenant record for a company.
 * Returns null if unassigned.
 */
export async function getTenantForCompany(companyId: string): Promise<TenantRecord | null> {
  const cached = _companyTenantCache.get(companyId);
  if (cached && Date.now() < cached.expiresAt) return cached.tenant;
  await getTenantIdForCompany(companyId); // populates cache
  return _companyTenantCache.get(companyId)?.tenant ?? null;
}

/**
 * Resolve all company IDs accessible to a user (primary + secondary from company_user_access).
 * Caches result for USER_CACHE_TTL_MS.
 */
export async function getAccessibleCompanyIds(userId: string, primaryCompanyId: string | null): Promise<string[]> {
  const cached = _userCompanyCache.get(userId);
  if (cached && Date.now() < cached.expiresAt) return cached.companyIds;

  try {
    const { rows } = await db.$client.query<{ company_id: string }>(
      `SELECT company_id FROM company_user_access WHERE user_id = $1 AND is_active = TRUE`,
      [userId]
    );
    const secondary = rows.map(r => r.company_id);
    const all = Array.from(new Set([...(primaryCompanyId ? [primaryCompanyId] : []), ...secondary]));
    _userCompanyCache.set(userId, { companyIds: all, expiresAt: Date.now() + USER_CACHE_TTL_MS });
    return all;
  } catch (e) {
    console.error("[TenantContext] getAccessibleCompanyIds error:", e);
    return primaryCompanyId ? [primaryCompanyId] : [];
  }
}

// ── Tenant-status assertion ───────────────────────────────────────────────────

/**
 * Assert that a user can access a company AND that the company's tenant
 * is not suspended or cancelled.
 *
 * Throws an enriched Error (with .statusCode and .reason) if blocked.
 *
 * Phase 2 behaviour:
 *  - If company has no tenant assignment → logs a warning and ALLOWS (backwards compatible).
 *  - If tenant is suspended/cancelled → throws 403.
 *  - Platform bypass (role starts with "platform_") → always allowed.
 *
 * Full per-user access checking (company_user_access) is done by the existing
 * canAccessCompany() helper in routes.ts and is NOT duplicated here.
 */
export async function assertUserCanAccessCompany(
  userId: string,
  companyId: string | null | undefined,
  opts?: { isPlatformUser?: boolean }
): Promise<void> {
  if (!companyId) return; // no company scope — always permitted
  if (opts?.isPlatformUser) return; // platform users bypass all tenant gates

  const tenant = await getTenantForCompany(companyId);

  if (!tenant) {
    // Company not yet assigned to any tenant — warn and allow (Phase 2 compat).
    // Phase 4 will tighten this to block unassigned companies.
    console.warn(`[TenantContext] Company ${companyId} is not assigned to a tenant (user=${userId}). Access permitted — assign in Platform Console.`);
    return;
  }

  if (tenant.status === "suspended") {
    const err = new Error(`Access denied: tenant "${tenant.name}" is suspended`) as any;
    err.statusCode = 403;
    err.reason = "tenant_suspended";
    err.tenantId = tenant.id;
    throw err;
  }

  if (tenant.status === "cancelled") {
    const err = new Error(`Access denied: tenant "${tenant.name}" has been cancelled`) as any;
    err.statusCode = 403;
    err.reason = "tenant_cancelled";
    err.tenantId = tenant.id;
    throw err;
  }
}

// ── withTenantContext middleware ──────────────────────────────────────────────

/**
 * Express middleware: populates req.tenantId, req.resolvedCompanyId,
 * req.accessibleCompanyIds from the authenticated session.
 *
 * Must be registered AFTER the session middleware.
 * Does NOT block unauthenticated requests — simply skips context population.
 * Does NOT block suspended/cancelled tenants (use assertUserCanAccessCompany for that).
 *
 * For Phase 2, mount this on /api routes only:
 *   app.use("/api", withTenantContext);
 */
export async function withTenantContext(req: Request, _res: Response, next: NextFunction): Promise<void> {
  // Set safe defaults
  req.tenantId = null;
  req.resolvedCompanyId = null;
  req.accessibleCompanyIds = [];

  const userId = req.session?.userId;
  if (!userId) return next();

  try {
    const { rows } = await db.$client.query<{ company_id: string | null; role: string }>(
      `SELECT company_id, role FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );
    if (!rows.length) return next();

    const { company_id: primaryCompanyId, role } = rows[0];

    // Platform users are never company-scoped
    if ((role ?? "").startsWith("platform_")) return next();

    req.resolvedCompanyId = primaryCompanyId ?? null;

    if (primaryCompanyId) {
      const [tenantId, accessibleIds] = await Promise.all([
        getTenantIdForCompany(primaryCompanyId),
        getAccessibleCompanyIds(userId, primaryCompanyId),
      ]);
      req.tenantId = tenantId;
      req.accessibleCompanyIds = accessibleIds;
    }
  } catch (e) {
    // Never block a request due to tenant context resolution failure
    console.error("[TenantContext] withTenantContext error:", e);
  }

  return next();
}

// ── Convenience route helper ──────────────────────────────────────────────────

/**
 * Express route handler wrapper that catches assertUserCanAccessCompany errors
 * and returns a properly formatted 403 JSON response.
 *
 * Usage:
 *   app.get("/api/something", requireAuth, tenantGuard(async (req, res) => {
 *     await assertUserCanAccessCompany(req.session.userId!, req.resolvedCompanyId, ...);
 *     // ... handler logic
 *   }));
 */
export function tenantGuard(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res, next).catch((err: any) => {
      if (err?.statusCode === 403 && (err?.reason === "tenant_suspended" || err?.reason === "tenant_cancelled")) {
        return res.status(403).json({
          message: err.message,
          reason: err.reason,
          tenantId: err.tenantId,
        });
      }
      next(err);
    });
  };
}
