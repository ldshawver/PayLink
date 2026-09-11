-- 0026 — Audited platform-staff support sessions (Concierge Launch Option A,
-- blocker 1).
--
-- Additive only. No DROP / no DELETE / no backfill. Applied at runtime via
-- the startup DDL in server/index.ts ("support_sessions table") — this file
-- is the readable record of that change, same as every other migration here.
--
-- Scope: this is a logged, time-boxed "I'm assisting this tenant, here's
-- why" grant for platform staff — not a full session-impersonation / view-
-- as-tenant capability. Platform staff already reach any tenant's data
-- through the existing platform-console routes (gated by role, not company
-- membership); this adds the audit trail that was missing, not new access.

CREATE TABLE IF NOT EXISTS support_sessions (
  id                VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_user_id  VARCHAR NOT NULL,
  company_id        VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  reason            TEXT NOT NULL,
  started_at        TIMESTAMPTZ DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL,
  ended_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_support_sessions_company ON support_sessions (company_id);
CREATE INDEX IF NOT EXISTS idx_support_sessions_active ON support_sessions (company_id) WHERE ended_at IS NULL;
