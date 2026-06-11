---
name: Org hierarchy — two parallel reporting models
description: PayLink represents individual manager/report relationships TWO ways that can drift; know which one a feature reads.
---
PayLink stores "who reports to whom" in two unsynchronized places:

1. `workers.manager_id` — a flat self-pointer with **NO foreign key** (plain varchar). Read directly via raw SQL in approval flows (PTO time-off review, timesheet/time-entry review) to enforce "direct reports only". Single-level only.
2. `employee_manager_relations` table — richer: companyId, employeeId→workers, managerId→workers (both real FKs), relationshipType (default "primary"), effectiveDate/endDate, isActive. Used ONLY by `server/auth/authorization.ts` (view_subordinates, recursive `getManagerChain`). It has **zero CRUD endpoints** in routes.ts, so the recursive model cannot be populated or maintained through the API.

**Why this matters:** the two can drift — a worker's `manager_id` can disagree with their `employee_manager_relations` "primary" row. Approval routing (manager_id) and authorization/view-scope (employee_manager_relations) can therefore enforce different chains. Structural hierarchy is separate again: enterprises→companies→divisions→departments(parentId)→positions(reportsToPositionId), none of which carry FKs on the self-referential columns.

**How to apply:** before changing reporting/approval/org-chart behavior, decide which model is the source of truth and read that one consistently. There is no `/api/org-chart` tree endpoint; the client builds the tree from flat entity lists. Several hierarchy GET endpoints (departments/branches/divisions/positions/cost-centers/jobs) lack a company guard and return all rows if companyId is omitted.
