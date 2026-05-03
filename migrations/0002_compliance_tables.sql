-- Migration: 0002_compliance_tables
-- Task #2 — California Compliance Engine
-- Created: 2026-05-02
-- Note: Tables were bootstrapped via direct SQL in the same session;
--       this migration file records the canonical schema for reproducibility.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jurisdictions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "country" text NOT NULL DEFAULT 'US',
  "is_active" boolean DEFAULT true,
  "created_at" timestamp DEFAULT now()
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "labor_rules" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "jurisdiction_id" varchar NOT NULL REFERENCES "jurisdictions"("id") ON DELETE CASCADE,
  "rule_type" text NOT NULL,
  "rule_value" numeric NOT NULL,
  "rule_unit" text,
  "override_level" text DEFAULT 'state',
  "wage_order_number" text,
  "effective_date" date NOT NULL,
  "expiration_date" date,
  "description" text,
  "created_at" timestamp DEFAULT now()
);

--> statement-breakpoint
ALTER TABLE "labor_rules" ADD COLUMN IF NOT EXISTS "wage_order_number" text;

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tax_rules" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "jurisdiction_id" varchar NOT NULL REFERENCES "jurisdictions"("id") ON DELETE CASCADE,
  "rule_type" text NOT NULL,
  "rule_value" numeric NOT NULL,
  "rule_unit" text,
  "effective_date" date NOT NULL,
  "expiration_date" date,
  "description" text,
  "created_at" timestamp DEFAULT now()
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company_compliance_profiles" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" varchar NOT NULL UNIQUE,
  "jurisdiction_id" varchar REFERENCES "jurisdictions"("id"),
  "wage_order_number" text,
  "local_min_wage" numeric,
  "enforce_daily_ot" boolean DEFAULT true,
  "enforce_meal_breaks" boolean DEFAULT true,
  "enforce_rest_breaks" boolean DEFAULT true,
  "enforce_weekly_ot" boolean DEFAULT true,
  "enforce_seventh_day" boolean DEFAULT true,
  "enforce_min_wage" boolean DEFAULT true,
  "enforce_final_paycheck" boolean DEFAULT true,
  "preflight_required" boolean DEFAULT true,
  "custom_notes" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "worker_compliance_profiles" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "worker_id" varchar NOT NULL UNIQUE,
  "company_id" varchar NOT NULL,
  "exempt_status" text DEFAULT 'nonexempt',
  "min_wage_override" numeric,
  "abc_test_a" boolean,
  "abc_test_b" boolean,
  "abc_test_c" boolean,
  "classification_notes" text,
  "contractor_agreement_date" date,
  "last_i9_date" date,
  "sick_leave_balance" numeric,
  "notes" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compliance_audit_events" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" varchar NOT NULL,
  "payroll_run_id" varchar,
  "worker_id" varchar,
  "rule_id" varchar,
  "rule_type" text NOT NULL,
  "entity_type" text NOT NULL DEFAULT 'worker',
  "entity_id" text NOT NULL,
  "severity" text NOT NULL,
  "message" text NOT NULL,
  "detail" jsonb,
  "resolved_at" timestamptz,
  "created_at" timestamp DEFAULT now()
);
