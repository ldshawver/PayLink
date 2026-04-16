import { db } from "./db.js";
import { sql } from "drizzle-orm";

export const SMS_HIGH_PRIORITY_EVENTS = new Set([
  "contract_signature_overdue",
  "invoice_overdue",
  "invoice_due",
  "signature_overdue",
  "payment_due",
  "reminder_overdue",
]);

export interface ContractorNotificationInput {
  workerId?: string | null;
  userId?: string | null;
  companyId?: string | null;
  notificationType: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  actionUrl?: string;
}

export async function createContractorNotification({
  workerId,
  userId,
  companyId,
  notificationType,
  title,
  body,
  entityType,
  entityId,
  actionUrl,
}: ContractorNotificationInput): Promise<void> {
  try {
    let effectiveCompanyId = companyId || null;
    let workerUserRecord: { id: string; email: string | null; phone: string | null; company_id: string; worker_name: string } | null = null;

    if (workerId) {
      // email and phone live on the workers table, not users
      const uRes = await db.execute(sql`
        SELECT u.id, u.company_id,
               COALESCE(w.email, w.work_email) AS email,
               COALESCE(w.mobile_phone, w.phone, w.work_phone) AS phone,
               w.first_name || ' ' || w.last_name AS worker_name
        FROM users u
        LEFT JOIN workers w ON w.id = u.worker_id
        WHERE u.worker_id = ${workerId} LIMIT 1
      `);
      const row = uRes.rows[0];
      if (row) {
        workerUserRecord = row as { id: string; email: string | null; phone: string | null; company_id: string; worker_name: string };
        effectiveCompanyId = effectiveCompanyId || workerUserRecord.company_id;
      }
    }

    let emailEnabled = false;
    let smsEnabled = false;
    if (effectiveCompanyId) {
      try {
        const settingsRes = await db.execute(sql`
          SELECT notification_rules FROM contractor_workflow_settings
          WHERE company_id = ${effectiveCompanyId} LIMIT 1
        `);
        const rules = (((settingsRes.rows[0] || {}) as Record<string, unknown>).notification_rules as Record<string, { email?: boolean; sms?: boolean }>) || {};
        const eventRules = rules[notificationType] || {};
        emailEnabled = eventRules.email === true;
        smsEnabled = eventRules.sms === true && SMS_HIGH_PRIORITY_EVENTS.has(notificationType);
      } catch (_) {}
    }

    if (userId) {
      // Targeted at a specific user by their user ID — insert one row
      await db.execute(sql`
        INSERT INTO contractor_notifications (worker_id, user_id, company_id, notification_type, title, body, entity_type, entity_id, action_url)
        VALUES (${workerId || null}, ${userId}, ${effectiveCompanyId}, ${notificationType}, ${title}, ${body || null}, ${entityType || null}, ${entityId || null}, ${actionUrl || null})
      `);
    } else if (workerId) {
      // Targeted at a specific worker — one row for that worker/user
      await db.execute(sql`
        INSERT INTO contractor_notifications (worker_id, user_id, company_id, notification_type, title, body, entity_type, entity_id, action_url)
        VALUES (${workerId}, ${workerUserRecord?.id || null}, ${effectiveCompanyId}, ${notificationType}, ${title}, ${body || null}, ${entityType || null}, ${entityId || null}, ${actionUrl || null})
      `);
      if ((emailEnabled || smsEnabled) && workerUserRecord) {
        try {
          const { sendGenericNotificationEmail, sendGenericNotificationSms } = await import("./notifications.js");
          if (emailEnabled && workerUserRecord.email) {
            sendGenericNotificationEmail({ recipientName: workerUserRecord.worker_name || "Contractor", email: workerUserRecord.email, title, body: body || "", actionUrl: actionUrl || "" }).catch(() => {});
          }
          if (smsEnabled && workerUserRecord.phone) {
            sendGenericNotificationSms({ phone: workerUserRecord.phone, title, body: body || "" }).catch(() => {});
          }
        } catch (_) {}
      }
    } else if (effectiveCompanyId) {
      // Company-scoped (admin/manager targeted): fan-out one row per recipient for read-state isolation
      // email/phone come from workers table via LEFT JOIN (admins without worker records get null email/phone)
      const admins = await db.execute(sql`
        SELECT u.id, u.username AS name,
               COALESCE(w.email, w.work_email) AS email,
               COALESCE(w.mobile_phone, w.phone, w.work_phone) AS phone
        FROM users u
        LEFT JOIN workers w ON w.id = u.worker_id
        WHERE u.company_id = ${effectiveCompanyId}
        AND u.role IN ('admin','manager','tenant_admin','tenant_owner') LIMIT 10
      `);
      const adminRows = admins.rows as Array<{ id: string; email: string | null; phone: string | null; name: string }>;
      for (const admin of adminRows) {
        await db.execute(sql`
          INSERT INTO contractor_notifications (worker_id, user_id, company_id, notification_type, title, body, entity_type, entity_id, action_url)
          VALUES (${null}, ${admin.id}, ${effectiveCompanyId}, ${notificationType}, ${title}, ${body || null}, ${entityType || null}, ${entityId || null}, ${actionUrl || null})
        `);
        if ((emailEnabled || smsEnabled) && (admin.email || admin.phone)) {
          try {
            const { sendGenericNotificationEmail, sendGenericNotificationSms } = await import("./notifications.js");
            if (emailEnabled && admin.email) {
              sendGenericNotificationEmail({ recipientName: admin.name || "Admin", email: admin.email, title, body: body || "", actionUrl: actionUrl || "" }).catch(() => {});
            }
            if (smsEnabled && admin.phone) {
              sendGenericNotificationSms({ phone: admin.phone, title, body: body || "" }).catch(() => {});
            }
          } catch (_) {}
        }
      }
    }
  } catch (e) {
    console.error("Failed to create contractor notification:", e);
  }
}
