-- Phase 0.5, Branch 2 (apply): add the tenant_companies.tenant_id -> tenants.id
-- foreign key. This is the canonical, versioned source for that constraint;
-- scripts/tenant-companies-fk-preflight/migration.sql is the identical
-- statement kept in place as the reviewed preflight evidence artifact (see
-- docs/saas-readiness/phase-0.5-tenant-companies-fk-preflight.md) and as the
-- script scripts/tenant-companies-fk-preflight/check-orphans.ts's own
-- companion — both files must stay in sync; this file is not a replacement
-- for either.
--
-- NOT wired into shared/schema.ts or drizzle-kit push (db:push), and NOT
-- added to server/index.ts's auto-apply-on-startup DDL safety net. Both of
-- those run unconditionally on every environment (including every disposable
-- test database and every staging/production boot); adding the FK there
-- would apply it immediately and unconditionally, skipping the required
-- gate below. This file is a prepared, ready-to-run script for a human (or a
-- future authorized branch) to execute manually, once
-- scripts/tenant-companies-fk-preflight/check-orphans.ts reports a clean
-- result (0 orphans, 0 NULLs, compatible types) against the REAL target
-- database immediately beforehand.
--
-- Additive and reversible: adds one constraint, touches no existing rows.
-- Rollback: scripts/tenant-companies-fk-preflight/rollback.sql (drops this
-- exact constraint by name, nothing else).
--
-- ON DELETE CASCADE, matching the sibling company_id FK
-- (shared/schema.ts:4691) and tenant_companies' join-table semantics: a
-- membership row has no independent meaning once its tenant is gone. No code
-- path in this codebase currently deletes a tenants row (see the preflight
-- doc's lifecycle trace), so this clause is inert in practice today.
--
-- Deployment gate (required before running against staging or production):
--   1. Rerun scripts/tenant-companies-fk-preflight/check-orphans.ts against
--      that exact target database and confirm a clean (exit 0) result.
--   2. Take a database backup.
--   3. Apply to staging first; validate with
--      scripts/tenant-companies-fk-preflight/validate.ts.
--   4. Production requires a fresh orphan check, a fresh backup, and
--      separate explicit approval per docs/deployment/staging-production-architecture.md.
--
-- Run:
--   psql "$DATABASE_URL" -f migrations/0015_tenant_companies_tenant_id_fk.sql

BEGIN;

ALTER TABLE tenant_companies
  ADD CONSTRAINT tenant_companies_tenant_id_tenants_id_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  ON DELETE CASCADE;

COMMIT;
