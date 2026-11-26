/**
 * Scheduled trial expiry and grace-period suspension.
 *
 * Idempotent: a company already in trial_expired is not selected again, and
 * checkAndSuspendExpiredGracePeriods no-ops when the grace window has not
 * ended or the company is no longer in grace_period. Existing trial_end
 * values are not rewritten when the platform trial-length setting changes.
 */
import { db } from "./db";
import { sql } from "drizzle-orm";
import { mirrorTenantStatusFromCompany } from "./tenant-context";
import { checkAndSuspendExpiredGracePeriods } from "./billingLifecycle";

export const ELAPSED_TRIAL_STATUSES = ["trial_active", "trialing", "trial"] as const;

export function shouldExpireTrial(
  status: string | null | undefined,
  trialEnd: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!trialEnd) return false;
  const end = trialEnd instanceof Date ? trialEnd : new Date(trialEnd);
  if (Number.isNaN(end.getTime()) || end.getTime() >= now.getTime()) return false;
  return (ELAPSED_TRIAL_STATUSES as readonly string[]).includes((status || "").trim().toLowerCase());
}

/**
 * trial_active / trialing / trial whose trial_end has passed → trial_expired.
 * Returns how many companies moved. Safe to run repeatedly.
 */
export async function expireElapsedTrials(): Promise<number> {
  const updated = await db.execute(sql`
    UPDATE companies
    SET subscription_status = 'trial_expired',
        trial_used = TRUE
    WHERE subscription_status IN ('trial_active', 'trialing', 'trial')
      AND trial_end IS NOT NULL
      AND trial_end < NOW()
    RETURNING id
  `);
  const ids = (updated.rows as { id: string }[]).map((row) => String(row.id));
  for (const id of ids) {
    await mirrorTenantStatusFromCompany(id, "trial_expired");
  }
  return ids.length;
}

export async function runTrialAndGraceSweep(): Promise<{ trialsExpired: number; graceSuspended: number }> {
  const trialsExpired = await expireElapsedTrials();
  const graceSuspended = await checkAndSuspendExpiredGracePeriods();
  return { trialsExpired, graceSuspended };
}
