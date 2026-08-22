# MyPayLink SaaS-Readiness — Phase 0: Implementation Roadmap

This maps the gap analysis onto the phased program from the brief (Phase 1 – Control-plane foundation … Phase 7 – Security and launch). Each phase is broken into PRs sized to land independently, with its own branch, tests, and draft PR, per the program's working rules. **No code is written in this document or in Phase 0.**

Branch naming convention proposed: `saas/phase<N>-<slug>`, e.g. `saas/phase1-platform-role-model`.

---

## Dependency graph

```
Phase 0 (this doc set)
   │
   ▼
Phase 1: Control-plane foundation ──────────────────────────────┐
   │  1.1 Reconcile platform-role model (T2)                     │
   │  1.2 Authoritative tenant status enum (BL4)                 │
   │  1.3 subscription_plans / plan_features catalog (BL3)       │
   │  1.4 Entitlement-resolution service (wires feature_registry/│
   │      feature_overrides — §7 gap)                            │
   │  1.5 platform_audit_events consolidation                    │
   │  1.6 Tenant-isolation audit tooling + CI-gate existing tests │
   │      (B6, T4, T5)                                            │
   └───────────────────────────────────────────────────────────┬─┘
                                                                 │
        ┌────────────────────────────────────────────────────────┴────────────────────┐
        ▼                                                                              ▼
Phase 2: Signup, onboarding, trial                                    Phase 4: Safe demo
   2.1 Email verification (B5)                                           4.1 Isolated demo datastore/hostname
   2.2 Fix trial length + explicit CC-upfront decision (BL1, BL2)        4.2 Retire /api/demo/login singleton (B2)
   2.3 Stripe Customer/Elements payment-method capture                   4.3 Fix DemoCleanup FK ordering (B1)
   2.4 tenant_subscriptions table + Customer/Subscription creation       4.4 isDemo guards on external integrations
       (feeds Phase 3)                                                   4.5 Rate limiting + banner + reset button
        │                                                                        │
        ▼                                                                        │
Phase 3: Billing and revenue                                                     │
   3.1 stripe.webhooks.constructEvent() signature verification (B3, B4) ◄────────┘ (shares webhook infra)
   3.2 subscription_events idempotency table
   3.3 Reconcile companies.subscription_status ↔ tenants.status (BL4)
   3.4 billing_customers / billing_invoices tables (do not reuse AR invoices/customers)
   3.5 Platform-console billing + revenue metrics (MRR/ARR/churn)
        │
        ▼
Phase 5: Platform operations and analytics
   5.1 Extend analytics_events schema (feature/outcome/duration/correlationId)
   5.2 Onboarding funnel / tenant health snapshots
   5.3 Webhook/job failure monitoring (persisted, not console.warn)
   5.4 dedicated_deployment_requests pipeline (reuse TenantProvisioningService + tenant_commercial_gates + license_requests)
        │
        ▼
Phase 6: Product workflow readiness (Contractor Hub/Documenso — becomes ONE workstream, per program rule 9)
   6.1 Full Contractor Hub/Documenso lifecycle validation under the new tenant/entitlement model
   6.2 Payroll/timekeeping/check/invoice regression suites tied to tenant status gates
        │
        ▼
Phase 7: Security and launch
   7.1 Full tenant-isolation route-by-route audit (resolves T5's "coverage unverified at scale")
   7.2 Impersonation flow (resolves T1) — reason, expiry, banner, audit event
   7.3 Billing reconciliation drill (Stripe ↔ tenant_subscriptions ↔ companies.subscription_status)
   7.4 Backup/restore drill
   7.5 CSRF/session/rate-limit confirmation pass (resolves T6's "unconfirmed" items)
   7.6 Staging acceptance → production release plan (separate explicit approval)
```

Phase 4 (demo) has no hard dependency on Phase 2/3 and can run in parallel with them once Phase 1's tenant-status/entitlement model lands, since demo tenants need to plug into the same `isDemo`/status model without becoming a special case. Phase 6 depends on Phase 1's entitlement resolver (feature gates need to exist before Contractor Hub features can be gated by plan).

---

## Phase 1 — Control-plane foundation

**Depends on:** Phase 0 only.

