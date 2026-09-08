-- 0019 — SaaS identity/onboarding foundation: account_invites + identity_links.
--
-- Additive only. This is PR 1 of the identity/onboarding architecture cleanup
-- (see docs/saas-identity-onboarding-architecture.md). It introduces the
-- "one login identity, many relationships" model WITHOUT touching users,
-- workers, customers, or the two existing company-access tables
-- (user_company_access, company_user_access — convergence is deferred to a
-- separate cleanup epic).
--
-- New tables:
--
--   account_invites   — an outstanding invitation to create/bind a login
--                       account. Stores sha256(token) only; the raw token
--                       lives only in the emailed link. Accepting the invite
--                       is what creates the `users` row and lets the invitee
--                       set their own password (no admin-entered passwords).
--
--   identity_links    — backing table for the shared identity resolver. One
--                       `users` row ⇄ many domain relationships
--                       (worker / vendor / customer / person). Links are
--                       always established on a deterministic, company-scoped
--                       email match; a conflicting email becomes a
--                       `pending_review` row, never a silent merge. Never
--                       matched on name.
--
-- New columns on `users` (all nullable / defaulted, so every existing row is
-- valid and unchanged, and existing username/password logins keep working):
--
--   users.invite_status     — none | invited | active | suspended  (default 'none')
--   users.last_login_at     — stamped by POST /api/auth/login
--   users.email_verified_at — stamped when an invite is accepted / email proven
--
-- No data is backfilled. No column is dropped. No production data is touched by
-- this migration.
--
-- Backup before applying in production:
--   pg_dump "$DATABASE_URL" > backups/pre_0019_identity_links_and_invites_$(date +%Y%m%d_%H%M%S).sql

-- ── users: additive identity columns ─────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_status TEXT DEFAULT 'none';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP;

-- ── account_invites ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS account_invites (
  id                  VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          VARCHAR,
  email               TEXT NOT NULL,
  relationship_kind   TEXT NOT NULL DEFAULT 'employee',
  relationship_id     VARCHAR,
  role                TEXT NOT NULL DEFAULT 'employee',
  token_hash          TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',
  invited_by_user_id  VARCHAR,
  invited_user_id     VARCHAR,
  expires_at          TIMESTAMP NOT NULL,
  accepted_at         TIMESTAMP,
  revoked_at          TIMESTAMP,
  last_sent_at        TIMESTAMP DEFAULT NOW(),
  created_at          TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_account_invites_token_hash ON account_invites (token_hash);
CREATE INDEX IF NOT EXISTS idx_account_invites_email ON account_invites (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_account_invites_company ON account_invites (company_id);
CREATE INDEX IF NOT EXISTS idx_account_invites_relationship ON account_invites (relationship_kind, relationship_id);
-- At most one live (pending) invite per (company, relationship) target.
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_invites_pending_target
  ON account_invites (company_id, relationship_kind, relationship_id)
  WHERE status = 'pending' AND relationship_id IS NOT NULL;

-- ── identity_links ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS identity_links (
  id               VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_type     TEXT NOT NULL,
  subject_id       VARCHAR NOT NULL,
  company_id       VARCHAR,
  tenant_id        VARCHAR,
  link_status      TEXT NOT NULL DEFAULT 'active',
  verified_email   TEXT,
  linked_by_user_id VARCHAR,
  review_reason    TEXT,
  created_at       TIMESTAMP DEFAULT NOW(),
  revoked_at       TIMESTAMP
);

-- One (user, subject) link, regardless of status.
CREATE UNIQUE INDEX IF NOT EXISTS uq_identity_links_user_subject
  ON identity_links (user_id, subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_identity_links_subject ON identity_links (subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_identity_links_company ON identity_links (company_id);
CREATE INDEX IF NOT EXISTS idx_identity_links_email ON identity_links (LOWER(verified_email));

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK
--
-- Purely additive. Preferred rollback for a released build is a COMPATIBLE CODE
-- ROLLBACK (redeploy the prior application tag) while LEAVING THIS SCHEMA IN
-- PLACE — the prior code never reads these tables/columns, so they are inert.
--
-- Destructive teardown — DISPOSABLE TEST DATABASES ONLY:
--   DROP TABLE IF EXISTS identity_links;
--   DROP TABLE IF EXISTS account_invites;
--   ALTER TABLE users DROP COLUMN IF EXISTS invite_status;
--   ALTER TABLE users DROP COLUMN IF EXISTS last_login_at;
--   ALTER TABLE users DROP COLUMN IF EXISTS email_verified_at;
-- ─────────────────────────────────────────────────────────────────────────────
