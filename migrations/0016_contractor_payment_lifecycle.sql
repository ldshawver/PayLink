-- 0016 — contractor payment lifecycle: idempotency, void/reversal audit, reissue linkage.
--
-- Additive only. Every column is nullable (or has a non-breaking default) so a
-- NEW column starts NULL/false for every existing row and cannot violate on
-- historical data. The partial unique indexes only constrain populated values.
-- Historical free-text contractor_payments.payment_method values are NOT
-- rewritten or reinterpreted — only new writes are validated by the app.
--
-- Backup before applying in production:
--   pg_dump "$DATABASE_URL" > backups/pre_0016_contractor_payment_lifecycle_$(date +%Y%m%d_%H%M%S).sql
--
-- Rollback: see the block at the bottom of this file.

-- ── contractor_payments: idempotency ────────────────────────────────────────
ALTER TABLE contractor_payments ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE contractor_payments ADD COLUMN IF NOT EXISTS idempotency_fingerprint TEXT;

-- ── contractor_payments: void / reversal audit (original row is never deleted) ──
ALTER TABLE contractor_payments ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP;
ALTER TABLE contractor_payments ADD COLUMN IF NOT EXISTS voided_by_user_id VARCHAR;
ALTER TABLE contractor_payments ADD COLUMN IF NOT EXISTS void_reason TEXT;

-- ── contractor_payments: reissue / reversal linkage ─────────────────────────
ALTER TABLE contractor_payments ADD COLUMN IF NOT EXISTS reverses_payment_id VARCHAR;
ALTER TABLE contractor_payments ADD COLUMN IF NOT EXISTS reissued_by_payment_id VARCHAR;

-- ── contractor_trade_compensation: idempotency ─────────────────────────────
ALTER TABLE contractor_trade_compensation ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- ── company-scoped partial unique indexes ─────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_contractor_payments_company_idempotency_key
  ON contractor_payments (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_contractor_trade_comp_company_idempotency_key
  ON contractor_trade_compensation (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Fast lookup of the payment linked to a trade-compensation record (void path).
CREATE INDEX IF NOT EXISTS idx_contractor_trade_comp_payment_id
  ON contractor_trade_compensation (contractor_payment_id)
  WHERE contractor_payment_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (verified against a disposable current-schema clone):
--
--   DROP INDEX IF EXISTS uq_contractor_payments_company_idempotency_key;
--   DROP INDEX IF EXISTS uq_contractor_trade_comp_company_idempotency_key;
--   DROP INDEX IF EXISTS idx_contractor_trade_comp_payment_id;
--   ALTER TABLE contractor_payments DROP COLUMN IF EXISTS idempotency_key;
--   ALTER TABLE contractor_payments DROP COLUMN IF EXISTS idempotency_fingerprint;
--   ALTER TABLE contractor_payments DROP COLUMN IF EXISTS voided_at;
--   ALTER TABLE contractor_payments DROP COLUMN IF EXISTS voided_by_user_id;
--   ALTER TABLE contractor_payments DROP COLUMN IF EXISTS void_reason;
--   ALTER TABLE contractor_payments DROP COLUMN IF EXISTS reverses_payment_id;
--   ALTER TABLE contractor_payments DROP COLUMN IF EXISTS reissued_by_payment_id;
--   ALTER TABLE contractor_trade_compensation DROP COLUMN IF EXISTS idempotency_key;
-- ─────────────────────────────────────────────────────────────────────────────
