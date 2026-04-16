import { db } from "../db";
import { sql } from "drizzle-orm";
import { getTransporter } from "../notifications";

export type TenantLifecycleEvent =
  | "payment_failed"
  | "grace_period_started"
  | "grace_period_warning"
  | "tenant_suspended"
  | "tenant_reactivated"
  | "subscription_cancelled";

export interface TenantNotificationPayload {
  companyId: string;
  companyName: string;
  ownerEmail?: string | null;
  ownerName?: string | null;
  event: TenantLifecycleEvent;
  gracePeriodEnd?: Date | null;
  metadata?: Record<string, unknown>;
}

function buildEmailContent(payload: TenantNotificationPayload): {
  subject: string;
  text: string;
  html: string;
} {
  const name = payload.ownerName || "Account Owner";
  const company = payload.companyName;

  const graceDateStr = payload.gracePeriodEnd
    ? payload.gracePeriodEnd.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "";

  switch (payload.event) {
    case "payment_failed":
    case "grace_period_started": {
      const subject = `Action Required: Payment Failed for ${company}`;
      const text = `Hi ${name},\n\nWe were unable to process your most recent subscription payment for ${company}.\n\nYour account has entered a grace period. To avoid service interruption, please update your payment method before ${graceDateStr}.\n\nLog in to your billing page to resolve this: https://app.mypaylink.app/app/billing\n\nIf you have questions, reply to this email.\n\nThank you,\nPayLink Team`;
      const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <div style="background:linear-gradient(135deg,#dc2626,#b91c1c);padding:20px;border-radius:8px 8px 0 0;">
    <h1 style="color:white;margin:0;font-size:22px;">⚠️ Payment Failed</h1>
    <p style="color:rgba(255,255,255,0.85);margin:4px 0 0;">${company}</p>
  </div>
  <div style="background:#f9fafb;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none;">
    <p style="font-size:16px;color:#111827;">Hi <strong>${name}</strong>,</p>
    <p style="color:#374151;">We were unable to process your most recent subscription payment.</p>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:16px;margin:16px 0;">
      <p style="color:#991b1b;margin:0;font-weight:bold;">Your account is in a grace period until <strong>${graceDateStr}</strong>.</p>
      <p style="color:#991b1b;margin:8px 0 0;">Please update your payment method to avoid service suspension.</p>
    </div>
    <a href="https://app.mypaylink.app/app/billing" style="display:inline-block;background:#2563eb;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;margin-top:8px;">Update Payment Method</a>
  </div>
</div>`;
      return { subject, text, html };
    }

    case "grace_period_warning": {
      const subject = `Urgent: Your ${company} account will be suspended soon`;
      const text = `Hi ${name},\n\nThis is a final reminder that your ${company} account will be suspended on ${graceDateStr} if your payment issue is not resolved.\n\nPlease update your payment information immediately: https://app.mypaylink.app/app/billing\n\nThank you,\nPayLink Team`;
      const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <div style="background:linear-gradient(135deg,#d97706,#b45309);padding:20px;border-radius:8px 8px 0 0;">
    <h1 style="color:white;margin:0;font-size:22px;">🚨 Final Warning</h1>
    <p style="color:rgba(255,255,255,0.85);margin:4px 0 0;">${company}</p>
  </div>
  <div style="background:#f9fafb;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none;">
    <p style="font-size:16px;color:#111827;">Hi <strong>${name}</strong>,</p>
    <p style="color:#374151;">Your account will be <strong>suspended on ${graceDateStr}</strong> unless your payment is resolved.</p>
    <a href="https://app.mypaylink.app/app/billing" style="display:inline-block;background:#d97706;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;margin-top:8px;">Resolve Payment Now</a>
  </div>
</div>`;
      return { subject, text, html };
    }

    case "tenant_suspended": {
      const subject = `Your ${company} account has been suspended`;
      const text = `Hi ${name},\n\nYour ${company} account has been suspended due to an unresolved payment issue. Access to the platform has been disabled.\n\nTo restore access, please update your payment method: https://app.mypaylink.app/app/billing\n\nThank you,\nPayLink Team`;
      const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <div style="background:linear-gradient(135deg,#6b7280,#4b5563);padding:20px;border-radius:8px 8px 0 0;">
    <h1 style="color:white;margin:0;font-size:22px;">Account Suspended</h1>
    <p style="color:rgba(255,255,255,0.85);margin:4px 0 0;">${company}</p>
  </div>
  <div style="background:#f9fafb;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none;">
    <p style="font-size:16px;color:#111827;">Hi <strong>${name}</strong>,</p>
    <p style="color:#374151;">Your account has been suspended. All access to the platform is temporarily disabled.</p>
    <p style="color:#374151;">To restore access, please update your payment method.</p>
    <a href="https://app.mypaylink.app/app/billing" style="display:inline-block;background:#2563eb;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;margin-top:8px;">Restore Access</a>
  </div>
</div>`;
      return { subject, text, html };
    }

    case "tenant_reactivated": {
      const subject = `Great news! Your ${company} account is active again`;
      const text = `Hi ${name},\n\nYour payment was processed successfully and your ${company} account has been fully reactivated. You can now access all platform features.\n\nVisit your dashboard: https://app.mypaylink.app/app\n\nThank you,\nPayLink Team`;
      const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <div style="background:linear-gradient(135deg,#059669,#047857);padding:20px;border-radius:8px 8px 0 0;">
    <h1 style="color:white;margin:0;font-size:22px;">✅ Account Reactivated</h1>
    <p style="color:rgba(255,255,255,0.85);margin:4px 0 0;">${company}</p>
  </div>
  <div style="background:#f9fafb;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none;">
    <p style="font-size:16px;color:#111827;">Hi <strong>${name}</strong>,</p>
    <p style="color:#374151;">Great news! Your payment was successful and your account is now fully active.</p>
    <a href="https://app.mypaylink.app/app" style="display:inline-block;background:#059669;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;margin-top:8px;">Go to Dashboard</a>
  </div>
</div>`;
      return { subject, text, html };
    }

    case "subscription_cancelled": {
      const subject = `Your ${company} subscription has been cancelled`;
      const text = `Hi ${name},\n\nYour subscription for ${company} has been cancelled. Your account will remain accessible until the end of the current billing period.\n\nIf you believe this is an error or would like to resubscribe, please contact support.\n\nThank you,\nPayLink Team`;
      const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <div style="background:linear-gradient(135deg,#6b7280,#4b5563);padding:20px;border-radius:8px 8px 0 0;">
    <h1 style="color:white;margin:0;font-size:22px;">Subscription Cancelled</h1>
    <p style="color:rgba(255,255,255,0.85);margin:4px 0 0;">${company}</p>
  </div>
  <div style="background:#f9fafb;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none;">
    <p style="font-size:16px;color:#111827;">Hi <strong>${name}</strong>,</p>
    <p style="color:#374151;">Your subscription has been cancelled. You will retain access through the end of the current billing period.</p>
  </div>
</div>`;
      return { subject, text, html };
    }
  }
}

