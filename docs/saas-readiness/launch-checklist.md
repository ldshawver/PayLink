# MyPayLink — SaaS Launch Checklist (Phase 0 baseline)

This checklist tracks the target customer experience and platform requirements against what Phase 0
discovery confirmed exists, is partial, or is missing. It is a baseline snapshot, not a sign-off — items
get checked off in the PRs that actually implement them, in later phases. Nothing here was changed by
Phase 0.

Legend: ✅ exists and evidenced · 🟡 partial/needs fixing · ❌ not found · ⏳ needs a product decision first

## Target customer experience

| # | Step | Status | Evidence / gap |
|---|------|--------|-----------------|
| 1 | Visit public MyPayLink website | ✅ | `public-site/` static site with pricing/features/signup/demo/security/contact/terms/privacy pages |
| 2 | Launch a safe interactive demo | 🟡 | `POST /api/demo/provision` works end-to-end but writes into the shared prod/staging DB (gap-analysis §1.2) with a broken cleanup job (§1.1) |
| 3 | Start a new 14-day trial | ⏳🟡 | Trial signup flow exists (`/api/trial/signup`) but is 30 days, no Stripe subscription created (gap-analysis §3.1, §3.2) |
| 4 | Verify email and identity | ❌ | No email-verification step found in the signup route |
| 5 | Create a new tenant/company | ✅ | `companies` row created at signup (`server/routes.ts:23733+`) |
| 6 | Become that tenant's owner administrator | ✅ | Admin user created with `companyId` at signup |
| 7 | Select a plan and provide a payment method | ❌ | No plan-selection UI/API tied to signup found; no Stripe payment-method collection wired to signup |
| 8 | Use enabled features during the trial | 🟡 | `checkTenantGate` allows `trial_active` status through; feature gating itself is only enforced for 4 feature keys (gap-analysis §1.5) |
| 9 | Receive clear trial-expiration notices | ❌ | No reminder logic found (gap-analysis §3.6) |
| 10 | Be charged automatically after 14 days unless cancelled | ❌ | Nothing creates the underlying Stripe subscription (gap-analysis §3.1) |
| 11 | Continue as active paid tenant after successful payment | 🟡 | `billingLifecycle.ts` handles `invoice.payment_succeeded` correctly, but has nothing upstream feeding it yet |
| 12 | Suspended/grace-period/downgrade on payment failure | 🟡 | Grace-period and suspension logic exists and is mostly correct, but has a status-string bug (gap-analysis §2.4) and no upstream subscription to react to |
| 13 | Request dedicated-server deployment (manual review) | 🟡 | No customer-facing request form found, but `TenantProvisioningService`/`tenantCommercialGates` are a strong backend seed for the manual review workflow |

## Platform-owner console

| Requirement | Status | Evidence / gap |
|---|---|---|
| Tenant search and lifecycle | ✅ partial | `/api/tenants` CRUD + `platform-tenants.tsx` (architecture.md §4) |
| Trial/active/grace/past-due/suspended/cancelled/archived statuses | 🟡 | Most statuses exist on `companies.subscription_status`; "archived" and "past_due" as distinct first-class states not confirmed |
| Plans, subscription status, renewal dates | ❌ | No plan catalog table wired to console; no renewal-date field found |
| Licensed seats and seat utilization | ❌ | Not found |
| Server-enforced feature entitlements | 🟡 | Real mechanism exists (`featureRegistry`/`requireFeature`) but fails open and covers 4 features (gap-analysis §1.5) |
| Trial extensions with reason and audit record | ❌ | Not found |
| Subscription cancellation/reactivation | 🟡 | Reactivation logic exists in `billingLifecycle.ts`; no cancellation-initiation UI found |
| Onboarding progress and blockers | ✅ partial | `tenantImplementationProjects`, `onboardingProgress`, `tenant_provisioning_audit_logs` |
| Tenant owner/user administration | 🟡 | Exists but split across two role systems (gap-analysis §2.2) |
| Tenant environment/deployment location | ❌ | Not found (single-environment app today) |
| Support cases and operational health | 🟡 | App Doctor (`appDoctorReports`/`appDoctorRepairTickets`) is a general precedent, not billing/support-case specific |
| Failed jobs, webhook failures, integration health | ❌ | Not found as a console view; `webhook_events` table exists but isn't populated by the billing webhook path (gap-analysis §3.3) |
| Billing status, invoices, payments, refunds, credits | 🟡 | `invoices`/`payments` tables exist but serve tenant-AR, not platform billing (architecture.md §7) |
| MRR, ARR, trial starts, conversion, churn, failed-payment metrics | ❌ | Not found |
| Product usage / feature-adoption analytics | 🟡 | `analyticsEvents` table + a few instrumented events exist; no dashboard |
| Manual dedicated-server provisioning requests | 🟡 | No request intake form; `TenantProvisioningService` is a strong backend seed |
| Immutable administrative audit history | 🟡 | Multiple audit tables exist (`tenantProvisioningAuditLogs`, `authorization_audit_log`, `featureActivationLog`) but are not consolidated into one `platform_audit_events` source |
| Never exposes passwords/session tokens/full payment details/secrets/signing URLs | 🟡 not verified | Not exhaustively audited in Phase 0; needs a dedicated pass in Phase 7 |

