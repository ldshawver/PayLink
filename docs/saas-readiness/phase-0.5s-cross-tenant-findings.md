# Phase 0.5s — cross-tenant negative tests: findings

Companion to [`cross-tenant-test-manifest.json`](cross-tenant-test-manifest.json)
(machine-readable — regenerated each run of
`tests/cross-tenant-worker-routes-db.test.ts`, not committed as a static
artifact since it's a live test result, not a static inventory). This
document is the human write-up of the two verified findings and the overall
test-matrix result for the five worker routes identified by the
[Phase 0.5r storage-scope trace](phase-0.5r-storage-scope-trace-findings.md).

**Scope boundary:** test-first / audit only. Neither finding below is fixed
in this branch. No runtime authorization code changed. All testing used two
synthetic tenants and synthetic data in a disposable Postgres database — no
staging or production data was read, written, or touched.

## How this was tested

`tests/cross-tenant-worker-routes-db.test.ts` boots the real, unmodified
application server (`server/index.ts`) against a disposable database, creates
two synthetic tenants ("Tenant A" / "Tenant B") each with real authenticated
sessions obtained through the real `POST /api/auth/login` route (not a mock),
and exercises the five routes' actual authorization logic over real HTTP
requests. This is deliberately not a source-reading exercise — every
disposition below reflects what the running server actually did.

## Routes tested

| Route | Source |
|---|---|
| `GET /api/workers` | `server/routes.ts:2161` |
| `POST /api/workers` | `server/routes.ts:2260` |
| `PATCH /api/workers/:id` | `server/routes.ts:2315` |
| `DELETE /api/workers/:id` | `server/routes.ts:2343` |
| `GET /api/workers/:id/ytd-taxes` | `server/routes.ts:7795` |

## Result summary

**19 PASS, 3 FAIL (2 distinct verified defects), 0 INCONCLUSIVE, 3 N/A**
(N/A = a matrix item that doesn't apply to that route's shape — e.g. a list
endpoint has no `:id` to combine with a foreign `companyId`; documented per
case in the manifest, not silently skipped).

Most of the matrix passed — and passed for a reason worth naming explicitly:
`POST`, `PATCH`, and `DELETE /api/workers/:id` each carry an **inline
ownership guard** (`server/routes.ts:2266-2270`, `2317-2326`, `2349-2354`)
that fetches the existing row and compares its `companyId` to the acting
user's `companyId` before allowing the write. None of these use the
`canAccessCompany()`/`assertUserCanAccessCompany()` helpers or
`enforceCompanyScope()` middleware the Phase 0.5-B/0.5r static passes looked
for — which is exactly why all five routes were flagged
`needs-runtime-hardening`/`needs-negative-test` by those passes: the guard is
real, but invisible to source-pattern matching. That limitation was
documented in the 0.5r findings doc before this test ran, and this result
confirms it was the right thing to flag as a blind spot rather than a
default assumption of "unsafe."

## Verified defect 1 — PATCH /api/workers/:id allows cross-tenant reassignment via the update body

**Severity: real gap, narrow trigger.** The ownership guard checks the
*existing* row's `companyId` before allowing the update, but
`storage.updateWorker(id, data)` (`server/storage.ts:1145-1148`) applies the
entire request body verbatim with no field allowlist:

```ts
async updateWorker(id: string, data: Partial<Worker>): Promise<Worker | undefined> {
  const [worker] = await db.update(workers).set(data).where(eq(workers.id, id)).returning();
  return worker;
}
```

A Tenant A admin editing a worker they legitimately own can include
`companyId: <Tenant B's id>` in the PATCH body. The guard only checked the
row *before* the update — it never re-validates what the update itself is
allowed to change. Verified directly: the test PATCHed Tenant A's own worker
with a foreign `companyId` in the body, observed `status=200` and the row's
`companyId` column change to the foreign value, then restored it immediately
as part of the same test run (before cleanup, so the disposable database
never carried the reassigned state past detection).

**What this is not:** this is not a way to *read* another tenant's data by
itself (the guard still blocks accessing a worker you don't already own —
confirmed by cases 2 and 4b, both PASS). It's a way to *move a resource you
already legitimately own* into another tenant's records, which is still a
real tenant-isolation violation (Tenant B would suddenly have a worker row
they never created, and Tenant A would lose one) and a plausible building
block for a more serious attack (e.g. combined with a second account in
Tenant B to hand off data).

**Recommended minimal repair** (not implemented in this branch): strip
`companyId` (and any other tenant-identifying column) from the update body
before calling `storage.updateWorker`, or pass an explicit allowlist of
patchable fields — the same fix shape applies to every other route this
pattern exists on, which is exactly the audit `needs-runtime-hardening`
bucket from Phase 0.5r is for. This route's disposition should be updated in
a follow-up hardening branch, not here.

## Verified defect 2 — GET /api/workers/:id/ytd-taxes has no tenant check at all

**Severity: real gap, broad trigger — any authenticated tenant role.** Unlike
the other four routes, this handler has **no ownership guard whatsoever**:

```ts
app.get("/api/workers/:id/ytd-taxes", requireAuth, requireRole("admin", "manager", "employee"), async (req, res) => {
  const year = parseInt(queryStr(req.query.year) || String(new Date().getFullYear()), 10);
  const worker = await storage.getWorker(req.params.id);
  const ytd = await storage.getEmployeeYTD(req.params.id, year, worker?.companyId ?? undefined);
  res.json(ytd);
});
```

It fetches the target worker by ID alone (no company filter), then calls
`getEmployeeYTD` with the **target worker's own** `companyId` — which does
correctly scope the SQL query, but scopes it to the wrong tenant's benefit:
nothing ever compares that value to the *caller's* company. Verified
directly: a Tenant A admin, given only a Tenant B worker's ID, received
`status=200` with a nonzero `grossPay` figure belonging to a synthetic Tenant
B payroll fixture. The same request repeated with a Tenant A **employee**
session (not admin) produced the identical result — `requireRole("admin",
"manager", "employee")` accepts every tenant role equally, so this is not a
role-model gap (there's no "correctly-scoped for admins, broken for
employees" story here); it's simply a route with zero tenant-membership
check, full stop.

**Recommended minimal repair** (not implemented in this branch): add the same
ownership-guard shape used by `PATCH`/`DELETE /api/workers/:id` — fetch the
worker, compare `worker.companyId` to the acting non-platform user's
`companyId`, 403 on mismatch — before calling `getEmployeeYTD`.

## What was NOT found

- No route in this set allows reading another tenant's worker **list**
  (`GET /api/workers` correctly scopes by session-derived `companyId` for
  non-platform users and ignores a client-supplied `?companyId`, confirmed —
  case 3 PASS).
- `POST`, `PATCH` (read path), and `DELETE` correctly block accessing a
  worker by a foreign ID (cases 2/4b PASS on `PATCH`; case 2 PASS on
  `DELETE`).
- Role enforcement is correct everywhere it exists: `employee` is correctly
  rejected from `POST`/`PATCH`/`DELETE`, and missing authentication is
  correctly rejected (401) on every route tested.
- No SQL, stack trace, or internal-ID-beyond-the-submitted-value leakage was
  observed in any error response reviewed.

## Cleanup verification

Every run deletes the two synthetic companies and everything transitively
referencing them (via a generic FK-aware cascade — see
`scripts/cross-tenant-negative-tests/cascade-cleanup.ts`), then independently
re-queries for the same root ids and every directly-referencing table to
confirm zero rows remain. A representative run's cleanup line:

```
Cleanup verified: zero synthetic rows remain. Deleted: payroll_item_taxes(1), payroll_items(1), workers(4), payroll_runs(1), companies(2)
```

## Deferred follow-ups (not started in this branch)

1. A hardening branch fixing both verified defects above (strip
   tenant-identifying fields from `PATCH /api/workers/:id`'s update body;
   add an ownership guard to `GET /api/workers/:id/ytd-taxes`), each
   accompanied by turning today's `FAIL` into a permanent regression `PASS`
   in this same test file.
2. Extending this same real-server/real-session test pattern to the
   remaining `needs-runtime-hardening` (430) and `unresolved` (224) routes
   from the Phase 0.5r trace, prioritized by the same manifest.
3. Re-running the storage-scope trace after any hardening branch lands, to
   confirm the manifest's classification for these five routes updates
   accordingly.

No exploitation steps, real tenant identifiers, credentials, or production
data are included in this document — every id and figure above belongs to a
synthetic fixture created and destroyed within a single disposable-database
test run.
