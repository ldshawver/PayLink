# MyPayLink — Phase 0.5: Launch-Security Stabilization — Planning Report

**Status:** Planning only. No application code, schema, live data, Stripe, environment, or deployment changes were made producing this report.
**Basis:** Findings B1–B6, T1–T6, BL1–BL7, PT1–PT4 from the now-merged Phase 0 docs (`docs/saas-readiness/*.md`, PR #80, squash commit `a016c6a2e3c7bd19ce8034b1e2ae78338a6417dd`), re-cited here with the original evidence.
**Purpose:** Phase 0.5 pulls forward the narrow set of *launch-security* blockers from the full Phase 1–7 program so they can land as small, independently reviewable PRs before the larger control-plane rebuild (Phase 1) begins. It does **not** replace Phase 1–7 — it is a stabilization slice.
**Explicit exclusions (per this program's scope):** no real Stripe Customer/Subscription/charge creation (that remains Phase 3 scope — B4's "build the real billing pipeline" is *not* in 0.5, only its webhook-security prerequisite is); no full impersonation UI/banner (Phase 7b); no full route-by-route tenant-isolation *fix* (Phase 7a) — 0.5 builds the inventory and the reusable fail-closed helper, not a rewrite of all ~37k lines of routes.

---

## 1. Signup and account security

### Findings (re-cited, unchanged from Phase 0)
- **B5** — `POST /api/trial/signup` (`server/routes.ts:23708–23808`) creates a fully active `admin` user in one transactional step with no email-verification step anywhere in the repo.
- New this phase, formalized from architecture.md §9 — the response body returns `temporaryPassword` in plaintext (`server/routes.ts:~23796`), and `signup.html` immediately calls `POST /api/auth/login` with those server-returned credentials (`public-site/public/signup.html:232,255`) — i.e. the browser auto-logs-in using a password the server generated and displayed, rather than the user setting their own.
- **T6** — no CSRF mechanism exists anywhere (`grep -rn "csrf" server/` → zero hits); rate limiting exists only for `/api/admin/diagnostics/*`, absent on `/api/trial/signup`, `/api/auth/login`.
- **PT3** (production-tenancy) — any migration touching `users`/`companies` must preserve existing production rows (including the owner's own real businesses) with zero data loss.

### Proposed branch/PR sequence
| PR | Branch | Scope |
|---|---|---|
| 0.5c | `saas/phase0.5-csrf-ratelimit` | Shared CSRF + rate-limit middleware (infra dependency for 0.5e/0.5f, see §Dependencies) |
| 0.5e | `saas/phase0.5-email-verification` | `email_verifications` table + `verified_at` column on `users`; `POST /api/auth/verify-email`, `POST /api/auth/resend-verification`; new signups start unverified |
| 0.5f | `saas/phase0.5-invitation-signup` | Stop returning `temporaryPassword`; stop client auto-login from signup response; add `password_setup_tokens` table (single-use, expiring); signup creates a *pending* user and issues a setup-link token instead of a usable password |
| 0.5g | `saas/phase0.5-account-migration-backfill` | Additive backfill migration: existing production users get `verified_at = created_at` (grandfathered, not forced to re-verify) so no real user is locked out; preflight/postflight row-count reconciliation |

### Dependencies
- 0.5c must land first — 0.5e/0.5f's new auth endpoints need rate limiting and CSRF protection from day one, not bolted on after.
- 0.5f depends on 0.5e (the "pending until verified" state needs the verification table to exist).
- 0.5g depends on 0.5e/0.5f's schema being final before backfilling.
- No dependency on Stripe/demo work (§2/§3) — this track can run in parallel with them.

### Migrations (additive, backward-compatible only)
- `ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP` (nullable — `NULL` = unverified, matches existing codebase convention of raw `ALTER TABLE IF NOT EXISTS` seen in `server/index.ts:1784-1785,2951`, but tracked properly in `shared/schema.ts` this time to avoid repeating the existing schema-drift problem noted in architecture.md §2a).
- New `email_verifications` table: `id, user_id, token_hash, expires_at, consumed_at, created_at`.
- New `password_setup_tokens` table: `id, user_id, token_hash, expires_at, consumed_at, created_at`.
- No column removed, no existing column type changed, no `NOT NULL` added to an existing column without a default.

### Rollback plan
- Each PR is independently revertable (`git revert`) without a down-migration — new tables simply go unused; the `verified_at` column is nullable and additive.
- Behavior changes (stop-auto-login, stop-returning-temp-password) should ship behind a single boolean env-style flag *at the code level* (e.g., `SIGNUP_REQUIRES_VERIFICATION`) documented in code comments — flipping it back to `false` is the fast rollback path without touching git history, while `.env` files themselves remain untouched by this program per the standing rule.
- 0.5g's backfill is a one-way, idempotent `UPDATE ... WHERE verified_at IS NULL` — safe to re-run; rollback is "do nothing further," since it only ever sets a previously-`NULL` column.

### Test strategy
- Unit tests: token generation/expiry/single-use consumption for both new token tables.
- Integration test: full signup → verify-email → login flow, and a negative test that login is refused pre-verification.
- Regression test confirming **no** response body from `/api/trial/signup` ever contains a usable password field.
- Rate-limit test: N+1th request within window on `/api/auth/login` and `/api/trial/signup` returns 429.
- All wired into the CI baseline established in §5 — not left ungated (avoiding a repeat of B6).

### Acceptance criteria
1. No endpoint returns a usable password in any response.
2. No client-side code path logs a user in using server-issued credentials.
3. Every new account requires email verification before full access; every pre-existing production account continues to work without re-verification (0.5g backfill confirmed via row-count reconciliation, zero locked-out users).
4. `/api/trial/signup`, `/api/auth/login` are rate-limited and CSRF-protected.

---

## 2. Stripe security (webhook-hardening only — no live billing objects)

### Findings (re-cited)
- **B3** — no `stripe.webhooks.constructEvent()` call anywhere; `STRIPE_WEBHOOK_SECRET` is read only as a boolean presence flag in diagnostics endpoints (`server/routes.ts:32592,32909,33171`); the webhook route (`server/index.ts:156-237`) drives tenant billing state off an unverified `JSON.parse()` of the raw body.
- **B4** (narrow slice only) — `findCompanyByStripeCustomerId()`'s not-found branch is a guaranteed no-op (`LIMIT 0`, `server/billingLifecycle.ts:75-81`). Fixing the *matching* no-op is in scope; building the *full* Customer/Subscription-creation pipeline is explicitly **not** in scope for 0.5.
- `stripe-replit-sync`'s own internal verification behavior remains unconfirmed — `node_modules` was not installed in the audited worktree; must be read once installed, as part of 0.5h, not assumed.

### Proposed branch/PR sequence
| PR | Branch | Scope |
|---|---|---|
| 0.5h | `saas/phase0.5-webhook-signature-verification` | Add `stripe.webhooks.constructEvent()` using `STRIPE_WEBHOOK_SECRET`; reject (400) before any DB mutation if signature invalid or secret unconfigured (fail closed, refuse to boot the webhook route with a warning log if the secret is absent rather than silently accepting unsigned events); read `stripe-replit-sync`'s installed source to confirm/replace its own verification claim |
| 0.5i | `saas/phase0.5-webhook-idempotency` | New `stripe_webhook_events` table (event id, type, received_at, processed_at, status, payload_hash); persist the event **before** processing; unique constraint on Stripe event id enforces idempotency — a replayed event short-circuits without re-mutating |
| 0.5j | `saas/phase0.5-webhook-failure-visibility` | Surface `stripe_webhook_events.status = 'failed'` rows in a queryable admin endpoint (reuse `platform-audit.tsx`'s existing "Billing" tab data source where possible, per BL6 follow-up) — no new UI is required for 0.5, a queryable/audited state suffices |
| 0.5k | `saas/phase0.5-stripe-env-guard` | Startup guard: refuse to boot if a live-mode Stripe key (`sk_live_...`) is detected outside a production-designated environment; fixes 0.5f's no-op `LIMIT 0` matching branch as a small, isolated change |

### Dependencies
- 0.5h must land first (everything else assumes signatures are actually verified before persisting/acting on an event).
- 0.5i depends on 0.5h (idempotency is meaningless against unverified events).
- 0.5j depends on 0.5i (needs the event table to report from).
- 0.5k is independent and can land any time, including first.
- Independent of §1 (signup) and §3 (demo) tracks — can run in parallel.

### Migrations (additive)
- New `stripe_webhook_events` table only. No changes to `companies`, `payments`, `invoices`, or the existing Treasury sync tables.

### Rollback plan
- 0.5h: revert restores the current (already-broken) behavior — acceptable rollback since it's strictly a security *improvement*, not a behavior the app depends on.
- 0.5i/0.5j: the new table is additive and unused by any other code path; dropping is safe if ever needed, though not planned.
- 0.5k: the boot guard should be `NODE_ENV`-conditional and logged loudly before hard-failing, so a misconfigured non-prod environment fails fast in CI/staging rather than silently running with a live key — rollback is reverting the guard commit.

### Test strategy
- Unit tests with Stripe's official test fixtures/signing helper: valid signature accepted, invalid signature rejected, missing secret refuses to process (not "accepts anyway").
- Idempotency test: replaying the same event id twice results in exactly one state mutation.
- All against Stripe **test-mode** fixtures only — no real Stripe API calls, no live keys, no live charges, per this phase's explicit exclusion.
- Wired into the CI baseline (§5).

### Acceptance criteria
1. Every webhook event is rejected before any mutation unless its signature verifies against `STRIPE_WEBHOOK_SECRET`.
2. The service refuses to process webhooks (fails closed, not open) if the secret is unconfigured.
3. Replayed/duplicate Stripe event ids never cause a second mutation.
4. Failed/rejected events are visible in a queryable log, not just `console.error`.
5. No real Stripe customer, subscription, or charge is created by any code shipped in this phase.

---

## 3. Demo containment

### Findings (re-cited)
- **B1** — `jobDemoCleanup` (`server/workers/orchestrator.ts:97-109`) is a single-table `DELETE FROM companies` with no cascade; only 10 of 157 `companyId`-bearing FKs cascade — deletion of any used demo tenant throws and is silently swallowed by `.catch()`.
- **B2** — `POST /api/demo/login` (`server/routes.ts:24139-24215`) creates one permanent, shared, hardcoded-credential (`demo_admin`/`demo123`) tenant with no `trial_end`, permanently exempt from the (already broken) cleanup job.
- Demo gap table (gap-analysis.md §4) — no confirmed `isDemo` guard at the Documenso/Twilio/notifications integration layer; no confirmed rate limiting on `/api/demo/provision`.

### Proposed branch/PR sequence
| PR | Branch | Scope |
|---|---|---|
| 0.5l | `saas/phase0.5-retire-demo-login-singleton` | Redirect/replace `/api/demo/login` to call the same isolated provisioning path as `/api/demo/provision`; remove the hardcoded-credential code path entirely (resolves B2) |
| 0.5m | `saas/phase0.5-demo-cleanup-fk-safe` | Replace the single-table `DELETE` with an explicit, ordered, transactional multi-table delete covering all 157 `companyId`-bearing tables (dependency-ordered, dry-run/count mode first); defer the larger "separate demo schema/database" architectural decision to Phase 4 per the original roadmap — 0.5 fixes correctness, not architecture |
| 0.5n | `saas/phase0.5-demo-integration-guards` | Add explicit `isDemo` guards at the Documenso, Twilio, and notifications/email call sites (hard block at the integration boundary, not just the session-flag `blockDemoWrites` gate on ordinary write routes) |
| 0.5o | `saas/phase0.5-demo-cleanup-verification` | Automated test: provision a demo tenant with realistic usage (worker, time punch, etc.), simulate TTL expiry, run cleanup, assert **zero** residual rows across all 157 tables — independent verification, not just "the delete didn't error" |
| 0.5p | `saas/phase0.5-demo-abuse-controls` | Rate limiting on `/api/demo/provision` and `/api/demo/login` (reuses 0.5c's shared rate-limit middleware) |

### Dependencies
- 0.5l should land before 0.5m/0.5n/0.5o (no point hardening cleanup/guards for a singleton path that's about to be retired).
- 0.5m must land before 0.5o (the verification test needs the fixed cleanup routine to test against).
- 0.5p depends on 0.5c (§1) for the shared rate-limit middleware — light cross-track dependency, otherwise this track is independent of §1/§2.

### Migrations (additive)
- None strictly required for 0.5l/0.5n. 0.5m may add a `demo_cleanup_runs` audit table (`run_at, companies_deleted, rows_deleted_by_table, errors`) for the independent verification in 0.5o to assert against — additive, new table only.

### Rollback plan
- 0.5l: revert restores the old singleton behavior — acceptable short-term rollback since it's a security fix, not a load-bearing feature (no legitimate traffic should depend on the shared hardcoded account).
- 0.5m: the ordered multi-table delete should be feature-flagged against the old single-table delete during rollout so a bad delete-order can be reverted to "no-op but safe" without a code rollback; the flag defaults to the *new* safe behavior once tested.
- 0.5n: guards are additive checks that fail closed (block the call) — reverting only removes the check, restoring (not worsening) current behavior.

### Test strategy
- 0.5m/0.5o: integration tests against a disposable/test PostgreSQL instance seeded with a fully-populated demo tenant (workers, time punches, payroll runs, invoices) — never against staging/production.
- 0.5n: unit tests mocking the Documenso/Twilio/email clients, asserting zero outbound calls when `req.session.isDemo` (or the tenant's `isDemo` flag) is true.
- 0.5p: same rate-limit test pattern as §1.
- All wired into the CI baseline (§5).

### Acceptance criteria
1. Only one demo-provisioning code path exists; the hardcoded shared-credential path is gone.
2. Demo tenant deletion succeeds against every one of the 157 `companyId`-bearing tables with zero FK violations, verified by an automated test, not manual inspection.
3. No demo session can trigger a real email, SMS, Documenso request, Stripe charge, payroll/tax submission, bank transaction, or print job — verified by tests asserting zero outbound calls from mocked clients.
4. Demo provisioning is rate-limited.

---

## 4. Tenant-isolation assurance

### Findings (re-cited)
- **T5** — `enforceCompanyScope()`'s usage was confirmed on only a small sample (`server/routes.ts:24556,24564`); a full audit of tenant-scoping across 37,218 lines was explicitly out of scope for Phase 0.
- **T3** — `assertUserCanAccessCompany()` currently **allows** access (warns, doesn't block) when a company has no `tenant_companies` assignment — an "open by default" posture, not fail-closed.
- **T4** — exactly one automated cross-tenant regression test exists (`tests/security.test.ts::testTenantIsolation`, `workers` resource only), not CI-gated.
- **PT2** — `platform_owner`/`platform_super_admin`/`platform_admin` get blanket tenant-admin-equivalent access via `expandRoleForGuard` (`server/routes.ts:260-279`) with no boundary between "platform owner operating their own tenant" and "platform owner accessing any other tenant."

### Proposed branch/PR sequence
| PR | Branch | Scope |
|---|---|---|
| 0.5q | `saas/phase0.5-route-inventory` | Script (dev-tooling only, not shipped app code) that parses `server/routes.ts` and enumerates every route registration — method, path, full middleware chain — output as a generated report (`docs/saas-readiness/route-inventory.md` or `.json`); pure static analysis, no runtime behavior change |
| 0.5r | `saas/phase0.5-route-trust-classification` | Extend 0.5q's output to classify each route's tenant-scoping mechanism (`session-derived` / `enforceCompanyScope` / `trusts-client-companyId` / `platform-only` / `not-applicable`) and flag every route in the "trusts client input" bucket — this *is* T5's concrete deliverable |
| 0.5s | `saas/phase0.5-fail-closed-tenant-helper` | New shared `requireTenantScope()` middleware: deny-by-default — if scope cannot be resolved or doesn't match the session, 403; explicitly does **not** repeat `assertUserCanAccessCompany`'s "unassigned → warn and allow" pattern (T3). Built and unit-tested in isolation; *not* yet applied to the routes flagged in 0.5r — that application is the larger Phase 7a follow-up |
| 0.5t | `saas/phase0.5-cross-tenant-negative-tests` | Extend `testTenantIsolation()`'s pattern to invoices, proposals, contracts, documents, payroll runs, and the `tenants`/`tenant_companies` CRUD routes, run against a disposable PostgreSQL instance spun up fresh per CI run (e.g. via a Postgres service container), seeded with synthetic data only |
| 0.5u | `saas/phase0.5-platform-owner-boundary` | Stop `platform_owner`'s implicit, silent tenant-admin bypass in `expandRoleForGuard`; require an explicit, logged "acting as tenant" grant (minimal viable version — not the full impersonation banner/expiry UI, which remains Phase 7b) before a platform-owner-role session can act on tenant-scoped write routes |

### Dependencies
- 0.5q → 0.5r (classification needs the inventory first) — these two are pure static analysis and can start immediately, in parallel with every other track, since they touch no runtime code.
- 0.5s is independent of 0.5q/0.5r (the helper's logic doesn't depend on the inventory) but is *informed* by 0.5r's findings about what "fail closed" needs to cover.
- 0.5t depends on 0.5s existing conceptually (tests should exercise the new helper where it's been applied, and the old behavior everywhere else) but can begin against the *existing* guards immediately and be extended as 0.5s lands.
- 0.5u depends on 0.5s (the boundary check needs the fail-closed helper to enforce against).

### Migrations
- None. This track is entirely code/tooling — no schema changes.

### Rollback plan
- 0.5q/0.5r produce a static report artifact — no runtime risk, nothing to roll back.
- 0.5s: the new helper is opt-in (not yet wired into any route in 0.5) — zero blast radius, trivially revertable.
- 0.5u: gate the "acting as tenant" requirement behind a flag so it can be disabled instantly if it blocks the actual platform owner's legitimate use of their own complimentary tenant (see PT1/PT2 interplay — the *owner's own* internal/complimentary tenant should be exempted from the boundary check by tenant-relationship, never by hardcoded ID/email, consistent with the standing rule).

### Test strategy
- 0.5q/0.5r: snapshot test asserting the generated inventory report doesn't silently shrink (protects against the tool itself regressing).
- 0.5s: unit tests — resolved-scope-matches (allow), resolved-scope-mismatches (deny), unresolvable-scope (deny, not warn-and-allow).
- 0.5t: integration tests against disposable PostgreSQL only, per resource area listed above; explicitly never against live/staging tenant data, per the standing rule.
- 0.5u: regression test that a `platform_owner` session is denied silent write access to a non-owned, non-complimentary tenant, and permitted (with an audit event) once the explicit grant exists.
- All wired into the CI baseline (§5).

### Acceptance criteria
1. A complete, generated inventory of every authenticated route and its tenant-scoping classification exists and is committed.
2. Every route trusting client-supplied `companyId` without session verification is explicitly listed (not silently accepted as "fine").
3. A reusable, unit-tested, fail-closed tenant-scope-enforcement helper exists (not yet applied everywhere — that's tracked as Phase 7a follow-up work, out of 0.5's scope).
4. Cross-tenant negative tests exist for at least invoices, proposals, contracts, documents, payroll runs, and tenant CRUD — run against disposable Postgres in CI, never live data.
5. `platform_owner` (and platform_super_admin/platform_admin) no longer get silent, unaudited write access to arbitrary tenants.

---

## 5. CI baseline

### Findings (re-cited)
- **B6** — CI's `test` job runs exactly 1 of 70+ test files (`npx tsx server/__tests__/api-json-guard.test.ts`, `.github/workflows/ci.yml:53-55`); `typecheck` is `continue-on-error: true` (advisory only); `tests/security.test.ts` (the one real IDOR regression test) is not gated.

### Proposed branch/PR sequence
| PR | Branch | Scope |
|---|---|---|
| 0.5a | `saas/phase0.5-ci-test-classification` | Run every one of the 65 files in `tests/` and 4 remaining files in `server/__tests__/` against a disposable environment; classify each as **product defect** (test is right, code is wrong — needs a follow-up bug ticket, not fixed in this PR), **stale assertion** (test predates a since-changed behavior — needs test update), **environmental** (requires infra CI doesn't have — e.g. a live Twilio/Documenso sandbox — needs mocking or explicit exclusion with a documented reason), or **missing fixture** (test references data/setup that no longer exists). Output: a committed classification report, no test file is deleted or weakened in this PR |
| 0.5b | `saas/phase0.5-ci-trusted-suite` | Wire the subset of tests classified as passing-and-trustworthy (plus `tests/security.test.ts` and every new test added by §1–§4 above) into `ci.yml` as a required check; leave `typecheck` as advisory until a separate, later decision to promote it (out of 0.5's scope — flagged as a LOW item in the merged launch-checklist.md) |

### Dependencies
- 0.5a must complete (or at least reach a stable classification) before 0.5b, since 0.5b's "trusted suite" is defined by 0.5a's output.
- **0.5a/0.5b should land first, ahead of §1–§4**, so every new test those tracks add lands into an already-trustworthy, already-gating CI pipeline rather than repeating B6's original mistake of adding tests nobody runs.

### Migrations
- None. CI/tooling change only.

### Rollback plan
- 0.5b's `ci.yml` change is a single-file diff — trivially revertable to the current 1-file `test` job if the newly-gated suite proves flaky in practice; revert does not affect the application.
- 0.5a produces a report only — nothing to roll back.

### Test strategy
- This *is* the test-strategy-defining PR pair for the rest of the program — no separate "tests for the tests" beyond confirming the classification report's counts reconcile against `find tests/ server/__tests__/ -name "*.test.ts" | wc -l`.

### Acceptance criteria
1. Every one of the 70 existing test files has a recorded, reviewed classification — none left as an unknown.
2. No existing test is deleted, skipped, or has its assertions weakened to make CI pass artificially.
3. A defined "trusted required check" set exists in `ci.yml` and every subsequent Phase 0.5 PR's new tests join it, not a separate ungated suite.
4. `tests/security.test.ts` (the existing IDOR regression test) is part of the required check suite.

---

## Cross-cutting notes

- **Production-tenancy interplay:** §1's account-security changes and §4's platform-owner boundary work both touch the same underlying question — how the owner's own real businesses are represented. Per the merged Phase 0 docs (PT1), the internal/complimentary subscription *model itself* remains Phase 1 scope (`shared/schema.ts` additions for `billing_mode`/grantor/reason), not Phase 0.5. Phase 0.5's platform-owner boundary work (0.5u) should be built so it composes cleanly with that model once it lands, but does not require it to land first — the interim "explicit acting-as-tenant grant" in 0.5u is deliberately minimal for that reason.
- **No live testing anywhere in this workstream.** Every integration/negative test proposed above runs against disposable/ephemeral PostgreSQL or mocked external clients. No PR in this plan touches staging, demo, or production data.
- **Stripe scope discipline.** §2 is deliberately narrow — signature verification, event persistence, idempotency, and env separation only. Building the actual trial-to-paid billing pipeline (real Customer/Subscription creation, BL2's payment-method-upfront product decision) remains Phase 3, gated on the product decisions already listed in the merged `launch-checklist.md`.

## Estimated implementation order

1. **0.5a → 0.5b** (CI baseline) — must be trustworthy before anything else's tests mean anything.
2. **0.5q → 0.5r** (route inventory/classification) — pure static analysis, zero runtime risk, can actually start in parallel with 0.5a/0.5b since it doesn't depend on CI trust for its own validity, but its PR should still merge through the now-trusted pipeline.
3. **0.5c** (CSRF + rate-limit foundation) — shared infra several later PRs need.
4. **0.5h → 0.5i → 0.5j** and **0.5k** (Stripe webhook hardening) — high-severity, self-contained, no cross-track dependency once 0.5a/0.5c are in place.
5. **0.5l → 0.5m → 0.5n → 0.5o**, then **0.5p** (demo containment) — B1/B2 are launch BLOCKERs; sequence internally as listed (retire singleton before hardening cleanup/guards for it).
6. **0.5e → 0.5f → 0.5g** (signup/account security) — scheduled after the team has practiced the additive-migration/rollback pattern on lower-risk tables (webhook events, demo audit) so the higher-stakes "touches every existing production user" migration (0.5g) benefits from a proven playbook.
7. **0.5s → 0.5t → 0.5u** (tenant-isolation enforcement helper, negative tests, platform-owner boundary) — closes out the workstream; deliberately last since it's the largest and most cross-cutting, and benefits from every other track's new tests already being CI-gated.

Every PR above gets its own branch (`saas/phase0.5-<slug>`), its own tests wired into the CI baseline from step 1 onward, and its own draft PR — no PR in this plan is implemented in this planning turn.
