-- 0031 — Company-scoped employee / time-clock sign-in, per-company employee
-- numbering, and hashed PINs (schema + backfill; application code ships in the
-- same PR but only switches to company-scoped sign-in once this is recorded).
--
-- Adds:
--   company_signin_codes        one non-sequential sign-in code per company
--                               (tenant ROUTING, not a credential) + version
--                               used to invalidate remembered devices
--   employee_number_counters    per-company, per-year (YY) allocation counter
--   time_clock_kiosk_bindings   admin-created device bindings (token hash only)
--   employee_signin_events      audit of sign-in attempts (never PINs)
--   uq_workers_company_employee_number  UNIQUE (company_id, employee_number)
-- Backfills:
--   - a sign-in code for every company that has none
--   - each company's counter for the current year from its OWN existing
--     numbers (max YYNN for the current YY) — existing numbers are untouched
--   - workers.pin_hash = bcrypt(pin) for every worker with a plaintext PIN,
--     computed INSIDE the database (pgcrypto) so no PIN leaves Postgres
--
-- NOT done here (deliberately): clearing workers.pin. Plaintext PINs stay
-- until migration 0032 so a rollback to v2.2.21 keeps PIN sign-in working.
-- The application never reads workers.pin once a pin_hash exists.
--
-- workers.pin_hash itself is added by the server's boot-time additive DDL
-- (ADD COLUMN IF NOT EXISTS); this file adds it too so it is self-contained.
--
-- Refuses to run if any company already has a duplicate employee number
-- (the unique index would fail) — resolve those first; nothing is renumbered.
--
-- Versioning: records '0031' in paylink_migrations.applied. Rerun: a no-op.
--
-- Apply (one transaction, stops on first error) AS THE ROLE THAT OWNS THE APP
-- TABLES — the guard below refuses any other role:
--   psql "<app DATABASE_URL>" -v ON_ERROR_STOP=1 -f migrations/0031_company_scoped_signin.sql
-- Verify:  SELECT * FROM paylink_migrations.applied WHERE version = '0031';

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
DECLARE app_owner text; dup_count int;
BEGIN
  SELECT tableowner INTO app_owner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'companies';
  IF app_owner IS NULL THEN
    RAISE EXCEPTION '0031: public.companies not found — wrong database?';
  END IF;
  IF app_owner <> current_user THEN
    RAISE EXCEPTION '0031: run as the app table owner (%), not %', app_owner, current_user;
  END IF;
  SELECT count(*) INTO dup_count FROM (
    SELECT company_id, employee_number FROM workers
    WHERE employee_number IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION '0031: % duplicate (company_id, employee_number) pairs exist — resolve them first (nothing is renumbered automatically)', dup_count;
  END IF;
END $$;

-- Trusted extension on PG13+: the database owner may create it.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS paylink_migrations;
CREATE TABLE IF NOT EXISTS paylink_migrations.applied (
  version     TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by  TEXT NOT NULL DEFAULT current_user
);

-- ── Hashed PINs ────────────────────────────────────────────────────────────
ALTER TABLE workers ADD COLUMN IF NOT EXISTS pin_hash TEXT;
UPDATE workers
   SET pin_hash = crypt(pin, gen_salt('bf', 10))
 WHERE pin IS NOT NULL AND pin <> '' AND pin_hash IS NULL;

-- ── Per-company sign-in code (routing, not a credential) ───────────────────
-- Display form XXXX-XXXX over an unambiguous 31-symbol alphabet; stored in
-- normalized form (no dash, upper-case). ~39 bits, random, unrelated to ids.
CREATE TABLE IF NOT EXISTS company_signin_codes (
  company_id          VARCHAR PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  code                TEXT NOT NULL,
  code_version        INTEGER NOT NULL DEFAULT 1,
  rotated_at          TIMESTAMP,
  rotated_by_user_id  VARCHAR,
  created_at          TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT ck_company_signin_code_format CHECK (code ~ '^[A-HJ-NP-Z2-9]{8}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_signin_codes_code ON company_signin_codes (code);

CREATE OR REPLACE FUNCTION paylink_random_signin_code() RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result text := '';
  b int;
BEGIN
  WHILE length(result) < 8 LOOP
    b := get_byte(gen_random_bytes(1), 0);
    IF b < 248 THEN  -- 248 = 8 * 31: rejection sampling, no modulo bias
      result := result || substr(alphabet, (b % 31) + 1, 1);
    END IF;
  END LOOP;
  RETURN result;
END $$;

DO $$
DECLARE r record; candidate text; attempts int;
BEGIN
  FOR r IN SELECT c.id FROM companies c
           WHERE NOT EXISTS (SELECT 1 FROM company_signin_codes s WHERE s.company_id = c.id) LOOP
    attempts := 0;
    LOOP
      candidate := paylink_random_signin_code();
      attempts := attempts + 1;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM company_signin_codes WHERE code = candidate);
      IF attempts > 20 THEN RAISE EXCEPTION '0031: could not generate a unique sign-in code'; END IF;
    END LOOP;
    INSERT INTO company_signin_codes (company_id, code) VALUES (r.id, candidate);
  END LOOP;
END $$;

-- ── Per-company employee-number counters ───────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_number_counters (
  company_id   VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year_prefix  CHAR(2) NOT NULL,
  last_value   INTEGER NOT NULL,
  updated_at   TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, year_prefix),
  CONSTRAINT ck_employee_number_counter_range CHECK (last_value BETWEEN 0 AND 99),
  CONSTRAINT ck_employee_number_counter_prefix CHECK (year_prefix ~ '^\d{2}$')
);
-- Seed the current year from each company's OWN highest YYNN (existing data).
INSERT INTO employee_number_counters (company_id, year_prefix, last_value)
SELECT w.company_id, to_char(now(), 'YY'), max(substr(w.employee_number, 3, 2)::int)
  FROM workers w
 WHERE w.company_id IS NOT NULL
   AND w.employee_number ~ ('^' || to_char(now(), 'YY') || '\d{2}$')
 GROUP BY w.company_id
ON CONFLICT (company_id, year_prefix) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS uq_workers_company_employee_number
  ON workers (company_id, employee_number) WHERE employee_number IS NOT NULL;

-- ── Time-clock kiosk bindings (device token hash only) ─────────────────────
CREATE TABLE IF NOT EXISTS time_clock_kiosk_bindings (
  id                  VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  label               TEXT NOT NULL,
  token_hash          TEXT NOT NULL,
  created_by_user_id  VARCHAR NOT NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMP,
  revoked_at          TIMESTAMP,
  revoked_by_user_id  VARCHAR,
  CONSTRAINT ck_kiosk_label CHECK (length(label) BETWEEN 1 AND 80)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_time_clock_kiosk_token ON time_clock_kiosk_bindings (token_hash);
CREATE INDEX IF NOT EXISTS idx_time_clock_kiosk_company ON time_clock_kiosk_bindings (company_id) WHERE revoked_at IS NULL;

-- ── Sign-in audit (never stores PINs or codes) ─────────────────────────────
CREATE TABLE IF NOT EXISTS employee_signin_events (
  id               VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       VARCHAR,
  worker_id        VARCHAR,
  channel          TEXT NOT NULL,
  outcome          TEXT NOT NULL,
  reason           TEXT,
  employee_number  TEXT,
  ip_hash          TEXT,
  user_agent       TEXT,
  created_at       TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT ck_signin_event_outcome CHECK (outcome IN ('success','failure','locked','rate_limited'))
);
CREATE INDEX IF NOT EXISTS idx_signin_events_target ON employee_signin_events (company_id, employee_number, created_at);
CREATE INDEX IF NOT EXISTS idx_signin_events_created ON employee_signin_events (created_at);

INSERT INTO paylink_migrations.applied (version, name)
VALUES ('0031', 'company_scoped_signin')
ON CONFLICT (version) DO NOTHING;

COMMIT;