| PR | Scope | Key files touched (additive) | Tests required |
|---|---|---|---|
| 1a | Reconcile the three platform-role allowlists (`requirePlatformRole`, `requireSuperAdmin`, `DIAGNOSTIC_ROLES`) into one exported role set; migrate `diagnostics.ts` to import it. | `server/routes.ts`, `server/diagnostics.ts` | Unit test asserting all three guards agree on a fixed role list |
| 1b | Add `subscription_plans`, `plan_features` tables (Drizzle-tracked, not raw `ALTER TABLE`); seed with clearly-marked placeholder plans per program rule ("If product pricing is not yet decided, use placeholder plans and require owner approval before enabling live billing"). | `shared/schema.ts` | Migration test, insert-and-read round trip |
| 1c | Build the entitlement-resolution service (single function/module consumed by both API middleware and UI) reading `feature_registry` + `feature_overrides` + the new `plan_features`, deny-by-default for any undefined feature key. | new `server/entitlements/` module | Unit tests: deny-by-default, override expiration, trial entitlements |
| 1d | Add `platform_tenants`-authoritative status: either promote `tenants.status` to be authoritative and have `checkTenantGate` read it (with a migration reconciling any drift against `companies.subscription_status`), or formally document `companies.subscription_status` as authoritative and deprecate `tenants.status` — this is a decision this program must make explicitly, not silently pick. | `server/tenant-enforcement.ts`, `shared/schema.ts` | Regression test covering every status transition in `billingLifecycle.ts` |
| 1e | Consolidate audit logging: pick one authoritative `platform_audit_events` shape; migrate/alias `authorization_audit_log`, `tenant_provisioning_audit_logs`, `feature_activation_log` writers onto it (or document why they remain separate). | `server/routes.ts`, `server/provisioning/TenantProvisioningService.ts`, `server/billingLifecycle.ts` | Write-path test per caller |
| 1f | Wire `tests/security.test.ts` and the 4 untested `server/__tests__/*` files into `ci.yml`; add 2-3 more cross-tenant IDOR cases (invoices, proposals) using the same pattern as `testTenantIsolation()`. | `.github/workflows/ci.yml` | Itself is the test work |
| 1g | Initial platform-console tenant list/detail wiring to the reconciled status model (extends existing `platform-tenants.tsx`, does not rebuild it). | `client/src/pages/platform-tenants.tsx`, `/api/tenants*` | Component/integration test |

## Phase 2 — Signup, onboarding, trial

**Depends on:** Phase 1 (role model, entitlement resolver, reconciled status).

| PR | Scope |
|---|---|
| 2a | Email verification: token table + `POST /api/auth/verify-email`, gate `trial_active` transition on verification (resolves B5). |
| 2b | Explicit trial-length + payment-method-upfront decision (product call — see `launch-checklist.md`); if card-upfront is adopted, fix `signup.html` copy in the same PR. Fix the 30-vs-14-day mismatch either way (BL1). |
| 2c | Stripe Elements/SetupIntent integration for payment-method capture at signup, storing only the Stripe payment-method reference (never card data) — feeds Phase 3's Customer/Subscription creation. |
| 2d | Migrate `onboarding_progress`'s hardcoded 7 steps onto the existing `onboarding_templates`/`onboarding_tasks` system so the checklist is configurable, not hardcoded (per program requirement). |
| 2e | Rate limiting on `/api/trial/signup`, `/api/auth/login`, `/api/demo/provision` (resolves part of T6). |

## Phase 3 — Billing and revenue

**Depends on:** Phase 2 (payment method capture must exist first).

| PR | Scope |
|---|---|
| 3a | Add `stripe.webhooks.constructEvent()` verification to `/api/stripe/webhook`, using `STRIPE_WEBHOOK_SECRET` explicitly — resolves B3. Confirm/replace the `stripe-replit-sync` dependency's own verification behavior as part of this PR (read its source once installed, don't assume). |
| 3b | `tenant_subscriptions` + `billing_customers` + `billing_invoices` tables (Drizzle-tracked); Stripe Customer + Subscription-with-14-day-trial creation on trial start; store IDs, never re-derive financial totals locally — normalized status snapshots only. |
| 3c | Fix `findCompanyByStripeCustomerId`'s no-op branch (B4) so first-webhook-contact correctly associates a customer id. |
| 3d | `subscription_events` table for webhook idempotency (dedup by Stripe event id) — resolves the "replay safety" requirement. |
| 3e | Platform-console billing tab: real invoices/payment summaries/refunds/credits sourced from `billing_invoices`, reconciled from provider events (not locally computed totals). |
| 3f | MRR/ARR/trial-conversion/churn metrics computed from `subscription_events` + `tenant_subscriptions`. |
| 3g | Staging Stripe test-mode confirmation + explicit guard preventing live-mode keys in non-production environments. |

## Phase 4 — Safe demo

**Depends on:** Phase 1 (status/entitlement model) for how demo tenants report status; otherwise independent of Phases 2/3.

