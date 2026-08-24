# Phase 0.5 — cross-tenant negative tests, batch 4: findings

Companion to [`cross-tenant-batch-4-test-manifest.json`](cross-tenant-batch-4-test-manifest.json)
(machine-readable — regenerated each run of
`tests/cross-tenant-batch-4-routes-db.test.ts`, not committed as a static
artifact since it's a live test result, not a static inventory). This
document is the human write-up of the sixteen verified findings and the
overall test-matrix result for the eleven routes selected from the
committed [storage-scope-trace manifest](storage-scope-trace-manifest.json)
and manual source reading, following on from batch 1's two
verified-and-repaired findings on the five worker routes
([`phase-0.5s-cross-tenant-findings.md`](phase-0.5s-cross-tenant-findings.md),
repaired on `saas/phase0.5-worker-tenant-hardening`, PR #85), batch 2's six
verified-and-repaired findings on nine payroll/invoice/document/company
routes ([`phase-0.5-batch-2-cross-tenant-findings.md`](phase-0.5-batch-2-cross-tenant-findings.md),
repaired on `saas/phase0.5-cross-tenant-batch-2-hardening`, PR #88), and
batch 3's nine verified-and-repaired findings on seven
payroll/check-template/invoice/company routes
([`phase-0.5-batch-3-cross-tenant-findings.md`](phase-0.5-batch-3-cross-tenant-findings.md),
repaired on `saas/phase0.5-cross-tenant-batch-3-hardening`, PR #89/#90).

**Scope boundary:** test-first / audit only. None of the sixteen findings
below is fixed in this branch. No runtime authorization code changed. All
testing used two synthetic tenants and synthetic data in a disposable
Postgres database — no staging or production data was read, written, or
touched.

## How this was tested

`tests/cross-tenant-batch-4-routes-db.test.ts` boots the real, unmodified
application server (`server/index.ts`) against a disposable database,
creates two synthetic tenants ("Tenant A" / "Tenant B") each with real
authenticated sessions obtained through the real `POST /api/auth/login`
route (not a mock), and exercises each route's actual authorization logic
over real HTTP requests. Every disposition below reflects what the running
server actually did, not an assumption from reading the source.

## Route selection

Selected from the committed
[storage-scope-trace manifest](storage-scope-trace-manifest.json) (all
`unresolved`, low confidence — the tracer's static heuristic cannot follow
every handler shape) and manual source reading, the same way batches 2 and
3 selected their `needs-negative-test`/`unresolved`-flagged routes.
Prioritized per this batch's categories: banking/payment
methods/checks/direct-deposit/payroll-payments/financial-exports > wage
history/salary/pay-rates/deductions/tax/payroll-results/paystubs > tenant
membership/company administration/role assignment/invitations/licensing/
platform-console > contracts/signatures/invoices/rent-credits/private
documents/downloads > companyId/tenantId reassignment mutations.

| Route | Operation | Sensitive data / mutation | Manifest classification | Why selected | Expected ownership relationship |
|---|---|---|---|---|---|
| `GET /api/companies/:id/tax-liability` | read/aggregate | Company-wide payroll tax liability totals (Form 941 basis) | unresolved (manual: high) | Direct sibling of the already-fixed `GET /api/workers/:id/ytd-taxes` (PR #85) and `GET /api/companies/:id/ytd-taxes` (PR #89/#90); explicitly flagged as a strongest-remaining-candidate in the batch-3 findings doc | `req.params.id` must equal the acting non-platform user's own `companyId` |
| `GET /api/companies/:id/quarterly-taxes` | read/aggregate | Quarterly tax filing data (Form 941/DE 9/DE 9C basis) | unresolved (manual: high) | Same sibling group as above; same batch-3 follow-up flag | Same as above |
| `GET /api/check-templates` | read (list) | Per-tenant check-printing configuration, unrestricted `?companyId=` filter | unresolved (manual: high) | List sibling of the already-fixed by-id `GET`/`PATCH`/`DELETE /api/check-templates/:id` (PR #89/#90); explicitly named in the batch-3 findings doc's deferred follow-ups | `?companyId=` must be forced to the acting non-platform user's own company |
| `POST /api/check-templates` | create | New check template owned by a client-supplied `companyId` | unresolved (manual: high) | Create sibling of the same route family; companyId taken verbatim from the body | Body `companyId` must be forced/validated against the acting non-platform user's own company |
| `PATCH /api/payroll-payment-methods/:id` | mutate | Bank-based payment-method configuration (ACH/digital-wallet settings) | unresolved (manual: high) | Sibling of the already-fixed `DELETE /api/payroll-payment-methods/:id` (PR #89/#90) — same route family, unrepaired verb | Fetch-and-compare `existing.companyId`; `companyId` immutable |
| `PATCH /api/payroll-payment-records/:id` | mutate | Actual payment-transaction record (gross/net pay, tax withheld, funding account, check number) | unresolved (manual: high) | Highest-sensitivity financial-settlement record not yet covered; sibling read routes on this same resource confirmed correctly scoped | Fetch-and-compare `existing.companyId`; `companyId` immutable |
| `DELETE /api/payroll-payment-records/:id` | delete | Same payment-transaction record as above | unresolved (manual: high) | Same resource, destructive verb | Fetch-and-compare `existing.companyId` before delete |
| `GET /api/worker-memberships` | read (list) | Worker professional/organization membership records (organization, membership number) | unresolved (manual: high) | No `requireRole` at all and no company scoping — the most permissive gap found in this batch; sibling self-service route `/api/my/memberships` confirmed correctly scoped | `?companyId=` must be forced to the acting non-platform user's own company |
| `POST /api/worker-memberships` | create | New membership record owned by a client-supplied `companyId` | unresolved (manual: high) | Same route family, create verb, no role gate | Body `companyId` must be forced/validated against the acting non-platform user's own company |
| `PATCH /api/worker-memberships/:id` | mutate | Same membership record | unresolved (manual: high) | Same route family, update verb, no role gate | Fetch-and-compare `existing.companyId`; `companyId` immutable |
| `DELETE /api/worker-memberships/:id` | delete | Same membership record | unresolved (manual: high) | Same route family, destructive verb, no role gate | Fetch-and-compare `existing.companyId` before delete |

**Considered and confirmed NOT a defect (read, not selected as a test
target beyond one own-tenant sanity check):** `GET
/api/payroll-payment-records` and `GET
/api/payroll-payment-records/ytd-summary` — both force-scope every
non-platform caller's `companyId` unconditionally
(`server/routes.ts`), correctly overriding any client-supplied
`?companyId=`. `GET /api/my/memberships`, `POST /api/my/memberships`, and
`DELETE /api/my/memberships/:id` — all three correctly self-scope by the
caller's own `workerId`, never accept a foreign id.

**Deliberately excluded (already covered):** `GET`/`POST /api/workers`,
`PATCH`/`DELETE /api/workers/:id`, `GET /api/workers/:id/ytd-taxes` (batch
1); `GET`/`PATCH`/`DELETE /api/payroll-runs/:id[/summary]`,
`PATCH`/`DELETE /api/invoices/:id`,
`POST /api/contractor-invoices/:id/mark-paid`,
`POST /api/contractor-trade-compensation/:id/approve`,
`GET /api/dam-documents/:id`, `PATCH /api/companies/:id` (batch 2);
`GET /api/companies/:id/ytd-taxes`,
`GET`/`PATCH`/`DELETE /api/check-templates/:id`,
`PATCH /api/contractor-invoices/:id`, `GET /api/wage-history`,
`DELETE /api/payroll-payment-methods/:id`, `GET /api/payroll-summary`
(batch 3).

## Result summary

**34 PASS, 16 FAIL (16 distinct verified defects across all 11 routes
tested), 0 INCONCLUSIVE, 0 EXPECTED GLOBAL, 5 N/A.** Stable across repeated
runs of the disposable-database suite.

The 5 N/A cases are all "role-gate" slots for routes that carry
`requireAuth` only, no `requireRole` at all: `GET`/`POST
/api/check-templates`, and `GET`/`POST`/`PATCH`/`DELETE
/api/worker-memberships`. This is itself part of several findings'
severity, not a gap in test coverage — the same shape batch 3 documented
for the `check_templates`-by-id routes.

## Verified defect 1 — `GET /api/companies/:id/tax-liability` has no tenant check at all

**Severity: high — any admin/manager, company-wide payroll-tax data leak.**

```ts
app.get("/api/companies/:id/tax-liability", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const liability = await storage.getCompanyTaxLiability(req.params.id, start, end);
  res.json(liability);
});
```

`req.params.id` (the target company) is never compared to the acting
user's own `companyId` anywhere in this handler. Verified directly: a
Tenant A admin, given only Tenant B's company id, received `status=200`
with Tenant B's federal-withholding tax-liability total. A nonexistent
company id does not 404 (there is no company-existence check at all) but
also leaks nothing — `storage.getCompanyTaxLiability` simply returns `[]`.

**Recommended minimal repair** (not implemented in this branch): the same
ownership-guard shape used on the already-repaired
`GET /api/companies/:id/ytd-taxes` (PR #89/#90) — compare `req.params.id`
to the acting non-platform user's own `companyId` before calling
`getCompanyTaxLiability`, 403 (or 404, to avoid an existence oracle — this
route already has none) on mismatch.

## Verified defect 2 — `GET /api/companies/:id/quarterly-taxes` has no tenant check at all

**Severity: high — same shape as defect 1, on Form 941/DE 9/DE 9C
quarterly filing data.**

```ts
app.get("/api/companies/:id/quarterly-taxes", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const allRuns = await storage.getPayrollRuns(req.params.id);
  // ... aggregates payroll_item_taxes across req.params.id's runs
});
```

Same defect shape as defect 1 — `req.params.id` is fed straight to
`storage.getPayrollRuns` with no comparison to the acting user's own
company. Verified directly: a Tenant A admin received Tenant B's quarterly
federal-withholding total by company id alone. A nonexistent company id
returns an empty result, not a leak.

**Recommended minimal repair** (not implemented in this branch): identical
guard shape to defect 1.

## Verified defect 3 — `GET /api/check-templates` (list) leaks cross-tenant templates two ways

**Severity: high — no role gate, no tenant gate on either code path.**

```ts
app.get("/api/check-templates", requireAuth, async (req, res) => {
  const companyId = queryStr(req.query.companyId);
  const templates = await storage.getCheckTemplates(companyId);
  res.json(templates);
});
```

Verified directly, two ways:

- A Tenant A admin passed `?companyId=<Tenant B's id>` and received Tenant
  B's check-template list.
- A Tenant A admin **omitted** `companyId` entirely and received every
  company's templates unfiltered — `storage.getCheckTemplates()` with no
  argument returns the full table
  (`db.select().from(checkTemplates).orderBy(...)`, no `WHERE` clause at
  all). This is a bigger leak than the first case: no target company id
  needs to be known or guessed.

**Recommended minimal repair** (not implemented in this branch): force
`companyId` to the acting non-platform user's own company, the same
pattern already used on `GET /api/payroll-payment-records` and `GET
/api/payroll-payment-methods` in this codebase — never call
`getCheckTemplates()` with no argument for a non-platform caller.

## Verified defect 4 — `POST /api/check-templates` accepts a client-supplied foreign `companyId`

**Severity: high — a tenant can write a new record into another tenant's
company.**

```ts
app.post("/api/check-templates", requireAuth, async (req, res) => {
  const data = { ...req.body };
  if (!data.companyId || data.companyId === "") return res.status(400).json({ message: "Company is required" });
  const parsed = insertCheckTemplateSchema.parse(data);
  const template = await storage.createCheckTemplate(parsed);
  res.status(201).json(template);
});
```

`companyId` is required to be present but never compared to the acting
user's own company. Verified directly: a Tenant A admin created a new
check template with `companyId: <Tenant B's id>` in the body — the row was
created with `company_id` set to Tenant B, `status=201`.

**Recommended minimal repair** (not implemented in this branch): for a
non-platform caller, force `data.companyId` to the acting user's own
company (or reject a differing value), before calling
`createCheckTemplate`.

## Verified defect 5 — `PATCH /api/payroll-payment-methods/:id` has no ownership check and no companyId immutability

**Severity: high — two independent gaps on the same route, on bank-based
payment-method configuration; the same shape already fixed on sibling
routes in PR #89/#90.**

```ts
app.patch("/api/payroll-payment-methods/:id", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const r = await storage.updatePayrollPaymentMethod(req.params.id, req.body);
  if (!r) return res.status(404).json({ message: "Not found" });
  res.json(r);
});
```

No company comparison of any kind, and `req.body` (including a
client-supplied `companyId`) is applied verbatim. Verified directly, two
ways:

- A Tenant A admin changed Tenant B's payment method's `name` by id alone.
  Restored immediately by the test after detection.
- A Tenant A admin, editing their own payment method (an id they
  legitimately own), included `companyId: <Tenant B's id>` in the update
  body — the method's `company_id` column changed to Tenant B. Restored
  immediately by the test after detection.

**Recommended minimal repair** (not implemented in this branch): the same
fetch-and-compare ownership guard, plus the same companyId-immutability
guard, already applied to `DELETE /api/payroll-payment-methods/:id` and
`PATCH /api/check-templates/:id` (PR #89/#90).

## Verified defect 6 — `PATCH /api/payroll-payment-records/:id` has no ownership check and no companyId immutability

**Severity: high — same two-gap shape as defect 5, on an actual payment
transaction record (gross/net pay, tax withheld, funding account, check
number).**

```ts
app.patch("/api/payroll-payment-records/:id", requireRole("admin", "manager"), async (req, res) => {
  const r = await storage.updatePayrollPaymentRecord(req.params.id, req.body);
  if (!r) return res.status(404).json({ message: "Not found" });
  res.json(r);
});
```

Verified directly, two ways: a Tenant A admin changed Tenant B's payment
record `memo` field by id alone; a Tenant A admin editing their own record
included a foreign `companyId` in the body and it took effect. Both
restored immediately by the test after detection.

**Recommended minimal repair** (not implemented in this branch): identical
guard shape to defect 5.

## Verified defect 7 — `DELETE /api/payroll-payment-records/:id` has no ownership check at all

**Severity: high — destructive, on the same financial-settlement record
as defect 6.**

```ts
app.delete("/api/payroll-payment-records/:id", requireRole("admin"), async (req, res) => {
  await storage.deletePayrollPaymentRecord(req.params.id);
  res.json({ message: "Deleted" });
});
```

No company comparison, no existence check (deleting a nonexistent id still
reports success — informational, not itself a leak). Verified directly: a
Tenant A admin permanently deleted Tenant B's payment record by id.

**Recommended minimal repair** (not implemented in this branch): the same
fetch-and-compare guard as defect 6, before calling
`deletePayrollPaymentRecord`.

## Verified defect 8 — `GET /api/worker-memberships` leaks cross-tenant membership data two ways

**Severity: high — no role gate at all (any authenticated user, any
role, any tenant), and no tenant gate on either code path.**

```ts
app.get("/api/worker-memberships", requireAuth, async (req, res) => {
  const companyId = queryStr(req.query.companyId);
  const memberships = await storage.getWorkerMemberships(companyId);
  res.json(memberships);
});
```

Same two-path shape as defect 3: a Tenant A admin reading via
`?companyId=<Tenant B's id>` received Tenant B's membership list; omitting
`companyId` entirely returned every company's memberships unfiltered
(`storage.getWorkerMemberships()` with no argument has no `WHERE` clause).
Unlike every check-templates case, there is no role restriction of any
kind on this route — an ordinary employee session, not just an
admin/manager, could reach this.

**Recommended minimal repair** (not implemented in this branch): force
`companyId` to the acting non-platform user's own company, the same
pattern as defect 3. Whether this route should also gain a `requireRole`
restriction (it currently has none) is a separate authorization-scope
question, outside this audit's tenant-isolation methodology — the same
distinction batch 3 drew for the `check_templates`-by-id routes.

## Verified defect 9 — `POST /api/worker-memberships` accepts a client-supplied foreign `companyId`

**Severity: high — no role gate, and a tenant can write a new record into
another tenant's company.**

```ts
app.post("/api/worker-memberships", requireAuth, async (req, res) => {
  const membership = await storage.createWorkerMembership(req.body);
  res.status(201).json(membership);
});
```

Verified directly: a Tenant A admin created a new membership record with
`companyId: <Tenant B's id>` in the body — the row was created owned by
Tenant B, `status=201`.

**Recommended minimal repair** (not implemented in this branch): force
`req.body.companyId` to the acting user's own company (or reject a
differing value) before calling `createWorkerMembership`.

## Verified defect 10 — `PATCH /api/worker-memberships/:id` has no ownership check and no companyId immutability

**Severity: high — no role gate, and two independent gaps on the same
route.**

```ts
app.patch("/api/worker-memberships/:id", requireAuth, async (req, res) => {
  const membership = await storage.updateWorkerMembership(req.params.id, req.body);
  if (!membership) return res.status(404).json({ message: "Membership not found" });
  res.json(membership);
});
```

Verified directly, two ways: a Tenant A admin changed Tenant B's
membership `organization` field by id alone; a Tenant A admin editing
their own membership included a foreign `companyId` in the body and it
took effect. Both restored immediately by the test after detection.

**Recommended minimal repair** (not implemented in this branch): the same
fetch-and-compare ownership guard plus companyId-immutability guard as
defect 5/6.

## Verified defect 11 — `DELETE /api/worker-memberships/:id` has no ownership check at all

**Severity: high — no role gate, destructive.**

```ts
app.delete("/api/worker-memberships/:id", requireAuth, async (req, res) => {
  await storage.deleteWorkerMembership(req.params.id);
  res.json({ message: "Membership deleted" });
});
```

No company comparison, no existence check (deleting a nonexistent id still
reports success — informational, not itself a leak). Verified directly: a
Tenant A admin permanently deleted Tenant B's membership record by id.

**Recommended minimal repair** (not implemented in this branch): the same
fetch-and-compare guard as defect 7, before calling
`deleteWorkerMembership`.

## What was NOT found

- Missing-authentication (401) was correctly enforced on every one of the
  eleven routes.
- Nonexistent-resource ids never leaked data on any route, even where (as
  documented per-route above) the underlying storage call has no true
  existence check and returns an empty result or a blanket success instead
  of a 404.
- `GET /api/payroll-payment-records`, `GET
  /api/payroll-payment-records/ytd-summary`, and all three
  `/api/my/memberships` verbs were read and confirmed correctly scoped —
  no defect to verify, not included as full test-matrix targets beyond a
  single own-tenant sanity check each.
- No SQL, stack trace, or internal-ID-beyond-the-submitted-value leakage
  was observed in any error response reviewed.

## Cleanup verification

Every run deletes the two synthetic companies and everything transitively
referencing them (via the same generic FK-aware cascade used by batches
1–3 — see `scripts/cross-tenant-negative-tests/cascade-cleanup.ts`), then
independently re-queries for the same root ids and every directly
referencing table to confirm zero rows remain. A representative run's
cleanup line:

```
Cleanup verified: zero synthetic rows remain. Deleted: check_templates(4), departments(2), locations(2), payroll_payment_methods(2), payroll_payment_records(1), payroll_item_taxes(2), payroll_items(2), payroll_runs(2), worker_memberships(3), workers(3), companies(2)
```

## Deferred follow-ups (not started in this branch)

1. A narrow hardening branch fixing all sixteen verified defects above,
   each accompanied by turning today's `FAIL` into a permanent regression
   `PASS` in this same test file — the same pattern
   `saas/phase0.5-cross-tenant-batch-3-hardening` (PR #89/#90) used for
   batch 3.
2. A separate, non-tenant-isolation review of whether
   `GET`/`POST`/`PATCH`/`DELETE /api/worker-memberships[/:id]` and
   `GET`/`POST /api/check-templates` should also gain `requireRole`
   restrictions (none of the five carries one today) — an
   authorization-scope question, not a tenant-isolation one, out of scope
   for this batch.
3. Extending this same real-server/real-session test pattern to further
   high-risk unresolved routes not yet covered by batches 1–4 — the
   `platform/audit/*` mutation endpoints that accept a `:companyId` path
   segment (e.g. `POST /api/platform/audit/contracts/:companyId/sign`,
   `POST /api/platform/audit/licensing/:companyId/gate-override`) are the
   strongest remaining candidates: unread in this batch, but their shape
   (a platform-console mutation parameterized by an arbitrary companyId)
   warrants explicit verification of the platform-owner-only role gate
   before Phase 0.5 is considered complete.
4. Re-running the storage-scope trace after any hardening branch lands, to
   confirm the manifest's classification for these eleven routes updates
   accordingly.

No exploitation steps, real tenant identifiers, credentials, or production
data are included in this document — every id and figure above belongs to
a synthetic fixture created and destroyed within a single
disposable-database test run.
