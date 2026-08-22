# MyPayLink — SaaS-Readiness Gap Analysis (Phase 0)

Each item cites the evidence it's based on. Severity: **BLOCKER** (must fix before any self-service paid
launch), **HIGH** (must fix before general availability), **MEDIUM** (should fix during the relevant
phase), **DECISION** (not a bug — needs an explicit product/business decision before engineering proceeds).

## 1. Launch blockers

### 1.1 Demo cleanup will fail against real PostgreSQL FK constraints — BLOCKER
`jobDemoCleanup()` (`server/workers/orchestrator.ts`) issues a single
`DELETE FROM companies WHERE is_demo = TRUE AND trial_end < NOW() - INTERVAL '2 hours' ...` with no
pre-deletion of dependent rows. ~120 of the ~130 foreign keys referencing `companies.id` in
`shared/schema.ts` do not have `onDelete: cascade` (only 10 do). Any demo tenant that has exercised the
product (created a worker, clocked in, generated an invoice, etc.) will have child rows in one of those
120+ tables, and the DELETE will raise a foreign-key violation. The job has no visible error handling
around this specific delete, so demo companies with real usage are never actually removed — this is the
exact FK-order failure the program brief called out. **This alone blocks calling the demo environment
"ephemeral."**

### 1.2 Demo tenants are created inside the shared production/staging database — BLOCKER
`provisionDemoTenant()` (`server/demo-seed.ts`) inserts directly into the same `enterprises`/`companies`
tables real tenants use, distinguished only by `isDemo=true`. There is no separate database, schema, or
disposable datastore. Combined with 1.1, expired-but-undeleted demo tenants accumulate permanently in
the primary dataset. This directly contradicts the required design ("separate database or disposable
tenant datastore... nothing is saved").

### 1.3 Demo write-blocking relies solely on a session flag — BLOCKER
`blockDemoWrites` (`server/routes.ts:339-344`) rejects non-GET requests only when `req.session?.isDemo`
is truthy. This is exactly the anti-pattern the brief prohibits ("never rely only on `session.isDemo` or
client-side write blocking") — there is no server-side re-verification against the tenant's actual
`companies.is_demo` value at the point of write, and the seed step's own writes (which do persist) are
outside this check's scope entirely.

### 1.4 CI does not run the test suite — BLOCKER (process, not code)
`.github/workflows/ci.yml`'s `test` job runs exactly one file
(`npx tsx server/__tests__/api-json-guard.test.ts`) out of 70+ test files in the repo. Every phase of
this program will add tests; without CI actually executing them, "tests pass" is not a real merge gate.
Fix this before Phase 1 lands its first migration/entitlement PR, or none of this program's own test
coverage will be enforced either.

### 1.5 Entitlement middleware fails open for unregistered features — BLOCKER (security/licensing)
`requireFeature()` (`server/routes.ts:35674-35719`): "Feature not in registry — allow by default
(forward-compatible)" (line 35698). Any route that calls `requireFeature("some.key")` for a key not yet
present in `feature_registry` **grants access**, not denies it. This is the opposite of the program's
explicit requirement: "deny-by-default behavior for undefined paid features." Today it's low-impact
because only 4 routes call `requireFeature` at all — but it must be inverted before entitlement
enforcement is extended to paid-tier gating broadly, or every new gated route is a silent bypass until
someone remembers to register it.

## 2. Tenant-isolation risks

### 2.1 `users.companyId` has no foreign-key constraint — HIGH
`shared/schema.ts:339`: `companyId: varchar("company_id")` — no `.references(() => companies.id)`,
unlike ~120 other tables. The single most security-critical join in the system (which company a user
belongs to) is enforced only in application code, never at the database layer. An application bug or a
bad manual data fix can silently orphan or mis-assign a user's company.

### 2.2 Two parallel, only-partially-reconciled membership/role systems — HIGH
`companyUserAccess` (free-text `role`) and `userCompanyAccess` + `roles`/`rolePermissions` (normalized
RBAC) both exist and are both live (a one-time backfill from one into the other runs at boot in
`server/index.ts`). Every tenant-isolation and role-authorization audit has to check both paths, and it's
easy for a future feature to check one and not the other, creating an authorization gap. This needs
consolidation before the platform-console owner/user-administration requirement can be built on solid
ground.

### 2.3 No tenant-isolation / IDOR regression tests exist under `tests/` — HIGH
No file names matching isolation/IDOR/cross-tenant/cross-company were found in `tests/` (one related file,
`server/document-hub-tenant-isolation.test.ts`, exists outside that directory and is not run by CI per
1.4). The program requires cross-tenant IDOR regression tests; today there is no baseline to build on or
compare against.

### 2.4 `checkTenantGate` and `billingLifecycle` disagree on the grace-period status string — HIGH
`server/tenant-enforcement.ts:56` checks `if (status === "grace")`, but every writer of
`subscription_status` for the grace state — `billingLifecycle.ts:91`, `:139` (via
`checkAndSuspendExpiredGracePeriods`) — uses the literal `"grace_period"`. The `"grace"` branch in
`checkTenantGate` is therefore dead code; a tenant whose status is `grace_period` falls through to the
function's default `return { allowed: true }`, which happens to still allow access (arguably correct
today) but does so **without evaluating `grace_period_end`** — the expiry check that branch was supposed
to perform never runs, and access is only actually cut off once the separate
`checkAndSuspendExpiredGracePeriods` cron flips status to `suspended`. This needs to be fixed as part of
formalizing the lifecycle state machine in Phase 1/3, not left as an implicit correctness dependency
between two files.

### 2.5 No CSRF protection, no login/signup/demo/billing rate limiting — HIGH
No CSRF middleware exists anywhere in `server/`. No rate limiting exists on authentication, signup, demo
provisioning, or billing endpoints (the only rate-limit code found is in `server/diagnostics.ts`,
unrelated). Both are explicit requirements of the security section and are currently entirely absent.

### 2.6 Session secret has an insecure hardcoded fallback — MEDIUM
`server/index.ts:264`: `secret: process.env.SESSION_SECRET || "paylink-dev-secret"`. If a staging or
production deploy is ever started without `SESSION_SECRET` set, sessions are signed with a secret that is
public in this repository's history, silently. `.env.example` marks `SESSION_SECRET` "REQUIRED in
production" but the code does not enforce that requirement at boot.

## 3. Billing / trial gaps

### 3.1 Nothing creates the Stripe Customer or Subscription that `billingLifecycle.ts` reacts to — BLOCKER
`billingLifecycle.ts` correctly reacts to `invoice.payment_failed`, `invoice.payment_succeeded`,
`customer.subscription.deleted/updated` and drives `companies.subscription_status` through
grace/suspend/reactivate. But no code path in `server/` was found that calls
`stripe.customers.create()` or `stripe.subscriptions.create()` for a newly-signed-up tenant. The trial
signup route (`server/routes.ts:23733-23806`, `POST /api/trial/signup`) computes `trialEnd` as
`now + 30 days` **in application code** and writes it straight to `companies`/`trial_signups` — no Stripe
API call at all. This means today's "trial" is a purely local, unenforced database flag with no
connection to real billing; the entire reactive lifecycle machinery in `billingLifecycle.ts` currently
has nothing to react to for self-service signups.

### 3.2 Trial length conflict: product is built and marketed around 30 days, program spec wants 14 — DECISION
`public-site/public/pricing.html:6-64` explicitly advertises **"30-day free trial, no credit card
required"** with FAQ copy describing what happens "During the 30-day free trial." The trial-signup route
hardcodes 30 days (`server/routes.ts:23733`). The SaaS-readiness program spec requires a **14-day**
trial **with a payment method collected upfront**. These are not reconcilable by engineering alone —
changing trial length and dropping "no credit card required" is a live public commercial promise change.
**Needs an explicit product-owner decision before Phase 2 implementation**, and until decided, Phase 2
work should treat trial length and payment-method-required-at-signup as configuration, not a hardcoded
constant.

### 3.3 Webhook signature verification and idempotency are entirely opaque, third-party, and Replit-shaped — HIGH
`WebhookHandlers.processWebhook` (`server/webhookHandlers.ts:6-25`) delegates both signature verification
and replay protection to `sync.processWebhook(payload, signature)` from the third-party
`stripe-replit-sync` package (`server/stripeClient.ts:72-86`, `getStripeSync()`). No in-repo call to
`stripe.webhooks.constructEvent` was found to audit directly. Separately, the AR-invoice and
tenant-billing-lifecycle branches that run *after* that call (`server/index.ts:173-229`) parse the raw
payload a second time and act on it **without any dedup against the `webhook_events` table** (which does
exist, with a unique index on `provider_event_id` — `server/index.ts:1520` — but nothing inserts into it
from this code path). Stripe's documented retry behavior means these branches can run more than once
per logical event; the state transitions are mostly idempotent by luck (UPDATE ... WHERE status NOT IN
(...)) but the notification/audit-log side effects are not guarded, so retries can double-send emails
and double-write audit rows.

### 3.4 Stripe credential resolution has a dead/irrelevant Replit-connector fallback — MEDIUM
`server/stripeClient.ts:5-51` falls back to calling a Replit connector API
(`REPLIT_CONNECTORS_HOSTNAME`) when `STRIPE_SECRET_KEY` is unset. The deployment evidence (PM2, nginx
vhosts) indicates the app runs on a VPS, not Replit — this fallback path is very likely unreachable in
staging/production and should be confirmed dead and removed rather than carried forward as billing
infrastructure.

### 3.5 `.env.example` does not document Stripe (or Documenso) variables — MEDIUM
Despite `stripeClient.ts`, `webhookHandlers.ts`, and `billingLifecycle.ts` depending on Stripe
credentials, `.env.example` lists only `DATABASE_URL`, `SESSION_SECRET`, `APP_BASE_URL`, SMTP, OpenAI,
and Twilio variables. Anyone provisioning a new environment from this file alone cannot know Stripe
configuration is required. (Not modified as part of this discovery phase, per working rules.)

### 3.6 No trial-expiration reminder, dunning, or cancellation-disclosure logic found — HIGH
No code implementing pre-expiration trial reminders (email/in-app) or a clearly displayed cancellation
policy was found. `tenant-enforcement.ts` correctly *gates* access once a trial has expired, but nothing
warns the tenant beforehand.

## 4. Demo-environment gaps
(See §1.1–1.3 for blockers.) Additional gaps against the required design:

- No unique demo tenant/session lifecycle beyond a single shared seed function called per request; no
  evidence of TTL enforcement other than the (broken) daily cleanup job.
- No visible rate limiting or abuse prevention specifically on `POST /api/demo/provision` (public,
  unauthenticated).
- No evidence of a "Demo — data will be deleted" banner component; not confirmed either way from routing
  layer alone — needs a UI-level check in Phase 4.
- External integrations (email/SMS/Documenso/etc.) were not confirmed to be simulated in demo mode within
  the scope of this pass — needs explicit tracing per integration in Phase 4, since `demo-seed.ts` seeds
  data directly and does not appear to route through the normal notification pipeline, but this was not
  exhaustively verified for every integration point.

## 5. Platform-console gaps

Substantial pieces already exist (see architecture.md §4–6): tenant list/detail, feature-registry admin
UI, provisioning audit log, commercial gates. Missing against the full target console spec:

- No seat-count / seat-utilization view found.
- No billing/invoices/payments/refunds view scoped to *platform* billing (the existing `invoices`/
  `payments` tables are AR for the tenant's own customers, not MyPayLink's billing of the tenant — see
  architecture.md §7).
- No MRR/ARR/conversion/churn metrics view found.
- No webhook/job-failure monitoring view found (App Doctor is general diagnostics, not
  billing/webhook-specific).
- No dedicated-server / deployment-target request queue UI found (though `TenantProvisioningService` +
  `tenantCommercialGates` are a strong backend seed for this).
- No documented, code-enforced impersonation feature (reason/expiry/banner/audit) exists.

## 6. Analytics/operations gaps

`analyticsEvents` (architecture.md §10) lacks `actorCategory`, `outcome`, `duration`, and a
correlation/request ID field required by the target event model. It stores raw `ipAddress`, which is
fine for abuse/fraud signals but must not be conflated with the "no PII in general analytics" requirement
without a retention/access policy. No product-usage dashboards, onboarding-funnel, or feature-adoption
views were found wired to this table today.

## 7. Schema/service-boundary risk

- `tenants` table is defined in two places (`shared/schema.ts` Drizzle definition and boot-time raw SQL
  in `server/index.ts`) that can drift independently — pick one source of truth (Drizzle + `drizzle-kit
  push`/migrations) before adding more control-plane tables on top of it.
- `tenant_companies` exists but is unused outside `/api/tenants` — decide whether the 1-tenant-to-many-
  companies model is actually the product direction before building further control-plane tables that
  assume it (e.g. `tenant_subscriptions`, `tenant_entitlements` as specified in the brief) on top of
  `tenants` rather than `companies`. This is a foundational Phase 1 design decision, not just an
  implementation detail — see roadmap.md Phase 1.
