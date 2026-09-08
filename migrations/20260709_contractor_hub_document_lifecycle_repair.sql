-- Contractor Hub proposal -> contract -> signing -> invoice document lifecycle repair.
-- PRE-RUN BACKUP STEP (required): take a database backup/snapshot before applying this script.
-- This migration is additive/idempotent and archives duplicate/non-current records; it does not delete documents.
-- Safe staging rerun statement: this script is designed to run more than once. It uses
-- CREATE INDEX IF NOT EXISTS, filters active rows with is_archived IS NOT TRUE, uses
-- COALESCE for archive timestamps/pointers, and updates proposal pointers only when
-- IS DISTINCT FROM the computed current record.
-- Rollback / no-destructive-change explanation: this script performs no schema/table destructive operations,
-- row deletion, table rename, column rename, or physical file removal. To roll back after a
-- staging run, restore the required pre-run backup/snapshot. If a full restore is not
-- needed, rows touched by this script can be reviewed by archived_at / archived_to_documents_at
-- and manually unarchived or pointer-restored because the original rows remain in place.

BEGIN;


-- Audit-friendly indexes for lifecycle repair scans.
CREATE INDEX IF NOT EXISTS idx_ch_contracts_company_proposal_current
  ON contractor_contracts(company_id, proposal_id, created_at DESC)
  WHERE proposal_id IS NOT NULL AND is_archived IS NOT TRUE;

CREATE INDEX IF NOT EXISTS idx_ch_invoices_company_contract_current
  ON contractor_invoices(company_id, contract_id, created_at DESC)
  WHERE contract_id IS NOT NULL AND is_archived IS NOT TRUE;

CREATE INDEX IF NOT EXISTS idx_dam_ch_current_entity
  ON dam_documents(company_id, linked_entity_type, linked_entity_id, created_at DESC)
  WHERE source_module = 'contractor_hub' AND is_archived IS NOT TRUE AND deleted_at IS NULL;

-- Diagnostic result sets for staging evidence.
-- 1. Approved proposals without current contracts.
SELECT cp.id AS proposal_id, cp.company_id, cp.contractor_id, cp.status
FROM contractor_proposals cp
LEFT JOIN contractor_contracts cc
  ON cc.proposal_id = cp.id AND cc.company_id = cp.company_id AND cc.is_archived IS NOT TRUE
WHERE cp.status IN ('approved','accepted','negotiated','converted_to_contract')
  AND cp.deleted_at IS NULL
  AND cc.id IS NULL;

-- 2. Current contracts missing active signing requests.
SELECT cc.id AS contract_id, cc.company_id, cc.proposal_id, cc.status
FROM contractor_contracts cc
LEFT JOIN documenso_signature_requests dsr
  ON dsr.related_record_id = cc.id
 AND dsr.company_id = cc.company_id
 AND dsr.document_type IN ('contract','contractor_hub_contract')
 AND dsr.documenso_document_id IS NOT NULL
 AND COALESCE(dsr.status,'') NOT IN ('voided','canceled','cancelled','deleted','error')
WHERE cc.is_archived IS NOT TRUE
  AND cc.status IN ('sent','partially_signed','awaiting_signatures')
  AND dsr.id IS NULL;

-- 3. Signed contracts without invoices.
SELECT cc.id AS contract_id, cc.company_id, cc.proposal_id
FROM contractor_contracts cc
LEFT JOIN contractor_invoices ci
  ON ci.contract_id = cc.id AND ci.company_id = cc.company_id AND ci.is_archived IS NOT TRUE
WHERE cc.status IN ('fully_signed','completed','active')
  AND cc.proposal_id IS NOT NULL
  AND ci.id IS NULL;

-- Archive duplicate active contracts per proposal, keeping the newest signed/current record.
WITH ranked_contracts AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY company_id, proposal_id
           ORDER BY CASE WHEN status IN ('fully_signed','completed','active') THEN 0 ELSE 1 END,
                    created_at DESC,
                    id DESC
         ) AS rn
  FROM contractor_contracts
  WHERE proposal_id IS NOT NULL
    AND is_archived IS NOT TRUE
    AND COALESCE(status,'') NOT IN ('void','terminated')
)
UPDATE contractor_contracts cc
SET is_archived = TRUE,
    archived_to_documents_at = COALESCE(archived_to_documents_at, NOW()),
    status = CASE WHEN status IN ('fully_signed','completed','active') THEN status ELSE 'superseded' END,
    updated_at = NOW()
