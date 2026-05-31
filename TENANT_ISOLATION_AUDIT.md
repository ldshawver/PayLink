# Tenant Isolation Audit — Phase 2

**Date:** May 31, 2026
**Scope:** PayLink SaaS — post-Phase-1 (tenants + tenant_companies tables exist)
**Auditor:** Platform Engineering

---

> ⚠️ **Phase 2 Scope Warning:** Phase 2 does **not** yet enforce tenant isolation globally. It creates
> the tenant context foundation (`withTenantContext` middleware, `req.tenantId`, `req.resolvedCompanyId`,
> `req.accessibleCompanyIds`) and documents enforcement gaps. Suspended/cancelled tenants are only
> blocked on routes that explicitly call `assertUserCanAccessCompany`. Most routes do **not** yet call
> it — see Section 5 for the full list and Section 7 for the Phase 3/P0 remediation plan.
> Full per-route enforcement is scoped to Phase 4.

---

## 1. What Already Existed (Pre-Phase-2)

| Helper / Feature | Location | Notes |
|---|---|---|
| `canAccessCompany(userOrCid, targetCid)` | `server/routes.ts:275` | Checks enterprise siblings + company_user_access. Does **NOT** check tenant status. |
| `requireAuth` middleware | `server/routes.ts:125` | Session guard only. |
| `requireRole(...roles)` middleware | `server/routes.ts:172` | Role-based guard. Expands legacy aliases. |
| `requirePlatformRole()` | `server/routes.ts:196` | Platform console guard. |
| `requireSuperAdmin()` | `server/routes.ts:216` | platform_super_admin only. |
| `blockDemoWrites` | `server/routes.ts:230` | Demo session write guard. |
| `isPlatformUser(role)` | `server/routes.ts:256` | Returns true for `platform_*` roles. |
| `isAdminRole(role)` / `isManagerRole(role)` | `server/routes.ts` | Inline role classification. |
| `getSessionCompanyId(req)` | `server/routes.ts:319` | Reads user.companyId from session. |
| `enforceCompanyScope` middleware | `server/routes.ts:330` | Validates ?companyId param matches session company. |
| `requireActiveSubscription` | `server/routes.ts:360` | Checks `companies.subscription_status`. NOT tenant-aware. |
| `company_user_access` table | `shared/schema.ts` | Multi-company user access — backfilled on startup. |
| `tenants` table | `shared/schema.ts:4574` | Added Phase 1. Seeds: Alavont Holding + Demo Tenant. |
| `tenant_companies` join table | `shared/schema.ts:4593` | Added Phase 1. No companies assigned yet. |

---

## 2. What Was Added in Phase 2

| Helper / Feature | Location | Purpose |
|---|---|---|
| `getTenantIdForCompany(companyId)` | `server/tenant-context.ts` | Resolves company → tenant.id via tenant_companies. 30s cache. |
| `getTenantForCompany(companyId)` | `server/tenant-context.ts` | Resolves company → full TenantRecord. Same cache. |
| `getAccessibleCompanyIds(userId, primaryCid)` | `server/tenant-context.ts` | Returns all companies accessible to a user. 15s cache. |
| `assertUserCanAccessCompany(userId, cid, opts)` | `server/tenant-context.ts` | Throws 403 if tenant is suspended/cancelled. Warns if unassigned. |
| `withTenantContext` middleware | `server/tenant-context.ts` | Populates req.tenantId, req.resolvedCompanyId, req.accessibleCompanyIds. |
| `tenantGuard(handler)` | `server/tenant-context.ts` | Wraps route handlers to catch tenant-status 403 errors cleanly. |
| `invalidateTenantCache(cid?)` | `server/tenant-context.ts` | Cache busting after tenant_companies changes. |
| `invalidateUserCompanyCache(uid?)` | `server/tenant-context.ts` | Cache busting after company_user_access changes. |
| Express Request type extensions | `server/tenant-context.ts` | `req.tenantId`, `req.resolvedCompanyId`, `req.accessibleCompanyIds` |
| `/api` route middleware | `server/routes.ts` | `app.use("/api", withTenantContext)` after health endpoints. |

---

## 3. Schema Audit Matrix

### Strongly Company-Scoped Tables (company_id NOT NULL → tenant-safe via FK)

