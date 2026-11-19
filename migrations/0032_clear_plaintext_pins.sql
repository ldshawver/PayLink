-- 0032 — Clear plaintext PINs once every PIN has a bcrypt hash.
--
-- IRREVERSIBLE for rollback purposes: after this, releases older than the
-- company-scoped sign-in release (<= v2.2.21) can no longer verify PINs.
-- Apply ONLY after the sign-in release is accepted in production and the
-- rollback window is closed.
--
-- Refuses unless 0031 is recorded and every non-empty plaintext PIN already
-- has a pin_hash (so no worker loses the ability to sign in).
--
-- Versioning: records '0032' in paylink_migrations.applied. Rerun: a no-op.
-- Apply AS THE APP TABLE OWNER:
--   psql "<app DATABASE_URL>" -v ON_ERROR_STOP=1 -f migrations/0032_clear_plaintext_pins.sql

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE app_owner text; unhashed int;
BEGIN
  SELECT tableowner INTO app_owner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'companies';
  IF app_owner IS NULL OR app_owner <> current_user THEN
    RAISE EXCEPTION '0032: run as the app table owner (%), not %', app_owner, current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM paylink_migrations.applied WHERE version = '0031') THEN
    RAISE EXCEPTION '0032: requires migration 0031 first';
  END IF;
  SELECT count(*) INTO unhashed FROM workers WHERE pin IS NOT NULL AND pin <> '' AND pin_hash IS NULL;
  IF unhashed > 0 THEN
    RAISE EXCEPTION '0032: % worker(s) have a plaintext PIN but no pin_hash — rerun 0031''s backfill first', unhashed;
  END IF;
END $$;

UPDATE workers SET pin = NULL WHERE pin IS NOT NULL;

INSERT INTO paylink_migrations.applied (version, name)
VALUES ('0032', 'clear_plaintext_pins')
ON CONFLICT (version) DO NOTHING;

COMMIT;
