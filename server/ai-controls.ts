/**
 * Platform and company AI switches. The platform switch defaults off.
 * A company row is an opt-out (or an explicit opt-in). Missing company row
 * follows the platform switch. The endpoint must also be configured.
 */
import { sql } from "drizzle-orm";
import { db } from "./db";
import { AI_NOT_CONFIGURED_MESSAGE, readAiEndpoint, type AiEndpoint } from "./ai-client";

export const AI_PLATFORM_OFF_MESSAGE =
  "AI is turned off for this platform. A platform administrator can enable the self-hosted AI service.";
export const AI_COMPANY_OFF_MESSAGE =
  "AI is turned off for this company. A company administrator can turn it back on.";
export const AI_VISION_MISSING_MESSAGE =
  "Receipt and expense scanning needs AI_VISION_MODEL on the self-hosted AI service.";

export interface AiAvailability {
  available: boolean;
  code: "available" | "not_configured" | "platform_disabled" | "company_disabled" | "vision_not_configured";
  message: string;
  endpoint: AiEndpoint | null;
  platformEnabled: boolean;
  companyEnabled: boolean | null;
}

async function readPlatformEnabled(): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      SELECT enabled FROM ai_controls WHERE subject_id = 'platform' LIMIT 1
    `);
    const row = result.rows[0] as { enabled?: boolean } | undefined;
    return row?.enabled === true;
  } catch {
    return false;
  }
}

async function readCompanyEnabled(companyId: string): Promise<boolean | null> {
  try {
    const result = await db.execute(sql`
      SELECT enabled FROM ai_controls WHERE subject_id = ${companyId} AND scope = 'company' LIMIT 1
    `);
    const row = result.rows[0] as { enabled?: boolean } | undefined;
    if (!row) return null;
    return row.enabled === true;
  } catch {
    return null;
  }
}

export async function resolveAiAvailability(companyId: string | null, kind: "text" | "vision" = "text"): Promise<AiAvailability> {
  const { endpoint, reason } = readAiEndpoint();
  const platformEnabled = await readPlatformEnabled();
  const companyEnabled = companyId ? await readCompanyEnabled(companyId) : null;
  const base = { endpoint, platformEnabled, companyEnabled };
  if (!endpoint) {
    return { ...base, available: false, code: "not_configured", message: reason ? `${AI_NOT_CONFIGURED_MESSAGE} (${reason}.)` : AI_NOT_CONFIGURED_MESSAGE };
  }
  if (!platformEnabled) {
    return { ...base, available: false, code: "platform_disabled", message: AI_PLATFORM_OFF_MESSAGE };
  }
  if (companyEnabled === false) {
    return { ...base, available: false, code: "company_disabled", message: AI_COMPANY_OFF_MESSAGE };
  }
  if (kind === "vision" && !endpoint.visionModel) {
    return { ...base, available: false, code: "vision_not_configured", message: AI_VISION_MISSING_MESSAGE };
  }
  return { ...base, available: true, code: "available", message: "Self-hosted AI is available." };
}

export async function setPlatformAiEnabled(enabled: boolean, actorUserId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO ai_controls (subject_id, scope, enabled, updated_at, updated_by)
    VALUES ('platform', 'platform', ${enabled}, NOW(), ${actorUserId})
    ON CONFLICT (subject_id) DO UPDATE
      SET enabled = EXCLUDED.enabled, updated_at = NOW(), updated_by = EXCLUDED.updated_by
  `);
}

export async function setCompanyAiEnabled(companyId: string, enabled: boolean, actorUserId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO ai_controls (subject_id, scope, enabled, updated_at, updated_by)
    VALUES (${companyId}, 'company', ${enabled}, NOW(), ${actorUserId})
    ON CONFLICT (subject_id) DO UPDATE
      SET enabled = EXCLUDED.enabled, updated_at = NOW(), updated_by = EXCLUDED.updated_by
  `);
}
