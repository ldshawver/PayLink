# MyPayLink SaaS-Readiness — Phase 0: Gap Analysis

Companion to `architecture.md` (read that first for citations' full context). Every item here is evidence-backed against the same commit (`51b911a`). Severity: **BLOCKER** (must fix before any paid/public launch), **HIGH** (must fix before scaling past a handful of paying tenants), **MEDIUM** (should fix in the phase where it's touched), **LOW** (polish / config decision).

---

## 1. Critical launch blockers

| # | Finding | Evidence | Severity |
|---|---|---|---|
| B1 | **Demo cleanup job cannot delete any demo tenant with real usage.** `jobDemoCleanup` issues a single-table `DELETE FROM companies` with no cascade; only 10 of 157 `companyId` FKs cascade. Every deletion of a used demo tenant throws a Postgres FK-violation, caught and silently logged. | `server/workers/orchestrator.ts:97-109`, `architecture.md §5c` | **BLOCKER** |
| B2 | **Legacy shared demo tenant (`/api/demo/login`) is a real production tenant shared by every visitor**, with a hardcoded password (`demo_admin`/`demo123`) and no TTL — permanently excluded from the (already-broken) cleanup job. Violates "nothing is saved," the "unique demo tenant per visitor" requirement, and is a credential-exposure surface (a published, guessable login into a live database record). | `server/routes.ts:24138-24160-ish (demo/login handler)`, `architecture.md §5b` | **BLOCKER** |
| B3 | **Stripe webhook signature verification cannot be confirmed anywhere in application code.** No call to `stripe.webhooks.constructEvent()` exists in the repo. `STRIPE_WEBHOOK_SECRET` is read only as a presence boolean in diagnostics endpoints, never passed to a verification call. Tenant billing state (suspend/reactivate) and invoice/payment status are driven by `JSON.parse()` of the raw POST body. If the one indirect check (inside the third-party `stripe-replit-sync` package, invoked before this parse) does not itself verify against the correct secret, an attacker who can reach `/api/stripe/webhook` can forge `invoice.payment_succeeded`/`customer.subscription.deleted`/`payment_intent.succeeded` events to reactivate, suspend, or mark arbitrary invoices paid. | `server/index.ts:156-237`, `server/billingLifecycle.ts`, `architecture.md §4b` | **BLOCKER — must be independently verified/fixed before Phase 3 billing goes live, and audited even for the existing Treasury payroll-disbursement path** |
| B4 | **No mechanism exists to attach a `stripe_customer_id` to a company on first webhook contact.** `findCompanyByStripeCustomerId()`'s not-found branch is a guaranteed no-op (`LIMIT 0`). Combined with B3/§4b (no Customer/Subscription creation call for tenant billing anywhere in the repo), there is currently no working path from "tenant signs up" to "tenant has a real Stripe subscription" at all — the whole 14-day-trial-to-paid lifecycle is unimplemented, not just incomplete. | `server/billingLifecycle.ts:75-81`, `architecture.md §4b, §9` | **BLOCKER (expected — this is the core of Phase 2/3, flagged here because signup already implies it works)** |
| B5 | **No email verification anywhere in signup.** `POST /api/trial/signup` creates a fully active `admin` user and company in one step and returns a usable temporary password. Combined with no rate limiting confirmed on this endpoint (not found in this pass), this is an open account/tenant-creation surface. | `server/routes.ts:23708-23808`, `architecture.md §9` | **BLOCKER for the target lifecycle (`email_verified` is a named required step)** |
| B6 | **CI does not run the vast majority of the test suite.** Only 1 of 70 test files (`server/__tests__/api-json-guard.test.ts`) executes in CI; the one real cross-tenant IDOR regression test (`tests/security.test.ts`) is not gated at all. Every phase below that claims "add tests" must also wire those tests into CI, or the claim is not enforced. | `.github/workflows/ci.yml:37-55`, `architecture.md §12` | **BLOCKER for any claim of tenant-isolation or billing safety going forward** |

## 2. Tenant-isolation risks

