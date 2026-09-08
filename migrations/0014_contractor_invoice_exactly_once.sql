-- Adds a dedicated idempotency key for the Documenso-completion exactly-once
-- auto-invoice path. Nullable, populated only by that path -- existing/manual
-- invoice rows are left untouched (NULL), so this cannot violate on historical
-- data (a NEW column starts NULL for every existing row, and a partial unique
-- index only constrains populated values).
--
-- Backup before applying in production:
--   pg_dump "$DATABASE_URL" > backups/pre_0014_contractor_invoice_exactly_once_$(date +%Y%m%d_%H%M%S).sql
ALTER TABLE contractor_invoices
  ADD COLUMN IF NOT EXISTS documenso_completion_idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_contractor_invoices_auto_invoice_key
  ON contractor_invoices (company_id, documenso_completion_idempotency_key)
  WHERE documenso_completion_idempotency_key IS NOT NULL;
