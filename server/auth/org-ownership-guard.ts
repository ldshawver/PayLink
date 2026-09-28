/**
 * Organization Ownership Guard — server/auth/org-ownership-guard.ts
 *
 * Pure (DB-free) authorization decisions for the company-authorization
 * boundary and organization-hierarchy resources (legal entities, divisions,
 * departments, branches, positions, cost centers, jobs) and the tenant-safe
 * company-field allowlist.
 *
 * Closes the SaaS readiness audit's P0 findings:
 *  - org-hierarchy rows could be created in, updated in, re-parented to NULL
 *    ("universal") from, or deleted from ANY company by any tenant manager;
 *  - PATCH /api/companies/:id wrote req.body verbatim, so a tenant could set
 *    its own enterprise_id to a victim's and inherit the (now removed)
 *    enterprise-sibling access, or self-upgrade subscription/billing/demo state.
 *
 * Design mirrors user-provisioning-guard.ts / schedule-access-guard.ts: route
 * handlers resolve the DB facts (platform role, stored owning company,
 * canAccessCompany results) and pass plain values in, so every decision is
 * unit-testable without a database.
 */

/**
 * Platform roles that bypass company membership in canAccessCompany().
 * An explicit list — platform privilege is never inferred from
 * users.company_id being NULL. requirePlatformRole()'s allowlist plus
 * platform_owner, which expandRoleForGuard() already treats as equivalent to
 * platform_super_admin (asserted by the batch-2 cross-tenant suite).
 */
export const PLATFORM_COMPANY_BYPASS_ROLES: ReadonlySet<string> = new Set([
  "platform_super_admin", "platform_admin", "platform_owner", "platform_sales",
  "platform_implementation", "platform_support", "platform_billing", "platform_auditor",
]);

/**
 * Platform roles allowed to manage universal (company_id NULL) organization
 * rows and company control fields: requirePlatformAdminRole()'s pair plus
 * platform_owner (see above). Enterprise and company-creation routes still use
 * requirePlatformAdminRole() itself, which does not admit platform_owner.
 */
export const PLATFORM_ORG_ADMIN_ROLES: ReadonlySet<string> = new Set([
  "platform_super_admin", "platform_admin", "platform_owner",
]);

export function isPlatformCompanyBypassRole(role: string | null | undefined): boolean {
  return !!role && PLATFORM_COMPANY_BYPASS_ROLES.has(role);
}

export function isPlatformOrgAdminRole(role: string | null | undefined): boolean {
  return !!role && PLATFORM_ORG_ADMIN_ROLES.has(role);
}

/** Client sentinels the org forms send for "All Companies (Universal)". */
export function normalizeRequestedCompanyId(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "" || value === "__universal__") return null;
  return typeof value === "string" ? value : undefined;
}

export interface OrgDecision {
  allowed: boolean;
  status?: number;
  message?: string;
  /** The company the row must be written with (null = universal). */
  companyId?: string | null;
}

export interface OrgCreateInput {
  isPlatformOrgAdmin: boolean;
  /** The actor's own company (resolveTenantCompanyId); null = none. */
  actorCompanyId: string | null;
  /** normalizeRequestedCompanyId(req.body.companyId). */
  requestedCompanyId: string | null | undefined;
  /** canAccessCompany(actor, requestedCompanyId) — only meaningful for a non-null id. */
  requestedCompanyAccessible: boolean;
}

/**
 * CREATE: tenants write into their own company or an explicitly accessible
 * one; an omitted / "universal" company resolves to the actor's own company
 * (never to NULL). Only platform org admins may create universal rows.
 */
export function evaluateOrgCreate(input: OrgCreateInput): OrgDecision {
  if (input.isPlatformOrgAdmin) {
    return { allowed: true, companyId: input.requestedCompanyId ?? null };
  }
  if (!input.actorCompanyId) {
    return { allowed: false, status: 403, message: "Your account is not scoped to a company" };
  }
  if (!input.requestedCompanyId) {
    return { allowed: true, companyId: input.actorCompanyId };
  }
  if (!input.requestedCompanyAccessible) {
    return { allowed: false, status: 403, message: "Forbidden: cannot create records for a company you do not have access to" };
  }
  return { allowed: true, companyId: input.requestedCompanyId };
}

