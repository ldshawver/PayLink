-- Backup step before applying: pg_dump the target database/schema per release runbook.
CREATE TABLE IF NOT EXISTS contractor_trade_compensation (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR,
  company_id VARCHAR NOT NULL,
  contractor_user_id VARCHAR NOT NULL,
  contractor_payment_id VARCHAR,
  contractor_statement_id VARCHAR,
  settlement_id VARCHAR,
  payroll_run_id VARCHAR REFERENCES payroll_runs(id),
  payroll_item_id VARCHAR REFERENCES payroll_items(id),
  item_name TEXT NOT NULL,
  item_sku TEXT,
  description TEXT,
  quantity NUMERIC NOT NULL DEFAULT '1',
  unit_value NUMERIC NOT NULL DEFAULT '0',
  total_value NUMERIC NOT NULL DEFAULT '0',
  valuation_method TEXT NOT NULL DEFAULT 'fair_market_value',
  trade_agreement_id TEXT,
  approved_by_user_id VARCHAR,
  approved_at TIMESTAMP,
  delivery_status TEXT NOT NULL DEFAULT 'pending',
  delivery_reference TEXT,
  included_in_1099 BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contractor_trade_comp_company ON contractor_trade_compensation(company_id);
CREATE INDEX IF NOT EXISTS idx_contractor_trade_comp_contractor ON contractor_trade_compensation(contractor_user_id);
CREATE INDEX IF NOT EXISTS idx_contractor_trade_comp_payroll_item ON contractor_trade_compensation(payroll_item_id);
CREATE INDEX IF NOT EXISTS idx_contractor_trade_comp_payroll_run ON contractor_trade_compensation(payroll_run_id);

CREATE INDEX IF NOT EXISTS idx_contractor_trade_comp_statement ON contractor_trade_compensation(contractor_statement_id);
CREATE INDEX IF NOT EXISTS idx_contractor_trade_comp_settlement ON contractor_trade_compensation(settlement_id);
