import { db } from "./db";
import { sql } from "drizzle-orm";
import { createContractorNotification } from "./contractor-notification-helper";

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
