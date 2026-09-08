# App Doctor — issue revalidation / refresh / archive (migration 0023)

Lets an existing App Doctor issue be **re-checked against the currently deployed
app**, its review content **refreshed** if still valid, or **archived** (never
hard-deleted) if it no longer reproduces — so the active issue window clears
itself instead of accumulating stale tickets.

## Endpoints (all `requireAuth` + `requireRole("admin","manager")` — unchanged approval bar)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/app-doctor/reports/:id/revalidate` | Revalidate one issue. Non-platform callers may only target a report in their own company. |
| POST | `/api/app-doctor/reports/revalidate-active` | Revalidate up to 25 active issues for the caller's company (platform admins may pass `companyId`). |
| GET | `/api/app-doctor/reports` | **Active window** = `archived_at IS NULL` by default. `?includeArchived=true` returns everything (history is never deleted). |

## Evidence collected before refreshing review text (`revalidation_evidence`, JSON)

- **app**: current `version` / `commit` / `environment` (`server/app-metadata.ts`)
- **build asset hashes**: stems in `dist/public/assets` vs. hashes referenced in the report text/stack/context (`extractAssetHashes`)
- **endpoint repro**: read-only `GET` probe of the reported route — **only** `/api/`-prefixed routes on a small safe-prefix allowlist (`/api/health`, `/api/version`, `/api/dashboard/`, `/api/analytics/`, `/api/app-doctor/diagnostics`); frontend paths → `not_applicable`; anything else → `unknown`. Never probes a non-GET route.
- **recent logs**: matches of the error signature in the last 24h of diagnostic logs
- **newer occurrences**: same-fingerprint reports created since the issue's last review
- **scope**: the report's `company_id` / `user_id` (unchanged)

## Decision (`server/app-doctor/revalidation-logic.ts` — pure, unit-tested)

`decideRevalidation(evidence)` → `reproduced | not_reproduced | inconclusive`

1. newer occurrence, OR route probe 5xx, OR recent log match → **reproduced** (keep active, refresh review, `last_seen_at = now`, severity may be *raised* — never lowered)
2. every referenced build asset hash is gone from the current build, no reproduction signal → **not_reproduced**
3. route now responds OK and the build changed since the report, nothing recent → **not_reproduced**
4. otherwise → **inconclusive** (kept active — an issue is never silently archived on ambiguity)

On **not_reproduced**: `archived_at = now`, `archived_by_user_id`, `archived_reason = 'no_longer_reproduces'`, `revalidation_status = 'not_reproduced'`, `status = 'resolved'`. The row stays — `?includeArchived=true` still shows it.

## AI health is tracked separately from issue validity

The refresh step re-runs `analyzeAppDoctorReport`. If the external AI provider
fails, the failure is written to `ai_last_error` / `ai_last_error_at` and the
**local rule-engine review is kept** — `revalidation_status` still reflects
*reproduction*, not AI health. A successful AI call clears `ai_last_error*`. An
AI outage can never archive an issue.

## Schema (migration 0023 — additive `ALTER TABLE … ADD COLUMN IF NOT EXISTS`)

`app_doctor_reports` gains: `last_seen_at`, `last_revalidated_at`,
`revalidation_status`, `revalidation_evidence`, `archived_at`,
`archived_by_user_id`, `archived_reason`, `ai_last_error`, `ai_last_error_at`,
plus a partial index `idx_app_doctor_reports_active … WHERE archived_at IS NULL`.
No backfill, no other table touched, no `DROP`/`DELETE`.

## Rollback

Additive — redeploy the prior tag and leave the columns in place (prior code
ignores them, and it did not filter on `archived_at`, so no issue is hidden).
Destructive column teardown is documented in the migration for disposable DBs only.
