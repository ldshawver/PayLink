import { db } from "./db";
import { sql } from "drizzle-orm";

export type GateCode =
  | "trial_expired"
  | "past_due"
  | "grace_expired"
  | "suspended"
  | "cancelled"
  | "tenant_inactive"
  | "agreement_required";

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

    if (c.is_demo) return { allowed: true };

    const status = (c.subscription_status || "").toLowerCase();
    const now = new Date();

    if (status === "trial_active" || status === "trialing") {
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

    if (status === "active_paid" || status === "active") {
      return { allowed: true };
    }

    if (status === "grace") {
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

    return { allowed: true };
  } catch (e) {
    console.error("[TenantGate] check failed:", e);
    return { allowed: true };
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
