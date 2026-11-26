-- 0042 — Contractor onboarding e-signature: per-company Documenso template
-- mappings + one active signature request per onboarding step.
--
-- Additive only:
--   contractor_onboarding_esign_templates   which Documenso template (and which
--       template recipient slot) a company uses for each onboarding document
--       kind. Nothing is hard-coded: no row (or a row that is not enabled and
--       approved) means sending is refused with an administrator message.
--   uq_documenso_req_onboarding_active      at most one live request per
--       (onboarding step, document type) for the two NEW document types only;
--       existing document types/rows are not covered, so it cannot conflict
--       with existing data.
--
-- The table holds template identifiers only — never a document, a field value,
-- a tax ID or a signature.
--
-- Versioning: records '0042' in paylink_migrations.applied. Rerun: a no-op.
-- Requires 0041 (employee-number counters). Renumber if a later migration takes 0042 before this merges. Rollback: the application treats a missing
-- table as "not configured" and refuses to send, so the code can be rolled
-- back or forward independently; the table/index can stay.
--
-- Apply AS THE ROLE THAT OWNS THE APP TABLES:
--   psql "<app DATABASE_URL>" -v ON_ERROR_STOP=1 -f migrations/0042_contractor_onboarding_esign.sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $$
DECLARE app_owner text;
BEGIN
  SELECT tableowner INTO app_owner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'companies';
  IF app_owner IS NULL THEN RAISE EXCEPTION '0042: public.companies not found — wrong database?'; END IF;
  IF app_owner <> current_user THEN RAISE EXCEPTION '0042: run as the app table owner (%), not %', app_owner, current_user; END IF;
  IF to_regclass('paylink_migrations.applied') IS NULL OR NOT EXISTS (SELECT 1 FROM paylink_migrations.applied WHERE version = '0041') THEN
    RAISE EXCEPTION '0042: apply 0041 first';
  END IF;
  IF to_regclass('public.documenso_signature_requests') IS NULL THEN
    RAISE EXCEPTION '0042: documenso_signature_requests not found — wrong database?';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS contractor_onboarding_esign_templates (
  id                      VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  document_kind           TEXT NOT NULL,
  provider                TEXT NOT NULL DEFAULT 'documenso',
  template_id             TEXT NOT NULL,
  template_recipient_id   TEXT,
  enabled                 BOOLEAN NOT NULL DEFAULT false,
  approved_by_user_id     VARCHAR,
  approved_at             TIMESTAMP,
  updated_by_user_id      VARCHAR,
  created_at              TIMESTAMP NOT NULL DEFAULT now(),
  updated_at              TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT ck_coet_kind CHECK (document_kind IN ('contractor_agreement','w9')),
  CONSTRAINT ck_coet_provider CHECK (provider IN ('documenso')),
  CONSTRAINT ck_coet_template_id CHECK (template_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  CONSTRAINT ck_coet_recipient_id CHECK (template_recipient_id IS NULL OR template_recipient_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  CONSTRAINT ck_coet_enabled_needs_approval CHECK (NOT enabled OR (approved_at IS NOT NULL AND approved_by_user_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_coet_company_kind ON contractor_onboarding_esign_templates (company_id, document_kind);

CREATE UNIQUE INDEX IF NOT EXISTS uq_documenso_req_onboarding_active
  ON documenso_signature_requests (related_record_id, document_type)
  WHERE document_type IN ('contractor_onboarding_agreement','contractor_onboarding_w9')
    AND status NOT IN ('error','voided','declined','expired');

INSERT INTO paylink_migrations.applied (version, name)
VALUES ('0042', 'contractor_onboarding_esign')
ON CONFLICT (version) DO NOTHING;

COMMIT;
