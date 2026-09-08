-- 0021 — vendor portal (PR 3 of the SaaS identity/onboarding cleanup).
--
-- Additive only. Three new tables: `vendors`, `vendor_documents`,
-- `vendor_invoices`. No changes to workers / users / customers / account_invites
-- / identity_links / expenses / expense_payments / any ledger, check, or
-- payment table. No data backfill.
--
-- Vendors are a FIRST-CLASS entity — deliberately NOT modelled as `customers`
-- (customers are SaaS tenants / AR; vendors are AP payees / service providers).
-- Portal login reuses the PR 1 account_invites + identity_links system with
-- account_invites.relationship_kind = 'vendor' and
-- identity_links.subject_type = 'vendor' — no separate access table needed.
--
-- Scoping keys (company_id, vendor_id) are plain VARCHAR with NO foreign-key
-- constraint, matching the recent-table convention in this repo
-- (contractor_documents, contractor_access_requests, account_invites). Every
-- read/write in server/identity/vendors.ts is explicitly company/vendor-scoped.
--
-- Vendor invoice / W-9 uploads create REVIEWABLE records only. Approving or
-- rejecting a vendor invoice in PR 3 sets a status and nothing else — it does
-- NOT create an expense, an expense_payment, a check, a contractor_payment, or
-- any ledger row.
--
-- Backup before applying in production:
--   pg_dump "$DATABASE_URL" > backups/pre_0021_vendor_portal_$(date +%Y%m%d_%H%M%S).sql

CREATE TABLE IF NOT EXISTS vendors (
  id                  VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          VARCHAR NOT NULL,
  business_name       TEXT NOT NULL,
  contact_name        TEXT,
  email               TEXT,
  phone               TEXT,
  address             TEXT,
  city                TEXT,
  state               TEXT,
  zip                 TEXT,
  tax_id              TEXT,
  service_type        TEXT,
  notes               TEXT,
  status              TEXT NOT NULL DEFAULT 'active',
  created_by_user_id  VARCHAR,
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vendors_company ON vendors (company_id);
CREATE INDEX IF NOT EXISTS idx_vendors_email ON vendors (LOWER(email));

CREATE TABLE IF NOT EXISTS vendor_documents (
  id                   VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id            VARCHAR NOT NULL,
  company_id           VARCHAR NOT NULL,
  document_type        TEXT NOT NULL DEFAULT 'w9',
  file_name            TEXT NOT NULL,
  file_url             TEXT NOT NULL,
  file_size            INTEGER,
  mime_type            TEXT,
  notes                TEXT,
  uploaded_by_user_id  VARCHAR NOT NULL,
  created_at           TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vendor_documents_vendor ON vendor_documents (vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_documents_company ON vendor_documents (company_id);

CREATE TABLE IF NOT EXISTS vendor_invoices (
  id                   VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id            VARCHAR NOT NULL,
  company_id           VARCHAR NOT NULL,
  invoice_number       TEXT,
  amount               NUMERIC,
  currency             TEXT DEFAULT 'USD',
  invoice_date         DATE,
  due_date             DATE,
  description          TEXT,
  status               TEXT NOT NULL DEFAULT 'submitted',
  file_name            TEXT,
  file_url             TEXT,
  file_size            INTEGER,
  mime_type            TEXT,
  submitted_by_user_id VARCHAR,
  reviewed_by_user_id  VARCHAR,
  reviewed_at          TIMESTAMP,
  review_note          TEXT,
  created_at           TIMESTAMP DEFAULT NOW(),
  updated_at           TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vendor_invoices_vendor ON vendor_invoices (vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_invoices_company_status ON vendor_invoices (company_id, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK
--
-- Purely additive. Preferred rollback for a released build is a COMPATIBLE CODE
-- ROLLBACK (redeploy the prior application tag) while LEAVING THIS SCHEMA IN
-- PLACE — the prior code never reads these tables, so they are inert. No
-- production row outside these three tables is touched by this migration, so
-- there is nothing to un-migrate.
--
-- Destructive teardown — DISPOSABLE TEST DATABASES ONLY, never production:
--   DROP TABLE IF EXISTS vendor_invoices;
--   DROP TABLE IF EXISTS vendor_documents;
--   DROP TABLE IF EXISTS vendors;
-- ─────────────────────────────────────────────────────────────────────────────
