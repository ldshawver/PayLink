/**
 * Schedule Access Guard — server/auth/schedule-access-guard.ts
 *
 * Pure (DB-free) authorization decision for schedule creation
 * (`POST /api/schedules`).
 *
 * Closes a CRITICAL tenant-isolation hole: that endpoint was gated only by
 * requireActiveSubscription and trusted `req.body.companyId` verbatim, so a
 * tenant admin could create schedules inside ANY company (another tenant's
 * included) simply by passing a foreign companyId. Because a schedule's
 * companyId becomes the effective company for all downstream records (punches,
 * time entries, payroll), this leaked cross-tenant write access.
 *
 * Cross-company scheduling is a legitimate product feature (a worker may be
 * scheduled at any company they're authorized for), so access is decided with
 * the same canAccessCompany semantics used elsewhere — own company, enterprise
 * sibling within the same tenant, or an explicit company_user_access grant.
 *
 * Design: this function is intentionally pure. The route handler resolves the
 * DB-dependent facts (whether the requestor is a platform user, the requestor's
 * companyId, and whether the target company is accessible via canAccessCompany)
 * and passes them in as plain values, so the decision can be unit-tested
 * without a database.
 */

export interface ScheduleAccessInput {
  /** Whether the requestor holds a platform-scoped role (platform_*). */
  isPlatformUser: boolean;
  /** The requestor's home/default companyId (null for platform/global users). */
  requestorCompanyId: string | null | undefined;
  /** The companyId the schedule is being created in (from the request body). */
  targetCompanyId: string | null | undefined;
  /**
   * Whether `targetCompanyId` is accessible to the requestor — the result of
   * canAccessCompany(requestor, targetCompanyId). Resolved by the route.
   */
  targetCompanyAccessible: boolean;
}

export interface ScheduleAccessDecision {
  allowed: boolean;
  status?: number;
  message?: string;
}

/**
 * Decide whether the requestor may create a schedule in `targetCompanyId`.
 * Platform users are intentionally left unchanged (they manage all companies).
 */
export function evaluateScheduleAccess(input: ScheduleAccessInput): ScheduleAccessDecision {
  // Platform staff: behavior unchanged — they may schedule into any company.
  if (input.isPlatformUser) return { allowed: true };

  // A tenant actor must itself be scoped to a company.
  if (!input.requestorCompanyId) {
    return { allowed: false, status: 403, message: "Your account is not scoped to a company" };
  }

  // The schedule must target a company the actor can access.
  if (!input.targetCompanyId || !input.targetCompanyAccessible) {
    return {
      allowed: false,
      status: 403,
      message: "Forbidden: cannot create a schedule for a company you do not have access to",
    };
  }

  return { allowed: true };
}
