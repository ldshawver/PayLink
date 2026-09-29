# SaaS PR 2 — stored-resource ownership (financial / payroll / employment / personal data)

Baseline: production v2.2.15 @ `d07a21d` (SaaS PR 1 shipped). Source audit: the
2026-09-28 SaaS readiness audit and its PR 2 inventory (live-probed defects,
63-site company-less guard list, 154-route by-id scan, 65-route list scan).

## Security boundary of this PR ("PR 2A")

In scope, all closed by this PR:

1. **Every live-confirmed defect** named in the audit (Groups A, B and C below).
2. **The same resource families** as those routes. If a live-confirmed route reads
   or writes resource X by id, every other by-id route on X was repaired too: payroll runs,
   payroll items, pay methods, 1099 summaries, time-off requests, compliance worker
   records, remittance sources, expenses, customers and funding accounts. Otherwise a
   sibling route would stay an open side door on the same data.
3. **List endpoints that expose bank numbers, SSNs/TINs or medical reasons** in the same
   shape as the confirmed `remittance-sources` defect: funding accounts, time-off
   requests and the 1099 export.
4. **The systemic company-less bypass (Group D)**, repo-wide, with a static detector.
5. **Group E**: the payroll-item family, pay-method delete, worker-document delete
   (admin bypass), platform-wide system documents, and the payroll check PDF/void/reprint
   routes, which share the Group D bypass.
6. **The public proposal approval alias** (`/client-approve`).

Deferred to **PR 2B** (listed in full below): 82 same-root-cause by-id routes and 62
list endpoints in *other* resource families (pay codes, taxes/deductions, accrual/pay
policies, pay-stub accounts/amendments/transactions, contractor invoices/proposals,
worker agreements/onboarding, invoice templates, …). The fix pattern is the same, but
many of these tables hold **universal (company_id NULL) rows** that tenants read today.
Each one needs an explicit universal-row decision, or tenants silently lose shared
defaults. Doing that for ~140 more handlers would turn this reviewable security patch
into a broad rewrite. None of them was live-probed.

## Primitives (no new authorization architecture)

Everything builds on PR 1's `canAccessCompany()` (explicit platform role list | own
company | active `company_user_access` grant). Enterprise siblings grant scheduling only.

| Primitive | Where | Contract |
|---|---|---|
| `decideListScope()` / `resolveListScope(req,res,requested,{allowPlatformAll})` | `server/auth/stored-resource-guard.ts` (pure) / `server/routes.ts` | A supplied companyId is authorized **before** the query. An omitted one resolves to the actor's home company, or for a company-less user to their single active grant. It **never** resolves to every tenant, except for a listed platform role on an endpoint that allows it. Otherwise 403. |
| `decideStoredResourceAccess()` / `authorizeStoredResource(req,res,resource,storedCompanyId,label)` | same | resource id → load → **stored** owner → canAccessCompany → operate. 404 missing, 403 unauthorized. A NULL/unresolvable owner is platform-only, never "shared". Never reads a client companyId. |
| `canAccessStoredCompany(user, storedCompanyId)` | `server/routes.ts` | Drop-in replacement for the legacy inline guards: missing actor → false, NULL owner → platform only, else canAccessCompany. |
| `stripOwnershipFields(body)` | guard module | By-id PATCHes cannot re-parent a record (`id, companyId, workerId, payrollRunId, payrollItemId, userId, createdAt, createdBy`). |
| `toComplianceWorker(w)` | guard module | Compliance reads return identity + workerType only (the only fields the client reads). |

Owner resolution: payroll item → payroll run → company; pay method / worker document
→ worker → company; expense → company_id, falling back to the submitter's company;
everything else → its stored `company_id`.

## Contractor proposal approval finding

