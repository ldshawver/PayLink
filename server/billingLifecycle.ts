import { db } from "./db";
import { sql } from "drizzle-orm";
import {
  sendTenantLifecycleNotification,
  getCompanyOwnerInfo,
} from "./notifications/TenantNotificationService";
import { mirrorTenantStatusFromCompany } from "./tenant-context";
import { normalizeSubscriptionStatus } from "./subscription-status";
import { checkSubscriptionTransition } from "./tenant-gate-override";

const DEFAULT_GRACE_PERIOD_DAYS = 14;

async function findCompanyByStripeCustomerId(
  stripeCustomerId: string
): Promise<{ id: string; name: string; subscriptionStatus: string; gracePeriodDays: number } | null> {
  const result = await db.execute(sql`
    SELECT id, name, subscription_status, COALESCE(grace_period_days, 14) as grace_period_days
    FROM companies
    WHERE stripe_customer_id = ${stripeCustomerId}
    LIMIT 1
  `);
  const row = result.rows[0] as any;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    subscriptionStatus: row.subscription_status,
    gracePeriodDays: row.grace_period_days ?? DEFAULT_GRACE_PERIOD_DAYS,
  };
}

async function findCompanyByStripeSubscriptionId(
  subscriptionId: string
): Promise<{ id: string; name: string; subscriptionStatus: string; gracePeriodDays: number } | null> {
  const result = await db.execute(sql`
    SELECT id, name, subscription_status, COALESCE(grace_period_days, 14) as grace_period_days
    FROM companies
    WHERE stripe_subscription_id = ${subscriptionId}
    LIMIT 1
  `);
  const row = result.rows[0] as any;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    subscriptionStatus: row.subscription_status,
    gracePeriodDays: row.grace_period_days ?? DEFAULT_GRACE_PERIOD_DAYS,
  };
}

type Tx = { execute: (q: any) => Promise<{ rows: any[]; rowCount?: number | null }> };

