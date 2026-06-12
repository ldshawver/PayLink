---
name: Org Hierarchy Dual Model
description: Two parallel manager-reporting models exist; checkIsDirectReport shim reconciles them; drift is logged.
---

## Rule
Any code checking whether Worker A reports to Manager B **must** call `checkIsDirectReport(companyId, workerId, managerId)` in `server/routes.ts` (~line 380), not raw SQL on either model alone.

**Why:** PayLink has two co-existing manager-relationship stores:
1. `employee_manager_relations` table — real FKs, `isActive` flag, the intended source of truth.
2. `workers.managerId` column — flat self-pointer, no FK, legacy; still used in many places.

Checking only one side silently misses relationships recorded in the other. The shim checks both, logs `[DRIFT]` warnings when they diverge, and returns `inEMR || inFlat`.

**How to apply:**
- Time-entry approval, time-off review, clock-in correction — all use `checkIsDirectReport`.
- `GET /api/org-chart` builds tree from EMR as primary; logs drift vs `workers.managerId`.
- `GET/POST/PATCH/DELETE /api/employee-manager-relations` manage the canonical EMR table.
- When `workers.managerId` is eventually deprecated, remove the flat-check branch from `checkIsDirectReport` and drop the drift logging.
