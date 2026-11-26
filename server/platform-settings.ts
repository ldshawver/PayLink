/**
 * Platform-level settings. A missing table or a missing row uses the code
 * default so trial signup keeps working before migration 0039 is applied.
 */
import { sql } from "drizzle-orm";
import { db } from "./db";

export const DEFAULT_TRIAL_LENGTH_DAYS = 30;
export const MIN_TRIAL_LENGTH_DAYS = 1;
export const MAX_TRIAL_LENGTH_DAYS = 365;
export const TRIAL_LENGTH_DAYS_KEY = "trial_length_days";

/** Whole days in [1, 365], or null when the value is not a usable setting. */
export function parseTrialLengthDays(raw: unknown): number | null {
  const n = typeof raw === "number"
    ? raw
    : typeof raw === "string" && raw.trim() !== ""
      ? Number(raw.trim())
      : NaN;
  if (!Number.isInteger(n) || n < MIN_TRIAL_LENGTH_DAYS || n > MAX_TRIAL_LENGTH_DAYS) return null;
  return n;
}

/** Marketing sentence. The default of 30 days keeps the historical wording. */
export function trialOfferCopy(days: number = DEFAULT_TRIAL_LENGTH_DAYS): string {
  return `${days}-day trial, no credit card`;
}

export function trialLengthMs(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}

export async function getTrialLengthDays(): Promise<number> {
  try {
    const result = await db.execute(sql`
      SELECT value FROM platform_settings WHERE key = ${TRIAL_LENGTH_DAYS_KEY} LIMIT 1
    `);
    return parseTrialLengthDays((result.rows[0] as { value?: string } | undefined)?.value) ?? DEFAULT_TRIAL_LENGTH_DAYS;
  } catch {
    return DEFAULT_TRIAL_LENGTH_DAYS;
  }
}

export async function setTrialLengthDays(days: number, actorUserId: string): Promise<void> {
  const parsed = parseTrialLengthDays(days);
  if (parsed == null) throw new Error("trial length must be a whole number of days from 1 to 365");
  await db.execute(sql`
    INSERT INTO platform_settings (key, value, updated_at, updated_by)
    VALUES (${TRIAL_LENGTH_DAYS_KEY}, ${String(parsed)}, NOW(), ${actorUserId})
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by
  `);
}