| # | Finding | Evidence | Severity |
|---|---|---|---|
| T1 | Platform-support-tier roles (`platform_support`, `platform_implementation`, and all `platform_*` roles) are silently expanded to tenant-admin-equivalent (`admin`) on **every** `requireRole()`-guarded tenant route, with no impersonation session, no explicit reason, no expiration, no visible banner, and no dedicated audit event distinguishing "platform staff acting on a tenant" from "tenant's own admin acting." This is the exact gap the program brief calls out ("secure support impersonation only if needed, with explicit reason, short expiration, visible banner and immutable audit event") — today it's implicit, standing access, not an audited, time-boxed impersonation flow. | `server/routes.ts:256-279` (`expandRoleForGuard`) | **HIGH** |
| T2 | Three inconsistent platform-role allowlists coexist: `requirePlatformRole()`'s 7-role list, `requireSuperAdmin()`'s single `platform_super_admin` check, and `diagnostics.ts`'s `DIAGNOSTIC_ROLES = {"platform_owner","super_admin","system_admin"}` — none of the latter three strings appear in the other two lists. **Confirmed concrete instance:** `platform_owner` is recognized by `expandRoleForGuard` (full tenant-admin bypass) and `DIAGNOSTIC_ROLES`, but is **absent** from `requirePlatformRole()`'s allowlist — a user with this exact role is rejected by the platform console's own `/api/tenants*` API while having full implicit tenant-admin access everywhere else. See PT2 for the production-tenancy implication. | `server/routes.ts:260-279,306-324,326-334`, `server/diagnostics.ts:8`, `architecture.md §15` | **HIGH — resolve before consolidating into the Phase 1 platform-owner model** |
| T3 | `withTenantContext` middleware explicitly does **not** block requests by design yet ("Full enforcement comes in Phase 4" — the *codebase's own* prior phase numbering, not this program's), and `assertUserCanAccessCompany()` **allows** access when a company has no `tenant_companies` assignment at all (logs a warning, continues) — i.e. any company not yet migrated into the new tenant layer is currently unprotected by the newer tenant-status gate (though still subject to `companies.subscription_status` via `checkTenantGate`). | `server/tenant-context.ts:12-14,148-171` | **MEDIUM (documented, intentional interim state — must be closed out, not just left)** |
| T4 | Only one automated cross-tenant IDOR regression test exists (`testTenantIsolation` in `tests/security.test.ts`) and it is not CI-gated (B6). It also only exercises the `workers` resource — no equivalent coverage found for invoices, proposals, contracts, documents, payroll runs, or the new `tenants`/`tenant_companies` CRUD routes themselves. | `tests/security.test.ts:341-474`, `architecture.md §12` | **HIGH** |
| T5 | `enforceCompanyScope()` (the correct "derive tenant from session, reject client-supplied mismatch" pattern) exists but its usage was confirmed on only a small sample of routes (`server/routes.ts:24556,24564`) in this pass; a full audit of "every tenant-owned API route" across 37k lines was not exhaustively completed in Phase 0 (explicitly out of scope for a discovery-only pass) — this is itself the top item for the Phase 1/7 isolation audit, not a finding that coverage is bad, but that **coverage is unverified at scale**. | `server/routes.ts:447-458` | **HIGH (audit required, not yet performed)** |
| T6 | **Resolved from "unconfirmed" to a precise, mixed finding.** Session-cookie flags ARE explicitly configured and reasonable (`httpOnly`, `secure` in production, `sameSite: "lax"`, PG-backed store, 24h `maxAge`) — no action needed there. **No CSRF token mechanism exists anywhere in the repo** (confirmed absent, not merely unconfirmed). **Rate limiting exists only for `/api/admin/diagnostics/*`**; `/api/trial/signup`, `/api/auth/login`, and `/api/demo/provision` have none. | `server/index.ts:257-285` (cookies), `server/diagnostics.ts:19,100,193-195` (diagnostics-only rate limit), `architecture.md §13` | **MEDIUM — CSRF + public-endpoint rate limiting, not cookie flags** |

