-- Migration: Add new columns for schedule/approval features
-- Safe to run multiple times (uses IF NOT EXISTS)

-- time_punches new columns
ALTER TABLE time_punches ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'approved';
ALTER TABLE time_punches ADD COLUMN IF NOT EXISTS approved_by VARCHAR;
ALTER TABLE time_punches ADD COLUMN IF NOT EXISTS schedule_id VARCHAR;

-- time_entries new columns
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS schedule_id VARCHAR;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS scheduled_start TIMESTAMP;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS scheduled_end TIMESTAMP;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS scheduled_hours NUMERIC;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS late_minutes INTEGER DEFAULT 0;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS early_departure_minutes INTEGER DEFAULT 0;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS is_unscheduled BOOLEAN DEFAULT FALSE;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';

-- Data fix: Ensure mandatory employee taxes are NOT applied to contractors
-- Safe to run multiple times (UPDATE with WHERE clause is idempotent)
-- Fixes: Federal Income Tax, Social Security, Medicare entries with applies_to='all'
-- These should only apply to W-2 employees, not independent contractors
UPDATE taxes_deductions 
SET applies_to = 'employee' 
WHERE applies_to = 'all' 
  AND is_active = true
  AND name IN (
    'Federal Income Tax',
    'Social Security (FICA)',
    'Medicare',
    'Additional Medicare',
    'CO State Income Tax',
    'CA State Disability Insurance (SDI)',
    'California Personal Income Tax (PIT)',
    'CA Unemployment Insurance (SUI)',
    'CA Employment Training Tax (ETT)',
    'FUTA (Federal Unemployment)'
  );

-- Payment method tracking on payroll items
ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS payment_platform TEXT;
ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS pay_method_id VARCHAR;

-- Platform + handle fields for digital direct deposit on pay methods
ALTER TABLE pay_methods ADD COLUMN IF NOT EXISTS platform TEXT;
ALTER TABLE pay_methods ADD COLUMN IF NOT EXISTS handle TEXT;

-- Expense check printing support
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS include_in_job_cost BOOLEAN DEFAULT FALSE;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS check_number TEXT;

-- Payroll Payment Methods (company-level lookup)
CREATE TABLE IF NOT EXISTS payroll_payment_methods (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR REFERENCES companies(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'other',
  is_digital_wallet BOOLEAN DEFAULT FALSE,
  is_bank_based BOOLEAN DEFAULT FALSE,
  requires_reference_number BOOLEAN DEFAULT FALSE,
  requires_account_selection BOOLEAN DEFAULT TRUE,
  active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Funding Accounts (company bank/wallet accounts used to fund payroll)
CREATE TABLE IF NOT EXISTS funding_accounts (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR REFERENCES companies(id),
  account_code TEXT,
  account_name TEXT NOT NULL,
  account_type TEXT DEFAULT 'bank_checking',
  institution_name TEXT,
  masked_identifier TEXT,
  currency TEXT DEFAULT 'USD',
  active BOOLEAN DEFAULT TRUE,
  allow_for_payroll BOOLEAN DEFAULT TRUE,
  reconciliation_enabled BOOLEAN DEFAULT FALSE,
  opening_balance NUMERIC DEFAULT 0,
  current_balance NUMERIC,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Payroll Payment Records (actual disbursement tracking)
CREATE TABLE IF NOT EXISTS payroll_payment_records (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR REFERENCES companies(id),
  payroll_run_id VARCHAR REFERENCES payroll_runs(id),
  payroll_item_id VARCHAR REFERENCES payroll_items(id),
  worker_id VARCHAR REFERENCES workers(id),
  pay_date DATE,
  pay_period_start DATE,
  pay_period_end DATE,
  tax_year INTEGER,
  gross_pay_amount NUMERIC DEFAULT 0,
  taxable_wages_amount NUMERIC DEFAULT 0,
  employee_tax_withheld NUMERIC DEFAULT 0,
  employer_tax_amount NUMERIC DEFAULT 0,
  net_pay_amount NUMERIC DEFAULT 0,
  payment_method_id VARCHAR REFERENCES payroll_payment_methods(id),
  funding_account_id VARCHAR REFERENCES funding_accounts(id),
  payment_method_code TEXT,
  status TEXT DEFAULT 'pending',
  payment_reference TEXT,
  external_transaction_id TEXT,
  check_number TEXT,
  memo TEXT,
  initiated_at TIMESTAMP,
  paid_at TIMESTAMP,
  cleared_at TIMESTAMP,
  voided_at TIMESTAMP,
  created_by VARCHAR,
  updated_by VARCHAR,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
