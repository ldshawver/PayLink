-- 0039 — Platform settings (trial length).
--
-- Additive only. No DROP / no DELETE / no backfill. Applied at runtime via
-- the startup DDL in server/index.ts (see "platform_settings table").
-- This file is the readable record of that change.
--
-- No seed row is inserted. A missing row means the application default of
-- 30 trial days, which is the previous hard-coded length.

CREATE TABLE IF NOT EXISTS platform_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_by  VARCHAR
);
