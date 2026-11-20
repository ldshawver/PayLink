/**
 * Contractor welcome email — the QUEUE half (database only; no mail, network or
 * AI code). review.ts calls `queueWelcomeEmail` inside the approval
 * transaction; delivery lives in welcome.ts and runs from the orchestrator.
 */
import { sql } from "drizzle-orm";

type Exec = { execute: (q: any) => Promise<any> };
const firstRow = <T>(r: any): T | undefined => (Array.isArray(r) ? r[0] : r?.rows?.[0]);

export const WELCOME_KIND = "contractor_welcome";
export const MAX_ATTEMPTS = 5;
const dedupeKey = (onboardingId: string) => `${WELCOME_KIND}:${onboardingId}`;

/** One onboarding_audit_log row: ids, attempt numbers and fixed codes only. */
export async function audit(exec: Exec, r: { company_id: string; worker_id: string; onboarding_id: string }, eventType: string, after: Record<string, unknown>, actor: { id: string | null; type: "admin" | "worker" | "system" } = { id: null, type: "system" }) {
  await exec.execute(sql`
    INSERT INTO onboarding_audit_log (company_id, worker_id, onboarding_id, actor_user_id, actor_type, event_type, after_json)
    VALUES (${r.company_id}, ${r.worker_id}, ${r.onboarding_id}, ${actor.id}, ${actor.type}, ${eventType}, ${JSON.stringify(after)})`);
}

/** True once migration 0036 is applied. */
export async function tablesReady(exec: Exec): Promise<boolean> {
  const r = firstRow<any>(await exec.execute(sql`
    SELECT to_regclass('public.email_outbox') IS NOT NULL AND to_regclass('public.contractor_password_setup_tokens') IS NOT NULL AS ok`));
  return !!r?.ok;
}

/** Queue the single welcome message for a just-verified onboarding. Idempotent. */
export async function queueWelcomeEmail(tx: Exec, a: { companyId: string; workerId: string; onboardingId: string; actorUserId: string }): Promise<"queued" | "already_queued" | "unavailable"> {
  const row = { company_id: a.companyId, worker_id: a.workerId, onboarding_id: a.onboardingId };
  if (!(await tablesReady(tx))) {
    await audit(tx, row, "welcome_email_not_queued", { reason: "outbox_unavailable" }, { id: a.actorUserId, type: "admin" });
    return "unavailable";
  }
  const ins = firstRow<{ id: string }>(await tx.execute(sql`
    INSERT INTO email_outbox (kind, dedupe_key, company_id, worker_id, subject_id, max_attempts)
    VALUES (${WELCOME_KIND}, ${dedupeKey(a.onboardingId)}, ${a.companyId}, ${a.workerId}, ${a.onboardingId}, ${MAX_ATTEMPTS})
    ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`));
  if (!ins) return "already_queued";
  await audit(tx, row, "welcome_email_queued", { outboxId: ins.id }, { id: a.actorUserId, type: "admin" });
  return "queued";
}