`POST /api/contractor-proposals/:id/client-approve` has **no in-repo caller**. The client
portal uses `POST /api/portal/proposals/:id/approve?token=…`, which validates the
proposal's `share_token` through `validatePortalToken()`. The alias skipped that
validation. The global session gate makes it unreachable anonymously, so the audit
scanner's "UNAUTHENTICATED" label was wrong. The live exposure on v2.2.15 was different:
**any authenticated user of any tenant, including an employee, could approve any
tenant's proposal knowing only its id**, with an arbitrary approver name and email.
**P1** (cross-tenant state change).

Fix: both routes now call one `approveProposalViaShareToken()`:
- the same token validator and approvable states as the portal;
- an `UPDATE … WHERE share_token = token AND status IN (…) RETURNING id`, so a replay or
  a concurrent second approval returns 409 and never overwrites the first approver.

The token architecture has **no expiry column**. A token stops working when the proposal
leaves the public states (superseded, withdrawn, draft), and that is what the tests
exercise as "expired". Enforcing `expiration_date` would be a product decision covering
both routes, so it was not done.

## Behaviour changes reviewers should know

- A tenant passing a foreign `?companyId` now gets **403**. It used to be silently
  re-scoped to its own company on the "force-scoped" lists, or served on the unscoped ones.
  Users with an explicit `company_user_access` grant can now use the granted company on
  those endpoints, consistent with PR 1.
- `GET /api/customers` without companyId now defaults to the tenant's own company
  (it used to return 400). Platform users must still name one.
- `GET /api/time-off-requests`: non-managers see only their own requests. Schedulers see
  only their authorized companies' requests, so sibling-company time-off no longer
  overlays a scheduling-only user's schedule grid.
- `PATCH /api/time-off-requests/:id`: non-managers cannot change review fields. Approval
  goes through `/review`.
- Universal (company_id NULL) **funding accounts** are now platform-admin editable only.
  Production has 8, all universal. Production operations run through the platform admin,
  and tenants still see them in lists.
- System documents: POST/PATCH/DELETE are platform-admin only. Reads are unchanged.
- `PATCH /api/expenses/:id` no longer accepts `companyId`.
- Unchanged (pre-existing, documented): `/api/expenses` review treats only literal
  `admin`/`manager` as reviewers, so platform users see only their own submissions.

## Startup access backfill → PR 3 (technical debt, not changed here)

`server/index.ts` ("company_user_access backfill", inside the boot DDL block) inserts a
default-company `company_user_access` row for every user with a home company **on every
server start**. It was observed on the v2.2.15 production deploy (22 → 23 rows for a
contractor created between boots). PR 2 does not touch it: it does not interfere with
these tests, and it only mirrors `users.company_id`.

**PR 3 (provisioning) must** move this into explicit, idempotent provisioning /
user-access management (`provisionTenant()` and user create/update). After PR 3, no
customer ownership or access data may change merely because the server restarted.

## 154-route by-id scan — classification after PR 2