These tables are tenant-isolated at the data layer through a required FK to `companies`.

| Table | Scope Source | Tenant Safe? | Risk | Notes |
|---|---|---|---|---|
| `workers` | company_id NOT NULL | ✅ Yes | Low | Core payroll entity. Well-guarded in routes. |
| `time_punches` | company_id NOT NULL | ✅ Yes | Low | Well-guarded. |
| `time_entries` | company_id NOT NULL | ✅ Yes | Low | Well-guarded. |
| `schedules` | company_id NOT NULL | ✅ Yes | Low | Cross-company scheduling is intentional (worker home company vs schedule company). |
| `payroll_runs` | company_id NOT NULL | ✅ Yes | Low | Admin-only. |
| `recurring_schedules` | company_id NOT NULL | ✅ Yes | Low | |
| `pay_periods` | company_id NOT NULL | ✅ Yes | Low | |
| `pay_period_schedules` | company_id NOT NULL | ✅ Yes | Low | |
| `pay_codes` | company_id NOT NULL | ✅ Yes | Low | |
| `taxes_deductions` | company_id NOT NULL | ✅ Yes | Low | |
| `accrual_accounts` | company_id NOT NULL | ✅ Yes | Low | |
| `wage_history` | company_id NOT NULL | ✅ Yes | Low | |
| `new_hire_defaults` | company_id NOT NULL | ✅ Yes | Low | |
| `pay_formulas` | company_id NOT NULL | ✅ Yes | Low | |
| `contributing_pay_codes` | company_id NOT NULL | ✅ Yes | Low | |
| `contributing_shifts` | company_id NOT NULL | ✅ Yes | Low | |
| `kpi_groups` | company_id NOT NULL | ✅ Yes | Low | |
| `qualification_groups` | company_id NOT NULL | ✅ Yes | Low | |
| `worker_languages` | company_id NOT NULL | ✅ Yes | Low | |
| `worker_memberships` | company_id NOT NULL | ✅ Yes | Low | |
| `time_off_requests` | company_id NOT NULL | ✅ Yes | Low | |
| `schedule_preferences` | company_id NOT NULL | ✅ Yes | Low | |
| `shift_marketplace_listings` | company_id NOT NULL | ✅ Yes | Low | |
| `invoice_term_settings` | company_id NOT NULL | ✅ Yes | Low | |
| `onboarding_progress` | company_id NOT NULL | ✅ Yes | Low | |
| `customers` | company_id NOT NULL | ✅ Yes | Low | |
| `invoices` | company_id NOT NULL | ✅ Yes | Low | |
| `payments` | company_id NOT NULL | ✅ Yes | Low | |
| `payment_method_configs` | company_id NOT NULL | ✅ Yes | Low | |
| `saved_payment_methods` | company_id NOT NULL | ✅ Yes | Low | |
| `recurring_billing_profiles` | company_id NOT NULL | ✅ Yes | Low | |
| `document_folders` | company_id NOT NULL | ✅ Yes | Low | |
| `documents` | company_id NOT NULL | ✅ Yes | Low | |
| `document_signature_requests` | company_id NOT NULL | ✅ Yes | Low | |
| `signature_packages` | company_id NOT NULL | ✅ Yes | Low | |
| `document_audit_logs` | company_id NOT NULL | ✅ Yes | Low | |
| `automation_rules` | company_id NOT NULL | ✅ Yes | Low | |
| `automation_events` | company_id NOT NULL | ✅ Yes | Low | |
| `notifications` | company_id NOT NULL | ✅ Yes | Low | |
| `dam_documents` | company_id NOT NULL | ✅ Yes | Low | |
| `biz_documents` | company_id NOT NULL | ✅ Yes | Low | |
| `reviews` | company_id NOT NULL | ✅ Yes | Low | |
| `remittance_sources` | company_id NOT NULL | ✅ Yes | Low | |
| `remittance_agencies` | company_id NOT NULL | ✅ Yes | Low | |
| `pay_stub_accounts` | company_id NOT NULL | ✅ Yes | Low | |
| `pay_stub_amendments` | company_id NOT NULL | ✅ Yes | Low | |
| `pay_stub_transactions` | company_id NOT NULL | ✅ Yes | Low | |
| `tenant_commercial_gates` | company_id NOT NULL | ✅ Yes | Low | Uses company as tenant proxy (legacy). |
| `tenant_provisioning_audit_logs` | company_id NOT NULL | ✅ Yes | Low | |
| `tenant_implementation_projects` | company_id NOT NULL | ✅ Yes | Low | |
| `company_branding` | company_id NOT NULL UNIQUE | ✅ Yes | Low | One per company. |
| `company_webhook_configs` | company_id NOT NULL | ✅ Yes | Low | |
| `company_compliance_profiles` | company_id NOT NULL | ✅ Yes | Low | |
| `worker_compliance_profiles` | via worker → company_id | ✅ Yes | Low | Parent-scoped. |
| `compliance_audit_events` | company_id NOT NULL | ✅ Yes | Low | |
| `contractor_proposals` | company_id NOT NULL | ✅ Yes | Medium | `canAccessCompany` used. Enterprise siblings create cross-company access. |
| `contractor_contracts` | company_id NOT NULL | ✅ Yes | Medium | Same. |
| `contractor_invoices` | company_id NOT NULL | ✅ Yes | Medium | Same. |
| `contractor_payments` | company_id NOT NULL | ✅ Yes | Low | |
| `contractor_notifications` | company_id NOT NULL | ✅ Yes | Low | |
| `contractor_reminders` | company_id NOT NULL | ✅ Yes | Low | |
| `contractor_templates` | company_id NOT NULL | ✅ Yes | Low | |
| `contractor_branding` | company_id NOT NULL UNIQUE | ✅ Yes | Low | One per company. |

