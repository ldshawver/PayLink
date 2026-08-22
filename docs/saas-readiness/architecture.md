# MyPayLink SaaS-Readiness — Phase 0: Current Architecture

**Status:** Discovery only. No runtime behavior changed in this document set.
**Scope:** Evidence gathered by direct inspection of a clean worktree at `origin/main` (commit `51b911a3f51c0742a00ca9fd0fc99526d1898662`), 2026-08-22. Every claim below cites an exact file and, where useful, a line number. Nothing here is inferred from filenames alone.

---

## 1. Repo shape and runtime

- Single Node/TypeScript monorepo. `package.json:1` name `rest-express`, version `2.1.1`.
- Server entrypoint `server/index.ts`, run via `tsx server/index.ts` in dev (`package.json` `scripts.dev`) and built to `dist/index.cjs` for production (`scripts.build`, `scripts.start`).
- API layer is a **single 37,218-line file**: `server/routes.ts`. This is the dominant fact about the codebase's maintainability — nearly every route, guard, and inline authorization check lives in one file.
- ORM: Drizzle, schema in `shared/schema.ts` (5,067 lines, **205 `pgTable` definitions**). Deploy mechanism is `drizzle-kit push` (`package.json` `scripts.db:push`) — there is no linear migration history the app depends on at runtime; the 14 files under `migrations/` (`migrations/0000_org_hierarchy_permissions.sql` … `migrations/20260709_contractor_hub_document_lifecycle_repair.sql`) are not the operative source of truth.
- Client: React SPA in `client/src`. A **separate** small static/proxy Node app lives in `public-site/` (own `public-site/package.json`, entry `public-site/server.js`) that serves marketing HTML and proxies `/api/*`, `/app/*`, etc. to the main app on port 8000 (`public-site/server.js:6-38`).
- Background jobs: one hand-rolled orchestrator, `server/workers/orchestrator.ts`, using `setInterval` (not a queue). No queue table, no dead-letter/failed-job tracking beyond `console.warn` (`server/workers/orchestrator.ts:44-47`).
- Deployment: PM2 on a VPS, driven by GitHub Actions SSH steps (`.github/workflows/deploy-app.yml`, `deploy-production.yml`). Not containerized.

## 2. Tenant / organization data model (as it exists today)

Two tenant concepts coexist, at different levels of maturity:

### 2a. `companies` — the operative, load-bearing tenant record
`shared/schema.ts:26-69`. This is what every feature route actually scopes against (`companyId` columns exist on **157** other tables — `grep -c "companyId: varchar" shared/schema.ts` → 157; only **10** of those declare `onDelete: "cascade"`, see §5). Relevant columns already on `companies`:
- `subscriptionStatus` (text, default `"active_paid"`), `planName` (text, default `"starter"`)
- `trialStart`, `trialEnd`, `trialUsed`
- `billingActive`, `paymentMethodOnFile`
- `isDemo` (boolean)
- `stripeFinancialAccountId` (Stripe **Treasury** account, not a billing customer — see §4)

Columns used by billing/gate logic but **not present in `shared/schema.ts`** — added instead via idempotent raw SQL in the server startup path:
- `grace_period_end`, `grace_period_days` — `server/index.ts:1784-1785` (`ALTER TABLE companies ADD COLUMN IF NOT EXISTS …`)
- `agreement_signed_at` — `server/index.ts:2951`
- `stripe_customer_id`, `stripe_subscription_id` — referenced by `server/tenant-enforcement.ts:27-28` and written by `server/billingLifecycle.ts:78,131,219`, but **no corresponding `ALTER TABLE` or `pgTable` field was found** for these two specifically (searched `shared/schema.ts`, `migrations/`, `server/index.ts`) — see Gap Analysis, "schema drift," for the implication.

This is a real drift: `shared/schema.ts` is Drizzle's source of truth for `drizzle-kit push`, but at least 3 live columns on `companies` exist only as ad hoc `ALTER TABLE IF NOT EXISTS` statements in `server/index.ts`, and two more (`stripe_customer_id`/`stripe_subscription_id`) are read/written by application code without a discoverable origin in either mechanism.

