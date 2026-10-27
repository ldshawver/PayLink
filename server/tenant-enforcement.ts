import { db } from "./db";
import { sql } from "drizzle-orm";
import { mapSubscriptionStatusToTenantStatus } from "./tenant-context";
import { GRACE_SUBSCRIPTION_STATUSES, TRIAL_SUBSCRIPTION_STATUSES, isKnownSubscriptionStatus, normalizeSubscriptionStatus } from "./subscription-status";

export type GateCode =
  | "trial_expired"
  | "past_due"
  | "grace_expired"
  | "suspended"
  | "cancelled"
  | "tenant_inactive"
  | "agreement_required"
  | "gate_unavailable";

export interface TenantGateResult {
  allowed: boolean;
  reason?: string;
  code?: GateCode;
  policyDetail?: string;
  details?: Record<string, any>;
}

const EXEMPT_STATUSES = new Set(["active_paid", "active", "trial_active", "trialing"]);

export async function checkTenantGate(companyId: string): Promise<TenantGateResult> {
  try {
    const compRow = await db.execute(sql`
      SELECT id, name, subscription_status, billing_active, payment_method_on_file,
             trial_end, trial_used, is_demo, plan_name, grace_period_end, grace_period_days,
             stripe_customer_id, stripe_subscription_id, agreement_signed_at
      FROM companies WHERE id = ${companyId}
    `);
    const c = compRow.rows[0] as any;
    if (!c) return { allowed: false, reason: "Company not found", code: "tenant_inactive" };

    const status = normalizeSubscriptionStatus(c.subscription_status);
    const now = new Date();

    // Demo classification never overrides an enforcement state (PR-C1): only
    // an unexpired, non-suspended/cancelled demo bypasses the checks below.
    if (c.is_demo) {
      const demoStatus = mapSubscriptionStatusToTenantStatus(c.subscription_status, true, c.trial_end);
      if (demoStatus === "demo") return { allowed: true };
      if (demoStatus === "cancelled") {
        return { allowed: false, reason: "This demo has been cancelled.", code: "cancelled", details: { subscriptionStatus: status, isDemo: true } };
      }
      if (status === "suspended" || status === "past_due") {
        return { allowed: false, reason: "This demo has been suspended.", code: status, details: { subscriptionStatus: status, isDemo: true } };
      }
      return {
        allowed: false,
        reason: "This demo has expired.",
        code: "trial_expired",
        policyDetail: "Start a new demo or subscribe to a plan to continue.",
        details: { trialEnd: c.trial_end, subscriptionStatus: status, isDemo: true },
      };
    }

    if ((TRIAL_SUBSCRIPTION_STATUSES as readonly string[]).includes(status)) {
      if (c.trial_end && new Date(c.trial_end) < now) {
        return {
          allowed: false,
          reason: "Your free trial has expired.",
          code: "trial_expired",
          policyDetail: "Please subscribe to a plan to restore access.",
          details: { trialEnd: c.trial_end, subscriptionStatus: status },
        };
      }
      return { allowed: true };
    }

    if (status === "trial_expired") {
      return {
        allowed: false,
        reason: "Your free trial has expired.",
        code: "trial_expired",
        policyDetail: "Please subscribe to a plan to restore access.",
        details: { trialEnd: c.trial_end, subscriptionStatus: status },
      };
    }

    if (status === "active_paid" || status === "active") {
      return { allowed: true };
    }

    if ((GRACE_SUBSCRIPTION_STATUSES as readonly string[]).includes(status)) {
      if (c.grace_period_end && new Date(c.grace_period_end) < now) {
        return {
          allowed: false,
          reason: "Your grace period has expired. Payment is required to continue.",
          code: "grace_expired",
          policyDetail: "Please update your billing to restore access.",
          details: { gracePeriodEnd: c.grace_period_end, subscriptionStatus: status },
        };
      }
      return { allowed: true };
    }

    if (status === "past_due") {
      return {
        allowed: false,
        reason: "Your account has a past-due balance.",
        code: "past_due",
        policyDetail: "Please update your payment method to restore access.",
        details: { subscriptionStatus: status },
      };
    }

    if (status === "cancelled") {
      return {
        allowed: false,
        reason: "Your subscription has been cancelled.",
        code: "cancelled",
        policyDetail: "Resubscribe to restore access to PayLink.",
        details: { subscriptionStatus: status },
      };
    }

    if (status === "suspended") {
      return {
        allowed: false,
        reason: "Your account has been suspended.",
        code: "suspended",
        policyDetail: "Contact support at support@mypaylink.app to restore access.",
        details: { subscriptionStatus: status },
      };
    }

    // Fail closed: a status this gate cannot classify (NULL, empty, unknown)
    // means eligibility cannot be determined.
    if (!isKnownSubscriptionStatus(status)) {
      console.warn(`[TenantGate] company ${companyId} has unrecognized subscription_status; access denied`);
    }
    return {
      allowed: false,
      reason: "Your account status could not be verified.",
      code: "tenant_inactive",
      policyDetail: "Contact support at support@mypaylink.app to restore access.",
    };
  } catch (e) {
    // Fail closed: if eligibility cannot be read, access is not granted. The
    // error is logged here only; callers return the generic reason below.
    console.error("[TenantGate] check failed:", e);
    return {
      allowed: false,
      reason: "We couldn't verify your account status. Please try again shortly.",
      code: "gate_unavailable",
    };
  }
}

export async function getAuditGateStatus(companyId: string): Promise<{
  status: string;
  blocked: boolean;
  reason: string | null;
  code: string | null;
  details: Record<string, any>;
}> {
  const result = await checkTenantGate(companyId);
  return {
    status: result.allowed ? "ok" : "blocked",
    blocked: !result.allowed,
    reason: result.reason ?? null,
    code: result.code ?? null,
    details: result.details ?? {},
  };
}