### Nullable company_id Tables (possibly under-scoped)

| Table | Scope Source | Tenant Safe? | Risk | Notes |
|---|---|---|---|---|
| `users` | company_id nullable | ⚠️ Partial | Medium | Platform users intentionally have NULL. Tenant users MUST have companyId. |
| `divisions` | company_id nullable | ⚠️ Partial | Low | Should always have companyId in practice. No route-level null-check. |
| `departments` | company_id nullable | ⚠️ Partial | Low | Same. |
| `branches` | company_id nullable | ⚠️ Partial | Low | Same. |
| `positions` | company_id nullable | ⚠️ Partial | Low | Same. |
| `cost_centers` | company_id nullable | ⚠️ Partial | Low | Same. |
| `jobs` | company_id nullable | ⚠️ Partial | Low | Same. |
| `expenses` | company_id nullable | ⚠️ Partial | **Medium** | Financial data. Routes must verify companyId before returning. |
| `receipts` | company_id nullable | ⚠️ Partial | Medium | Linked to expenses. |
| `stations` | company_id nullable | ⚠️ Partial | Low | Physical device context. |
| `saved_reports` | company_id nullable | ⚠️ Partial | Low | |
| `payroll_payment_methods` | company_id nullable | ⚠️ Partial | Medium | Sensitive payment data. |
| `funding_accounts` | company_id nullable | ⚠️ Partial | **High** | Bank accounts. Routes must enforce company scoping. |
| `payroll_payment_records` | company_id nullable | ⚠️ Partial | Medium | |
| `payroll_payment_audit_logs` | company_id nullable | ⚠️ Partial | Low | Audit trail OK to be sparse. |
| `check_templates` | company_id nullable | ⚠️ Partial | Low | |
| `eligibility_rule_sets` | company_id nullable | ⚠️ Partial | Low | |
| `schedule_audit_logs` | company_id nullable | ⚠️ Partial | Low | |
| `analytics_events` | company_id nullable | ⚠️ Partial | Low | Platform-wide analytics OK. |
| `trial_signups` | company_id nullable | ⚠️ Partial | Low | Pre-onboarding, no tenant yet. |
| `policy_groups` | company_id nullable | ⚠️ Partial | Low | |
| `app_doctor_reports` | company_id nullable | ✅ Intentional | Low | Platform-scoped, may or may not relate to a company. |
| `app_doctor_repair_tickets` | company_id nullable | ✅ Intentional | Low | Same. |
| `feature_overrides` | company_id (column exists) | ⚠️ Partial | Medium | Currently company-scoped. No tenant-level override support yet. See Phase 4. |
| `legal_entities` | company_id nullable | ⚠️ Partial | Low | |
| `recurring_expense_templates` | company_id nullable | ⚠️ Partial | Low | |
| `expense_approval_actions` | company_id nullable | ⚠️ Partial | Low | |
| `payroll_reimbursement_items` | company_id nullable | ⚠️ Partial | Low | |
| `contractor_1099_summaries` | company_id nullable | ⚠️ Partial | Medium | Tax document. Should be enforced. |

