-- 0025 — Trial-signup email verification (Concierge Launch Option A, blocker 5).
--
-- Additive only. No DROP / no DELETE / no backfill / no NOT NULL added to an
-- existing column. Applied at runtime via the startup DDL in server/index.ts
-- (see "users.email_verification_required" / "email_verifications table"),
-- same mechanism as every other migration in this directory — this file is
-- the readable record of that change, not a script that runs on its own.
--
-- users.email_verification_required defaults FALSE and is set TRUE only by
-- POST /api/trial/signup, so no pre-existing account (or any account created
-- by any other path) is affected by the new login-time verification gate.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verification_required BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS email_verifications (
  id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMP NOT NULL,
  consumed_at TIMESTAMP,
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_verifications_token_hash ON email_verifications (token_hash);
CREATE INDEX IF NOT EXISTS idx_email_verifications_user_id ON email_verifications (user_id);