## 3. Billing / trial gaps

| # | Finding | Evidence | Severity |
|---|---|---|---|
| BL1 | Trial length is hardcoded to **30 days** at signup (`server/routes.ts:23733`), and **every** marketing page agrees with the code (`index.html`, `features.html`, `demo.html`, `signup.html`, `pricing.html` all say 30 days — confirmed, no internal inconsistency). The conflict is entirely against this program's target of a **14-day** trial, not a code-vs-marketing mismatch. This is a one-line config fact, not a structural gap, but it will silently ship the wrong number if untouched, and 4+ marketing pages need to change in lockstep with the code. | `server/routes.ts:23733`, `architecture.md §14` | **LOW (but must be an explicit decision, not an oversight)** |
| BL2 | No payment-method collection at signup; the marketing page explicitly promises **"No credit card required."** The target lifecycle requires `payment_method_attached` before `trial_active`. This is a product decision, not just an engineering gap — Phase 2 needs an explicit call on whether card-upfront is required, and if so the marketing copy must change in lockstep. | `public-site/public/signup.html:101`, `architecture.md §9` | **HIGH (product decision required)** |
| BL3 | No `subscription_plans` / `plan_features` catalog exists. `companies.planName` is a free-text column with no referential integrity. Plan definitions are not data — see B4/§4b. | `shared/schema.ts:26-69`, `architecture.md §7` | **BLOCKER-adjacent (feeds B4)** |
| BL4 | Two independent tenant-status state machines exist (`companies.subscription_status`, checked by `checkTenantGate`, vs. `tenants.status` / `tenant_commercial_gates.lifecycleState`), with **different value sets** and no confirmed synchronization logic between them. A tenant could be `active_paid` on `companies` and `suspended` on `tenant_commercial_gates` with nothing reconciling the two. | `server/tenant-enforcement.ts:21`, `shared/schema.ts:4669-4682,4002-4017` | **HIGH** |
| BL5 | Webhook signature verification — see B3. | — | **BLOCKER** |
| BL6 | No invoice/payment-summary UI for *platform-level* billing was confirmed beyond the `platform-audit.tsx` "Billing" tab, whose backing data source (`/api/platform/audit/billing`) was not read in this pass — cannot yet confirm it reflects real Stripe invoice data vs. the tenant's own AR `invoices` table. | `client/src/pages/platform-audit.tsx:531` | **MEDIUM (needs follow-up read in Phase 3 design)** |
| BL7 | Trial-expiration reminder emails: not found in this pass (`server/notifications/TenantNotificationService.ts` referenced by `billingLifecycle.ts` but not read in full) — presence/absence of a **pre-expiration** reminder (as opposed to the grace/suspension notifications that do exist, confirmed in `billingLifecycle.ts`) is unconfirmed. | `server/billingLifecycle.ts:106-114,153-160,194-201` | **MEDIUM (needs follow-up read)** |

## 4. Demo-environment gaps

Fully covered in `architecture.md §5`; summarized against the program's explicit demo checklist:

| Requirement | Status | Evidence |
|---|---|---|
| Separate demo hostname/environment | **Not found** — demo runs in the same app/DB as everything else | `architecture.md §5` |
| Separate database/disposable datastore | **Absent** — same `companies` table, same Postgres instance | `architecture.md §5` |
| Seeded fictional data only | Plausible for `/api/demo/provision` (seed service not fully read); confirmed **not** true for `/api/demo/login`'s singleton, which accumulates real interaction history indefinitely | `architecture.md §5a,5b` |
| Unique demo tenant per visitor | True for `/api/demo/provision`; **false** for `/api/demo/login` | `architecture.md §5a,5b` |
| Short TTL | 24h for `/api/demo/provision`; **none** for `/api/demo/login` | `architecture.md §5a,5b` |
| Automatic teardown + cleanup verification | **Broken** — B1 | `architecture.md §5c` |
| Reset button | Not located in this pass — needs a client-side search in Phase 4 | — |
| No prod/staging DB connectivity | **False by construction** — demo lives in the same DB as prod | `architecture.md §5` |
| No real Stripe charges | Consistent with BL2 (no card collection at all in the flows read) | — |
| No real email/SMS/Documenso/etc. | **Not confirmed** — no `isDemo` guard found in `documenso.ts`, `twilio-sms-webhooks.ts`, or `notifications.ts` | `architecture.md §5` |
| No uploaded-document persistence past expiry | Not confirmed either way — needs a dedicated read of the upload/document lifecycle in Phase 4 | — |
| Rate limiting / abuse prevention on demo provisioning | Not found in this pass | — |
| "Demo — data will be deleted" banner | Not confirmed (client-side search not completed) | — |
| FK-safe, PostgreSQL-tested cleanup | **Confirmed broken** — B1 | — |

