-- Documenso signing integration metadata (additive only).
-- Before applying to production, run: scripts/backup-db.sh

ALTER TABLE documents ADD COLUMN IF NOT EXISTS documenso_document_id TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS documenso_template_id TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS documenso_status TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS documenso_signing_url TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS documenso_completed_pdf_url TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS documenso_audit_url TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS sent_for_signature_at TIMESTAMP;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS signed_at TIMESTAMP;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS signing_provider TEXT DEFAULT 'documenso';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS signature_required BOOLEAN DEFAULT FALSE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS signature_status TEXT DEFAULT 'draft';

ALTER TABLE document_signature_requests ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE document_signature_requests ADD COLUMN IF NOT EXISTS provider_object_id TEXT;
ALTER TABLE document_signature_requests ADD COLUMN IF NOT EXISTS documenso_document_id TEXT;
ALTER TABLE document_signature_requests ADD COLUMN IF NOT EXISTS documenso_template_id TEXT;
ALTER TABLE document_signature_requests ADD COLUMN IF NOT EXISTS documenso_status TEXT;
ALTER TABLE document_signature_requests ADD COLUMN IF NOT EXISTS documenso_signing_url TEXT;
ALTER TABLE document_signature_requests ADD COLUMN IF NOT EXISTS documenso_completed_pdf_url TEXT;
ALTER TABLE document_signature_requests ADD COLUMN IF NOT EXISTS documenso_audit_url TEXT;
ALTER TABLE document_signature_requests ADD COLUMN IF NOT EXISTS sent_for_signature_at TIMESTAMP;
ALTER TABLE document_signature_requests ADD COLUMN IF NOT EXISTS signed_at TIMESTAMP;
ALTER TABLE document_signature_requests ADD COLUMN IF NOT EXISTS signing_provider TEXT DEFAULT 'documenso';
ALTER TABLE document_signature_requests ADD COLUMN IF NOT EXISTS signature_required BOOLEAN DEFAULT FALSE;
ALTER TABLE document_signature_requests ADD COLUMN IF NOT EXISTS signature_status TEXT DEFAULT 'draft';

ALTER TABLE document_signers ADD COLUMN IF NOT EXISTS routing_order INTEGER DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_documents_documenso_document_id ON documents(documenso_document_id);
CREATE INDEX IF NOT EXISTS idx_document_signature_requests_documenso_document_id ON document_signature_requests(documenso_document_id);
CREATE INDEX IF NOT EXISTS idx_document_signature_requests_company_status ON document_signature_requests(company_id, signature_status);
