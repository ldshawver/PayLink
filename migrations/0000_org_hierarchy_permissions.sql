CREATE TYPE "public"."entity_type" AS ENUM('c_corp', 's_corp', 'llc', 'sole_prop', 'nonprofit_501c3', 'partnership');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('unspecified', 'male', 'female');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('active', 'completed', 'cancelled', 'on_hold');--> statement-breakpoint
CREATE TYPE "public"."pay_frequency" AS ENUM('weekly', 'biweekly', 'semimonthly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."payroll_status" AS ENUM('draft', 'processed', 'paid');--> statement-breakpoint
CREATE TYPE "public"."permission_scope" AS ENUM('self', 'direct_reports', 'department', 'location', 'legal_entity', 'entire_tenant');--> statement-breakpoint
CREATE TYPE "public"."punch_type" AS ENUM('clock_in', 'clock_out', 'break_start', 'break_end');--> statement-breakpoint
CREATE TYPE "public"."role_scope" AS ENUM('enterprise', 'company', 'department', 'branch');--> statement-breakpoint
CREATE TYPE "public"."schedule_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."timesheet_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."worker_status" AS ENUM('active', 'inactive_temporary', 'leave_illness', 'leave_maternity', 'leave_other', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."worker_type" AS ENUM('employee', 'contractor');--> statement-breakpoint
CREATE TABLE "absence_policies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"name" text NOT NULL,
	"type" text DEFAULT 'accrual_based',
	"pay_code_id" varchar,
	"pay_formula_id" varchar,
	"accrual_account_id" varchar,
	"rate_type" text DEFAULT 'multiplied_by_factor',
	"rate_factor" numeric DEFAULT '1.0',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "accrual_accounts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'pto' NOT NULL,
	"accrual_rate" numeric DEFAULT '0',
	"accrual_frequency" text DEFAULT 'per_pay_period',
	"max_balance" numeric,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "accrual_balances" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" varchar NOT NULL,
	"accrual_account_id" varchar NOT NULL,
	"balance" numeric DEFAULT '0',
	"used_hours" numeric DEFAULT '0',
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "accrual_policies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"name" text NOT NULL,
	"type" text DEFAULT 'standard',
	"accrual_account_id" varchar,
	"contributing_shift_id" varchar,
	"length_of_service_unit" text DEFAULT 'years',
	"apply_frequency" text DEFAULT 'per_pay_period',
	"milestone_rollover_hire_date" boolean DEFAULT false,
	"minimum_employed_days" integer DEFAULT 0,
	"enable_opening_balance" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "accrual_policy_milestones" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"accrual_policy_id" varchar NOT NULL,
	"length_of_service" numeric DEFAULT '0',
	"accrual_rate" numeric DEFAULT '0',
	"max_balance" numeric,
	"annual_max_balance" numeric,
	"rollover_time" numeric,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_name" text NOT NULL,
	"user_id" varchar,
	"company_id" varchar,
	"page_source" text,
	"metadata" text,
	"session_id" text,
	"ip_address" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "automation_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"trigger_type" text NOT NULL,
	"action_type" text NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"trigger_data" text,
	"action_result" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger_type" text NOT NULL,
	"trigger_config" text,
	"action_type" text NOT NULL,
	"action_config" text,
	"is_enabled" boolean DEFAULT true,
	"is_system" boolean DEFAULT false,
	"category" text,
	"last_triggered_at" timestamp,
	"trigger_count" integer DEFAULT 0,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"division_id" varchar,
	"name" text NOT NULL,
	"code" text,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"phone" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "break_policies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"name" text NOT NULL,
	"type" text DEFAULT 'normal',
	"active_after" numeric DEFAULT '4',
	"break_time" numeric DEFAULT '0.25',
	"pay_code_id" varchar,
	"pay_formula_id" varchar,
	"start_window" numeric,
	"window_length" numeric,
	"auto_detect_by" text DEFAULT 'time_window',
	"min_punch_time" numeric,
	"max_punch_time" numeric,
	"include_multiple_breaks" boolean DEFAULT false,
	"allocation_type" text DEFAULT 'proportional',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "check_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"name" text NOT NULL,
	"template_type" text DEFAULT 'standard',
	"layout_config" text DEFAULT '{}',
	"is_default" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enterprise_id" varchar,
	"legal_entity_id" varchar,
	"name" text NOT NULL,
	"legal_name" text,
	"dba" text,
	"ein" text,
	"tax_id" text,
	"entity_number" text,
	"entity_type" "entity_type" DEFAULT 'llc',
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"phone" text,
	"website" text,
	"email" text,
	"logo_url" text,
	"icon_url" text,
	"tagline" text,
	"pay_frequency" "pay_frequency" DEFAULT 'biweekly',
	"overtime_threshold" integer DEFAULT 40,
	"overtime_multiplier" numeric DEFAULT '1.5',
	"break_policy_minutes" integer DEFAULT 30,
	"break_after_hours" integer DEFAULT 6,
	"time_rounding_minutes" integer DEFAULT 15,
	"subscription_status" text DEFAULT 'active_paid',
	"plan_name" text DEFAULT 'starter',
	"trial_start" timestamp,
	"trial_end" timestamp,
	"trial_used" boolean DEFAULT false,
	"billing_active" boolean DEFAULT false,
	"payment_method_on_file" boolean DEFAULT false,
	"is_demo" boolean DEFAULT false,
	"next_check_number" integer DEFAULT 1,
	"station_enforcement_enabled" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "company_webhook_configs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"webhook_url" text NOT NULL,
	"hmac_secret" text NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "contractor_invoice_attachments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" varchar NOT NULL,
	"file_path" text NOT NULL,
	"file_name" text,
	"file_type" text,
	"file_size" integer,
	"uploaded_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "contractor_invoices" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"contractor_id" varchar NOT NULL,
	"invoice_number" text,
	"invoice_date" text NOT NULL,
	"due_date" text,
	"amount" numeric NOT NULL,
	"tax_amount" numeric,
	"description" text,
	"proposal_id" varchar,
	"proposal_reference" text,
	"project_id" varchar,
	"job_id" varchar,
	"cost_center_id" varchar,
	"payment_terms" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_by" varchar,
	"approved_at" timestamp,
	"rejected_by" varchar,
	"rejected_at" timestamp,
	"rejection_reason" text,
	"paid_at" timestamp,
	"paid_amount" numeric,
	"payment_reference" text,
	"payment_method" text,
	"export_status" text DEFAULT 'pending',
	"exported_at" timestamp,
	"is_1099_reportable" boolean DEFAULT true NOT NULL,
	"line_items" text,
	"ai_extracted_json" text,
	"ai_confidence_score" numeric,
	"duplicate_hash" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "contributing_pay_codes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" text NOT NULL,
	"pay_code_ids" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "contributing_shifts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" text NOT NULL,
	"shift_type_code" text,
	"contributing_pay_code_id" varchar,
	"contributes_to_overtime" boolean DEFAULT true,
	"contributes_to_accrual" boolean DEFAULT true,
	"contributes_to_premium" boolean DEFAULT true,
	"contributes_to_compliance" boolean DEFAULT true,
	"filter_type" text DEFAULT 'date',
	"include_holiday_type" text DEFAULT 'no_effect',
	"sun_filter" boolean DEFAULT true,
	"mon_filter" boolean DEFAULT true,
	"tue_filter" boolean DEFAULT true,
	"wed_filter" boolean DEFAULT true,
	"thu_filter" boolean DEFAULT true,
	"fri_filter" boolean DEFAULT true,
	"sat_filter" boolean DEFAULT true,
	"start_date" date,
	"end_date" date,
	"start_time" text,
	"end_time" text,
	"branch_ids" text,
	"department_ids" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cost_centers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"name" text NOT NULL,
	"code" text,
	"description" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "currencies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"currency_code" text NOT NULL,
	"currency_name" text NOT NULL,
	"symbol" text DEFAULT '$',
	"exchange_rate" numeric DEFAULT '1',
	"is_base_currency" boolean DEFAULT false,
	"status" text DEFAULT 'active',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "customer_onboarding_projects" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"customer_id" varchar NOT NULL,
	"deal_id" varchar,
	"template_id" varchar,
	"product_name" text,
	"title" text NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"progress_percentage" integer DEFAULT 0,
	"assigned_to" varchar,
	"start_date" date,
	"target_completion_date" date,
	"completed_at" timestamp,
	"notes" text,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"customer_type" text DEFAULT 'customer',
	"customer_name" text NOT NULL,
	"business_name" text,
	"email" text,
	"phone" text,
	"billing_contact_name" text,
	"billing_email" text,
	"billing_address" text,
	"billing_city" text,
	"billing_state" text,
	"billing_zip" text,
	"billing_country" text,
	"tax_id" text,
	"default_payment_terms" text DEFAULT 'net_30',
	"notes" text,
	"status" text DEFAULT 'active',
	"created_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"customer_id" varchar NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"stage" text DEFAULT 'lead' NOT NULL,
	"product_name" text,
	"value" numeric DEFAULT '0',
	"currency" text DEFAULT 'USD',
	"assigned_to" varchar,
	"expected_close_date" date,
	"closed_at" timestamp,
	"lost_reason" text,
	"notes" text,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"division_id" varchar,
	"name" text NOT NULL,
	"code" text,
	"manager_id" varchar,
	"parent_id" varchar,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "device_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"token" text NOT NULL,
	"platform" text DEFAULT 'web' NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "divisions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "document_acls" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"document_id" varchar,
	"folder_id" varchar,
	"principal_type" text NOT NULL,
	"principal_id" varchar NOT NULL,
	"permission" text NOT NULL,
	"inherited" boolean DEFAULT false,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "document_audit_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" varchar,
	"signature_request_id" varchar,
	"company_id" varchar NOT NULL,
	"action" text NOT NULL,
	"actor_name" text,
	"actor_email" text,
	"actor_id" varchar,
	"ip_address" text,
	"details" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "document_folders" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" text NOT NULL,
	"parent_id" varchar,
	"category" text,
	"color" text,
	"sort_order" integer DEFAULT 0,
	"created_by" varchar,
	"legal_hold" boolean DEFAULT false,
	"retention_policy_id" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "document_retention_policies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"document_type" text,
	"retention_years" integer,
	"retention_months" integer,
	"retention_rule" text,
	"disposition_action" text DEFAULT 'archive',
	"is_active" boolean DEFAULT true,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "document_signature_requests" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"provider" text,
	"provider_object_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"sent_at" timestamp,
	"completed_at" timestamp,
	"expires_at" timestamp,
	"message" text,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "document_signers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signature_request_id" varchar NOT NULL,
	"signer_name" text NOT NULL,
	"signer_email" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"routing_order" integer DEFAULT 1,
	"signed_at" timestamp,
	"ip_address" text,
	"signature_data" text,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" varchar NOT NULL,
	"version_number" integer DEFAULT 1 NOT NULL,
	"file_name" text NOT NULL,
	"file_url" text NOT NULL,
	"file_size" integer,
	"sha256" text NOT NULL,
	"change_note" text,
	"uploaded_by" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"folder_id" varchar,
	"title" text NOT NULL,
	"description" text,
	"file_name" text NOT NULL,
	"file_url" text NOT NULL,
	"file_size" integer,
	"mime_type" text,
	"tags" text,
	"category" text,
	"status" text DEFAULT 'active',
	"is_template" boolean DEFAULT false,
	"template_merge_tags" text,
	"expires_at" timestamp,
	"assigned_to_worker_id" varchar,
	"assigned_to_customer_id" varchar,
	"current_version_id" varchar,
	"access_level" text DEFAULT 'company',
	"classification" text DEFAULT 'internal',
	"document_type" text,
	"department" text,
	"owner" text,
	"effective_date" timestamp,
	"retention_policy_id" varchar,
	"disposition_date" timestamp,
	"disposition_status" text,
	"legal_hold" boolean DEFAULT false,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "eligibility_rule_sets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"name" text NOT NULL,
	"description" text,
	"require_same_company" boolean DEFAULT true NOT NULL,
	"require_same_department" boolean DEFAULT true NOT NULL,
	"require_same_branch" boolean DEFAULT true NOT NULL,
	"require_same_employee_group" boolean DEFAULT true NOT NULL,
	"require_same_position" boolean DEFAULT false NOT NULL,
	"require_no_schedule_conflict" boolean DEFAULT true NOT NULL,
	"require_no_leave_conflict" boolean DEFAULT true NOT NULL,
	"require_active_status" boolean DEFAULT true NOT NULL,
	"max_weekly_hours" numeric,
	"min_rest_hours" numeric,
	"require_certifications" boolean DEFAULT false NOT NULL,
	"allow_overtime_pickup" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "employee_contacts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" varchar NOT NULL,
	"contact_type" text DEFAULT 'emergency' NOT NULL,
	"name" text NOT NULL,
	"relationship" text,
	"phone" text,
	"email" text,
	"address" text,
	"is_primary" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "employee_group_configs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_key" text NOT NULL,
	"label" text NOT NULL,
	"tax_form" text DEFAULT 'W-2' NOT NULL,
	"payroll_taxes_withheld" boolean DEFAULT true NOT NULL,
	"employer_taxes_apply" boolean DEFAULT true NOT NULL,
	"time_tracking" text DEFAULT 'required' NOT NULL,
	"overtime_eligible" boolean DEFAULT true NOT NULL,
	"invoice_workflow" boolean DEFAULT false NOT NULL,
	"distributions" boolean DEFAULT false NOT NULL,
	"volunteer_eligible" boolean DEFAULT false NOT NULL,
	"payroll_enabled" boolean DEFAULT true NOT NULL,
	"year_end_doc_type" text DEFAULT 'W-2' NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "employee_group_configs_group_key_unique" UNIQUE("group_key")
);
--> statement-breakpoint
CREATE TABLE "employee_groups" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"name" text NOT NULL,
	"parent_id" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "employee_manager_relations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"employee_id" varchar NOT NULL,
	"manager_id" varchar NOT NULL,
	"relationship_type" text DEFAULT 'primary' NOT NULL,
	"effective_date" date,
	"end_date" date,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "employee_titles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "employee_wage_groups" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" varchar NOT NULL,
	"wage_group_id" varchar NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "engagement_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"customer_id" varchar NOT NULL,
	"project_id" varchar,
	"event_type" text NOT NULL,
	"event_source" text DEFAULT 'internal' NOT NULL,
	"product_name" text,
	"metadata" text,
	"description" text,
	"occurred_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "enterprise_role_permissions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" varchar NOT NULL,
	"permission_id" varchar NOT NULL,
	"scope" "permission_scope" DEFAULT 'self' NOT NULL,
	"is_granted" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "enterprises" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"website" text,
	"logo_url" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "exception_policies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"name" text NOT NULL,
	"exception_type" text DEFAULT 'missed_punch',
	"severity" text DEFAULT 'medium',
	"grace" numeric DEFAULT '0',
	"watch_window" numeric DEFAULT '0',
	"email_notification" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "expense_approval_actions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_type" text NOT NULL,
	"object_id" varchar NOT NULL,
	"action_type" text NOT NULL,
	"actor_user_id" varchar,
	"actor_worker_id" varchar,
	"company_id" varchar,
	"previous_status" text,
	"new_status" text,
	"notes" text,
	"metadata_json" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "expense_attachments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_id" varchar NOT NULL,
	"file_path" text NOT NULL,
	"file_name" text,
	"file_type" text,
	"file_size" integer,
	"is_receipt" boolean DEFAULT true NOT NULL,
	"uploaded_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"accounting_code" text,
	"payroll_reimbursement_code" text,
	"reimbursable_default" boolean DEFAULT false NOT NULL,
	"receipt_required" boolean DEFAULT true NOT NULL,
	"preapproval_required" boolean DEFAULT false NOT NULL,
	"project_required" boolean DEFAULT false NOT NULL,
	"cost_center_required" boolean DEFAULT false NOT NULL,
	"allowed_worker_groups" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"submitter_id" varchar NOT NULL,
	"category_id" varchar,
	"category_name" text,
	"expense_date" text NOT NULL,
	"amount" numeric NOT NULL,
	"tax_amount" numeric,
	"subtotal" numeric,
	"vendor" text,
	"description" text,
	"business_purpose" text,
	"reimbursement_requested" boolean DEFAULT false NOT NULL,
	"payment_method_used" text,
	"project_id" varchar,
	"job_id" varchar,
	"cost_center_id" varchar,
	"preapproval_status" text,
	"preapproval_reference" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_by" varchar,
	"approved_at" timestamp,
	"rejected_by" varchar,
	"rejected_at" timestamp,
	"rejection_reason" text,
	"reimbursement_status" text,
	"payroll_run_id" varchar,
	"export_status" text DEFAULT 'pending',
	"exported_at" timestamp,
	"line_items" text,
	"ai_extracted_json" text,
	"ai_confidence_score" numeric,
	"duplicate_hash" text,
	"recurring_template_id" varchar,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "funding_accounts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"account_code" text,
	"account_name" text NOT NULL,
	"account_type" text DEFAULT 'bank_checking',
	"institution_name" text,
	"masked_identifier" text,
	"currency" text DEFAULT 'USD',
	"active" boolean DEFAULT true,
	"allow_for_payroll" boolean DEFAULT true,
	"reconciliation_enabled" boolean DEFAULT false,
	"opening_balance" numeric DEFAULT '0',
	"current_balance" numeric,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "holiday_policies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"name" text NOT NULL,
	"default_schedule" text DEFAULT 'none',
	"eligible_after_days" integer DEFAULT 0,
	"minimum_worked_before_days" integer DEFAULT 0,
	"minimum_worked_after_days" integer DEFAULT 0,
	"worked_on_holiday_type" text DEFAULT 'paid',
	"absence_policy_id" varchar,
	"average_time_method" text DEFAULT 'daily',
	"average_time_days" integer DEFAULT 30,
	"force_over_time_policy" boolean DEFAULT false,
	"contributing_shift_ids" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" text NOT NULL,
	"date" date NOT NULL,
	"is_recurring" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "integration_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"event_type" text NOT NULL,
	"payload" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"destination_url" text,
	"attempts" integer DEFAULT 0,
	"last_attempt_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "invoice_approval_workflows" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"document_id" varchar,
	"vendor_name" text,
	"invoice_number" text,
	"invoice_date" timestamp,
	"total_amount" text,
	"extracted_data" text,
	"status" text DEFAULT 'received' NOT NULL,
	"current_approver_id" varchar,
	"approval_chain" text,
	"submitted_by" varchar,
	"approved_at" timestamp,
	"approved_by" varchar,
	"paid_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "invoice_line_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" varchar NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric DEFAULT '1',
	"unit_price" numeric DEFAULT '0',
	"amount" numeric DEFAULT '0',
	"taxable" boolean DEFAULT true,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "invoice_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"name" text NOT NULL,
	"description" text,
	"layout_key" text DEFAULT 'modern_clean' NOT NULL,
	"logo_url" text,
	"brand_color" text DEFAULT '#0d9488',
	"header_text" text,
	"footer_text" text,
	"payment_instructions" text,
	"terms_and_conditions" text,
	"is_default" boolean DEFAULT false,
	"is_system" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"customer_id" varchar,
	"template_id" varchar,
	"invoice_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"subtotal" numeric DEFAULT '0',
	"tax_rate" numeric DEFAULT '0',
	"tax_amount" numeric DEFAULT '0',
	"discount_amount" numeric DEFAULT '0',
	"discount_type" text DEFAULT 'fixed',
	"total_amount" numeric DEFAULT '0',
	"amount_paid" numeric DEFAULT '0',
	"amount_due" numeric DEFAULT '0',
	"currency" text DEFAULT 'USD',
	"notes" text,
	"internal_notes" text,
	"payment_terms" text DEFAULT 'net_30',
	"recurring_billing_id" varchar,
	"sent_at" timestamp,
	"viewed_at" timestamp,
	"paid_at" timestamp,
	"voided_at" timestamp,
	"template_style" text DEFAULT 'modern_clean',
	"created_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"cost_center_id" varchar,
	"department_id" varchar,
	"name" text NOT NULL,
	"description" text,
	"pay_type" text DEFAULT 'hourly',
	"default_wage" numeric,
	"start_date" date,
	"end_date" date,
	"status" "job_status" DEFAULT 'active',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "kpi_groups" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "legal_entities" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"status" text DEFAULT 'active',
	"type" text DEFAULT 'corporation',
	"classification_code" text,
	"legal_name" text NOT NULL,
	"trade_name" text,
	"ein" text,
	"start_date" date,
	"end_date" date,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"country" text DEFAULT 'US',
	"phone" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "license_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"first_name" text,
	"last_name" text,
	"email" text NOT NULL,
	"phone" text,
	"company" text,
	"employees" text,
	"interest" text,
	"message" text,
	"ip_address" text,
	"user_agent" text,
	"source_page" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"legal_entity_id" varchar,
	"name" text NOT NULL,
	"code" text,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"country" text DEFAULT 'US',
	"phone" text,
	"timezone" text DEFAULT 'America/Los_Angeles',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "meal_policies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"name" text NOT NULL,
	"type" text DEFAULT 'normal',
	"active_after" numeric DEFAULT '5',
	"meal_time" numeric DEFAULT '0.5',
	"pay_code_id" varchar,
	"pay_formula_id" varchar,
	"start_window" numeric,
	"window_length" numeric,
	"auto_detect_by" text DEFAULT 'time_window',
	"min_punch_time" numeric,
	"max_punch_time" numeric,
	"include_multiple_meals" boolean DEFAULT false,
	"allocation_type" text DEFAULT 'proportional',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "new_hire_defaults" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" text NOT NULL,
	"display_order" integer DEFAULT 0,
	"default_worker_type" text DEFAULT 'employee',
	"default_pay_type" text DEFAULT 'hourly',
	"default_department" text,
	"default_branch_id" varchar,
	"default_policy_group_id" varchar,
	"default_pay_period_schedule_id" varchar,
	"default_currency" text DEFAULT 'USD',
	"default_country" text DEFAULT 'US',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" varchar NOT NULL,
	"event_type" text NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"sms_enabled" boolean DEFAULT true NOT NULL,
	"in_app_enabled" boolean DEFAULT true NOT NULL,
	"push_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"user_id" varchar,
	"worker_id" varchar,
	"customer_id" varchar,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text,
	"action_url" text,
	"is_read" boolean DEFAULT false,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "onboarding_documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar,
	"template_id" varchar,
	"company_id" varchar NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"document_type" text DEFAULT 'document' NOT NULL,
	"url" text,
	"file_size" integer,
	"sort_order" integer DEFAULT 0,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "onboarding_packet_steps" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"packet_id" varchar NOT NULL,
	"step_name" text NOT NULL,
	"step_type" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0,
	"status" text DEFAULT 'pending' NOT NULL,
	"assigned_to" varchar,
	"document_id" varchar,
	"completed_at" timestamp,
	"completed_by" varchar,
	"notes" text,
	"task_type" text DEFAULT 'manual',
	"dependencies_json" text,
	"doc_type" text,
	"doc_status" text DEFAULT 'pending',
	"required" boolean DEFAULT true,
	"signature_package_id" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "onboarding_packets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"worker_id" varchar NOT NULL,
	"template_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"assigned_by" varchar,
	"started_at" timestamp,
	"completed_at" timestamp,
	"due_date" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "onboarding_progress" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"step_company_details" boolean DEFAULT false,
	"step_first_employee" boolean DEFAULT false,
	"step_pay_schedule" boolean DEFAULT false,
	"step_payroll_config" boolean DEFAULT false,
	"step_time_clock" boolean DEFAULT false,
	"step_payroll_preview" boolean DEFAULT false,
	"step_bank_connected" boolean DEFAULT false,
	"onboarding_wizard_completed" boolean DEFAULT false,
	"business_type" text,
	"employee_count" integer,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "onboarding_tasks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" varchar NOT NULL,
	"template_task_id" varchar,
	"title" text NOT NULL,
	"description" text,
	"category" text,
	"sort_order" integer DEFAULT 0,
	"status" text DEFAULT 'pending' NOT NULL,
	"is_mandatory" boolean DEFAULT true,
	"assigned_to" varchar,
	"due_date" date,
	"completed_at" timestamp,
	"completed_by" varchar,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "onboarding_template_tasks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" varchar NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text,
	"sort_order" integer DEFAULT 0,
	"is_mandatory" boolean DEFAULT true,
	"estimated_minutes" integer,
	"resource_url" text,
	"resource_type" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "onboarding_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"product_name" text,
	"is_active" boolean DEFAULT true,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "overtime_policies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"name" text NOT NULL,
	"type" text DEFAULT 'daily',
	"trigger_time" numeric DEFAULT '8',
	"rate" numeric DEFAULT '1.5',
	"pay_code_id" varchar,
	"pay_formula_id" varchar,
	"contributing_shift_id" varchar,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pay_codes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'regular',
	"rate" numeric,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pay_formulas" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" text NOT NULL,
	"pay_type" text DEFAULT 'pay_multiplied_by_factor',
	"accrual_account_id" varchar,
	"accrual_rate" numeric DEFAULT '1.0',
	"wage_source_type" text DEFAULT 'hourly_rate',
	"wage_source_contributing_shift_id" varchar,
	"wage_group" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pay_methods" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" varchar NOT NULL,
	"method_type" text DEFAULT 'direct_deposit' NOT NULL,
	"bank_name" text,
	"account_type" text,
	"routing_number" text,
	"account_number" text,
	"is_primary" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"remittance_source_id" varchar,
	"priority" integer DEFAULT 1,
	"amount_type" text DEFAULT 'remainder',
	"amount_value" numeric,
	"platform" text,
	"handle" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pay_period_schedules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text DEFAULT 'biweekly' NOT NULL,
	"anchor_date" date,
	"transaction_day_offset" integer DEFAULT 3,
	"semi_monthly_day1" integer DEFAULT 1,
	"semi_monthly_day2" integer DEFAULT 15,
	"annual_pay_periods" integer,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pay_periods" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"frequency" text DEFAULT 'biweekly',
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"pay_date" date,
	"status" text DEFAULT 'open',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pay_stub_accounts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"legal_entity_id" varchar,
	"name" text NOT NULL,
	"status" text DEFAULT 'enabled',
	"type" text DEFAULT 'earning' NOT NULL,
	"display_order" integer DEFAULT 0,
	"accrual_account_id" varchar,
	"debit_account" text,
	"credit_account" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pay_stub_amendments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"worker_id" varchar NOT NULL,
	"pay_stub_account_id" varchar,
	"amendment_type" text DEFAULT 'earning',
	"status" text DEFAULT 'active',
	"amount_type" text DEFAULT 'fixed',
	"rate" numeric DEFAULT '0',
	"units" numeric DEFAULT '0',
	"amount" numeric DEFAULT '0',
	"percent" numeric DEFAULT '0',
	"description" text,
	"public_note" text,
	"effective_date" date,
	"approval_status" text DEFAULT 'pending',
	"approved_by" varchar,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pay_stub_transactions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_item_id" varchar,
	"worker_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"remittance_source_id" varchar,
	"status" text DEFAULT 'pending',
	"payment_method" text DEFAULT 'check',
	"transaction_date" date,
	"amount" numeric DEFAULT '0',
	"check_number" text,
	"batch_number" text,
	"reference" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payment_method_configs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"method_type" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"fee_type" text DEFAULT 'percentage' NOT NULL,
	"fee_percent" numeric DEFAULT '0',
	"fee_flat" numeric DEFAULT '0',
	"fee_cap" numeric,
	"is_enabled" boolean DEFAULT true,
	"is_recommended" boolean DEFAULT false,
	"fee_passed_to_customer" boolean DEFAULT true,
	"processing_time" text,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"invoice_id" varchar,
	"customer_id" varchar,
	"payment_method" text NOT NULL,
	"amount" numeric NOT NULL,
	"processor_fee" numeric DEFAULT '0',
	"net_amount" numeric DEFAULT '0',
	"payment_fee_charged" numeric DEFAULT '0',
	"base_amount" numeric DEFAULT '0',
	"fee_amount" numeric DEFAULT '0',
	"total_charged" numeric DEFAULT '0',
	"processor_transaction_id" text,
	"stripe_payment_intent_id" text,
	"stripe_customer_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp,
	"failed_at" timestamp,
	"failure_reason" text,
	"receipt_url" text,
	"notes" text,
	"mandate_accepted" boolean DEFAULT false,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payroll_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_run_id" varchar NOT NULL,
	"worker_id" varchar NOT NULL,
	"regular_hours" numeric DEFAULT '0',
	"overtime_hours" numeric DEFAULT '0',
	"double_time_hours" numeric DEFAULT '0',
	"regular_pay" numeric DEFAULT '0',
	"overtime_pay" numeric DEFAULT '0',
	"double_time_pay" numeric DEFAULT '0',
	"gross_pay" numeric DEFAULT '0',
	"deductions" numeric DEFAULT '0',
	"net_pay" numeric DEFAULT '0',
	"pay_rate" numeric DEFAULT '0',
	"pay_type" text DEFAULT 'hourly',
	"check_number" text,
	"ytd_gross" numeric DEFAULT '0',
	"ytd_deductions" numeric DEFAULT '0',
	"ytd_net" numeric DEFAULT '0',
	"payment_method" text,
	"payment_platform" text,
	"pay_method_id" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payroll_payment_methods" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'other',
	"is_digital_wallet" boolean DEFAULT false,
	"is_bank_based" boolean DEFAULT false,
	"requires_reference_number" boolean DEFAULT false,
	"requires_account_selection" boolean DEFAULT true,
	"active" boolean DEFAULT true,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payroll_payment_records" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"payroll_run_id" varchar,
	"payroll_item_id" varchar,
	"worker_id" varchar,
	"pay_date" date,
	"pay_period_start" date,
	"pay_period_end" date,
	"tax_year" integer,
	"gross_pay_amount" numeric DEFAULT '0',
	"taxable_wages_amount" numeric DEFAULT '0',
	"employee_tax_withheld" numeric DEFAULT '0',
	"employer_tax_amount" numeric DEFAULT '0',
	"net_pay_amount" numeric DEFAULT '0',
	"payment_method_id" varchar,
	"funding_account_id" varchar,
	"payment_method_code" text,
	"status" text DEFAULT 'pending',
	"payment_reference" text,
	"external_transaction_id" text,
	"check_number" text,
	"memo" text,
	"initiated_at" timestamp,
	"paid_at" timestamp,
	"cleared_at" timestamp,
	"voided_at" timestamp,
	"created_by" varchar,
	"updated_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payroll_reimbursement_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_id" varchar NOT NULL,
	"payroll_run_id" varchar,
	"worker_id" varchar NOT NULL,
	"company_id" varchar,
	"amount" numeric NOT NULL,
	"is_taxable" boolean DEFAULT false NOT NULL,
	"description" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"included_in_payroll_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" "payroll_status" DEFAULT 'draft',
	"total_gross" numeric DEFAULT '0',
	"total_net" numeric DEFAULT '0',
	"total_hours" numeric DEFAULT '0',
	"total_overtime_hours" numeric DEFAULT '0',
	"worker_count" integer DEFAULT 0,
	"processed_at" timestamp,
	"pay_date" date,
	"use_direct_deposit" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "permission_groups" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"module" text NOT NULL,
	"display_order" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "permission_groups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"permission_group_id" varchar NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"scope" "permission_scope" DEFAULT 'self' NOT NULL,
	"is_customer_facing" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "permissions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "policy_groups" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"name" text NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false,
	"regular_time_policy_id" varchar,
	"overtime_policy_id" varchar,
	"premium_policy_id" varchar,
	"meal_policy_id" varchar,
	"break_policy_id" varchar,
	"schedule_policy_id" varchar,
	"exception_policy_id" varchar,
	"accrual_policy_id" varchar,
	"absence_policy_id" varchar,
	"holiday_policy_id" varchar,
	"rounding_policy_id" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "portal_access_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"customer_id" varchar,
	"invoice_id" varchar,
	"document_id" varchar,
	"signature_request_id" varchar,
	"packet_id" varchar,
	"worker_id" varchar,
	"token" text NOT NULL,
	"token_type" text NOT NULL,
	"expires_at" timestamp,
	"used_at" timestamp,
	"is_revoked" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"department_id" varchar,
	"title" text NOT NULL,
	"description" text,
	"reports_to_position_id" varchar,
	"salary_range_min" numeric,
	"salary_range_max" numeric,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "premium_policies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"name" text NOT NULL,
	"type" text DEFAULT 'date_time',
	"pay_code_id" varchar,
	"pay_formula_id" varchar,
	"start_date" date,
	"end_date" date,
	"start_time" text,
	"end_time" text,
	"daily_trigger_hours" numeric,
	"weekly_trigger_hours" numeric,
	"effective_days" text,
	"holiday_handling" text DEFAULT 'no_effect',
	"branch_ids" text,
	"department_ids" text,
	"minimum_time" numeric,
	"maximum_time" numeric,
	"include_partial_punches" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "product_api_keys" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"product_name" text NOT NULL,
	"api_key" text NOT NULL,
	"label" text,
	"is_active" boolean DEFAULT true,
	"last_used_at" timestamp,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "qualification_groups" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "qualifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"worker_id" varchar,
	"type" text DEFAULT 'skill' NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"level" text,
	"expiration_date" date,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"worker_id" varchar,
	"cost_center_id" varchar,
	"job_id" varchar,
	"vendor" text,
	"description" text,
	"amount" numeric DEFAULT '0' NOT NULL,
	"receipt_date" text NOT NULL,
	"category" text DEFAULT 'general',
	"receipt_image_path" text,
	"status" text DEFAULT 'pending',
	"approved_by" varchar,
	"notes" text,
	"include_in_job_cost" boolean DEFAULT false,
	"check_number" text,
	"payment_method" text,
	"tax_amount" numeric,
	"subtotal" numeric,
	"line_items" text,
	"is_reimbursement" boolean DEFAULT false,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "recurring_billing_profiles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"customer_id" varchar NOT NULL,
	"template_id" varchar,
	"name" text NOT NULL,
	"frequency" text DEFAULT 'monthly' NOT NULL,
	"custom_interval_days" integer,
	"amount" numeric NOT NULL,
	"currency" text DEFAULT 'USD',
	"line_items" text,
	"tax_rate" numeric DEFAULT '0',
	"start_date" date NOT NULL,
	"end_date" date,
	"next_invoice_date" date,
	"trial_end_date" date,
	"auto_pay_enabled" boolean DEFAULT false,
	"retry_on_failure" boolean DEFAULT true,
	"max_retries" integer DEFAULT 3,
	"status" text DEFAULT 'active' NOT NULL,
	"canceled_at" timestamp,
	"notes" text,
	"due_days" integer DEFAULT 30,
	"notify_email" boolean DEFAULT true,
	"notify_sms" boolean DEFAULT false,
	"notify_days_before" integer DEFAULT 7,
	"reminder_frequency_days" integer DEFAULT 0,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "recurring_expense_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"submitter_id" varchar NOT NULL,
	"category_id" varchar,
	"category_name" text,
	"vendor" text,
	"description" text,
	"amount" numeric NOT NULL,
	"reimbursement_requested" boolean DEFAULT false NOT NULL,
	"project_id" varchar,
	"job_id" varchar,
	"cost_center_id" varchar,
	"frequency" text DEFAULT 'monthly' NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text,
	"next_due_date" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_generated_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "recurring_schedules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"worker_id" varchar NOT NULL,
	"name" text,
	"day_of_week" integer NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"job_id" varchar,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "regular_time_policies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"name" text NOT NULL,
	"calculation_order" integer DEFAULT 9999,
	"contributing_shift_id" varchar,
	"pay_code_id" varchar,
	"pay_formula_id" varchar,
	"max_time" numeric,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "remittance_agencies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'enabled',
	"type" text DEFAULT 'federal' NOT NULL,
	"country" text DEFAULT 'US',
	"province_state" text,
	"district" text,
	"agency" text,
	"start_date" date,
	"end_date" date,
	"contact_worker_id" varchar,
	"remittance_source_id" varchar,
	"business_day_rule" text DEFAULT 'no',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "remittance_agency_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" varchar NOT NULL,
	"status" text DEFAULT 'enabled',
	"type" text DEFAULT 'payment',
	"frequency" text DEFAULT 'quarterly',
	"due_date_delay_days" integer DEFAULT 0,
	"effective_date" date,
	"reminder_days" integer DEFAULT 7,
	"reminder_worker_id" varchar,
	"primary_month" integer,
	"primary_day_of_month" integer,
	"secondary_month" integer,
	"secondary_day_of_month" integer,
	"day_of_month" integer,
	"month_of_quarter" integer,
	"last_processed_date" date,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "remittance_sources" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'enabled',
	"type" text DEFAULT 'check' NOT NULL,
	"country" text DEFAULT 'US',
	"currency" text DEFAULT 'USD',
	"last_check_number" integer DEFAULT 0,
	"last_batch_number" integer DEFAULT 0,
	"routing_number" text,
	"account_number" text,
	"institution" text,
	"bank_transit" text,
	"bank_account" text,
	"vertical_alignment" numeric DEFAULT '0',
	"horizontal_alignment" numeric DEFAULT '0',
	"signature_url" text,
	"business_number" text,
	"immediate_origin" text,
	"immediate_origin_name" text,
	"immediate_dest" text,
	"immediate_dest_name" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"review_date" date NOT NULL,
	"reviewer_name" text,
	"rating" integer,
	"notes" text,
	"status" text DEFAULT 'pending',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" varchar NOT NULL,
	"resource" text NOT NULL,
	"can_view" boolean DEFAULT false,
	"can_create" boolean DEFAULT false,
	"can_edit" boolean DEFAULT false,
	"can_delete" boolean DEFAULT false,
	"can_export" boolean DEFAULT false,
	"can_approve" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"level" integer DEFAULT 5 NOT NULL,
	"is_system" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "rounding_policies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"name" text NOT NULL,
	"round_type" text DEFAULT 'day_total',
	"punch_type" text,
	"interval_minutes" integer DEFAULT 15,
	"grace_minutes" integer DEFAULT 3,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "saved_payment_methods" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"method_type" text NOT NULL,
	"last_4" text,
	"brand" text,
	"bank_name" text,
	"expiry_month" integer,
	"expiry_year" integer,
	"processor_token" text,
	"is_default" boolean DEFAULT false,
	"is_auto_pay" boolean DEFAULT false,
	"status" text DEFAULT 'active',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "saved_reports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"name" varchar NOT NULL,
	"report_type" varchar NOT NULL,
	"category" varchar NOT NULL,
	"filters" text,
	"data" text,
	"headers" text,
	"row_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"created_by" varchar
);
--> statement-breakpoint
CREATE TABLE "schedule_audit_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"actor_user_id" varchar,
	"actor_worker_id" varchar,
	"action_type" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" varchar,
	"before_json" text,
	"after_json" text,
	"metadata_json" text,
	"ip_address" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "schedule_policies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"name" text NOT NULL,
	"meal_policy_id" varchar,
	"break_policy_ids" text,
	"regular_time_policy_action" text DEFAULT 'include',
	"regular_time_policy_ids" text,
	"overtime_policy_action" text DEFAULT 'include',
	"overtime_policy_ids" text,
	"premium_policy_action" text DEFAULT 'include',
	"premium_policy_ids" text,
	"full_shift_absence_policy_id" varchar,
	"partial_shift_absence_policy_id" varchar,
	"start_stop_window" numeric DEFAULT '1',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "schedule_preferences" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"preference_type" text DEFAULT 'day_off' NOT NULL,
	"day_of_week" integer,
	"shift_time" text,
	"prefer_not_to_work" boolean DEFAULT false NOT NULL,
	"importance" integer DEFAULT 3 NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"date" date NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"department" text,
	"job_id" varchar,
	"status" "schedule_status" DEFAULT 'draft',
	"note" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "secondary_wage_groups" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"name" text NOT NULL,
	"hourly_rate" numeric DEFAULT '0',
	"overtime_rate" numeric DEFAULT '0',
	"description" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shift_marketplace_listings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"listed_by_worker_id" varchar NOT NULL,
	"listing_type" text DEFAULT 'offer' NOT NULL,
	"reason" text,
	"urgency" text DEFAULT 'normal' NOT NULL,
	"emergency_coverage" boolean DEFAULT false NOT NULL,
	"employee_acknowledged_responsibility" boolean DEFAULT false NOT NULL,
	"eligibility_rule_set_id" varchar,
	"status" text DEFAULT 'open' NOT NULL,
	"expires_at" timestamp,
	"filled_by_worker_id" varchar,
	"filled_at" timestamp,
	"approved_by" varchar,
	"approved_at" timestamp,
	"withdrawn_at" timestamp,
	"withdrawn_reason" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shift_marketplace_requests" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" varchar NOT NULL,
	"requesting_worker_id" varchar NOT NULL,
	"request_type" text DEFAULT 'pickup' NOT NULL,
	"proposed_shift_id" varchar,
	"note" text,
	"eligibility_snapshot_json" text,
	"conflict_snapshot_json" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" varchar,
	"reviewed_at" timestamp,
	"review_note" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shift_offers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" varchar NOT NULL,
	"offered_by_worker_id" varchar NOT NULL,
	"status" text DEFAULT 'open',
	"claimed_by_worker_id" varchar,
	"approved_by" varchar,
	"notes" text,
	"manager_note" text,
	"offered_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "signature_packages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"signature_request_id" varchar,
	"provider" text NOT NULL,
	"provider_envelope_id" text,
	"status" text DEFAULT 'created' NOT NULL,
	"document_ids" text,
	"subject" text,
	"message" text,
	"metadata" text,
	"sent_at" timestamp,
	"completed_at" timestamp,
	"expires_at" timestamp,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "staff_message_recipients" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" varchar NOT NULL,
	"worker_id" varchar NOT NULL,
	"read_at" timestamp,
	"delivered_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "staff_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"sender_id" varchar NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"scope" text DEFAULT 'one' NOT NULL,
	"recipient_worker_id" varchar,
	"delivery_channel" text DEFAULT 'app' NOT NULL,
	"parent_message_id" varchar,
	"is_reply" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"station_name" text NOT NULL,
	"location" text,
	"ip_restriction" text,
	"description" text,
	"status" text DEFAULT 'active',
	"requires_schedule" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "system_documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"version" text DEFAULT '1.0' NOT NULL,
	"category" text DEFAULT 'General' NOT NULL,
	"file_url" text,
	"description" text,
	"effective_date" date,
	"change_log" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "taxes_deductions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'tax' NOT NULL,
	"category" text DEFAULT 'mandatory_tax',
	"subcategory" text,
	"calculation_type" text DEFAULT 'percentage',
	"rate" numeric DEFAULT '0',
	"max_amount" numeric,
	"is_employer_paid" boolean DEFAULT false,
	"is_reference_only" boolean DEFAULT false,
	"applies_to" text DEFAULT 'all',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"department_id" varchar,
	"location_id" varchar,
	"name" text NOT NULL,
	"description" text,
	"lead_worker_id" varchar,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"date" date NOT NULL,
	"clock_in" timestamp,
	"clock_out" timestamp,
	"break_minutes" integer DEFAULT 0,
	"total_hours" numeric DEFAULT '0',
	"overtime_hours" numeric DEFAULT '0',
	"double_time_hours" numeric DEFAULT '0',
	"wage_group_id" varchar,
	"status" timesheet_status DEFAULT 'pending',
	"note" text,
	"schedule_id" varchar,
	"scheduled_start" timestamp,
	"scheduled_end" timestamp,
	"scheduled_hours" numeric,
	"late_minutes" integer DEFAULT 0,
	"early_departure_minutes" integer DEFAULT 0,
	"is_unscheduled" boolean DEFAULT false,
	"source" text DEFAULT 'manual',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "time_off_requests" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"request_type" text DEFAULT 'vacation' NOT NULL,
	"start_date" date NOT NULL,
	"start_time" text,
	"end_date" date NOT NULL,
	"end_time" text,
	"total_days" numeric,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" varchar,
	"reviewed_at" timestamp,
	"review_note" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "time_punches" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"punch_type" "punch_type" NOT NULL,
	"punch_time" timestamp DEFAULT now() NOT NULL,
	"note" text,
	"approval_status" text DEFAULT 'approved',
	"approved_by" varchar,
	"schedule_id" varchar,
	"station_id" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "trade_attachments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_transaction_id" varchar NOT NULL,
	"file_name" text NOT NULL,
	"file_url" text NOT NULL,
	"file_size" integer,
	"mime_type" text,
	"uploaded_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "trade_audit_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_transaction_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"action" text NOT NULL,
	"old_status" text,
	"new_status" text,
	"note" text,
	"metadata" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "trade_transaction_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_transaction_id" varchar NOT NULL,
	"description" text NOT NULL,
	"item_type" text DEFAULT 'services' NOT NULL,
	"direction" text DEFAULT 'given' NOT NULL,
	"fair_market_value" numeric(12, 2) DEFAULT '0' NOT NULL,
	"quantity" numeric(10, 4) DEFAULT '1' NOT NULL,
	"unit" text,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "trade_transactions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"title" text NOT NULL,
	"transaction_type" text DEFAULT 'services' NOT NULL,
	"counterparty_type" text DEFAULT 'manual' NOT NULL,
	"counterparty_id" varchar,
	"counterparty_name" text NOT NULL,
	"description" text,
	"fair_market_value" numeric(12, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"is_reportable" boolean DEFAULT false NOT NULL,
	"tax_year" integer,
	"reporting_notes" text,
	"reviewed_by" varchar,
	"reviewed_at" timestamp,
	"review_notes" text,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "trial_signups" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" text NOT NULL,
	"employee_count" integer,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"job_title" text,
	"email" text NOT NULL,
	"phone" text,
	"company_id" varchar,
	"user_id" varchar,
	"trial_start" timestamp DEFAULT now(),
	"trial_end" timestamp,
	"subscription_status" text DEFAULT 'trial_active',
	"billing_active" boolean DEFAULT false,
	"payment_method_on_file" boolean DEFAULT false,
	"terms_accepted_at" timestamp,
	"terms_version" text DEFAULT '1.0',
	"privacy_version" text DEFAULT '1.0',
	"signup_ip" text,
	"canceled_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_company_access" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"role_id" varchar NOT NULL,
	"is_active" boolean DEFAULT true,
	"granted_at" timestamp DEFAULT now(),
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_permission_overrides" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"permission_id" varchar NOT NULL,
	"scope" "permission_scope" DEFAULT 'self' NOT NULL,
	"is_granted" boolean NOT NULL,
	"reason" text,
	"granted_by" varchar,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"role_id" varchar NOT NULL,
	"scope_type" "role_scope" DEFAULT 'company',
	"scope_id" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"role" text DEFAULT 'admin',
	"company_id" varchar,
	"worker_id" varchar,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "wage_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"wage_type" text DEFAULT 'hourly' NOT NULL,
	"wage" numeric DEFAULT '0' NOT NULL,
	"effective_date" date NOT NULL,
	"average_hours_per_week" numeric DEFAULT '40',
	"labor_burden_percent" numeric DEFAULT '0',
	"note" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_type" text NOT NULL,
	"provider_event_id" text,
	"envelope_id" text,
	"payload" text,
	"status" text DEFAULT 'received' NOT NULL,
	"processed_at" timestamp,
	"error" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "worker_documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" varchar NOT NULL,
	"name" text NOT NULL,
	"document_type" text DEFAULT 'other',
	"file_url" text NOT NULL,
	"notes" text,
	"uploaded_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "worker_languages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"worker_id" varchar,
	"language" text NOT NULL,
	"proficiency" text DEFAULT 'basic',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "worker_memberships" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"worker_id" varchar,
	"organization" text NOT NULL,
	"membership_number" text,
	"start_date" date,
	"expiration_date" date,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"first_name" text NOT NULL,
	"middle_name" text,
	"last_name" text NOT NULL,
	"email" text,
	"phone" text,
	"worker_type" "worker_type" DEFAULT 'employee' NOT NULL,
	"status" "worker_status" DEFAULT 'active',
	"job_title" text,
	"department" text,
	"pay_rate" numeric DEFAULT '0' NOT NULL,
	"pay_type" text DEFAULT 'hourly',
	"hire_date" date,
	"termination_date" date,
	"birth_date" date,
	"is_active" boolean DEFAULT true,
	"is_shareholder" boolean DEFAULT false,
	"gender" "gender" DEFAULT 'unspecified',
	"address" text,
	"address_2" text,
	"city" text,
	"state" text,
	"zip" text,
	"country" text DEFAULT 'US',
	"ssn" text,
	"ethnicity" text,
	"employee_number" text,
	"pin" text,
	"currency" text DEFAULT 'USD',
	"work_phone" text,
	"work_phone_ext" text,
	"home_phone" text,
	"mobile_phone" text,
	"fax" text,
	"work_email" text,
	"home_email" text,
	"note" text,
	"preferences" text,
	"tags" text,
	"default_branch_id" varchar,
	"default_department_id" varchar,
	"policy_group_id" varchar,
	"pay_period_schedule_id" varchar,
	"group_id" varchar,
	"title_id" varchar,
	"position_id" varchar,
	"cost_center_id" varchar,
	"manager_id" varchar,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"contractor_type" text DEFAULT 'hourly',
	"worker_group" text DEFAULT 'hourly_employee',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "absence_policies" ADD CONSTRAINT "absence_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accrual_accounts" ADD CONSTRAINT "accrual_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accrual_balances" ADD CONSTRAINT "accrual_balances_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accrual_balances" ADD CONSTRAINT "accrual_balances_accrual_account_id_accrual_accounts_id_fk" FOREIGN KEY ("accrual_account_id") REFERENCES "public"."accrual_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accrual_policies" ADD CONSTRAINT "accrual_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accrual_policy_milestones" ADD CONSTRAINT "accrual_policy_milestones_accrual_policy_id_accrual_policies_id_fk" FOREIGN KEY ("accrual_policy_id") REFERENCES "public"."accrual_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_events" ADD CONSTRAINT "automation_events_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_events" ADD CONSTRAINT "automation_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_policies" ADD CONSTRAINT "break_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_templates" ADD CONSTRAINT "check_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_webhook_configs" ADD CONSTRAINT "company_webhook_configs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_invoices" ADD CONSTRAINT "contractor_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_invoices" ADD CONSTRAINT "contractor_invoices_contractor_id_workers_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributing_pay_codes" ADD CONSTRAINT "contributing_pay_codes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributing_shifts" ADD CONSTRAINT "contributing_shifts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_onboarding_projects" ADD CONSTRAINT "customer_onboarding_projects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_onboarding_projects" ADD CONSTRAINT "customer_onboarding_projects_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_onboarding_projects" ADD CONSTRAINT "customer_onboarding_projects_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_onboarding_projects" ADD CONSTRAINT "customer_onboarding_projects_template_id_onboarding_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."onboarding_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "divisions" ADD CONSTRAINT "divisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acls" ADD CONSTRAINT "document_acls_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_audit_logs" ADD CONSTRAINT "document_audit_logs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_retention_policies" ADD CONSTRAINT "document_retention_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_signature_requests" ADD CONSTRAINT "document_signature_requests_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_signature_requests" ADD CONSTRAINT "document_signature_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_signers" ADD CONSTRAINT "document_signers_signature_request_id_document_signature_requests_id_fk" FOREIGN KEY ("signature_request_id") REFERENCES "public"."document_signature_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_folder_id_document_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."document_folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eligibility_rule_sets" ADD CONSTRAINT "eligibility_rule_sets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_contacts" ADD CONSTRAINT "employee_contacts_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_groups" ADD CONSTRAINT "employee_groups_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_manager_relations" ADD CONSTRAINT "employee_manager_relations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_manager_relations" ADD CONSTRAINT "employee_manager_relations_employee_id_workers_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_manager_relations" ADD CONSTRAINT "employee_manager_relations_manager_id_workers_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_titles" ADD CONSTRAINT "employee_titles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_wage_groups" ADD CONSTRAINT "employee_wage_groups_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_wage_groups" ADD CONSTRAINT "employee_wage_groups_wage_group_id_secondary_wage_groups_id_fk" FOREIGN KEY ("wage_group_id") REFERENCES "public"."secondary_wage_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_events" ADD CONSTRAINT "engagement_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_events" ADD CONSTRAINT "engagement_events_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_events" ADD CONSTRAINT "engagement_events_project_id_customer_onboarding_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."customer_onboarding_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_role_permissions" ADD CONSTRAINT "enterprise_role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_role_permissions" ADD CONSTRAINT "enterprise_role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception_policies" ADD CONSTRAINT "exception_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_submitter_id_workers_id_fk" FOREIGN KEY ("submitter_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_accounts" ADD CONSTRAINT "funding_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_policies" ADD CONSTRAINT "holiday_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_approval_workflows" ADD CONSTRAINT "invoice_approval_workflows_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_templates" ADD CONSTRAINT "invoice_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_template_id_invoice_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."invoice_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_groups" ADD CONSTRAINT "kpi_groups_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_policies" ADD CONSTRAINT "meal_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "new_hire_defaults" ADD CONSTRAINT "new_hire_defaults_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_documents" ADD CONSTRAINT "onboarding_documents_project_id_customer_onboarding_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."customer_onboarding_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_documents" ADD CONSTRAINT "onboarding_documents_template_id_onboarding_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."onboarding_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_documents" ADD CONSTRAINT "onboarding_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_packet_steps" ADD CONSTRAINT "onboarding_packet_steps_packet_id_onboarding_packets_id_fk" FOREIGN KEY ("packet_id") REFERENCES "public"."onboarding_packets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_packets" ADD CONSTRAINT "onboarding_packets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_project_id_customer_onboarding_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."customer_onboarding_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_template_task_id_onboarding_template_tasks_id_fk" FOREIGN KEY ("template_task_id") REFERENCES "public"."onboarding_template_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_template_tasks" ADD CONSTRAINT "onboarding_template_tasks_template_id_onboarding_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."onboarding_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_templates" ADD CONSTRAINT "onboarding_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_policies" ADD CONSTRAINT "overtime_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_codes" ADD CONSTRAINT "pay_codes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_formulas" ADD CONSTRAINT "pay_formulas_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_methods" ADD CONSTRAINT "pay_methods_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_period_schedules" ADD CONSTRAINT "pay_period_schedules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_periods" ADD CONSTRAINT "pay_periods_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_stub_accounts" ADD CONSTRAINT "pay_stub_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_stub_accounts" ADD CONSTRAINT "pay_stub_accounts_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_stub_amendments" ADD CONSTRAINT "pay_stub_amendments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_stub_amendments" ADD CONSTRAINT "pay_stub_amendments_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_stub_transactions" ADD CONSTRAINT "pay_stub_transactions_payroll_item_id_payroll_items_id_fk" FOREIGN KEY ("payroll_item_id") REFERENCES "public"."payroll_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_stub_transactions" ADD CONSTRAINT "pay_stub_transactions_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_stub_transactions" ADD CONSTRAINT "pay_stub_transactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_method_configs" ADD CONSTRAINT "payment_method_configs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payment_methods" ADD CONSTRAINT "payroll_payment_methods_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payment_records" ADD CONSTRAINT "payroll_payment_records_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payment_records" ADD CONSTRAINT "payroll_payment_records_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payment_records" ADD CONSTRAINT "payroll_payment_records_payroll_item_id_payroll_items_id_fk" FOREIGN KEY ("payroll_item_id") REFERENCES "public"."payroll_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payment_records" ADD CONSTRAINT "payroll_payment_records_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payment_records" ADD CONSTRAINT "payroll_payment_records_payment_method_id_payroll_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payroll_payment_methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payment_records" ADD CONSTRAINT "payroll_payment_records_funding_account_id_funding_accounts_id_fk" FOREIGN KEY ("funding_account_id") REFERENCES "public"."funding_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_reimbursement_items" ADD CONSTRAINT "payroll_reimbursement_items_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_reimbursement_items" ADD CONSTRAINT "payroll_reimbursement_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_permission_group_id_permission_groups_id_fk" FOREIGN KEY ("permission_group_id") REFERENCES "public"."permission_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_groups" ADD CONSTRAINT "policy_groups_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_access_tokens" ADD CONSTRAINT "portal_access_tokens_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_access_tokens" ADD CONSTRAINT "portal_access_tokens_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_access_tokens" ADD CONSTRAINT "portal_access_tokens_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_access_tokens" ADD CONSTRAINT "portal_access_tokens_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "premium_policies" ADD CONSTRAINT "premium_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_api_keys" ADD CONSTRAINT "product_api_keys_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_groups" ADD CONSTRAINT "qualification_groups_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_billing_profiles" ADD CONSTRAINT "recurring_billing_profiles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_billing_profiles" ADD CONSTRAINT "recurring_billing_profiles_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_billing_profiles" ADD CONSTRAINT "recurring_billing_profiles_template_id_invoice_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."invoice_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expense_templates" ADD CONSTRAINT "recurring_expense_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expense_templates" ADD CONSTRAINT "recurring_expense_templates_submitter_id_workers_id_fk" FOREIGN KEY ("submitter_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_schedules" ADD CONSTRAINT "recurring_schedules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_schedules" ADD CONSTRAINT "recurring_schedules_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_schedules" ADD CONSTRAINT "recurring_schedules_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regular_time_policies" ADD CONSTRAINT "regular_time_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittance_agencies" ADD CONSTRAINT "remittance_agencies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittance_agency_events" ADD CONSTRAINT "remittance_agency_events_agency_id_remittance_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."remittance_agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittance_sources" ADD CONSTRAINT "remittance_sources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounding_policies" ADD CONSTRAINT "rounding_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_payment_methods" ADD CONSTRAINT "saved_payment_methods_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_payment_methods" ADD CONSTRAINT "saved_payment_methods_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_audit_logs" ADD CONSTRAINT "schedule_audit_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_policies" ADD CONSTRAINT "schedule_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_preferences" ADD CONSTRAINT "schedule_preferences_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_preferences" ADD CONSTRAINT "schedule_preferences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secondary_wage_groups" ADD CONSTRAINT "secondary_wage_groups_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_marketplace_listings" ADD CONSTRAINT "shift_marketplace_listings_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_marketplace_listings" ADD CONSTRAINT "shift_marketplace_listings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_marketplace_listings" ADD CONSTRAINT "shift_marketplace_listings_listed_by_worker_id_workers_id_fk" FOREIGN KEY ("listed_by_worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_marketplace_requests" ADD CONSTRAINT "shift_marketplace_requests_listing_id_shift_marketplace_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."shift_marketplace_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_marketplace_requests" ADD CONSTRAINT "shift_marketplace_requests_requesting_worker_id_workers_id_fk" FOREIGN KEY ("requesting_worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_offers" ADD CONSTRAINT "shift_offers_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_offers" ADD CONSTRAINT "shift_offers_offered_by_worker_id_workers_id_fk" FOREIGN KEY ("offered_by_worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_offers" ADD CONSTRAINT "shift_offers_claimed_by_worker_id_workers_id_fk" FOREIGN KEY ("claimed_by_worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_packages" ADD CONSTRAINT "signature_packages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_packages" ADD CONSTRAINT "signature_packages_signature_request_id_document_signature_requests_id_fk" FOREIGN KEY ("signature_request_id") REFERENCES "public"."document_signature_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_message_recipients" ADD CONSTRAINT "staff_message_recipients_message_id_staff_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."staff_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_message_recipients" ADD CONSTRAINT "staff_message_recipients_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_messages" ADD CONSTRAINT "staff_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_messages" ADD CONSTRAINT "staff_messages_sender_id_workers_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_messages" ADD CONSTRAINT "staff_messages_recipient_worker_id_workers_id_fk" FOREIGN KEY ("recipient_worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stations" ADD CONSTRAINT "stations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxes_deductions" ADD CONSTRAINT "taxes_deductions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_requests" ADD CONSTRAINT "time_off_requests_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_requests" ADD CONSTRAINT "time_off_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_punches" ADD CONSTRAINT "time_punches_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_punches" ADD CONSTRAINT "time_punches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_company_access" ADD CONSTRAINT "user_company_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_company_access" ADD CONSTRAINT "user_company_access_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_company_access" ADD CONSTRAINT "user_company_access_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wage_history" ADD CONSTRAINT "wage_history_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wage_history" ADD CONSTRAINT "wage_history_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_documents" ADD CONSTRAINT "worker_documents_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_languages" ADD CONSTRAINT "worker_languages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_languages" ADD CONSTRAINT "worker_languages_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_memberships" ADD CONSTRAINT "worker_memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_memberships" ADD CONSTRAINT "worker_memberships_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;