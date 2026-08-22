# Phase 0.5-A — CI and Test-Baseline Stabilization: Audit and Manifest

**Status:** Implemented (this PR). Scope: CI/test-baseline audit and wiring only — no signup, CSRF, Stripe, demo, or tenant-authorization code changed, per the Phase 0.5 plan (`phase-0.5-launch-security-plan.md`) and this workstream's explicit authorization.
**Evidence basis:** every test file in `tests/` and `server/__tests__/` was actually executed in this session — first with no database configured, then a second pass for DB-dependent files against a genuinely disposable local PostgreSQL database (created, used, and dropped entirely within this session; never staging or production). No staging/production system, live database, or external service (Stripe/Documenso/Twilio/SMTP) was touched at any point.

---

## 1. Root cause: why GitHub CI is green while running the suite locally shows failures

GitHub Actions' `test` job (`.github/workflows/ci.yml`, prior to this PR) ran exactly **one** file:

```yaml
- name: Run tests
  run: npx tsx server/__tests__/api-json-guard.test.ts
```

The other **69** test files (65 in `tests/`, 4 more in `server/__tests__/`) were never invoked by CI at all — not skipped, not failing, simply never executed. "Green CI" therefore only ever meant "this one file's 21 assertions pass," not "the test suite passes." Running the full 70-file inventory directly in this session (`npx tsx <file>` per file, matching the project's existing per-file convention) produced **8 real failures** even with zero database or external service configured, for four distinct, unrelated reasons (§3). This is the exact discrepancy the audit was asked to resolve — this document is that resolution.

---

## 2. Suite definitions

Four new named suites, wired via `scripts/test-suites.json` (machine-readable) + `scripts/run-tests.ts` (runner) + `package.json` scripts. Full per-file classification is in §4.

| Suite | Command | Files | Blocks merge (this PR) | Prerequisites |
|---|---|---|---|---|
| `required` | `npm run test:required` | 57 | **Yes** — wired into `ci.yml`'s `test` job | None. No DB, no network, no external service. |
| `db` | `npm run test:db` | 5 | No | `TEST_DATABASE_URL` pointing at a disposable database. Skips explicitly (exit 0, visible message) when unset — never a silent pass. |
| `e2e` | `npm run test:e2e` | 0 | No | None defined yet — no Playwright/Cypress/Puppeteer dependency exists in `package.json`. Suite is defined now so future browser tests have a named home. |
| `external` | `npm run test:external` | 0 | No | None defined yet — no test file was found to require a real Twilio/Documenso/Stripe/SMTP call (§4.4). Suite defined for future use. |
| `live` | `npm run test:live` | 0 | No | Manual invocation only, never in ordinary PR CI. No automated files today. |

**CI continues to run**, unchanged in intent, now including the full deterministic suite: `build`, `typecheck` (still advisory, `continue-on-error: true` — unchanged, out of this PR's scope), `repo-audit`, and `test` (now `npm run test:required`, 57 files instead of 1).

**Why `db` is not wired into required CI yet:** GitHub Actions' hosted runners have no Postgres service configured in `ci.yml` today. Adding one is a real, separate scope decision (a `services:` block, secret/connection wiring, and a decision on how long a service-container-backed job should run) that this PR does not make unilaterally — it is called out as a specific, ready-to-scope follow-up in §6, not silently deferred.

---

## 3. The 8 failures found running the full suite with no database configured

| File | Symptom | Root cause | Category |
|---|---|---|---|
| `tests/cloudpanel-deployment-workflows-static.test.ts` | `AssertionError` at the port/health-check line | **Two separate issues, found by reading the assertion against current `origin/main`, not by running the test twice.** (a) A stale assertion — `deploy-app.yml`'s `DEPLOY_PORT`/`STAGING_PORT` env vars were renamed to a single `APP_PORT` in a since-landed refactor; the underlying safety property (staging health-checks itself locally on port 8010, no production-port fallback) is unchanged. **Fixed in this PR** (§5). (b) After fixing (a), the *next* assertion in the same file fails for a real reason — see §6, deferred finding D4. | 6 (stale, partially fixed) + 7 (real defect, deferred) |
| `tests/production-deploy-safety-static.test.ts` | `AssertionError`: "production workflow checks out exact existing tag refs and rejects branches" | **Real defect**, not stale. `.github/workflows/deploy-production.yml`'s inline deploy script does `git checkout --force "$RELEASE_TAG"` with no `refs/tags/` prefix and no `git rev-parse -q --verify` existence check beforehand — unlike the more hardened, but currently **unused**, `scripts/deploy-paylink.sh` (confirmed via `grep`: no workflow references it), which does exactly what this test expects. See §6, deferred finding D1. | 7 (real product defect) |
| `tests/documenso-resend-self-heal-static.test.ts` | `Error: FAIL: live recipient id resolution prefers token then id then recipientId` | The exact string the test looks for (`r?.token ?? r?.id ?? r?.recipientId`) no longer exists; the current code (`server/routes.ts`, two call sites) resolves `id` as `id → recipientId` and keeps `signingToken` as a **separate** field, not merged into the same priority chain. This could be an intentional, correct refactor (cleaner separation of "token" from "id") or could be a dropped self-healing fallback — determining which requires tracing how `signingToken` vs `id` are each consumed downstream, which this pass did not complete. **Not touched in this PR** — see §6, deferred finding D2. | 6 (likely stale, unconfirmed) |
| `tests/developer-diagnostics-static.test.ts` | 2 of 22 assertions fail: "App Doctor PR failure marks pr_creation_failed" / "...returns non-raw 500 payload" | **Real defect**, confirmed by reading the full route handler (`server/routes.ts`, `POST /api/app-doctor/repair-tickets/:id/create-pr`). The "credentials not configured" failure path correctly sets `status = 'pr_creation_failed'` and returns a structured `503` with retry guidance — but the **separate** "GitHub API call actually failed at runtime" path falls through to a generic `catch` that returns a bare `res.status(500).json({ message: ... })`, never updates the ticket's status, and never provides retry guidance. The "Retry PR Creation" UI button (gated on `status === "pr_creation_failed"`) never appears for this failure mode. See §6, deferred finding D3. | 7 (real product defect) |
| `tests/contract-conversion-email.test.ts` | `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string` | Needs a real database; connects via bare `process.env.DATABASE_URL` with **no presence check and no graceful skip** (unlike the 5 files in the `db` suite, which all guard on `TEST_DATABASE_URL` explicitly). Confirmed **not** stale and **not** a product defect: re-run against a genuinely disposable database in this session, it **passes 8/8 cleanly** (§7). | 2 (needs DB) + 8 (missing safety guard) |
| `tests/contractor-branding.test.ts` | Same SASL error | Same root cause (bare `DATABASE_URL`, no guard). Re-run against the disposable database, most assertions pass, but it fails at a step expecting a pre-seeded global template row ("Detailed Scope Proposal") that is created by the **app server's own startup seed logic**, not by `drizzle-kit push` alone (§7). Needs the same safety guard **and** a documented dependency on app-boot seeding, not just schema. | 2 (needs DB) + 8 (missing guard + fixture dependency) |
| `tests/contractor-templates.test.ts` | Same SASL error | Same root cause. Re-run against the disposable database, fails on `column "layout_variant" does not exist` — a **second, independently confirmed instance** of the schema-drift pattern Phase 0's `architecture.md §2a` already flagged (columns added only via raw `ALTER TABLE IF NOT EXISTS` in `server/index.ts`, never tracked in `shared/schema.ts`, so `drizzle-kit push` never creates them). See §6, deferred finding D5, and §7. | 2 (needs DB) + 8 (guard) + evidence for an existing Phase 0 finding |
| `tests/security.test.ts` | `TypeError: fetch failed` / `ECONNREFUSED` to `http://localhost:5000` | Needs a live local server (which itself needs a database) and has no graceful "server not running" skip. **Actually run** against a live local server backed by the disposable database in this session — **passes 57/57**, including the full cross-tenant "Tenant Isolation — SOC 2 CC6.3" section (§7). This is the one real IDOR regression test Phase 0's `gap-analysis.md` flagged as un-gated; it is now independently confirmed passing, not just present. | 2 (needs DB + live server) |

None of these 8 files were deleted, disabled, or had assertions weakened. One (`cloudpanel-deployment-workflows-static.test.ts`) had its one genuinely-stale line corrected, in the manner explicitly authorized for this PR (§5). The rest remain exactly as they were, excluded from `required` with a documented reason, pending their own small follow-up PRs.

---

## 4. Full classification (all 70 files)

### 4.1 Category 1 — deterministic required unit/static test (57 files, all in the `required` suite)

The full list is in `scripts/test-suites.json` under `suites.required.files` (single source of truth — this document does not duplicate it to avoid drift). All 57 were run with **no** `DATABASE_URL`/`TEST_DATABASE_URL`/`TEST_SERVER_URL` and **no** network access; all 57 pass. This includes every `*-static.test.ts` file (source/config assertions only — confirmed by direct inspection that each reads local files via `fs.readFileSync` and asserts string content, never opens a socket) and every plain-named file confirmed self-contained by direct inspection, including `tests/twilio-sms-webhooks.integration.test.ts` — despite its name, it boots its own ephemeral local HTTP server and mocks every I/O callback (`saveInboundSms`, `updateSmsConsent`, etc.); it makes no real Twilio API call.

### 4.2 Category 2 — disposable-PostgreSQL integration test (9 files)

- **5 properly guarded** (the `db` suite, §2): `tests/contractor-invoice-exactly-once-db.test.ts`, `tests/worker-create-payrate-null-db.test.ts`, `tests/contractor-contract-email-projection-db.test.ts`, `tests/proposal-send-idempotency-db.test.ts`, `tests/worker-create-invoiced-contractor-http.test.ts`. Each independently: requires `TEST_DATABASE_URL`; refuses to run if `TEST_DATABASE_URL` equals the process's own `DATABASE_URL`; parses and refuses staging/production-shaped host/db names; verifies `current_database()` after connecting; skips explicitly and visibly (exit 0) when unset. This is genuine prior art already in the codebase — the new `db` suite reuses it rather than reinventing it.
- **3 unguarded** (`contract-conversion-email.test.ts`, `contractor-branding.test.ts`, `contractor-templates.test.ts`) — see §3, §6 D5, §7.
- **1 hybrid** (`security.test.ts`, needs a live local server on top of a database, no guard) — see §3, §7.

### 4.3 Category 3 — browser/end-to-end test (0 files)

No Playwright/Cypress/Puppeteer dependency exists in `package.json`. The `e2e` suite is defined and empty, not omitted.

### 4.4 Category 4 — external-integration test (0 files)

Every plain-named file referencing Documenso/Twilio/SMS was inspected for outbound calls to a real provider (`fetch`/`axios`/`http.request` to `*.documenso.com`, `api.twilio.com`, etc.) — none found. The `external` suite is defined and empty, not omitted.

### 4.5 Category 5 — live-environment/manual acceptance test (0 automated files)

The `*-static.test.ts` files named after deployment concerns (`cloudpanel-deployment-workflows-static`, `deployment-validation-static`, `production-deploy-safety-static`, `staging-deployment-static`, `mypaylink-nginx-signing-static`, `urgent-production-fixes-static`, `deploy-app-workflow-static`, `deploy-version-propagation-static`) are **static source-file assertions** (they `fs.readFileSync` the workflow YAML / nginx config / docs and assert string content) — confirmed by direct inspection, zero network calls. They belong in `required` (category 1), not here. The `live` suite is reserved for a genuinely live-endpoint acceptance check, none of which exist as automated files today.

### 4.6 Category 6 — stale or invalid test (2 files)

`cloudpanel-deployment-workflows-static.test.ts` (one line fixed, §5; a second, later assertion in the same file reveals a real defect, §6 D4) and `documenso-resend-self-heal-static.test.ts` (§3, §6 D2 — not confidently provable stale without deeper tracing; left untouched).

### 4.7 Category 7 — real product defect (2 files, 3 findings including D4)

`production-deploy-safety-static.test.ts` (§6 D1), `developer-diagnostics-static.test.ts` (§6 D3), and the second assertion in `cloudpanel-deployment-workflows-static.test.ts` (§6 D4). None fixed in this PR — see §6 for proposed follow-up branches.

### 4.8 Category 8 — missing fixture/migration (4 files, plus a reinforced existing finding)

`contract-conversion-email.test.ts`, `contractor-branding.test.ts`, `contractor-templates.test.ts` (missing `TEST_DATABASE_URL` guard), `security.test.ts` (missing "server not running" guard). `contractor-templates.test.ts`'s failure against a real disposable database additionally reinforces Phase 0's already-documented schema-drift finding (`architecture.md §2a`) with a second, independently confirmed instance (`contractor_templates.layout_variant`) — see §6 D5.

### 4.9 Category 9 — infrastructure/environment failure (0 files)

No failure in this pass was attributable purely to this sandboxed audit environment as opposed to a real, universal gap. The SASL errors in §3 look environment-specific at first glance but resolve to a real, portable root cause (no `TEST_DATABASE_URL` guard) confirmed by successfully running the same files against a real disposable database.

### 4.10 Duplicate tests

No exact-duplicate test files were found. Several `-static`/`-db` pairs test the same feature from two angles by design (e.g., `contractor-invoice-exactly-once-static.test.ts` + `contractor-invoice-exactly-once-db.test.ts`; `documenso-resend-behavior.test.ts` + `documenso-resend-static.test.ts` + `documenso-resend-self-heal-static.test.ts`) — complementary, not duplicated.

### 4.11 Tests that mutate shared databases

None, by construction. Every category-1 file needs no database at all. Every category-2 file either requires an explicit `TEST_DATABASE_URL`/`TEST_SERVER_URL` that is checked against staging/production-shaped names before any write (the 5 already-guarded files), or is excluded from every suite pending that same guard being added (the 4 unguarded files, §6).

---

## 5. Stale-test fix applied in this PR

`tests/cloudpanel-deployment-workflows-static.test.ts`: one assertion updated to match `deploy-app.yml`'s current `APP_PORT` variable name (previously `DEPLOY_PORT`/`STAGING_PORT`), after independently confirming against current `origin/main` that the safety property itself — staging health-checks itself locally on port 8010, with no production-port fallback — is unchanged, only the variable name changed. No product code was modified to satisfy this test; the test was corrected to match already-verified current behavior. The file's *next* assertion still fails, for an unrelated, real reason (§6 D4) — it remains excluded from `required`.

---

## 6. Deferred defects — not fixed in this PR, proposed follow-ups

| ID | Finding | Evidence | Proposed branch |
|---|---|---|---|
| D1 | `deploy-production.yml`'s inline deploy script checks out `$RELEASE_TAG` with no `refs/tags/` prefix and no existence check, unlike the more hardened (but currently unreferenced by any workflow) `scripts/deploy-paylink.sh`. A `release_tag` input of `main` would check out the branch directly; only an indirect version-string mismatch check (comparing the checked-out `package.json` version against the tag) prevents the build from proceeding — not an explicit tag-only guard. | `.github/workflows/deploy-production.yml` (inline script, no `git rev-parse -q --verify "refs/tags/..."`), vs. `scripts/deploy-paylink.sh:133` (has it, but is dead code) | `saas/phase0.5-a2-deploy-tag-enforcement` |
| D2 | `documenso-resend-self-heal-static.test.ts` describes a token-first id-resolution priority that no longer matches `server/routes.ts`'s current two-field (`signingToken` separate from `id`) design. Not yet confirmed whether this is an intentional, safe refactor or a dropped self-healing fallback. | `server/routes.ts` (recipient-id resolution, two call sites) | `saas/phase0.5-a3-documenso-resend-trace` (investigation first, fix or test-update second) |
| D3 | App Doctor's `POST /api/app-doctor/repair-tickets/:id/create-pr` only sets `status = 'pr_creation_failed'` and returns retry guidance when GitHub credentials are *missing*; a real GitHub API failure (rate limit, network error, branch conflict) falls through to a bare `500` with no status update and no retry UI trigger. | `server/routes.ts` (`create-pr` route, `catch` block) | `saas/phase0.5-a4-app-doctor-pr-failure-handling` |
| D4 | `deploy-app.yml` no longer verifies the public `https://staging.mypaylink.app/health` endpoint after deploying — only the internal `http://127.0.0.1:${APP_PORT}/health` loopback check remains. This is a real, if narrow, deploy-observability gap (an app process can be "up" locally while nginx/DNS/TLS routing to it is broken, and this workflow would not detect that). | `.github/workflows/deploy-app.yml` (no `staging.mypaylink.app/health` string anywhere in the file) | `saas/phase0.5-a5-staging-public-health-check` |
| D5 | `contractor_templates.layout_variant` is added only via raw `ALTER TABLE IF NOT EXISTS` in `server/index.ts:3114`, not tracked in `shared/schema.ts` — a second, independently confirmed instance of the schema-drift pattern already flagged in the merged Phase 0 `architecture.md §2a` (`grace_period_end`, `agreement_signed_at`, `contractor_proposals.share_token` were the first three). Recommend folding into the *existing* Phase 1 schema-drift cleanup item rather than opening a new one. | `server/index.ts:3114`, confirmed by a real `drizzle-kit push` producing a database missing this column | *(add to existing Phase 1 schema-drift item, no new branch needed)* |

None of D1–D5 touch this PR's diff. None require a schema, application-code, or GitHub Actions change to land this PR.

---

## 7. Disposable-database validation (this session)

A dedicated database (`phase05_ci_audit_<timestamp>`) was created on a **local, non-production, non-staging** PostgreSQL cluster already present in this environment (`paylink_dev` cluster, port 5434 — separate from the VPS-hosted staging/production databases described in Phase 0's `architecture.md`), owned by a freshly created, single-purpose role. `current_database()` was verified before any write. `drizzle-kit push` populated the schema; the app server was then booted once (`NODE_ENV=development`, pointed only at this disposable database, no Stripe/Documenso/Twilio credentials configured — both integrations logged a clean "not configured, skipped" and made zero outbound calls) to run its own startup auto-migration and dev-seed logic.

Against this environment:
- The 4 `-db.test.ts` files: 3 pass cleanly; `contractor-invoice-exactly-once-db.test.ts` passes its 6 real assertions but its **own** cleanup routine hits a foreign-key violation deleting a `workers` fixture row still referenced by an untracked `contractor_invoices` row — the delete *order* is correctly designed (invoices → contracts → proposals → workers → companies) but at least one test case doesn't register a created invoice's ID into the tracked cleanup list. This means the test does not currently achieve "zero residue" against a real database. Not fixed in this PR (test-fixture code, small and well-scoped) — recommend `saas/phase0.5-a6-invoice-test-cleanup-fix` as a follow-up.
- `proposal-send-idempotency-db.test.ts` fails on a missing `share_token` column — the same schema-drift pattern as D5 (`server/index.ts:3205`, not in `shared/schema.ts`).
- `contract-conversion-email.test.ts` passes 8/8 cleanly.
- `contractor-branding.test.ts` and `contractor-templates.test.ts`: see §3/§6.
- `tests/security.test.ts` — the one real cross-tenant IDOR regression test flagged in Phase 0's `gap-analysis.md §9` as "not CI-gated" and never run in that audit — **passes 57/57**, including the full "Tenant Isolation — SOC 2 CC6.3" section (worker read/list/export/anonymize denial across companies, payroll-run scoping, audit-log isolation). This does not close T5's "coverage unverified at scale" finding — it is still exactly one test file, covering workers/payroll/audit-log resources, not the full route surface — but it upgrades the audit's confidence from "static review only, never executed" to "executed once, against a real disposable database and live local server, and it passes."

**Cleanup:** the app server process was killed, all database connections to the disposable database were terminated, and the disposable database and its role were both dropped entirely. A post-cleanup `\l` listing confirms only the pre-existing `paylink_dev`, `postgres`, `template0`, `template1` databases remain — zero residue. No staging or production system was reachable from, or contacted by, this session at any point.

---

*Companion to `phase-0.5-launch-security-plan.md`. This document is the Phase 0.5-A deliverable; §1–§4 (signup, Stripe, demo, tenant-isolation) remain unauthorized and unstarted, per the explicit scope of this PR.*
