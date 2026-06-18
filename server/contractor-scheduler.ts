import { db } from "./db";
import { sql } from "drizzle-orm";
import { createContractorNotification } from "./contractor-notification-helper";

/** Send email to contractor and all admins for a scheduler-driven reminder event. */
async function sendSchedulerReminderEmails(
  cid: string,
  contractorId: string,
  title: string,
  body: string,
  actionUrl: string,
  entityType: string,
  entityId: string,
  templateKey: string
): Promise<void> {
  try {
    const { sendGenericNotificationEmail } = await import("./notifications.js");
    // Contractor email
    const contractorRes = await db.execute(sql`
      SELECT COALESCE(w.email, w.work_email) AS email,
             w.first_name || ' ' || w.last_name AS name
      FROM workers w WHERE w.id = ${contractorId} LIMIT 1
    `);
    const cw = contractorRes.rows[0] as { email: string | null; name: string } | undefined;
    if (cw?.email) {
      // Await send result so we only log status='sent' on actual delivery — keeps
      // the dedup window honest (failed sends remain eligible for retry next tick).
      // sendGenericNotificationEmail returns {sent:false, error} on SMTP/transport
      // failure WITHOUT throwing (e.g. SMTP not configured, transporter sendMail
      // rejection). It only throws on unexpected runtime errors. Treat both as
      // failure so the dedup window honestly reflects whether mail was delivered.
      let sendOk = true;
      try {
        const result = await sendGenericNotificationEmail({ recipientName: cw.name || "Contractor", email: cw.email, title, body, actionUrl });
        if (!result.sent) {
          sendOk = false;
          console.warn(`[ContractorScheduler] Contractor email not sent (${templateKey}/${entityId}): ${result.error || "unknown"}`);
        }
      } catch (sendErr) {
        sendOk = false;
        console.warn(`[ContractorScheduler] Contractor email send threw (${templateKey}/${entityId}):`, sendErr instanceof Error ? sendErr.message : String(sendErr));
      }
      await db.execute(sql`
        INSERT INTO contractor_reminder_logs (entity_type, entity_id, channel, recipient, template_key, subject, body, status)
        VALUES (${entityType}, ${entityId}, 'email', ${cw.email}, ${templateKey}, ${title}, ${body}, ${sendOk ? 'sent' : 'failed'})
      `);
    }
    // Admin/manager emails — broaden role filter to cover tenant role variants
    const adminRes = await db.execute(sql`
      SELECT u.id, COALESCE(w.email, w.work_email, u.email) AS email, u.username AS name
      FROM users u LEFT JOIN workers w ON w.id = u.worker_id
      WHERE u.company_id = ${cid}
        AND u.role IN ('admin','manager','tenant_admin','tenant_owner','tenant_manager','tenant_hr_admin','tenant_payroll_admin')
      LIMIT 5
    `);
    for (const admin of adminRes.rows as Array<{ id: string; email: string | null; name: string }>) {
      if (admin.email) {
        sendGenericNotificationEmail({ recipientName: admin.name || "Admin", email: admin.email, title, body, actionUrl }).catch(() => {});
      }
    }
  } catch (emailErr: unknown) {
    console.warn(`[ContractorScheduler] Email send failed for ${templateKey} on ${entityId}:`, emailErr instanceof Error ? emailErr.message : String(emailErr));
  }
}

/**
 * Runs the contractor reminder scheduler.
 * Creates contractor_reminder rows for overdue/due conditions and fires
 * createContractorNotification (which enforces notification_rules, email/SMS
 * toggles, and per-recipient isolation) for each reminder created.
 *
 * @param companyIds - Optional list of company IDs to process. If omitted, all
 *   companies with workflow settings are processed (used by the startup interval).
 *   Pass a single-element array to process one company (used by the admin route).
 */
