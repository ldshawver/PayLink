-- 0029 — Contractor Hub job board (postings, bids, invitations, questions,
-- attachments, immutable bid versions + events).
--
-- Additive only: seven new, empty tables, their indexes, one UPDATE-blocking
-- trigger function for the two audit tables, and two new NULLable columns on
-- contractor_proposals (+ one partial unique index over those all-NULL
-- columns). No DROP, no DELETE, no backfill, no change to any existing row.
--
-- Why new proposal columns instead of contractor_proposals.job_id:
-- contractor_proposals.job_id is the cost-accounting `jobs` reference — it is
-- copied into contractor_contracts.job_id and from there into invoices for
-- job-cost reporting. Writing a job-POSTING id into it would corrupt job-cost
-- data, so an awarded bid links through job_post_id / job_bid_id instead. A
-- posting may carry an optional cost_job_id, which IS copied into job_id.
--
-- uq_contractor_proposals_job_bid_id makes "one proposal per awarded bid" a
-- database guarantee (the award transaction's row locks are the first line).
--
-- Audit tables (contractor_job_bid_events, contractor_job_bid_versions) reject
-- UPDATE via trigger. DELETE is deliberately NOT blocked at the DB level: the
-- DemoCleanup tenant purge removes an expired demo company's rows by walking
-- foreign keys, and a DELETE trigger would wedge it. No application route
-- deletes from any of these tables.
--
-- Versioning: records '0029' in paylink_migrations.applied (same ledger as
-- 0027/0028). Rerun: a no-op.
--
-- Apply (one transaction, stops on first error) AS THE ROLE THAT OWNS THE APP
-- TABLES — the guard below refuses any other role:
--   psql "<app DATABASE_URL>" -v ON_ERROR_STOP=1 -f migrations/0029_contractor_job_board.sql
-- Verify:  SELECT to_regclass('public.contractor_job_posts');
--          SELECT * FROM paylink_migrations.applied WHERE version = '0029';
-- Until this is applied the job-board API answers 503 (feature not enabled);
-- nothing else in the app reads these tables.

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE app_owner text;
BEGIN
  SELECT tableowner INTO app_owner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'companies';
  IF app_owner IS NULL THEN
    RAISE EXCEPTION '0029: public.companies not found — wrong database?';
  END IF;
  IF app_owner <> current_user THEN
    RAISE EXCEPTION '0029: run as the app table owner (%), not %', app_owner, current_user;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS paylink_migrations;
CREATE TABLE IF NOT EXISTS paylink_migrations.applied (
  version     TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by  TEXT NOT NULL DEFAULT current_user
);

-- ── Postings ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contractor_job_posts (
  id                      VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               VARCHAR,
  company_id              VARCHAR NOT NULL REFERENCES companies(id),
  created_by_user_id      VARCHAR NOT NULL,
  title                   TEXT NOT NULL,
  summary                 TEXT,
  scope_of_work           TEXT,
  requirements            TEXT,
  deliverables            TEXT,
  location_type           TEXT NOT NULL DEFAULT 'onsite'
                            CHECK (location_type IN ('onsite','remote','hybrid')),
  location_text           TEXT,
  work_type               TEXT NOT NULL DEFAULT 'one_time'
                            CHECK (work_type IN ('one_time','recurring')),
  recurrence_frequency    TEXT
                            CHECK (recurrence_frequency IS NULL OR recurrence_frequency IN ('weekly','biweekly','monthly','quarterly','custom')),
  recurrence_description  TEXT,
  estimated_start_date    DATE,
  estimated_end_date      DATE,
  submission_deadline     TIMESTAMP,
  budget_type             TEXT NOT NULL DEFAULT 'contractor_quote'
                            CHECK (budget_type IN ('fixed','hourly','range','contractor_quote','undisclosed')),
  budget_min              NUMERIC(14,2),
  budget_max              NUMERIC(14,2),
  currency                TEXT NOT NULL DEFAULT 'USD',
  payment_terms           TEXT,
  maximum_awards          INTEGER CHECK (maximum_awards IS NULL OR maximum_awards >= 1),
  awards_made             INTEGER NOT NULL DEFAULT 0 CHECK (awards_made >= 0),
  visibility              TEXT NOT NULL DEFAULT 'all_eligible'
                            CHECK (visibility IN ('all_eligible','invited_only','selected_groups')),
  eligible_groups         JSONB NOT NULL DEFAULT '[]'::jsonb,
  cost_job_id             VARCHAR,
  status                  TEXT NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','published','paused','closed','archived')),
  close_reason            TEXT,
  published_at            TIMESTAMP,
  closed_at               TIMESTAMP,
  archived_at             TIMESTAMP,
  created_at              TIMESTAMP DEFAULT now(),
  updated_at              TIMESTAMP DEFAULT now(),
  CONSTRAINT ck_contractor_job_posts_award_capacity CHECK (maximum_awards IS NULL OR awards_made <= maximum_awards),
  CONSTRAINT ck_contractor_job_posts_budget_range CHECK (budget_min IS NULL OR budget_max IS NULL OR budget_min <= budget_max)
);
CREATE INDEX IF NOT EXISTS idx_contractor_job_posts_company_status ON contractor_job_posts (company_id, status);
CREATE INDEX IF NOT EXISTS idx_contractor_job_posts_tenant ON contractor_job_posts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_contractor_job_posts_expiry ON contractor_job_posts (estimated_end_date) WHERE status IN ('published','paused');

-- ── Bids (one active bid per contractor per posting) ────────────────────────
CREATE TABLE IF NOT EXISTS contractor_job_bids (
  id                         VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  VARCHAR,
  company_id                 VARCHAR NOT NULL REFERENCES companies(id),
  job_post_id                VARCHAR NOT NULL REFERENCES contractor_job_posts(id),
  contractor_id              VARCHAR NOT NULL REFERENCES workers(id),
  submitted_by_user_id       VARCHAR,
  status                     TEXT NOT NULL DEFAULT 'draft'
                               CHECK (status IN ('draft','submitted','under_review','shortlisted','revision_requested',
                                                 'rejected','withdrawn','awarded','converted_to_proposal','converted_to_contract')),
  cover_message              TEXT,
  proposed_scope             TEXT,
  proposed_amount            NUMERIC(14,2),
  rate_type                  TEXT CHECK (rate_type IS NULL OR rate_type IN ('fixed','hourly','recurring','custom')),
  hourly_rate                NUMERIC(14,2),
  estimated_hours            NUMERIC(10,2),
  estimated_start_date       DATE,
  estimated_completion_date  DATE,
  recurrence_terms           TEXT,
  assumptions                TEXT,
  exclusions                 TEXT,
  revision_number            INTEGER NOT NULL DEFAULT 0,
  revision_request_note      TEXT,
  rejection_reason           TEXT,
  submitted_at               TIMESTAMP,
  withdrawn_at               TIMESTAMP,
  reviewed_at                TIMESTAMP,
  reviewed_by_user_id        VARCHAR,
  awarded_at                 TIMESTAMP,
  awarded_by_user_id         VARCHAR,
  award_idempotency_key      TEXT,
  converted_proposal_id      VARCHAR,
  converted_contract_id      VARCHAR,
  created_at                 TIMESTAMP DEFAULT now(),
  updated_at                 TIMESTAMP DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contractor_job_bids_active ON contractor_job_bids (job_post_id, contractor_id) WHERE status <> 'withdrawn';
CREATE UNIQUE INDEX IF NOT EXISTS uq_contractor_job_bids_award_key ON contractor_job_bids (company_id, award_idempotency_key) WHERE award_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_contractor_job_bids_proposal ON contractor_job_bids (converted_proposal_id) WHERE converted_proposal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contractor_job_bids_post_status ON contractor_job_bids (job_post_id, status);
CREATE INDEX IF NOT EXISTS idx_contractor_job_bids_contractor ON contractor_job_bids (contractor_id);
CREATE INDEX IF NOT EXISTS idx_contractor_job_bids_company ON contractor_job_bids (company_id);

-- ── Immutable bid revisions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contractor_job_bid_versions (
  id                  VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           VARCHAR,
  company_id          VARCHAR NOT NULL REFERENCES companies(id),
  job_post_id         VARCHAR NOT NULL REFERENCES contractor_job_posts(id),
  bid_id              VARCHAR NOT NULL REFERENCES contractor_job_bids(id),
  revision_number     INTEGER NOT NULL,
  snapshot            JSONB NOT NULL,
  created_by_user_id  VARCHAR,
  created_at          TIMESTAMP DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contractor_job_bid_versions_rev ON contractor_job_bid_versions (bid_id, revision_number);

-- ── Immutable audit events (posting events have bid_id NULL) ────────────────
CREATE TABLE IF NOT EXISTS contractor_job_bid_events (
  id               VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        VARCHAR,
  company_id       VARCHAR NOT NULL REFERENCES companies(id),
  job_post_id      VARCHAR NOT NULL REFERENCES contractor_job_posts(id),
  bid_id           VARCHAR REFERENCES contractor_job_bids(id),
  event_type       TEXT NOT NULL,
  old_status       TEXT,
  new_status       TEXT,
  actor_user_id    VARCHAR,
  actor_worker_id  VARCHAR,
  details          JSONB,
  created_at       TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contractor_job_bid_events_post ON contractor_job_bid_events (job_post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_contractor_job_bid_events_bid ON contractor_job_bid_events (bid_id) WHERE bid_id IS NOT NULL;

-- ── Invitations ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contractor_job_invitations (
  id                   VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            VARCHAR,
  company_id           VARCHAR NOT NULL REFERENCES companies(id),
  job_post_id          VARCHAR NOT NULL REFERENCES contractor_job_posts(id),
  contractor_id        VARCHAR NOT NULL REFERENCES workers(id),
  invited_by_user_id   VARCHAR NOT NULL,
  status               TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','revoked')),
  invited_at           TIMESTAMP DEFAULT now(),
  revoked_at           TIMESTAMP,
  revoked_by_user_id   VARCHAR
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contractor_job_invitations_post_contractor ON contractor_job_invitations (job_post_id, contractor_id);
CREATE INDEX IF NOT EXISTS idx_contractor_job_invitations_contractor ON contractor_job_invitations (contractor_id) WHERE status = 'invited';

-- ── Questions ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contractor_job_questions (
  id                   VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            VARCHAR,
  company_id           VARCHAR NOT NULL REFERENCES companies(id),
  job_post_id          VARCHAR NOT NULL REFERENCES contractor_job_posts(id),
  contractor_id        VARCHAR NOT NULL REFERENCES workers(id),
  asked_by_user_id     VARCHAR NOT NULL,
  question             TEXT NOT NULL,
  answer               TEXT,
  answered_by_user_id  VARCHAR,
  answered_at          TIMESTAMP,
  is_public            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMP DEFAULT now(),
  updated_at           TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contractor_job_questions_post ON contractor_job_questions (job_post_id);

-- ── Attachments (private storage; never under /uploads) ─────────────────────
CREATE TABLE IF NOT EXISTS contractor_job_attachments (
  id                     VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              VARCHAR,
  company_id             VARCHAR NOT NULL REFERENCES companies(id),
  job_post_id            VARCHAR NOT NULL REFERENCES contractor_job_posts(id),
  bid_id                 VARCHAR REFERENCES contractor_job_bids(id),
  storage_key            TEXT NOT NULL,
  file_name              TEXT NOT NULL,
  content_type           TEXT,
  file_size              INTEGER,
  uploaded_by_user_id    VARCHAR NOT NULL,
  uploaded_by_worker_id  VARCHAR,
  removed_at             TIMESTAMP,
  removed_by_user_id     VARCHAR,
  created_at             TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contractor_job_attachments_post ON contractor_job_attachments (job_post_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contractor_job_attachments_bid ON contractor_job_attachments (bid_id) WHERE bid_id IS NOT NULL;

-- ── Audit immutability (UPDATE only — see header for why not DELETE) ────────
CREATE OR REPLACE FUNCTION contractor_job_audit_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME;
END $$;

DROP TRIGGER IF EXISTS trg_contractor_job_bid_events_immutable ON contractor_job_bid_events;
CREATE TRIGGER trg_contractor_job_bid_events_immutable
  BEFORE UPDATE ON contractor_job_bid_events
  FOR EACH ROW EXECUTE FUNCTION contractor_job_audit_immutable();

DROP TRIGGER IF EXISTS trg_contractor_job_bid_versions_immutable ON contractor_job_bid_versions;
CREATE TRIGGER trg_contractor_job_bid_versions_immutable
  BEFORE UPDATE ON contractor_job_bid_versions
  FOR EACH ROW EXECUTE FUNCTION contractor_job_audit_immutable();

-- ── Award → proposal linkage on the existing proposal table ─────────────────
ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS job_post_id VARCHAR;
ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS job_bid_id VARCHAR;
CREATE UNIQUE INDEX IF NOT EXISTS uq_contractor_proposals_job_bid_id ON contractor_proposals (job_bid_id) WHERE job_bid_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contractor_proposals_job_post_id ON contractor_proposals (job_post_id) WHERE job_post_id IS NOT NULL;

INSERT INTO paylink_migrations.applied (version, name)
VALUES ('0029', 'contractor_job_board')
ON CONFLICT (version) DO NOTHING;

COMMIT;
