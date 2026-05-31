---
name: Proposal Lifecycle Groups
description: How proposals are filtered into active vs. archived groups — backend param and frontend state conventions.
---

## The Rule

`GET /api/contractor-proposals` accepts a `lifecycleGroup` query param:
- `active` → status IN ACTIVE_STATUSES AND is_archived IS NOT TRUE
- `archived` → status IN ARCHIVED_STATUSES OR is_archived = TRUE
- `all` → no restriction (legacy showCompleted/showArchived still honored when lifecycleGroup is absent)

ACTIVE_STATUSES = ['draft', 'submitted', 'reviewed', 'revision_requested', 'negotiation', 'sent', 'viewed', 'pending', 'under_review']

ARCHIVED_STATUSES = ['approved', 'rejected', 'expired', 'superseded', 'voided', 'cancelled', 'converted_to_contract', 'archived_to_documents', 'archived']

**Why:** Proposals that are finalized (approved, converted, expired, etc.) should not pollute the active work queue. The `is_archived` boolean flag is for manually archiving non-finalized proposals that need to be hidden.

**How to apply:** Frontend ProposalsSection uses `proposalLifecycleGroup` state ('active'|'archived'|'all'). The query key is `["/api/contractor-proposals", proposalLifecycleGroup]`. The "Show Completed" toggle button was replaced with Active|Archive|All tab group.

## Restore Rules

- `rejected`, `expired`, `cancelled` → directly restorable via POST /:id/restore (reason required; target status: revision_requested/negotiation/draft)
- `approved`, `superseded`, `voided`, `converted_to_contract` → duplicate only (restore endpoint returns 400 with requiresDuplicate:true)
- `is_archived=TRUE` with non-finalized status → directly restorable (unarchive)

## Archive Endpoint Note

POST /:id/archive blocks finalized statuses (approved/converted/signed) with a helpful message pointing to the Archive tab — those proposals are already visible there by status. Non-finalized proposals can be explicitly archived and moved to the Archive tab.