## 5. Platform-console gaps

Much more exists than a from-scratch build would assume (see `architecture.md §6`). Gaps against the target checklist:

| Requirement | Status |
|---|---|
| Tenant search / lifecycle | **Present** (`platform-tenants.tsx`, `/api/tenants*`) but status values diverge from `companies.subscription_status` (BL4) |
| Trial/active/grace/past-due/suspended/cancelled/archived statuses | Partially present; no single authoritative status enum spans both tenant models; "archived" state not found anywhere |
| Plans, subscription status, renewal dates | **Absent** — no plan catalog (BL3), no renewal-date field found |
| Licensed seats / seat utilization | **Not found** in this pass |
| Server-enforced feature entitlements | Schema present, **zero enforcement** (§7 in architecture.md) |
| Trial extensions with reason + audit | **Not found**; `tenant_commercial_gates`/`feature_overrides` have the *shape* (notes, expiresAt) but no confirmed UI/route for a trial-extension action specifically |
| Subscription cancel/reactivate | Reactivation exists in `billingLifecycle.ts` (webhook-driven only); no platform-operator-initiated cancel/reactivate action confirmed |
| Onboarding progress/blockers | **Present** for the 7-step trial checklist (`onboarding_progress`) and separately for the enterprise path (`onboarding_templates` family); not surfaced together in one console view in this pass |
| Tenant owner/user administration | Partially present via existing user-management routes (not enumerated exhaustively) |
| Environment/deployment location | **Not found** — no `deployment_targets`-equivalent table or field |
| Support cases / operational health | The `platform-audit.tsx` "System"/"Integrations"/"Readiness" tabs cover *technical* health; no support-ticket/case tracking table found |
| Failed jobs / webhook failures / integration health | Orchestrator jobs log to console only, no persisted failed-job table (`architecture.md §1`); `webhook_events` table exists (`shared/schema.ts:3056`) but its population/consumption wasn't traced |
| Billing status, invoices, payments, refunds, credits | Tenant-subscription side: **absent** (BL3/B4); tenant's-own-AR side: present but is a different product feature |
| MRR/ARR/trial-starts/conversion/churn | **Not found** anywhere in this pass |
| Product usage / feature-adoption analytics | `analytics_events` exists with a narrow 7-event allowlist (§11); no adoption dashboard found |
| Manual dedicated-server provisioning requests | **Strong existing foundation**: `TenantProvisioningService.ts` + `tenant_commercial_gates` + `tenant_implementation_projects` already model exactly this kind of manually-gated activation — reusable, needs adaptation not a rebuild |
| Immutable admin audit history | **Present and good**: `authorization_audit_log`, `tenant_provisioning_audit_logs`, `feature_activation_log`, plus a dedicated `platform-audit.tsx` UI already exists |

## 6. Analytics/operations gaps

- Event model is narrower than the target: current `analytics_events` schema has `eventName, userId, companyId, pageSource, metadata, sessionId, ipAddress` (`shared/schema.ts:2626-2636`) — missing `feature`, `outcome`, `duration`, `actorCategory`, and a `correlationId`/request-id.
- The event *name* space is hardcoded to 7 values at the route layer (`server/routes.ts:24122`), not a registry — every new tracked event requires an application code change, not configuration.
- No MRR/ARR/churn/conversion computation found anywhere (expected — depends on B3/B4/BL3 first).
- No job-queue/failed-job table; orchestrator failures are `console.warn` only (`architecture.md §1`).
- No webhook-failure tracking distinct from the Treasury sync tables was confirmed for Documenso/Twilio in this pass.

