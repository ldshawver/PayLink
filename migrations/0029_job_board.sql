-- 0029 — Job board: postings for contractor work AND employee positions, kept
-- on two physically separate submission paths.
--
--   job_posts                      one table for every posting; worker_classification
--                                  ('contractor' | 'employee') is declared by the
--                                  administrator, required, and frozen once published.
--   contractor_job_bids (+ versions, events, invitations, questions)
--                                  the proposal/bid path — contractor postings ONLY.
--   employment_applications (+ events, screening questions/answers, documents)
--                                  the hiring path — employee postings ONLY.
--   job_post_events                posting-level audit (status + classification).
--   job_post_attachments           posting files and contractor-bid files.
--
-- Classification is enforced in the database, not just the app:
--   * CHECKs tie opportunity_type / employment_type / compensation_type to the
--     declared classification;
--   * a trigger refuses to change worker_classification after a posting leaves
--     draft;
--   * insert triggers refuse a bid on an employee posting, an application on a
--     contractor posting, and a contractor_proposals row linked to an employee
--     posting.
-- employment_applications has NO link to proposals, contracts, invoices or
-- contractor payments. Hiring stays in this table; creating a worker record is
-- a separate explicit administrator action that writes worker_type from the
-- posting's classification.
--
-- Additive only: twelve new, empty tables, their indexes, trigger functions,
-- and two new NULLable columns on contractor_proposals (+ indexes and one
-- guard trigger that fires only when job_post_id is set). No DROP of existing
-- objects, no DELETE, no backfill, no change to any existing row.
--
-- Why new proposal columns instead of contractor_proposals.job_id:
-- contractor_proposals.job_id is the cost-accounting `jobs` reference — it is
-- copied into contractor_contracts.job_id and from there into invoices for
-- job-cost reporting. An awarded bid links through job_post_id / job_bid_id; a
-- posting may carry an optional cost_job_id, which IS copied into job_id.
--
-- Audit tables reject UPDATE via trigger. DELETE is deliberately NOT blocked at
-- the DB level: the DemoCleanup tenant purge removes an expired demo company's
-- rows by walking foreign keys, and a DELETE trigger would wedge it. No
-- application route deletes from any of these tables.
--
-- Versioning: records '0029' in paylink_migrations.applied (same ledger as
-- 0027/0028). Rerun: a no-op.
--
-- Apply (one transaction, stops on first error) AS THE ROLE THAT OWNS THE APP
-- TABLES — the guard below refuses any other role:
--   psql "<app DATABASE_URL>" -v ON_ERROR_STOP=1 -f migrations/0029_job_board.sql
-- Verify:  SELECT to_regclass('public.job_posts'), to_regclass('public.employment_applications');
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
CREATE TABLE IF NOT EXISTS job_posts (
  id                        VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 VARCHAR,
  company_id                VARCHAR NOT NULL REFERENCES companies(id),
  created_by_user_id        VARCHAR NOT NULL,

  -- Classification (declared by the administrator; no legal determination is made).
  worker_classification     TEXT NOT NULL CHECK (worker_classification IN ('contractor','employee')),
  opportunity_type          TEXT NOT NULL CHECK (opportunity_type IN ('project','recurring_work','position')),
  schedule_type             TEXT NOT NULL CHECK (schedule_type IN ('one_time','recurring','part_time','full_time')),
  employment_type           TEXT CHECK (employment_type IS NULL OR employment_type IN ('part_time','full_time')),
  duration_type             TEXT NOT NULL DEFAULT 'fixed_term' CHECK (duration_type IN ('fixed_term','ongoing')),
  hours_per_week_min        NUMERIC(5,2) CHECK (hours_per_week_min IS NULL OR (hours_per_week_min >= 0 AND hours_per_week_min <= 168)),
  hours_per_week_max        NUMERIC(5,2) CHECK (hours_per_week_max IS NULL OR (hours_per_week_max >= 0 AND hours_per_week_max <= 168)),
  classification_declared_by_user_id VARCHAR NOT NULL,
  classification_declared_at TIMESTAMP NOT NULL DEFAULT now(),
  -- Contractor postings that resemble employment: the indicators shown and the admin's acknowledgement.
  classification_indicators JSONB NOT NULL DEFAULT '[]'::jsonb,
  classification_acknowledged_by_user_id VARCHAR,
  classification_acknowledged_at TIMESTAMP,

  title                     TEXT NOT NULL,
  summary                   TEXT,
  scope_of_work             TEXT,
  requirements              TEXT,
  deliverables              TEXT,
  required_skills           JSONB NOT NULL DEFAULT '[]'::jsonb,
  experience_requirements   TEXT,

  work_location_type        TEXT NOT NULL DEFAULT 'onsite' CHECK (work_location_type IN ('onsite','remote','hybrid')),
  location_text             TEXT,

  recurrence_frequency      TEXT CHECK (recurrence_frequency IS NULL OR recurrence_frequency IN ('weekly','biweekly','monthly','quarterly','custom')),
  recurrence_description    TEXT,
  start_date                DATE,
  end_date                  DATE,
  application_deadline      TIMESTAMP,

  compensation_type         TEXT NOT NULL DEFAULT 'undisclosed' CHECK (compensation_type IN ('fixed_bid','hourly','salary','range','undisclosed')),
  compensation_min          NUMERIC(14,2) CHECK (compensation_min IS NULL OR compensation_min >= 0),
  compensation_max          NUMERIC(14,2) CHECK (compensation_max IS NULL OR compensation_max >= 0),
  currency                  TEXT NOT NULL DEFAULT 'USD',
  payment_terms             TEXT,

  -- Capacity: awards (contractor) or hires (employee). NULL = unlimited, recurring work only.
  number_of_openings        INTEGER CHECK (number_of_openings IS NULL OR number_of_openings >= 1),
  filled_count              INTEGER NOT NULL DEFAULT 0 CHECK (filled_count >= 0),

  visibility                TEXT NOT NULL DEFAULT 'all_eligible' CHECK (visibility IN ('all_eligible','invited_only','selected_groups')),
  eligible_groups           JSONB NOT NULL DEFAULT '[]'::jsonb,
  cost_job_id               VARCHAR,

  status                    TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','paused','closed','archived')),
  close_reason              TEXT,
  published_at              TIMESTAMP,
  closed_at                 TIMESTAMP,
  archived_at               TIMESTAMP,
  created_at                TIMESTAMP DEFAULT now(),
  updated_at                TIMESTAMP DEFAULT now(),

  -- Employee positions are always 'position'; contractor work never is.
  CONSTRAINT ck_job_posts_opportunity_class CHECK ((worker_classification = 'employee') = (opportunity_type = 'position')),
  -- Employee: employment_type required and equal to the part/full-time schedule. Contractor: none.
  CONSTRAINT ck_job_posts_employment_type CHECK (
    (worker_classification = 'employee' AND employment_type IS NOT NULL AND schedule_type = employment_type)
    OR (worker_classification = 'contractor' AND employment_type IS NULL)),
  CONSTRAINT ck_job_posts_project_schedule CHECK (opportunity_type <> 'project' OR schedule_type <> 'recurring'),
  CONSTRAINT ck_job_posts_recurring_schedule CHECK (opportunity_type <> 'recurring_work' OR schedule_type <> 'one_time'),
  -- Bids are a contractor concept; an employee position cannot be priced by bid.
  CONSTRAINT ck_job_posts_employee_comp CHECK (worker_classification <> 'employee' OR compensation_type <> 'fixed_bid'),
  CONSTRAINT ck_job_posts_hours_range CHECK (hours_per_week_min IS NULL OR hours_per_week_max IS NULL OR hours_per_week_min <= hours_per_week_max),
  CONSTRAINT ck_job_posts_comp_range CHECK (compensation_min IS NULL OR compensation_max IS NULL OR compensation_min <= compensation_max),
  CONSTRAINT ck_job_posts_dates CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date),
  CONSTRAINT ck_job_posts_unlimited_only_recurring CHECK (number_of_openings IS NOT NULL OR opportunity_type = 'recurring_work'),
  CONSTRAINT ck_job_posts_capacity CHECK (number_of_openings IS NULL OR filled_count <= number_of_openings)
);
CREATE INDEX IF NOT EXISTS idx_job_posts_company_status ON job_posts (company_id, status);
CREATE INDEX IF NOT EXISTS idx_job_posts_company_class ON job_posts (company_id, worker_classification, status);
CREATE INDEX IF NOT EXISTS idx_job_posts_tenant ON job_posts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_job_posts_expiry ON job_posts (end_date) WHERE status IN ('published','paused');

