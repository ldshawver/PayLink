-- 0027 — tenant_provisioning_audit_logs (production schema readiness, P0).
--
-- Production deploys never run drizzle-kit push, so this table — declared in
-- shared/schema.ts (tenantProvisioningAuditLogs) and present on staging — was
-- never created on production. Since #182, billingLifecycle.getSuspensionSource()
-- treats its absence as "unverifiable" (fail closed: a Stripe payment never
-- lifts any suspension) and admin suspension via POST /api/provisioning/event
-- rolls back with a 500. Creating the table restores both paths.
--
-- Additive only: one new empty table plus the migration ledger. No DROP, no
-- DELETE, no backfill, no change to any existing object. Columns, defaults and
-- the primary key match `drizzle-kit push` of shared/schema.ts exactly (the
-- table has no FK and no secondary index in schema.ts).
--
-- Versioning: records '0027' in paylink_migrations.applied. That ledger lives
-- in its own schema because drizzle-kit only manages "public", so a later push
-- never sees it.
--
-- Rerun: a no-op when the table already exists with the expected shape. A
-- table of the same name with any other shape aborts the whole migration with
-- an explicit error; nothing is changed.
--
-- Apply (one transaction, stops on first error) AS THE ROLE THAT OWNS THE APP
-- TABLES — the guard below refuses any other role, so the table cannot end up
-- owned by a superuser the app cannot write as:
--   psql "<app DATABASE_URL>" -v ON_ERROR_STOP=1 -f migrations/0027_tenant_provisioning_audit_logs.sql
-- Verify:  SELECT to_regclass('public.tenant_provisioning_audit_logs');
--          SELECT * FROM paylink_migrations.applied WHERE version = '0027';
-- Recovery: see docs/saas-readiness/schema-readiness-0027-0028.md. The file is
-- a single transaction; a failure leaves the database exactly as it was.

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE app_owner text;
BEGIN
  SELECT tableowner INTO app_owner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'companies';
  IF app_owner IS NULL THEN
    RAISE EXCEPTION '0027: public.companies not found — wrong database?';
  END IF;
  IF app_owner <> current_user THEN
    RAISE EXCEPTION '0027: run as the app table owner (%), not %', app_owner, current_user;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS paylink_migrations;
CREATE TABLE IF NOT EXISTS paylink_migrations.applied (
  version     TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_by  TEXT NOT NULL DEFAULT current_user
);

CREATE TABLE IF NOT EXISTS public.tenant_provisioning_audit_logs (
  id            VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    VARCHAR NOT NULL,
  event_type    TEXT NOT NULL,
  step          TEXT,
  status        TEXT NOT NULL DEFAULT 'success',
  details       TEXT,
  triggered_by  TEXT DEFAULT 'system',
  created_at    TIMESTAMP DEFAULT NOW()
);

-- Shape check: holds whether the table was just created or already existed.
DO $$
DECLARE got text; want text :=
  'company_id:character varying:NO:|created_at:timestamp without time zone:YES:now()|details:text:YES:|'
  'event_type:text:NO:|id:character varying:NO:gen_random_uuid()|status:text:NO:''success''::text|'
  'step:text:YES:|triggered_by:text:YES:''system''::text';
BEGIN
  SELECT string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''), '|' ORDER BY column_name)
    INTO got FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'tenant_provisioning_audit_logs';
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION '0027: public.tenant_provisioning_audit_logs exists with an unexpected shape: %', got;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.tenant_provisioning_audit_logs'::regclass AND contype = 'p'
       AND pg_get_constraintdef(oid) = 'PRIMARY KEY (id)'
  ) THEN
    RAISE EXCEPTION '0027: public.tenant_provisioning_audit_logs has no PRIMARY KEY (id)';
  END IF;
END $$;

INSERT INTO paylink_migrations.applied (version, name)
VALUES ('0027', 'tenant_provisioning_audit_logs')
ON CONFLICT (version) DO NOTHING;

COMMIT;