// Lifecycle audit rows are written on the same transaction as the status
// change they describe (P0-E): if the insert fails, the change rolls back.
async function insertLifecycleAudit(
  tx: Tx,
  companyId: string,
  changeType: "lifecycle_transition" | "lifecycle_reactivation_refused",
  beforeValue: string,
  afterValue: string,
  note: string,
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO authorization_audit_log
      (actor_user_id, change_type, before_value, after_value, note, company_id, created_at)
    VALUES
      ('system', ${changeType}, ${beforeValue}, ${afterValue}, ${note}, ${companyId}, NOW())
  `);
}

async function lockCompany(tx: Tx, companyId: string): Promise<{ subscription_status: string | null; is_demo: boolean | null } | null> {
  const r = await tx.execute(sql`SELECT subscription_status, is_demo FROM companies WHERE id = ${companyId} FOR UPDATE`);
  return (r.rows[0] as any) ?? null;
}

/**
 * Every authorization_audit_log change_type that can set
 * companies.subscription_status to "suspended", and the suspension SOURCE it
 * records. A new suspension writer must write one of these (or be added
 * here); tests/admin-suspension-source.test.ts fails on an unaudited writer.
 */
export const SUSPENSION_SOURCE_BY_CHANGE_TYPE = {
  lifecycle_transition: "billing", // grace-period expiry, Stripe subscription.deleted (actor 'system')
  admin_suspension: "admin", // POST /api/provisioning/event tenant.suspended
  tenant_status_change: "admin", // PATCH /api/tenants/:id
  gate_override: "admin", // platform_super_admin gate override
  license_admin_update: "admin", // PUT /api/platform/companies/:id/license
} as const;

export type SuspensionSource = "billing" | "admin" | "unknown" | "unverifiable";

/**
 * Legacy provisioning suspensions are only recorded here. The table is in
 * shared/schema.ts but production deploys do not run drizzle push, so it can
 * be missing (it is on production as of v2.2.16).
 */
export const PROVISIONING_AUDIT_TABLE = "tenant_provisioning_audit_logs";

/**
 * Who applied the company's CURRENT suspension: the latest audit row that set
 * "suspended" decides. Pre-existing suspensions are classified from history
 * that already exists (no backfill):
 *   - latest row a system lifecycle_transition          → "billing"
 *   - latest row an admin change_type above             → "admin"
 *   - latest a legacy tenant_provisioning_audit_logs
 *     'tenant.suspended' row (provisioning suspensions
 *     written before they were audited here)            → "admin"
 *   - no trail at all                                   → "unknown"
 * If tenant_provisioning_audit_logs does not exist, a provisioning suspension
 * cannot be ruled out: an admin row still wins, anything else (including a
 * billing row) is "unverifiable". Missing history is never proof that a
 * payment may reinstate the tenant.
 * Only "billing" may be lifted by a Stripe payment; "admin", "unknown" and
 * "unverifiable" need an explicit, audited platform-administrator action.
 */
export async function getSuspensionSource(tx: Tx, companyId: string): Promise<SuspensionSource> {
  const types = Object.keys(SUSPENSION_SOURCE_BY_CHANGE_TYPE);
  const present = await tx.execute(sql`SELECT to_regclass(${`public.${PROVISIONING_AUDIT_TABLE}`}) IS NOT NULL AS present`);
  if ((present.rows[0] as any)?.present !== true) {
    const a = await tx.execute(sql`
      SELECT actor_user_id, change_type FROM authorization_audit_log
      WHERE company_id = ${companyId}
        AND after_value = 'suspended'
        AND change_type IN (${sql.join(types.map((t) => sql`${t}`), sql`, `)})
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const row = a.rows[0] as any;
    if (row && !(row.change_type === "lifecycle_transition" && row.actor_user_id === "system")) return "admin";
    console.warn(`[BillingLifecycle] ${PROVISIONING_AUDIT_TABLE} is missing; suspension source of company ${companyId} is unverifiable`);
    return "unverifiable";
  }
  const r = await tx.execute(sql`
    SELECT actor_user_id, change_type, created_at FROM authorization_audit_log
    WHERE company_id = ${companyId}
      AND after_value = 'suspended'
      AND change_type IN (${sql.join(types.map((t) => sql`${t}`), sql`, `)})
    UNION ALL
    SELECT triggered_by AS actor_user_id, 'legacy_provisioning_suspension' AS change_type, created_at FROM tenant_provisioning_audit_logs
    WHERE company_id = ${companyId} AND event_type = 'tenant.suspended' AND status = 'success'
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const row = r.rows[0] as any;
  if (!row) return "unknown";
  if (row.change_type === "lifecycle_transition") return row.actor_user_id === "system" ? "billing" : "admin";
  return "admin";
}

/** True only when the CURRENT suspension was applied by the billing lifecycle (P0-E). */
export async function wasSuspendedByBilling(tx: Tx, companyId: string): Promise<boolean> {
  return (await getSuspensionSource(tx, companyId)) === "billing";
}

/**
 * Stripe payment / subscription-active → restore access. Only a grace_period
 * company or a company suspended BY BILLING is restored; cancelled, demo and
 * administratively suspended companies are left unchanged and a
 * lifecycle_reactivation_refused audit row records the payment.
 */
async function reactivateFromBilling(companyId: string, note: string): Promise<boolean> {
  const outcome = await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Tx;
    const c = await lockCompany(tx, companyId);
    if (!c) return null;
    const status = normalizeSubscriptionStatus(c.subscription_status);
    let refused: string | null = null;
    if (status === "cancelled") refused = "tenant is cancelled; reinstatement requires a platform administrator";
    else if (status === "suspended") {
      const source = await getSuspensionSource(tx, companyId);
      if (source === "admin") refused = "tenant was suspended by a platform administrator";
      else if (source === "unverifiable") refused = `suspension source cannot be verified (${PROVISIONING_AUDIT_TABLE} is missing); reinstatement requires a platform administrator`;
      else if (source !== "billing") refused = "suspension has no billing audit trail; reinstatement requires a platform administrator";
    } else if (status !== "grace_period") return null;
    if (!refused) {
      const check = checkSubscriptionTransition(c.subscription_status, "active_paid", c.is_demo === true, { allowReinstatement: false });
      if (!check.ok) refused = check.message;
    }
    if (refused) {
      await insertLifecycleAudit(tx, companyId, "lifecycle_reactivation_refused", status, status, `${note} Not reactivated: ${refused}.`);
      return { reactivated: false as const, refused };
    }
    await tx.execute(sql`
      UPDATE companies
      SET subscription_status = 'active_paid',
          billing_active = TRUE,
          grace_period_end = NULL
      WHERE id = ${companyId}
    `);
    await insertLifecycleAudit(tx, companyId, "lifecycle_transition", c.subscription_status ?? "", "active_paid", `${note} Tenant reactivated.`);
    return { reactivated: true as const, isDemo: c.is_demo === true };
  });
  if (!outcome) return false;
  if (!outcome.reactivated) {
    console.log(`[BillingLifecycle] payment received but company ${companyId} NOT reactivated: ${outcome.refused}`);
    return false;
  }
  await mirrorTenantStatusFromCompany(companyId, "active_paid", outcome.isDemo);
  const ownerInfo = await getCompanyOwnerInfo(companyId);
  await sendTenantLifecycleNotification({
    companyId,
    companyName: ownerInfo.companyName,
    ownerEmail: ownerInfo.ownerEmail,
    ownerName: ownerInfo.ownerName,
    event: "tenant_reactivated",
  });
  return true;
}

export async function handleTenantBillingEvent(
  eventType: string,
  eventObject: Record<string, any>
): Promise<void> {
  if (eventType === "invoice.payment_failed") {
    const stripeCustomerId = eventObject.customer as string;
    if (!stripeCustomerId) return;

    let company = await findCompanyByStripeCustomerId(stripeCustomerId);
    if (!company) {
      await db.execute(sql`
        UPDATE companies SET stripe_customer_id = ${stripeCustomerId}
        WHERE stripe_customer_id IS NULL AND name IS NOT NULL LIMIT 0
      `);
      return;
    }

    const gracePeriodEnd = new Date();
    gracePeriodEnd.setDate(gracePeriodEnd.getDate() + company.gracePeriodDays);

    const prevStatus = company.subscriptionStatus;

    // grace_period grants access, so a suspended or cancelled tenant (either
    // spelling — see CANCELLED_SUBSCRIPTION_STATUS_SPELLINGS) must never be
    // moved into it by a payment failure. When the guard matches nothing,
    // stop: no mirror write, audit row or "grace period started" email.
    const moved = await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Tx;
      const graceResult = await tx.execute(sql`
        UPDATE companies
        SET subscription_status = 'grace_period',
            grace_period_end = ${gracePeriodEnd.toISOString()},
            billing_active = FALSE
        WHERE id = ${company!.id}
          AND subscription_status NOT IN ('suspended', 'cancelled', 'canceled')
      `);
      if (!graceResult.rowCount) return false;
      await insertLifecycleAudit(tx, company!.id, "lifecycle_transition", prevStatus, "grace_period",
        `Stripe invoice payment failed. Grace period until ${gracePeriodEnd.toISOString()}.`);
      return true;
    });
    if (!moved) {
      console.log(`[BillingLifecycle] payment_failed ignored for company ${company.id} (status ${prevStatus})`);
      return;
    }
    await mirrorTenantStatusFromCompany(company.id, "grace_period");

    const ownerInfo = await getCompanyOwnerInfo(company.id);
    await sendTenantLifecycleNotification({
      companyId: company.id,
      companyName: ownerInfo.companyName,
      ownerEmail: ownerInfo.ownerEmail,
      ownerName: ownerInfo.ownerName,
      event: "grace_period_started",
      gracePeriodEnd,
    });

    console.log(`[BillingLifecycle] payment_failed → grace_period for company ${company.id}`);
  }

  if (eventType === "invoice.payment_succeeded") {
    const stripeCustomerId = eventObject.customer as string;
    const subscriptionId = eventObject.subscription as string;
    if (!stripeCustomerId) return;

    const company = await findCompanyByStripeCustomerId(stripeCustomerId);
    if (!company) return;

    if (subscriptionId) {
      await db.execute(sql`
        UPDATE companies SET stripe_subscription_id = ${subscriptionId} WHERE id = ${company.id} AND stripe_subscription_id IS NULL
      `);
    }

    if (await reactivateFromBilling(company.id, "Payment succeeded.")) {
      console.log(`[BillingLifecycle] payment_succeeded → reactivated company ${company.id}`);
    }
  }

  if (eventType === "customer.subscription.deleted") {
    const stripeCustomerId = eventObject.customer as string;
    const subscriptionId = eventObject.id as string;
    if (!stripeCustomerId && !subscriptionId) return;

    let company = stripeCustomerId ? await findCompanyByStripeCustomerId(stripeCustomerId) : null;
    if (!company && subscriptionId) {
      company = await findCompanyByStripeSubscriptionId(subscriptionId);
    }
    if (!company) return;

    // A cancelled company stays cancelled (suspended is reactivatable by a
    // later payment), and an already-suspended company is left alone so an
    // administrative suspension is never relabelled as a billing one (P0-E).
    const target = company;
    const suspended = await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Tx;
      const c = await lockCompany(tx, target.id);
      if (!c) return null;
      const status = normalizeSubscriptionStatus(c.subscription_status);
      if (status === "cancelled" || status === "suspended") return null;
      await tx.execute(sql`
        UPDATE companies
        SET subscription_status = 'suspended',
            billing_active = FALSE,
            grace_period_end = NULL
        WHERE id = ${target.id}
      `);
      await insertLifecycleAudit(tx, target.id, "lifecycle_transition", c.subscription_status ?? "", "suspended", "Stripe subscription deleted. Tenant suspended.");
      return { isDemo: c.is_demo === true };
    });
    if (!suspended) {
      console.log(`[BillingLifecycle] subscription.deleted ignored for company ${company.id} (already suspended/cancelled)`);
      return;
    }
    await mirrorTenantStatusFromCompany(company.id, "suspended", suspended.isDemo);

    const ownerInfo = await getCompanyOwnerInfo(company.id);
    await sendTenantLifecycleNotification({
      companyId: company.id,
      companyName: ownerInfo.companyName,
      ownerEmail: ownerInfo.ownerEmail,
      ownerName: ownerInfo.ownerName,
      event: "tenant_suspended",
    });

    console.log(`[BillingLifecycle] subscription.deleted → suspended company ${company.id}`);
  }

  if (eventType === "customer.subscription.updated") {
    const subscriptionId = eventObject.id as string;
    const stripeCustomerId = eventObject.customer as string;
    const status = eventObject.status as string;

    let company = stripeCustomerId ? await findCompanyByStripeCustomerId(stripeCustomerId) : null;
    if (!company && subscriptionId) {
      company = await findCompanyByStripeSubscriptionId(subscriptionId);
    }
    if (!company) return;

    if (subscriptionId) {
      await db.execute(sql`
        UPDATE companies SET stripe_subscription_id = ${subscriptionId} WHERE id = ${company.id}
      `);
    }

    if (status === "active") {
      await reactivateFromBilling(company.id, "Stripe subscription updated to active.");
    }
  }
}

export async function checkAndSuspendExpiredGracePeriods(): Promise<number> {
  const expired = await db.execute(sql`
    SELECT id, name FROM companies
    WHERE subscription_status = 'grace_period'
      AND grace_period_end IS NOT NULL
      AND grace_period_end < NOW()
  `);

  let count = 0;
  for (const row of expired.rows as any[]) {
    const moved = await suspendExpiredGracePeriod(row.id);
    if (!moved) continue;
    await mirrorTenantStatusFromCompany(row.id, "suspended");

    const ownerInfo = await getCompanyOwnerInfo(row.id);
    await sendTenantLifecycleNotification({
      companyId: row.id,
      companyName: ownerInfo.companyName,
      ownerEmail: ownerInfo.ownerEmail,
      ownerName: ownerInfo.ownerName,
      event: "tenant_suspended",
    });

    console.log(`[BillingLifecycle] Grace period expired → suspended company ${row.id}`);
    count++;
  }

  return count;
}

/**
 * grace_period → suspended for one company whose grace period has ended,
 * with its lifecycle audit row on the same transaction. Shared by the
 * scheduled sweep and requireActiveSubscription so every billing suspension
 * is recognisable to wasSuspendedByBilling(). Returns false when the company
 * is no longer in an expired grace period.
 */
export async function suspendExpiredGracePeriod(companyId: string): Promise<boolean> {
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Tx;
    const r = await tx.execute(sql`
      UPDATE companies
      SET subscription_status = 'suspended',
          billing_active = FALSE
      WHERE id = ${companyId}
        AND subscription_status = 'grace_period'
        AND grace_period_end IS NOT NULL
        AND grace_period_end < NOW()
    `);
    if (!r.rowCount) return false;
    await insertLifecycleAudit(tx, companyId, "lifecycle_transition", "grace_period", "suspended", "Grace period expired. Tenant automatically suspended.");
    return true;
  });
}