-- Classification can be changed only while the posting is a draft.
CREATE OR REPLACE FUNCTION job_posts_classification_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.worker_classification IS DISTINCT FROM OLD.worker_classification AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'job_posts.worker_classification cannot change after a posting leaves draft'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_job_posts_classification_frozen ON job_posts;
CREATE TRIGGER trg_job_posts_classification_frozen
  BEFORE UPDATE OF worker_classification ON job_posts
  FOR EACH ROW EXECUTE FUNCTION job_posts_classification_frozen();

-- Posting-level audit (status, classification, edits, invitations, questions).
CREATE TABLE IF NOT EXISTS job_post_events (
  id               VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        VARCHAR,
  company_id       VARCHAR NOT NULL REFERENCES companies(id),
  job_post_id      VARCHAR NOT NULL REFERENCES job_posts(id),
  event_type       TEXT NOT NULL,
  old_status       TEXT,
  new_status       TEXT,
  actor_user_id    VARCHAR,
  actor_worker_id  VARCHAR,
  details          JSONB,
  created_at       TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_post_events_post ON job_post_events (job_post_id, created_at);

-- Guard used by the submission tables: the posting must carry the expected classification.
CREATE OR REPLACE FUNCTION job_board_require_classification() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE cls text;
BEGIN
  SELECT worker_classification INTO cls FROM job_posts WHERE id = NEW.job_post_id;
  IF cls IS DISTINCT FROM TG_ARGV[0] THEN
    RAISE EXCEPTION '% rows may only reference % postings (posting is %)', TG_TABLE_NAME, TG_ARGV[0], COALESCE(cls, 'missing')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- CONTRACTOR PATH
-- ════════════════════════════════════════════════════════════════════════════

-- ── Bids / proposals (one active bid per contractor per posting) ────────────
CREATE TABLE IF NOT EXISTS contractor_job_bids (
  id                         VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  VARCHAR,
  company_id                 VARCHAR NOT NULL REFERENCES companies(id),
  job_post_id                VARCHAR NOT NULL REFERENCES job_posts(id),
  contractor_id              VARCHAR NOT NULL REFERENCES workers(id),
  submitted_by_user_id       VARCHAR,
  status                     TEXT NOT NULL DEFAULT 'draft'
                               CHECK (status IN ('draft','submitted','under_review','shortlisted','revision_requested',
                                                 'rejected','withdrawn','awarded','converted_to_proposal','converted_to_contract')),
  cover_message              TEXT,
  scope_and_deliverables     TEXT,
  proposed_amount            NUMERIC(14,2),
  rate_type                  TEXT CHECK (rate_type IS NULL OR rate_type IN ('fixed','hourly','recurring','custom')),
  hourly_rate                NUMERIC(14,2),
  estimated_hours            NUMERIC(10,2),
  proposed_schedule          TEXT,
  availability               TEXT,
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

DROP TRIGGER IF EXISTS trg_contractor_job_bids_contractor_only ON contractor_job_bids;
CREATE TRIGGER trg_contractor_job_bids_contractor_only
  BEFORE INSERT OR UPDATE OF job_post_id ON contractor_job_bids
  FOR EACH ROW EXECUTE FUNCTION job_board_require_classification('contractor');

-- ── Immutable bid revisions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contractor_job_bid_versions (
  id                  VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           VARCHAR,
  company_id          VARCHAR NOT NULL REFERENCES companies(id),
  job_post_id         VARCHAR NOT NULL REFERENCES job_posts(id),
  bid_id              VARCHAR NOT NULL REFERENCES contractor_job_bids(id),
  revision_number     INTEGER NOT NULL,
  snapshot            JSONB NOT NULL,
  created_by_user_id  VARCHAR,
  created_at          TIMESTAMP DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contractor_job_bid_versions_rev ON contractor_job_bid_versions (bid_id, revision_number);

-- ── Immutable bid events ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contractor_job_bid_events (
  id               VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        VARCHAR,
  company_id       VARCHAR NOT NULL REFERENCES companies(id),
  job_post_id      VARCHAR NOT NULL REFERENCES job_posts(id),
  bid_id           VARCHAR NOT NULL REFERENCES contractor_job_bids(id),
  event_type       TEXT NOT NULL,
  old_status       TEXT,
  new_status       TEXT,
  actor_user_id    VARCHAR,
  actor_worker_id  VARCHAR,
  details          JSONB,
  created_at       TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contractor_job_bid_events_post ON contractor_job_bid_events (job_post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_contractor_job_bid_events_bid ON contractor_job_bid_events (bid_id);

-- ── Invitations (contractor postings) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS contractor_job_invitations (
  id                   VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            VARCHAR,
  company_id           VARCHAR NOT NULL REFERENCES companies(id),
  job_post_id          VARCHAR NOT NULL REFERENCES job_posts(id),
  contractor_id        VARCHAR NOT NULL REFERENCES workers(id),
  invited_by_user_id   VARCHAR NOT NULL,
  status               TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','revoked')),
  invited_at           TIMESTAMP DEFAULT now(),
  revoked_at           TIMESTAMP,
  revoked_by_user_id   VARCHAR
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contractor_job_invitations_post_contractor ON contractor_job_invitations (job_post_id, contractor_id);
CREATE INDEX IF NOT EXISTS idx_contractor_job_invitations_contractor ON contractor_job_invitations (contractor_id) WHERE status = 'invited';

DROP TRIGGER IF EXISTS trg_contractor_job_invitations_contractor_only ON contractor_job_invitations;
CREATE TRIGGER trg_contractor_job_invitations_contractor_only
  BEFORE INSERT OR UPDATE OF job_post_id ON contractor_job_invitations
  FOR EACH ROW EXECUTE FUNCTION job_board_require_classification('contractor');

-- ── Questions (contractor postings) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contractor_job_questions (
  id                   VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            VARCHAR,
  company_id           VARCHAR NOT NULL REFERENCES companies(id),
  job_post_id          VARCHAR NOT NULL REFERENCES job_posts(id),
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

DROP TRIGGER IF EXISTS trg_contractor_job_questions_contractor_only ON contractor_job_questions;
CREATE TRIGGER trg_contractor_job_questions_contractor_only
  BEFORE INSERT OR UPDATE OF job_post_id ON contractor_job_questions
  FOR EACH ROW EXECUTE FUNCTION job_board_require_classification('contractor');

-- ── Posting + contractor-bid attachments (private storage; never /uploads) ──
-- Employee application documents are NOT stored here — see employment_application_documents.
CREATE TABLE IF NOT EXISTS job_post_attachments (
  id                     VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              VARCHAR,
  company_id             VARCHAR NOT NULL REFERENCES companies(id),
  job_post_id            VARCHAR NOT NULL REFERENCES job_posts(id),
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
CREATE INDEX IF NOT EXISTS idx_job_post_attachments_post ON job_post_attachments (job_post_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_job_post_attachments_bid ON job_post_attachments (bid_id) WHERE bid_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- EMPLOYEE PATH (hiring only — no proposal/contract/invoice/payment linkage)
-- ════════════════════════════════════════════════════════════════════════════

-- ── Screening questions (per employee posting) ──────────────────────────────
CREATE TABLE IF NOT EXISTS job_screening_questions (
  id                  VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           VARCHAR,
  company_id          VARCHAR NOT NULL REFERENCES companies(id),
  job_post_id         VARCHAR NOT NULL REFERENCES job_posts(id),
  prompt              TEXT NOT NULL,
  answer_type         TEXT NOT NULL DEFAULT 'text' CHECK (answer_type IN ('text','yes_no','choice','number')),
  options             JSONB NOT NULL DEFAULT '[]'::jsonb,
  required            BOOLEAN NOT NULL DEFAULT FALSE,
  position            INTEGER NOT NULL DEFAULT 0,
  created_by_user_id  VARCHAR NOT NULL,
  archived_at         TIMESTAMP,
  created_at          TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_screening_questions_post ON job_screening_questions (job_post_id) WHERE archived_at IS NULL;

DROP TRIGGER IF EXISTS trg_job_screening_questions_employee_only ON job_screening_questions;
CREATE TRIGGER trg_job_screening_questions_employee_only
  BEFORE INSERT OR UPDATE OF job_post_id ON job_screening_questions
  FOR EACH ROW EXECUTE FUNCTION job_board_require_classification('employee');

-- ── Applications (one active application per applicant per posting) ─────────
CREATE TABLE IF NOT EXISTS employment_applications (
  id                         VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  VARCHAR,
  company_id                 VARCHAR NOT NULL REFERENCES companies(id),
  job_post_id                VARCHAR NOT NULL REFERENCES job_posts(id),
  applicant_user_id          VARCHAR NOT NULL,
  applicant_worker_id        VARCHAR REFERENCES workers(id),
  status                     TEXT NOT NULL DEFAULT 'draft'
                               CHECK (status IN ('draft','submitted','under_review','interviewing','offer_extended',
                                                 'hired','rejected','withdrawn')),
  cover_message              TEXT,
  availability               TEXT,
  desired_compensation       TEXT,
  qualifications             TEXT,
  consent_version            TEXT,
  consent_accepted_at        TIMESTAMP,
  acknowledgements           JSONB NOT NULL DEFAULT '{}'::jsonb,
  submitted_at               TIMESTAMP,
  withdrawn_at               TIMESTAMP,
  reviewed_at                TIMESTAMP,
  reviewed_by_user_id        VARCHAR,
  rejection_reason           TEXT,
  hired_at                   TIMESTAMP,
  hired_by_user_id           VARCHAR,
  -- Set only by the explicit "create worker record" action; worker_type copied from the posting.
  converted_worker_id        VARCHAR REFERENCES workers(id),
  converted_worker_type      TEXT CHECK (converted_worker_type IS NULL OR converted_worker_type = 'employee'),
  converted_at               TIMESTAMP,
  converted_by_user_id       VARCHAR,
  created_at                 TIMESTAMP DEFAULT now(),
  updated_at                 TIMESTAMP DEFAULT now(),
  CONSTRAINT ck_employment_applications_conversion CHECK (converted_worker_id IS NULL OR (status = 'hired' AND converted_worker_type = 'employee'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_employment_applications_active ON employment_applications (job_post_id, applicant_user_id) WHERE status <> 'withdrawn';
CREATE UNIQUE INDEX IF NOT EXISTS uq_employment_applications_converted ON employment_applications (converted_worker_id) WHERE converted_worker_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employment_applications_post_status ON employment_applications (job_post_id, status);
CREATE INDEX IF NOT EXISTS idx_employment_applications_applicant ON employment_applications (applicant_user_id);
CREATE INDEX IF NOT EXISTS idx_employment_applications_company ON employment_applications (company_id);

DROP TRIGGER IF EXISTS trg_employment_applications_employee_only ON employment_applications;
CREATE TRIGGER trg_employment_applications_employee_only
  BEFORE INSERT OR UPDATE OF job_post_id ON employment_applications
  FOR EACH ROW EXECUTE FUNCTION job_board_require_classification('employee');

-- ── Screening answers (prompt copied so later edits never rewrite history) ──
CREATE TABLE IF NOT EXISTS employment_application_answers (
  id               VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        VARCHAR,
  company_id       VARCHAR NOT NULL REFERENCES companies(id),
  application_id   VARCHAR NOT NULL REFERENCES employment_applications(id),
  question_id      VARCHAR NOT NULL REFERENCES job_screening_questions(id),
  question_prompt  TEXT NOT NULL,
  answer           TEXT,
  created_at       TIMESTAMP DEFAULT now(),
  updated_at       TIMESTAMP DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_employment_application_answers ON employment_application_answers (application_id, question_id);

-- ── Immutable application events (status changes + private-document access) ─
CREATE TABLE IF NOT EXISTS employment_application_events (
  id               VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        VARCHAR,
  company_id       VARCHAR NOT NULL REFERENCES companies(id),
  job_post_id      VARCHAR NOT NULL REFERENCES job_posts(id),
  application_id   VARCHAR NOT NULL REFERENCES employment_applications(id),
  event_type       TEXT NOT NULL,
  old_status       TEXT,
  new_status       TEXT,
  actor_user_id    VARCHAR,
  details          JSONB,
  created_at       TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employment_application_events_app ON employment_application_events (application_id, created_at);
CREATE INDEX IF NOT EXISTS idx_employment_application_events_post ON employment_application_events (job_post_id, created_at);

-- ── Private HR documents (résumé/CV etc.) — separate store, separate route ──
CREATE TABLE IF NOT EXISTS employment_application_documents (
  id                     VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              VARCHAR,
  company_id             VARCHAR NOT NULL REFERENCES companies(id),
  job_post_id            VARCHAR NOT NULL REFERENCES job_posts(id),
  application_id         VARCHAR NOT NULL REFERENCES employment_applications(id),
  document_type          TEXT NOT NULL DEFAULT 'resume' CHECK (document_type IN ('resume','cover_letter','certification','other')),
  storage_key            TEXT NOT NULL,
  file_name              TEXT NOT NULL,
  content_type           TEXT,
  file_size              INTEGER,
  uploaded_by_user_id    VARCHAR NOT NULL,
  removed_at             TIMESTAMP,
  removed_by_user_id     VARCHAR,
  created_at             TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employment_application_documents_app ON employment_application_documents (application_id) WHERE removed_at IS NULL;

-- ── Audit immutability (UPDATE only — see header for why not DELETE) ────────
CREATE OR REPLACE FUNCTION contractor_job_audit_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME;
END $$;

DROP TRIGGER IF EXISTS trg_job_post_events_immutable ON job_post_events;
CREATE TRIGGER trg_job_post_events_immutable
  BEFORE UPDATE ON job_post_events
  FOR EACH ROW EXECUTE FUNCTION contractor_job_audit_immutable();

DROP TRIGGER IF EXISTS trg_contractor_job_bid_events_immutable ON contractor_job_bid_events;
CREATE TRIGGER trg_contractor_job_bid_events_immutable
  BEFORE UPDATE ON contractor_job_bid_events
  FOR EACH ROW EXECUTE FUNCTION contractor_job_audit_immutable();

DROP TRIGGER IF EXISTS trg_contractor_job_bid_versions_immutable ON contractor_job_bid_versions;
CREATE TRIGGER trg_contractor_job_bid_versions_immutable
  BEFORE UPDATE ON contractor_job_bid_versions
  FOR EACH ROW EXECUTE FUNCTION contractor_job_audit_immutable();

DROP TRIGGER IF EXISTS trg_employment_application_events_immutable ON employment_application_events;
CREATE TRIGGER trg_employment_application_events_immutable
  BEFORE UPDATE ON employment_application_events
  FOR EACH ROW EXECUTE FUNCTION contractor_job_audit_immutable();

-- ── Award → proposal linkage on the existing proposal table ─────────────────
ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS job_post_id VARCHAR;
ALTER TABLE contractor_proposals ADD COLUMN IF NOT EXISTS job_bid_id VARCHAR;
CREATE UNIQUE INDEX IF NOT EXISTS uq_contractor_proposals_job_bid_id ON contractor_proposals (job_bid_id) WHERE job_bid_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contractor_proposals_job_post_id ON contractor_proposals (job_post_id) WHERE job_post_id IS NOT NULL;

-- A proposal linked to a posting must come from a contractor posting. Fires only
-- when job_post_id is set, so every existing proposal path is unaffected.
DROP TRIGGER IF EXISTS trg_contractor_proposals_job_post_contractor_only ON contractor_proposals;
CREATE TRIGGER trg_contractor_proposals_job_post_contractor_only
  BEFORE INSERT OR UPDATE OF job_post_id ON contractor_proposals
  FOR EACH ROW WHEN (NEW.job_post_id IS NOT NULL)
  EXECUTE FUNCTION job_board_require_classification('contractor');

INSERT INTO paylink_migrations.applied (version, name)
VALUES ('0029', 'job_board')
ON CONFLICT (version) DO NOTHING;

COMMIT;
