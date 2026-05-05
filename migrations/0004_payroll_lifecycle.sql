-- Payroll lifecycle schema migration (idempotent).
-- Adds the columns and table required by the ACH/Stripe payment lifecycle.
-- Note: this file is the canonical source. The runtime DDL block in
-- server/routes.ts is retained as a safety net for environments that have
-- not run drizzle-kit push, but new deployments should apply this migration.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payroll_run_status') THEN
    -- placeholder; current schema uses TEXT, no enum to extend
    NULL;
  END IF;
END $$;

ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS ach_status TEXT;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS ach_submitted_at TIMESTAMPTZ;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS ach_settled_at TIMESTAMPTZ;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS ach_batch_id VARCHAR;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS funding_account_id VARCHAR;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS failure_code TEXT;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS voided_by VARCHAR;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS reversed_by VARCHAR;

ALTER TABLE payroll_payment_records ADD COLUMN IF NOT EXISTS stripe_outbound_payment_id TEXT;
ALTER TABLE payroll_payment_records ADD COLUMN IF NOT EXISTS ach_batch_id VARCHAR;
ALTER TABLE payroll_payment_records ADD COLUMN IF NOT EXISTS failure_code TEXT;
ALTER TABLE payroll_payment_records ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE payroll_payment_records ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;
ALTER TABLE payroll_payment_records ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS payroll_payment_audit_logs (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR REFERENCES companies(id),
  payroll_run_id VARCHAR REFERENCES payroll_runs(id),
  payroll_payment_record_id VARCHAR,
  actor_id VARCHAR,
  event TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_payment_audit_logs_run
  ON payroll_payment_audit_logs(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_payment_audit_logs_record
  ON payroll_payment_audit_logs(payroll_payment_record_id);
