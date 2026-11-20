-- 0034 — Private personnel documents (government ID now; signed agreement and
-- signed W-9 in a later PR) + an access log for every upload, view and download.
--
-- Files are NOT under /uploads and have no URL. They are encrypted by the
-- application (AES-256-GCM, key from the environment) and written to a private
-- directory; this table stores only metadata needed to find and decrypt them:
-- a random storage id, MIME type, size, a ciphertext checksum, the key id, IV
-- and auth tag. Never stored: original file names, extracted values, tax IDs.
--
--   private_personnel_documents   one row per stored file; superseded rows are
--                                 kept (never overwritten); one ACTIVE row per
--                                 (worker, kind)
--   private_document_access_log   who did what to which document, when — no
--                                 file names, values or URLs
--
-- Additive only. Versioning: records '0034'. Requires 0031 (ledger schema).
-- Rollback: code that predates this ignores both tables; they can stay.
--
-- Apply AS THE ROLE THAT OWNS THE APP TABLES:
--   psql "<app DATABASE_URL>" -v ON_ERROR_STOP=1 -f migrations/0034_private_personnel_documents.sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $$
DECLARE app_owner text;
BEGIN
  SELECT tableowner INTO app_owner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'companies';
  IF app_owner IS NULL THEN RAISE EXCEPTION '0034: public.companies not found — wrong database?'; END IF;
  IF app_owner <> current_user THEN RAISE EXCEPTION '0034: run as the app table owner (%), not %', app_owner, current_user; END IF;
  IF to_regclass('paylink_migrations.applied') IS NULL OR NOT EXISTS (SELECT 1 FROM paylink_migrations.applied WHERE version = '0031') THEN
    RAISE EXCEPTION '0034: apply 0031 first';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS private_personnel_documents (
  id                   VARCHAR PRIMARY KEY,
  company_id           VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  worker_id            VARCHAR NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  onboarding_id        VARCHAR REFERENCES worker_onboarding(id) ON DELETE SET NULL,
  document_kind        TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'active',
  mime_type            TEXT NOT NULL,
  byte_size            INTEGER NOT NULL,
  ciphertext_sha256    TEXT NOT NULL,
  enc_key_id           TEXT NOT NULL,
  enc_iv               TEXT NOT NULL,
  enc_tag              TEXT NOT NULL,
  uploaded_by_user_id  VARCHAR NOT NULL,
  superseded_at        TIMESTAMP,
  created_at           TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT ck_ppd_kind CHECK (document_kind IN ('government_id_front','government_id_back','signed_contractor_agreement','signed_w9')),
  CONSTRAINT ck_ppd_status CHECK (status IN ('active','superseded')),
  CONSTRAINT ck_ppd_mime CHECK (mime_type IN ('image/jpeg','image/png','application/pdf','image/heic')),
  CONSTRAINT ck_ppd_size CHECK (byte_size > 0 AND byte_size <= 15728640),
  CONSTRAINT ck_ppd_id CHECK (id ~ '^[0-9a-f-]{36}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ppd_active_kind ON private_personnel_documents (worker_id, document_kind) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_ppd_company_worker ON private_personnel_documents (company_id, worker_id);

CREATE TABLE IF NOT EXISTS private_document_access_log (
  id             VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id    VARCHAR NOT NULL,
  company_id     VARCHAR NOT NULL,
  worker_id      VARCHAR NOT NULL,
  actor_user_id  VARCHAR NOT NULL,
  actor_role     TEXT NOT NULL,
  action         TEXT NOT NULL,
  outcome        TEXT NOT NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT ck_pdal_action CHECK (action IN ('upload','view','download')),
  CONSTRAINT ck_pdal_outcome CHECK (outcome IN ('allowed','denied'))
);
CREATE INDEX IF NOT EXISTS idx_pdal_document ON private_document_access_log (document_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pdal_company ON private_document_access_log (company_id, created_at);

INSERT INTO paylink_migrations.applied (version, name)
VALUES ('0034', 'private_personnel_documents')
ON CONFLICT (version) DO NOTHING;

COMMIT;
