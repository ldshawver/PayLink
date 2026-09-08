-- 0020 — contractor access requests (PR 2 of the SaaS identity/onboarding cleanup).
--
-- Additive only. One new table: `contractor_access_requests`. No changes to
-- workers, users, account_invites, identity_links, or either company-access
-- table. No data backfill.
--
-- A contractor's PUBLIC request for logged-in Contractor Hub access is stored
-- here as `pending`. A public submission NEVER creates a login account. A
-- company admin/manager reviews it and either:
--   approve  → create/link the contractor worker record + issue an
--              account_invite (PR 1 invite system); row → 'approved',
--              created_worker_id / account_invite_id (or linked_user_id) set.
--   reject   → row → 'rejected' with rejection_reason; the row is KEPT.
--
-- Backup before applying in production:
--   pg_dump "$DATABASE_URL" > backups/pre_0020_contractor_access_requests_$(date +%Y%m%d_%H%M%S).sql

CREATE TABLE IF NOT EXISTS contractor_access_requests (
  id                     VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             VARCHAR,
  email                  TEXT NOT NULL,
  first_name             TEXT NOT NULL,
  last_name              TEXT NOT NULL,
  phone                  TEXT,
  business_name          TEXT,
  trade_type             TEXT,
  license_number         TEXT,
  requested_company_hint TEXT,
  message                TEXT,
  status                 TEXT NOT NULL DEFAULT 'pending',
  reviewed_by_user_id    VARCHAR,
  reviewed_at            TIMESTAMP,
  rejection_reason       TEXT,
  created_worker_id      VARCHAR,
  account_invite_id      VARCHAR,
  linked_user_id         VARCHAR,
  review_note            TEXT,
  source_ip              TEXT,
  user_agent             TEXT,
  created_at             TIMESTAMP DEFAULT NOW(),
  updated_at             TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contractor_access_requests_email ON contractor_access_requests (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_contractor_access_requests_status ON contractor_access_requests (status);
CREATE INDEX IF NOT EXISTS idx_contractor_access_requests_company ON contractor_access_requests (company_id);
-- At most one live (pending) request per email — public re-submits collapse onto it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_contractor_access_requests_pending_email
  ON contractor_access_requests (LOWER(email))
  WHERE status = 'pending';

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK
--
-- Purely additive. Preferred rollback for a released build is a COMPATIBLE CODE
-- ROLLBACK (redeploy the prior application tag) while LEAVING THIS SCHEMA IN
-- PLACE — the prior code never reads this table, so it is inert.
--
-- Destructive teardown — DISPOSABLE TEST DATABASES ONLY:
--   DROP TABLE IF EXISTS contractor_access_requests;
-- ─────────────────────────────────────────────────────────────────────────────