### Scoped Through Parent Record (no direct company_id)

These tables are safe via JOIN to a parent that has company_id:

| Table | Parent Table | Tenant Safe? | Notes |
|---|---|---|---|
| `payroll_items` | payroll_runs.company_id | ✅ Via parent | Always queried through payroll_run. |
| `payroll_item_taxes` | payroll_items → payroll_runs | ✅ Via parent | |
| `payroll_overrides` | payroll_items → payroll_runs | ✅ Via parent | |
| `proposal_line_items` | contractor_proposals.company_id | ✅ Via parent | |
| `proposal_attachments` | contractor_proposals.company_id | ✅ Via parent | |
| `proposal_approval_events` | contractor_proposals.company_id | ✅ Via parent | |
| `proposal_versions` | contractor_proposals.company_id | ✅ Via parent | |
| `proposal_negotiations` | contractor_proposals.company_id | ✅ Via parent | |
| `contract_signers` | contractor_contracts.company_id | ✅ Via parent | |
| `contract_versions` | contractor_contracts.company_id | ✅ Via parent | |
| `invoice_line_items` | contractor_invoices.company_id | ✅ Via parent | |
| `invoice_attachments` | contractor_invoices.company_id | ✅ Via parent | |
| `pay_stub_line_items` | pay_stub_accounts.company_id | ✅ Via parent | |
| `accrual_balances` | accrual_accounts.company_id | ✅ Via parent | |
| `accrual_policy_milestones` | accrual_policies | ✅ Via parent | |
| `document_versions` | documents.company_id | ✅ Via parent | |
| `document_signers` | document_signature_requests | ✅ Via parent | |
| `biz_document_items` | biz_documents.company_id | ✅ Via parent | |
| `biz_document_history` | biz_documents.company_id | ✅ Via parent | |
| `biz_document_attachments` | biz_documents.company_id | ✅ Via parent | |
| `worker_documents` | workers.company_id | ✅ Via parent | |
| `employee_contacts` | workers.company_id | ✅ Via parent | |
| `employee_group_configs` | employee_groups | ✅ Via parent | |
| `employee_wage_groups` | workers + companies | ✅ Via parent | |
| `expense_attachments` | expenses.company_id | ⚠️ Partial | Expenses have nullable company_id — risk flows to attachments. |
| `shift_marketplace_requests` | shift_marketplace_listings | ✅ Via parent | |
| `shift_offers` | shift_marketplace_listings | ✅ Via parent | |
| `trade_attachments` | trade_transactions | ✅ Via parent | |
| `trade_transaction_items` | trade_transactions | ✅ Via parent | |
| `dam_document_access_logs` | dam_documents | ✅ Via parent | |
| `contractor_invoice_attachments` | contractor_invoices | ✅ Via parent | |
| `contractor_reminder_logs` | contractor_reminders | ✅ Via parent | |

### Platform-Global Tables (no company scoping — intentional)

| Table | Reason | Notes |
|---|---|---|
| `tenants` | SaaS-global | New Phase 1 table. |
| `tenant_companies` | SaaS-global | New Phase 1 join table. |
| `enterprises` | Cross-company grouping | Legacy. Some overlap with tenants. |
| `persons` | Global identity layer | Shared across companies for same individual. |
| `feature_registry` | Platform catalog | Platform-admin managed. |
| `platform_modules` | Platform catalog | |
| `jurisdictions` | Global tax/compliance | |
| `tax_rules` | Global tax engine | |
| `labor_rules` | Global compliance | |
| `notification_templates` | Platform-global templates | |
| `roles` | Company-configurable | Scoped at query time by company. |
| `role_permissions` | Company-configurable | |
| `permission_groups` | Platform/company roles | |
| `permissions` | Platform catalog | |
| `sms_config` / `smtp_config` | System-global config | One record each. |
| `webhook_events` / `documenso_webhook_events` | Inbound webhook log | OK to be global. |
| `system_documents` | Platform-managed docs | |
| `license_requests` | Platform sales pipeline | |

