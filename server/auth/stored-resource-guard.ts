/**
 * Stored-Resource Ownership Guard — server/auth/stored-resource-guard.ts
 *
 * Pure (DB-free) authorization decisions for SaaS PR 2: company-scoped LIST
 * endpoints and by-id operations on financial, payroll, employment and
 * personal-data resources.
 *
 * Closes the SaaS readiness audit's live-confirmed cross-tenant defects:
 *  - list endpoints that honoured any ?companyId (and returned EVERY tenant's
 *    rows when it was omitted) — remittance sources (bank routing/account
 *    numbers), payroll runs, expenses, customers;
 *  - by-id reads/writes that never compared the STORED owning company with the
 *    actor (pay methods, payroll items, payroll-run taxes/ACH, 1099 summaries,
 *    time punches, time-off requests, compliance worker records, users);
 *  - the systemic "user.companyId && …" guard shape that let a company-less
 *    non-platform user skip the company comparison entirely.
 *
 * Invariants:
 *  - a missing companyId NEVER means "all tenants" for a non-platform actor;
 *  - a supplied companyId is authorized (canAccessCompany) BEFORE any query;
 *  - a company-less non-platform actor is not a platform actor;
 *  - by-id operations authorize the owner resolved from the stored record,
 *    never a companyId taken from the request.
 *
 * Design mirrors org-ownership-guard.ts: route helpers resolve the DB facts
 * (platform role, stored owner, canAccessCompany results) and pass plain values
 * in, so every decision is unit-testable without a database.
 */

export interface GuardDenial {
  allowed: false;
  status: number;
  message: string;
}

/**
 * Normalizes a client-supplied list companyId. Absent, blank, non-string
 * (e.g. a repeated query param) and the UI's "all" sentinel all mean
 * "not supplied" — which then resolves to the actor's own scope, never to
 * every tenant (only a platform actor on an endpoint that allows it gets that).
 */
export function normalizeListCompanyId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (!v || v === "all") return undefined;
  return v;
}

export interface ListScopeInput {
  /** isPlatformCompanyBypassRole(actor.role). */
  isPlatform: boolean;
  /** normalizeListCompanyId(req.query.companyId). */
  requestedCompanyId: string | undefined;
  /** canAccessCompany(actor, requestedCompanyId) — only meaningful when one was supplied. */
  requestedAccessible: boolean;
  /**
   * The actor's default company: their home company (resolveTenantCompanyId), or
   * — for a company-less user — their single explicit company_user_access grant.
   * null when neither resolves unambiguously.
   */
  defaultCompanyId: string | null;
  /** Whether this endpoint intentionally lets a platform actor list every company. */
  allowPlatformAll: boolean;
}

export type ListScopeDecision =
  | { allowed: true; /** undefined = every company (platform only). */ companyId: string | undefined }
  | GuardDenial;

export function decideListScope(input: ListScopeInput): ListScopeDecision {
  if (input.requestedCompanyId !== undefined) {
    if (input.isPlatform || input.requestedAccessible) {
      return { allowed: true, companyId: input.requestedCompanyId };
    }
    return { allowed: false, status: 403, message: "You do not have access to this company" };
  }
  if (input.isPlatform) {
    if (input.allowPlatformAll) return { allowed: true, companyId: undefined };
    return { allowed: false, status: 400, message: "companyId is required" };
  }
  if (input.defaultCompanyId) return { allowed: true, companyId: input.defaultCompanyId };
  return { allowed: false, status: 403, message: "Your account is not scoped to a company" };
}

export interface StoredResourceInput {
  /** Whether the resource exists. */
  exists: boolean;
  /** The resource's STORED owning company (resolved server-side). */
  storedCompanyId: string | null | undefined;
  /** isPlatformCompanyBypassRole(actor.role). */
  isPlatform: boolean;
  /** canAccessCompany(actor, storedCompanyId) — only meaningful for a non-null owner. */
  storedAccessible: boolean;
  /** Human label used in the 404 message ("Payroll run", "Pay method", …). */
  label?: string;
}

export type StoredResourceDecision = { allowed: true } | GuardDenial;

/**
 * resource id → load → STORED owner → canAccessCompany → operate.
 * A resource whose owner cannot be resolved is platform-only: a NULL owner is
 * never treated as "shared with every tenant" here.
 */
export function decideStoredResourceAccess(input: StoredResourceInput): StoredResourceDecision {
  if (!input.exists) return { allowed: false, status: 404, message: `${input.label ?? "Resource"} not found` };
  if (input.isPlatform) return { allowed: true };
  if (!input.storedCompanyId) {
    return { allowed: false, status: 403, message: "Forbidden: this record is not owned by your company" };
  }
  if (input.storedAccessible) return { allowed: true };
  return { allowed: false, status: 403, message: "Forbidden: this record belongs to a different company" };
}

/**
 * Fields a by-id PATCH must never write from the request body: identity,
 * ownership / re-parenting links and server-maintained audit stamps. Callers
 * strip these before calling storage.update*(id, body).
 */
export const OWNERSHIP_IMMUTABLE_FIELDS: readonly string[] = [
  "id", "companyId", "workerId", "payrollRunId", "payrollItemId", "userId",
  "createdAt", "createdBy",
];

export function stripOwnershipFields(
  body: unknown,
  extra: readonly string[] = [],
): Record<string, any> {
  const out: Record<string, any> = {};
  if (!body || typeof body !== "object" || Array.isArray(body)) return out;
  const blocked = new Set<string>([...OWNERSHIP_IMMUTABLE_FIELDS, ...extra]);
  for (const [k, v] of Object.entries(body)) {
    if (!blocked.has(k)) out[k] = v;
  }
  return out;
}

/**
 * Minimal worker projection for the worker-compliance tab. The client reads
 * only identity and workerType from `worker`; the full row (SSN, bank, tax,
 * address, pay) must not be returned by a compliance read.
 */
export function toComplianceWorker(w: {
  id: string; companyId?: string | null; firstName?: string | null; lastName?: string | null;
  workerType?: string | null; employeeNumber?: string | null; status?: string | null;
}) {
  return {
    id: w.id,
    companyId: w.companyId ?? null,
    firstName: w.firstName ?? null,
    lastName: w.lastName ?? null,
    workerType: w.workerType ?? null,
    employeeNumber: w.employeeNumber ?? null,
    status: w.status ?? null,
  };
}
