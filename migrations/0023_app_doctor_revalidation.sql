-- 0023 — App Doctor issue revalidation / refresh / archive.
--
-- Additive only. Adds columns to `app_doctor_reports` so an existing issue can
-- be re-checked against the CURRENT deployed app, its review content refreshed
-- if still valid, or archived (never hard-deleted) if it no longer reproduces.
--
-- No changes to any other table. No data backfill. No production-wide row
-- mutation. No DROP / no DELETE.
--
-- New columns on app_doctor_reports:
--   last_seen_at            — last time the issue was observed reproducing
--   last_revalidated_at     — last time a revalidation pass ran
--   revalidation_status     — reproduced | not_reproduced | inconclusive (null = never run)
--   revalidation_evidence   — JSON: {app:{version,commit,environment}, assetHashes,
--                             referencedAssetHashes, endpointRepro, recentLogMatches,
--                             newerOccurrences, scope:{companyId,userId}, checkedAt}
--   archived_at             — set when the issue leaves the active window
--   archived_by_user_id     — actor who archived it (or 'system')
--   archived_reason         — 'no_longer_reproduces' | 'manual' | ...
--   ai_last_error           — last external-AI failure message (recorded SEPARATELY
--                             from issue validity — an AI outage never archives an issue)
--   ai_last_error_at        — timestamp of that failure
--
-- The "active issue window" (GET /api/app-doctor/reports, default) is defined as
-- `archived_at IS NULL`. `?includeArchived=true` returns everything. Tenant/company
-- scoping is unchanged — every query keeps its existing `company_id` filter.
--
-- Backup before applying in production:
--   pg_dump "$DATABASE_URL" > backups/pre_0023_app_doctor_revalidation_$(date +%Y%m%d_%H%M%S).sql

ALTER TABLE app_doctor_reports ADD COLUMN IF NOT EXISTS last_seen_at           TIMESTAMP;
ALTER TABLE app_doctor_reports ADD COLUMN IF NOT EXISTS last_revalidated_at    TIMESTAMP;
ALTER TABLE app_doctor_reports ADD COLUMN IF NOT EXISTS revalidation_status    TEXT;
ALTER TABLE app_doctor_reports ADD COLUMN IF NOT EXISTS revalidation_evidence  TEXT;
ALTER TABLE app_doctor_reports ADD COLUMN IF NOT EXISTS archived_at            TIMESTAMP;
ALTER TABLE app_doctor_reports ADD COLUMN IF NOT EXISTS archived_by_user_id    VARCHAR;
ALTER TABLE app_doctor_reports ADD COLUMN IF NOT EXISTS archived_reason        TEXT;
ALTER TABLE app_doctor_reports ADD COLUMN IF NOT EXISTS ai_last_error          TEXT;
ALTER TABLE app_doctor_reports ADD COLUMN IF NOT EXISTS ai_last_error_at       TIMESTAMP;

-- Active-window lookups filter on archived_at; keep them index-backed per company.
CREATE INDEX IF NOT EXISTS idx_app_doctor_reports_active
  ON app_doctor_reports (company_id, created_at DESC)
  WHERE archived_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK
--
-- Purely additive. Preferred rollback for a released build is a COMPATIBLE CODE
-- ROLLBACK (redeploy the prior application tag) while LEAVING THESE COLUMNS IN
-- PLACE — the prior code never reads them, so they are inert, and no issue is
-- hidden (prior code did not filter on archived_at). No production row outside
-- these new nullable columns is touched.
--
-- Destructive teardown — DISPOSABLE TEST DATABASES ONLY, never production:
--   DROP INDEX IF EXISTS idx_app_doctor_reports_active;
--   ALTER TABLE app_doctor_reports
--     DROP COLUMN IF EXISTS last_seen_at,
--     DROP COLUMN IF EXISTS last_revalidated_at,
--     DROP COLUMN IF EXISTS revalidation_status,
--     DROP COLUMN IF EXISTS revalidation_evidence,
--     DROP COLUMN IF EXISTS archived_at,
--     DROP COLUMN IF EXISTS archived_by_user_id,
--     DROP COLUMN IF EXISTS archived_reason,
--     DROP COLUMN IF EXISTS ai_last_error,
--     DROP COLUMN IF EXISTS ai_last_error_at;
-- ─────────────────────────────────────────────────────────────────────────────
