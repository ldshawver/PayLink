-- 0041 — PayPal tenant subscriptions.
--
-- Additive only. No DROP / no DELETE / no backfill. Applied at runtime via
-- the startup DDL in server/index.ts (see "paypal billing columns").
--
-- If another open PR also claims 0041, renumber this file. 0040 is the
-- self-hosted AI controls migration on a separate branch.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS paypal_subscription_id TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS paypal_plan_id TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS paypal_quantity INTEGER;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS paypal_next_billing_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS paypal_webhook_events (
  event_id    TEXT PRIMARY KEY,
  event_type  TEXT NOT NULL,
  company_id  VARCHAR,
  resource_id TEXT,
  received_at TIMESTAMP NOT NULL DEFAULT NOW()
);
