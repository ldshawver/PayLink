# Phase 0.5 — cross-tenant negative tests, batch 5: findings

Companion to [`cross-tenant-batch-5-test-manifest.json`](cross-tenant-batch-5-test-manifest.json)
(machine-readable — regenerated each run of
`tests/cross-tenant-batch-5-routes-db.test.ts`, not committed as a static
artifact since it's a live test result, not a static inventory). This
document is the human write-up of the ten verified findings and the
overall test-matrix result for the twelve routes selected from the
committed [storage-scope-trace manifest](storage-scope-trace-manifest.json)
and manual source reading, following on from batch 1's two
verified-and-repaired findings
([`phase-0.5s-cross-tenant-findings.md`](phase-0.5s-cross-tenant-findings.md),
repaired on `saas/phase0.5-worker-tenant-hardening`, PR #85), batch 2's six
verified-and-repaired findings
([`phase-0.5-batch-2-cross-tenant-findings.md`](phase-0.5-batch-2-cross-tenant-findings.md),
repaired on `saas/phase0.5-cross-tenant-batch-2-hardening`, PR #88), batch
3's nine verified-and-repaired findings
([`phase-0.5-batch-3-cross-tenant-findings.md`](phase-0.5-batch-3-cross-tenant-findings.md),
repaired on `saas/phase0.5-cross-tenant-batch-3-hardening`, PR #89/#90),
and batch 4's sixteen verified-and-repaired findings
([`phase-0.5-batch-4-cross-tenant-findings.md`](phase-0.5-batch-4-cross-tenant-findings.md),
repaired on `saas/phase0.5-cross-tenant-batch-4-hardening`, PR #91/#92).

**Scope boundary:** test-first / audit only. None of the ten findings below
is fixed in this branch. No runtime authorization code changed. All testing
used two synthetic tenants/companies, two synthetic tenant records, and
synthetic platform/tenant user accounts in a disposable Postgres database
— no staging or production data was read, written, or touched. See
[Recovery checkpoint](#recovery-checkpoint-verified-before-this-batch-began)
below for what was verified before this batch began.

**What's different about this batch:** batches 1-4 tested tenant-scoped
business routes (`requireRole("admin"/"manager")` gates). Batch 4's own
deferred-follow-ups section explicitly named the platform-console/audit
surface as "the strongest remaining candidates" for the next batch. This
batch tests that surface directly — routes gated by `requirePlatformRole()`,
`requirePlatformAudit()`, or `requireSuperAdmin()` instead, all accepting a
client-supplied `companyId`/`tenantId`. The result is a different failure
shape than batches 1-4: instead of "any tenant admin can read/write another
tenant's data" (the pattern in every prior batch), this batch's defects are
almost entirely **role-gate breadth** — the platform-console gate
`requirePlatformRole()` treats all seven platform roles (including
`platform_billing`, `platform_sales`, `platform_auditor`, which read as
low-trust/read-only by name) as equally trusted for high-impact mutations
(suspending a tenant, activating billing, overriding commercial gates,
fully provisioning a tenant) — plus one genuine data-shape bug (a
client-supplied `companyId` in a request body silently overriding the
URL's tenant-scoping path segment) and one cross-tenant read leak
(`GET /api/audit-log`) reachable through a role-aliasing side effect this
batch was not expecting going in.

## Recovery checkpoint (verified before this batch began)

Read-only, before any Batch 5 work started:

- PR #92 (`saas/phase0.5-cross-tenant-batch-4-hardening`) is `MERGED` into
  `main`, merge commit `54bed24dd6dd56ffc450d7b29059586ebd5de7e6`.
- `origin/main` HEAD is that same commit.
- `https://staging.mypaylink.app/health` returns `200`, `{"environment":"staging","database":"connected"}`.
- `https://staging.mypaylink.app/api/version` reports `commit: 54bed24d...` — matches the PR #92 merge SHA exactly.
- The `paylink-staging` PM2 process (`pm2` under the `paylinkssh` system
  user) is `online`, `↺ 0` (zero restarts since its post-merge deploy) —
  not crash-looping.
- Production PM2 processes (`paylink`, `paylink-dev`) were not touched by
  this session. `.github/workflows/deploy-production.yml` matches
  `origin/main`'s committed state — no modification was made to it in this
  branch.

Batch 4 was not repeated, its database was not recreated, its commits were
not amended, and its PR was not reopened.

## How this was tested

`tests/cross-tenant-batch-5-routes-db.test.ts` boots the real, unmodified
application server (`server/index.ts`) against a disposable database,
creates two synthetic companies ("Tenant A" / "Tenant B"), two synthetic
top-level `tenants` rows ("Tenant X" / "Tenant Y", each linked to one
company via `tenant_companies`), one tenant-scoped admin session, and four
platform-role sessions (`platform_super_admin`, `platform_admin`,
`platform_billing`, `platform_auditor`) — all obtained through the real
`POST /api/auth/login` route (not a mock) — and exercises each route's
actual authorization logic over real HTTP requests. Every disposition below
reflects what the running server actually did, not an assumption from
reading the source.

## Route selection

Selected from the committed
[storage-scope-trace manifest](storage-scope-trace-manifest.json)
(`disposition: "unresolved"`, `targetReasons: ["client-supplied-companyId"]`
for all twelve — the tracer could not resolve a `storage.*`/inline-db call
inside the handler body to confirm or deny tenant enforcement, in every
case because the handler delegates to a service module the static trace
does not follow) and manual source reading. Prioritized per the recovery
checkpoint's instruction: platform-console/audit routes with parameterized
company IDs first, plus any other route where static tracing could not
prove tenant enforcement.

| Route | Operation | Sensitive data / mutation | Ownership source | Manifest classification | Why selected |
|---|---|---|---|---|---|
| `GET /api/feature-registry/tenant/:companyId` | read | Per-tenant feature-flag override state | `req.params.companyId` | unresolved | Platform-console, parameterized companyId, no resolvable storage call |
| `POST /api/feature-registry/activate` | mutate | Enables/disables a billing-impacting feature for a tenant | `req.body.companyId` | unresolved | Platform-console mutation, client-supplied companyId, no existence check |
| `POST /api/feature-registry/bulk-activate` | mutate (bulk) | Same as above, multiple features at once | `req.body.companyId` | unresolved | Same route family, bulk/aggregate variant |
| `GET /api/provisioning/tenants/:companyId` | read | Commercial-gate + implementation-project status | `req.params.companyId` | unresolved | Platform-console, parameterized companyId |
| `GET /api/provisioning/tenants/:companyId/audit` | read | Tenant provisioning audit trail | `req.params.companyId` | unresolved | Platform-console audit route, parameterized companyId |
| `POST /api/provisioning/tenants/:companyId/retry` | mutate/approve | Can trigger full tenant activation (billing, owner user, seeding) | `req.params.companyId` | unresolved | Platform-console mutation, highest blast radius in this batch |
| `PATCH /api/provisioning/tenants/:companyId/gates` | mutate | Commercial gate fields (agreement/fee/subscription/payment status) | `req.params.companyId` (URL) vs. `req.body` | unresolved | Platform-console mutation; exact "client-supplied companyId reassignment" shape this audit was scoped to find |
| `POST /api/provisioning/event` | mutate/approve | Fires arbitrary provisioning lifecycle events, incl. suspend/activate | `req.body.companyId` | unresolved | Platform-console mutation, highest-impact event types (`tenant.suspended`, `subscription.activated`) |
| `POST /api/platform/audit/contracts/:companyId/sign` | mutate/approve | Marks a tenant's agreement as signed | `req.params.companyId` | unresolved | Platform-audit mutation, positive control (narrow gate) |
| `POST /api/platform/audit/licensing/:companyId/gate-override` | mutate | Overrides a tenant's subscription/licensing status directly | `req.params.companyId` | unresolved | Platform-audit mutation, highest-impact single write in the audit surface |
| `DELETE /api/tenants/:id/companies/:companyId` | delete | Removes a company from a tenant's membership | dual `req.params.id` (tenantId) + `req.params.companyId` | unresolved | Dual tenant-owned identifiers, destructive, positive control (narrow gate) |
| `GET /api/audit-log` | read (list/export) | Cross-tenant authorization-change audit trail | resolved server-side from session, or `req.query.companyId` for super admins | unresolved | Looks narrowly gated (`requireRole("admin","platform_super_admin")`) but role-aliasing widens it — see finding 9 |

**Deliberately excluded from this batch (already covered / not selected):**
`GET /api/feature-registry/log` and `POST /api/tenants/:id/companies` were
read and found to share the exact same gate/defect shape as routes already
included above (#1 and #11 respectively) — omitted to keep this batch
inside the ~8-12 route budget rather than duplicating an already-demonstrated
pattern. `GET /api/provisioning/tenants`, `GET /api/provisioning/templates`,
`GET /api/admin/lifecycle-overview`, `GET /api/tenants`, `GET /api/tenants/:id`,
`GET`/`POST /api/breach-incidents` were read and are legitimately
platform-wide listings with no parameterized companyId, or were not
storage-scope-trace targets at all (`disposition: null` in the committed
manifest) — outside this batch's "accepts a tenant-owned identifier"
selection criterion.

`GET /api/audit-log/export-csv` shares the exact same `resolvedCompanyId`
logic as `GET /api/audit-log` (finding 9 below applies to both, not
independently re-tested to keep the fixture/session count in this file
bounded). The same is true of `platform_support` and `platform_implementation`
for finding 9 — the vulnerable code path is role-alias-driven and identical
for all three roles; only `platform_admin` was exercised directly.

## Result summary

**46 PASS, 10 FAIL (10 distinct verified defects across 8 of the 12 routes
tested), 0 INCONCLUSIVE, 3 EXPECTED GLOBAL, 1 N/A.** Stable across repeated
runs of the disposable-database suite (re-run twice during this batch's
development; identical 46/10/0/3/1 result both times after two test-bug
fixes described in "Test-harness debugging notes" below).

The 3 EXPECTED GLOBAL cases are all platform-console reads/writes correctly
targeting a caller-chosen tenant by design (a platform super admin viewing
or writing a *specific, intentionally chosen* tenant's data is the entire
purpose of these routes) — verified to actually scope correctly to the
chosen tenant (not silently returning/affecting the wrong one), not treated
as a defect. The 1 N/A case documents a test-construction limitation (an
insert-branch code path already covered by an update-branch case that ran
first against the same fixture), not a route behavior.

## Verified defect 1 — `POST /api/feature-registry/activate` writes an orphaned override for a nonexistent companyId

**Severity: low — no cross-tenant exposure (route is already `platform_super_admin`/`platform_admin`-only); a data-integrity gap, not a tenant-isolation break.**

```ts
app.post("/api/feature-registry/activate", requireAuth, requirePlatformRole(), async (req, res) => {
  const isPlatformAdmin = user?.role === "platform_super_admin" || user?.role === "platform_admin";
  if (!isPlatformAdmin) return res.status(403).json({ message: "..." });
  const { companyId, featureKey, enabled, expiresAt, notes } = req.body;
  // featureKey is validated against feature_registry; companyId is not validated against companies
  await db.execute(sql`INSERT INTO feature_overrides (company_id, feature_key, ...) VALUES (${companyId}, ...) ON CONFLICT (...) DO UPDATE ...`);
});
```

`feature_overrides.company_id` carries no foreign-key constraint to
`companies.id` (`shared/schema.ts`), and this handler calls
`storage.getCompany(companyId)` only to look up a display name for the
audit-log row (falling back to the raw id string if not found), never to
validate the target company actually exists. Verified directly: a
`platform_super_admin` request with a random UUID `companyId` (matching no
row in `companies`) returned `status=200` and silently created a
`feature_overrides` row for that nonexistent id. Cleaned up immediately
after detection.

**Recommended minimal repair** (not implemented in this branch): before the
insert, `SELECT 1 FROM companies WHERE id = $1` (or reuse
`storage.getCompany`'s existing lookup as a hard gate, not just a
display-name convenience) and 404 if the target company does not exist.

**Regression acceptance criteria:** a repaired route must (a) still return
`200`/201-shape success for a real `companyId`, and (b) return `404` — with
no `feature_overrides` row written — for a `companyId` matching no row in
`companies`.

## Verified defect 2 — `PATCH /api/provisioning/tenants/:companyId/gates` lets a client-supplied `companyId` in the request body reassign the target row

**Severity: high — a platform user acting through this endpoint on Tenant A's URL can silently move or corrupt Tenant A's commercial-gate row onto a different company, by nothing more than the shape of the request body.**

```ts
app.patch("/api/provisioning/tenants/:companyId/gates", requireAuth, requirePlatformRole(), async (req, res) => {
  const { companyId } = req.params;
  const gate = await storage.upsertTenantCommercialGate(companyId, req.body);
  res.json(gate);
});

// server/storage.ts
async upsertTenantCommercialGate(companyId, data) {
  const existing = await this.getTenantCommercialGate(companyId);
  if (existing) {
    const [updated] = await db.update(tenantCommercialGates)
      .set({ ...data, updatedAt: new Date() })          // <- data.companyId, if present, is included in SET
      .where(eq(tenantCommercialGates.companyId, companyId))
      .returning();
    return updated;
  } else {
    const [created] = await db.insert(tenantCommercialGates)
      .values({ companyId, ...data })                    // <- data.companyId, if present, overrides the explicit companyId
      .returning();
    return created;
  }
}
```

`req.body` is passed through verbatim as `data`. In the update branch
(exercised here — Tenant A already had a gate row from this batch's
fixture setup), `{ ...data, updatedAt }` means a `companyId` key inside the
request body is included in the `SET` clause even though the `WHERE`
clause correctly targets the URL's `companyId` — the row identified by the
URL gets its own `company_id` column overwritten to whatever the body
says. In the insert branch (not independently exercised in this run — see
"Test-harness debugging notes" — but the same override order,
`{ companyId, ...data }`, produces the equivalent bug: the row is created
under the body's `companyId`, not the URL's), the same class of defect
applies.

Verified directly: a `platform_super_admin` session issued
`PATCH /api/provisioning/tenants/<Tenant A id>/gates` with body
`{ companyId: <Tenant B id>, notes: "..." }` — Tenant A's own
commercial-gate row (identified unambiguously by its own `id`, fetched
before and after) had its `company_id` column change from Tenant A's id to
Tenant B's id. Restored immediately after detection.

**Recommended minimal repair** (not implemented in this branch): strip
`companyId` out of `req.body` before calling
`storage.upsertTenantCommercialGate` (the URL path segment is already the
sole intended source of truth), or have `upsertTenantCommercialGate` itself
omit `companyId` from both the insert `values()` and the update `set()`
payload rather than trusting caller-supplied `data` verbatim.

**Regression acceptance criteria:** a repaired route must still accept and
apply every other field in the body (`notes`, `agreementStatus`, etc.), but
a request with `companyId` in the body targeting a URL for a *different*
company must leave the target row's `company_id` column unchanged (still
equal to the URL's `:companyId`) after the request, on both the insert and
update code paths.

## Verified defect 3 — `PATCH /api/provisioning/tenants/:companyId/gates` role-gate breadth: `platform_billing` can mutate any tenant's commercial gates

**Severity: high — a role plausibly scoped to billing-adjacent read access can flip agreement/subscription/payment-method status for any tenant, no narrower check than any-of-seven platform roles.**

`requirePlatformRole()` (`server/routes.ts:306-324`) accepts any of
`platform_super_admin`, `platform_admin`, `platform_sales`,
`platform_implementation`, `platform_support`, `platform_billing`,
`platform_auditor` — with no narrower check on this specific mutating
route (contrast with `POST /api/feature-registry/activate`/`bulk-activate`,
which add an inline `platform_super_admin`/`platform_admin`-only check on
top of the same outer gate). Verified directly: a `platform_billing`
session successfully `PATCH`ed Tenant A's commercial-gate notes,
`status=200`.

**Recommended minimal repair** (not implemented in this branch): add the
same inline narrowing already present on `POST
/api/feature-registry/activate` (`platform_super_admin`/`platform_admin`
only) to this route, and to findings 4/5/10 below, which share the same
gate.

**Regression acceptance criteria:** `platform_billing`, `platform_sales`,
`platform_support`, `platform_implementation`, and `platform_auditor`
sessions must each receive `403` from this route; `platform_super_admin`
and `platform_admin` must continue to receive `200`.

## Verified defect 4 — `POST /api/provisioning/event` role-gate breadth: `platform_billing` can suspend any tenant's subscription

**Severity: critical — a low-trust platform role can unilaterally suspend a paying tenant's account (denial of service against a customer), with no narrower check than any-of-seven platform roles.**

```ts
app.post("/api/provisioning/event", requireAuth, requirePlatformRole(), async (req, res) => {
  const { companyId, event, payload } = req.body;
  const result = await handleProvisioningEvent(companyId, event, payload || {}, "admin");
  res.json(result);
});

// TenantProvisioningService.ts
case "tenant.suspended":
  await db.update(tenantCommercialGates).set({ lifecycleState: "suspended", ... }).where(...);
  await db.update(companies).set({ subscriptionStatus: "suspended" }).where(eq(companies.id, companyId));
  ...
```

No restriction on which `event` string an authenticated platform-role
caller may send, and no inline narrowing beyond the outer
`requirePlatformRole()`. Verified directly: a `platform_billing` session
sent `{ companyId: <Tenant A id>, event: "tenant.suspended" }` and Tenant
A's `companies.subscription_status` flipped from `active_paid` to
`suspended`, `status=200`. Restored immediately after detection.

**Recommended minimal repair** (not implemented in this branch): restrict
the destructive event types (`tenant.suspended`, `subscription.activated`,
`go_live.approved`, and any event that can flip a commercial-gate status
field) to `platform_super_admin`/`platform_admin` only, the same inline
pattern as `POST /api/feature-registry/activate`. Read-only-flavored
events, if any should remain reachable by the broader role set, should be
enumerated explicitly rather than left as "everything not in the narrow
list."

**Regression acceptance criteria:** `platform_billing`, `platform_sales`,
`platform_support`, `platform_implementation`, and `platform_auditor`
sessions must each receive `403` when `event` is one of the
state-mutating types; `platform_super_admin`/`platform_admin` must
continue to succeed.

## Verified defect 5 — `POST /api/provisioning/event` role-gate breadth: `platform_billing` can activate a tenant's commercial subscription gate

**Severity: critical — same route, the inverse direction: a low-trust platform role can flip the exact "subscription paid/verified" gate the commercial-gate model exists to protect, for a tenant that never actually completed that step, bypassing real billing verification.**

Verified directly: a `platform_billing` session sent
`{ companyId: <Tenant B id>, event: "subscription.activated" }` for a
tenant with no pre-existing commercial-gate row —
`getOrCreateGate` silently created one — and
`tenant_commercial_gates.subscription_status` for Tenant B became
`active`, `status=200`.

**Recommended minimal repair** (not implemented in this branch): same as
finding 4 — this is the same route and the same missing inline narrowing,
documented as a separate finding because it is an independently
significant impact (billing-gate bypass, not account suspension) rather
than a second instance of an identical repair.

**Regression acceptance criteria:** covered by finding 4's acceptance
criteria (same route, same repair).

## Verified defect 6 — `POST /api/provisioning/tenants/:companyId/retry` role-gate breadth: `platform_auditor` can fully provision/activate a tenant

**Severity: critical — the single highest-blast-radius finding in this batch: a role named for observation/compliance review can trigger the entire tenant-activation workflow (billing activation, tenant-owner user bootstrap, department/permission seeding, implementation-project creation) for any tenant whose commercial gates already read as passed.**

```ts
app.post("/api/provisioning/tenants/:companyId/retry", requireAuth, requirePlatformRole(), async (req, res) => {
  const { companyId } = req.params;
  const gate = await storage.getTenantCommercialGate(companyId);
  if (!gate) return res.status(404).json({ message: "No provisioning record found for this tenant" });
  const result = await handleProvisioningEvent(companyId, "tenant.provisioning.requested", {}, "admin");
  res.json(result);
});
```

No inline narrowing beyond the outer `requirePlatformRole()` — unlike
`POST /api/feature-registry/activate`/`bulk-activate`, this route has no
`platform_super_admin`/`platform_admin`-only check at all. Verified
directly: with Tenant A's commercial gate pre-set to all four
`signed`/`paid`/`active`/`verified` statuses and `lifecycle_state:
"pending_activation"` (a realistic "gates just passed, awaiting the retry
trigger" state), a `platform_auditor` session's request flipped
`tenant_commercial_gates.lifecycle_state` to `"active"`
(`provisioned_at` set) and wrote new `tenant_provisioning_audit_logs`
rows recording every workflow step (billing activation, owner-user
bootstrap, department seeding, permission-set seeding, implementation
project creation) as completed, `status=200`.

**Recommended minimal repair** (not implemented in this branch): the same
inline `platform_super_admin`/`platform_admin`-only narrowing as findings
3-5, applied here specifically because this route's blast radius (full
tenant activation) is the largest in the batch.

**Regression acceptance criteria:** `platform_billing`, `platform_sales`,
`platform_support`, `platform_implementation`, and `platform_auditor`
sessions must each receive `403`; `platform_super_admin`/`platform_admin`
must continue to trigger provisioning successfully. The existing
`404`-for-nonexistent-companyId behavior (already correct — this route is
the one exception in this batch with a real existence check) must be
preserved.

## Verified defect 7 — `POST /api/platform/audit/contracts/:companyId/sign` reports false success for a nonexistent companyId

**Severity: low — no cross-tenant exposure (route is `platform_super_admin`-only, correctly gated); a misleading audit-trail response, not a security break.**

```ts
app.post("/api/platform/audit/contracts/:companyId/sign", requirePlatformAudit, async (req, res) => {
  const { companyId } = req.params;
  await db.execute(sql`UPDATE companies SET agreement_signed_at = NOW(), agreement_signed_by_user_id = ${userId} WHERE id = ${companyId}`);
  res.json({ success: true, signedAt: new Date().toISOString(), signedByUserId: userId });
});
```

The `UPDATE` is never checked for `rowCount`, and there is no pre-check
that `companyId` exists. Verified directly: a `platform_super_admin`
session signing a random nonexistent `companyId` received
`status=200, { success: true, ... }` despite the `UPDATE` matching zero
rows. Since nothing was actually written, this is not a tenant-isolation
or data-exposure defect — but a platform super admin (or downstream
automation) reading `success: true` has no way to distinguish "the
agreement was actually signed" from "the id was wrong and nothing
happened," which undermines the reliability of this audit surface's own
record of what it did.

**Recommended minimal repair** (not implemented in this branch): check the
`UPDATE`'s `rowCount` (or pre-`SELECT`) and return `404` when it is `0`.

**Regression acceptance criteria:** a repaired route must return `404` for
a `companyId` matching no row in `companies`, and continue to return
`200`/`success:true` with `companies.agreement_signed_at` set for a real
company.

## Verified defect 8 — `POST /api/platform/audit/licensing/:companyId/gate-override` reports false success for a nonexistent companyId

**Severity: low — same shape as finding 7, on the higher-impact licensing-override endpoint; still not a cross-tenant exposure (route is `platform_super_admin`-only, correctly gated, and verified to target only the intended company — see the EXPECTED GLOBAL case in the test matrix).**

Identical pattern to finding 7:
`UPDATE companies SET subscription_status = ..., gate_override_reason = ... WHERE id = ${companyId}`
with no `rowCount` check and no existence pre-check. Verified directly: a
nonexistent `companyId` still returns `status=200, { success: true }`.

**Recommended minimal repair** (not implemented in this branch): same as
finding 7.

**Regression acceptance criteria:** same shape as finding 7's, applied to
this route.

## Verified defect 9 — `DELETE /api/tenants/:id/companies/:companyId` reports false success for a no-op (mismatched-pair) request

**Severity: medium — no cross-tenant deletion occurs (the mismatched pair correctly matches zero rows, verified — Tenant Y's real association survives untouched), but the response gives no signal that nothing happened, and the route's own cache-invalidation side effect fires regardless.**

```ts
app.delete("/api/tenants/:id/companies/:companyId", requireAuth, requireSuperAdmin(), async (req, res) => {
  await db.$client.query(`DELETE FROM tenant_companies WHERE tenant_id = $1 AND company_id = $2`, [req.params.id, req.params.companyId]);
  invalidateTenantCache(req.params.companyId);
  res.json({ ok: true });
});
```

No `rowCount` check before responding, and `invalidateTenantCache` is
called unconditionally — the exact "side effects after rejected/no-op
requests" pattern this audit batch was scoped to look for. Verified
directly: a request naming a real tenant id (Tenant X) together with a
company id that is not actually associated with that tenant (Tenant B,
which belongs to Tenant Y) matched zero rows in `tenant_companies` (Tenant
Y's real association, independently re-queried, was confirmed still
present afterward — no cross-tenant deletion occurred) but the route still
responded `status=200, { ok: true }`.

**Recommended minimal repair** (not implemented in this branch): check
`rowCount` from the `DELETE` and return `404` when it is `0`; skip the
`invalidateTenantCache` call in that case (cache invalidation for a
tenant/company pair that was never actually associated is at best a no-op,
at worst masks a caller's mistaken assumption that something changed).

**Regression acceptance criteria:** a repaired route must return `404` for
a `(tenantId, companyId)` pair matching no row in `tenant_companies`, and
continue to return `200`/`{ ok: true }` and actually delete the row for a
real, matching pair.

## Verified defect 10 — `GET /api/audit-log` leaks every tenant's authorization-audit-log rows to `platform_admin` (and, by the same code path, `platform_support`/`platform_implementation`)

**Severity: critical — the highest-severity *data-exposure* finding in this batch: a real cross-tenant read, reachable by three named platform roles that the route's own `requireRole("admin", "platform_super_admin")` signature appears to exclude.**

```ts
function expandRoleForGuard(role) {
  if (role === "platform_super_admin" || role === "platform_admin" || role === "platform_owner")
    return ["admin", "manager", "supervisor", role];
  if (role === "platform_support" || role === "platform_implementation")
    return ["admin", "manager", role];
  ...
}
function requireRole(...roles) {
  return async (req, res, next) => {
    const effectiveRoles = expandRoleForGuard(user.role);
    if (!roles.some(r => effectiveRoles.includes(r))) return res.status(403)...;
    next();
  };
}

app.get("/api/audit-log", requireAuth, requireRole("admin", "platform_super_admin"), async (req, res) => {
  const currentUser = await storage.getUser(req.session?.userId);
  const isSuperAdmin = currentUser?.role === "platform_super_admin";   // exact-string check, not alias-aware
  const resolvedCompanyId = isSuperAdmin
    ? (companyId as string | undefined)
    : (currentUser?.companyId ?? undefined);
  const result = await storage.getAuthorizationAuditLogsFiltered({ ..., companyId: resolvedCompanyId, ... });
  res.json(result);
});

// server/storage.ts
async getAuthorizationAuditLogsFiltered(opts) {
  if (opts.companyId) conditions.push(eq(authorizationAuditLog.companyId, opts.companyId));
  // no company filter applied at all when opts.companyId is falsy/undefined
  ...
}
```

`requireRole("admin", "platform_super_admin")` looks like it excludes
every other platform role, but `requireRole` expands the caller's role
through `expandRoleForGuard()` first — which aliases `platform_admin`
(along with `platform_support` and `platform_implementation`) to also
carry `"admin"`. All three therefore pass this gate, not just
`platform_super_admin`. Inside the handler, `isSuperAdmin` is an *exact*
string match against `"platform_super_admin"` — so a `platform_admin`
caller is (correctly) not treated as the super-admin branch, and falls to
`resolvedCompanyId = currentUser?.companyId ?? undefined`. But platform-scoped
accounts are required to have `companyId = NULL` (enforced at login,
`server/routes.ts:1584-1590` — "platform-scoped accounts must never have a
companyId"), so `resolvedCompanyId` is *always* `undefined` for these three
roles. `storage.getAuthorizationAuditLogsFiltered` only applies a company
filter `if (opts.companyId)` — `undefined` is falsy, so the query has no
company filter at all, returning **every company's** audit rows.

Verified directly: seeded one `authorization_audit_log` row for Tenant A
and one for Tenant B. A `platform_admin` session's `GET /api/audit-log`
(no `?companyId=` — none was ever needed) returned both rows in a single
response. By contrast, Tenant A's own tenant-scoped `admin` correctly saw
only Tenant A's row, and correctly could not override that scope via
`?companyId=<Tenant B>` (both verified as PASS in the test matrix) —
confirming the leak is specific to the `platform_admin`/`platform_support`/
`platform_implementation` role-alias path, not a general defect in this
route's company-scoping logic.

**Recommended minimal repair** (not implemented in this branch): the
handler's `isSuperAdmin` branch should be `isPlatformRole` (or similar) —
i.e., any of the platform-aliased roles that reach this handler via the
`"admin"` alias should be treated the same as `platform_super_admin` for
the *purpose of the resolvedCompanyId decision* (either always required to
supply an explicit `?companyId=`, or restricted to `platform_super_admin`
only by removing the `"admin"` alias from `expandRoleForGuard` for this
route's guard — the narrower and clearly-intended fix, since a
`platform_support`/`platform_implementation`/`platform_admin` account
having blanket unfiltered access to every tenant's authorization-change
history was very likely never the intent of writing `requireRole("admin",
"platform_super_admin")` in the first place).

**Regression acceptance criteria:** a `platform_admin` (and, sharing the
same code path, `platform_support`/`platform_implementation`) session
issuing `GET /api/audit-log` with no `?companyId=` must not receive rows
from more than one company in a single response — either by requiring an
explicit target company and enforcing platform-role authorization on it,
or by scoping to zero results without an explicit, authorized target.
`platform_super_admin` behavior (either global-with-no-filter, or
global-with-optional-`?companyId=`-filter) must be unchanged. Tenant-scoped
`admin` behavior (force-scoped to own company, verified already correct in
this batch) must be unchanged.

## What was NOT found

- Missing-authentication (`401`) was correctly enforced on every one of
  the twelve routes.
- `requirePlatformAudit` (`POST /api/platform/audit/contracts/:companyId/sign`,
  `POST /api/platform/audit/licensing/:companyId/gate-override`) and
  `requireSuperAdmin` (`DELETE /api/tenants/:id/companies/:companyId`) were
  each verified to correctly exclude every platform role other than
  `platform_super_admin` — two of the three narrowest gates in this batch's
  route set, and the two least-defective routes overall (their only
  findings are the low/medium-severity false-success-on-no-op pattern,
  findings 7-9).
- `POST /api/feature-registry/activate`/`bulk-activate`'s inline
  `platform_super_admin`/`platform_admin`-only narrowing was verified to
  actually work (`platform_billing`/`platform_auditor` correctly received
  `403`) — proof that this repair pattern, recommended for findings 3-6
  above, is already proven correct elsewhere in this same codebase.
- `GET /api/feature-registry/tenant/:companyId`,
  `GET /api/provisioning/tenants/:companyId`, and
  `GET /api/provisioning/tenants/:companyId/audit` were verified to
  correctly scope to the `companyId` in the URL path (switching the path
  segment returns that company's own data, never a different company's) —
  the broad `requirePlatformRole()` gate on these three is a role-gate
  breadth question for a read-only route (documented as `EXPECTED GLOBAL`,
  consistent with platform-console routes being intentionally
  cross-tenant-visible for platform staff), not a tenant-isolation defect.
- No SQL, stack trace, or internal-ID-beyond-the-submitted-value leakage
  was observed in any error response reviewed.

## Test-harness debugging notes (transparency on how this file reached its final form)

Two issues were found and fixed in the test file itself during
development — documented here so a reviewer can distinguish "the app has a
bug" from "the test had a bug that has since been corrected":

1. **Schema-drift workaround, not an app-code fix.**
   `feature_overrides.(company_id, feature_key)` is declared `UNIQUE` only
   inside `server/index.ts`'s own `CREATE TABLE IF NOT EXISTS` bootstrap
   (`server/index.ts:3235-3246`), never in `shared/schema.ts`. A database
   built via `drizzle-kit push` (as this disposable test database is) gets
   a `feature_overrides` table with no such constraint, because the table
   already exists once `drizzle-kit push` runs, making the app's own
   `CREATE TABLE IF NOT EXISTS` a no-op. `POST /api/feature-registry/activate`/
   `bulk-activate` both rely on `ON CONFLICT (company_id, feature_key) DO
   UPDATE`, which requires that exact constraint to exist, or the upsert
   `500`s **for every caller**, masking the actual authorization behavior
   this batch needed to test. This is a distinct instance of the same
   schema-drift class already tracked in
   [`phase-0.5-a-ci-baseline-manifest.md`](phase-0.5-a-ci-baseline-manifest.md)
   (finding D5: constraints/columns added only via raw bootstrap SQL, never
   mirrored in `shared/schema.ts`) — the test file adds the missing
   constraint directly to the disposable test database before running
   (test-infrastructure setup, the same category of action as the
   `drizzle-kit push` that built the schema in the first place; it does
   not touch `server/`, `shared/`, or `storage.ts`). **Recommended follow-up
   (not started here):** fold this into the existing Phase 1 schema-drift
   cleanup item referenced in the CI baseline manifest, rather than opening
   a new one.
2. **Test-assertion bug, not an app bug.** The first draft of finding 6's
   test case used "a new user was created for the target company" as its
   provisioning-succeeded signal. This batch's own shared fixture already
   seeds a tenant admin user for Tenant A before the provisioning-retry
   case runs, so `stepCreateTenantOwner`'s existing-user check correctly
   skipped creating a second one — the app behaved correctly, but the
   test's proxy signal was wrong, and initially reported the case as
   `INCONCLUSIVE`. Fixed by checking `tenant_commercial_gates.lifecycle_state`
   transitioning `pending_activation` → `active` instead (the definitive,
   unconditional signal `runProvisioningWorkflow` sets after every step
   completes) — confirmed via an isolated reproduction script before and
   after the fix that the underlying route behavior (platform_auditor
   fully provisioning a tenant) was unchanged throughout; only the test's
   detection logic was corrected.

## Cleanup verification

Every run deletes the two synthetic companies and everything transitively
referencing them (via the same generic FK-aware cascade used by batches
1-4 — see `scripts/cross-tenant-negative-tests/cascade-cleanup.ts`), then
independently deletes and re-verifies the two synthetic `tenants` rows
(which sit outside the companies-rooted cascade — `tenant_companies.tenant_id`
carries no foreign key, a data-integrity observation noted but out of
scope for this batch's tenant-isolation focus, not separately filed as a
finding above since it does not enable any cross-tenant data exposure by
itself). A representative run's cleanup line:

```
Cleanup verified: zero synthetic rows remain. Deleted: departments(2), integration_events(4), companies(2)
```

No database name resembling production/staging was ever used (refused by
pattern match, both at the `TEST_DATABASE_URL` string level and again via
`SELECT current_database()` after connecting); `DATABASE_URL` was never
read from `server/.env` or any application environment file; the
disposable database and its single-purpose role were dropped immediately
after the final validation run in this batch; the generated password was
never printed to any log, commit, or artifact.

## How this is wired into CI (non-blocking, same precedent as batches 2-4)

`tests/cross-tenant-batch-5-routes-db.test.ts` is registered in
`scripts/test-suites.json` under the `db` suite (`blocksMerge: false`),
alongside the batch 1-4 files it follows. Two independent mechanisms make
this batch's ten verified defects visible without blocking unrelated CI:

1. **The suite itself is non-blocking.** The `db` suite requires
   `TEST_DATABASE_URL` pointing at a disposable database and is documented
   in `scripts/test-suites.json`/`phase-0.5-a-ci-baseline-manifest.md` as
   never included in the required GitHub Actions check until a Postgres
   service container is added to that workflow. `pnpm test:required` never
   runs this file at all.
2. **The file's own exit code is decoupled from its findings.** Following
   the exact precedent set by `tests/cross-tenant-batch-4-routes-db.test.ts`
   (and 2/3 before it), `main()` only sets `process.exitCode = 1` when the
   test *harness itself* fails (the server won't boot, cleanup can't be
   verified) — never when `summary.FAIL > 0`. A verified defect is
   `console.log`ged prominently (`✗ [FAIL] ...`) and written into the
   committed-at-runtime `cross-tenant-batch-5-test-manifest.json`, but it
   does not turn the test file's own process exit code non-zero. This
   means `pnpm test:db` (which runs every file in the `db` suite via
   `spawnSync` and fails only on a non-zero exit code, per
   `scripts/run-tests.ts`) reports this file as passed even when it found
   real defects — intentionally: the finding is surfaced through the
   printed matrix and the JSON manifest, not suppressed, but a
   known-and-tracked defect in an audit-only branch does not block
   unrelated PRs from merging through a suite this repository has already
   decided is advisory, not a gate.

In short: **verified failures are loud (console output + JSON manifest +
this document) but not blocking (process exit code 0, suite excluded from
required CI).** This is the same tradeoff already made and documented for
batches 2-4, applied identically here.

## Deferred follow-ups (not started in this branch)

1. A narrow hardening branch (`saas/phase0.5-cross-tenant-batch-5-hardening`)
   fixing all ten verified defects above, each accompanied by turning
   today's `FAIL` into a permanent regression `PASS` in this same test
   file — the same pattern `saas/phase0.5-cross-tenant-batch-4-hardening`
   (PR #91/#92) used for batch 4. Suggested repair order: findings 4, 5,
   and 6 first (critical — active subscription-suspension/activation and
   full-tenant-provisioning bypass reachable by low-trust platform roles),
   then finding 10 (critical — the only real cross-tenant *data leak* in
   this batch), then finding 3 (high — shares the same repair as 4-6),
   then finding 2 (high — the companyId-reassignment data-shape bug), then
   findings 7-9 (low/medium — false-success-on-no-op responses).
2. Fold the `feature_overrides.(company_id, feature_key)` unique-constraint
   schema drift (see "Test-harness debugging notes" above) into the
   existing Phase 1 schema-drift cleanup item — do not open a new item for
   it.
3. A separate, non-tenant-isolation review of whether `tenant_companies.tenant_id`
   should carry a real foreign-key reference to `tenants.id` (currently a
   bare `varchar`, no `.references()` — noted during cleanup, not filed as
   a tenant-isolation finding since no code path was found that lets a
   caller exploit the missing constraint to read or write another tenant's
   data).
4. Re-running the storage-scope trace after any hardening branch lands, to
   confirm the manifest's classification for these twelve routes updates
   accordingly.

No exploitation steps, real tenant identifiers, credentials, or production
data are included in this document — every id and figure above belongs to
a synthetic fixture created and destroyed within a single
disposable-database test run.
