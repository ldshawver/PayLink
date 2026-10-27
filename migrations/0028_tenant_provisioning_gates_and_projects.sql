-- 0028 — tenant_commercial_gates + tenant_implementation_projects (+ the
-- tenant_lifecycle_state enum) — production schema readiness, P0.
--
-- Same cause as 0027: declared in shared/schema.ts, present on staging, never
-- created on production. Without them every POST /api/provisioning/event
-- (getOrCreateGate runs first), admin suspension (#182 updates the gate in its
-- transaction), GET /api/provisioning/tenants[/:companyId] and the retry /
-- project routes return 500. Apply after 0027 (this file checks).
--
-- Additive only: one enum type, two new empty tables, their primary keys and
-- their FKs to companies(id) ON DELETE CASCADE. Names, columns, defaults and
-- constraints match `drizzle-kit push` of shared/schema.ts exactly. No DROP,
-- no DELETE, no backfill, no change to any existing object. Adding an FK to
-- an empty table takes a brief SHARE ROW EXCLUSIVE lock on companies (blocks
-- writes to companies, not reads); lock_timeout makes it fail fast instead of
-- queueing behind long transactions.
--
-- Rerun: no-op when everything exists with the expected shape; any mismatch
-- aborts the whole migration with an explicit error and changes nothing.
--
-- Apply as the app table owner, in one transaction:
--   psql "<app DATABASE_URL>" -v ON_ERROR_STOP=1 -f migrations/0028_tenant_provisioning_gates_and_projects.sql
-- Recovery: docs/saas-readiness/schema-readiness-0027-0028.md.

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE app_owner text;
BEGIN
  SELECT tableowner INTO app_owner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'companies';
  IF app_owner IS NULL THEN
    RAISE EXCEPTION '0028: public.companies not found — wrong database?';
  END IF;
  IF app_owner <> current_user THEN
    RAISE EXCEPTION '0028: run as the app table owner (%), not %', app_owner, current_user;
  END IF;
  -- Separate IFs: plpgsql would plan the ledger query even when the table is absent.
  IF to_regclass('paylink_migrations.applied') IS NULL THEN
    RAISE EXCEPTION '0028: apply 0027 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM paylink_migrations.applied WHERE version = '0027') THEN
    RAISE EXCEPTION '0028: apply 0027 first';
  END IF;
END $$;

DO $$
BEGIN
  CREATE TYPE public.tenant_lifecycle_state AS ENUM
    ('pending_activation', 'active', 'grace_period', 'suspended', 'reactivated', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
DECLARE got text;
BEGIN
  SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) INTO got
    FROM pg_enum e WHERE e.enumtypid = 'public.tenant_lifecycle_state'::regtype;
  IF got IS DISTINCT FROM 'pending_activation,active,grace_period,suspended,reactivated,cancelled' THEN
    RAISE EXCEPTION '0028: public.tenant_lifecycle_state exists with unexpected labels: %', got;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.tenant_commercial_gates (
  id                         VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                 VARCHAR NOT NULL,
  agreement_status           TEXT NOT NULL DEFAULT 'pending',
  implementation_fee_status  TEXT NOT NULL DEFAULT 'pending',
  subscription_status        TEXT NOT NULL DEFAULT 'pending',
  payment_method_status      TEXT NOT NULL DEFAULT 'pending',
  lifecycle_state            public.tenant_lifecycle_state NOT NULL DEFAULT 'pending_activation',
  selected_template          TEXT,
  provisioned_at             TIMESTAMP,
  suspended_at               TIMESTAMP,
  cancelled_at               TIMESTAMP,
  notes                      TEXT,
  created_at                 TIMESTAMP DEFAULT NOW(),
  updated_at                 TIMESTAMP DEFAULT NOW(),
  CONSTRAINT tenant_commercial_gates_company_id_companies_id_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.tenant_implementation_projects (
  id               VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       VARCHAR NOT NULL,
  template_key     TEXT NOT NULL,
  template_name    TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'in_progress',
  completed_steps  INTEGER NOT NULL DEFAULT 0,
  total_steps      INTEGER NOT NULL DEFAULT 0,
  checklist_items  TEXT,
  internal_tasks   TEXT,
  started_at       TIMESTAMP DEFAULT NOW(),
  completed_at     TIMESTAMP,
  created_at       TIMESTAMP DEFAULT NOW(),
  CONSTRAINT tenant_implementation_projects_company_id_companies_id_fk
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE
);

-- Shape check (columns + constraints): holds whether just created or pre-existing.
DO $$
DECLARE
  t record; got text;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('tenant_commercial_gates',
     'agreement_status:text:NO:''pending''::text|cancelled_at:timestamp without time zone:YES:|'
     'company_id:character varying:NO:|created_at:timestamp without time zone:YES:now()|'
     'id:character varying:NO:gen_random_uuid()|implementation_fee_status:text:NO:''pending''::text|'
     'lifecycle_state:USER-DEFINED:NO:''pending_activation''::tenant_lifecycle_state|notes:text:YES:|'
     'payment_method_status:text:NO:''pending''::text|provisioned_at:timestamp without time zone:YES:|'
     'selected_template:text:YES:|subscription_status:text:NO:''pending''::text|'
     'suspended_at:timestamp without time zone:YES:|updated_at:timestamp without time zone:YES:now()',
     'FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE|PRIMARY KEY (id)'),
    ('tenant_implementation_projects',
     'checklist_items:text:YES:|company_id:character varying:NO:|completed_at:timestamp without time zone:YES:|'
     'completed_steps:integer:NO:0|created_at:timestamp without time zone:YES:now()|'
     'id:character varying:NO:gen_random_uuid()|internal_tasks:text:YES:|'
     'started_at:timestamp without time zone:YES:now()|status:text:NO:''in_progress''::text|'
     'template_key:text:NO:|template_name:text:NO:|total_steps:integer:NO:0',
     'FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE|PRIMARY KEY (id)')
  ) AS v(tbl, cols, cons) LOOP
    SELECT string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''), '|' ORDER BY column_name)
      INTO got FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t.tbl;
    IF got IS DISTINCT FROM t.cols THEN
      RAISE EXCEPTION '0028: public.% exists with an unexpected shape: %', t.tbl, got;
    END IF;
    SELECT string_agg(pg_get_constraintdef(oid), '|' ORDER BY pg_get_constraintdef(oid)) INTO got
      FROM pg_constraint WHERE conrelid = ('public.' || t.tbl)::regclass;
    IF got IS DISTINCT FROM t.cons THEN
      RAISE EXCEPTION '0028: public.% has unexpected constraints: %', t.tbl, got;
    END IF;
  END LOOP;
END $$;

INSERT INTO paylink_migrations.applied (version, name)
VALUES ('0028', 'tenant_provisioning_gates_and_projects')
ON CONFLICT (version) DO NOTHING;

COMMIT;
