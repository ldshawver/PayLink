# SaaS PR 2B — remaining stored-resource ownership + supplied-companyId gate

Baseline: PR 2 (#165, `security/saas-pr2-stored-resource-ownership` @ `a19a7bd`), itself on
production v2.2.15 @ `d07a21d`. This PR is **stacked on PR 2** and closes everything PR 2
deferred (`docs/saas-readiness/saas-pr2-stored-resource-ownership.md`, "DEFERRED (PR 2B)": 89
by-id routes + 62 list routes = 151 handlers), plus defects found while doing it.

No new authorization framework. Everything reuses PR 1's `canAccessCompany()` (explicit
platform role list | own company | active `company_user_access` grant) and PR 2's
`resolveListScope()` / `decideStoredResourceAccess()` / `stripOwnershipFields()`.

## What changed

### 1. Global supplied-companyId gate (one fix for a repo-wide pattern)

The audit's attack list includes "supply `companyId=B`" (query) and "change body
`companyId`". About 59 POST creates plus many lists and PATCHes honour a client
`companyId` without authorizing it. Patching each handler would be a broad rewrite, so one
`app.use("/api")` middleware enforces the invariant for **every** route. It runs after
`req.user` is populated and before the first company route.

- Applies to authenticated, non-platform actors. Public, token and portal prefixes are
  exempt (`SUPPLIED_COMPANY_GATE_EXEMPT_PREFIXES`).
- Inspects `?companyId`, `?company_id`, `body.companyId` and `body.company_id` (top-level JSON).
  Sentinels (`all`, `__universal__`) are not companies and are left to the route.
- **Reads:** allowed with general access (`canAccessCompany`) or PR 1 scheduling reach.
  Sensitive lists are scoped again per route by `resolveListScope`, which accepts general
  access only (or scheduling reach for scheduling-data lists).
- **Writes:** allowed with general access. Scheduling reach is accepted only on scheduling
  paths (`/schedules`, `/shift-offers`, `/recurring-schedules`, `/marketplace/`).
- Pure decision: `decideSuppliedCompanyAccess()` in `server/auth/stored-resource-guard.ts`.

The gate does **not** replace per-route scoping. An *omitted* companyId and by-id ownership
are still route responsibilities (below). Multipart bodies are parsed after the gate (multer),
so multipart routes rely on their own handler checks.

Contract change: a request that names a foreign company used to be silently ignored on some
routes (e.g. wage-history PATCH/POST). It is now rejected with 403.
`tests/wage-history-company-scope-db.test.ts` was updated to assert the stricter contract.

### 2. Table-driven by-id ownership: `authorizeOwnedById(req, res, kind, id, opts)`

`OWNED_RESOURCES` (guard module) maps each resource kind to a constant table name and a
constant SQL owner expression. Derived owners resolve through the parent: milestone →
accrual policy, biz-doc item/attachment → biz document, employee wage group → worker,
saved report → creator, and contractor invoice/proposal/contract → contractor's company
when `company_id` is NULL.

`id → load → STORED owner → canAccessCompany → operate`. Missing → 404, foreign → 403. A NULL
owner (universal / shared row) is **platform-only**. Options:

- `selfWorkerId`: the worker or contractor the record belongs to may reach it (own invoice,
  proposal, preferences, onboarding).
- `schedulingReach`: scheduling data (recurring schedules, schedule preferences) also accepts
  PR 1 scheduling reach.

By-id PATCHes strip ownership fields (`stripOwnershipFields`), so a record cannot be
re-parented. A payroll reimbursement may only be re-linked to a run of its own company. A
recurring schedule may only be reassigned to a worker within scheduling reach. An onboarding
step must belong to the authorized onboarding.

### 3. Lists

- `queryStr(req.query.companyId)` → `resolveListScope()` on all deferred lists. Omitted
  companyId = the actor's own company (or single grant), never every tenant. Platform keeps
  list-all where it had it.