## 7. Schema mapping — target control-plane tables vs. what exists today

| Target table | Existing equivalent | Verdict |
|---|---|---|
| `platform_tenants` | `tenants` (`shared/schema.ts:4669`) | **Reuse, extend** — needs authoritative status enum reconciled with `companies.subscription_status` (BL4) |
| `tenant_domains` | Not found | **Build new** |
| `tenant_memberships` | `company_user_access` / `user_company_access` (`3912`, `5051`) + `users.companyId` | **Reuse, rename/consolidate** — two tables doing overlapping jobs today |
| `subscription_plans` | Not found (`companies.planName` is free text) | **Build new** (BL3) |
| `plan_features` | `feature_registry` (`4612`) | **Reuse** — schema fits, needs enforcement wiring |
| `tenant_entitlements` | `feature_overrides` (`4632`) | **Reuse** — schema fits, needs enforcement wiring |
| `tenant_licenses` | `tenant_commercial_gates` (`4002`) | **Reuse, generalize beyond the enterprise/dedicated path** |
| `tenant_subscriptions` | Not found (only scalar columns on `companies`/`tenants`) | **Build new** — this is the actual Stripe-subscription-mirroring table the program calls for |
| `subscription_events` | `authorization_audit_log` (billing entries only), `tenant_provisioning_audit_logs` | **Partial** — no dedicated Stripe-event-log table found; webhook events aren't persisted as their own record before being applied (no idempotency-key table found for the tenant-billing webhook path specifically — see B3/B6 on verification) |
| `billing_customers` | `tenants.stripeCustomerId` (scalar) | **Build new proper table** — a scalar column isn't enough once refunds/credits/multiple payment methods are in scope |
| `billing_invoices`/payment summaries | `invoices`/`payments` (tenant's own AR feature — wrong entity) | **Build new** — do not conflate with the AR feature |
| `trial_events` | `trial_signups` (one row, not an event stream) + `analytics_events` (`trial_started` etc.) | **Partial** — no append-only trial-lifecycle-event table |
| `onboarding_checklists` | `onboarding_progress` (fixed 7 steps) + `onboarding_templates`/`onboarding_tasks` (configurable, enterprise path) | **Reuse the templated system**, retire/migrate the hardcoded one |
| `platform_audit_events` | `authorization_audit_log`, `feature_activation_log`, `tenant_provisioning_audit_logs` | **Reuse/consolidate** — three overlapping audit tables today; Phase 1 should pick one authoritative shape |
| `product_usage_events` | `analytics_events` | **Reuse, extend schema** (§6) |
| `tenant_health_snapshots` | Not found | **Build new** |
| `deployment_targets` | Not found | **Build new** |
| `dedicated_deployment_requests` | `license_requests` (`3606`, a contact-form lead table) + `tenant_implementation_projects` (`4080`) | **Partial** — the pieces exist but aren't connected into one request→approval→provision pipeline table |
| Support/operational notes | `tenant_commercial_gates.notes`, `feature_overrides.notes` (free text fields on other tables) | **Build new dedicated table** — notes-as-a-column isn't a support-case system |

## 8. Production-tenancy and internal/complimentary-subscription gaps

The platform owner's own real businesses are, per this program's rules, real production tenants and must be treated identically to customer tenants for isolation, audit, entitlements, retention, and backups — plus an explicit, auditable internal/complimentary billing status. Full evidence in `architecture.md §15`.

| # | Finding | Evidence | Severity |
|---|---|---|---|
| PT1 | No `billing_mode`/internal-subscription concept exists anywhere in the schema (`grep` for `billing_mode`, `is_internal`, `internal_subscription`, `complimentary` in `shared/schema.ts` → zero hits). `companies.subscriptionStatus` defaults to `"active_paid"`, so any company outside the trial-signup path — including the owner's own pre-existing businesses, if operated through this codebase — is indistinguishable from a normal paying customer. No `grantor`, `reason`, `effectiveDate`, `reviewDate`, or dedicated audit-event type exists for "this subscription is internal/complimentary." | `shared/schema.ts:53`, `architecture.md §15` | **HIGH — required before Phase 1's platform tenant console and Phase 3's revenue reporting ship** |
| PT2 | `expandRoleForGuard` grants `platform_owner` (identically to `platform_super_admin`/`platform_admin`) blanket tenant-admin-equivalent access to every `requireRole()`-guarded tenant route (T1), with no distinction between "the platform owner operating their own tenant," "the platform owner supporting a customer tenant," and "a tenant's own admin." This is the concrete instance of the program's rule that platform-owner access must not silently grant tenant payroll/document access — today it does. | `server/routes.ts:260-279`, `architecture.md §15` | **HIGH** |
| PT3 | No existing-production company inventory or company→tenant mapping tooling exists. Pre-existing companies (predating `POST /api/trial/signup`) have no `tenant_companies` row and are treated as "unassigned" — `assertUserCanAccessCompany()` warns and **allows** rather than blocking (T3). No script/route/report enumerates existing `companies` rows or proposes a mapping; per program rules any such mapping must be read-only and must never auto-merge on shared owner/email/address, and no such safe tooling exists yet either. | `server/tenant-context.ts:148-171`, `architecture.md §15` | **BLOCKER for any production tenant-mapping/migration work — not yet attempted, and must not be attempted without this tooling first** |
| PT4 | No mechanism exists to exclude a tenant's revenue from MRR/ARR while still recording its estimated commercial value. Moot today only because MRR/ARR is not computed anywhere (§6) — must be designed into Phase 3's revenue-reporting schema from the start. | `architecture.md §15` | **MEDIUM (design-time requirement)** |

## 9. Auth/tenant-isolation audit — explicit conclusion (direct code review, no live testing performed)

Per program rules, this pass performed **no live testing against any staging or production tenant** and **no live-database inspection**. The following is a static-code-review conclusion only, using the same commit (`51b911a`) already cited throughout this document set:

- **No live cross-tenant IDOR was confirmed or discovered in this pass.** This is not the same as "none exists" — see T5's own scope limitation below.
- **What was directly verified:** `canAccessCompany()` (`server/routes.ts:389-438`), `enforceCompanyScope()` (`server/routes.ts:447-458`), and `withTenantContext`/`assertUserCanAccessCompany` (`server/tenant-context.ts`) all derive company/tenant scope from the **authenticated session**, not from client-supplied input, in every code path read in this pass — this is the correct pattern where it is applied.
- **What remains unverified:** whether every one of the (unknown, not exhaustively counted) tenant-scoped routes in the 37,218-line `server/routes.ts` actually calls one of these guards, versus trusting a client-supplied `companyId`/`workerId`/etc. directly. Only a small sample (`server/routes.ts:24556,24564` for `enforceCompanyScope`, plus the routes exercised by `tests/security.test.ts::testTenantIsolation`) was confirmed correct. T5 (§2 above) already states this precisely: **coverage is unverified at scale, not confirmed good or bad.**
- **Existing automated regression coverage:** exactly one test, `testTenantIsolation()` in `tests/security.test.ts:341-474`, exercises cross-tenant access denial — and only for the `workers` resource (list/read/export/anonymize). It is not part of the CI `test` job (B6) and can only be run manually against a live server, which this Phase 0 pass did not do.
- **Recommendation, not a finding:** the Phase 7a "full route-by-route tenant-isolation audit" (`implementation-roadmap.md`) is the correct venue to either confirm no IDOR exists at scale or find and fix one — this should not be treated as already closed by Phase 0's sampling.

---

*See `implementation-roadmap.md` for how these map to phased PRs, and `launch-checklist.md` for the risk-ranked backlog.*
