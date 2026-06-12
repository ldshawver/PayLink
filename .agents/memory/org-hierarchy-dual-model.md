---
name: Org Hierarchy Dual Model
description: Two parallel manager-reporting models exist that can drift; checkIsDirectReport shim reconciles them for approval flows.
---

## Rule
PayLink stores "who reports to whom" in two unsynchronized places:

1. `workers.manager_id` — a flat self-pointer with **no foreign key** (plain varchar). Used directly in approval flows (PTO, timesheet review) to enforce "direct reports only". Single-level only.
2. `employee_manager_relations` table — richer: companyId, employeeId→workers FK, managerId→workers FK, relationshipType (default "primary"), effectiveDate/endDate, isActive. Used by `server/auth/authorization.ts` for view_subordinates and recursive `getManagerChain`. Has zero CRUD endpoints in routes.ts, so it cannot be populated through the API.

**Why this matters:** the two can drift — a worker's `manager_id` can disagree with their `employee_manager_relations` "primary" row. Approval routing (`manager_id`) and authorization/view-scope (`employee_manager_relations`) can therefore enforce different chains.

Any code checking whether Worker A reports to Manager B **must** call `checkIsDirectReport(companyId, workerId, managerId)` in `server/routes.ts`, not raw SQL on either model alone. The shim checks both, logs `[DRIFT]` warnings when they diverge, and returns `inEMR || inFlat`.

**How to apply:**
- Time-entry approval, time-off review, clock-in correction — all use `checkIsDirectReport`.
- `GET /api/org-chart` builds tree from EMR as primary; logs drift vs `workers.managerId`.
- `GET/POST/PATCH/DELETE /api/employee-manager-relations` manage the canonical EMR table.
- Before changing reporting/approval/org-chart behavior, decide which model is the source of truth and read that one consistently.
- Several hierarchy GET endpoints (departments/branches/divisions/positions/cost-centers/jobs) lack a company guard and return all rows if companyId is omitted.
- When `workers.managerId` is eventually deprecated, remove the flat-check branch from `checkIsDirectReport` and drop the drift logging.
