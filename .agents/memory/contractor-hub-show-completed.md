---
name: Contractor Hub showCompleted filter
description: How showCompleted is threaded from frontend query params through backend list endpoints
---

## Rule
All three hub list endpoints accept `showCompleted=true` query param. Default (absent) hides completed/archived records.

**Why:** Users want a clean "active" view by default; completed records are archived to Documents. The toggle shows them again.

**How to apply:**
- Proposals: `completedFilter = showCompleted ? sql\`\` : sql\`AND cp.status NOT IN ('converted_to_contract','archived_to_documents') AND cp.archived_to_documents_at IS NULL\``
- Contracts: `completedFilterC = showCompletedC ? sql\`\` : sql\`AND cc.archived_to_documents_at IS NULL\``
- Invoices: storage.getContractorInvoices(..., showCompletedBool) — uses Drizzle or(ne(status,"paid"), isNull(archivedToDocumentsAt))
- Frontend: queryKey includes the boolean + custom queryFn appends ?showCompleted=true when true