| Route | Class | Sev | Status | Evidence |
|---|---|---|---|---|
| `GET /api/1099-summaries/:id` | CONFIRMED HIGH-RISK | P1 | FIXED (PR 2) | live-probed cross-tenant (audit, disposable DB) |
| `GET /api/compliance/worker/:workerId` | CONFIRMED HIGH-RISK | P1 | FIXED (PR 2) | live-probed cross-tenant (audit, disposable DB) |
| `PATCH /api/pay-methods/:id` | CONFIRMED HIGH-RISK | P0 | FIXED (PR 2) | live-probed cross-tenant (audit, disposable DB) |
| `PATCH /api/payroll-items/:id` | CONFIRMED HIGH-RISK | P0 | FIXED (PR 2) | live-probed cross-tenant (audit, disposable DB) |
| `GET /api/payroll-runs/:id/ach-batch` | CONFIRMED HIGH-RISK | P1 | FIXED (PR 2) | live-probed cross-tenant (audit, disposable DB) |
| `GET /api/payroll-runs/:id/taxes` | CONFIRMED HIGH-RISK | P1 | FIXED (PR 2) | live-probed cross-tenant (audit, disposable DB) |
| `GET /api/time-off-requests/:id` | CONFIRMED HIGH-RISK | P1 | FIXED (PR 2) | live-probed cross-tenant (audit, disposable DB) |
| `PATCH /api/time-punches/:id/approve` | CONFIRMED HIGH-RISK | P0 | FIXED (PR 2) | live-probed cross-tenant (audit, disposable DB) |
| `DELETE /api/users/:id` | CONFIRMED HIGH-RISK | P0 | FIXED (PR 2) | live-probed cross-tenant (audit, disposable DB) |
| `PATCH /api/accrual-accounts/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `DELETE /api/accrual-accounts/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `PATCH /api/accrual-policies/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `DELETE /api/accrual-policies/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `DELETE /api/accrual-policy-milestones/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `POST /api/app-doctor/reports/:id/analyze` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | by-id, no ownership check |
| `DELETE /api/biz-document-attachments/:id` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | by-id, no ownership check |
| `PATCH /api/biz-document-items/:id` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | by-id, no ownership check |
| `DELETE /api/biz-document-items/:id` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | by-id, no ownership check |
| `GET /api/contractor-hub/contracts/:id/sign` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | role-only (admin/manager/any auth), no company comparison |
| `GET /api/contractor-invoices/:id` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | role-only (admin/manager/any auth), no company comparison |
| `POST /api/contractor-invoices/:id/approve` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | role-only (admin/manager/any auth), no company comparison |
| `GET /api/contractor-invoices/:id/audit` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | role-only (admin/manager/any auth), no company comparison |
| `GET /api/contractor-invoices/:id/payments` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | role-only (admin/manager/any auth), no company comparison |
| `POST /api/contractor-invoices/:id/reject` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | role-only (admin/manager/any auth), no company comparison |
| `GET /api/contractor-invoices/:id/reminder-logs` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | role-only (admin/manager/any auth), no company comparison |
| `POST /api/contractor-invoices/:id/send-reminder` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | role-only (admin/manager/any auth), no company comparison |
| `POST /api/contractor-invoices/:id/stripe-checkout-session` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | role-only (admin/manager/any auth), no company comparison |
| `DELETE /api/contractor-proposals/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | role-only (admin/manager/any auth), no company comparison |
| `GET /api/contractor-proposals/:id/current-version` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | role-only (admin/manager/any auth), no company comparison |
| `GET /api/contractor-proposals/:id/events` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | role-only (admin/manager/any auth), no company comparison |
| `GET /api/contractor-proposals/:id/line-items` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | role-only (admin/manager/any auth), no company comparison |
| `POST /api/contractor-proposals/:id/line-items` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | role-only (admin/manager/any auth), no company comparison |
| `PATCH /api/contributing-pay-codes/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `DELETE /api/contributing-pay-codes/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `PATCH /api/document-folders/:id` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | by-id, no ownership check |
| `PATCH /api/document-retention-policies/:id` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | by-id, no ownership check |
| `DELETE /api/document-retention-policies/:id` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | by-id, no ownership check |
| `PATCH /api/document-retention-policies/:id/legal-basis` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | by-id, no ownership check |
| `PATCH /api/employee-groups/:id` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | by-id employment/HR record, no ownership check |
| `DELETE /api/employee-groups/:id` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | by-id employment/HR record, no ownership check |
| `PATCH /api/employee-titles/:id` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | by-id employment/HR record, no ownership check |
| `DELETE /api/employee-titles/:id` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | by-id employment/HR record, no ownership check |
| `DELETE /api/employee-wage-groups/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `PATCH /api/expense-categories/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | role-only (admin/manager/any auth), no company comparison |
| `PATCH /api/invoice-approval-workflows/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | role-only (admin/manager/any auth), no company comparison |
| `PATCH /api/invoice-templates/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | role-only (admin/manager/any auth), no company comparison |
| `DELETE /api/invoice-templates/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | role-only (admin/manager/any auth), no company comparison |
| `PATCH /api/overtime-policies/:id` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | policy config by id, no ownership (nullable company/universal rows) |
| `DELETE /api/overtime-policies/:id` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | policy config by id, no ownership (nullable company/universal rows) |
| `PATCH /api/pay-codes/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `DELETE /api/pay-codes/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `PATCH /api/pay-formulas/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `DELETE /api/pay-formulas/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `GET /api/pay-period-schedules/:companyId/resolve-debug` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `PATCH /api/pay-period-schedules/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `DELETE /api/pay-period-schedules/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `PATCH /api/pay-periods/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `PATCH /api/pay-stub-accounts/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `DELETE /api/pay-stub-accounts/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `PATCH /api/pay-stub-amendments/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `DELETE /api/pay-stub-amendments/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `PATCH /api/pay-stub-transactions/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `PATCH /api/payment-method-configs/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | role-only (admin/manager/any auth), no company comparison |
| `DELETE /api/payment-method-configs/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | role-only (admin/manager/any auth), no company comparison |
| `PATCH /api/payroll-reimbursements/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `PATCH /api/recurring-expenses/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | role-only (admin/manager/any auth), no company comparison |
| `PATCH /api/recurring-schedules/:id` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | by-id employment/HR record, no ownership check |
| `DELETE /api/recurring-schedules/:id` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | by-id employment/HR record, no ownership check |
| `PATCH /api/regular-time-policies/:id` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | policy config by id, no ownership (nullable company/universal rows) |
| `DELETE /api/regular-time-policies/:id` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | policy config by id, no ownership (nullable company/universal rows) |
| `DELETE /api/saved-reports/:id` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | by-id, no ownership check |
| `PATCH /api/schedule-policies/:id` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | policy config by id, no ownership (nullable company/universal rows) |
| `DELETE /api/schedule-policies/:id` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | policy config by id, no ownership (nullable company/universal rows) |
| `PATCH /api/schedule-preferences/:id` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | by-id employment/HR record, no ownership check |
| `DELETE /api/schedule-preferences/:id` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | by-id employment/HR record, no ownership check |
| `PATCH /api/secondary-wage-groups/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `DELETE /api/secondary-wage-groups/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `PATCH /api/tax-wizard/snapshots/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `DELETE /api/tax-wizard/snapshots/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `PATCH /api/taxes-deductions/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `DELETE /api/taxes-deductions/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `PATCH /api/worker-agreements/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id employment/HR record, no ownership check |
| `DELETE /api/worker-agreements/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id employment/HR record, no ownership check |
| `POST /api/worker-agreements/:id/sign` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id employment/HR record, no ownership check |
| `PATCH /api/worker-languages/:id` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | by-id employment/HR record, no ownership check |
| `DELETE /api/worker-languages/:id` | SAME ROOT CAUSE / MECHANICAL | P1 | DEFERRED (PR 2B) | by-id employment/HR record, no ownership check |
| `PATCH /api/worker-onboarding/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id employment/HR record, no ownership check |
| `DELETE /api/worker-onboarding/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id employment/HR record, no ownership check |
| `POST /api/worker-onboarding/:id/regenerate-token` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id employment/HR record, no ownership check |
| `POST /api/worker-onboarding/:id/review` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id employment/HR record, no ownership check |
| `PATCH /api/worker-onboarding/:id/steps/:stepId` | SAME ROOT CAUSE / MECHANICAL | P0 | DEFERRED (PR 2B) | by-id employment/HR record, no ownership check |
| `PATCH /api/1099-summaries/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | FIXED (PR 2) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `POST /api/1099-summaries/:id/mark-filed` | SAME ROOT CAUSE / MECHANICAL | P0 | FIXED (PR 2) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `GET /api/companies/:id/quarterly-taxes` | SAME ROOT CAUSE / MECHANICAL | P1 latent | FIXED (PR 2) | isTenant requires companyId → companyless bypass (class B) |
| `GET /api/companies/:id/tax-liability` | SAME ROOT CAUSE / MECHANICAL | P1 latent | FIXED (PR 2) | isTenant requires companyId → companyless bypass (class B) |
| `GET /api/companies/:id/ytd-taxes` | SAME ROOT CAUSE / MECHANICAL | P1 latent | FIXED (PR 2) | isTenant requires companyId → companyless bypass (class B) |
| `PATCH /api/compliance/worker/:workerId/profile` | SAME ROOT CAUSE / MECHANICAL | P0 | FIXED (PR 2) | by-id employment/HR record, no ownership check |
| `POST /api/contractor-proposals/:id/client-approve` | SAME ROOT CAUSE / MECHANICAL | P1 | FIXED (PR 2) | UNAUTHENTICATED state change by proposal id; no share-token check |
| `POST /api/contractor-proposals/:id/create-revision` | SAME ROOT CAUSE / MECHANICAL | P1 latent | FIXED (PR 2) | `!user.companyId ||` companyless bypass (class B) |
| `GET /api/expenses/:id` | SAME ROOT CAUSE / MECHANICAL | P1 | FIXED (PR 2) | role-only (admin/manager/any auth), no company comparison |
| `PATCH /api/expenses/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | FIXED (PR 2) | role-only (admin/manager/any auth), no company comparison |
| `DELETE /api/expenses/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | FIXED (PR 2) | role-only (admin/manager/any auth), no company comparison |
| `POST /api/expenses/:id/approve` | SAME ROOT CAUSE / MECHANICAL | P0 | FIXED (PR 2) | role-only (admin/manager/any auth), no company comparison |
| `GET /api/expenses/:id/attachments` | SAME ROOT CAUSE / MECHANICAL | P1 | FIXED (PR 2) | role-only (admin/manager/any auth), no company comparison |
| `POST /api/expenses/:id/attachments` | SAME ROOT CAUSE / MECHANICAL | P0 | FIXED (PR 2) | role-only (admin/manager/any auth), no company comparison |
| `GET /api/expenses/:id/audit` | SAME ROOT CAUSE / MECHANICAL | P1 | FIXED (PR 2) | role-only (admin/manager/any auth), no company comparison |
| `POST /api/expenses/:id/reject` | SAME ROOT CAUSE / MECHANICAL | P0 | FIXED (PR 2) | role-only (admin/manager/any auth), no company comparison |
| `DELETE /api/pay-methods/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | FIXED (PR 2) | same handler shape as confirmed PATCH |
| `POST /api/payroll-items/:id/amend` | SAME ROOT CAUSE / MECHANICAL | P0 | FIXED (PR 2) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `PATCH /api/payroll-items/:id/tax-override` | SAME ROOT CAUSE / MECHANICAL | P0 | FIXED (PR 2) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `GET /api/payroll-items/:id/taxes` | SAME ROOT CAUSE / MECHANICAL | P1 | FIXED (PR 2) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `GET /api/payroll-runs/:id/agency-liabilities` | SAME ROOT CAUSE / MECHANICAL | P1 | FIXED (PR 2) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `POST /api/payroll-runs/:id/ai-review` | SAME ROOT CAUSE / MECHANICAL | P0 | FIXED (PR 2) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `GET /api/payroll-runs/:id/compliance-events` | SAME ROOT CAUSE / MECHANICAL | P1 | FIXED (PR 2) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `POST /api/payroll-runs/:id/preflight` | SAME ROOT CAUSE / MECHANICAL | P0 | FIXED (PR 2) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `GET /api/payroll-runs/:id/tax-overrides` | SAME ROOT CAUSE / MECHANICAL | P1 | FIXED (PR 2) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `GET /api/payroll-runs/:id/tax-snapshot` | SAME ROOT CAUSE / MECHANICAL | P1 | FIXED (PR 2) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `GET /api/payroll-runs/:id/transaction-runs` | SAME ROOT CAUSE / MECHANICAL | P1 | FIXED (PR 2) | by-id read/write, no ownership check (payroll/tax/pay config) |
| `PATCH /api/system-documents/:id` | SAME ROOT CAUSE / MECHANICAL | P1 | FIXED (PR 2) | by-id, no ownership check (global table — tenant writes platform-wide docs) |
| `DELETE /api/system-documents/:id` | SAME ROOT CAUSE / MECHANICAL | P1 | FIXED (PR 2) | by-id, no ownership check (global table — tenant writes platform-wide docs) |
| `PATCH /api/time-off-requests/:id` | SAME ROOT CAUSE / MECHANICAL | P1 | FIXED (PR 2) | by-id employment/HR record, no ownership check |
| `DELETE /api/time-off-requests/:id` | SAME ROOT CAUSE / MECHANICAL | P1 | FIXED (PR 2) | by-id employment/HR record, no ownership check |
| `DELETE /api/worker-documents/:id` | SAME ROOT CAUSE / MECHANICAL | P0 | FIXED (PR 2) | admin roles skip the company check entirely |
| `GET /api/notification-preferences/:workerId` | LOWER-RISK | P2 | DEFERRED (PR 2B) | by-id employment/HR record, no ownership check |
| `GET /api/permissions/effective/:userId` | LOWER-RISK | P2 | DEFERRED (PR 2B) | by-id employment/HR record, no ownership check |
| `GET /api/saved-reports/:id` | LOWER-RISK | P2 | DEFERRED (PR 2B) | by-id, no ownership check |
| `GET /api/system-documents/:id` | LOWER-RISK | P2 | DEFERRED (PR 2B) | by-id, no ownership check (global table — tenant writes platform-wide docs) |
| `GET /api/worker-agreements/:id` | LOWER-RISK | P2 | DEFERRED (PR 2B) | by-id employment/HR record, no ownership check |
| `GET /api/worker-onboarding/:id/audit-log` | LOWER-RISK | P2 | DEFERRED (PR 2B) | by-id employment/HR record, no ownership check |
| `GET /api/worker-onboarding/:id/documents` | LOWER-RISK | P2 | DEFERRED (PR 2B) | by-id employment/HR record, no ownership check |
| `POST /api/contractor-access-requests/:id/approve` | ALREADY SAFE | - | n/a | service filters WHERE company_id = session company |
| `POST /api/contractor-contracts/:id/add-signer` | ALREADY SAFE | - | n/a | assertContractSignerManageAccess |
| `POST /api/contractor-hub/contracts/:id/signers` | ALREADY SAFE | - | n/a | assertContractSignerManageAccess |
| `GET /api/contractor-invoices/:id/attachments` | ALREADY SAFE | - | n/a | inline sameCompany/contractor check (heuristic missed naming) |
| `POST /api/contractor-invoices/:id/attachments` | ALREADY SAFE | - | n/a | inline sameCompany/contractor check (heuristic missed naming) |
| `GET /api/contractor-invoices/:id/print-check` | ALREADY SAFE | - | n/a | buildContractorInvoiceCheckPdf → canAccessCompany |
| `POST /api/contractor-invoices/:id/print-check` | ALREADY SAFE | - | n/a | buildContractorInvoiceCheckPdf → canAccessCompany |
| `PATCH /api/contractor-notifications/:id/read` | ALREADY SAFE | - | n/a | UPDATE … WHERE user_id/worker_id = session |
| `POST /api/contractor-proposals/:id/accept-counteroffer` | ALREADY SAFE | - | n/a | owner-only (session workerId) |
| `POST /api/contractor-proposals/:id/purge` | ALREADY SAFE | - | n/a | platform_super_admin only (intentional) |
| `POST /api/contractor-proposals/:id/reject-counteroffer` | ALREADY SAFE | - | n/a | owner-only (session workerId) |
| `PATCH /api/contractor-reminders/:id` | ALREADY SAFE | - | n/a | UPDATE … WHERE user_id/worker_id = session |
| `POST /api/expenses/:id/submit` | ALREADY SAFE | - | n/a | owner-only (session workerId) |
| `DELETE /api/invoice-attachments/:id` | ALREADY SAFE | - | n/a | inline sameCompany/contractor check (heuristic missed naming) |
| `POST /api/vendor-documents/:id/review` | ALREADY SAFE | - | n/a | service filters WHERE company_id = session company |
| `POST /api/vendor-invoices/:id/review` | ALREADY SAFE | - | n/a | service filters WHERE company_id = session company |
| `GET /api/pay/:invoiceId` | INTENTIONALLY CROSS-COMPANY/PUBLIC | P2 note | n/a | public invoice-payment link; invoice UUID is the bearer secret |
| `POST /api/pay/:invoiceId/confirm-payment` | INTENTIONALLY CROSS-COMPANY/PUBLIC | P2 note | n/a | public invoice-payment link; invoice UUID is the bearer secret |
| `POST /api/pay/:invoiceId/create-payment-intent` | INTENTIONALLY CROSS-COMPANY/PUBLIC | P2 note | n/a | public invoice-payment link; invoice UUID is the bearer secret |
| `GET /api/payments/stripe-status/:paymentIntentId` | INTENTIONALLY CROSS-COMPANY/PUBLIC | P2 note | n/a | public invoice-payment link; invoice UUID is the bearer secret |
| `GET /api/public/sign/contracts/:token/document` | INTENTIONALLY CROSS-COMPANY/PUBLIC | - | n/a | public, hashed signing token |
| `GET /api/signing/contracts/:token/document` | INTENTIONALLY CROSS-COMPANY/PUBLIC | - | n/a | public, hashed signing token |
| `GET /api/document-hub/assets/:id/download` | FALSE POSITIVE | - | n/a | 307 redirect stub, no data |
| `GET /api/document-hub/assets/:id/print` | FALSE POSITIVE | - | n/a | 307 redirect stub, no data |

## 65-route list scan — status after PR 2

(Group A's four live-confirmed lists and the six force-scoped lists repaired under
Group D were not in this heuristic list. All are fixed.)

| Route | Financial/employment | Status |
|---|---|---|
| `GET /api/accrual-accounts` | yes | DEFERRED (PR 2B) |
| `GET /api/agreement-templates` | yes | DEFERRED (PR 2B) |
| `GET /api/audit-log` | yes | DEFERRED (PR 2B) |
| `GET /api/audit-log/export-csv` | yes | DEFERRED (PR 2B) |
| `GET /api/check-print-audit` | yes | DEFERRED (PR 2B) |
| `GET /api/clock-in-requests` | yes | DEFERRED (PR 2B) |
| `GET /api/contractor-contracts` | yes | DEFERRED (PR 2B) |
| `GET /api/contractor-invoices` | yes | DEFERRED (PR 2B) |
| `GET /api/contractor-invoices/export/csv` | yes | DEFERRED (PR 2B) |
| `GET /api/contractor-proposals` | yes | DEFERRED (PR 2B) |
| `GET /api/earning-types` | yes | DEFERRED (PR 2B) |
| `GET /api/expenses/export/csv` | yes | DEFERRED (PR 2B) |
| `GET /api/invoice-templates` | yes | DEFERRED (PR 2B) |
| `GET /api/invoices` | yes | DEFERRED (PR 2B) |
| `GET /api/new-hire-defaults` | yes | DEFERRED (PR 2B) |
| `GET /api/pay-codes` | yes | DEFERRED (PR 2B) |
| `GET /api/pay-period-schedules` | yes | DEFERRED (PR 2B) |
| `POST /api/pay-period-schedules/deactivate-extras` | yes | DEFERRED (PR 2B) |
| `GET /api/pay-period-schedules/resolve-period` | yes | DEFERRED (PR 2B) |
| `GET /api/pay-periods` | yes | DEFERRED (PR 2B) |
| `GET /api/pay-stub-accounts` | yes | DEFERRED (PR 2B) |
| `GET /api/pay-stub-amendments` | yes | DEFERRED (PR 2B) |
| `GET /api/pay-stub-transactions` | yes | DEFERRED (PR 2B) |
| `GET /api/payment-method-configs` | yes | DEFERRED (PR 2B) |
| `GET /api/payments` | yes | DEFERRED (PR 2B) |
| `GET /api/payroll-audit` | yes | DEFERRED (PR 2B) |
| `GET /api/receipts` | yes | DEFERRED (PR 2B) |
| `GET /api/receipts/export-pdf` | yes | DEFERRED (PR 2B) |
| `GET /api/recurring-billing` | yes | DEFERRED (PR 2B) |
| `GET /api/recurring-expenses` | yes | DEFERRED (PR 2B) |
| `GET /api/remittance-agencies` | yes | DEFERRED (PR 2B) |
| `GET /api/schedule-audit-logs` | yes | DEFERRED (PR 2B) |
| `GET /api/schedule/labor-summary` | yes | DEFERRED (PR 2B) |
| `GET /api/secondary-wage-groups` | yes | DEFERRED (PR 2B) |
| `GET /api/tax-wizard/snapshots` | yes | DEFERRED (PR 2B) |
| `GET /api/taxes-deductions` | yes | DEFERRED (PR 2B) |
| `GET /api/time-punches/pending` | yes | DEFERRED (PR 2B) |
| `GET /api/trade-transactions` | yes | DEFERRED (PR 2B) |
| `GET /api/trade-transactions/reporting-summary` | yes | DEFERRED (PR 2B) |
| `GET /api/worker-agreements` | yes | DEFERRED (PR 2B) |
| `GET /api/worker-onboarding` | yes | DEFERRED (PR 2B) |
| `GET /api/app-doctor/repair-tickets` | no | DEFERRED (PR 2B) |
| `GET /api/automation-rules` | no | DEFERRED (PR 2B) |
| `GET /api/currencies` | no | DEFERRED (PR 2B) |
| `GET /api/dam-documents` | no | DEFERRED (PR 2B) |
| `GET /api/document-hub/assets` | no | DEFERRED (PR 2B) |
| `GET /api/eligibility-rule-sets` | no | DEFERRED (PR 2B) |
| `GET /api/employee-groups` | no | DEFERRED (PR 2B) |
| `GET /api/employee-titles` | no | DEFERRED (PR 2B) |
| `GET /api/holidays` | no | DEFERRED (PR 2B) |
| `GET /api/kpi-groups` | no | DEFERRED (PR 2B) |
| `GET /api/marketplace/listings` | no | DEFERRED (PR 2B) |
| `GET /api/notifications` | no | DEFERRED (PR 2B) |
| `GET /api/policy-groups` | no | DEFERRED (PR 2B) |
| `GET /api/qualification-groups` | no | DEFERRED (PR 2B) |
| `GET /api/qualifications` | no | DEFERRED (PR 2B) |
| `GET /api/recurring-schedules` | no | DEFERRED (PR 2B) |
| `GET /api/reviews` | no | DEFERRED (PR 2B) |
| `GET /api/schedule-preferences` | no | DEFERRED (PR 2B) |
| `GET /api/shift-offers` | no | DEFERRED (PR 2B) |
| `GET /api/stations` | no | DEFERRED (PR 2B) |
| `GET /api/worker-languages` | no | DEFERRED (PR 2B) |
| `GET /api/1099-summaries/export` | yes | FIXED (PR 2) |
| `GET /api/funding-accounts` | yes | FIXED (PR 2) |
| `GET /api/time-off-requests` | yes | FIXED (PR 2) |
