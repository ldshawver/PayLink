-- 0040 — Self-hosted AI on/off switches.
--
-- Additive only. No DROP / no DELETE / no backfill. Applied at runtime via
-- the startup DDL in server/index.ts (see "ai_controls table").
--
-- No seed row. A missing platform row means AI is off, even when AI_BASE_URL
-- is set. A missing company row follows the platform switch.
--
-- If another open PR also adds a migration at 0040, renumber this file.

CREATE TABLE IF NOT EXISTS ai_controls (
  subject_id  VARCHAR PRIMARY KEY,
  scope       TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL,
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_by  VARCHAR,
  CONSTRAINT ai_controls_scope_check CHECK (
    (scope = 'platform' AND subject_id = 'platform') OR
    (scope = 'company' AND subject_id <> 'platform')
  )
);
