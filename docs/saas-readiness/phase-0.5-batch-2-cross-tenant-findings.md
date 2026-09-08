# Phase 0.5 — cross-tenant negative tests, batch 2: findings

Companion to [`cross-tenant-batch-2-test-manifest.json`](cross-tenant-batch-2-test-manifest.json)
(machine-readable — regenerated each run of
`tests/cross-tenant-batch-2-routes-db.test.ts`, not committed as a static
artifact since it's a live test result, not a static inventory). This
document is the human write-up of the six verified findings and the overall
test-matrix result for the nine routes selected from the
[Phase 0.5r storage-scope trace](../saas-readiness/storage-scope-trace-manifest.json),
following on from batch 1's two verified-and-repaired findings on the five
worker routes ([`phase-0.5s-cross-tenant-findings.md`](phase-0.5s-cross-tenant-findings.md),
repaired on `saas/phase0.5-worker-tenant-hardening`, PR #85).

**Scope boundary:** test-first / audit only. None of the six findings below
is fixed in this branch. No runtime authorization code changed. All testing
used two synthetic tenants and synthetic data in a disposable Postgres
database — no staging or production data was read, written, or touched.

## How this was tested

`tests/cross-tenant-batch-2-routes-db.test.ts` boots the real, unmodified
application server (`server/index.ts`) against a disposable database, creates
two synthetic tenants ("Tenant A" / "Tenant B") each with real authenticated
sessions obtained through the real `POST /api/auth/login` route (not a mock),
and exercises each route's actual authorization logic over real HTTP
requests. Every disposition below reflects what the running server actually
did, not an assumption from reading the source.

One iteration of this test's own fixture setup produced a false-positive FAIL
on `GET /api/dam-documents/:id` (case 3): the Tenant A employee fixture user
had `worker_id = NULL`, which happened to equal the fixture document's own
`worker_id = NULL`, so the route's `doc.worker_id !== workerId` comparison
was vacuously false and let the request through — an artifact of the test's
own fixture, not a code path a real employee account (always linked to a
worker record) would hit. The fixture was corrected to link the employee to
a real, distinct worker id before drawing any conclusion; the case then
passed cleanly and consistently across repeated runs. Documented here for
transparency about the test process, not carried forward as a finding.

## Routes tested

| Route | Disposition (pre-test) | Confidence | Source |
|---|---|---|---|
| `GET /api/payroll-runs/:id/summary` | needs-runtime-hardening | high | `server/routes.ts:5714` |
| `PATCH /api/payroll-runs/:id` | needs-runtime-hardening | high | `server/routes.ts:8209` |
| `DELETE /api/payroll-runs/:id` | needs-runtime-hardening | high | `server/routes.ts:5752` |
| `PATCH /api/invoices/:id` | needs-runtime-hardening | high | `server/routes.ts:24833` |
| `DELETE /api/invoices/:id` | needs-runtime-hardening | high | `server/routes.ts:24849` |
| `POST /api/contractor-invoices/:id/mark-paid` | needs-runtime-hardening | high | `server/routes.ts:10866` |
| `POST /api/contractor-trade-compensation/:id/approve` | needs-negative-test | medium | `server/routes.ts:22524` |
| `GET /api/dam-documents/:id` | needs-negative-test | medium | `server/routes.ts:16609` |
| `PATCH /api/companies/:id` | needs-runtime-hardening | high | `server/routes.ts:2128` |

## Result summary

**31 PASS, 6 FAIL (6 distinct verified defects), 0 INCONCLUSIVE, 0 EXPECTED GLOBAL, 0 N/A.**
Stable across repeated runs of the disposable-database suite.

Three of the nine routes (`DELETE /api/payroll-runs/:id`,
`POST /api/contractor-trade-compensation/:id/approve`,
`GET /api/dam-documents/:id`) already have a working company-ownership
guard and passed every case — confirmed empirically, not assumed from the
route source showing a guard exists.

## Verified defect 1 — `GET /api/payroll-runs/:id/summary` has no tenant check at all

**Severity: high — any admin/manager, silent financial data leak.** The
handler fetches the target run by id alone and the summary by that run's id
alone, with no comparison to the caller's own company anywhere:

```ts
app.get("/api/payroll-runs/:id/summary", requireAuth, requireRole("admin", "manager"), requireActiveSubscription, async (req, res) => {
  const run = await storage.getPayrollRun(req.params.id);
  if (!run) return res.status(404).json({ message: "Payroll run not found" });
  const summary = await storage.getPayrollSummary(run.id);
  if (!summary) return res.status(404).json({ message: "Payroll summary not found" });
  res.json(summary);
});
```

`storage.getPayrollRun` and `storage.getPayrollSummary` (`server/storage.ts:1556`,
`server/storage.ts:4204`) are both plain id-only `db.select()` lookups — no
company filter at either the route or storage layer. Verified directly: a
Tenant A admin, given only a Tenant B payroll run's id, received `status=200`
with Tenant B's real summary totals (gross/net pay and related figures for a
synthetic Tenant B fixture; exact figures withheld per this file's own
no-real-financial-data policy). This is the exact same defect shape already
found and repaired on `GET /api/workers/:id/ytd-taxes` (PR #85) — an id-only
fetch with no ownership comparison at either layer.

**Recommended minimal repair** (not implemented in this branch): the same
ownership-guard shape used on the already-repaired
`GET /api/workers/:id/ytd-taxes` — fetch the run, compare `run.companyId` to
the acting non-platform user's `companyId`, return an identical 404 for a
foreign run id as for a nonexistent one (avoid an existence oracle), before
calling `getPayrollSummary`.

## Verified defect 2 — `PATCH /api/payroll-runs/:id` allows cross-tenant reassignment via `companyId`

**Severity: high — data integrity, same shape as the already-repaired
`PATCH /api/workers/:id` defect.** The route does check the *existing* run's
company before allowing an update:

```ts
const existing = await storage.getPayrollRun(req.params.id as string);
if (!existing) return res.status(404).json({ message: "Payroll run not found" });
const isTenant = !isPlatformUser(actingUser?.role) && !!actingUser?.companyId;
if (isTenant && existing.companyId !== actingUser!.companyId) {
  return res.status(403).json({ message: "Forbidden: payroll run belongs to a different company" });
}
```

— so a Tenant A admin cannot reach a Tenant B run directly by id (case 2 of
this route's matrix: **PASS**). But the update itself,
`storage.updatePayrollRun(id, req.body)` (`server/storage.ts:1564`), applies
`req.body` verbatim with no field allowlist and no check that a
client-supplied `companyId` matches the existing row. Verified directly: a
Tenant A admin, editing their own run (an id they legitimately own),
included `companyId: <Tenant B's id>` in the same PATCH body as an ordinary
field edit, and the run's `company_id` column changed to Tenant B —
reassigning their own payroll run out of their own tenant. Restored
immediately by the test after detection.

**Recommended minimal repair** (not implemented in this branch): the same
`companyId`-immutability guard already applied to `PATCH /api/workers/:id` —
treat `companyId` as immutable through this endpoint for every caller (no
platform-owner exception), reject before any mutation if the request tries
to change it.

## Verified defect 3 — `PATCH /api/invoices/:id` has no company-ownership check at all

**Severity: high — any admin/manager, arbitrary cross-tenant invoice
mutation.**

```ts
app.patch("/api/invoices/:id", requireAuth, requireRole("admin", "manager"), blockDemoWrites, async (req, res) => {
  const { lineItems, ...invoiceData } = req.body;
  const r = await storage.updateInvoice(req.params.id, invoiceData);
  ...
});
```

No fetch-and-compare of any kind — `storage.updateInvoice(id, data)`
(`server/storage.ts:3172`) updates any invoice row by id, applying the body
verbatim (`db.update(invoices).set({ ...data, ... })`). Verified directly: a
Tenant A admin changed a Tenant B invoice's `notes` field (and, by the same
code path, any other field including amounts, status, or dates) by id alone.

**Recommended minimal repair** (not implemented in this branch): fetch the
existing invoice, compare its `companyId` to the acting non-platform user's
`companyId`, 403 on mismatch, before calling `updateInvoice`.

## Verified defect 4 — `DELETE /api/invoices/:id` has no company-ownership check at all

**Severity: high — same root cause as defect 3, destructive.**

```ts
app.delete("/api/invoices/:id", requireAuth, requireRole("admin", "manager"), blockDemoWrites, async (req, res) => {
  await storage.deleteInvoice(req.params.id);
  res.json({ message: "Deleted" });
});
```

`storage.deleteInvoice(id)` (`server/storage.ts:3176`) deletes by id alone.
Verified directly: a Tenant A admin permanently deleted a Tenant B invoice
(and its line items) by id, with no ownership check anywhere in the path.

**Recommended minimal repair** (not implemented in this branch): the same
fetch-and-compare guard as defect 3, before calling `deleteInvoice`.

## Verified defect 5 — `POST /api/contractor-invoices/:id/mark-paid` has no company-ownership check at all

**Severity: high — payment-state mutation, not just a read.**

```ts
app.post("/api/contractor-invoices/:id/mark-paid", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const inv = await storage.getContractorInvoice(req.params.id);
  if (!inv) return res.status(404).json({ message: "Not found" });
  if (inv.status !== "approved") return res.status(400).json({ message: "Only approved invoices can be marked paid" });
  const updated = await storage.updateContractorInvoice(req.params.id, { status: "paid", paidAt: new Date(), ... });
  ...
});
```

`storage.getContractorInvoice` (`server/storage.ts:3016`) is an id-only
lookup; nothing in this handler ever compares `inv.companyId` to the acting
user's company. Verified directly: a Tenant A admin changed a Tenant B
contractor invoice's status from `approved` to `paid` (and set a payment
reference/amount) by id alone. This also triggers a downstream
notification/email attempt using the fetched invoice's own contractor —
confirmed this attempt fails safely in the disposable test environment (no
SMTP/Twilio credentials configured; verified no outbound network call is
attempted, consistent with the SMTP short-circuit already covered by
`tests/documenso-log-redaction.test.ts`-adjacent SMS/email safety tests), so
it does not itself leak data beyond the status/paidAt mutation already
demonstrated.

**Recommended minimal repair** (not implemented in this branch): the same
fetch-and-compare guard as defects 3/4, before calling
`updateContractorInvoice`.

## `POST /api/contractor-trade-compensation/:id/approve` — confirmed PASS

Route source already shows an explicit guard:

```ts
if (!(await canAccessCompany(user!, credit.companyId))) return res.status(403).json({ message: "Access denied" });
```

Verified directly: a Tenant A admin's attempt to approve a Tenant B
trade-compensation item returned 403 and left the row's `approved_at`
unchanged. No change needed.

## `GET /api/dam-documents/:id` — confirmed PASS

Route source already shows explicit ownership checks (admin path via
`canAccessCompany`, non-admin path via a match against the document's
`worker_id`/`related_contractor_id`). Verified directly: a Tenant A admin's
read of a Tenant B document returned a rejection with no document body; a
same-tenant employee correctly linked to their own worker record, reading a
company-owned (not their own) document, was also correctly rejected. No
change needed. (See the note above about this route's one false-positive
fixture-artifact iteration during test development.)

## Verified defect 6 — `PATCH /api/companies/:id` has no company-ownership check at all

**Severity: highest in this batch — arbitrary cross-tenant company-record
mutation, not just a read or a subordinate-record mutation; this is the
tenant's own root record.**

```ts
app.patch("/api/companies/:id", requireRole("admin", "manager"), async (req, res) => {
  const data = { ...req.body };
  ...
  const company = await storage.updateCompany(req.params.id as string, data);
  ...
});
```

There is no comparison anywhere in this handler between `req.params.id` and
the acting user's own `companyId` — `requireRole("admin", "manager")` alone
gates it, and that role check succeeds for an admin/manager in *any* tenant,
not just the one being targeted. `storage.updateCompany(id, data)`
(`server/storage.ts:1116`) applies the body verbatim
(`db.update(companies).set(data)`). Verified directly: a Tenant A admin
changed Tenant B's company `name` by targeting Tenant B's own company id
directly — no Tenant B session or membership of any kind was required.
Restored immediately by the test after detection. Because `updateCompany`
applies the body verbatim, this is not limited to `name` — any company-level
field (billing/subscription fields, timezone, `nextCheckNumber`, etc.) is
equally reachable.

**Recommended minimal repair** (not implemented in this branch): compare
`req.params.id` to the acting non-platform user's own `companyId`, 403 on
mismatch, before calling `updateCompany` — the same shape as the ownership
guards already present on `PATCH /api/workers/:id` and
`PATCH /api/payroll-runs/:id`, applied here for the first time since this
route currently has none at all.

## What was NOT found

- No cross-tenant leak on `DELETE /api/payroll-runs/:id`,
  `POST /api/contractor-trade-compensation/:id/approve`, or
  `GET /api/dam-documents/:id` — all three have a working ownership guard,
  confirmed by live cross-tenant attempts, not just by reading the source.
- Missing-authentication (401) and same-tenant unauthorized-role (403) were
  correctly enforced on every one of the nine routes.
- No SQL, stack trace, or internal-ID-beyond-the-submitted-value leakage was
  observed in any error response reviewed.

## Cleanup verification

Every run deletes the two synthetic companies and everything transitively
referencing them (via the same generic FK-aware cascade used by batch 1 —
see `scripts/cross-tenant-negative-tests/cascade-cleanup.ts`), then
independently re-queries for the same root ids and every directly
referencing table to confirm zero rows remain. A representative run's
cleanup line:

```
Cleanup verified: zero synthetic rows remain. Deleted: contractor_invoices(2), invoices(1), payroll_summaries(2), payroll_runs(2), workers(3), companies(2)
```

## Deferred follow-ups (not started in this branch)

1. A narrow hardening branch fixing all six verified defects above, each
   accompanied by turning today's `FAIL` into a permanent regression `PASS`
   in this same test file — the same pattern
   `saas/phase0.5-worker-tenant-hardening` (PR #85) used for batch 1.
2. Extending this same real-server/real-session test pattern to further
   `needs-runtime-hardening` (430) and `unresolved` (224) routes from the
   Phase 0.5r trace, prioritized by the same manifest — payroll/tax and
   payment/invoice routes not yet covered by batch 1 or batch 2 remain the
   largest concentration of high-confidence candidates.
3. Re-running the storage-scope trace after any hardening branch lands, to
   confirm the manifest's classification for these nine routes updates
   accordingly.

No exploitation steps, real tenant identifiers, credentials, or production
data are included in this document — every id and figure above belongs to a
synthetic fixture created and destroyed within a single disposable-database
test run.
