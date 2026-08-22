# MyPayLink — SaaS-Readiness Implementation Roadmap (Phase 0 output)

This restates the program's phases with what Phase 0 discovery changes about scope, plus the dependency
graph and risk-ranked backlog. Phase numbering matches the program brief (Phase 0–7). Every implementation
phase gets its own branch, tests, and draft PR per the program's working rules; none of them deploy to
production without separate explicit approval.

## Key decisions this program cannot make alone

Before Phase 1 branches, these need a decision from whoever owns the product/business call (flagged
`DECISION` in gap-analysis.md):

1. **Trial length & no-card-required policy** (gap-analysis §3.2): keep 30 days as marketed today, or
   change to 14 days with upfront payment method, and how to message that change publicly.
2. **`tenants` vs `companies` as the control-plane root** (gap-analysis §7): whether new control-plane
   tables (`tenant_subscriptions`, `tenant_entitlements`, etc.) key off the existing, populated
   `companies` table, or off the mostly-empty `tenants` scaffold as the brief's naming suggests. This
   determines the actual Phase 1 migration shape and should be resolved with one short design spike, not
   assumed.
3. **Pricing/plan catalog**: the brief allows placeholder plans pending real pricing decisions; confirm
   whether the existing `$29 + $4/employee` public pricing is the real starting catalog or a placeholder
   to be replaced.

## Dependency graph

```
Phase 0 (this doc set)
   │
   ▼
Phase 1: Control-plane foundation ──────────────┐
   │  (tenant lifecycle, platform-owner auth,    │
   │   plan/entitlement/license model,           │
   │   entitlement resolver, audit events)       │
   ▼                                             ▼
Phase 2: Signup/onboarding/trial          Phase 5: Platform ops & analytics
   │  (needs Phase 1 lifecycle +                 (needs Phase 1 audit events +
   │   entitlement resolver)                      Phase 3 billing events for MRR/ARR)
   ▼
Phase 3: Billing & revenue
   │  (needs Phase 2's Stripe Customer/
   │   Subscription creation to react to)
   ▼
Phase 4: Safe demo ───────────────────────────── (independent of 2/3 once Phase 1's
   │  (needs Phase 1's isolation patterns          tenant/entitlement model exists;
   │   applied to a disposable datastore)          highest standalone urgency — see below)
   ▼
Phase 6: Product workflow readiness (Contractor Hub/Documenso/payroll)
   │  (independent of 1–5 technically, but should reuse Phase 1's
   │   tenant-isolation test patterns and Phase 1's entitlement resolver
   │   instead of the current ad hoc requireFeature() call sites)
   ▼
Phase 7: Security & launch (gates all of the above before any production launch)
```

**Note:** Phase 4 (safe demo) and Phase 1's isolation/audit work are the two workstreams with the
clearest, already-confirmed blockers (gap-analysis §1.1–1.3, §2.1–2.5) and can start in parallel once
Phase 1's branch/PR scaffolding exists — Phase 4 does not strictly need Phase 2/3 billing work to fix its
own FK/isolation defects, but it does need Phase 1's tenant-model decision (above) so the disposable demo
datastore is built against the right shape.

## Phase-by-phase plan and what Phase 0 changes about each

### Phase 1 — Control-plane foundation
- Resolve the `tenants` vs `companies` decision above; stop the dual raw-SQL/Drizzle definition of
  `tenants` (architecture.md §1, §2) — one migration path only.
- Consolidate `companyUserAccess` vs `userCompanyAccess`/`roles` into a single authoritative
  membership/role model (gap-analysis §2.2); add the missing FK on `users.companyId`
  (gap-analysis §2.1).
- Fix `requireFeature()` to deny-by-default for unregistered keys (gap-analysis §1.5) as part of turning
  it into the "single entitlement-resolution service used by API routes and UI" — extend
  `featureRegistry`/`featureOverrides` rather than replacing them; add seat limits, usage limits, and
  audited platform-owner overrides on top of the existing `featureActivationLog`.
- Fix the `"grace"` vs `"grace_period"` status mismatch (gap-analysis §2.4) while formalizing the
  lifecycle state machine — reuse `tenant_lifecycle_state` enum and `tenantCommercialGates` rather than
  inventing a parallel one.
- Turn on CI execution of the real test suite (gap-analysis §1.4) as an early PR in this phase, before
  landing migrations — otherwise this program's own tests are unenforced from day one.
- Initial platform-console tenant list/detail: extend the existing `/api/tenants` +
  `platform-tenants.tsx` rather than building a parallel one.
- Deliverable: migrations, tenant-isolation regression tests (closing gap-analysis §2.3), audit-event
  writer used consistently (reuse `tenantProvisioningAuditLogs`/`authorization_audit_log` patterns —
  decide on one canonical `platform_audit_events` table rather than three).

### Phase 2 — Signup, onboarding and trial
- Build the actual Stripe Customer + Subscription-with-trial creation that's missing today
  (gap-analysis §3.1) — this is the single largest functional gap in the whole program.
- Public signup, email verification, tenant provisioning, tenant-owner creation: reuse `trial_signups`
  and the `/api/trial/signup` route as a starting point, but move trial-length off the hardcoded 30 days
  (`server/routes.ts:23733`) into plan configuration per the Phase 1 catalog.
- Stripe test-mode payment-method collection via Elements/Checkout (the `@stripe/react-stripe-js`
  dependency is already present in `package.json`, just not wired to a subscription-creation flow).
