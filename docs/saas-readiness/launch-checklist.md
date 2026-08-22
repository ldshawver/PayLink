# MyPayLink SaaS-Readiness — Phase 0: Launch Checklist

A risk-ranked backlog. Nothing on this list is done in Phase 0 — this is the gate list for Phases 1-7. Each item cites the finding it resolves (see `gap-analysis.md` for full evidence).

## Must decide before Phase 2/3 engineering starts (product/owner decisions, not engineering tasks)

- [ ] **Trial length**: confirm 14 days (per this program) vs. the currently-coded 30 days (`server/routes.ts:23733`, BL1). Update code and marketing copy together.
- [ ] **Payment method upfront**: does trial signup require a card (target lifecycle implies yes: `payment_method_attached` precedes `trial_active`), or does MyPayLink keep "no credit card required" (current marketing promise, `public-site/public/signup.html:101`) and collect it only before auto-charge at day 14? This changes the Phase 2 signup flow materially (BL2).
- [ ] **Initial plan catalog**: confirm placeholder-plan pricing is acceptable for Phase 1/2, with an explicit owner approval gate before enabling live billing (per program rule under BILLING AND 14-DAY TRIAL / LICENSING sections). (BL3)
- [ ] **Authoritative tenant-status source**: `companies.subscription_status` or `tenants.status`/`tenant_commercial_gates.lifecycleState`? Two systems currently disagree (BL4). Pick one, migrate the other.
- [ ] **Demo cleanup architecture**: cascade the remaining 147 FKs, or move demo tenants to a separate schema/database so teardown is a drop rather than a cascade? This is a foundational Phase 4 design choice, not a bug fix (B1).

## BLOCKER — must close before any real (non-test-mode) billing or public demo access

- [ ] Fix `jobDemoCleanup` FK-order failure so demo tenant deletion actually succeeds against real PostgreSQL, tested against every one of the 157 `companyId`-bearing tables. (B1 → Phase 4a/4e)
- [ ] Retire or fully isolate the `/api/demo/login` shared singleton tenant (hardcoded credentials, no TTL, permanently exempt from cleanup). (B2 → Phase 4b)
- [ ] Add explicit `stripe.webhooks.constructEvent()` signature verification to `/api/stripe/webhook`, confirmed against `STRIPE_WEBHOOK_SECRET`; audit whether `stripe-replit-sync` already does this correctly for the Treasury path before assuming it's covered. (B3 → Phase 3a)
- [ ] Fix the no-op `LIMIT 0` branch in `findCompanyByStripeCustomerId` and implement real Stripe Customer/Subscription creation on trial start — today there is no working path from signup to a real Stripe subscription at all. (B4 → Phase 3b/3c)
- [ ] Add email verification before a tenant/user is treated as fully active. (B5 → Phase 2a)
- [ ] Wire the existing 65+4 untested files (including the one real cross-tenant IDOR test, `tests/security.test.ts`) into CI; no phase's "add tests" claim is enforced until this lands. (B6 → Phase 1f)

## HIGH — must close before scaling past a handful of paying tenants

- [ ] Replace the implicit platform-role tenant-admin bypass (`expandRoleForGuard`) with an explicit, audited, time-boxed impersonation flow (reason, expiry, banner, audit event). (T1 → Phase 7b)
- [ ] Reconcile the three inconsistent platform-role allowlists (`requirePlatformRole`, `requireSuperAdmin`, `diagnostics.ts`'s `DIAGNOSTIC_ROLES`) into one model. (T2 → Phase 1a)
- [ ] Expand cross-tenant IDOR regression coverage beyond the single `workers` resource test to invoices, proposals, contracts, documents, payroll runs, and the new tenant CRUD routes. (T4 → Phase 1f)
- [ ] Perform the full route-by-route tenant-scoping audit across `server/routes.ts` that Phase 0 explicitly did not attempt (only a 5-route sample was checked). (T5 → Phase 7a)
- [ ] Resolve the two-tenant-status-machine split (`companies.subscription_status` vs. `tenants.status`) so nothing can be simultaneously active on one and suspended on the other. (BL4 → Phase 1d/3)
- [ ] Product decision + implementation on payment-method-at-signup (BL2 → Phase 2c).
- [ ] Build a real `subscription_plans`/`plan_features` catalog; stop treating `companies.planName` as authoritative free text. (BL3 → Phase 1b)

## MEDIUM — should close in the phase that naturally touches the area

- [ ] Confirm (don't assume) `isDemo` isolation at the external-integration layer (Documenso, Twilio, email) — not found in this pass, needs a dedicated check. (Demo gap table → Phase 4c)
- [ ] Confirm CSRF protection, session-cookie security flags, and rate limiting on login/signup/demo/billing endpoints — status genuinely unconfirmed in Phase 0, not asserted absent. (T6 → Phase 7e)
- [ ] Confirm whether trial-expiration reminder emails exist (unread code path: `TenantNotificationService.ts`). (BL7 → Phase 3/5)
- [ ] Confirm what `/api/platform/audit/billing` actually sources before building on top of it in Phase 3. (BL6)
- [ ] Consolidate the three overlapping audit-log tables (`authorization_audit_log`, `tenant_provisioning_audit_logs`, `feature_activation_log`) into one authoritative `platform_audit_events` shape, or explicitly document why they stay separate. (§7 schema mapping → Phase 1e)
- [ ] Migrate the hardcoded 7-step `onboarding_progress` checklist onto the existing configurable `onboarding_templates` system. (§10 → Phase 2d)
- [ ] Extend `analytics_events` schema (`feature`, `outcome`, `duration`, `actorCategory`, `correlationId`) and move the event-name allowlist from hardcoded array to registry. (§6/§11 → Phase 5a)
- [ ] Resolve schema drift: bring `grace_period_end`, `grace_period_days`, `agreement_signed_at` (currently raw `ALTER TABLE IF NOT EXISTS` in `server/index.ts`) into `shared/schema.ts` as proper Drizzle columns; locate or recreate the true origin of `stripe_customer_id`/`stripe_subscription_id` on `companies`. (Architecture §2a → Phase 1)

## LOW — polish / explicit config, non-blocking

- [ ] `deploy-app.yml` auto-deploys to staging on every push to `main` independent of `ci.yml`'s pass/fail outcome — consider gating staging deploy on CI success once CI actually covers the suite (post Phase 1f).
- [ ] `typecheck` CI job is advisory-only (`continue-on-error: true`) — revisit once the codebase is in better shape to enforce it.

## Explicit non-goals for this program (per working rules — do not let scope creep here)

- No changes to staging, demo, production, PM2, environment files, Stripe, Documenso, DNS, nginx, or GitHub Actions secrets during Phase 0 or its documentation.
- No retrieval or repetition of the exposed proposal token referenced in program working rules — not encountered in this Phase 0 pass, and must stay that way.
- No LUXit.app, MyOrder.fun, salary/payroll-record-correction, or credential-rotation work folds into this program.
- No automatic server/DNS/database/secret creation for the dedicated-server option — manual review only, every phase.
- No production deployment without a separate, explicit approval outside this program.

---

*This checklist is the Phase 0 deliverable's operational summary. Full evidence for every line item is in `gap-analysis.md`; the phased PR breakdown that resolves each item is in `implementation-roadmap.md`; the underlying file/line citations are in `architecture.md`.*
