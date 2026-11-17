-- 0030 — Job board public discovery, access requests and limited applicant
-- identities (schema foundation only; the application code ships separately).
--
-- Adds:
--   job_board_settings         per-company board configuration + discovery code
--   job_applicants             limited applicant identity (users row with role
--                              'applicant'); NOT a worker, contractor or employee
--   job_board_access_requests  contractor / applicant access-request lifecycle
--   job_board_invitations      single-use, expiring invitation tokens (hash only)
--   job_post_access_grants     per-posting visibility grants for applicants
--   job_board_access_events    immutable audit for the access lifecycle
-- and three NULLable columns on job_posts + one on employment_applications.
--
-- Reuses (does NOT duplicate) the 0029 tables: employment_applications,
-- employment_application_answers, employment_application_events,
-- employment_application_documents, contractor_job_invitations.
--
-- Additive only: no DROP, no DELETE, no backfill. The new job_posts /
-- employment_applications columns are NULLable with no default, so no existing
-- row is rewritten. public_visibility NULL means "access_required" (the
-- fail-closed default) — the application never treats NULL as public.
--
-- Company code is DISCOVERY ONLY, never authentication: it is stored as a
-- SHA-256 lookup hash of the normalized code (code_lookup_hash) so a database
-- read does not hand out a list of codes, plus a short display hint.
-- Invitation tokens are stored as SHA-256 hashes only; plaintext tokens never
-- touch the database.
--
-- Audit table rejects UPDATE via trigger; DELETE is deliberately not blocked at
-- the DB level (the DemoCleanup tenant purge walks foreign keys). No
-- application route hard-deletes from these tables.
--
-- Versioning: records '0030' in paylink_migrations.applied. Rerun: a no-op.
-- Requires 0029 (job_posts, employment_applications) — refuses otherwise.
--
-- Apply (one transaction, stops on first error) AS THE ROLE THAT OWNS THE APP
-- TABLES — the guard below refuses any other role:
--   psql "<app DATABASE_URL>" -v ON_ERROR_STOP=1 -f migrations/0030_job_board_public_access.sql
-- Verify:  SELECT * FROM paylink_migrations.applied WHERE version = '0030';
-- Until this is applied the public board / access endpoints answer a generic
-- "not available" (never 5xx); nothing else reads these tables.

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE app_owner text;
BEGIN
  SELECT tableowner INTO app_owner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'companies';
  IF app_owner IS NULL THEN
    RAISE EXCEPTION '0030: public.companies not found — wrong database?';
  END IF;
  IF app_owner <> current_user THEN
    RAISE EXCEPTION '0030: run as the app table owner (%), not %', app_owner, current_user;
  END IF;
  IF to_regclass('public.job_posts') IS NULL OR to_regclass('public.employment_applications') IS NULL THEN
    RAISE EXCEPTION '0030: requires migration 0029 (job_posts / employment_applications) first';
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS paylink_migrations;
CREATE TABLE IF NOT EXISTS paylink_migrations.applied (
  version     TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by  TEXT NOT NULL DEFAULT current_user
);

