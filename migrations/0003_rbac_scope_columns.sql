-- Migration: 0003_rbac_scope_columns
-- Task #5 — Enterprise RBAC & Scope-Aware Permissions
-- Adds the two missing scope-approve columns to role_permissions

--> statement-breakpoint
ALTER TABLE "role_permissions" ADD COLUMN IF NOT EXISTS "can_approve_department" boolean DEFAULT false;
--> statement-breakpoint
ALTER TABLE "role_permissions" ADD COLUMN IF NOT EXISTS "can_approve_company" boolean DEFAULT false;