### Special-Case Tables (need attention)

| Table | Issue | Risk | Recommendation |
|---|---|---|---|
| `privacy_audit_log` | Uses `tenant_id` column populated with `user.companyId` | **High** | Conceptual mismatch. tenant_id should reference tenants.id. Phase 4: migrate to real tenant ID. |
| `breach_incidents` | Has `tenant_id` nullable, no `company_id` | **High** | Unscoped breach records could leak across tenants in audit UI. Phase 4: add company_id and enforce. |
| `company_user_access` | Multi-company per user | Medium | This is correct design but enterprise sibling access means tenant cross-over is possible. |
| `user_company_access` | Alias/legacy of company_user_access | Low | Verify both are same table or one is deprecated. |
| `enterprise_role_permissions` | enterprise_id scoped | Medium | Enterprise ≠ Tenant. Cross-tenant if enterprise spans tenants. |
| `product_api_keys` | company_id NOT NULL (raw key stored) | **High** | Raw API keys in DB. Phase 5: mask to `sk-...last4`, add tenant_id column. |
| `device_tokens` | user_id only, no company_id | Low | Mobile push tokens. Scoped to user — acceptable. |
| `notification_preferences` | user_id only | Low | User-scoped — acceptable. |
| `pay_methods` | No company_id (worker → company) | Low | Scoped via worker. |

---

## 4. Company-to-Tenant Resolution

### Current State
- `tenant_companies` table exists and has a UNIQUE constraint on `(tenant_id, company_id)`.
- `getTenantIdForCompany(companyId)` helper added in this phase.
- **No companies are currently assigned to tenants.** All calls to `getTenantIdForCompany` return `null` for existing companies.
- `assertUserCanAccessCompany` warns and ALLOWS when tenant is unassigned (backwards compatible).

### Verification Steps
```sql
-- Check tenant assignments
SELECT c.id, c.name, tc.tenant_id, t.name AS tenant_name, t.status
FROM companies c
LEFT JOIN tenant_companies tc ON tc.company_id = c.id
LEFT JOIN tenants t ON t.id = tc.tenant_id
ORDER BY t.name NULLS LAST, c.name;

-- Count unassigned companies
SELECT COUNT(*) AS unassigned_count FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM tenant_companies tc WHERE tc.company_id = c.id);

-- View all tenants
SELECT id, name, slug, status FROM tenants ORDER BY status, name;
```

---

## 5. Endpoints NOT Yet Tenant-Safe

The following endpoint groups use company scoping but do NOT enforce tenant-level status (suspended/cancelled):

### CRITICAL — Financial Data
| Endpoint Group | File | Risk |
|---|---|---|
| `GET/POST /api/payroll-runs*` | routes.ts | Payroll data readable for suspended tenant |
| `GET /api/payroll-items*` | routes.ts | |
| `GET /api/pay-stubs*` | routes.ts | |
| `GET/POST /api/funding-accounts*` | routes.ts | Bank account data |
| `GET/POST /api/payroll-payment-records*` | routes.ts | ACH/payment records |

### HIGH — Employee Data
| Endpoint Group | File | Risk |
|---|---|---|
| `GET/POST /api/workers*` | routes.ts | All employee records |
| `GET/POST /api/time-entries*` | routes.ts | Timesheet data |
| `GET/POST /api/time-punches*` | routes.ts | Clock-in/out records |
| `GET/POST /api/schedules*` | routes.ts | Schedules |
| `GET/POST /api/expenses*` | routes.ts | Expense reports |
| `GET/POST /api/documents*` | routes.ts | Document vault |

### MEDIUM — Contractor Hub
| Endpoint Group | File | Risk |
|---|---|---|
| `GET/POST /api/contractor-proposals*` | routes.ts | Partially guarded by `canAccessCompany` |
| `GET/POST /api/contractor-contracts*` | routes.ts | Same |
| `GET/POST /api/contractor-invoices*` | routes.ts | Same |

### LOW — Config/Lookup Data
| Endpoint Group | File | Risk |
|---|---|---|
| `GET /api/companies*` | routes.ts | List endpoints |
| `GET /api/departments*` | routes.ts | |
| `GET /api/positions*` | routes.ts | |
| `GET /api/notifications*` | routes.ts | |

