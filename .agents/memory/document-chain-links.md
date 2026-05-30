---
name: DocumentsSection chain link chips
description: How proposal→contract→invoice traceability chips are rendered in the Documents section
---

## Rule
DocRow type has proposalId, contractId, invoiceId, archivedDocumentId fields.

allDocs mappings:
- proposals: proposalId=p.id, contractId=(p as any).convertedToContractId
- contracts: proposalId=(c as any).proposalId, contractId=c.id
- invoices: proposalId=(i as any).proposalId, contractId=(i as any).contractId, invoiceId=i.id

Card renders chips below meta line when any of these fields is non-null.
ContractDetailPanel overview tab also has a traceability section with Source Proposal chip + View PDF in Documents link.
