import { db } from "./db";
import { sql } from "drizzle-orm";

/**
 * Runs the contractor reminder scheduler for all companies.
 * Creates contractor_reminder rows for overdue/due conditions.
 * Called periodically from server startup.
 */
export async function runContractorReminderScheduler(): Promise<{ created: number; errors: string[] }> {
  let created = 0;
  const errors: string[] = [];

  try {
    const companiesRes = await db.execute(sql`SELECT DISTINCT company_id FROM contractor_workflow_settings`);
    const allCompanies = (companiesRes.rows as Array<{ company_id: string }>).map(r => r.company_id);

    for (const cid of allCompanies) {
      try {
        const settingsRes = await db.execute(sql`SELECT * FROM contractor_workflow_settings WHERE company_id = ${cid}`);
        const settings = (settingsRes.rows[0] || {}) as Record<string, unknown>;
        const contractSigOverdueDays = (settings.contract_sig_overdue_days as number) ?? 7;
        const contractExpiryWarningDays = (settings.contract_expiry_warning_days as number) ?? 14;
        const invoiceDueReminderDays = (settings.invoice_due_reminder_days as number) ?? 3;
        const invoiceOverdueReminderDays = (settings.invoice_overdue_reminder_days as number) ?? 1;

        const now = new Date();

        // Contract signature overdue
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
            // Create notification for admins in this company
            await db.execute(sql`
              INSERT INTO contractor_notifications (user_id, company_id, notification_type, title, body, entity_type, entity_id, action_url)
              SELECT u.id, ${cid}, 'signature_overdue',
                ${"Signature Overdue: " + (c.title || c.contract_number)},
                'A contract has not been signed and is now overdue.',
                'contract', ${c.id}, ${"/app/contractor-hub?section=contracts&id=" + c.id}
              FROM users u WHERE u.company_id = ${cid} AND u.role IN ('admin','manager','tenant_admin','tenant_owner') LIMIT 10
            `);
            created++;
          }
        }

        // Contract expiring soon
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
            await db.execute(sql`
              INSERT INTO contractor_notifications (user_id, company_id, notification_type, title, body, entity_type, entity_id, action_url)
              SELECT u.id, ${cid}, 'contract_expiring',
                ${"Contract Expiring Soon: " + (c.title || c.contract_number)},
                ${"Contract expires on " + c.end_date + ". Review renewal or termination options."},
                'contract', ${c.id}, ${"/app/contractor-hub?section=contracts&id=" + c.id}
              FROM users u WHERE u.company_id = ${cid} AND u.role IN ('admin','manager','tenant_admin','tenant_owner') LIMIT 10
            `);
            created++;
          }
        }

        // Invoice due soon
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
            await db.execute(sql`
              INSERT INTO contractor_notifications (worker_id, user_id, company_id, notification_type, title, body, entity_type, entity_id, action_url)
              SELECT ${inv.contractor_id}, u.id, ${cid}, 'invoice_due',
                ${"Invoice Due Soon: #" + (inv.invoice_number || inv.id.slice(0, 8))},
                ${"Invoice is due on " + inv.due_date + ". Please ensure payment is arranged."},
                'invoice', ${inv.id}, ${"/app/contractor-hub?section=invoices&id=" + inv.id}
              FROM users u WHERE u.worker_id = ${inv.contractor_id} LIMIT 1
            `);
            created++;
          }
        }

        // Invoice overdue
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
            await db.execute(sql`
              INSERT INTO contractor_notifications (worker_id, user_id, company_id, notification_type, title, body, entity_type, entity_id, action_url)
              SELECT ${inv.contractor_id}, u.id, ${cid}, 'invoice_overdue',
                ${"Invoice Overdue: #" + (inv.invoice_number || inv.id.slice(0, 8))},
                ${"Invoice was due on " + inv.due_date + " and remains unpaid. Immediate follow-up required."},
                'invoice', ${inv.id}, ${"/app/contractor-hub?section=invoices&id=" + inv.id}
              FROM users u WHERE u.worker_id = ${inv.contractor_id} LIMIT 1
            `);
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
