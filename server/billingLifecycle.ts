import { db } from "./db";
import { sql } from "drizzle-orm";
import {
  sendTenantLifecycleNotification,
  getCompanyOwnerInfo,
} from "./notifications/TenantNotificationService";

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

async function logBillingAuditEvent(
  companyId: string,
  changeType: string,
  beforeValue: string,
  afterValue: string,
  note: string
): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO authorization_audit_log
        (actor_user_id, change_type, before_value, after_value, note, company_id, created_at)
      VALUES
        ('system', ${changeType}, ${beforeValue}, ${afterValue}, ${note}, ${companyId}, NOW())
    `);
  } catch (e) {
    console.error("[BillingLifecycle] Failed to write audit log:", e);
  }
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

    await db.execute(sql`
      UPDATE companies
      SET subscription_status = 'grace_period',
          grace_period_end = ${gracePeriodEnd.toISOString()},
          billing_active = FALSE
      WHERE id = ${company.id}
        AND subscription_status NOT IN ('suspended', 'canceled')
    `);

    await logBillingAuditEvent(
      company.id,
      "lifecycle_transition",
      prevStatus,
      "grace_period",
      `Stripe invoice payment failed. Grace period until ${gracePeriodEnd.toISOString()}.`
    );

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

    const wasSuspendedOrGrace = ["grace_period", "suspended"].includes(company.subscriptionStatus);

    if (subscriptionId) {
      await db.execute(sql`
        UPDATE companies SET stripe_subscription_id = ${subscriptionId} WHERE id = ${company.id} AND stripe_subscription_id IS NULL
      `);
    }

    if (wasSuspendedOrGrace) {
      const prevStatus = company.subscriptionStatus;
      await db.execute(sql`
        UPDATE companies
        SET subscription_status = 'active_paid',
            billing_active = TRUE,
            grace_period_end = NULL
        WHERE id = ${company.id}
      `);

      await logBillingAuditEvent(
        company.id,
        "lifecycle_transition",
        prevStatus,
        "active_paid",
        "Payment succeeded. Tenant reactivated."
      );

      const ownerInfo = await getCompanyOwnerInfo(company.id);
      await sendTenantLifecycleNotification({
        companyId: company.id,
        companyName: ownerInfo.companyName,
        ownerEmail: ownerInfo.ownerEmail,
        ownerName: ownerInfo.ownerName,
        event: "tenant_reactivated",
      });

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

    const prevStatus = company.subscriptionStatus;
    await db.execute(sql`
      UPDATE companies
      SET subscription_status = 'suspended',
          billing_active = FALSE,
          grace_period_end = NULL
      WHERE id = ${company.id}
    `);

    await logBillingAuditEvent(
      company.id,
      "lifecycle_transition",
      prevStatus,
      "suspended",
      "Stripe subscription deleted. Tenant suspended."
    );

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

    if (status === "active" && ["grace_period", "suspended"].includes(company.subscriptionStatus)) {
      const prevStatus = company.subscriptionStatus;
      await db.execute(sql`
        UPDATE companies
        SET subscription_status = 'active_paid',
            billing_active = TRUE,
            grace_period_end = NULL
        WHERE id = ${company.id}
      `);

      await logBillingAuditEvent(
        company.id,
        "lifecycle_transition",
        prevStatus,
        "active_paid",
        "Stripe subscription updated to active. Tenant reactivated."
      );

      const ownerInfo = await getCompanyOwnerInfo(company.id);
      await sendTenantLifecycleNotification({
        companyId: company.id,
        companyName: ownerInfo.companyName,
        ownerEmail: ownerInfo.ownerEmail,
        ownerName: ownerInfo.ownerName,
        event: "tenant_reactivated",
      });
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
    await db.execute(sql`
      UPDATE companies
      SET subscription_status = 'suspended',
          billing_active = FALSE
      WHERE id = ${row.id}
    `);

    await db.execute(sql`
      INSERT INTO authorization_audit_log
        (actor_user_id, change_type, before_value, after_value, note, company_id, created_at)
      VALUES
        ('system', 'lifecycle_transition', 'grace_period', 'suspended',
         'Grace period expired. Tenant automatically suspended.', ${row.id}, NOW())
    `);

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