-- ── Per-company board configuration + discovery code ───────────────────────
CREATE TABLE IF NOT EXISTS job_board_settings (
  id                    VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             VARCHAR NOT NULL,
  company_id            VARCHAR NOT NULL REFERENCES companies(id),
  board_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  code_lookup_hash      TEXT,          -- sha256(hex) of the normalized discovery code
  code_hint             TEXT,          -- last few characters, for administrator display only
  code_rotated_at       TIMESTAMP,
  display_name          TEXT,          -- public branding (never the legal/company record name implicitly)
  tagline               TEXT,
  brand_color           TEXT CHECK (brand_color IS NULL OR brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  accept_contractor_requests BOOLEAN NOT NULL DEFAULT FALSE,
  accept_applicant_requests  BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by_user_id    VARCHAR,
  created_at            TIMESTAMP DEFAULT now(),
  updated_at            TIMESTAMP DEFAULT now(),
  CONSTRAINT ck_job_board_settings_code CHECK ((code_lookup_hash IS NULL) = (code_hint IS NULL)),
  CONSTRAINT ck_job_board_settings_hash CHECK (code_lookup_hash IS NULL OR code_lookup_hash ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_board_settings_company ON job_board_settings (company_id);
-- Company-code lookup (one code → one company, globally).
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_board_settings_code ON job_board_settings (code_lookup_hash) WHERE code_lookup_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_job_board_settings_tenant ON job_board_settings (tenant_id);

-- ── Posting-level public visibility (NULL = access_required) ───────────────
ALTER TABLE job_posts ADD COLUMN IF NOT EXISTS public_visibility TEXT;
ALTER TABLE job_posts ADD COLUMN IF NOT EXISTS public_description TEXT;
ALTER TABLE job_posts ADD COLUMN IF NOT EXISTS public_show_compensation BOOLEAN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_job_posts_public_visibility') THEN
    ALTER TABLE job_posts ADD CONSTRAINT ck_job_posts_public_visibility
      CHECK (public_visibility IS NULL OR public_visibility IN ('public','access_required','invite_only'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_job_posts_public_board ON job_posts (company_id, public_visibility, status);

-- ── Applicant identities (limited role; never a worker/contractor) ─────────
CREATE TABLE IF NOT EXISTS job_applicants (
  id                       VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                VARCHAR NOT NULL,
  company_id               VARCHAR NOT NULL REFERENCES companies(id),
  user_id                  VARCHAR,       -- users row (role 'applicant'); set on activation
  email_normalized         TEXT NOT NULL,
  first_name               TEXT,
  last_name                TEXT,
  status                   TEXT NOT NULL DEFAULT 'pending_activation'
                             CHECK (status IN ('pending_activation','active','disabled')),
  email_verified_at        TIMESTAMP,
  activated_at             TIMESTAMP,
  disabled_at              TIMESTAMP,
  disabled_reason          TEXT,
  created_from_request_id  VARCHAR,
  created_at               TIMESTAMP DEFAULT now(),
  updated_at               TIMESTAMP DEFAULT now(),
  CONSTRAINT ck_job_applicants_email CHECK (email_normalized = lower(email_normalized) AND email_normalized LIKE '%@%'),
  CONSTRAINT ck_job_applicants_active CHECK (status <> 'active' OR (user_id IS NOT NULL AND email_verified_at IS NOT NULL))
);
-- One applicant identity per email per company (scoped; never global, so a
-- lookup in one company reveals nothing about another).
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_applicants_company_email ON job_applicants (company_id, email_normalized);
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_applicants_user ON job_applicants (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_job_applicants_tenant ON job_applicants (tenant_id);

-- ── Access requests (contractor | applicant) ───────────────────────────────
CREATE TABLE IF NOT EXISTS job_board_access_requests (
  id                            VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                     VARCHAR NOT NULL,
  company_id                    VARCHAR NOT NULL REFERENCES companies(id),
  request_kind                  TEXT NOT NULL CHECK (request_kind IN ('contractor','applicant')),
  job_post_id                   VARCHAR REFERENCES job_posts(id),
  email_normalized              TEXT NOT NULL,
  first_name                    TEXT NOT NULL,
  last_name                     TEXT NOT NULL,
  phone                         TEXT,
  message                       TEXT,
  status                        TEXT NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','approved','denied','withdrawn','expired')),
  reviewed_by_user_id           VARCHAR,
  reviewed_at                   TIMESTAMP,
  decision_note                 TEXT,
  -- Outcome links (exactly one family per kind; enforced below).
  applicant_id                  VARCHAR REFERENCES job_applicants(id),
  contractor_access_request_id  VARCHAR,     -- existing contractor_access_requests row (0020)
  source_ip_hash                TEXT,        -- sha256 of client IP; never the raw IP
  user_agent                    TEXT,
  created_at                    TIMESTAMP DEFAULT now(),
  updated_at                    TIMESTAMP DEFAULT now(),
  CONSTRAINT ck_job_board_access_requests_email CHECK (email_normalized = lower(email_normalized) AND email_normalized LIKE '%@%'),
  CONSTRAINT ck_job_board_access_requests_outcome CHECK (
    (request_kind = 'applicant'  AND contractor_access_request_id IS NULL) OR
    (request_kind = 'contractor' AND applicant_id IS NULL)),
  CONSTRAINT ck_job_board_access_requests_reviewed CHECK (status IN ('pending','withdrawn','expired') OR reviewed_at IS NOT NULL)
);
-- At most one PENDING request per email + kind per company.
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_board_access_requests_pending
  ON job_board_access_requests (company_id, request_kind, email_normalized) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_job_board_access_requests_review ON job_board_access_requests (company_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_job_board_access_requests_tenant ON job_board_access_requests (tenant_id);

-- ── Invitation tokens (hash only; single use; expiring; revocable) ─────────
CREATE TABLE IF NOT EXISTS job_board_invitations (
  id                   VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            VARCHAR NOT NULL,
  company_id           VARCHAR NOT NULL REFERENCES companies(id),
  purpose              TEXT NOT NULL CHECK (purpose IN ('applicant_activation','posting_invitation')),
  access_request_id    VARCHAR REFERENCES job_board_access_requests(id),
  applicant_id         VARCHAR REFERENCES job_applicants(id),
  job_post_id          VARCHAR REFERENCES job_posts(id),
  email_normalized     TEXT NOT NULL,
  token_hash           TEXT NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at           TIMESTAMP NOT NULL,
  consumed_at          TIMESTAMP,
  revoked_at           TIMESTAMP,
  revoked_by_user_id   VARCHAR,
  created_by_user_id   VARCHAR,
  created_at           TIMESTAMP DEFAULT now(),
  CONSTRAINT ck_job_board_invitations_single_end CHECK (consumed_at IS NULL OR revoked_at IS NULL),
  CONSTRAINT ck_job_board_invitations_expiry CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_board_invitations_token ON job_board_invitations (token_hash);
-- Token expiry sweep / live-token lookups.
CREATE INDEX IF NOT EXISTS idx_job_board_invitations_live ON job_board_invitations (expires_at) WHERE consumed_at IS NULL AND revoked_at IS NULL;
-- At most one live activation token per applicant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_board_invitations_live_activation
  ON job_board_invitations (applicant_id) WHERE purpose = 'applicant_activation' AND consumed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_job_board_invitations_company ON job_board_invitations (company_id, created_at);

-- ── Per-posting visibility grants for applicants ───────────────────────────
CREATE TABLE IF NOT EXISTS job_post_access_grants (
  id                   VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            VARCHAR NOT NULL,
  company_id           VARCHAR NOT NULL REFERENCES companies(id),
  job_post_id          VARCHAR NOT NULL REFERENCES job_posts(id),
  applicant_id         VARCHAR NOT NULL REFERENCES job_applicants(id),
  grant_source         TEXT NOT NULL CHECK (grant_source IN ('access_approval','invitation')),
  granted_by_user_id   VARCHAR,
  granted_at           TIMESTAMP DEFAULT now(),
  revoked_at           TIMESTAMP,
  revoked_by_user_id   VARCHAR
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_post_access_grants_active
  ON job_post_access_grants (job_post_id, applicant_id) WHERE revoked_at IS NULL;
-- Applicant ownership + posting visibility lookups.
CREATE INDEX IF NOT EXISTS idx_job_post_access_grants_applicant ON job_post_access_grants (applicant_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_job_post_access_grants_post ON job_post_access_grants (job_post_id) WHERE revoked_at IS NULL;

-- Grants may only reference EMPLOYEE postings (contractor visibility stays in
-- contractor_job_invitations / the contractor access workflow).
DROP TRIGGER IF EXISTS trg_job_post_access_grants_employee_only ON job_post_access_grants;
CREATE TRIGGER trg_job_post_access_grants_employee_only
  BEFORE INSERT OR UPDATE OF job_post_id ON job_post_access_grants
  FOR EACH ROW EXECUTE FUNCTION job_board_require_classification('employee');

-- ── Applications by applicant identities ───────────────────────────────────
ALTER TABLE employment_applications ADD COLUMN IF NOT EXISTS applicant_id VARCHAR REFERENCES job_applicants(id);
CREATE INDEX IF NOT EXISTS idx_employment_applications_applicant_id ON employment_applications (applicant_id) WHERE applicant_id IS NOT NULL;

-- ── Immutable access audit ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_board_access_events (
  id                 VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          VARCHAR NOT NULL,
  company_id         VARCHAR NOT NULL REFERENCES companies(id),
  event_type         TEXT NOT NULL,
  access_request_id  VARCHAR REFERENCES job_board_access_requests(id),
  applicant_id       VARCHAR REFERENCES job_applicants(id),
  invitation_id      VARCHAR REFERENCES job_board_invitations(id),
  job_post_id        VARCHAR REFERENCES job_posts(id),
  actor_user_id      VARCHAR,
  details            JSONB,
  created_at         TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_board_access_events_company ON job_board_access_events (company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_job_board_access_events_request ON job_board_access_events (access_request_id) WHERE access_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_job_board_access_events_applicant ON job_board_access_events (applicant_id) WHERE applicant_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_job_board_access_events_immutable ON job_board_access_events;
CREATE TRIGGER trg_job_board_access_events_immutable
  BEFORE UPDATE ON job_board_access_events
  FOR EACH ROW EXECUTE FUNCTION contractor_job_audit_immutable();

INSERT INTO paylink_migrations.applied (version, name)
VALUES ('0030', 'job_board_public_access')
ON CONFLICT (version) DO NOTHING;

COMMIT;
