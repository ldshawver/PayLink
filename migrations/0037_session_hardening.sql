-- 0037 — Session hardening (single active session, optional).
--
-- Additive only. No DROP / no DELETE / no backfill / no NOT NULL added to an
-- existing column. Applied at runtime via the startup DDL in server/index.ts
-- (see "users.active_session_id"), same mechanism as the other migrations in
-- this directory — this file is the readable record of that change.
--
-- users.active_session_id is written only when SINGLE_SESSION_PER_USER is
-- enabled (default off). Existing sessions keep working: a NULL value means
-- "no session is bound", and the check is skipped entirely while the setting
-- is off.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS active_session_id TEXT;