- New `scopeCompanyRows()` for config lists whose storage getter takes **no** company argument
  and returned every tenant's rows to everyone. These were found during this PR, not in the PR 2
  inventory: pay formulas, contributing pay codes/shifts, and regular, overtime, premium, meal,
  break, schedule, exception, accrual, absence, holiday and rounding policies. Scope = the list
  company's rows plus universal (NULL) shared defaults.
- `GET /api/dashboard/stats` aggregated every tenant's headcount and hours. Now company-scoped
  (`storage.getDashboardStats(companyId?)`).
- `GET /api/shift-offers`: storage ignored `companyId`. Now filtered through the offered
  shift's company (scheduling reach).
- Contractor proposal and contract lists used **enterprise siblings as general access**
  (violates PR 1). Now own company plus explicit grants only.
- HR-private lists (`reviews`, `qualifications`, `schedule-preferences`): employees and
  contractors see only their own. A `workerId` filter must be within reach. Non-admin
  `notifications` are forced to the actor's own user.
- `GET /api/saved-reports` returned every tenant's reports. Now filtered to reach; new reports
  default to the creator's company instead of NULL.

### 4. Universal-row decision (the reason PR 2 deferred these families)

Tenants **read** universal (company_id NULL) shared defaults exactly as before. Only platform
roles **write** them. A tenant PATCH can no longer NULL `company_id`: `employee-titles` PATCH
previously did that whenever `companyId` was omitted, publishing the row to every tenant. A
tenant POST of a title without a company creates it in the tenant's own company.
`expense_categories` is a global table (no company column), so its writes are platform-only.
This matches PR 2's decisions for funding accounts and system documents.

## Route classification — the 151 PR 2B routes

| Class | Count | Notes |
|---|---|---|
| FIXED — by-id stored owner (`authorizeOwnedById` / `canAccessStoredCompany`) | 88 | all 82 "same root cause" + 6 of 7 "lower-risk" |
| FIXED — list scope (`resolveListScope` / `scopeCompanyRows`) | 60 | + `deactivate-extras` (write by companyId) |
| ALREADY SAFE (re-verified) | 2 | `GET /api/check-print-audit`, `GET /api/audit-log` (+ `/export-csv`) — non-platform forced to own company, company-less denied |
| INTENTIONAL | 1 | `GET /api/system-documents/:id` — global platform document table; reads open by design (writes platform-only since PR 2) |

Additional routes fixed beyond the PR 2 inventory: 16 policy by-id routes (premium, meal, break,
exception, absence, holiday and rounding policies, plus contributing shifts, PATCH and DELETE),
14 unfiltered policy lists, dashboard stats, `POST /api/expense-categories`,
`POST /api/employee-titles`, `POST /api/saved-reports`, `GET /api/app-doctor/repair-tickets`
(company-less bypass), and every route reachable with a foreign supplied companyId (global gate).

## Known residual / follow-ups (not in this PR)

- `GET /api/system-documents/:id`: intentional. Revisit only if tenant-specific content is
  ever stored there.
- `employee_group_configs`: no company column (global config). Writes were not audited here.
- Role and persona tightening beyond company boundaries (who in a company may approve, view
  SSNs, and so on) is Phase 5 (permission matrix).
- Startup `company_user_access` backfill: moves to provisioning (PR 3), unchanged here.

## Tests

- `tests/saas-pr2b-remaining-ownership-db.test.ts`: real server, disposable DB. Fixture is
  Tenant A (A1, A2 granted), Tenant B (B1), and untenanted enterprise S (S1, S2). Every owned
  family is probed: foreign PATCH/DELETE, company-less actor, granted vs non-granted, victim
  row byte-identical, own success, owner unchanged, universal rows platform-only, derived
  owners, contractor self-access, enterprise siblings, personas, and specials. Global gate:
  foreign query/body companyId on untouched families (departments, workers, jobs, payroll
  runs, pay codes, stations, pay period schedules), with no row created. **Branch 452/452 ·
  base a19a7bd 141 pass / 312 fail.**
- `tests/saas-pr2b-remaining-ownership-static.test.ts` (required suite): pure gate and
  ownership decisions, constant-only owner SQL, gate ordering, every repaired route guarded
  before its first read or mutation, PATCH ownership stripping, no enterprise-sibling filter.
