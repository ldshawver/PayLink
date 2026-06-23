-- Additive schema drift repair for push notification preferences.
-- Backup before applying in production:
--   pg_dump "$DATABASE_URL" > backups/pre_0011_notification_preferences_push_enabled_$(date +%Y%m%d_%H%M%S).sql
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- Contract Documenso metadata persistence repair (additive only).
ALTER TABLE documenso_signature_requests
  ADD COLUMN IF NOT EXISTS documenso_signing_url TEXT;
ALTER TABLE documenso_signature_requests
  ADD COLUMN IF NOT EXISTS documenso_recipient_ids JSONB;
ALTER TABLE contract_signers
  ADD COLUMN IF NOT EXISTS documenso_recipient_id TEXT;
ALTER TABLE contract_signers
  ADD COLUMN IF NOT EXISTS documenso_signing_url TEXT;
CREATE INDEX IF NOT EXISTS idx_documenso_signature_requests_contract
  ON documenso_signature_requests(document_type, related_record_id, company_id);
