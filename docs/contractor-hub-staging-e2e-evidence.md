# Contractor Hub Proposal → Contract → Signing → Invoice Staging Evidence

Status: **staging-validation approval only**. Production merge, tag, deploy, or completion sign-off remains blocked until every evidence item below passes with staging data and attached proof.

## Required Manual Roles

Record the specific staging accounts used for each role:

- Contractor signer:
- Company rep:
- Company admin:
- Unauthorized contractor:
- Unauthorized tenant/company user:

## Test Data

- Staging environment URL:
- Company / tenant:
- Contractor user:
- Company rep/admin user:
- Proposal ID / number:
- Contract ID / number:
- Documenso document/session ID:
- Invoice ID / number:
- Date/time executed:
- Tester:

## Required Evidence Checklist

| # | Evidence item | Expected result | Evidence / link / screenshot | Pass/Fail |
|---|---|---|---|---|
| 1 | Contract signing works | Contract is sent from an approved proposal, email CTA opens `/sign/contracts/:token`, and signer reaches the exact public signing flow. |  |  |
| 2 | Webhook updates status correctly | Documenso completion webhook marks signer signed and contract fully signed idempotently. |  |  |
| 3 | Final PDF/final packet filed | Signed contract PDF/final packet is filed with proposal + contract references in the correct document folder. |  |  |
| 4 | Invoice generation works after contract completion | Exactly one invoice is generated from signed contract terms after completion. |  |  |
| 5 | Duplicate archival is non-destructive | Duplicate active contracts/invoices/DAM records are archived/versioned; no records are deleted. |  |  |
| 6 | Archived versions appear in Version History | Contractor, company rep, and company admin can open Version History and see authorized archived proposal/contract/invoice/DAM versions. |  |  |
| 7 | Archived downloads authorized only | Archived signed PDFs, final packets, and invoices can be viewed/downloaded only by authorized users. |  |  |
| 8 | Archived mutation blocked server-side | PATCH/metadata/version mutation attempts against archived DAM assets return a read-only error. |  |  |
| 9 | Cross-contractor archived access blocked | Contractor A cannot view/download Contractor B archived DAM asset or version metadata. |  |  |
| 10 | Cross-tenant archived access blocked | Tenant/company A user cannot view/download Tenant/company B archived DAM asset. |  |  |
| 11 | Company rep/admin scoped by canAccessCompany() | Company rep/admin access succeeds only within valid `canAccessCompany()` scope and fails outside that scope. |  |  |
| 12 | No archived asset deleted | Lifecycle transitions preserve archived assets; database counts confirm no archived asset is deleted. |  |  |
| 13 | Current remains default | Normal workflow lists show only the latest/current active version by default. |  |  |
| 14 | Archived versions read-only in UI | Archived rows have no edit/replace actions and are labeled read-only. |  |  |

## Webhook / Idempotency Evidence

- First Documenso completion webhook payload or event ID:
- PayLink contract status after first webhook:
- Invoice count after first webhook:
- Duplicate webhook event ID or replay method:
- Invoice count after duplicate webhook:

## Data Repair Evidence

Attach diagnostic output from `migrations/20260709_contractor_hub_document_lifecycle_repair.sql` run in staging after a database backup/snapshot:

- Approved proposals without current contracts:
- Current contracts missing signing requests:
- Signed contracts without invoices:
- Duplicate active contracts archived:
- Duplicate active invoices archived:
- Duplicate active DAM records archived:
- Current proposal pointers rebuilt:
- Archived DAM count before lifecycle transition:
- Archived DAM count after lifecycle transition:

## Sign-off

- Contractor signer verification completed by:
- Company rep verification completed by:
- Company admin verification completed by:
- Unauthorized contractor negative test completed by:
- Unauthorized tenant/company user negative test completed by:
- Security/access checks verified by:
- Approval to proceed beyond staging validation:
