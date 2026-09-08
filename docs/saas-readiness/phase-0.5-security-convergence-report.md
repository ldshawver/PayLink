# Phase 0.5 Security Convergence Report

**Status:** Draft for review — audit/planning only, no application code changed.
**Baseline verified:** `origin/main` @ `a3526a1` — "Phase 0.5: fix ten cross-tenant/role-gate authorization gaps in platform-console routes (#94)".
**Staging verified:** `staging.mypaylink.app` `/api/version` reports `commit: a3526a1`, `/api/health` returns `status: ok` (checked 2026-08-24T23:23Z).
**Production verified unchanged:** `mypaylink.app` `/api/health` returns `status: ok`, `version: 2.1.1` (same `app_version` as staging); the production `/api/version` route does not expose a commit SHA (`commit: "unknown"` by design), so commit-level confirmation isn't available via that endpoint — no deploy, migration, or config action was taken against production during this review.
**Method:** Four independent read-only research passes (route/manifest reconciliation; platform-role boundary + tenant-FK schema/orphan check; CSRF + auth/abuse controls; Stripe webhook + demo containment) were cross-checked against each other, and every claim below that materially affects the launch decision was re-verified directly against `server/routes.ts`, `server/index.ts`, `server/webhookHandlers.ts`, `shared/schema.ts`, and the installed `stripe-replit-sync` package by file:line citation before being included here. Two internal contradictions were caught and resolved during this process (noted inline where relevant) — this report does not repeat either research pass's claim without that verification.

---

## 1. Completed security work (Batches 1–5, merged to `origin/main`)

| Batch | PR | What it closed |
|---|---|---|
| 1–3 | #85, #88, #89 (+fix) | Cross-tenant authorization gaps in check-template, invoice, wage, payroll-payment-method, company, tax, worker-membership routes |
| 4 | #91 / #92 | 16 cross-tenant authorization gaps, company-tax/check-template/payroll-payment/worker-membership routes |
| 5 | #93 / #94 | 10 cross-tenant/role-gate authorization gaps in platform-console routes, including the audit-log cross-tenant leak (verified defect 10) |

- **43 distinct verified authorization defects fixed** across 45 distinct routes that received real negative (cross-tenant) tests (batch breakdown: b1=2, b2=6, b3=9, b4=16, b5=10; test-route counts: b1=5, b2=9, b3=8, b4=11, b5=12). Source: `docs/saas-readiness/cross-tenant-batch-{2,3,4,5}-test-manifest.json` + `cross-tenant-test-manifest.json`.
- Batch 5's test manifest (current, post-fix) shows **61 PASS / 0 FAIL / 3 EXPECTED-GLOBAL** for its 12 routes. The companion prose doc (`phase-0.5-batch-5-cross-tenant-findings.md`) was written pre-fix and still shows the old 46P/10F numbers — **the `.json` is current-truth, the `.md` is stale and should be regenerated, not read as current state.**
- Audit-log access for `platform_support`/`platform_implementation` is **correctly scoped** today: `GET /api/audit-log` and `/api/audit-log/export-csv` (`server/routes.ts:~31125-31144`) explicitly require `companyId` (which platform accounts never have) unless the caller is a super-admin — this is the batch-5 fix for "verified defect 10," confirmed present on `origin/main`.
- Stripe webhook **signature verification is real and correctly wired**, contrary to one of this review's own research passes initially claiming otherwise (see §6) — `express.raw()` is mounted on `/api/stripe/webhook` (`server/index.ts:156-158`) strictly before the global `express.json()` (`server/index.ts:240`), and `WebhookHandlers.processWebhook()` (`server/webhookHandlers.ts:6-18`) calls into `stripe-replit-sync`'s `constructEventAsync()` (`node_modules/stripe-replit-sync/dist/index.js:729`), which throws on an invalid signature. Failure recovery is correct: unhandled errors return HTTP 400, so Stripe retries; nothing is swallowed to 200.
- Route-security static inventory exists and is comprehensive: 1,030 routes catalogued in `route-security-manifest.json`; 721 storage-layer call sites traced in `storage-scope-trace-manifest.json`.

---

## 2. Remaining verified blockers (9)

Each of these was independently confirmed by direct code inspection during this review, not taken on a single source's word.

1. **CSRF protection: absent, everywhere.** Zero CSRF middleware exists in the codebase (`grep -rn csrf server/` → 0 hits). Two independent counting methods converge: `route-security-manifest.json` flags **651** routes as `mutates:true` + `csrf:"unprotected-needs-classification"`; a direct grep of `app.post/patch/delete/put` registrations in `server/routes.ts` counts **654** (378 POST + 148 PATCH + 120 DELETE + 8 PUT). All are cookie-session-authenticated. Session cookies are otherwise reasonably configured (`httpOnly:true`, `secure:isProduction`, `sameSite:"lax"`, `server/index.ts:264-276`, with a narrow, apparently intentional `sameSite:"none"` carve-out for recognized Capacitor mobile-app origins), but `sameSite:lax` alone is not a substitute for token-based CSRF defense against same-site-adjacent and top-level-navigation attacks.
2. **No rate limiting anywhere.** No `express-rate-limit` or equivalent dependency exists in `package.json` at all. Confirmed unprotected: `/api/auth/login`, `/api/auth/recover`, `/api/trial/signup`, `/api/demo/provision`, `/api/demo/login`, MFA verify. This is a global infrastructure gap, not a per-route oversight.
3. **`POST /api/auth/recover` is a full account-takeover primitive, not a password-reset flow** (`server/routes.ts:1739-1765`, verified directly). It is the **only** password-reset endpoint that exists in the codebase — there is no per-user, email-verified "forgot password" flow at all. It is gated solely by comparing the caller-supplied `recoveryToken` against one **static, server-wide `RECOVERY_TOKEN` environment value shared across every account**. Anyone who obtains that single value can reset **any** user's password by username alone, with no expiry and — because there is no rate limiting (blocker #2) — no limit on guess attempts. It does not leak account existence to a caller who doesn't already hold the token (the token check runs before the username lookup), but it collapses "forgot password" for the entire tenant base into one shared secret.
4. **No email verification on signup**, and self-service trial signup returns the plaintext temporary password directly in the JSON response body. `POST /api/trial/signup` (`server/routes.ts:24010-24115`) synchronously creates a company, a tenant, a `tenant_companies` row, and a fully-privileged `admin` user — immediately login-capable, no verification token, no unverified state.
5. **Session fixation: not handled.** No `session.regenerate()` call exists anywhere in `server/` (repo-wide grep, zero matches). `POST /api/auth/login` (`server/routes.ts:1662-1663`) writes `userId`/`username` onto the pre-existing session object rather than rotating the session ID on privilege change.
6. **Role-alias privilege expansion — confirmed, and the codebase contradicts its own documentation about it.** `expandRoleForGuard()` (`server/routes.ts:260-279`, verified directly) silently maps `platform_support` and `platform_implementation` to `["admin", "manager", role]` for **every** `requireRole()`-gated route (534 `requireRole()` call sites in `routes.ts`) — and `platform_super_admin`/`platform_admin`/`platform_owner` to `["admin","manager","supervisor",role]`. This is already a documented gap (`gap-analysis.md` T1, **HIGH**, "no impersonation session, no explicit reason, no expiration, no visible banner, no dedicated audit event"). What sharpens it: the app's own self-documenting endpoint `GET /api/platform/audit/roles` (`server/routes.ts:32973-32980`, verified directly) publicly asserts `platform_support` is `"Read-only tenant data for support"` with `aliases: []`, and `platform_implementation` is `"Implementation/CS modules only"` with `aliases: []` — i.e., the platform's own audit transparency page tells callers these roles have no elevated access, while `expandRoleForGuard()` actually grants them tenant-admin mutation reach with no audit trail. This is not merely undocumented risk; it is a documented false statement inside the running application. `phase-0.5-launch-security-plan.md`'s existing `0.5u` branch only scopes a fix for `platform_owner`'s bypass — it needs to be broadened to cover `platform_support`/`platform_implementation` to actually close T1.
7. **`tenant_companies.tenant_id` has no foreign key to `tenants.id`**, confirmed at `shared/schema.ts:4691` (`tenantId: varchar("tenant_id").notNull()`, no `.references()` — unlike the adjacent `companyId`, which does reference `companies.id` with `onDelete: "cascade"`). Types are compatible (`varchar`/`varchar`) for adding the constraint later. **The read-only orphan count this review was asked to produce could not be run**: the local Postgres instance has no database literally named `paylinkdev`; the actual visible databases are `PayLinkapp`, `apppaylinkmain`, `apppaylinkstaging`, `paylink` (owner `lshawver`), and `paylink_hardening_3afca9ede912`, and none was confident to be the correct disposable, non-production-mirroring target without risking a query against a database that shadows real data. This is now an explicit, scoped to-do (Branch 2, below) rather than a guessed number. Related, already-documented gaps: `gap-analysis.md` T3 (`assertUserCanAccessCompany()` allows, doesn't block, companies with no `tenant_companies` row) and PT3 ("no company→tenant mapping tooling exists — BLOCKER for any production tenant-mapping/migration work"). No prior orphan-count data exists anywhere in the docs reviewed — this would be a first-time measurement.
8. **7 platform-console routes still lack independent role-boundary negative tests.** Of 19 routes classified `platform-console only` / `confidence:high` in `route-security-manifest.json`, batch 5's 12 tests covered `/api/tenants*` and a subset of `/api/provisioning/*`. Untested: `GET/POST /api/breach-incidents`, `GET /api/feature-registry*` (×3) + `.../activate` + `.../bulk-activate`, `GET /api/admin/lifecycle-overview`.
9. **Demo provisioning is not nonpersistent, and creates unlimited durable production data.** `POST /api/demo/provision` is public and unauthenticated (`server/routes.ts:24511`); `provisionDemoTenant()` (`server/demo-seed.ts:45-90+`) writes real rows into the **same production tables real tenants use** (enterprises, companies, divisions, departments, workers, payroll runs, and more), tagged only by `is_demo=TRUE` and a 24h `trial_end` — there is no separate ephemeral store, so every unauthenticated call creates a new durable tenant. This is compounded by the DemoCleanup bug (§8, tracked separately per the review's own instruction, but it directly determines whether this demo data is ever actually removed): `jobDemoCleanup` (`server/workers/orchestrator.ts:97-109`) issues a bare `DELETE FROM companies WHERE is_demo=TRUE AND trial_end < NOW()-2h ...` with no child-row deletion first, against a schema where 130 tables carry a `company_id` FK to `companies.id` and only 10 declare `ON DELETE CASCADE` — the delete fails on foreign-key violation on essentially the first expired demo tenant with any dependent rows, and the job silently no-ops past that point. Expired demo tenants therefore accumulate indefinitely in production tables. (Contrast: the authenticated `/api/admin/provision-demo` reset path, `server/routes.ts:24560-24680`, does this correctly via an `information_schema`-driven topological delete — `jobDemoCleanup` just doesn't reuse that logic.) Note also: the `publicWritePaths` allowlist (`server/routes.ts:1412`) still permits demo sessions to reach `/webhooks/*`, `/portal/`, `/time-clock/`, and other paths — this review did not exhaustively trace whether any of those reachable paths trigger outbound email, Documenso requests, or file writes from a demo session; flagged as a required check inside Branch 6, not assumed either way.

**A tenth item was investigated and found NOT to be a blocker, despite an initial contradictory claim:** Stripe webhook signature verification. One research pass, grepping only `server/` for `constructEvent`, found zero hits and concluded verification was missing. A second pass found the actual call inside the vendored `stripe-replit-sync` dependency. This review verified directly (§1, and `node_modules/stripe-replit-sync/dist/index.js:712-730`) that the second finding is correct: verification is real, uses the raw body, sources the signing secret from a self-registered Stripe-managed-webhook row in Postgres (not a static copied secret), and fails closed. What genuinely is still missing on the Stripe path specifically: a formal event-ID dedup ledger and persisted raw-event audit trail (the custom handlers are naturally idempotent via `UPDATE ... WHERE stripe_payment_intent_id = ...` / `ON CONFLICT ... DO UPDATE`, which is safe-but-informal, not a substitute for one). This is downgraded to a recommended pre-launch hardening item (Branch 4), not a launch blocker, because the actual exploit-relevant control (signature verification) is sound. The separate Documenso webhook path (`server/routes.ts:26146-26161`) already has a real `webhook_events` dedup ledger keyed on `provider_event_id` — stronger than the Stripe path today.

---

## 3. Unresolved / needs re-measurement (not yet a confirmed blocker or a confirmed clear)

- **`storage-scope-trace-manifest.json`'s "needs-runtime-hardening" count is internally contradictory and must be re-run before it's used to scope any further work.** The live manifest (regenerated through `a3526a1`) currently shows, out of 721 traced storage-layer call sites: **6 needs-runtime-hardening / 715 unresolved / 0 needs-negative-test / 0 verified-safe**. Its own companion findings doc (`phase-0.5r-storage-scope-trace-findings.md`, written once at an earlier commit and never regenerated) shows **430 / 224 / 67 / 0** over the same 721 targets. The most likely explanation is that the static trace's pattern-matching no longer recognizes the post-fix code shape (new helper calls introduced by Batches 2–5), collapsing routes it can no longer classify back into "unresolved" — a **tooling legibility regression, not necessarily a security regression** — but this must be confirmed, not assumed, before Branch 7 (below) can be correctly scoped. Do not trust either number as-is.
- **"Critical/high-risk untested routes"** — best current proxy, pending the re-measurement above: `route-security-manifest.json` confidence distribution is 561 low / 405 medium / **64 high** (of 1,030 total routes); 160 routes are flagged `clientSuppliedCompanyIdWithoutMembershipCheck:true` (a stronger risk proxy than confidence alone). The 19 platform-console-only routes are all `confidence:high`, and 7 of those remain untested (blocker #8, above, already scoped as finite).
- **False positives / low-confidence static findings** — there is no explicit "false positive" status field in any manifest. The 561/1,030 `confidence:"low"` routes in `route-security-manifest.json` are the closest available proxy, but this is *not* a confirmed-benign count and should not be reported as one; it is simply the set the static tool itself is least sure about.
- **"EXPECTED_GLOBAL" — corrected from the review's original premise.** There are **3** routes with disposition `"EXPECTED GLOBAL"` in the batch-5 test manifest (a platform-super-admin feature-override read, a `platform_billing`-role feature-override read via `requirePlatformRole()`'s flat 7-role allowlist, and a platform-super-admin licensing-gate override) — all three were reviewed and are correctly scoped reads or correctly-targeted platform-admin actions, not exploitable gaps. **"Seven" refers to the count of platform roles** in `requirePlatformRole()`'s allowlist (`platform_super_admin, platform_admin, platform_sales, platform_implementation, platform_support, platform_billing, platform_auditor` — `server/routes.ts:306-324`), not seven routes. This distinction matters because it changes what "verify the seven EXPECTED_GLOBAL routes are safe" actually resolves to: 3 routes, already reviewed and safe, not 7 unreviewed ones.

---

## 4. Downgraded to false positive / accepted risk

- The 3 `EXPECTED GLOBAL` dispositions above (§3) — reviewed and accepted as intentional, correctly-scoped platform-console reads/actions, not defects.
- Batch 5's stale prose findings doc showing 10 failing tests (§1) — superseded by the current, passing `.json` manifest; the prose doc is a documentation-lag issue, not a live regression.

Nothing else in the evidence reviewed carries enough confidence to downgrade; the `confidence:"low"` static-finding bucket (§3) is explicitly *not* being downgraded here — it needs actual runtime verification, not a confidence-label-based dismissal.

---

## 5. Launch-blocking vs. post-launch classification

**Launch-blocking (must close before production promotion):**
1. CSRF protection (blocker #1)
2. Rate limiting on auth/signup/demo endpoints (blocker #2)
3. `/api/auth/recover` shared-secret account-takeover primitive (blocker #3)
4. Signup email verification + stop returning plaintext temp password in-band (blocker #4)
5. Session regeneration on login (blocker #5)
6. Role-alias privilege expansion for `platform_support`/`platform_implementation` (blocker #6)
7. `tenant_companies.tenant_id` FK — orphan check at minimum; constraint itself may land post-launch if the check is clean and the risk is formally accepted (blocker #7)
8. 7 untested platform-console routes get negative tests (blocker #8)
9. Demo provisioning containment + DemoCleanup fix, since the two are coupled (blocker #9)

**Post-launch acceptable (recommended, not blocking):**
- Stripe formal event-ID dedup ledger + persisted raw-event audit trail (§2, downgraded item) — current behavior is safe-by-idempotency, not broken.
- Re-running/repairing the storage-scope-trace tool's classification logic (§3) — needed to *responsibly close out* Phase 0.5 measurement, but the underlying routes it's trying to classify were already covered by Batches 1–5's actual negative tests where it matters most (cross-tenant access); this is a measurement-quality gap, not a known-open exploit.
- Twilio SMS webhook signature verification — not deep-audited in this pass; flagged for a follow-up, not blocking launch on its own since it's not a cross-tenant or payment-integrity surface.
- Full trace of every `publicWritePaths`-allowed demo-session route for mail/Documenso/file-write reachability (§2, blocker #9's open sub-item) — do the targeted check in Branch 6 before declaring demo containment closed; if it turns up a live reachable path, it gets folded into blocker #9's fix, not deferred.

---

## 6. Finite stopping rule for Phase 0.5

**The open-ended-batching problem already has a documented root cause, found during this review: `phase-0.5-launch-security-plan.md` already defines a complete, finite, 21-branch plan (`0.5a` through `0.5u`) with dependencies, migrations, rollback plans, and acceptance criteria per track. Only `0.5a` (CI baseline), `0.5q` (route inventory), and `0.5r` (storage-scope trace) from that plan were ever executed. Instead of continuing down that plan's remaining tracks, work diverged into five uniform "cross-tenant batch" PRs (Batches 2–5) that were never part of the original plan.** Those batches were valuable and closed 43 real defects — but they are also why "just do another batch" has no natural end: the plan that *does* have a natural end was abandoned partway through.

**Stopping rule: Phase 0.5 is complete when, and only when, all 9 verified blockers in §2 are closed, the 7 untested platform-console routes in blocker #8 have negative tests (and, if the storage-scope-trace re-measurement in §3 surfaces additional confirmed-critical/high routes beyond those 7, that finite, named set — and only that set — is added to Branch 7 before Phase 0.5 closes), and the CI-gating requirement in Branch 8's acceptance criteria is met.** No new uniform "batch N+1" of cross-tenant sweeps is authorized under this stopping rule; any further cross-tenant work must name specific routes with a specific reason, not "sweep the rest."

---

## 7. Recommended branch sequence

This reuses the branch names and slugs already defined in `phase-0.5-launch-security-plan.md` where they exist, since that plan was already reviewed and is sound — it just wasn't finished.

### Branch 1 — Platform-role negative tests + confirmed boundary repair
`saas/phase0.5-platform-owner-boundary` (broadened from the existing `0.5u` scope to cover `platform_support`/`platform_implementation`, not just `platform_owner`)
- Fix `expandRoleForGuard()` so `platform_support`/`platform_implementation` no longer silently receive `["admin","manager",role]` on tenant-mutation routes; require an explicit, logged "acting as tenant" grant per the existing `0.5u` design, or narrow their alias to match what `/api/platform/audit/roles` already claims (`aliases: []`) if broad access isn't actually needed.
- Add negative tests for the 7 untested platform-console routes (blocker #8).
- **Acceptance criteria:** `GET /api/platform/audit/roles`'s claimed `aliases` for each role matches `expandRoleForGuard()`'s actual behavior (test asserts this, not just eyeballed); a `platform_support`/`platform_implementation` session is denied silent write access to a non-owned tenant and permitted only with an audit event once the explicit grant path exists; all 19 platform-console-only routes (not just 12) have passing cross-tenant negative tests; new tests are wired into the CI-required check, not left in the non-gating `db` suite.

### Branch 2 — Tenant-integrity FK preflight/migration
New branch, e.g. `saas/phase0.5-tenant-fk-preflight`
- Identify the correct disposable, non-production-mirroring database for the orphan check (this review deliberately did not guess — resolve the ambiguity between `PayLinkapp`/`apppaylinkmain`/`apppaylinkstaging`/`paylink`/`paylink_hardening_*` first).
- Run read-only: total `tenant_companies` row count, orphan count (`tenant_id` not present in `tenants.id`), NULL check, type-compatibility confirmation (already done in this review: both `varchar`, compatible).
- If orphans are found, resolve or document them (do not add the constraint over unresolved orphans).
- Add the FK migration itself only after a clean orphan check, as an additive, reversible migration.
- **Acceptance criteria:** orphan count is 0 (or every orphan is explicitly triaged and resolved) before the constraint lands; migration is additive/reversible; a rollback (drop constraint) has been dry-run.

### Branch 3 — CSRF and authentication rate-limit foundation
`saas/phase0.5-csrf-ratelimit` (existing `0.5c` in the plan)
- Global CSRF middleware (synchronizer-token or double-submit-cookie) mounted immediately after session middleware, with a path-prefix allowlist for confirmed exceptions: `/api/stripe/webhook`, `/api/webhooks/documenso`, `/api/webhooks/product-events`, `/api/webhooks/esign/:provider`, `/api/public/sign/contracts/:token*`, `/api/signing/contracts/:token*`, `/api/trial/signup`, `/api/demo/provision`, `/api/demo/login`, `/api/stripe/publishable-key`.
- Shared rate-limit middleware applied to `/api/auth/login`, `/api/auth/recover`, `/api/trial/signup`, `/api/demo/*`, MFA verify.
- Land behind a feature flag with a one-route canary before flipping globally, given ~650 call sites are affected — this is this branch's single largest regression-risk item.
- **Acceptance criteria:** all ~650 cookie-authenticated mutating routes reject a missing/invalid CSRF token; all 10 listed exceptions continue to function unmodified (explicit regression test per exception); rate limits return `429` with a sane retry-after on the 5 listed endpoint groups; Capacitor mobile app's token round-trip (header-based, since it can't rely on `sameSite` cookies the same way) is verified working, not just web.

### Branch 4 — Stripe webhook hardening
`saas/phase0.5-webhook-idempotency` (existing `0.5i`/`0.5j` scope; `0.5h`'s original premise — "verification is missing" — is now known to be false per §2, so that sub-branch is not needed as originally scoped)
- Add a `stripe_webhook_events` table (event id unique, type, received_at, processed_at, status, payload_hash); persist the event before processing.
- Surface failed-status events in a queryable admin endpoint.
- **Acceptance criteria:** replaying a previously-processed Stripe event short-circuits without re-mutating (test with a captured event, replayed twice); a processing failure after successful signature verification is visible in the new table's `status='failed'` rows, not silently lost.

### Branch 5 — Signup/email-verification and account-security repair
`saas/phase0.5-email-verification` + `saas/phase0.5-invitation-signup` (existing `0.5e`/`0.5f`, plus the `/api/auth/recover` fix folded in since it's the same "account security" surface)
- New signups start unverified; add `POST /api/auth/verify-email` / resend; stop auto-login from the signup response; stop returning `temporaryPassword` in the response body.
- Replace `/api/auth/recover`'s single shared static token with a real per-user, expiring, single-use reset-token flow delivered out-of-band via email; retire the shared `RECOVERY_TOKEN` env var entirely once the replacement is live.
- Add `session.regenerate()` on successful login (session-fixation fix, blocker #5) — small, self-contained, can land in this branch or independently first.
- **Acceptance criteria:** a new signup cannot reach authenticated functionality before verifying email; no endpoint returns a usable password in a response body; `/api/auth/recover`'s old shared-token behavior is gone (test that the old token, even if leaked, no longer resets any account); login rotates the session ID (test: session ID before/after login differ); pre-existing production accounts remain functional without forced re-verification (grandfather backfill, per the existing `0.5g` plan).

### Branch 6 — Demo containment
`saas/phase0.5-demo-cleanup-fk-safe` + `saas/phase0.5-demo-integration-guards` + `saas/phase0.5-demo-abuse-controls` (existing `0.5m`/`0.5n`/`0.5p`)
- Fix `jobDemoCleanup` to reuse the existing topologically-ordered, `information_schema`-driven delete already implemented correctly in `/api/admin/provision-demo`'s reset path, instead of the current bare single-table `DELETE`.
- Add explicit `isDemo` guards at the Documenso/Twilio/email/file-write integration boundaries (not just the session-flag gate on ordinary write routes), after completing the targeted `publicWritePaths` reachability check flagged in §5.
- Apply Branch 3's rate limiting to `/api/demo/provision` and `/api/demo/login`.
- **Acceptance criteria:** provisioning a demo tenant with realistic usage (worker, time punch, payroll run, etc.), simulating TTL expiry, and running cleanup leaves **zero** residual rows across all `company_id`-bearing tables (automated test, not "the delete didn't error"); no outbound email/Documenso call is observed from a demo session in a mocked-client test; `/api/demo/provision` and `/api/demo/login` are rate-limited.

### Branch 7 — One additional cross-tenant batch, only if warranted
No branch created yet — conditional. **First**, re-run/repair the storage-scope-trace tool (§3) to get a trustworthy `needs-runtime-hardening` count. **Only if** that re-measurement surfaces specific, named, critical/high-risk routes beyond the 19 platform-console routes already fully covered by Branch 1, open one scoped branch naming exactly those routes. If the re-measurement confirms the current "6 needs-runtime-hardening" figure (i.e., the 430 in the stale doc really was a tooling artifact), **this branch is not needed** and Phase 0.5 proceeds to Branch 8 without it — consistent with the stopping rule in §6.

### Branch 8 — Final staging launch-security acceptance
No code changes — verification only.
- Full cross-tenant negative-test suite (all 5 batches + Branch 1's additions) is wired into the **CI-required check**, not the currently non-gating `db` suite (`tests/cross-tenant-batch-5-routes-db.test.ts` today requires `TEST_DATABASE_URL` and isn't in the required GitHub Actions check — this must change before launch, per the existing `0.5a`/`0.5b` CI-baseline plan).
- CSRF middleware confirmed active on staging with all exceptions verified.
- Rate limits confirmed active on staging.
- Email verification confirmed live; old `RECOVERY_TOKEN` flow confirmed retired.
- Role-alias fix confirmed deployed; audit events confirmed emitted for platform-staff tenant access.
- `tenant_companies.tenant_id` FK confirmed added (or orphan-check-clean risk formally accepted and documented if deferred).
- Demo provisioning confirmed either integration-guarded or cleanup confirmed working (zero-residual-rows test passing on staging).
- Stripe event-persistence/idempotency table confirmed live.
- Staging `/api/version` commit matches the exact SHA being promoted.

---

## 8. DemoCleanup foreign-key failure — recorded separately

Per this review's instructions, this is tracked as a distinct known issue, not folded into the security-blocker count, **except** where it directly determines whether demo containment (blocker #9) can be closed — which it does, since a demo tenant that's never cleaned up is durable data regardless of intent. Root cause (verified directly, `server/workers/orchestrator.ts:97-109`): a bare `DELETE FROM companies WHERE is_demo=TRUE AND trial_end < NOW()-2h AND name NOT IN (...)` with no child-row deletion first, against 130 tables carrying a `company_id` FK to `companies.id`, only 10 of which cascade. The fix (reuse the existing topological-delete helper already implemented in `/api/admin/provision-demo`) is mechanical but is itself a schema/runtime change and is scoped into Branch 6 above, not implemented in this review.

---

## 9. Final staging acceptance requirements

All Branch 1–7 (7 conditional) acceptance criteria pass on staging, plus:
- Staging `/api/version` reports the exact commit being considered for promotion.
- Staging `/api/health` is `ok`.
- No open CI-required-check failures.
- No critical/high-severity item remains in the "launch-blocking" list (§5) unresolved or unaccepted.

## 10. Production promotion prerequisites

- All staging acceptance requirements (§9) green.
- Database backup taken immediately before Branch 2's FK migration and before any Branch 6 schema change (repo already has an established backup convention — `/root/backups/`, `/var/backups/paylink/`).
- Explicit sign-off recorded against each of the 9 blockers in §2 (fixed, or risk formally accepted with a named owner — not silently dropped).
- CSRF/rate-limit rollout has completed its canary period on staging with no regressions before being promoted as globally active in production.
- Rollback plan (§11) reviewed and understood by whoever executes the promotion.

## 11. Rollback expectations

- **Branch 1 (role-alias fix):** gate the "acting as tenant" requirement behind a flag so it can be disabled instantly if it blocks legitimate platform-staff work; reverting the alias-narrowing commit restores current (documented-as-broken) behavior — acceptable short-term since it's strictly a security improvement, not a relied-upon feature.
- **Branch 2 (FK):** additive, reversible — the constraint can be dropped without data loss if it ever blocks a legitimate write path that the orphan check missed. Do not promote without a clean orphan check first (§7, Branch 2).
- **Branch 3 (CSRF/rate-limit):** ship behind a feature flag with a one-route canary; flag can be flipped off instantly if it breaks a legitimate flow (particularly the Capacitor app or the two-legged signing-token flows) without a code rollback.
- **Branch 4 (Stripe hardening):** new table is additive and unused by any other code path; dropping it is safe, though not planned.
- **Branch 5 (email verification / recover):** the `0.5g`-style backfill (`verified_at = created_at` for existing users) is a one-way, idempotent `UPDATE ... WHERE verified_at IS NULL` — safe to re-run, rollback is "do nothing further." Retiring `RECOVERY_TOKEN` should happen only after its replacement is confirmed working, so there's a fallback path during the cutover window.
- **Branch 6 (demo containment):** feature-flag the new ordered multi-table delete against the old single-table delete during rollout so a bad delete-order can be reverted to "no-op but safe" without a code rollback; guards at integration boundaries are additive fail-closed checks — reverting only removes the check, it doesn't worsen current behavior.
- **Branch 7 (conditional batch):** same pattern as Batches 1–5 — scoped route-level fixes, revertable per-commit.
- **All branches:** staging and production commit SHAs are recorded before and after every promotion (via `/api/version`, already exposed on staging; production's `/api/version` should be extended to expose the commit SHA the same way staging's does, so promotions are independently verifiable the same way this review verified §Recovery — this is itself a small recommended fix, not scoped into any blocker above since it's an operational/observability gap, not a security one).
