/**
 * User Provisioning Guard — server/auth/user-provisioning-guard.ts
 *
 * Pure (DB-free) authorization decision for the user create/update endpoints
 * (`POST /api/users`, `PATCH /api/users/:id`).
 *
 * Closes a CRITICAL privilege-escalation / tenant-isolation hole: those
 * endpoints are gated by requireRole("admin"), which legacy-expands to include
 * tenant-scoped tenant_admin / tenant_owner. Without this guard a tenant admin
 * could set `role: "platform_super_admin"` and/or `companyId: null` on a user
 * (their own or anyone's) and seize platform-wide, cross-tenant control.
 *
 * Design: this function is intentionally pure. The route handler resolves the
 * DB-dependent facts (the requestor, the target user, and whether a given
 * companyId is accessible via canAccessCompany) and passes them in as plain
 * values, so the security decision can be unit-tested without a database.
 */

export interface ProvisioningRequestor {
  role: string | null | undefined;
  companyId: string | null | undefined;
}

export interface ProvisioningDecision {
  allowed: boolean;
  status?: number;
  message?: string;
}

/** A platform-scoped role (platform_super_admin, platform_admin, ...). */
export function isPlatformRole(role: string | null | undefined): boolean {
  return !!role && role.startsWith("platform_");
}

/**
 * Non-platform roles that a tenant admin must never be able to grant, because
 * they confer global/system reach beyond a single tenant.
 */
const FORBIDDEN_TENANT_GRANTABLE_ROLES = new Set<string>(["system_admin"]);

export interface ProvisioningInput {
  /** The user performing the action. */
  requestor: ProvisioningRequestor;
  /** Role being assigned. `undefined` means "not being changed" (PATCH). */
  desiredRole?: string | null;
  /** Company being assigned. `undefined` means "not being changed" (PATCH). */
  desiredCompanyId?: string | null;
  /** Whether `desiredCompanyId` is accessible to the requestor (canAccessCompany result). */
  desiredCompanyAccessible?: boolean;
  /**
   * For PATCH only: the existing company of the target user. Pass `undefined`
   * for POST (no pre-existing target). `null` means the target is a
   * platform/global-scoped user.
   */
  targetCompanyId?: string | null;
  /** For PATCH only: whether the target user's company is accessible to the requestor. */
  targetCompanyAccessible?: boolean;
  /** For PATCH only: the existing role of the target user. */
  targetRole?: string | null;
}

/**
 * Decide whether `requestor` may create/update a user with the given desired
 * role and company. Platform staff are intentionally left unchanged (their
 * provisioning powers are out of scope for this CRITICAL fix).
 */
export function evaluateUserProvisioning(input: ProvisioningInput): ProvisioningDecision {
  const { requestor } = input;

  // Platform staff: behavior unchanged by this fix.
  if (isPlatformRole(requestor.role)) return { allowed: true };

  // A tenant actor must itself be scoped to a company.
  if (!requestor.companyId) {
    return { allowed: false, status: 403, message: "Your account is not scoped to a company" };
  }

  // PATCH: the existing target must be a company user within the requestor's scope.
  if (input.targetCompanyId !== undefined) {
    if (!input.targetCompanyId || isPlatformRole(input.targetRole)) {
      return { allowed: false, status: 403, message: "Cannot modify a platform-scoped user" };
    }
    if (!input.targetCompanyAccessible) {
      return { allowed: false, status: 403, message: "Cannot modify a user outside your company scope" };
    }
  }

  // Grant ceiling: a tenant actor may never assign a platform/system role.
  if (input.desiredRole !== undefined && input.desiredRole !== null) {
    const role = String(input.desiredRole);
    if (isPlatformRole(role) || FORBIDDEN_TENANT_GRANTABLE_ROLES.has(role)) {
      return { allowed: false, status: 403, message: "Cannot assign a platform-scoped role" };
    }
  }

  // Company ceiling: cannot assign/move a user to global (null) or out-of-scope company.
  if (input.desiredCompanyId !== undefined) {
    if (!input.desiredCompanyId || !input.desiredCompanyAccessible) {
      return { allowed: false, status: 403, message: "Cannot assign a user outside your company scope" };
    }
  }

  return { allowed: true };
}
