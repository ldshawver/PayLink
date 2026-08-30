-- 0017 — expense_payments ledger for vendor/expense Cut Check (Release B2).
--
-- Additive only: a new table + indexes. Nothing on `expenses` is altered; the
-- expense's authoritative unpaid balance is derived from this ledger
-- (amount - SUM(non-void expense_payments)). Foreign keys follow the repo
-- convention (varchar id, ON DELETE NO ACTION — never cascade financial history).
--
-- Backup before applying in production:
--   pg_dump "$DATABASE_URL" > backups/pre_0017_expense_payments_$(date +%Y%m%d_%H%M%S).sql
--
-- Rollback: see the block at the bottom of this file.

CREATE TABLE IF NOT EXISTS expense_payments (
  id                     VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             VARCHAR NOT NULL REFERENCES companies(id),
  expense_id             VARCHAR NOT NULL REFERENCES expenses(id),
  remittance_source_id   VARCHAR REFERENCES remittance_sources(id),
  amount                 NUMERIC NOT NULL,
  payment_method         TEXT NOT NULL DEFAULT 'check',
  status                 TEXT NOT NULL DEFAULT 'completed',   -- completed | void
  reference_number       TEXT,                                -- check number
  idempotency_key        TEXT,
  idempotency_fingerprint TEXT,
  issued_at              TIMESTAMP DEFAULT now(),
  created_by_user_id     VARCHAR,
  voided_at              TIMESTAMP,
  voided_by_user_id      VARCHAR,
  void_reason            TEXT,
  reverses_payment_id    VARCHAR,
  reissued_by_payment_id VARCHAR,
  created_at             TIMESTAMP DEFAULT now()
);

-- Company-scoped active idempotency keys.
CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_payments_company_idempotency_key
  ON expense_payments (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Active check-number uniqueness per funding account (matches the check-number model).
CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_payments_funding_check_number
  ON expense_payments (remittance_source_id, reference_number)
  WHERE status <> 'void' AND reference_number IS NOT NULL AND remittance_source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_expense_payments_expense_id ON expense_payments (expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_payments_company_id ON expense_payments (company_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (verified against a disposable current-schema clone):
--
--   DROP INDEX IF EXISTS uq_expense_payments_company_idempotency_key;
--   DROP INDEX IF EXISTS uq_expense_payments_funding_check_number;
--   DROP INDEX IF EXISTS idx_expense_payments_expense_id;
--   DROP INDEX IF EXISTS idx_expense_payments_company_id;
--   DROP TABLE IF EXISTS expense_payments;
-- ─────────────────────────────────────────────────────────────────────────────