export interface OrgMutationInput {
  isPlatformOrgAdmin: boolean;
  /** Stored company_id of the existing row (null = universal row). */
  storedCompanyId: string | null;
  /** canAccessCompany(actor, storedCompanyId) — ignored for universal rows. */
  storedCompanyAccessible: boolean;
  /** normalizeRequestedCompanyId(req.body.companyId); undefined = not being changed. */
  requestedCompanyId?: string | null | undefined;
  /** canAccessCompany(actor, requestedCompanyId) for a non-null requested id. */
  requestedCompanyAccessible?: boolean;
}

/**
 * UPDATE / DELETE: authorize against the row's STORED owning company, never a
 * client-supplied one. Tenants cannot touch universal rows and cannot move a
 * row to another company or to universal.
 */
export function evaluateOrgMutation(input: OrgMutationInput): OrgDecision {
  const reqCo = input.requestedCompanyId;
  if (input.isPlatformOrgAdmin) {
    return { allowed: true, companyId: reqCo === undefined ? input.storedCompanyId : reqCo };
  }
  if (input.storedCompanyId === null) {
    return { allowed: false, status: 403, message: "Forbidden: universal records can only be managed by a platform administrator" };
  }
  if (!input.storedCompanyAccessible) {
    // Same response as a missing row: do not confirm another tenant's ids exist.
    return { allowed: false, status: 404, message: "Not found" };
  }
  if (reqCo !== undefined && reqCo !== input.storedCompanyId) {
    return { allowed: false, status: 403, message: "Forbidden: records cannot be reassigned to another company or made universal" };
  }
  return { allowed: true, companyId: input.storedCompanyId };
}

/**
 * Company columns a tenant (non-platform) administrator may change through
 * PATCH /api/companies/:id. Everything else — enterprise linkage, subscription,
 * trial, billing, demo, Stripe/treasury, lifecycle — is platform-controlled.
 * Drizzle camelCase property names from shared/schema.ts `companies`.
 */
export const TENANT_EDITABLE_COMPANY_FIELDS: ReadonlySet<string> = new Set([
  "name", "legalName", "dba", "ein", "taxId", "entityNumber", "entityType",
  "address", "city", "state", "zip", "phone", "website", "email",
  "logoUrl", "iconUrl", "tagline",
  "payFrequency", "overtimeThreshold", "overtimeMultiplier",
  "breakPolicyMinutes", "breakAfterHours", "timeRoundingMinutes",
  "nextCheckNumber", "stationEnforcementEnabled",
  "timezone", "timezoneConfirmed", "clockInGraceMinutes", "notifyMgrOnViolations",
  // Validated separately: must reference a legal entity owned by this company.
  "legalEntityId",
]);

/** Fields a tenant may not change even though the client form may echo them. */
const IMMUTABLE_ECHO_FIELDS: ReadonlySet<string> = new Set(["id", "createdAt"]);

export interface CompanyPatchFilterResult {
  allowed: boolean;
  status?: number;
  message?: string;
  rejectedFields?: string[];
  /** The sanitized update to apply. */
  data?: Record<string, unknown>;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a instanceof Date || b instanceof Date) {
    const ta = a ? new Date(a as any).getTime() : NaN;
    const tb = b ? new Date(b as any).getTime() : NaN;
    return ta === tb;
  }
  return String(a ?? "") === String(b ?? "");
}

/**
 * Allowlist filter for a tenant company PATCH. Non-allowlisted fields whose
 * value is unchanged from the stored row (the settings form echoes the whole
 * company object) are dropped silently; a non-allowlisted field whose value
 * would CHANGE rejects the whole request with 403 — never a silent partial write.
 */
export function filterTenantCompanyPatch(
  body: Record<string, unknown>,
  stored: Record<string, unknown>,
): CompanyPatchFilterResult {
  const data: Record<string, unknown> = {};
  const rejected: string[] = [];
  for (const [key, value] of Object.entries(body ?? {})) {
    if (TENANT_EDITABLE_COMPANY_FIELDS.has(key)) {
      data[key] = value;
      continue;
    }
    if (IMMUTABLE_ECHO_FIELDS.has(key)) continue;
    if (key in stored && sameValue(value, stored[key])) continue;
    rejected.push(key);
  }
  if (rejected.length > 0) {
    return {
      allowed: false,
      status: 403,
      message: "Forbidden: these company fields are platform-controlled",
      rejectedFields: rejected.sort(),
    };
  }
  return { allowed: true, data };
}
