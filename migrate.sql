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
