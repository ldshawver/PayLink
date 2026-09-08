# SaaS tenant licenses — PR 4 (migration 0022)

Part of the SaaS identity/onboarding cleanup
([architecture](./saas-identity-onboarding-architecture.md)). PRs #121–#125
shipped in v2.2.7. This is PR 4.

## What this adds

An **additive** structured license model — it does **not** replace or refactor
the existing enforcement path.

| Layer | Role |
|---|---|
| `companies.subscription_status` / `trial_start` / `trial_end` / `billing_active` / `grace_period_*` / `gate_override_reason` | **Authoritative access state.** Unchanged by PR 4. |
| `server/tenant-enforcement.ts` `checkTenantGate()` + `requireActiveSubscription` middleware | **Authoritative enforcement.** Unchanged by PR 4 — still reads the `companies` columns only. |
| `tenant_licenses` (new) | Structured record: normalized status vocabulary, explicit plan/type, trial window. One row per company. |
| `tenant_license_events` (new) | Append-only audit: who changed a license, when, from → to, why. |
| `server/licensing/license-resolver.ts` (new, pure) | Display resolver. Precedence: `tenant_licenses` row → `companies` gate columns → legacy-active default. |
| `server/licensing/license-service.ts` (new) | DB reads + `ensureTrialLicense` + `adminUpsertLicense`. |
| `server/licensing/license-gate.ts` (new) | Narrow opt-in gate (see below). |

## Normalized status vocabulary

`trialing` · `active` · `expired` · `suspended` · `cancelled` · `inactive`

`server/licensing/license-service.ts` `STATUS_TO_COMPANY` maps each to the
legacy `companies.subscription_status` spelling
(`trial_active` / `active_paid` / `trial_expired` / `suspended` / `cancelled`).

## Legacy safety

- A company with **no `tenant_licenses` row** resolves via the `companies` gate
  columns, then a legacy-active default. It is **never** locked out by PR 4.
- Migration 0022 runs **no backfill**. Existing production companies get no row.
- `checkTenantGate()` / `requireActiveSubscription` do not read `tenant_licenses`,
  so tenant access is byte-identical whether the tables are present or not.

## The narrow license gate

`requireLicenseNotBlocked` (server/licensing/license-gate.ts) is attached to
**exactly three** non-protected tenant-scoped write routes:

- `POST /api/customers`
- `POST /api/invoices`
- `POST /api/documents`

Rules:

- no `tenant_licenses` row → **pass** (legacy tenants unaffected);
- row present, status ∈ {`expired`, `suspended`, `cancelled`, `inactive`} → **403 `license_blocked`**;
- any other status → pass;
- resolver/DB error → **fail open** (pass).

It is **not** attached to payroll, checks, Documenso, employee login, contractor
access, or the vendor portal — those keep exactly the enforcement they have
today.

## No split-brain on admin mutation

`PUT /api/platform/companies/:companyId/license` (`requirePlatformAdminRole()`)
runs one transaction that:

1. `UPDATE companies SET subscription_status = <mapped>, gate_override_reason = <reason>`
   — identical to the existing `POST /api/platform/audit/licensing/:companyId/gate-override`;
2. upserts the `tenant_licenses` mirror;
3. writes a `tenant_license_events` row;
4. writes an `authorization_audit_log` row (billing/lifecycle convention).

So the authoritative column and the structured mirror always move together.

## Trial onboarding

`POST /api/trial/signup` now inserts a `tenant_licenses` row
(`status='trialing'`, `source='trial_signup'`) inside its existing transaction,
via `ensureTrialLicense` (`ON CONFLICT (company_id) DO NOTHING` — idempotent, no
access change).

## Endpoints

| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/api/license/status` | `requireAuth` | Advisory: the caller's own workspace license (badge data). |
| GET | `/api/platform/licenses` | `requirePlatformAdminRole()` | Every company's resolved license + summary. |
| GET | `/api/platform/companies/:companyId/license` | `requirePlatformAdminRole()` | One company + recent events. |
| PUT | `/api/platform/companies/:companyId/license` | `requirePlatformAdminRole()` | Mutate (see "no split-brain" above). |

`/api/auth/me` also carries an additive advisory `license` object.

## Tests

- `tests/tenant-licenses-resolver.test.ts` (required) — pure resolver: fallback
  precedence, legacy never-blocks, blocking-status → gate blocks.
- `tests/tenant-licenses-wiring-static.test.ts` (required) — migration additive;
  enforcement path untouched; gate on exactly 3 routes and none protected;
  gate fails open; admin mutation keeps `companies` consistent.
- `tests/tenant-licenses-db.test.ts` (db) — schema invariants; unique
  `company_id`; `ON CONFLICT` idempotency; admin-suspend consistency.
- Full HTTP admin / non-admin / cross-company / new-trial / regression flow runs
  as the **staging synthetic acceptance** (as for PR 2 / PR 3).

## Rollback

Purely additive. Preferred: redeploy the prior application tag and **leave 0022
in place** — prior code never reads `tenant_licenses`. Destructive teardown
(`DROP TABLE tenant_license_events, tenant_licenses`) is for disposable test
databases only.