FROM ranked_contracts rc
WHERE cc.id = rc.id AND rc.rn > 1;

-- Rebuild proposal -> current contract pointer.
WITH current_contract AS (
  SELECT DISTINCT ON (company_id, proposal_id) company_id, proposal_id, id
  FROM contractor_contracts
  WHERE proposal_id IS NOT NULL AND is_archived IS NOT TRUE
  ORDER BY company_id, proposal_id,
           CASE WHEN status IN ('fully_signed','completed','active') THEN 0 ELSE 1 END,
           created_at DESC,
           id DESC
)
UPDATE contractor_proposals cp
SET converted_to_contract_id = cc.id,
    updated_at = NOW()
FROM current_contract cc
WHERE cp.id = cc.proposal_id AND cp.company_id = cc.company_id
  AND cp.converted_to_contract_id IS DISTINCT FROM cc.id;

-- Archive duplicate active invoices per contract/proposal, keeping paid/current first.
WITH ranked_invoices AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY company_id, COALESCE(contract_id, proposal_id)
           ORDER BY CASE WHEN status = 'paid' THEN 0 WHEN status IN ('approved','submitted') THEN 1 ELSE 2 END,
                    created_at DESC,
                    id DESC
         ) AS rn
  FROM contractor_invoices
  WHERE COALESCE(contract_id, proposal_id) IS NOT NULL
    AND is_archived IS NOT TRUE
    AND COALESCE(status,'') NOT IN ('void','voided','cancelled','rejected')
)
UPDATE contractor_invoices ci
SET is_archived = TRUE,
    archived_at = COALESCE(archived_at, NOW()),
    duplicate_of_invoice_id = COALESCE(duplicate_of_invoice_id, keep.id),
    updated_at = NOW()
FROM ranked_invoices ri
JOIN ranked_invoices keep ON keep.rn = 1
WHERE ci.id = ri.id AND ri.rn > 1;

-- Rebuild proposal -> current invoice pointer.
WITH current_invoice AS (
  SELECT DISTINCT ON (company_id, proposal_id) company_id, proposal_id, id
  FROM contractor_invoices
  WHERE proposal_id IS NOT NULL AND is_archived IS NOT TRUE
  ORDER BY company_id, proposal_id,
           CASE WHEN status = 'paid' THEN 0 WHEN status IN ('approved','submitted') THEN 1 ELSE 2 END,
           created_at DESC,
           id DESC
)
UPDATE contractor_proposals cp
SET converted_to_invoice_id = ci.id,
    updated_at = NOW()
FROM current_invoice ci
WHERE cp.id = ci.proposal_id AND cp.company_id = ci.company_id
  AND cp.converted_to_invoice_id IS DISTINCT FROM ci.id;

-- Archive duplicate active Contractor Hub DAM records by entity/type, keeping latest current file visible.
WITH ranked_docs AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY company_id, linked_entity_type, linked_entity_id, document_type
           ORDER BY CASE WHEN lifecycle_status IN ('signed','finalized') OR status IN ('signed','finalized','active') THEN 0 ELSE 1 END,
                    created_at DESC,
                    id DESC
         ) AS rn
  FROM dam_documents
  WHERE source_module = 'contractor_hub'
    AND linked_entity_type IN ('proposal','contract','invoice')
    AND linked_entity_id IS NOT NULL
    AND is_archived IS NOT TRUE
    AND deleted_at IS NULL
)
UPDATE dam_documents dd
SET is_archived = TRUE,
    archived_at = COALESCE(archived_at, NOW()),
    status = CASE WHEN status = 'active' THEN 'archived' ELSE status END,
    lifecycle_status = 'archived',
    updated_at = NOW()
FROM ranked_docs rd
WHERE dd.id = rd.id AND rd.rn > 1;

COMMIT;