---

## 6. Existing Gaps in `canAccessCompany`

The current `canAccessCompany` helper:
- ✅ Checks user's default company match
- ✅ Checks enterprise siblings (cross-company within same enterprise)
- ✅ Checks `company_user_access` secondary assignments
- ❌ Does NOT check tenant status (suspended/cancelled)
- ❌ Does NOT verify the target company belongs to the same tenant as the user's company

**Risk:** A user in Tenant A can access a company in Tenant B if they happen to share an enterprise_id. This is the enterprise sibling loophole and must be addressed in Phase 4.

---

## 7. Recommended Phase 3 Task List

### P0 — Must Do Before Production Multi-Tenant Launch
1. **Assign all existing companies to tenants** via Platform Console → Tenants → Assign Company. Production companies → Alavont Holding. Demo companies → Demo Tenant.
2. **Fix `canAccessCompany`** to reject cross-tenant enterprise siblings (two companies in the same enterprise but different tenants should NOT cross).
3. **Wire `assertUserCanAccessCompany` into all financial/payroll/employee/contractor route groups** — payroll-runs, funding-accounts, payroll-payment-records, workers, time-entries, time-punches, schedules, expenses, documents, contractor-proposals, contractor-contracts, contractor-invoices (see Section 5 for full list).
4. **Fix `privacy_audit_log.tenant_id`** — column is currently populated with `user.companyId` (a company ID) instead of the actual `tenants.id`. This causes tenant-level audit queries to return incorrect results and must be corrected before any compliance reporting.
5. **Fix `breach_incidents`** — table has no `company_id` or effective `tenant_id`; breach records are entirely unscoped and could surface across tenants in the audit UI. Add `company_id` column and enforce scoping in API and UI.
6. **Mask API keys in `product_api_keys`** — raw secret key values are stored in the database. Move to masked (`sk-...last4`) + hashed storage pattern before any multi-tenant production launch.

### P1 — High Priority
7. **Add `tenant_id` to `feature_overrides`** — allow platform to set features at tenant level (inherited by all companies in tenant).

### P2 — Phase 4 Scope
8. **Wire `assertUserCanAccessCompany` into major route groups** — workers, payroll, time entries, expenses, documents.
9. **Add blocking for unassigned companies** (Phase 2 currently warns + allows).
10. **Add tenant context to audit logs** — `req.tenantId` available in all route handlers for enriched audit trail.
11. **License enforcement gate** — reject API calls if tenant's license is expired (from Phase 2 license tables).

### P3 — Phase 5/6 Scope
12. **Tenant provisioning wizard** — guides platform admin through company assignment.
13. **Demo tenant isolation** — Demo Tenant companies must never be reachable from Alavont Holding context and vice versa.

---

## 8. Manual Verification Steps

After assigning at least two companies to different tenants via Platform Console:

```bash
# Test 1: User in Alavont Holding cannot see Demo Tenant data
# 1. Create/use a user with company_id = Alavont company
# 2. GET /api/workers?companyId=<demo_company_id>
# Expected: 403 Forbidden (cross-company denied by canAccessCompany)

# Test 2: Suspended tenant blocks access
# 1. PATCH /api/tenants/:id with { status: "suspended" }
# 2. GET /api/workers as a user in that tenant's company
# Expected: 403 { reason: "tenant_suspended" } (once assertUserCanAccessCompany is wired in)
# Current Phase 2: req.tenantId will be set but endpoints don't yet assert

# Test 3: Platform admin bypasses tenant gate
# 1. Login as platform_super_admin
# 2. GET /api/tenants (lists all tenants regardless)
# Expected: 200 OK with all tenants listed

# Test 4: Company-to-tenant resolution
# 1. Assign a company to Alavont Holding via UI or API
# 2. GET req will now show req.tenantId = <alavont_id> in server logs
```

---

## 9. Files Changed in Phase 2

| File | Change |
|---|---|
| `server/tenant-context.ts` | **NEW** — all Phase 2 helpers and middleware |
| `server/routes.ts` | Added `app.use("/api", withTenantContext)` + import |
| `TENANT_ISOLATION_AUDIT.md` | **NEW** — this document |
