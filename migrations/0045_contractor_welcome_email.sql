-- 0045 — Contractor welcome email: a transactional email outbox + purpose-bound,
-- single-use password-setup tokens.
--
--   email_outbox                       one row per LOGICAL message (unique
--                                      dedupe_key). Holds delivery state and
--                                      retry bookkeeping only — never the
--                                      recipient address, the body or a token.
--                                      The message is rendered at send time.
--   contractor_password_setup_tokens   sha256(token) only, bound to purpose,
--                                      company, worker, user, onboarding and
--                                      outbox row.
--                                      At most one PENDING token per
--                                      (worker, purpose); a replacement revokes
--                                      the previous one.
--
-- Additive only. Versioning: records '0045'. Requires 0041 (employee-number counters). Renumber if a later migration takes 0045 before this merges.
-- Rollback: code that predates this ignores both tables; they can stay.
--
-- Apply AS THE ROLE THAT OWNS THE APP TABLES:
--   psql "<app DATABASE_URL>" -v ON_ERROR_STOP=1 -f migrations/0045_contractor_welcome_email.sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $$
DECLARE app_owner text;
BEGIN
  SELECT tableowner INTO app_owner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'companies';
  IF app_owner IS NULL THEN RAISE EXCEPTION '0045: public.companies not found — wrong database?'; END IF;
  IF app_owner <> current_user THEN RAISE EXCEPTION '0045: run as the app table owner (%), not %', app_owner, current_user; END IF;
  IF to_regclass('paylink_migrations.applied') IS NULL OR NOT EXISTS (SELECT 1 FROM paylink_migrations.applied WHERE version = '0041') THEN
    RAISE EXCEPTION '0045: apply 0041 first';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS email_outbox (
  id               VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             TEXT NOT NULL,
  dedupe_key       TEXT NOT NULL,
  company_id       VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  worker_id        VARCHAR REFERENCES workers(id) ON DELETE CASCADE,
  subject_id       VARCHAR,
  status           TEXT NOT NULL DEFAULT 'queued',
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 5,
  next_attempt_at  TIMESTAMP NOT NULL DEFAULT now(),
  claimed_at       TIMESTAMP,
  last_attempt_at  TIMESTAMP,
  sent_at          TIMESTAMP,
  last_error_code  TEXT,
  created_at       TIMESTAMP NOT NULL DEFAULT now(),
  updated_at       TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT ck_email_outbox_status CHECK (status IN ('queued','sending','sent','failed','dead')),
  CONSTRAINT ck_email_outbox_kind CHECK (kind ~ '^[a-z_]{3,60}$'),
  CONSTRAINT ck_email_outbox_error CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z_]{3,40}$'),
  CONSTRAINT ck_email_outbox_attempts CHECK (attempt_count >= 0 AND max_attempts >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_outbox_dedupe ON email_outbox (dedupe_key);
CREATE INDEX IF NOT EXISTS idx_email_outbox_due ON email_outbox (kind, status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_email_outbox_company ON email_outbox (company_id);

CREATE TABLE IF NOT EXISTS contractor_password_setup_tokens (
  id              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash      TEXT NOT NULL,
  purpose         TEXT NOT NULL,
  company_id      VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  worker_id       VARCHAR NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  user_id         VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  onboarding_id   VARCHAR NOT NULL REFERENCES worker_onboarding(id) ON DELETE CASCADE,
  outbox_id       VARCHAR REFERENCES email_outbox(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  expires_at      TIMESTAMP NOT NULL,
  used_at         TIMESTAMP,
  revoked_at      TIMESTAMP,
  revoked_reason  TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT ck_cpst_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_cpst_purpose CHECK (purpose ~ '^[a-z_]{3,60}$'),
  CONSTRAINT ck_cpst_status CHECK (status IN ('pending','used','revoked')),
  CONSTRAINT ck_cpst_reason CHECK (revoked_reason IS NULL OR revoked_reason ~ '^[a-z_]{3,40}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cpst_token_hash ON contractor_password_setup_tokens (token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cpst_one_pending ON contractor_password_setup_tokens (worker_id, purpose) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_cpst_company ON contractor_password_setup_tokens (company_id);

INSERT INTO paylink_migrations.applied (version, name)
VALUES ('0045', 'contractor_welcome_email')
ON CONFLICT (version) DO NOTHING;

COMMIT;
