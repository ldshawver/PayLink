-- 0038 — Per-user password reset tokens.
--
-- Additive only. No DROP / no DELETE / no backfill. Applied at runtime via
-- the startup DDL in server/index.ts (see "password_reset_tokens table").
-- This file is the readable record of that change.
--
-- The raw token is emailed once. Only token_hash is stored. consumed_at
-- makes the token single-use; expires_at makes it time-limited.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMP NOT NULL,
  consumed_at TIMESTAMP,
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_password_reset_tokens_token_hash
  ON password_reset_tokens (token_hash);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
  ON password_reset_tokens (user_id);