async function createInAppNotification(
  companyId: string,
  event: TenantLifecycleEvent,
  message: string
): Promise<void> {
  try {
    const adminUsers = await db.execute(sql`
      SELECT id FROM users WHERE company_id = ${companyId} AND role = 'admin' AND is_active = TRUE LIMIT 5
    `);
    for (const u of adminUsers.rows) {
      await db.execute(sql`
        INSERT INTO notifications (user_id, company_id, type, title, message, is_read, created_at)
        VALUES (${(u as any).id}, ${companyId}, ${event}, 'Billing Alert', ${message}, FALSE, NOW())
        ON CONFLICT DO NOTHING
      `);
    }
  } catch (e) {
    console.warn("[TenantNotification] Failed to create in-app notification:", e);
  }
}

export async function sendTenantLifecycleNotification(
  payload: TenantNotificationPayload
): Promise<{ emailSent: boolean; inAppSent: boolean }> {
  let emailSent = false;
  let inAppSent = false;

  const { subject, text, html } = buildEmailContent(payload);

  await createInAppNotification(payload.companyId, payload.event, text.split("\n\n")[1] || text).catch(() => {});
  inAppSent = true;

  if (payload.ownerEmail) {
    try {
      const smtp = await getTransporter();
      if (smtp) {
        await smtp.transporter.sendMail({
          from: smtp.fromAddress,
          to: payload.ownerEmail,
          subject,
          text,
          html,
        });
        emailSent = true;
      } else {
        console.warn("[TenantNotification] SMTP not configured, skipping email for", payload.companyName);
      }
    } catch (e) {
      console.error("[TenantNotification] Failed to send email:", e);
    }
  }

  console.log(`[TenantNotification] ${payload.event} for ${payload.companyName} — email:${emailSent} in-app:${inAppSent}`);
  return { emailSent, inAppSent };
}

export async function getCompanyOwnerInfo(companyId: string): Promise<{
  companyName: string;
  ownerEmail?: string | null;
  ownerName?: string | null;
}> {
  try {
    const companyResult = await db.execute(sql`SELECT name FROM companies WHERE id = ${companyId}`);
    const company = companyResult.rows[0] as any;
    const companyName = company?.name || "Unknown Company";

    const ownerResult = await db.execute(sql`
      SELECT u.id, u.username, w.first_name, w.last_name, w.work_email, w.email
      FROM users u
      LEFT JOIN workers w ON w.id = u.worker_id
      WHERE u.company_id = ${companyId} AND u.role = 'admin' AND u.is_active = TRUE
      ORDER BY u.created_at ASC LIMIT 1
    `);
    const owner = ownerResult.rows[0] as any;
    const ownerEmail = owner?.work_email || owner?.email || null;
    const ownerName = owner?.first_name && owner?.last_name
      ? `${owner.first_name} ${owner.last_name}`
      : owner?.username || null;

    return { companyName, ownerEmail, ownerName };
  } catch (e) {
    console.error("[TenantNotification] Failed to get owner info:", e);
    return { companyName: "Unknown Company" };
  }
}
