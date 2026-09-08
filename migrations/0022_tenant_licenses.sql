-- 0022 — tenant licenses / trial licensing (PR 4 of the SaaS identity/onboarding cleanup).
--
-- Additive only. Two new tables: `tenant_licenses` (one structured license
-- record per company) and `tenant_license_events` (an append-only audit trail
-- of every license change). NO changes to `companies`, `tenants`,
-- `tenant_companies`, `trial_signups`, `license_requests`, `users`, `workers`,
-- `customers`, `account_invites`, `identity_links`, `vendors`, or ANY ledger,
-- check, payroll, or payment table. NO data backfill. NO production-wide row
-- mutation.
--
-- WHY a new table and not just `companies.subscription_status`:
--   `companies.subscription_status` + `trial_start/end` + `billing_active` +
--   `grace_period_*` + `gate_override_reason` remain the AUTHORITATIVE
--   enforcement state, read by server/tenant-enforcement.ts `checkTenantGate()`
--   and the `requireActiveSubscription` middleware. Those are unchanged by this
--   migration and this PR. `tenant_licenses` is an ADDITIVE structured record:
--   normalized status vocabulary, explicit plan/type, trial window, and a
--   who-changed-what audit trail that the scattered `companies` columns never
--   captured. The shared resolver (server/licensing/license-resolver.ts) reads
--   `tenant_licenses` first for structured metadata, then falls back to the
--   `companies` gate columns, then to a safe legacy default.
--
-- LEGACY SAFETY: a company with NO `tenant_licenses` row resolves exactly as it
--   does today (via the `companies` gate columns / `checkTenantGate()`). A
--   missing row NEVER locks anyone out. Existing production tenants get no row
--   from this migration.
--
-- Scoping keys (`company_id`, `tenant_id`) are plain VARCHAR with NO
-- foreign-key constraint — matching the recent-table convention in this repo
-- (`vendors`, `contractor_access_requests`, `account_invites`). Every read/write
-- in server/licensing/* is explicitly company-scoped.
--
-- Backup before applying in production:
--   pg_dump "$DATABASE_URL" > backups/pre_0022_tenant_licenses_$(date +%Y%m%d_%H%M%S).sql

CREATE TABLE IF NOT EXISTS tenant_licenses (
  id                         VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                 VARCHAR NOT NULL,
  tenant_id                  VARCHAR,
  plan_type                  TEXT NOT NULL DEFAULT 'starter',
  -- Normalized license vocabulary:
  --   trialing | active | expired | suspended | cancelled | inactive
  status                     TEXT NOT NULL DEFAULT 'active',
  trial_start                TIMESTAMP,
  trial_end                  TIMESTAMP,
  current_period_start       TIMESTAMP,
  current_period_end         TIMESTAMP,
  -- How this row came to exist: legacy_backfill | trial_signup | admin | system
  source                     TEXT NOT NULL DEFAULT 'system',
  -- Reserved for a future billing-processor link. UNUSED in PR 4 — this PR adds
  -- no billing-processor integration.
  external_ref               TEXT,
  notes                      TEXT,
  status_reason              TEXT,
  status_changed_at          TIMESTAMP,
  status_changed_by_user_id  VARCHAR,
  created_by_user_id         VARCHAR,
  updated_by_user_id         VARCHAR,
  created_at                 TIMESTAMP DEFAULT NOW(),
  updated_at                 TIMESTAMP DEFAULT NOW()
);

-- At most one license record per company. The resolver and the admin upsert
-- both rely on this.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_licenses_company ON tenant_licenses (company_id);
CREATE INDEX IF NOT EXISTS idx_tenant_licenses_status ON tenant_licenses (status);
CREATE INDEX IF NOT EXISTS idx_tenant_licenses_tenant ON tenant_licenses (tenant_id);

CREATE TABLE IF NOT EXISTS tenant_license_events (
  id             VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id     VARCHAR,
  company_id     VARCHAR NOT NULL,
  -- created | status_changed | plan_changed | updated | trial_resolved
  event_type     TEXT NOT NULL,
  from_status    TEXT,
  to_status      TEXT,
  from_plan      TEXT,
  to_plan        TEXT,
  reason         TEXT,
  actor_user_id  TEXT,
  actor_role     TEXT,
  metadata       TEXT,
  created_at     TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_license_events_license ON tenant_license_events (license_id);
CREATE INDEX IF NOT EXISTS idx_tenant_license_events_company ON tenant_license_events (company_id);
CREATE INDEX IF NOT EXISTS idx_tenant_license_events_created ON tenant_license_events (created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK
--
-- Purely additive. Preferred rollback for a released build is a COMPATIBLE CODE
-- ROLLBACK (redeploy the prior application tag) while LEAVING THIS SCHEMA IN
-- PLACE — the prior code never reads these tables, so they are inert. No
-- production row outside these two new tables is touched by this migration, so
-- there is nothing to un-migrate. `checkTenantGate()` and
-- `requireActiveSubscription` do not read `tenant_licenses`, so tenant access is
-- identical with the tables present or absent.
--
-- Destructive teardown — DISPOSABLE TEST DATABASES ONLY, never production:
--   DROP TABLE IF EXISTS tenant_license_events;
--   DROP TABLE IF EXISTS tenant_licenses;
-- ─────────────────────────────────────────────────────────────────────────────
