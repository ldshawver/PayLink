-- Additive schema drift repair for contract Documenso sent timestamps.
-- Backup before applying in production:
--   pg_dump "$DATABASE_URL" > backups/pre_0012_documenso_sent_at_repair_$(date +%Y%m%d_%H%M%S).sql
ALTER TABLE documenso_signature_requests
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE contract_signers
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE contractor_contracts
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_documenso_signature_requests_contract_sent_at
  ON documenso_signature_requests(document_type, related_record_id, company_id, sent_at);
