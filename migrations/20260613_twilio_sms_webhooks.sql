-- Idempotent Twilio SMS webhook and consent support.
-- Backup step before production apply: pg_dump "$DATABASE_URL" --format=custom --file=backup-before-twilio-sms-webhooks.dump
ALTER TABLE sms_config ADD COLUMN IF NOT EXISTS use_messaging_service BOOLEAN DEFAULT FALSE;
ALTER TABLE sms_config ADD COLUMN IF NOT EXISTS webhook_url TEXT DEFAULT 'https://mypaylink.app/api/twilio/sms/inbound';
ALTER TABLE sms_config ADD COLUMN IF NOT EXISTS webhook_fallback_url TEXT DEFAULT 'https://mypaylink.app/api/twilio/sms/fallback';
ALTER TABLE sms_config ADD COLUMN IF NOT EXISTS status_callback_url TEXT DEFAULT 'https://mypaylink.app/api/twilio/sms/status';

CREATE TABLE IF NOT EXISTS sms_messages (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR,
  user_id VARCHAR,
  contact_id VARCHAR,
  provider TEXT DEFAULT 'twilio',
  direction TEXT NOT NULL,
  from_number TEXT,
  to_number TEXT,
  body TEXT,
  message_sid TEXT UNIQUE,
  status TEXT,
  error_code TEXT,
  error_message TEXT,
  raw_payload JSONB,
  source TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sms_consent (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR,
  phone_number TEXT NOT NULL,
  sms_opted_out BOOLEAN DEFAULT FALSE,
  opt_in_at TIMESTAMP,
  opt_out_at TIMESTAMP,
  opt_in_source TEXT,
  opt_out_source TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, phone_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS sms_consent_global_phone_unique ON sms_consent (phone_number) WHERE tenant_id IS NULL;