export async function runContractorReminderScheduler(companyIds?: string[]): Promise<{ created: number; errors: string[] }> {
  let created = 0;
  const errors: string[] = [];

  try {
    let allCompanies: string[];
    if (companyIds && companyIds.length > 0) {
      allCompanies = companyIds;
    } else {
      const companiesRes = await db.execute(sql`SELECT DISTINCT company_id FROM contractor_workflow_settings`);
      allCompanies = (companiesRes.rows as Array<{ company_id: string }>).map(r => r.company_id);
    }

    for (const cid of allCompanies) {
      try {
        const settingsRes = await db.execute(sql`SELECT * FROM contractor_workflow_settings WHERE company_id = ${cid}`);
        const settings = (settingsRes.rows[0] || {}) as Record<string, unknown>;
        const contractSigOverdueDays = (settings.contract_sig_overdue_days as number) ?? 7;
        const contractExpiryWarningDays = (settings.contract_expiry_warning_days as number) ?? 14;
        const invoiceDueReminderDays = (settings.invoice_due_reminder_days as number) ?? 3;
        const invoiceOverdueReminderDays = (settings.invoice_overdue_reminder_days as number) ?? 1;

        const now = new Date();

        // ── Contract signature overdue ──────────────────────────────────────
        const sigOverdue = await db.execute(sql`
          SELECT id, contract_number, title, contractor_id FROM contractor_contracts
          WHERE company_id = ${cid} AND status IN ('sent','partially_signed') AND sent_at IS NOT NULL
          AND sent_at::timestamptz < NOW() - (${contractSigOverdueDays} * INTERVAL '1 day')
        `);
        for (const c of sigOverdue.rows as Array<{ id: string; contract_number: string; title: string; contractor_id: string }>) {
          const existing = await db.execute(sql`
            SELECT id FROM contractor_reminders
            WHERE entity_type = 'contract' AND entity_id = ${c.id} AND reminder_type = 'signature'
            AND (status = 'pending' OR (sent_at IS NOT NULL AND sent_at > NOW() - INTERVAL '24 hours'))
          `);
          if (!existing.rows.length) {
            await db.execute(sql`
              INSERT INTO contractor_reminders (worker_id, company_id, entity_type, entity_id, reminder_type, title, notes, scheduled_at, channel, status, sent_at)
              VALUES (${c.contractor_id}, ${cid}, 'contract', ${c.id}, 'signature',
                ${"Signature overdue: " + (c.title || c.contract_number || c.id)},
                'Contract signature is overdue. Follow up with the contractor.',
                ${now.toISOString()}, 'in_app', 'pending', NOW())
            `);
            await createContractorNotification({
              companyId: cid,
              notificationType: "signature_overdue",
              title: "Signature Overdue: " + (c.title || c.contract_number),
              body: "A contract has not been signed and is now overdue.",
              entityType: "contract",
              entityId: c.id,
              actionUrl: "/app/contractor-hub?section=contracts&id=" + c.id,
            });
            created++;
          }
        }



        // ── Configured contract signing reminders ─────────────────────────
        const configuredSigningReminders = await db.execute(sql`
          SELECT cr.*, cc.title AS contract_title, cc.contract_number, cc.status AS contract_status, cc.company_id AS contract_company_id
          FROM contractor_reminders cr
          JOIN contractor_contracts cc ON cc.id = cr.entity_id
          WHERE cr.company_id = ${cid}
            AND cr.entity_type = 'contract'
            AND cr.reminder_type = 'signing_request_config'
            AND cr.status = 'pending'
            AND cr.scheduled_at <= NOW()
            AND cc.status NOT IN ('fully_signed','completed','void','terminated')
        `);
        for (const reminder of configuredSigningReminders.rows as any[]) {
          let config: any = {};
          try { config = reminder.notes ? JSON.parse(reminder.notes) : {}; } catch { config = { message: reminder.notes || undefined }; }
          const frequencyDays = Number(config.frequencyDays || 7);
          const nextAt = new Date(Date.now() + Math.max(1, frequencyDays) * 86400000);
          const pendingSigners = await db.execute(sql`
            SELECT id, name, email, status FROM contract_signers
            WHERE contract_id = ${reminder.entity_id}
              AND status IN ('pending','sent','viewed','unsent')
              AND email IS NOT NULL
              ${config.selectedSignerId ? sql`AND id = ${config.selectedSignerId}` : sql``}
          `);
          const { sendGenericNotificationEmail } = await import("./notifications.js");
          let sentCount = 0;
          let lastError: string | null = null;
          for (const signer of pendingSigners.rows as any[]) {
            const actionUrl = `/app/contractor-hub?section=contracts&id=${reminder.entity_id}`;
            const subject = `Reminder: please sign ${reminder.contract_title || reminder.contract_number || "contract"}`;
            const body = config.message || "Please sign this contract when you have a moment.";
            try {
              const result = await sendGenericNotificationEmail({ recipientName: signer.name || "Signer", email: signer.email, title: subject, body, actionUrl });
              const ok = (result as any)?.sent !== false;
              if (ok) sentCount++; else lastError = (result as any)?.error || "email_not_sent";
              await db.execute(sql`INSERT INTO contractor_reminder_logs (entity_type, entity_id, channel, recipient, template_key, subject, body, status, error_message) VALUES ('contract', ${reminder.entity_id}, 'email', ${signer.email}, 'contract_signing_reminder', ${subject}, ${body}, ${ok ? "sent" : "failed"}, ${ok ? null : lastError})`).catch(() => {});
            } catch (err: any) {
              lastError = err?.message || "send_failed";
              await db.execute(sql`INSERT INTO contractor_reminder_logs (entity_type, entity_id, channel, recipient, template_key, subject, body, status, error_message) VALUES ('contract', ${reminder.entity_id}, 'email', ${signer.email}, 'contract_signing_reminder', ${subject}, ${body}, 'failed', ${lastError})`).catch(() => {});
            }
          }
          const retryCount = lastError ? Number(config.retryCount || 0) + 1 : 0;
          await db.execute(sql`
            UPDATE contractor_reminders
            SET sent_at = NOW(), scheduled_at = ${nextAt}, updated_at = NOW(), notes = ${JSON.stringify({ ...config, retryCount, lastError, lastSentCount: sentCount })}
            WHERE id = ${reminder.id}
          `);
          if (sentCount > 0) created += sentCount;
        }

        // ── Contract expiring soon ───────────────────────────────────────────
        const expiring = await db.execute(sql`
          SELECT id, contract_number, title, contractor_id, end_date FROM contractor_contracts
          WHERE company_id = ${cid} AND status IN ('active','fully_signed') AND end_date IS NOT NULL
          AND end_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + (${contractExpiryWarningDays} * INTERVAL '1 day')::interval
        `);
        for (const c of expiring.rows as Array<{ id: string; contract_number: string; title: string; contractor_id: string; end_date: string }>) {
          const existing = await db.execute(sql`
            SELECT id FROM contractor_reminders
            WHERE entity_type = 'contract' AND entity_id = ${c.id} AND reminder_type = 'expiry'
            AND (status = 'pending' OR (sent_at IS NOT NULL AND sent_at > NOW() - INTERVAL '24 hours'))
          `);
          if (!existing.rows.length) {
            await db.execute(sql`
              INSERT INTO contractor_reminders (worker_id, company_id, entity_type, entity_id, reminder_type, title, notes, scheduled_at, channel, status, sent_at)
              VALUES (${c.contractor_id}, ${cid}, 'contract', ${c.id}, 'expiry',
                ${"Contract expiring soon: " + (c.title || c.contract_number || c.id)},
                ${"Contract expires on " + c.end_date},
                ${now.toISOString()}, 'in_app', 'pending', NOW())
            `);
            await createContractorNotification({
              companyId: cid,
              notificationType: "contract_expiring",
              title: "Contract Expiring Soon: " + (c.title || c.contract_number),
              body: "Contract expires on " + c.end_date + ". Review renewal or termination options.",
              entityType: "contract",
              entityId: c.id,
              actionUrl: "/app/contractor-hub?section=contracts&id=" + c.id,
            });
            created++;
          }
        }

        // ── Invoice due soon ────────────────────────────────────────────────
        const invoicesDue = await db.execute(sql`
          SELECT ci.id, ci.invoice_number, ci.contractor_id, ci.due_date FROM contractor_invoices ci
          WHERE ci.company_id = ${cid} AND ci.status NOT IN ('paid','void','cancelled')
          AND ci.due_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + (${invoiceDueReminderDays} * INTERVAL '1 day')::interval
        `);
        for (const inv of invoicesDue.rows as Array<{ id: string; invoice_number: string; contractor_id: string; due_date: string }>) {
          const existing = await db.execute(sql`
            SELECT id FROM contractor_reminders
            WHERE entity_type = 'invoice' AND entity_id = ${inv.id} AND reminder_type = 'payment'
            AND (status = 'pending' OR (sent_at IS NOT NULL AND sent_at > NOW() - INTERVAL '24 hours'))
          `);
          if (!existing.rows.length) {
            await db.execute(sql`
              INSERT INTO contractor_reminders (worker_id, company_id, entity_type, entity_id, reminder_type, title, notes, scheduled_at, channel, status, sent_at)
              VALUES (${inv.contractor_id}, ${cid}, 'invoice', ${inv.id}, 'payment',
                ${"Invoice due soon: #" + (inv.invoice_number || inv.id.slice(0, 8))},
                ${"Due on " + inv.due_date},
                ${now.toISOString()}, 'in_app', 'pending', NOW())
            `);
            await createContractorNotification({
              workerId: inv.contractor_id,
              companyId: cid,
              notificationType: "invoice_due",
              title: "Invoice Due Soon: #" + (inv.invoice_number || inv.id.slice(0, 8)),
              body: "Invoice is due on " + inv.due_date + ". Please ensure payment is arranged.",
              entityType: "invoice",
              entityId: inv.id,
              actionUrl: "/app/contractor-hub?section=invoices&id=" + inv.id,
            });
            created++;
          }
        }

        // ── Invoice overdue ─────────────────────────────────────────────────
        const invoicesOverdue = await db.execute(sql`
          SELECT ci.id, ci.invoice_number, ci.contractor_id, ci.due_date FROM contractor_invoices ci
          WHERE ci.company_id = ${cid} AND ci.status NOT IN ('paid','void','cancelled')
          AND ci.due_date::date < CURRENT_DATE - (${invoiceOverdueReminderDays} * INTERVAL '1 day')::interval
        `);
        for (const inv of invoicesOverdue.rows as Array<{ id: string; invoice_number: string; contractor_id: string; due_date: string }>) {
          const existing = await db.execute(sql`
            SELECT id FROM contractor_reminders
            WHERE entity_type = 'invoice' AND entity_id = ${inv.id} AND reminder_type = 'follow_up'
            AND (status = 'pending' OR (sent_at IS NOT NULL AND sent_at > NOW() - INTERVAL '24 hours'))
          `);
          if (!existing.rows.length) {
            await db.execute(sql`
              INSERT INTO contractor_reminders (worker_id, company_id, entity_type, entity_id, reminder_type, title, notes, scheduled_at, channel, status, sent_at)
              VALUES (${inv.contractor_id}, ${cid}, 'invoice', ${inv.id}, 'follow_up',
                ${"Invoice overdue: #" + (inv.invoice_number || inv.id.slice(0, 8))},
                ${"Was due on " + inv.due_date},
                ${now.toISOString()}, 'in_app', 'pending', NOW())
            `);
            await createContractorNotification({
              workerId: inv.contractor_id,
              companyId: cid,
              notificationType: "invoice_overdue",
              title: "Invoice Overdue: #" + (inv.invoice_number || inv.id.slice(0, 8)),
              body: "Invoice was due on " + inv.due_date + " and remains unpaid. Immediate follow-up required.",
              entityType: "invoice",
              entityId: inv.id,
              actionUrl: "/app/contractor-hub?section=invoices&id=" + inv.id,
            });
            created++;
          }
        }
        // ── Contract renewal warning ──────────────────────────────────────────
        const renewalWarningDays = (settings.contract_renewal_warning_days as number) ?? 30;
        const renewalContracts = await db.execute(sql`
          SELECT id, contract_number, title, contractor_id, end_date FROM contractor_contracts
          WHERE company_id = ${cid} AND status IN ('active','fully_signed') AND end_date IS NOT NULL
          AND end_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + (${renewalWarningDays} * INTERVAL '1 day')::interval
        `);
        for (const c of renewalContracts.rows as Array<{ id: string; contract_number: string; title: string; contractor_id: string; end_date: string }>) {
          const existing = await db.execute(sql`
            SELECT id FROM contractor_reminder_logs
            WHERE entity_type = 'contract' AND entity_id = ${c.id} AND template_key = 'renewal'
            AND status = 'sent'
            AND sent_at > NOW() - INTERVAL '24 hours'
          `);
          if (!existing.rows.length) {
            await db.execute(sql`
              INSERT INTO contractor_reminders (worker_id, company_id, entity_type, entity_id, reminder_type, title, notes, scheduled_at, channel, status, sent_at)
              VALUES (${c.contractor_id}, ${cid}, 'contract', ${c.id}, 'renewal',
                ${"Renewal upcoming: " + (c.title || c.contract_number || c.id)},
                ${"Contract ends on " + c.end_date + ". Consider renewing or initiating renegotiation."},
                ${now.toISOString()}, 'in_app', 'pending', NOW())
            `);
            const renewalTitle = "Contract Renewal: " + (c.title || c.contract_number);
            const renewalBody = "Contract ends on " + c.end_date + ". Review renewal or renegotiation options.";
            const renewalUrl = "/app/contractor-hub?section=contracts&id=" + c.id;
            // Notify contractor and admins separately
            await createContractorNotification({
              workerId: c.contractor_id,
              notificationType: "contract_renewal_warning",
              title: renewalTitle,
              body: renewalBody,
              entityType: "contract",
              entityId: c.id,
              actionUrl: renewalUrl,
            });
            await createContractorNotification({
              companyId: cid,
              notificationType: "contract_renewal_warning",
              title: renewalTitle,
              body: renewalBody,
              entityType: "contract",
              entityId: c.id,
              actionUrl: renewalUrl,
            });
            await db.execute(sql`
              INSERT INTO contractor_reminder_logs (entity_type, entity_id, channel, recipient, template_key, subject, body, status)
              VALUES ('contract', ${c.id}, 'in_app', ${c.contractor_id}, 'renewal', ${renewalTitle}, ${renewalBody}, 'sent')
            `);
            await sendSchedulerReminderEmails(cid, c.contractor_id, renewalTitle, renewalBody, renewalUrl, 'contract', c.id, 'renewal');
            created++;
          }
        }

        // ── Renegotiation follow-up ───────────────────────────────────────────
        const renegotiationWarningDays = (settings.contract_renegotiation_warning_days as number) ?? 7;
        const renegotiationContracts = await db.execute(sql`
          SELECT id, contract_number, title, contractor_id FROM contractor_contracts
          WHERE company_id = ${cid} AND status = 'renegotiation'
          AND updated_at::timestamptz < NOW() - (${renegotiationWarningDays} * INTERVAL '1 day')
        `);
        for (const c of renegotiationContracts.rows as Array<{ id: string; contract_number: string; title: string; contractor_id: string }>) {
          const existing = await db.execute(sql`
            SELECT id FROM contractor_reminder_logs
            WHERE entity_type = 'contract' AND entity_id = ${c.id} AND template_key = 'renegotiation'
            AND status = 'sent'
            AND sent_at > NOW() - INTERVAL '24 hours'
          `);
          if (!existing.rows.length) {
            await db.execute(sql`
              INSERT INTO contractor_reminders (worker_id, company_id, entity_type, entity_id, reminder_type, title, notes, scheduled_at, channel, status, sent_at)
              VALUES (${c.contractor_id}, ${cid}, 'contract', ${c.id}, 'renegotiation',
                ${"Renegotiation stalled: " + (c.title || c.contract_number || c.id)},
                ${"This contract has been in renegotiation for more than " + renegotiationWarningDays + " days without an update."},
                ${now.toISOString()}, 'in_app', 'pending', NOW())
            `);
            const renegTitle = "Renegotiation Follow-up: " + (c.title || c.contract_number);
            const renegBody = "This contract has been in renegotiation for more than " + renegotiationWarningDays + " days. Please take action.";
            const renegUrl = "/app/contractor-hub?section=contracts&id=" + c.id;
            // Notify contractor and admins separately
            await createContractorNotification({
              workerId: c.contractor_id,
              notificationType: "contract_renegotiation_reminder",
              title: renegTitle,
              body: renegBody,
              entityType: "contract",
              entityId: c.id,
              actionUrl: renegUrl,
            });
            await createContractorNotification({
              companyId: cid,
              notificationType: "contract_renegotiation_reminder",
              title: renegTitle,
              body: renegBody,
              entityType: "contract",
              entityId: c.id,
              actionUrl: renegUrl,
            });
            await db.execute(sql`
              INSERT INTO contractor_reminder_logs (entity_type, entity_id, channel, recipient, template_key, subject, body, status)
              VALUES ('contract', ${c.id}, 'in_app', ${c.contractor_id}, 'renegotiation', ${renegTitle}, ${renegBody}, 'sent')
            `);
            await sendSchedulerReminderEmails(cid, c.contractor_id, renegTitle, renegBody, renegUrl, 'contract', c.id, 'renegotiation');
            created++;
          }
        }

        // ── Mark expired contracts ─────────────────────────────────────────────
        const expiredContracts = await db.execute(sql`
          SELECT id, contract_number, title, contractor_id FROM contractor_contracts
          WHERE company_id = ${cid} AND status IN ('active','fully_signed') AND end_date IS NOT NULL
          AND end_date::date < CURRENT_DATE
        `);
        for (const c of expiredContracts.rows as Array<{ id: string; contract_number: string; title: string; contractor_id: string }>) {
          await db.execute(sql`
            UPDATE contractor_contracts SET status = 'expired', updated_at = NOW() WHERE id = ${c.id}
          `);
          const existing = await db.execute(sql`
            SELECT id FROM contractor_reminder_logs
            WHERE entity_type = 'contract' AND entity_id = ${c.id} AND template_key = 'expired'
            AND status = 'sent'
            AND sent_at > NOW() - INTERVAL '24 hours'
          `);
          if (!existing.rows.length) {
            const expiredTitle = "Contract Expired: " + (c.title || c.contract_number);
            const expiredBody = "This contract has expired. Please review and initiate renewal or close out.";
            const expiredUrl = "/app/contractor-hub?section=contracts&id=" + c.id;
            // Notify contractor and admins separately
            await createContractorNotification({
              workerId: c.contractor_id,
              notificationType: "contract_expired",
              title: expiredTitle,
              body: expiredBody,
              entityType: "contract",
              entityId: c.id,
              actionUrl: expiredUrl,
            });
            await createContractorNotification({
              companyId: cid,
              notificationType: "contract_expired",
              title: expiredTitle,
              body: expiredBody,
              entityType: "contract",
              entityId: c.id,
              actionUrl: expiredUrl,
            });
            await db.execute(sql`
              INSERT INTO contractor_reminder_logs (entity_type, entity_id, channel, recipient, template_key, subject, body, status)
              VALUES ('contract', ${c.id}, 'in_app', ${c.contractor_id}, 'expired', ${expiredTitle}, ${expiredBody}, 'sent')
            `);
            await sendSchedulerReminderEmails(cid, c.contractor_id, expiredTitle, expiredBody, expiredUrl, 'contract', c.id, 'expired');
            created++;
          }
        }

      } catch (companyErr: unknown) {
        const msg = companyErr instanceof Error ? companyErr.message : String(companyErr);
        errors.push(`Company ${cid}: ${msg}`);
      }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Scheduler error: ${msg}`);
  }

  if (created > 0 || errors.length > 0) {
    console.log(`[ContractorScheduler] Created ${created} reminders/notifications. Errors: ${errors.length}`);
    if (errors.length > 0) {
      errors.forEach(e => console.warn("[ContractorScheduler]", e));
    }
  }
  return { created, errors };
}