## Control-plane data model (target vs. current)

| Target table | Status | Current equivalent |
|---|---|---|
| `platform_tenants` | 🟡 | `tenants` (dual-defined, mostly unused — architecture.md §2) |
| `tenant_domains` | ❌ | Not found |
| `tenant_memberships` | 🟡 | Split across `companyUserAccess` / `userCompanyAccess` |
| `subscription_plans` | ❌ | Plan is a free-text `companies.plan_name`; no catalog table |
| `plan_features` | 🟡 | `featureRegistry.tier` approximates this |
| `tenant_entitlements` | 🟡 | `featureOverrides` |
| `tenant_licenses` | ❌ | Not found |
| `tenant_subscriptions` | 🟡 | Fields live directly on `companies` (`subscription_status`, `stripe_subscription_id`, etc.), not a separate table |
| `subscription_events` | 🟡 | `authorization_audit_log` carries lifecycle-transition rows informally |
| `billing_customers` | 🟡 | `companies.stripe_customer_id` field, not a separate table |
| `billing_invoices`/payment summaries | 🟡 | `invoices`/`payments` exist but are tenant-AR, not platform billing (architecture.md §7) |
| `trial_events` | 🟡 | `trial_signups` captures signup, not a full event stream |
| `onboarding_checklists` | ✅ | `tenantImplementationProjects` + `onboardingProgress` |
| `platform_audit_events` | 🟡 | Three overlapping audit tables, not consolidated |
| `product_usage_events` | 🟡 | `analyticsEvents`, missing several target fields |
| `tenant_health_snapshots` | ❌ | Not found |
| `deployment_targets` | ❌ | Not found |
| `dedicated_deployment_requests` | ❌ | Not found; `tenantCommercialGates`/`TenantProvisioningService` are the closest analog |
| support/operational notes | 🟡 | `tenant_commercial_gates.notes`, `tenants.notes` exist as free-text fields, not a structured notes/case system |

## Process gates

| Gate | Status |
|---|---|
| CI runs the full test suite on every PR | ❌ — runs 1 of 70+ files (gap-analysis §1.4) |
| Typecheck blocks merge | ❌ — `continue-on-error: true` in `ci.yml` |
| Tenant-isolation regression suite exists | ❌ (gap-analysis §2.3) |
| Staging deploys automatically, production requires explicit manual approval | ✅ — `deploy-app.yml` (push to main → staging) vs `deploy-production.yml` (`workflow_dispatch` + required `release_tag`) |
| `.env.example` documents all required secrets | 🟡 — missing `STRIPE_*`/Documenso vars (gap-analysis §3.5) |

## What Phase 0 explicitly did NOT do

- No code changes, no schema migrations, no data changes.
- No staging/demo/production environment touched.
- No Stripe/Documenso/DNS/nginx/GitHub Actions secrets touched or read.
- No live database queried (all evidence above comes from static reading of `shared/schema.ts`,
  `server/*.ts`, `client/src/*`, `.github/workflows/*.yml`, and `public-site/`).
- The exposed staging QA proposal token referenced in working rule 4 was not retrieved, searched for, or
  repeated anywhere in this document set.
