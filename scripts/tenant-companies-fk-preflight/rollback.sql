-- Rollback for scripts/tenant-companies-fk-preflight/migration.sql.
--
-- Drops only the constraint that migration.sql adds. Data-safe: removing a
-- FK constraint never deletes or modifies rows, only removes the
-- referential-integrity check itself. Dry-run verified in the disposable
-- preflight database — see
-- docs/saas-readiness/phase-0.5-tenant-companies-fk-preflight.md.
--
-- Run:
--   psql "$DATABASE_URL" -f scripts/tenant-companies-fk-preflight/rollback.sql

BEGIN;

ALTER TABLE tenant_companies
  DROP CONSTRAINT IF EXISTS tenant_companies_tenant_id_tenants_id_fk;

COMMIT;
