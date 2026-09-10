-- 0024 — Documenso post-signing lifecycle.
--
-- Additive only. Supports webhook-independent pull-sync of Documenso signer /
-- contract status, a non-blank public return page, exactly-once auto-invoice on
-- full completion, and an exactly-once "signed contract" email to all real
-- signers.
--
-- No changes to any other table. No data backfill. No production-wide row
-- mutation. No DROP / no DELETE. All new columns are nullable.
--
-- New columns on contract_signers:
--   viewed_at    — first time Documenso reported this recipient opened/viewed
--   declined_at  — time Documenso reported this recipient declined/rejected
--
-- New columns on contractor_contracts:
--   signed_contract_emailed_at — set (exactly once, claimed atomically) when the
--                                fully-signed contract PDF has been emailed to
--                                every real signer. NULL means "not yet sent"
--                                and a later reconcile pass will retry.
--   signing_last_synced_at     — last time syncDocumensoContractStatus ran for
--                                this contract (observability + reconcile
--                                batching; never gates correctness).
--
-- Email-less placeholder signer rows (email IS NULL, no documenso_recipient_id)
-- are IGNORED for completion math and are never emailed — unchanged from prior
-- behavior, just now relied on explicitly.

ALTER TABLE contract_signers      ADD COLUMN IF NOT EXISTS viewed_at                  TIMESTAMP;
ALTER TABLE contract_signers      ADD COLUMN IF NOT EXISTS declined_at                TIMESTAMP;
ALTER TABLE contractor_contracts  ADD COLUMN IF NOT EXISTS signed_contract_emailed_at TIMESTAMP;
ALTER TABLE contractor_contracts  ADD COLUMN IF NOT EXISTS signing_last_synced_at     TIMESTAMP;

-- Reconcile loop scans contracts still in a non-terminal signing state; keep that
-- scan index-backed.
CREATE INDEX IF NOT EXISTS idx_contractor_contracts_signing_reconcile
  ON contractor_contracts (status, signing_last_synced_at)
  WHERE status IN ('sent', 'partially_signed', 'fully_signed');

-- Per-recipient sync matches contract_signers by (contract_id, documenso_recipient_id).
CREATE INDEX IF NOT EXISTS idx_contract_signers_contract_recipient
  ON contract_signers (contract_id, documenso_recipient_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK
--
-- Purely additive. Preferred rollback for a released build is a COMPATIBLE CODE
-- ROLLBACK (redeploy the prior application tag) while LEAVING THESE COLUMNS IN
-- PLACE — the prior code never reads them, so they are inert. No production row
-- outside these new nullable columns is touched.
--
-- Destructive teardown — DISPOSABLE TEST DATABASES ONLY, never production:
--   DROP INDEX IF EXISTS idx_contractor_contracts_signing_reconcile;
--   DROP INDEX IF EXISTS idx_contract_signers_contract_recipient;
--   ALTER TABLE contract_signers
--     DROP COLUMN IF EXISTS viewed_at,
--     DROP COLUMN IF EXISTS declined_at;
--   ALTER TABLE contractor_contracts
--     DROP COLUMN IF EXISTS signed_contract_emailed_at,
--     DROP COLUMN IF EXISTS signing_last_synced_at;
-- ─────────────────────────────────────────────────────────────────────────────
