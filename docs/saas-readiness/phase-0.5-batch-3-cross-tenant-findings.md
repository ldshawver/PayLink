# Phase 0.5 — cross-tenant negative tests, batch 3: findings

Companion to [`cross-tenant-batch-3-test-manifest.json`](cross-tenant-batch-3-test-manifest.json)
(machine-readable — regenerated each run of
`tests/cross-tenant-batch-3-routes-db.test.ts`, not committed as a static
artifact since it's a live test result, not a static inventory). This
document is the human write-up of the nine verified findings and the
overall test-matrix result for the eight routes selected from the
committed [storage-scope-trace manifest](storage-scope-trace-manifest.json),
following on from batch 1's two verified-and-repaired findings on the five
worker routes ([`phase-0.5s-cross-tenant-findings.md`](phase-0.5s-cross-tenant-findings.md),
repaired on `saas/phase0.5-worker-tenant-hardening`, PR #85) and batch 2's
six verified-and-repaired findings on nine payroll/invoice/document/company
routes ([`phase-0.5-batch-2-cross-tenant-findings.md`](phase-0.5-batch-2-cross-tenant-findings.md),
repaired on `saas/phase0.5-cross-tenant-batch-2-hardening`, PR #88).

**Scope boundary:** test-first / audit only. None of the nine findings
below is fixed in this branch. No runtime authorization code changed. All
testing used two synthetic tenants and synthetic data in a disposable
Postgres database — no staging or production data was read, written, or
touched.

## How this was tested

`tests/cross-tenant-batch-3-routes-db.test.ts` boots the real, unmodified
application server (`server/index.ts`) against a disposable database,
creates two synthetic tenants ("Tenant A" / "Tenant B") each with real
authenticated sessions obtained through the real `POST /api/auth/login`
route (not a mock), and exercises each route's actual authorization logic
over real HTTP requests. Every disposition below reflects what the running
server actually did, not an assumption from reading the source.

## Route selection

Selected from the committed
[storage-scope-trace manifest](storage-scope-trace-manifest.json) and
manual source reading (most candidate routes carry the tracer's
`unresolved`/low-confidence disposition — the tracer's static heuristic
cannot follow every handler shape, so routes below were individually read
and classified by hand before writing tests, the same way batch 2 did for
its `needs-negative-test`-flagged routes). Prioritized per this batch's
categories: employee compensation/wage/salary/banking > payroll
calculations/deductions/taxes/checks/paystubs > invoice payments/financial
settlement > contracts/documents > company/tenant administration.

| Route | Category | Manifest disposition | Source |
|---|---|---|---|
| `GET /api/companies/:id/ytd-taxes` | payroll/tax | unresolved (manual: high) | `server/routes.ts:7864` |
| `GET /api/check-templates/:id` | checks/paystub | unresolved (manual: high) | `server/routes.ts:20708` |
| `PATCH /api/check-templates/:id` | checks/paystub | unresolved (manual: high) | `server/routes.ts:20738` |
| `DELETE /api/check-templates/:id` | checks/paystub | unresolved (manual: high) | `server/routes.ts:20750` |
| `PATCH /api/contractor-invoices/:id` | invoice/financial settlement | unresolved (manual: high) | `server/routes.ts:10608` |
| `GET /api/wage-history` | employee compensation/wage | unresolved (manual: high) | `server/routes.ts:18962` |
| `DELETE /api/payroll-payment-methods/:id` | payroll/financial settlement | unresolved (manual: high) | `server/routes.ts:22605` |
| `GET /api/payroll-summary` | payroll calculations | needs-runtime-hardening (medium) | `server/routes.ts:1907` |

**Why each was chosen:**

1. **`GET /api/companies/:id/ytd-taxes`** — the company-level sibling of
   the already-fixed `GET /api/workers/:id/ytd-taxes` (PR #85):
   `requireRole("admin","manager")` only, no comparison of `req.params.id`
   (the target company) to the acting user's own `companyId` anywhere in
   the handler.
2–4. **`check_templates` GET/PATCH/DELETE** — carries per-tenant bank
   routing/check-layout configuration. All three verbs use `requireAuth`
   only (no `requireRole`, no company-ownership comparison anywhere) — the
   most permissive gap found in this batch.
5. **`PATCH /api/contractor-invoices/:id`** — the sibling of the
   already-fixed `POST /api/contractor-invoices/:id/mark-paid` (PR #88):
   has an owner-or-manager role check but no company-ownership comparison,
   and `companyId` is in the route's own PATCH-body allow-list with no
   immutability guard.
6. **`GET /api/wage-history`** — the definitive compensation-history
   record. Non-manager tenant users are correctly self-scoped, but a
   manager/admin's `?workerId=` query param is passed straight to
   `storage.getWageHistory` with no company comparison.
7. **`DELETE /api/payroll-payment-methods/:id`** — bank-based payment
   configuration; a role gate exists but no company-ownership comparison
   before deletion.
8. **`GET /api/payroll-summary`** — flagged medium-confidence
   `needs-runtime-hardening` in the committed storage-scope-trace manifest
   (client-supplied `companyId` feeds a company-filtered query). Included
   to empirically confirm whether the route's own tenant-override logic
   actually holds under a live cross-tenant attempt, matching the batch
   1/2 precedent of testing routes whose source suggests a guard exists
   rather than assuming it from static reading alone.

**Deliberately excluded (already covered):** `GET`/`POST /api/workers`,
`PATCH`/`DELETE /api/workers/:id`, `GET /api/workers/:id/ytd-taxes` (batch
1); `GET`/`PATCH`/`DELETE /api/payroll-runs/:id[/summary]`,
`PATCH`/`DELETE /api/invoices/:id`,
`POST /api/contractor-invoices/:id/mark-paid`,
`POST /api/contractor-trade-compensation/:id/approve`,
`GET /api/dam-documents/:id`, `PATCH /api/companies/:id` (batch 2).

**Considered and excluded — `roles` table (`GET`/`PATCH`/`DELETE
/api/roles/:id`):** `shared/schema.ts:1129` has no `companyId`/`tenantId`
column at all, and `name` is globally unique — `roles` is a platform-wide
shared resource by design, not a per-tenant one, so this suite's
cross-tenant isolation methodology (two synthetic tenants, compare
`companyId`) does not apply to it. Whether `tenant_admin`/`tenant_owner`
should hold platform-wide role-management capability at all is a
different question (authorization scope, not tenant isolation) and is out
of scope for this batch.

## Result summary

**29 PASS, 9 FAIL (9 distinct verified defects across 7 routes), 0
INCONCLUSIVE, 0 EXPECTED GLOBAL, 3 N/A.** Stable across repeated runs of
the disposable-database suite.

`GET /api/payroll-summary` — the one route in this batch flagged by the
committed manifest rather than found by manual reading — passed every
case: its `isTenantSummaryUser` override does force a non-platform
caller's own `companyId` regardless of a `?companyId=` query-param
injection attempt, confirmed empirically, not assumed from the route
source showing the override exists.

The 3 N/A cases are all "unauthorized same-tenant role" slots for the
`check_templates` GET/PATCH/DELETE routes — none of the three has a
`requireRole` at all (only `requireAuth`), so there is no role restriction
to test. This is itself part of finding 2–4's severity, not a gap in test
coverage.

## Verified defect 1 — `GET /api/companies/:id/ytd-taxes` has no tenant check at all

**Severity: high — any admin/manager, company-wide payroll-tax data leak.**

```ts
app.get("/api/companies/:id/ytd-taxes", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const workers = await storage.getWorkers(req.params.id);
  const results = await Promise.all(workers.map(async (w) => {
    const ytd = await storage.getEmployeeYTD(w.id, year, req.params.id);
    return { workerId: w.id, ...ytd };
  }));
  res.json(results);
});
```

`req.params.id` (the target company) is never compared to the acting
user's own `companyId` anywhere in this handler. Verified directly: a
Tenant A admin, given only Tenant B's company id, received `status=200`
with every one of Tenant B's workers' YTD tax totals. A nonexistent
company id does not 404 (there is no company-existence check at all) but
also leaks nothing — `storage.getWorkers` simply returns an empty array.

**Recommended minimal repair** (not implemented in this branch): the same
ownership-guard shape used on the already-repaired
`GET /api/workers/:id/ytd-taxes` and `GET /api/payroll-runs/:id/summary` —
compare `req.params.id` to the acting non-platform user's own `companyId`
before calling `getWorkers`/`getEmployeeYTD`, 403 (or 404, to avoid an
existence oracle — this route already has none) on mismatch.

## Verified defect 2 — `GET /api/check-templates/:id` has no authorization check of any kind

**Severity: high — no role gate, no tenant gate; check-printing
configuration (bank routing/account layout) readable by any authenticated
user in any tenant.**

```ts
app.get("/api/check-templates/:id", requireAuth, async (req, res) => {
  const template = await storage.getCheckTemplate(req.params.id as string);
  if (!template) return res.status(404).json({ message: "Template not found" });
  res.json(template);
});
```

No `requireRole`, no company comparison. Verified directly: a Tenant A
admin read Tenant B's check template by id alone.

**Recommended minimal repair** (not implemented in this branch): add a
company-ownership guard (fetch-and-compare against the acting non-platform
user's `companyId`) — and separately decide, as a product question outside
this audit's scope, whether this route should also gain a `requireRole`
restriction to match its `POST`/sibling routes.

## Verified defect 3 — `PATCH /api/check-templates/:id` has no ownership check and no companyId immutability

**Severity: high — two independent gaps on the same route.**

```ts
app.patch("/api/check-templates/:id", requireAuth, async (req, res) => {
  const data = { ...req.body };
  if (data.companyId === "") data.companyId = null;
  const template = await storage.updateCheckTemplate(req.params.id as string, data);
  ...
});
```

No company comparison of any kind, and `data` (including a client-supplied
`companyId`) is applied verbatim. Verified directly, two ways:

- A Tenant A admin changed Tenant B's check template `name` by id alone
  (no Tenant B session or membership required). Restored immediately by
  the test after detection.
- A Tenant A admin, editing their *own* check template (an id they
  legitimately own), included `companyId: <Tenant B's id>` in the update
  body — the template's `company_id` column changed to Tenant B,
  reassigning it out of Tenant A. Restored immediately by the test after
  detection.

**Recommended minimal repair** (not implemented in this branch): the same
fetch-and-compare ownership guard as defect 2, plus the same
companyId-immutability guard already applied to
`PATCH /api/payroll-runs/:id` (PR #88) — reject a differing `companyId`
before any mutation.

## Verified defect 4 — `DELETE /api/check-templates/:id` has no ownership check at all

**Severity: high — destructive, and check templates control physical
paycheck layout/bank info.**

```ts
app.delete("/api/check-templates/:id", requireAuth, async (req, res) => {
  await storage.deleteCheckTemplate(req.params.id as string);
  res.json({ success: true });
});
```

No company comparison, no existence check (deleting a nonexistent id
still reports `{ success: true }` — informational, not itself a leak).
Verified directly: a Tenant A admin permanently deleted Tenant B's check
template by id.

**Recommended minimal repair** (not implemented in this branch): the same
fetch-and-compare guard as defects 2/3, before calling
`deleteCheckTemplate`.

## Verified defect 5 — `PATCH /api/contractor-invoices/:id` has no ownership check and no companyId immutability

**Severity: high — same two-gap shape as defect 3, on a financial
settlement record.**

```ts
app.patch("/api/contractor-invoices/:id", requireAuth, async (req, res) => {
  const existing = await storage.getContractorInvoice(req.params.id);
  if (!existing) return res.status(404).json({ message: "Not found" });
  const user = await storage.getUser(req.session.userId!);
  const isOwner = user?.workerId === existing.contractorId;
  const isManager = user?.role === "admin" || user?.role === "manager";
  if (!isOwner && !isManager) return res.status(403).json({ message: "Not authorized" });
  const allowedFields = [..., "companyId", ...];
  ...
  const r = await storage.updateContractorInvoice(req.params.id, sanitized);
  ...
});
```

The `isOwner`/`isManager` check is role-only — `existing.companyId` is
fetched but never compared to the acting user's own company. Verified
directly, two ways:

- A Tenant A admin changed Tenant B's contractor invoice `notes` field by
  id alone.
- A Tenant A admin, editing their own contractor invoice, included
  `companyId: <Tenant B's id>` in the body (it is one of this route's own
  `allowedFields`) — the invoice's `company_id` changed to Tenant B.
  Restored immediately by the test after detection.

**Recommended minimal repair** (not implemented in this branch): compare
`existing.companyId` to the acting non-platform user's own `companyId`
before the `isOwner`/`isManager` branch, and drop `companyId` from
`allowedFields` (or explicitly reject a differing value) — the same
pattern already applied to `PATCH /api/payroll-runs/:id` (PR #88).

## Verified defect 6 — `GET /api/wage-history` leaks cross-tenant wage data via `?workerId=`

**Severity: high — direct compensation-history disclosure.**

```ts
app.get("/api/wage-history", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!);
  let workerId = queryStr(req.query.workerId);
  if (user && user.workerId && !isManagerRole(user.role)) {
    workerId = user.workerId;
  }
  const entries = await storage.getWageHistory(workerId);
  res.json(entries);
});
```

Non-manager tenant users are correctly forced onto their own `workerId` —
verified directly: a Tenant A employee's `?workerId=` override was
silently ignored and they received only their own entries, even when
targeting a coworker in the same tenant. But a manager/admin's
`?workerId=` is passed straight to `storage.getWageHistory(workerId)`
(`server/storage.ts:2076-2081`, an id-only lookup) with no company
comparison at all. Verified directly: a Tenant A admin read Tenant B's
worker's wage history by id.

**Recommended minimal repair** (not implemented in this branch): when the
caller is a manager/admin and a `workerId` is supplied, fetch that
worker's authoritative `companyId` and compare it to the acting user's
own before calling `getWageHistory` — the same shape as the ownership
checks already applied elsewhere. A nonexistent worker id already returns
an empty list, not a leak.

## Verified defect 7 — `DELETE /api/payroll-payment-methods/:id` has no ownership check at all

**Severity: high — destructive, payroll payment-method configuration.**

```ts
app.delete("/api/payroll-payment-methods/:id", requireAuth, requireRole("admin"), async (req, res) => {
  await storage.deletePayrollPaymentMethod(req.params.id);
  res.json({ message: "Deleted" });
});
```

Role-gated to `admin`, but no comparison of the target row's `companyId`
to the acting user's own. Verified directly: a Tenant A admin permanently
deleted Tenant B's payroll payment method by id. A nonexistent id also
reports success (no existence check) — informational, not a leak.

**Recommended minimal repair** (not implemented in this branch): fetch the
existing payment method, compare its `companyId` to the acting
non-platform user's `companyId`, 403 on mismatch, before calling
`deletePayrollPaymentMethod`.

## `GET /api/payroll-summary` — confirmed PASS

Route source already shows an explicit tenant override:

```ts
const isTenantSummaryUser = !isPlatformUser(summaryUser?.role) && !!summaryUser?.companyId;
const effectiveSummaryCo = isTenantSummaryUser ? summaryUser!.companyId! : (companyId ...);
```

Verified directly: a Tenant A admin's request with `?companyId=<Tenant
B's id>` still returned only Tenant A's own aggregate totals — the
query-param injection attempt had no effect. This empirically resolves
the committed storage-scope-trace manifest's medium-confidence
`needs-runtime-hardening` flag on this route (a static-analysis limitation
that could not see the override logic) as a confirmed false positive: **no
change needed.**

## What was NOT found

- Missing-authentication (401) was correctly enforced on every one of the
  eight routes.
- Nonexistent-resource ids never leaked data on any route, even where (as
  documented per-route above) the underlying storage call has no true
  existence check and returns an empty result or a blanket success instead
  of a 404.
- No SQL, stack trace, or internal-ID-beyond-the-submitted-value leakage
  was observed in any error response reviewed.

## Cleanup verification

Every run deletes the two synthetic companies and everything transitively
referencing them (via the same generic FK-aware cascade used by batches 1
and 2 — see `scripts/cross-tenant-negative-tests/cascade-cleanup.ts`),
then independently re-queries for the same root ids and every directly
referencing table to confirm zero rows remain. A representative run's
cleanup line:

```
Cleanup verified: zero synthetic rows remain. Deleted: check_templates(1), contractor_invoices(2), departments(2), locations(2), payroll_payment_methods(1), payroll_items(2), payroll_runs(2), wage_history(2), workers(5), companies(2)
```

## Deferred follow-ups (not started in this branch)

1. A narrow hardening branch fixing all nine verified defects above, each
   accompanied by turning today's `FAIL` into a permanent regression
   `PASS` in this same test file — the same pattern
   `saas/phase0.5-cross-tenant-batch-2-hardening` (PR #88) used for batch
   2.
2. Extending this same real-server/real-session test pattern to further
   high-risk unresolved routes not yet covered by batches 1-3 — the
   sibling routes `GET /api/companies/:id/quarterly-taxes` and
   `GET /api/companies/:id/tax-liability` (immediately adjacent to
   defect 1 in `server/routes.ts`), `GET /api/check-templates` (the list
   endpoint, which accepts an unrestricted `?companyId=` filter),
   `GET /api/contractor-invoices/:id`, and the `payroll-payment-methods`/
   `check-templates` `POST`/create routes are the strongest remaining
   candidates by this batch's own category priorities.
3. A separate, non-tenant-isolation review of whether `tenant_admin`/
   `tenant_owner` should hold platform-wide `roles`-table management
   capability at all, since that table has no per-tenant scope by design.
4. Re-running the storage-scope trace after any hardening branch lands, to
   confirm the manifest's classification for these eight routes updates
   accordingly.

No exploitation steps, real tenant identifiers, credentials, or production
data are included in this document — every id and figure above belongs to
a synthetic fixture created and destroyed within a single
disposable-database test run.