| PR | Scope |
|---|---|
| 4a | Fix `jobDemoCleanup`'s FK ordering — either add cascading deletes to the remaining 147 `companyId` FKs (broad, risky) or (recommended) give the cleanup job an explicit per-table deletion order / use `DELETE ... CASCADE` semantics only after confirming blast radius, or move demo tenants to a physically separate schema/database so cleanup is a drop, not a cascade — this is the single biggest design decision in Phase 4 and should be made explicitly, see `launch-checklist.md`. Resolves B1. |
| 4b | Retire `/api/demo/login`'s shared singleton in favor of always calling the same provisioning path as `/api/demo/provision` (resolves B2). Requires a decision on redirecting/removing the endpoint vs. an in-place migration. |
| 4c | Add `isDemo` guards at the integration layer (Documenso, Twilio, notifications), not just at the route-write layer — resolves the "never rely only on session.isDemo" requirement by moving the check closer to the external call. |
| 4d | Demo banner, reset button, rate limiting/abuse prevention on `/api/demo/provision`. |
| 4e | Cleanup verification tests run against a real PostgreSQL instance (not mocked) proving zero orphaned rows after teardown across all 157 `companyId`-bearing tables. |

## Phase 5 — Platform operations and analytics

**Depends on:** Phase 3 (billing data) for revenue metrics; Phase 1 for the audit/entitlement backbone.

| PR | Scope |
|---|---|
| 5a | Extend `analytics_events` schema: `feature`, `outcome`, `duration`, `actorCategory`, `correlationId`; move the event-name allowlist from a hardcoded array to a registry table. |
| 5b | `tenant_health_snapshots` table + scheduled 1-5 minute refresh job (reuses the orchestrator pattern, adds persisted failure tracking instead of `console.warn`). |
| 5c | `deployment_targets` + `dedicated_deployment_requests` pipeline connecting `license_requests` (lead capture) → operator review/pricing/approval → `tenant_implementation_projects`/`TenantProvisioningService` (existing provisioning gate machinery) → activation. Explicitly no automatic server/DNS/secret creation, per program rule. |
| 5d | Onboarding-funnel and feature-adoption dashboards in the platform console, reading the extended analytics events. |

## Phase 6 — Product workflow readiness

**Depends on:** Phase 1 (entitlement resolver — Contractor Hub/Documenso features need to be gateable by plan/tenant status once billing is real).

| PR | Scope |
|---|---|
| 6a | Full Contractor Hub/Documenso lifecycle validation against the new tenant-status/entitlement gates (does the signing flow correctly block for a suspended tenant, etc.) — this is where the *existing* 65-file Contractor Hub test suite gets connected to the new control plane rather than being replaced. |
| 6b | Payroll/timekeeping/check/invoice regression suites, tenant-scoped, CI-gated (extends 1f's CI-wiring work to the rest of `tests/`). |
| 6c | Feature-specific launch gates in the entitlement resolver for each major module (payroll, contractor hub, treasury/ACH). |

## Phase 7 — Security and launch

**Depends on:** all prior phases.

| PR | Scope |
|---|---|
| 7a | Full route-by-route tenant-isolation audit of `server/routes.ts` (resolves T5) — likely the largest single PR in the program by review effort, may need to be split by resource area. |
| 7b | Support impersonation flow: explicit reason capture, short expiration, visible banner, immutable audit event (resolves T1) — replaces the current implicit `expandRoleForGuard` bypass with an auditable, time-boxed mechanism. |
| 7c | Billing reconciliation drill: verify `tenant_subscriptions`/`billing_invoices` match live Stripe state end-to-end in staging test mode. |
| 7d | Backup/restore drill, tenant-deletion/data-export workflow (California privacy considerations), Terms/Privacy/Trial disclosure review. |
| 7e | CSRF/session/cookie flag confirmation, rate-limit confirmation across login/signup/demo/billing endpoints (resolves T6). |
| 7f | Staging acceptance sign-off, production release plan document — **actual production deployment requires a separate explicit approval outside this program's scope**, per program rule 8. |

---

## Estimated sequence and rough dependency-critical path

1. Phase 1 (foundation) — gates everything else; the role-model reconciliation (1a) and status-model decision (1d) are the two items every later phase reads from, so they should land first within Phase 1.
2. Phase 2 and Phase 4 can proceed in parallel once Phase 1 lands (different engineers/branches, no shared files of consequence — Phase 2 touches `server/routes.ts` signup routes and `public-site/`, Phase 4 touches `server/workers/orchestrator.ts` and the demo routes).
3. Phase 3 depends on Phase 2's payment-method capture (2c) being real before Stripe Subscription creation (3b) has anything to attach to.
4. Phase 5 depends on Phase 3 for revenue metrics but its operational-health pieces (5b, job monitoring) can start as soon as Phase 1 lands.
5. Phase 6 depends on Phase 1's entitlement resolver; it does not depend on Phase 2/3/4/5 completing, only on the resolver existing.
6. Phase 7 is last by definition — it audits the surface every other phase created.

Every PR above gets its own branch off the then-current `origin/main`, its own tests, and its own draft PR, per program rule 7. None of this is implemented in Phase 0.
