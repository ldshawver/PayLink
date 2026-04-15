-- Migration: Add weekly KPI goal tables for labor budget and revenue tracking
-- Created for Task #29: Weekly KPI Budget & Income Dashboard Widgets

-- Weekly Labor Budget Goals
CREATE TABLE IF NOT EXISTS weekly_labor_goals (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  target_amount NUMERIC(12,2) NOT NULL,
  cost_center_id VARCHAR,
  job_id VARCHAR,
  auto_recur BOOLEAN DEFAULT FALSE,
  created_by VARCHAR,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weekly_labor_goals_company_week
  ON weekly_labor_goals(company_id, week_start);

CREATE INDEX IF NOT EXISTS idx_weekly_labor_goals_auto_recur
  ON weekly_labor_goals(company_id, auto_recur, week_start DESC);

-- Weekly Revenue Goals
CREATE TABLE IF NOT EXISTS weekly_revenue_goals (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  target_amount NUMERIC(12,2) NOT NULL,
  cost_center_id VARCHAR,
  job_id VARCHAR,
  auto_recur BOOLEAN DEFAULT FALSE,
  created_by VARCHAR,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weekly_revenue_goals_company_week
  ON weekly_revenue_goals(company_id, week_start);

CREATE INDEX IF NOT EXISTS idx_weekly_revenue_goals_auto_recur
  ON weekly_revenue_goals(company_id, auto_recur, week_start DESC);