### 2b. `tenants` / `tenant_companies` — a newer, additive control-plane layer
`shared/schema.ts:4666-4698`, explicitly commented as "the SaaS customer account… sits above companies… additive."
- `tenants`: `id, name, slug, status (active|trial|demo|suspended|cancelled), primaryAdminUserId, billingContactName, billingContactEmail, stripeCustomerId, defaultTimezone, notes` (`shared/schema.ts:4669-4682`).
- `tenant_companies`: join table, `tenantId, companyId (FK cascade), isPrimary` (`shared/schema.ts:4688-4694`).
- **This is wired up and live**, not dormant: `POST /api/trial/signup` creates a `tenants` row and a `tenant_companies` link in the same transaction as the `companies`/`users` insert (`server/routes.ts:23768-23778`). A full CRUD surface exists: `GET/POST /api/tenants`, `GET/PATCH /api/tenants/:id`, `POST/DELETE /api/tenants/:id/companies[/:companyId]` (`server/routes.ts:30966-31119`), all gated by `requirePlatformRole()` or `requireSuperAdmin()`.
- Resolution at request time: `server/tenant-context.ts` — `getTenantIdForCompany()` joins `tenant_companies`→`tenants` (lines 77-104, 30s cache), `getAccessibleCompanyIds()` reads `company_user_access` (lines 121-138, 15s cache), and `withTenantContext` middleware populates `req.tenantId`/`req.resolvedCompanyId`/`req.accessibleCompanyIds` from the **session-authenticated user**, never from client input (`server/tenant-context.ts:209-233`). Its own docstring says Phase 2/additive: it populates context but by design does not yet block most routes (`server/tenant-context.ts:12-14`).
- `server/tenant-enforcement.ts` (`checkTenantGate`) is the actual status gate: blocks on `trial_expired`, `grace_expired`, `past_due`, `cancelled`, `suspended`, keyed off `companies.subscription_status` (not `tenants.status`) — i.e. the two tenant concepts track overlapping but not identical state machines.

### 2c. Users, roles, cross-company access
- `users` (`shared/schema.ts:334-353`): `role` (free text, not an enum), `companyId`.
- `roles` / `role_permissions` / `user_roles` (`shared/schema.ts:1129-1200`): a granular RBAC schema (per-resource `canView/canCreate/canEdit/…canApproveCompany`) — present but its actual runtime consumption was not traced in this pass; the majority of route guards observed use the simpler `requireRole()`/inline role-string checks below, not this table.
- `user_company_access` (`shared/schema.ts:3912`) / `company_user_access` (`shared/schema.ts:5051`) — secondary-company grants, consumed by `getAccessibleCompanyIds()` (`server/tenant-context.ts:126-129`) and by `canAccessCompany()` (`server/routes.ts:429-438`).
- `enterprises` (`shared/schema.ts:17-24`) — a third tier above `companies`, used by `canAccessCompany()`'s "enterprise sibling" bypass (`server/routes.ts:411-427`), explicitly scoped in Phase 3A commentary to same-tenant siblings only.

## 3. Authorization primitives (server/routes.ts:235-484)

- `requireAuth` (line 235): session presence + MFA-enrollment gate.
- `requireRole(...roles)` (line 282) + `expandRoleForGuard()` (line 260): maps new explicit role names (`tenant_owner`, `tenant_admin`, …) and **all `platform_*` roles** onto legacy strings (`admin`, `manager`, `supervisor`) for backward compatibility with existing route guards. Comment at line 256-258 states platform roles are deliberately treated as tenant-admin-equivalent on tenant-scoped routes "so that platform support staff can assist tenants" — i.e. today, any `platform_support`/`platform_implementation` (and above) user can call ordinary tenant-admin APIs with no separate impersonation session, reason, expiry, or banner (see Gap Analysis).
- `requirePlatformRole()` (line 306): an **explicit allowlist** — `platform_super_admin, platform_admin, platform_sales, platform_implementation, platform_support, platform_billing, platform_auditor` — rejects ordinary tenant admins outright. This is a genuinely reusable, well-built platform/tenant separation primitive.
- `requireSuperAdmin()` (line 326): single-role check for `platform_super_admin`.
- `isPlatformUser()` (line 366): `role.startsWith("platform_")`.
- A **fourth**, independent platform-role allowlist exists in `server/diagnostics.ts:8`: `DIAGNOSTIC_ROLES = new Set(["platform_owner", "super_admin", "system_admin"])` — none of these three strings match the `platform_*` convention used everywhere else in `routes.ts`. This is a real inconsistency across the platform-authorization surface (see Gap Analysis).
- `canAccessCompany()` (line 389): the actual cross-company decision function — platform bypass, same-company, enterprise-sibling (same tenant only), or active `company_user_access` row. Company IDs are compared against the **session user's** `companyId`, not a client-supplied value.
- `enforceCompanyScope(source)` (line 447): middleware that resolves `sessionCompanyId` from the authenticated session and 403s if a client-supplied `companyId` (query or body) doesn't match — a correct "never trust the client" pattern, used selectively (e.g. `server/routes.ts:24556,24564`).
- `blockDemoWrites` (line 339): 403s non-GET requests when `req.session.isDemo` is true. Session-flag-based, applied per-route (must be attached manually — coverage not exhaustively verified across all write routes in this pass).
- `writeAuditLog()` (line 460) writes to `authorization_audit_log` (`shared/schema.ts:3773`) — the one general-purpose audit table in active use today (also used by `billingLifecycle.ts` and `TenantProvisioningService.ts`).

