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