- Onboarding checklist: reuse `tenantImplementationProjects`/`onboardingProgress` rather than building a
  third.

### Phase 3 — Billing and revenue
- Wire real subscription/invoice webhook events into `billingLifecycle.ts` end-to-end (it already has
  correct grace/suspend/reactivate logic reacting to the right event types — architecture.md §7); add the
  missing idempotency guard using the already-defined but unused `webhook_events` table
  (gap-analysis §3.3).
- Remove or confirm-dead the Replit-connector credential fallback (gap-analysis §3.4); document
  `STRIPE_*` env vars in `.env.example`.
- Trial-expiration reminders and a displayed cancellation policy (gap-analysis §3.6) — currently absent.
- Platform-console billing/revenue views (invoices, payments, refunds, MRR/ARR) — build as a clearly
  separate surface from the existing tenant-facing AR `invoices`/`payments` tables, which serve a
  different purpose (architecture.md §7).

### Phase 4 — Safe demo
- Replace `provisionDemoTenant`'s shared-database approach with an isolated datastore/disposable-tenant
  model (gap-analysis §1.2).
- Replace `jobDemoCleanup`'s single unscoped `DELETE FROM companies` with an FK-safe, dependency-ordered
  teardown, tested against real PostgreSQL (gap-analysis §1.1) — this is the most concretely evidenced,
  reproducible defect in the whole discovery pass and should be one of the first PRs in this phase.
- Replace `blockDemoWrites`'s session-flag-only enforcement with server-side re-verification tied to the
  actual tenant record (gap-analysis §1.3).
- Add rate limiting to `POST /api/demo/provision` (currently unauthenticated and unlimited).

### Phase 5 — Platform operations and analytics
- Extend `analyticsEvents` with `actorCategory`, `outcome`, `duration`, correlation ID rather than
  replacing it; add a retention/access policy for the `ipAddress` column already being collected.
- Build MRR/ARR/conversion/churn views on top of Phase 3's webhook-derived billing events (never derive
  revenue numbers from the local `companies.subscription_status` alone — reconcile from Stripe events per
  the brief's requirement).
- Webhook/job-failure monitoring: extend the App Doctor pattern rather than building a parallel console.
- Dedicated-server request workflow: build on `TenantProvisioningService` + `tenantCommercialGates`,
  which already model exactly this kind of gated, manually-approved activation flow.

### Phase 6 — Product workflow readiness
- Contractor Hub/Documenso lifecycle validation continues as its own workstream (per working rule 9,
  it's one launch-readiness workstream, not the product objective) but should adopt Phase 1's
  entitlement resolver instead of ad hoc `requireFeature()` call sites, and Phase 1's tenant-isolation
  test patterns for its own regression suite.

### Phase 7 — Security and launch
- Full tenant-isolation review building on Phase 1's test suite.
- Billing reconciliation against Stripe as source of truth (Phase 3).
- Backup/restore drill, trial/cancellation disclosures (content depends on the Phase-2 trial-length
  decision), support runbooks, staging acceptance.
- No production launch without a separate explicit approval, per working rule 8.

## Risk-ranked backlog (highest first)

| Rank | Item | Phase | Evidence |
|------|------|-------|----------|
| 1 | Demo cleanup FK-order failure | 4 | gap-analysis §1.1 |
| 2 | Demo tenants share the production database | 4 | gap-analysis §1.2 |
| 3 | No Stripe Customer/Subscription creation exists for trial signup | 2/3 | gap-analysis §3.1 |
| 4 | CI runs 1 of 70+ test files | 1 (prerequisite) | gap-analysis §1.4 |
| 5 | Entitlement middleware fails open for unknown features | 1 | gap-analysis §1.5 |
| 6 | Demo write-blocking is session-flag-only | 4 | gap-analysis §1.3 |
| 7 | `users.companyId` has no FK constraint | 1 | gap-analysis §2.1 |
| 8 | Two parallel membership/role systems | 1 | gap-analysis §2.2 |
| 9 | No tenant-isolation/IDOR regression tests | 1 | gap-analysis §2.3 |
| 10 | No CSRF protection / no auth-endpoint rate limiting | 1/7 | gap-analysis §2.5 |
| 11 | Grace-period status string mismatch | 1 | gap-analysis §2.4 |
| 12 | Webhook idempotency unguarded past third-party layer | 3 | gap-analysis §3.3 |
| 13 | 30-day vs 14-day trial conflict | DECISION before 2 | gap-analysis §3.2 |
| 14 | `tenants` defined twice (Drizzle + raw SQL) | 1 | architecture.md §1 |
| 15 | Session-secret insecure fallback | 1/7 | gap-analysis §2.6 |

## Estimated sequencing

Sequencing is dependency-driven, not calendar-driven (no dates are committed here):

1. Phase 1 branches first (control-plane + CI-enforcement + isolation fixes) — everything else depends on
   its tenant-model decision and entitlement resolver.
2. Phase 4 (safe demo) can start immediately after Phase 1's tenant-model decision lands, in parallel with
   Phase 2 — it's the most self-contained, most concretely evidenced fix set.
3. Phase 2 → Phase 3 are sequential (billing reacts to what signup creates).
4. Phase 5 depends on Phase 1 (audit events) and Phase 3 (billing events) both existing.
5. Phase 6 can proceed in parallel with 2–5 once Phase 1's entitlement resolver exists to migrate onto.
6. Phase 7 is the final gate across all of the above.