## 4. Billing / Stripe — two distinct, non-overlapping surfaces

**4a. Stripe Treasury (payroll disbursement to workers) — mature, unrelated to SaaS billing.**
`server/stripeClient.ts` (Replit-connector credential resolution, falls back to `STRIPE_SECRET_KEY`/`STRIPE_PUBLISHABLE_KEY` env vars, lines 5-51), `server/webhookHandlers.ts` (`WebhookHandlers.processWebhook`, entirely about `treasury.outbound_payment.*` events driving `payrollPaymentRecords`/`payrollRuns` state, lines 27-258), backed by the `stripe-replit-sync` npm package (`package.json:104`) for the Treasury sync tables. This is the ACH/direct-deposit rail for paying a tenant's own workers — not the mechanism by which MyPayLink charges tenants.

**4b. Tenant subscription billing — partially built, security gap in verification.**
- Webhook endpoint: `POST /api/stripe/webhook`, registered in `server/index.ts:156-237`, mounted with `express.raw()` **before** the global `express.json()` (`server/index.ts:239-245`) — correct ordering for raw-body access.
- **No call to `stripe.webhooks.constructEvent()` exists anywhere in the repository** (`grep -rn "constructEvent" server/` → no results). The route checks only that a `stripe-signature` header is *present* (`server/index.ts:161-163`), then does `WebhookHandlers.processWebhook(req.body, sig)` (delegates to the third-party `stripe-replit-sync` package — whether *that* package verifies the signature against `STRIPE_WEBHOOK_SECRET` could not be confirmed from application code, since the secret is never explicitly passed to it: `getStripeSync()` constructs `StripeSync` with only `poolConfig`/`stripeSecretKey`, `server/stripeClient.ts:76-83`), and then **independently** re-parses the raw body itself — `JSON.parse(req.body.toString())` at `server/index.ts:173` — and drives `payments`/`invoices` status changes (lines 178-214) and tenant lifecycle transitions via `handleTenantBillingEvent` (lines 216-229) directly off that unverified parse. `STRIPE_WEBHOOK_SECRET` is read **only** as a boolean presence flag in three diagnostics endpoints (`server/routes.ts:32592,32909,33171`) — never passed to a verification call.
- Tenant lifecycle handler: `server/billingLifecycle.ts`. Handles `invoice.payment_failed` → `grace_period` (lines 71-116), `invoice.payment_succeeded` → `active_paid` reactivation (119-163), `customer.subscription.deleted` → `suspended` (166-203), `customer.subscription.updated` (206-249), plus a daily sweep `checkAndSuspendExpiredGracePeriods()` (253-292) that auto-suspends companies whose `grace_period_end` has passed. All transitions write to `authorization_audit_log` and call `sendTenantLifecycleNotification()` (`server/notifications/TenantNotificationService.ts`, not read in this pass).
- **Bug found:** `findCompanyByStripeCustomerId()`'s not-found branch (`server/billingLifecycle.ts:75-81`) executes `UPDATE companies SET stripe_customer_id = … WHERE stripe_customer_id IS NULL AND name IS NOT NULL LIMIT 0` — `LIMIT 0` makes this a guaranteed no-op. There is no working path in this file that associates an incoming Stripe customer id with a company for the first time.
- **No Stripe Customer/Subscription/Checkout-Session/SetupIntent creation for tenant signup billing was found.** The only `stripe.customers.create`/`stripe.checkout.sessions.create`/`stripe.paymentIntents.create` calls in the repo (`server/routes.ts:13398, 25404, 25437`) are inside the tenant's own accounts-receivable/invoicing feature (billing the tenant's *customers*, via the `customers`/`invoices`/`payments` tables at `shared/schema.ts:2666-2809` — a separate product feature, not SaaS subscription billing). Consistent with this, the public signup form explicitly advertises **"No credit card required · Cancel anytime"** (`public-site/public/signup.html:101`).
- `tenant_commercial_gates` (`shared/schema.ts:4002-4017`) + `tenant_provisioning_audit_logs` + `tenant_implementation_projects` (`shared/schema.ts:4069-4106`) + `server/provisioning/TenantProvisioningService.ts` form a **separate, more mature gated-activation state machine** (`tenantLifecycleStateEnum`: `pending_activation, active, grace_period, suspended, reactivated, cancelled`, `shared/schema.ts:3993-4000`), driven by named events `agreement.signed, implementation_fee.paid, subscription.activated, payment_method.verified, tenant.provisioning.requested, tenant.provisioned, implementation.started, go_live.approved, subscription.payment_failed, tenant.suspended` (`server/provisioning/TenantProvisioningService.ts:16-26`), gated on `allGatesPassed()` requiring agreement signed + implementation fee paid + subscription active + payment method verified (`TenantProvisioningService.ts:47-53`). This looks purpose-built for **manually-approved / dedicated-deployment onboarding** (matches the target's "DEDICATED SERVER OPTION" workflow closely) rather than self-serve trial signup.

## 5. Demo environment — two independent implementations

**5a. `POST /api/demo/provision`** (`server/routes.ts:24209-24249`) — the newer, better-designed path. Generates a random suffix + a 32-byte portal token, calls `provisionDemoTenant(tx, {...})` inside a DB transaction (service not read in full in this pass; referenced from `server/demo-seed.ts`), sets `req.session.isDemo = true`, TTL = 24 hours (`demoExpiration = Date.now() + 24h`, line 211).

**5b. `POST /api/demo/login`** (`server/routes.ts:24138` area) — a **legacy shared singleton**: looks up a company with `is_demo = TRUE`; if none exists, creates exactly **one** permanent `"Demo Company"` row with a hardcoded login `demo_admin` / `demo123` (`server/routes.ts:24157-24160`) and **no `trial_end`** at all. Every visitor who hits this endpoint logs into the *same* shared tenant. This is the exact "shared production tenant" anti-pattern the target design calls out to avoid.

**5c. Demo cleanup job — confirmed FK-order failure, exactly as suspected.**
`server/workers/orchestrator.ts:97-109` (`jobDemoCleanup`, scheduled daily, `scheduleJob("DemoCleanup", jobDemoCleanup, DAY_MS, 15_000)` at line 237):
```sql
DELETE FROM companies
WHERE is_demo = TRUE AND trial_end IS NOT NULL
  AND trial_end < NOW() - INTERVAL '2 hours'
  AND name NOT IN ('Demo Corp', '__demo_provision__')
```
This is a **single-table `DELETE`** against `companies`, with **no child-row deletion**. `companies.id` is referenced by `companyId` on **157 tables**, of which only **10** declare `onDelete: "cascade"`. Any demo company that has actually been used (has a worker, a time punch, a payroll run, an invoice, etc. — which is the entire point of a demo) will hit a Postgres foreign-key-violation on this `DELETE`. The error is caught and merely logged by `scheduleJob`'s `.catch()` (`server/workers/orchestrator.ts:44-47`) — the job never crashes, it just **silently fails to delete** every non-trivial demo tenant, every day, indefinitely. This is a confirmed launch blocker (see Gap Analysis / Launch Checklist), matching the concern flagged in the program brief.
- The `/api/demo/login` singleton (`'Demo Company'`, `trial_end IS NULL`) is permanently exempt from this job regardless (the `trial_end IS NOT NULL` filter excludes it), compounding 5b.
- **No `isDemo` guard was found in the external-integration call sites checked** (`server/services/documenso.ts`, `server/twilio-sms-webhooks.ts`, `server/notifications.ts` — `grep -n "isDemo|is_demo"` on all three returned nothing). Demo tenants are not confirmed to be prevented from triggering real Documenso/Twilio/email sends server-side; the only enforced demo restriction found is `blockDemoWrites`' read-only gate on ordinary API routes (§3), which is a client-session flag, not integration-level isolation.
- There is no separate demo database, demo hostname, or demo-specific deployment target found — demo tenants live inside the same `companies` table and the same Postgres database as production/trial/paid tenants.

## 6. Platform console — substantially more built than expected

- Front end: `client/src/pages/platform-tenants.tsx` (609 lines) — tenant list/detail/create/edit UI, typed against the `tenants` schema including `stripeCustomerId`. `client/src/pages/platform-audit.tsx` (1,280 lines) — a tabbed "App Doctor" console with tabs for **System, Deploy, Integrations, Features, Roles, Permissions, Routes, Tenants, Contracts, Licensing (with a gate-override mutation), Billing, Migrations, Logs, Permissions, Readiness, npm-audit, Security**, plus an "export audit bundle" JSON download (lines 1209-1220). `client/src/pages/platform-home.tsx` and `client/src/components/platform-sidebar.tsx` provide the console shell/nav.
- Backing routes: `/api/tenants*`, `/api/provisioning/tenants*` (`server/routes.ts:30965-31200`), and a large family under `/api/platform/audit/*` (system, deploy, integrations, features, roles, permissions, routes, tenants, contracts, licensing, billing, migrations, logs, npm-audit, security, readiness, export — enumerated by grepping the query keys in `platform-audit.tsx`).
- `server/diagnostics.ts` / `server/diagnostics-safety.ts` ("App Doctor"): log export/redaction tooling with its own regex-based redaction for secrets/PII/bank/payroll fields (`server/diagnostics.ts:24-27`) and its **own, third** platform-role allowlist (`DIAGNOSTIC_ROLES`, §3) inconsistent with the rest of the platform surface.
- **Gap:** none of `featureRegistry` / `featureOverrides` / `featureActivationLog` (§7) is consulted anywhere server-side outside `shared/schema.ts` itself (`grep -rn "featureRegistry|featureOverrides|isFeatureEnabled|resolveEntitlement" server/` excluding schema → zero hits). The "Features" tab in `platform-audit.tsx` and these tables exist, but nothing in the request path reads them to gate access.

## 7. Licensing / entitlements schema — present, not enforced

- `feature_registry` (`shared/schema.ts:4612-4625`): `featureKey, module, featureName, layer (platform|tenant|employee), tier (starter|professional|enterprise|all), defaultOn, isBeta, billingImpact`.
- `feature_overrides` (`4632-4642`): per-`companyId` `featureKey` enable/disable with `expiresAt`, `enabledBy`, `notes` — i.e. already shaped as a tenant-entitlement-override table with expiration and audit fields.
- `feature_activation_log` (`4649-4660`): append-only log of enable/disable/expiry-update actions.
- As noted in §6, **zero server-side reads** of these three tables were found outside the schema file — no entitlement-resolution service, no route-level feature gate, no UI consumption beyond the audit console's display tab. This is schema without enforcement: a real foundation to build on for Phase 1, not a working feature today.
- There is no `subscription_plans` or `plan_features` catalog table; `companies.planName` is a free-text column (`"starter"` by default) with no referential integrity to any plan definition.

## 8. Public marketing site (`public-site/`)

Static HTML pages exist for: `index.html`, `pricing.html`, `features.html`, `security.html`, `contact.html`, `signup.html`, `demo.html`, `terms.html`, `privacy.html`, plus `vendor-portal.html` and `clock.html`. `signup.html` posts to `POST /api/trial/signup` then `POST /api/auth/login` (`public-site/public/signup.html:232,255`, confirmed against the live handler in §9). `demo.html` posts to `POST /api/demo/provision` (`public-site/public/demo.html:150`) — i.e. the marketing "Try Demo" CTA is wired to the **better** of the two demo implementations (§5a), not the legacy singleton (§5b) — the singleton appears to be reachable only directly by URL/API, not linked from the current marketing site (not exhaustively confirmed for every entry point). `public-site/server.js` is a genuinely separate deployable (own `package.json`) that proxies API calls to the main app on port 8000 — this answers "is the marketing site a separate app": yes, at the process level, though not at the database or hosting-environment level.

## 9. Signup flow — real, transactional, and already close to the target shape for the tenant-creation half

`POST /api/trial/signup` (`server/routes.ts:23708-23808`), fully transactional (`BEGIN`/`COMMIT`/`ROLLBACK`, lines 23751-23799):
1. Validates company name, first/last name, email format, `termsAccepted` boolean, password length.
2. Rejects duplicate email via a `trial_signups` lookup (line 23727) — **not** a `users` table lookup, so this only catches repeat trial *forms*, not literal duplicate accounts through other paths.
3. Inserts `companies` (`subscription_status='trial_active', plan_name='starter', trial_end = now + 30 days`, line 23755) — **30-day trial**, not 14 — a direct conflict with the target's "14-Day Trial" branding and with `demo.html`'s own literal text elsewhere on the site.
4. Inserts `users` (`role='admin'`, tied to the new `companyId`).
5. Inserts `tenants` + `tenant_companies` (§2b).
6. Inserts `trial_signups` (audit/marketing record — company/employee count, terms/privacy version + timestamp, signup IP) and `onboarding_progress` (7-step checklist columns, §10) and one `analytics_events` row (`event_name='signup_completed'`).
7. Returns the plaintext `temporaryPassword` in the JSON response for immediate client-side login.

No email-verification step exists anywhere in this flow or elsewhere in the repo (`grep -i "verify.*email|emailVerified|verification_token"` across `server/routes.ts` and `shared/schema.ts` → no hits besides unrelated e-signature "verification" code). No payment-method collection occurs at signup (§4b).

## 10. Onboarding

`onboarding_progress` (`shared/schema.ts:2643-2659`): one row per (`companyId`,`userId`), boolean steps `stepCompanyDetails, stepFirstEmployee, stepPaySchedule, stepPayrollConfig, stepTimeClock, stepPayrollPreview, stepBankConnected`, plus `onboardingWizardCompleted`. Created automatically at signup (§9.6). This is a fixed, hardcoded 7-step checklist specific to payroll setup — not a configurable checklist template. A **separate**, more general checklist system exists for the dedicated/enterprise path: `onboarding_templates` / `onboarding_template_tasks` / `customer_onboarding_projects` / `onboarding_tasks` (`shared/schema.ts:3407-3492`) — not confirmed wired to the self-serve trial flow.

## 11. Analytics

`analytics_events` (`shared/schema.ts:2626-2636`): `eventName, userId, companyId, pageSource, metadata (text), sessionId, ipAddress, createdAt`. `POST /api/analytics/event` (`server/routes.ts:24121-24135`) validates `eventName` against a **hardcoded allowlist of 7 events**: `pricing_page_view, signup_started, signup_completed, trial_started, view_demo_click, demo_started, subscription_activated`. No `correlationId`/request-id field, no `feature` or `outcome`/`duration` fields, no `actorCategory` — the shape is close to but not identical to the target event model (§ Analytics gap in gap-analysis.md).

## 12. CI/CD and tests

- `.github/workflows/ci.yml`: on PR-to-`main` and push to any non-`main` branch. `build` job runs `npm run build`. `test` job runs **exactly one file**: `npx tsx server/__tests__/api-json-guard.test.ts` (line 55) — none of the other 4 files in `server/__tests__/` and none of the **65** files in `tests/` are executed in CI. `typecheck` job runs `tsc` but is `continue-on-error: true` (advisory only, line 61). `repo-audit` job checks for merge-conflict markers and committed `.env` files.
- `.github/workflows/deploy-app.yml`: triggers on **every push to `main`**, no `workflow_run`/`needs` dependency on `ci.yml` passing (separate, independently-triggered workflow) — deploys straight to `staging.mypaylink.app` via SSH + `git reset --hard origin/main` + PM2 restart (lines 81-96). A merged PR reaches staging automatically regardless of CI outcome.
- `.github/workflows/deploy-production.yml`: `workflow_dispatch` only, requires an explicit `release_tag` input — manual, matches the program's "no production deploy without explicit approval" rule.
- `deploy-paylink.yml` / `deploy.yml`: both explicitly disabled (`if: false`), superseded by `deploy-app.yml`.
- Test inventory: **65 files in `tests/`**, overwhelmingly Contractor Hub / Documenso / payroll / SMS / deployment-validation focused (`contract-signing-*`, `documenso-*`, `contractor-*`, `worker-*`, `twilio-sms-*`, `deploy-*`). **Zero** files target billing, trial lifecycle, demo cleanup, or the platform console. **One** genuine cross-tenant IDOR regression test exists — `tests/security.test.ts`, function `testTenantIsolation()` (lines 341-474ish): creates a second company, a worker in it, a manager scoped to the first, and asserts the manager cannot read/list/export/anonymize the other company's worker. It is an integration-style test against a running server (`fetch` calls) and is **not** part of the CI `test` job (§ above) — it can only be run manually today.

---

*Evidence basis: direct file reads and greps against `/root/worktrees/saas-readiness-phase0` at commit `51b911a`. No code was executed against a live database in producing this document. Continued in `gap-analysis.md`, `implementation-roadmap.md`, `launch-checklist.md`.*
