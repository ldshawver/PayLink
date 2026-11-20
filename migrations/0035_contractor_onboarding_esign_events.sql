-- 0035 — Replay protection for Documenso onboarding webhooks.
--
-- One row per distinct webhook body (SHA-256 of the raw bytes). A second
-- delivery of the same body is a no-op; a body that previously failed with a
-- transient error may be processed again. The table never stores the payload
-- (it can contain names, emails and typed W-9 values) — only the hash, the
-- event name, the Documenso document id and the outcome.
--
-- Additive only. Versioning: records '0035'. Requires 0033.
-- Apply AS THE ROLE THAT OWNS THE APP TABLES:
--   psql "<app DATABASE_URL>" -v ON_ERROR_STOP=1 -f migrations/0035_contractor_onboarding_esign_events.sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $$
DECLARE app_owner text;
BEGIN
  SELECT tableowner INTO app_owner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'companies';
  IF app_owner IS NULL THEN RAISE EXCEPTION '0035: public.companies not found — wrong database?'; END IF;
  IF app_owner <> current_user THEN RAISE EXCEPTION '0035: run as the app table owner (%), not %', app_owner, current_user; END IF;
  IF to_regclass('paylink_migrations.applied') IS NULL OR NOT EXISTS (SELECT 1 FROM paylink_migrations.applied WHERE version = '0033') THEN
    RAISE EXCEPTION '0035: apply 0033 first';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS contractor_onboarding_esign_events (
  id                     VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  body_sha256            TEXT NOT NULL,
  event_type             TEXT,
  documenso_document_id  TEXT,
  outcome                TEXT NOT NULL,
  received_at            TIMESTAMP NOT NULL DEFAULT now(),
  processed_at           TIMESTAMP,
  CONSTRAINT ck_coee_sha CHECK (body_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_coee_body ON contractor_onboarding_esign_events (body_sha256);
CREATE INDEX IF NOT EXISTS idx_coee_document ON contractor_onboarding_esign_events (documenso_document_id);

INSERT INTO paylink_migrations.applied (version, name)
VALUES ('0035', 'contractor_onboarding_esign_events')
ON CONFLICT (version) DO NOTHING;

COMMIT;
