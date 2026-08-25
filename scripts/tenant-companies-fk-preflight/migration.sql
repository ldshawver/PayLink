-- Phase 0.5, Branch 2: add the missing FK from tenant_companies.tenant_id to tenants.id.
--
-- NOT WIRED INTO shared/schema.ts, drizzle-kit push, or any automatic
-- migration path. This file is a prepared, ready-to-run script for a human
-- (or a future authorized branch) to execute once check-orphans.ts reports a
-- clean result (0 orphans, 0 NULLs, compatible types) against the REAL
-- target database — this branch could not obtain that real-database result
-- (staging/production tenant data was explicitly out of scope), so this
-- migration is NOT authorized to run yet. See
-- docs/saas-readiness/phase-0.5-tenant-companies-fk-preflight.md for the
-- full evidence and reasoning.
--
-- Additive and reversible: adds one constraint, touches no existing rows,
-- and can be fully undone by rollback.sql in this same directory.
--
-- ON DELETE CASCADE, matching the sibling company_id FK
-- (shared/schema.ts:4691, `.references(() => companies.id, { onDelete: "cascade" })`)
-- and the join-table semantics of tenant_companies: a membership row has no
-- independent meaning once its tenant is gone. No code path in this
-- codebase currently deletes a `tenants` row (confirmed by exhaustive grep —
-- see the preflight doc's lifecycle trace), so this clause is currently
-- inert in practice, not something exercised by any existing route today;
-- it is chosen for schema correctness and consistency with company_id, not
-- because a deletion flow exists to trigger it.
--
-- Run manually (not via drizzle-kit push, which does not know about this
-- constraint since it is intentionally absent from shared/schema.ts):
--   psql "$DATABASE_URL" -f scripts/tenant-companies-fk-preflight/migration.sql

BEGIN;

ALTER TABLE tenant_companies
  ADD CONSTRAINT tenant_companies_tenant_id_tenants_id_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  ON DELETE CASCADE;

COMMIT;
