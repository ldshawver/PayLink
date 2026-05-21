/**
 * Worker Orchestrator — single controlled entrypoint for all background jobs.
 *
 * Rules:
 *   - Only ONE instance of this module runs per process (imported by server/index.ts).
 *   - Every background job is registered here. No scattered setInterval calls elsewhere.
 *   - Jobs that are not yet implemented are DEFINED but NOT SCHEDULED (commented-out
 *     scheduleJob calls). Wire them when the real implementation exists.
 *   - shutdownOrchestrator() clears every timer — call it on SIGTERM / SIGINT.
 */

import { runContractorReminderScheduler } from "../contractor-scheduler";
import { db } from "../db";
import { sql } from "drizzle-orm";

const DAY_MS   = 24 * 60 * 60 * 1000;
const HOUR_MS  = 60 * 60 * 1000;
const MIN_MS   = 60 * 1000;

interface JobHandle {
  name:     string;
  interval: NodeJS.Timeout;
}

const activeJobs:    JobHandle[]       = [];
const pendingTimers: NodeJS.Timeout[]  = [];
let   orchestratorStarted              = false;

function scheduleJob(
  name:           string,
  handler:        () => Promise<void>,
  intervalMs:     number,
  initialDelayMs: number = 0,
): void {
  // Per-job overlap guard: if a previous invocation is still running when the
  // next interval fires (e.g. contractor reminders doing many DB writes), skip
  // the new invocation rather than running both concurrently and doubling work.
  let isRunning = false;

  const run = () => {
    if (isRunning) {
      console.warn(`[Orchestrator][${name}] Previous run still in progress — skipping interval.`);
      return;
    }
    isRunning = true;
    handler()
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[Orchestrator][${name}] Error: ${msg}`);
      })
      .finally(() => { isRunning = false; });
  };

  const startJob = () => {
    run();
    const handle = setInterval(run, intervalMs);
    activeJobs.push({ name, interval: handle });
  };

  if (initialDelayMs > 0) {
    const t = setTimeout(startJob, initialDelayMs);
    pendingTimers.push(t);
  } else {
    startJob();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVE JOBS — these run on every startup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Contractor Reminders
 * Checks all companies for overdue contract signatures, expiring contracts,
 * and unpaid invoices. Creates in-app reminders and sends email notifications.
 * Deduplication: the scheduler itself prevents duplicate reminders within 24h.
 */
async function jobContractorReminders(): Promise<void> {
  const { created, errors } = await runContractorReminderScheduler();
  if (created > 0 || errors.length > 0) {
    console.log(`[Orchestrator][ContractorReminders] created=${created} errors=${errors.length}`);
  }
}

/**
 * Demo Tenant Cleanup
 * Removes ephemeral demo companies created by POST /api/demo/provision once
 * their trial_end has passed (with a 2-hour grace window so active sessions
 * can still finish). Protects named canonical demo companies from deletion.
 *
 * Safety guard: only deletes rows where:
 *   - is_demo = TRUE
 *   - trial_end IS NOT NULL (the singleton /api/demo/login company has no trial_end)
 *   - trial_end < NOW() - 2 hours
 *   - name is not one of the protected canonical names
 */
async function jobDemoCleanup(): Promise<void> {
  const result = await db.execute(sql`
    DELETE FROM companies
    WHERE  is_demo    = TRUE
      AND  trial_end  IS NOT NULL
      AND  trial_end  < NOW() - INTERVAL '2 hours'
      AND  name NOT IN ('Demo Corp', '__demo_provision__')
  `);
  const deleted = (result as any).rowCount ?? 0;
  if (deleted > 0) {
    console.log(`[Orchestrator][DemoCleanup] Removed ${deleted} expired demo tenant(s).`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STUB JOBS — defined but NOT yet scheduled.
// Uncomment the scheduleJob() call when the real implementation is ready.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Payroll Reminders (stub)
 * Future: query upcoming pay period end dates and send processing reminders
 * to tenant payroll admins so runs are not missed.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function jobPayrollReminders(): Promise<void> {
  // stub — implement when payroll reminder preference table is wired
}

/**
 * Notification Dispatch (stub)
 * Future: drain a notifications outbox table and send pending in-app,
 * email, and push notifications in batches.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function jobNotificationDispatch(): Promise<void> {
  // stub — implement when notifications outbox queue is wired
}

/**
 * Email Retry (stub)
 * Future: retry failed outbound emails that were logged to an email_outbox
 * table with status = 'failed' and retry_count < MAX_RETRIES.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function jobEmailRetry(): Promise<void> {
  // stub — implement when email outbox table is wired
}

/**
 * SMS Retry (stub)
 * Future: retry failed outbound SMS messages from an sms_outbox table.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function jobSmsRetry(): Promise<void> {
  // stub — implement when SMS outbox table is wired
}

/**
 * AI / Report Generation (stub)
 * Future: dequeue scheduled AI report jobs (e.g. weekly labor summaries,
 * automated payroll anomaly detection) from a job queue table.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function jobAiReportGeneration(): Promise<void> {
  // stub — implement when AI job queue table is wired
}

/**
 * Document Retention Cleanup
 * Runs daily: finds draft/rejected DAM documents older than each tenant's
 * configured retention period and marks them as archived (unless legal_hold=true).
 * Only operates when the tenant's auto_archive_enabled flag is true.
 * Never physically deletes — sets status='archived' + archived_at timestamp.
 */
async function jobDocumentRetentionCleanup(): Promise<void> {
  try {
    const { db } = await import("../db.js");
    const { sql } = await import("drizzle-orm");

    const policies = await db.execute(sql`
      SELECT * FROM tenant_data_retention_policies WHERE auto_archive_enabled = TRUE
    `);
    const rows = (policies as any).rows ?? policies;
    let totalArchived = 0;

    for (const policy of rows as any[]) {
      const companyId = policy.tenant_id;
      const cutoffFn = (days: number) => `NOW() - INTERVAL '${days} days'`;

      const archiveGroup = async (linkedType: string, retentionDays: number) => {
        const result = await db.execute(sql`
          UPDATE dam_documents
          SET status = 'archived', archived_at = NOW()
          WHERE company_id = ${companyId}
            AND linked_entity_type = ${linkedType}
            AND status IN ('draft', 'rejected', 'superseded')
            AND legal_hold = FALSE
            AND created_at < ${sql.raw(cutoffFn(retentionDays))}
          RETURNING id
        `);
        return ((result as any).rows ?? []).length;
      };

      totalArchived += await archiveGroup("proposal", policy.draft_proposal_retention_days ?? 365);
      totalArchived += await archiveGroup("contract", policy.draft_contract_retention_days ?? 365);
      totalArchived += await archiveGroup("invoice", policy.draft_invoice_retention_days ?? 365);
    }

    if (totalArchived > 0) {
      console.log(`[DocumentRetentionCleanup] Archived ${totalArchived} document(s) across ${rows.length} tenant(s).`);
    }
  } catch (e) {
    console.error("[DocumentRetentionCleanup] Error:", e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Start all background jobs. Safe to call only once per process.
 * Call this inside the httpServer.listen() callback AFTER migrations complete.
 *
 * Initial delays are staggered so startup DB pressure is spread out:
 *   10s  — contractor reminders (needs contractor_workflow_settings table)
 *   15s  — demo cleanup (safe additive DELETE, low priority)
 */
export function startWorkerOrchestrator(): void {
  if (orchestratorStarted) {
    console.warn("[Orchestrator] Already started — ignoring duplicate call.");
    return;
  }
  orchestratorStarted = true;

  console.log("[Orchestrator] Starting worker orchestrator...");

  // ── Active jobs ────────────────────────────────────────────────────────────
  scheduleJob("ContractorReminders",      jobContractorReminders,      DAY_MS, 10_000);
  scheduleJob("DemoCleanup",              jobDemoCleanup,              DAY_MS, 15_000);
  scheduleJob("DocumentRetentionCleanup", jobDocumentRetentionCleanup, DAY_MS, 20_000);

  // ── Stub jobs (uncomment to activate) ─────────────────────────────────────
  // scheduleJob("PayrollReminders",     jobPayrollReminders,     DAY_MS,        30_000);
  // scheduleJob("NotificationDispatch", jobNotificationDispatch, MIN_MS,        20_000);
  // scheduleJob("EmailRetry",           jobEmailRetry,           5 * MIN_MS,    20_000);
  // scheduleJob("SmsRetry",             jobSmsRetry,             5 * MIN_MS,    20_000);
  // scheduleJob("AiReportGeneration",   jobAiReportGeneration,   15 * MIN_MS,   30_000);

  const scheduled = activeJobs.length + pendingTimers.length;
  console.log(`[Orchestrator] ${scheduled} job(s) scheduled (${activeJobs.length} immediate, ${pendingTimers.length} pending start).`);
}

/**
 * Gracefully stop all background jobs. Call on SIGTERM / SIGINT.
 * Clears every timer so the process can exit cleanly.
 */
export function shutdownOrchestrator(): void {
  if (!orchestratorStarted) return;
  console.log("[Orchestrator] Shutting down...");

  for (const t of pendingTimers) {
    clearTimeout(t);
  }
  pendingTimers.length = 0;

  for (const job of activeJobs) {
    clearInterval(job.interval);
    console.log(`[Orchestrator] Stopped: ${job.name}`);
  }
  activeJobs.length = 0;
  orchestratorStarted = false;
}

// ── Interval constants re-exported for use in ad-hoc API calls ────────────
export { DAY_MS, HOUR_MS, MIN_MS };
