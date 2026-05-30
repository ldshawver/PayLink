---
name: Backfill PDF Endpoint pattern
description: How POST /api/contractor-hub/backfill-documents works and generator signatures
---

## Rule
- generateProposalPdf(proposalId, proposalRow, actorUserId) -> string|null. Already inserts into dam_documents. Backfill calls it, then queries dam_documents for the new record, then UPDATEs the proposal.
- generateInvoicePdf(invoiceId, invoiceRow, actorUserId) -> string|null. Same pattern.
- generateContractPdf(contractId) -> Buffer|null. Does NOT insert into DAM. Must write Buffer to disk + manual INSERT into dam_documents (pattern from contract sign handler in routes.ts).
- generateContractPdf is declared inside registerRoutes (~line 13052) as a function declaration — IS hoisted and usable before its definition site.

**Why:** Proposal/invoice generators were retrofitted with DAM insertion in T002; contract generator predates this and only returns a Buffer.
