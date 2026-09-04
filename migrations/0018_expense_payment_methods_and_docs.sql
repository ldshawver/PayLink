-- 0018 — non-check expense payment methods + payment-document linkage.
--
-- Additive only. Release B2 (migration 0017) shipped `expense_payments` as a
-- CHECK-ONLY ledger. This migration lets the same ledger record the other
-- payment methods the Contractor/Vendor payment UI already offers on the
-- contractor side (cash, ACH, trade/barter, rent credit, other) without a
-- second ledger:
--
--   expense_payments.notes                — free-text description; REQUIRED by the
--                                           app for trade_credit / rent_credit / other
--   expense_payments.payment_date         — the effective date the money changed
--                                           hands, independent of check issuance
--   expense_payments.trade_compensation_id — link to ONE approved fair-market-value
--                                           contractor_trade_compensation record
--   expense_payments.payee_user_id        — the contractor user, when the vendor is
--                                           a known contractor (needed to match a
--                                           trade-compensation record to its owner)
--
--   contractor_trade_compensation.expense_payment_id — mirror of the existing
--                                           contractor_payment_id column, so an
--                                           approved trade credit binds to exactly
--                                           one expense payment and cannot be
--                                           double-posted.
--
-- Every column is nullable / has a non-breaking default, so a NEW column starts
-- NULL for every existing row and cannot violate on historical data. The partial
-- unique index only constrains populated values. Historical free-text
-- expense_payments.payment_method values are NOT rewritten — only new writes are
-- validated by the app.
--
-- This migration does NOT touch `expenses`, `contractor_invoices`,
-- `trade_transactions`, or any 1099 / tax-summary path.
--
-- Backup before applying in production:
--   pg_dump "$DATABASE_URL" > backups/pre_0018_expense_payment_methods_$(date +%Y%m%d_%H%M%S).sql

ALTER TABLE expense_payments ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE expense_payments ADD COLUMN IF NOT EXISTS payment_date TIMESTAMP;
ALTER TABLE expense_payments ADD COLUMN IF NOT EXISTS trade_compensation_id VARCHAR REFERENCES contractor_trade_compensation(id);
ALTER TABLE expense_payments ADD COLUMN IF NOT EXISTS payee_user_id VARCHAR;

ALTER TABLE contractor_trade_compensation ADD COLUMN IF NOT EXISTS expense_payment_id VARCHAR;

-- One approved trade-compensation record binds to at most one non-void expense payment.
CREATE UNIQUE INDEX IF NOT EXISTS uq_contractor_trade_comp_expense_payment_id
  ON contractor_trade_compensation (expense_payment_id)
  WHERE expense_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_expense_payments_trade_compensation_id
  ON expense_payments (trade_compensation_id)
  WHERE trade_compensation_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK
--
-- Purely additive. The preferred rollback for a released build is a COMPATIBLE
-- CODE ROLLBACK (redeploy the prior application tag) while LEAVING THIS SCHEMA
-- IN PLACE — the prior code never reads the new columns, so they are inert.
-- Once a single non-check expense payment or trade link exists, these columns
-- carry financial history and must never be dropped.
--
-- Destructive teardown — DISPOSABLE TEST DATABASES ONLY:
--   DROP INDEX IF EXISTS uq_contractor_trade_comp_expense_payment_id;
--   DROP INDEX IF EXISTS idx_expense_payments_trade_compensation_id;
--   ALTER TABLE contractor_trade_compensation DROP COLUMN IF EXISTS expense_payment_id;
--   ALTER TABLE expense_payments DROP COLUMN IF EXISTS notes;
--   ALTER TABLE expense_payments DROP COLUMN IF EXISTS payment_date;
--   ALTER TABLE expense_payments DROP COLUMN IF EXISTS trade_compensation_id;
--   ALTER TABLE expense_payments DROP COLUMN IF EXISTS payee_user_id;
-- ─────────────────────────────────────────────────────────────────────────────
