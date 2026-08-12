import fs from "node:fs";
import assert from "node:assert/strict";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const migration = fs.readFileSync("migrations/20260709_contractor_hub_document_lifecycle_repair.sql", "utf8");

assert(routes.includes('state === "documenso_unavailable"'), "public signing route exposes controlled Documenso unavailable state");
assert(routes.includes('actionUrl: myPayLinkSigningUrl'), "Documenso signing email CTA uses public MyPayLink signing URL");
assert(routes.includes('Signing page: ${myPayLinkSigningUrl}'), "signing email body includes public signing URL");
assert(routes.includes('autoCreateContractInvoiceExactlyOnce(signer.contract_id)'), "public completion path uses the serialized proposal-backed invoice helper");
assert(routes.includes('FOR UPDATE') && routes.includes('autoCreateContractInvoiceExactlyOnce(contract.id)'), "Documenso completion serializes invoice creation and reuses the same helper");
assert(routes.includes('findSignerSpecificDocumensoLink(resendResult?.signingLinks || []'), "single-signer resend cannot fall back to another recipient URL");
assert(routes.includes('resolveDocumensoSenderIdentity({ user: senderUser, worker: senderWorker, company: senderCompany })'), "Documenso sender identity resolves from tenant-scoped records");
assert(routes.includes('converted_to_invoice_id IS NULL'), "auto invoice marking remains idempotent");
assert(migration.includes('PRE-RUN BACKUP STEP'), "repair SQL documents required backup step");
assert(migration.includes('Safe staging rerun statement') && migration.includes('CREATE INDEX IF NOT EXISTS') && migration.includes('IS DISTINCT FROM'), "repair SQL documents and uses idempotent rerun safeguards");
assert(migration.includes('Rollback / no-destructive-change explanation') && migration.includes('original rows remain in place'), "repair SQL includes rollback/no-destructive-change notes");
assert(migration.includes('Archive duplicate active contracts') && migration.includes('Archive duplicate active invoices'), "repair SQL archives duplicate contracts and invoices");
assert(migration.includes('Rebuild proposal -> current contract pointer') && migration.includes('Rebuild proposal -> current invoice pointer'), "repair SQL rebuilds current pointers");
assert(!migration.match(/\bDROP\s+(TABLE|COLUMN)\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i), "repair SQL is non-destructive");

console.log("contractor hub lifecycle static checks passed");
