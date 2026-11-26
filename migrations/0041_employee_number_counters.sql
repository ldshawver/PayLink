-- 0041 — Per-company employee numbers (YYNN).
--
-- Adds:
--   employee_number_counters                 per-company, per-year (YY) allocation counter
--   uq_workers_company_employee_number       UNIQUE (company_id, employee_number)
--                                            WHERE employee_number IS NOT NULL
--
-- Seeds the current UTC year from each company's OWN highest YYNN. Existing
-- employee numbers are not rewritten and are not renumbered. Numbers that are
-- not YYNN (for example 1001 or EMP-001) stay as they are; the next automatic
-- number for that company is the next free YYNN.
--
-- Refuses to run if any company already has two workers with the same
-- employee number. Resolve those first. Nothing is renumbered automatically.
--
-- This migration does NOT hash PINs, clear workers.pin, or create sign-in
-- codes, kiosk bindings, or sign-in audit tables. Those remain in the
-- unmerged company-scoped sign-in draft and are not part of this change.
--
-- Additive and idempotent. Versioning: records '0041' in
-- paylink_migrations.applied. Rerun: a no-op. Requires 0037, the latest
-- migration on main (session hardening). 0038 and 0039 are still open on
-- #216 and #217. #219 claimed 0040, so this file uses 0041. If another
-- migration takes 0041 before this merges, renumber this file and its
-- ledger version before applying it.
--
-- Take and verify a database backup before applying. Apply (one transaction,
-- stops on first error) AS THE ROLE THAT OWNS THE APP TABLES:
--   psql "<app DATABASE_URL>" -v ON_ERROR_STOP=1 -f migrations/0041_employee_number_counters.sql
-- Verify:  SELECT * FROM paylink_migrations.applied WHERE version = '0041';

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
DECLARE app_owner text; dup_count int;
BEGIN
  SELECT tableowner INTO app_owner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'companies';
  IF app_owner IS NULL THEN
    RAISE EXCEPTION '0041: public.companies not found — wrong database?';
  END IF;
  IF app_owner <> current_user THEN
    RAISE EXCEPTION '0041: run as the app table owner (%), not %', app_owner, current_user;
  END IF;
  IF to_regclass('paylink_migrations.applied') IS NULL
     OR NOT EXISTS (SELECT 1 FROM paylink_migrations.applied WHERE version = '0037') THEN
    RAISE EXCEPTION '0041: apply 0037 first';
  END IF;
  SELECT count(*) INTO dup_count FROM (
    SELECT company_id, employee_number FROM workers
    WHERE employee_number IS NOT NULL
    GROUP BY 1, 2 HAVING count(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION '0041: % duplicate (company_id, employee_number) pairs exist — resolve them first (nothing is renumbered automatically)', dup_count;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS paylink_migrations;
CREATE TABLE IF NOT EXISTS paylink_migrations.applied (
  version     TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by  TEXT NOT NULL DEFAULT current_user
);

CREATE TABLE IF NOT EXISTS employee_number_counters (
  company_id   VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year_prefix  CHAR(2) NOT NULL,
  last_value   INTEGER NOT NULL,
  updated_at   TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, year_prefix),
  CONSTRAINT ck_employee_number_counter_range CHECK (last_value BETWEEN 0 AND 99),
  CONSTRAINT ck_employee_number_counter_prefix CHECK (year_prefix ~ '^\d{2}$')
);

-- Seed the current UTC year from each company's own highest YYNN.
INSERT INTO employee_number_counters (company_id, year_prefix, last_value)
SELECT w.company_id, to_char((now() AT TIME ZONE 'UTC'), 'YY'), max(substr(w.employee_number, 3, 2)::int)
  FROM workers w
 WHERE w.company_id IS NOT NULL
   AND w.employee_number ~ ('^' || to_char((now() AT TIME ZONE 'UTC'), 'YY') || '\d{2}$')
 GROUP BY w.company_id
ON CONFLICT (company_id, year_prefix) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS uq_workers_company_employee_number
  ON workers (company_id, employee_number) WHERE employee_number IS NOT NULL;

INSERT INTO paylink_migrations.applied (version, name)
VALUES ('0041', 'employee_number_counters')
ON CONFLICT (version) DO NOTHING;

COMMIT;
