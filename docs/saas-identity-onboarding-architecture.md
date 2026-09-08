# MyPayLink — SaaS Identity / Onboarding Architecture

**Status:** Discovery + proposal. No code changed. No migration written. Nothing deployed.
**Branch/worktree:** `saas/identity-onboarding-discovery` @ `/root/worktrees/saas-identity-onboarding`, based on `origin/main` = `0991447` (v2.2.6, production).
**Date:** 2026-09-08

---

## 0. State recovery (what is in flight right now)

| Location | Branch | State | Verdict |
|---|---|---|---|
| `/root/PayLink` | `main` (local, **60 behind `origin/main`**) | dirty: `M .env.example`, `M scripts/verify-documenso-env.ts`, `M server/routes.ts` (+4/-2), untracked `ecosystem.config.js`, `table.sql`, `test-results/`, `tests/public-signing-route-whitelist-behavior.test.ts` | **Unrelated Documenso-env / public-signing work. Left untouched. Do not stash/reset.** |
| `/root/worktrees/v2.2.7-check-1099-repair` | `fix/v2.2.7-check-1099-repair` @ `0991447` | dirty: `M server/routes.ts` **(+181 / −48)**, untracked `public/images/` | **This is the in-progress v2.2.7 check/PDF/stub work. Isolated in its own worktree. Not mixed in. Left untouched.** |
| `/root/worktrees/contractor-signer-email` | `fix/contractor-signer-email-resolution` @ `0991447` | clean, 0 commits ahead of `origin/main` | Empty placeholder branch for the signer-email fix (overlaps §8 here). No work lost. |
| `/root/worktrees/mypaylink-usability` | `feat/mypaylink-usability` @ `6d6127f` | clean; `origin/feat/mypaylink-usability: gone` (PR #119 merged) | Stale, already shipped as v2.2.6. |
| GitHub open PRs | — | **none** | — |

**Uncommitted v2.2.7 edits confirmed:** yes — `server/routes.ts` +181/−48 and `public/images/` in the `v2.2.7-check-1099-repair` worktree only. This identity work is on a **separate branch + separate worktree** and will not touch that tree.

No stash used. No reset. No branch deleted.

---

## 1. Current problem

MyPayLink has **three disconnected identity surfaces** and account creation is a manual fourth step:

1. **Login accounts** — `users` (username + bcrypt password + optional `email`, `companyId`, `workerId`, TOTP). Created only via `POST /api/users` (raw `username`+`password` in the request body), or the trial-signup transaction.
2. **Workforce records** — `workers` (employees *and* contractors, discriminated by `worker_type` enum = `employee | contractor`). `POST /api/workers` creates a worker and **never** provisions or links an account.
3. **Global human identity** — `persons` (cross-company, holds `email`, `ssn`, `global_id`). `workers.person_id` is nullable and rarely populated.
4. **AR/AP counterparties** — `customers` (per-company, `customer_type` text, used for invoicing). Vendors are **not** a first-class entity — `vendor` is a free-text string on `expenses` / `contractor_invoices` / `trade_transactions`.

Consequences observed in code:

- **Duplicated email/identity.** The same person's email can independently live on `users.email`, `workers.email`, `workers.work_email`, `persons.email`, `contract_signers.email`, `customers.email` with no link and no dedupe. `users.email` is **not unique** (only `username` is).
- **Two overlapping company-access tables, both live:**
  - `user_company_access` (Drizzle `userCompanyAccess`) — `roleId` FK to `roles`; used by the storage layer + RBAC role assignment UI.
  - `company_user_access` (raw SQL) — `role` **text** (`employee|contractor|supervisor|manager|admin|owner|vendor`), `worker_type`, `is_default_company`; used by `canAccessCompany()` for secondary-company checks.
  - Primary company is still the scalar `users.company_id`.
- **Manual "Create Account" is scattered across 6+ client screens** — `employee.tsx`, `employees.tsx` (orphan, unrouted), `attendance.tsx`, `payroll.tsx`, `company.tsx`, `role-management.tsx` — several posting a **raw password** to `POST /api/users` or `PATCH /api/users/:id`.
- **No invite / email-verification flow exists.** No `account_invites` table, no invite token type in `portal_access_tokens` (`token_type` is used only for portal/onboarding/signature links).
- **Contractor "Hub" is admin-facing, not contractor-facing.** `/api/contractor-*` routes are gated by `requireAuth` + `requireFeature("tenant.finance.contractor-hub")` — a *company feature flag*, not a per-contractor grant. Contractors interact only through **magic-link `portal_access_tokens`** (proposal approve, contract sign). There is no contractor self-signup and no pending-approval queue.
- **Vendor portal** = the same anonymous token pattern (`POST /api/portal/submit-invoice`, `POST /api/portal/generate-token`). No vendor identity, no vendor login, no persistent vendor profile.
- **Trial/license state is smeared across four places:** `companies.subscription_status` (+ `trial_start/end`, `grace_period_end`), `tenants.status`, `trial_signups.subscription_status`, `tenant_commercial_gates.lifecycle_state`. `requireActiveSubscription` reads **only** `companies.subscription_status`; the client `AccountBlocked` reads `user.tenantGate`.
- **Signer "No email on file" bug** (`server/contractor-proposal-identity.ts:104`): `resolveContractorSignerIdentity` looks **only** at `worker.email || worker.work_email`. If the contractor's email is on the linked `persons` row, on a `users` row, or on `company_user_access`, the signer flow wrongly reports no email. Same class of gap in `contractor-hub.tsx:580/5401`.

---

## 2. Current tables & routes involved

### Identity / auth
| Table | Purpose | Key columns |
|---|---|---|
| `users` | login identity | `username`(uniq), `password`, `role`, `company_id`, `worker_id`, `email`(non-uniq), `totp_secret`, `mfa_enabled`, `mfa_enforced_at`, `is_active` |
| `persons` | global human | `email`, `ssn`, `global_id`(uniq) |
| `roles`, `role_permissions`, `permissions`, `permission_groups` | RBAC catalog | |
| `user_roles` | user→role (scoped: `company`/…) | `user_id`, `role_id`, `scope_type`, `scope_id` |
| `user_company_access` | user↔company w/ `role_id` FK | `is_active`, `granted_at`, `revoked_at` |
| `company_user_access` | user↔company w/ `role` text + `worker_type` | `is_default_company`, `permissions` JSON |
| `user_permission_overrides` | per-user grant/deny | `scope`, `is_granted`, `expires_at` |
| `portal_access_tokens` | anonymous magic links | `token_type`, `customer_id`/`invoice_id`/`document_id`/`worker_id`, `expires_at`, `is_revoked` |

### Workforce / contractor / counterparty
| Table | Purpose |
|---|---|
| `workers` | employees + contractors (`worker_type`), `person_id` nullable |
| `worker_documents`, `contractor_documents` | W-9 etc. (contractor docs can be sourced from either) |
| `worker_onboarding`, `worker_onboarding_documents`, `onboarding_audit_log`, `onboarding_packets` | employee onboarding packets |
| `contractor_proposals`, `contractor_contracts`, `contract_signers`, `contractor_invoices`, `contractor_payments`, `contractor_trade_compensation` | Contractor Hub domain (`contractor_id` → `workers.id`) |
| `customers` | AR/AP counterparty (`customer_type`), `portal_access_tokens.customer_id` |

### SaaS / tenant / trial
| Table | Purpose |
|---|---|
| `tenants` | tenant root (`slug` uniq, `status`, `primary_admin_user_id`, `stripe_customer_id`) |
| `tenant_companies` | tenant↔company membership (`is_primary`); FK to `companies` (tenant_id FK preflighted, not applied — see memory) |
| `companies` | company + **embedded billing** (`subscription_status`, `plan_name`, `trial_start/end`, `trial_used`, `billing_active`, `payment_method_on_file`) |
| `tenant_commercial_gates` | activation gate (`agreement_status`, `implementation_fee_status`, `subscription_status`, `payment_method_status`, `lifecycle_state`) |
| `trial_signups` | marketing/trial capture (`subscription_status`, `company_id`, `user_id`) |
| `license_requests` | "request a license" lead form (serial id, `status`) |
| `tenant_implementation_projects`, `tenant_provisioning_audit_logs` | provisioning workflow |
| `onboarding_progress` | per-(company,user) wizard checkboxes |

### Routes
- `POST /api/auth/login` — username+password → session; MFA step-up; loads `worker` from `user.worker_id`. **No trial/license check here.**
- `POST /api/users` / `PATCH /api/users/:id` / `DELETE /api/users/:id` — `requireRole("admin")` + `evaluateUserProvisioning` guard. Raw password.
- `POST /api/workers` / `PATCH` / `DELETE` — `requireRole("admin","manager")` + `requireActiveSubscription`. **No account provisioning.**
- `POST /api/trial/signup` — **public**, transactional: `companies` + `users`(role=admin) + `tenants` + `tenant_companies` + `trial_signups` + `onboarding_progress` + `analytics_events`. Returns a **plaintext temp password** in the JSON response.
- `GET /api/trial/status` — reads `companies` trial fields.
- `POST /api/license/request` — public lead capture.
- `POST /api/portal/generate-token`, `GET /api/portal/validate`, `POST /api/portal/submit-invoice`, `/api/portal/onboarding/*`, `/api/portal/proposals/:id/*` — anonymous token portal.
- `server/contractor-proposal-identity.ts` — `resolveContractorSignerIdentity()` / `resolveProposalContractorIdentity()` — the identity resolver that today only reads the `workers` row.
- Platform console: `/platform/tenants`, `/platform/license-requests` (+ pages under `client/src/pages/platform/`).

---

## 3. Proposed data model (additive)

Keep `users` as the **single login identity**. Add a thin relationship layer and the missing request/portal/license tables. **No column drops in phase 1.**

### 3.1 `account_invites` (new)
```
id, company_id (nullable for platform invites), email (lower-cased, indexed),
invited_user_id (nullable — set once the user row exists),
relationship_kind: enum('employee','contractor','vendor','customer_owner','platform'),
relationship_id (nullable — worker_id / vendor_id / customer_id it will link),
role (text — the role to grant on accept),
token (hashed), status: enum('pending','sent','accepted','revoked','expired'),
invited_by_user_id, expires_at, accepted_at, last_sent_at, created_at
```
Drives "send invite", "resend invite", accept → sets `users` password via the sign-up form (never admin-entered).

### 3.2 `identity_links` (new) — the resolver's backing table
```
id, user_id (FK users, on delete cascade),
subject_type: enum('worker','vendor','customer','person'),
subject_id, company_id (nullable), tenant_id (nullable),
link_status: enum('active','pending_review','revoked'),
verified_email text, linked_by_user_id, created_at, revoked_at
UNIQUE (user_id, subject_type, subject_id)
```
One `users` row ⇄ many relationships (Allen = employee@AdikenInc + contractor + vendor), **without** duplicating the email. Deterministic email match only; a conflicting email creates a `pending_review` row instead of silently merging.

### 3.3 `contractor_access_requests` (new)
```
id, company_id (nullable until matched), invite_token (nullable),
first_name, last_name, email, phone, business_name, trade_type, license_number,
w9_document_id (nullable), requested_company_hint text,
status: enum('pending','approved','rejected','withdrawn'),
reviewed_by_user_id, reviewed_at, created_worker_id (nullable), created_user_id (nullable),
rejection_reason, source_ip, created_at
```
Public route writes `pending`; admin approve → create/link `workers`(`worker_type='contractor'`) + `account_invites` + `identity_links` + `company_user_access(role='contractor')`.

### 3.4 `vendors` (new) + `vendor_portal_access` (new)
`vendors`: `id, company_id, business_name, contact_name, email, phone, tax_id, w9_document_id, status`. Backfill later from the free-text `vendor` strings (**not** in phase 1, not in prod without approval).
`vendor_portal_access`: `id, vendor_id, user_id, company_id, status enum('invited','active','suspended'), invited_by, created_at`.

### 3.5 `tenant_licenses` (new) — single source of truth for entitlement
```
id, tenant_id (FK), company_id (FK, nullable for tenant-wide),
license_state: enum('trial_active','trial_expired','contracted_active','payment_past_due','suspended','cancelled'),
trial_started_at, trial_ends_at, contracted_at, current_period_end,
seat_limit int, enabled_modules jsonb, stripe_subscription_id,
updated_by_user_id, updated_at, created_at
```
`companies.subscription_status` etc. become **derived / mirrored** (kept in sync by a service, dropped only in a much later cleanup PR). `requireActiveSubscription` and login both read `tenant_licenses`.

### 3.6 `users` additive columns
`invite_status` enum(`none`,`invited`,`active`,`suspended`) · `last_login_at` timestamp · `email_verified_at` timestamp · `primary_relationship` text (nullable, informational). Add a **partial unique index** on `lower(email) where email is not null` only after a dedupe audit (phase 1 = audit + report, not the constraint).

---

## 4. Migration plan

| # | File | Content | Applied where |
|---|---|---|---|
| P1 | `migrations/0019_identity_links_and_invites.sql` | CREATE `account_invites`, `identity_links`; ADD nullable `users.invite_status`, `users.last_login_at`, `users.email_verified_at`. All additive, all nullable, no backfill. | dev clone → staging only, on approval |
| P2 | `migrations/0020_contractor_access_requests.sql` | CREATE `contractor_access_requests`. | staging only |
| P3 | `migrations/0021_vendors_and_portal_access.sql` | CREATE `vendors`, `vendor_portal_access`. | staging only |
| P4 | `migrations/0022_tenant_licenses.sql` | CREATE `tenant_licenses`; a **read** view `v_effective_license` reconciling the 4 legacy sources; **no** column drops. | staging only |
| later | (separate cleanup epic) | dedupe `user_company_access` vs `company_user_access`; add `users.email` unique index; demote `companies` billing columns. | not in this scope |

Mechanism: follows the existing 3-way split (`shared/schema.ts` + `drizzle-kit push` for dev, `migrations/*.sql` gated/manual, `server/index.ts` additive boot DDL). New tables go in `schema.ts` **and** a hand-written `migrations/00NN_*.sql`; **no** boot-DDL auto-apply for these (they are not hot-path additive columns).

`git diff --check`, migration validator, typecheck, lint, sensitive-data scan run on every PR.

---

## 5. Risk areas

1. **`server/routes.ts` is 39,133 lines and shared with the uncommitted v2.2.7 work.** Mitigation: new logic in **new modules** (`server/identity/*.ts`), minimal wiring lines in `routes.ts`, land before v2.2.7 rebases or coordinate the rebase.
2. **Two access tables.** Touching either risks regressions in `canAccessCompany` and RBAC. Mitigation: phase 1 **reads** both, writes neither; the resolver is additive.
3. **Signer identity is security-critical** (`resolveContractorSignerIdentity` deliberately blocks all mismatches). Broadening the email lookup must not weaken the "signer must equal the contract's contractor" check — only widen *where we find the email*, still exact-match it.
4. **Trial/license consolidation can lock tenants out** if `tenant_licenses` disagrees with `companies.subscription_status`. Mitigation: phase 5 ships the table + backfill + a **reconciliation report** first; enforcement switch is a separate, reversible flag.
5. **Public routes = attack surface.** Contractor/vendor/customer signup must be rate-limited, captcha-gated, tenant-blind (no existence leakage), and must never auto-grant access without admin approval (except customer trial, which provisions its *own* new tenant).
6. **Cross-tenant leakage via email match.** The resolver must be company/tenant-scoped and must never match on name. Conflicting emails → `pending_review`, never silent merge.
7. **Prod data.** No backfill of prod (`vendors` from free-text, `identity_links` from existing users, `tenant_licenses`) without explicit written approval and a pre-deploy backup.
8. **`employees.tsx` orphan page** — do not "fix" it; confirm unrouted and leave for a separate cleanup.

---

## 6. Phase recommendation

Ship **Phase 1 + Phase 2 together** as the first PR (they are inseparable — the resolver is what makes one-step employee onboarding safe), then one PR per later phase:

| PR | Scope | Migration | Risk |
|---|---|---|---|
| **PR 1** | Shared identity resolver (`server/identity/resolver.ts`) reading `users`/`persons`/`workers`/`company_user_access`; `identity_links` + `account_invites` tables; employee create → optional invite in one workflow (`POST /api/workers` accepts `provisionAccount: 'none'|'invite'|'link'`); account-status chips + resend/disable on the employee profile; **fix the signer "No email on file" path to use the resolver**. Demote the standalone "Account" screens (rename → "Access & Login" under Admin/Security; remove from onboarding paths; keep the routes). | 0019 | Med |
| **PR 2** | `contractor_access_requests` + public "Request Contractor Access" route + admin approval queue; approve → create/link worker + invite + Contractor Hub grant. | 0020 | Med |
| **PR 3** | `vendors` + `vendor_portal_access`; vendor portal (invoice/W-9/agreement upload, payment status, proof-of-payment) with strict vendor-only visibility. | 0021 | Med-High |
| **PR 4** | `tenant_licenses` + reconciliation view/report; wire trial signup + login + `requireActiveSubscription` to read it (behind a flag); platform-console license controls. | 0022 | High |

Every PR: dedicated branch off `origin/main`, staging deploy only, synthetic-actor verification, **stop before production**.

---

## 7. Open questions for you

1. **Vendors:** new first-class `vendors` table (recommended), or extend `customers` with `customer_type='vendor'`?
2. **Login identifier:** move to email-based login, or keep `username` and just guarantee an email exists + is verified?
3. **`user_company_access` vs `company_user_access`:** in scope to converge now, or explicitly deferred to a later cleanup epic (recommended)?
4. **Contractor Hub today is admin-facing.** Confirm the goal is a genuine contractor-facing logged-in Hub (not just better magic links).
5. **Trial temp password** is currently returned in the signup JSON. Switch to invite-link + user-set password in PR 1, or leave for PR 4?
6. Proceed to implement **PR 1** now, or adjust the plan first?
