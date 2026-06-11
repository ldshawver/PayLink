# PayLink API Permission Matrix

**Generated:** 2026-06-11  
**Routes audited:** 974 (all routes in `server/routes.ts`)  
**Critical gaps patched this session:** 90 endpoints (see §4)

---

## 1. Middleware Legend

| Symbol | Middleware | Meaning |
|--------|-----------|---------|
| `—` | *(none)* | Public — no session required |
| `A` | `requireAuth` | Valid session cookie required |
| `R(x)` | `requireRole(x)` | Authenticated + role in set `x` |
| `PM` | `requirePlatformRole()` | Any `platform_*` role |
| `SA` | `requireSuperAdmin()` | `platform_super_admin` only |
| `PA` | `requirePlatformAudit` | Platform audit token (header-based) |
| `CS` | `enforceCompanyScope(x)` | Tenant-scoped company isolation |
| `AS` | `requireActiveSubscription` | Active billing subscription |
| `FF` | `requireFeature(x)` | Feature flag must be enabled |
| `BD` | `blockDemoWrites` | Blocked in demo tenants |

---

## 2. Public Routes (Intentionally Unauthenticated)

These routes require **no session** by design.

### 2a. Infrastructure & Auth
| Method | Path | Notes |
|--------|------|-------|
| GET | `/health` | Load-balancer health check |
| GET | `/ready` | Readiness probe |
| GET | `/api/health` | Detailed health info |
| POST | `/api/auth/login` | Credential login |
| POST | `/api/auth/mfa/login-verify` | MFA second factor |
| POST | `/api/auth/pin-login` | Kiosk PIN login |
| POST | `/api/auth/recover` | Password recovery |
| POST | `/api/auth/logout` | Session teardown |
| GET | `/api/auth/me` | Returns 401 if unauthenticated |
| POST | `/api/auth/token-restore` | Mobile token restore |

### 2b. Time-Clock Kiosk (Station-Scoped)
These use station-level PIN auth internally; they never expose cross-company data.

| Method | Path |
|--------|------|
| POST | `/api/time-clock/auth` |
| GET | `/api/time-clock/punches` |
| POST | `/api/time-clock/punch` |
| POST | `/api/time-clock/sign-in` |
| POST | `/api/time-clock/clock-in-session` |
| POST | `/api/time-clock/session-info` |
| POST | `/api/time-clock/clock-out-session` |
| POST | `/api/time-clock/break-start` |
| POST | `/api/time-clock/break-end` |
| POST | `/api/time-punches` | Kiosk raw punch intake |
| GET | `/api/clock-in-requests/:id/status` | Station status poll |
| GET | `/api/stations` | Station list (no PII) |
| GET | `/api/client-ip` | Client IP echo |

### 2c. Inbound Webhooks
| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/webhooks/documenso` | Documenso e-sign events |
| POST | `/api/webhooks/product-events` | Product event bus |
| GET/POST | `/api/webhooks/esign/:provider` | Generic e-sign provider |

### 2d. Customer-Facing Payment Portal
| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/stripe/publishable-key` | Stripe public key |
| GET | `/api/pay/:invoiceId` | Invoice view (public) |
| POST | `/api/pay/:invoiceId/create-payment-intent` | Start payment |
| POST | `/api/pay/:invoiceId/confirm-payment` | Confirm payment |
| GET | `/api/payments/stripe-status/:paymentIntentId` | Status poll |

### 2e. Contractor Portal (Token-Gated)
| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/portal/validate` | Token validation |
| POST | `/api/portal/submit-invoice` | Client invoice submit |
| GET | `/api/portal/onboarding/validate` | Onboarding token check |
| PATCH | `/api/portal/onboarding/steps/:stepId` | Step completion |
| POST | `/api/portal/onboarding/upload` | Document upload |
| GET | `/api/onboarding/portal/:token` | Worker onboarding |
| POST | `/api/onboarding/portal/:token/steps/:stepId/complete` | Step complete |
| POST | `/api/onboarding/portal/:token/sign` | Agreement sign |

### 2f. Proposal Client Portal
| Method | Path |
|--------|------|
| GET | `/api/portal/proposals/:id` |
| POST | `/api/portal/proposals/:id/approve` |
| GET | `/api/portal/proposals/:id/attachments` |
| POST | `/api/portal/proposals/:id/message` |
| GET | `/api/portal/proposals/:id/attachments/:attId/download` |
| POST | `/api/contractor-proposals/:id/client-approve` |

### 2g. SaaS Acquisition / Demo
| Method | Path |
|--------|------|
| POST | `/api/trial/signup` |
| POST | `/api/analytics/event` |
| POST | `/api/demo/login` |
| POST | `/api/demo/provision` |
| POST | `/api/license/request` |

---

## 3. Authenticated Routes by Domain

### 3a. Authentication / Session
| Method | Path | Guard |
|--------|------|-------|
| POST | `/api/auth/mfa/enroll` | A |
| POST | `/api/auth/mfa/confirm` | A |
| POST | `/api/auth/mfa/disable` | A |
| GET | `/api/auth/mfa/status` | A |
| POST | `/api/auth/mfa/verify` | A |
| POST | `/api/auth/mfa/enforce` | A R(admin,tenant_admin,tenant_owner) |
| GET | `/api/auth/mfa/enforce-status` | A R(admin,platform_super_admin,platform_admin,tenant_admin,tenant_owner) |

### 3b. Dashboard
| Method | Path | Guard |
|--------|------|-------|
| GET | `/api/dashboard/stats` | A |
| GET | `/api/dashboard/exceptions` | A |
| GET | `/api/dashboard/my-requests` | A |
| GET | `/api/dashboard/pending-approvals` | A |
| GET | `/api/dashboard/clock-status` | A |

### 3c. Workers & Users
| Method | Path | Guard |
|--------|------|-------|
| GET | `/api/workers` | A |
| GET | `/api/workers/:id` | A |
| POST | `/api/workers` | R(admin,manager) |
| PATCH | `/api/workers/:id` | A R(admin,manager) |
| DELETE | `/api/workers/:id` | R(admin) |
| GET | `/api/users` | R(admin,manager) |
| POST | `/api/users` | R(admin) |
| PATCH | `/api/users/:id` | R(admin) |
| DELETE | `/api/users/:id` | R(admin) |
| GET | `/api/contractors` | A R(admin,manager) |
| GET | `/api/workers/:id/data-export` | A R(admin,tenant_owner,tenant_admin) |
| POST | `/api/workers/:id/anonymize` | A R(admin,tenant_owner,tenant_admin) |

### 3d. HR Profile Sub-resources
| Method | Path | Guard |
|--------|------|-------|
| GET | `/api/qualifications` | A |
| POST | `/api/qualifications` | A R(admin,manager) |
| PATCH | `/api/qualifications/:id` | A R(admin,manager) |
| DELETE | `/api/qualifications/:id` | A R(admin,manager) |
| GET | `/api/reviews` | A |
| POST | `/api/reviews` | A R(admin,manager) |
| PATCH | `/api/reviews/:id` | A R(admin,manager) |
| DELETE | `/api/reviews/:id` | A R(admin,manager) |
| GET | `/api/worker-languages` | A |
| POST | `/api/worker-languages` | A |
| PATCH | `/api/worker-languages/:id` | A |
| DELETE | `/api/worker-languages/:id` | A |
| GET | `/api/worker-memberships` | A |
| POST | `/api/worker-memberships` | A |
| PATCH | `/api/worker-memberships/:id` | A |
| DELETE | `/api/worker-memberships/:id` | A |
| GET | `/api/qualification-groups` | A |
| POST | `/api/qualification-groups` | R(admin,manager) |
| GET | `/api/kpi-groups` | A |
| GET | `/api/wage-history` | A |
| POST | `/api/wage-history` | A R(admin,manager) |
| PATCH | `/api/wage-history/:id` | A R(admin,manager) |
| DELETE | `/api/wage-history/:id` | A R(admin,manager) |

### 3e. My Profile (Self-Service)
| Method | Path | Guard |
|--------|------|-------|
| GET | `/api/my/worker` | A |
| PATCH | `/api/my/worker` | A |
| PATCH | `/api/my/preferences` | A |
| GET | `/api/my/paystubs` | A |
| GET | `/api/my/documents` | A |
| GET | `/api/my/reviews` | A |
| GET | `/api/my/qualifications` | A |
| POST | `/api/my/qualifications` | A |
| PATCH | `/api/my/qualifications/:id` | A |
| DELETE | `/api/my/qualifications/:id` | A |
| GET | `/api/my/languages` | A |
| POST | `/api/my/languages` | A |
| DELETE | `/api/my/languages/:id` | A |
| GET | `/api/my/memberships` | A |
| POST | `/api/my/memberships` | A |
| DELETE | `/api/my/memberships/:id` | A |
| POST | `/api/my/change-pin` | A |
| POST | `/api/my/change-password` | A |

### 3f. Companies & Org Hierarchy
| Method | Path | Guard |
|--------|------|-------|
| GET | `/api/companies` | A |
| GET | `/api/companies/:id` | A |
| POST | `/api/companies` | R(admin,manager) |
| PATCH | `/api/companies/:id` | A R(admin,manager) |
| DELETE | `/api/companies/:id` | R(admin) |
| GET | `/api/departments` | A |
| POST | `/api/departments` | A R(admin,manager) |
| PATCH | `/api/departments/:id` | A R(admin,manager) |
| DELETE | `/api/departments/:id` | A R(admin,manager) |
| GET | `/api/jobs` | A |
| POST | `/api/jobs` | A R(admin,manager) |
| PATCH | `/api/jobs/:id` | A R(admin,manager) |
| DELETE | `/api/jobs/:id` | A R(admin,manager) |
| GET | `/api/enterprises` | A |
| POST | `/api/enterprises` | R(admin,manager) |
| GET | `/api/legal-entities` | A |
| POST | `/api/legal-entities` | R(admin,manager) |
| PATCH | `/api/legal-entities/:id` | R(admin,manager) |
| DELETE | `/api/legal-entities/:id` | R(admin,manager) |

### 3g. Time & Attendance
| Method | Path | Guard |
|--------|------|-------|
| GET | `/api/time-entries` | A |
| POST | `/api/time-entries` | A R(admin,manager) |
| PATCH | `/api/time-entries/:id` | A R(admin,manager) |
| DELETE | `/api/time-entries/:id` | A R(admin,manager) |
| GET | `/api/schedules` | A |
| POST | `/api/schedules` | A AS |
| PATCH | `/api/schedules/:id` | A R(admin,manager) |
| DELETE | `/api/schedules/:id` | A R(admin,manager) |
| POST | `/api/schedules/generate` | A R(admin,manager) |
| GET | `/api/recurring-schedules` | A R(admin,manager) |
| POST | `/api/recurring-schedules` | A R(admin,manager) |
| PATCH | `/api/recurring-schedules/:id` | A R(admin,manager) |
| DELETE | `/api/recurring-schedules/:id` | A R(admin,manager) |
| GET | `/api/schedule-preferences` | A |
| POST | `/api/schedule-preferences` | A |
| PATCH | `/api/schedule-preferences/:id` | A |
| DELETE | `/api/schedule-preferences/:id` | A |
| GET | `/api/time-off-requests` | A |
| GET | `/api/time-off-requests/:id` | A |
| POST | `/api/time-off-requests` | A |
| PATCH | `/api/time-off-requests/:id` | A |
| PATCH | `/api/time-off-requests/:id/review` | A R(admin,manager,supervisor) |
| DELETE | `/api/time-off-requests/:id` | A |
| GET | `/api/schedule-audit-logs` | A R(admin,manager) |

### 3h. Payroll
| Method | Path | Guard |
|--------|------|-------|
| GET | `/api/payroll-runs` | A R(admin,manager) |
| POST | `/api/payroll-runs` | A R(admin,manager) |
| PATCH | `/api/payroll-runs/:id` | A R(admin,manager) |
| DELETE | `/api/payroll-runs/:id` | A R(admin) |
| GET | `/api/payroll-items` | A R(admin,manager) |
| PATCH | `/api/payroll-items/:id` | A R(admin,manager) |
| GET | `/api/pay-periods` | A |
| POST | `/api/pay-periods` | A R(admin,manager) |
| PATCH | `/api/pay-periods/:id` | A R(admin,manager) |
| GET | `/api/pay-period-schedules` | A |
| POST | `/api/pay-period-schedules` | A |
| PATCH | `/api/pay-period-schedules/:id` | A |
| DELETE | `/api/pay-period-schedules/:id` | A |
| GET | `/api/taxes-deductions` | A |
| POST | `/api/taxes-deductions` | A R(admin,manager) |
| PATCH | `/api/taxes-deductions/:id` | A R(admin,manager) |
| DELETE | `/api/taxes-deductions/:id` | A R(admin,manager) |
| GET | `/api/accrual-accounts` | A |
| POST | `/api/accrual-accounts` | R(admin) |
| GET | `/api/pay-codes` | A |
| POST | `/api/pay-codes` | R(admin) |
| GET | `/api/pay-stub-accounts` | A R(admin,manager) |
| POST | `/api/pay-stub-accounts` | A R(admin,manager) |
| PATCH | `/api/pay-stub-accounts/:id` | A R(admin,manager) |
| DELETE | `/api/pay-stub-accounts/:id` | A R(admin,manager) |
| GET | `/api/pay-stub-amendments` | A R(admin,manager) |
| POST | `/api/pay-stub-amendments` | A R(admin,manager) |
| PATCH | `/api/pay-stub-amendments/:id` | A R(admin,manager) |
| DELETE | `/api/pay-stub-amendments/:id` | A R(admin,manager) |
| GET | `/api/pay-stub-transactions` | A R(admin,manager) |
| POST | `/api/pay-stub-transactions` | A R(admin,manager) |
| PATCH | `/api/pay-stub-transactions/:id` | A R(admin,manager) |
| GET | `/api/pay-formulas` | A |
| POST | `/api/pay-formulas` | R(admin) |
| PATCH | `/api/pay-formulas/:id` | R(admin) |
| DELETE | `/api/pay-formulas/:id` | R(admin) |
| GET | `/api/contributing-pay-codes` | A |
| POST | `/api/contributing-pay-codes` | A R(admin) |
| PATCH | `/api/contributing-pay-codes/:id` | A R(admin) |
| DELETE | `/api/contributing-pay-codes/:id` | A R(admin) |
| GET | `/api/contributing-shifts` | A |
| POST | `/api/contributing-shifts` | A R(admin) |
| PATCH | `/api/contributing-shifts/:id` | A R(admin) |
| DELETE | `/api/contributing-shifts/:id` | A R(admin) |
| GET | `/api/remittance-sources` | A R(admin,manager) |
| POST | `/api/remittance-sources` | A R(admin,manager) |
| PATCH | `/api/remittance-sources/:id` | A R(admin,manager) |
| DELETE | `/api/remittance-sources/:id` | A R(admin,manager) |
| GET | `/api/remittance-agencies` | A R(admin,manager) |
| POST | `/api/remittance-agencies` | A R(admin,manager) |
| PATCH | `/api/remittance-agencies/:id` | A R(admin,manager) |
| DELETE | `/api/remittance-agencies/:id` | A R(admin,manager) |
| GET | `/api/remittance-agency-events` | A R(admin,manager) |
| POST | `/api/remittance-agency-events` | A R(admin,manager) |
| PATCH | `/api/remittance-agency-events/:id` | A R(admin,manager) |
| DELETE | `/api/remittance-agency-events/:id` | A R(admin,manager) |
| GET | `/api/payroll-audit` | A R(admin,manager) |
| GET | `/api/payroll-payment-methods` | A |
| POST | `/api/payroll-payment-methods` | A R(admin,manager) |
| PATCH | `/api/payroll-payment-methods/:id` | A R(admin,manager) |
| DELETE | `/api/payroll-payment-methods/:id` | A R(admin) |
| GET | `/api/funding-accounts` | A R(admin,manager) |
| POST | `/api/funding-accounts` | R(admin,manager) |
| PATCH | `/api/funding-accounts/:id` | R(admin,manager) |
| DELETE | `/api/funding-accounts/:id` | R(admin) |
| GET | `/api/payroll-payment-records` | A R(admin,manager) |
| GET | `/api/payroll-payment-records/ytd-summary` | A R(admin,manager) |
| GET | `/api/payroll-reimbursements` | A |
| PATCH | `/api/payroll-reimbursements/:id` | A R(admin,manager) |
| GET | `/api/secondary-wage-groups` | A |
| POST | `/api/secondary-wage-groups` | R(admin,manager) |
| PATCH | `/api/secondary-wage-groups/:id` | R(admin,manager) |
| DELETE | `/api/secondary-wage-groups/:id` | R(admin,manager) |
| GET | `/api/employee-wage-groups` | A |

### 3i. Payroll Policy Suite
| Method | Path | Guard |
|--------|------|-------|
| GET | `/api/regular-time-policies` | A |
| POST | `/api/regular-time-policies` | R(admin) |
| PATCH | `/api/regular-time-policies/:id` | R(admin) |
| DELETE | `/api/regular-time-policies/:id` | R(admin) |
| GET | `/api/overtime-policies` | A |
| POST | `/api/overtime-policies` | R(admin) |
| PATCH | `/api/overtime-policies/:id` | R(admin) |
| DELETE | `/api/overtime-policies/:id` | R(admin) |
| GET | `/api/premium-policies` | A |
| POST | `/api/premium-policies` | R(admin) |
| PATCH | `/api/premium-policies/:id` | R(admin) |
| DELETE | `/api/premium-policies/:id` | R(admin) |
| GET | `/api/meal-policies` | A |
| POST | `/api/meal-policies` | R(admin) |
| PATCH | `/api/meal-policies/:id` | R(admin) |
| DELETE | `/api/meal-policies/:id` | R(admin) |
| GET | `/api/break-policies` | A |
| POST | `/api/break-policies` | R(admin) |
| PATCH | `/api/break-policies/:id` | R(admin) |
| DELETE | `/api/break-policies/:id` | R(admin) |
| GET | `/api/schedule-policies` | A |
| POST | `/api/schedule-policies` | R(admin) |
| PATCH | `/api/schedule-policies/:id` | R(admin) |
| DELETE | `/api/schedule-policies/:id` | R(admin) |
| GET | `/api/exception-policies` | A |
| POST | `/api/exception-policies` | R(admin) |
| PATCH | `/api/exception-policies/:id` | R(admin) |
| DELETE | `/api/exception-policies/:id` | R(admin) |
| GET | `/api/accrual-policies` | A |
| POST | `/api/accrual-policies` | R(admin) |
| PATCH | `/api/accrual-policies/:id` | R(admin) |
| DELETE | `/api/accrual-policies/:id` | R(admin) |
| GET | `/api/accrual-policy-milestones` | A |
| POST | `/api/accrual-policy-milestones` | A R(admin) |
| DELETE | `/api/accrual-policy-milestones/:id` | R(admin) |
| GET | `/api/absence-policies` | A |
| POST | `/api/absence-policies` | R(admin) |
| PATCH | `/api/absence-policies/:id` | R(admin) |
| DELETE | `/api/absence-policies/:id` | R(admin) |
| GET | `/api/holiday-policies` | A |
| POST | `/api/holiday-policies` | R(admin) |
| PATCH | `/api/holiday-policies/:id` | R(admin) |
| DELETE | `/api/holiday-policies/:id` | R(admin) |
| GET | `/api/rounding-policies` | A |
| POST | `/api/rounding-policies` | R(admin) |
| PATCH | `/api/rounding-policies/:id` | R(admin) |
| DELETE | `/api/rounding-policies/:id` | R(admin) |
| GET | `/api/policy-groups` | A |
| GET | `/api/pay-codes` | A |
| GET | `/api/holidays` | A |
| POST | `/api/holidays` | A R(admin,manager) |

### 3j. HR Configuration
| Method | Path | Guard |
|--------|------|-------|
| GET | `/api/employee-titles` | A |
| POST | `/api/employee-titles` | A R(admin,manager) |
| PATCH | `/api/employee-titles/:id` | A R(admin,manager) |
| DELETE | `/api/employee-titles/:id` | A R(admin,manager) |
| GET | `/api/employee-groups` | A |
| POST | `/api/employee-groups` | A R(admin,manager) |
| PATCH | `/api/employee-groups/:id` | A R(admin,manager) |
| DELETE | `/api/employee-groups/:id` | A R(admin,manager) |
| GET | `/api/employee-group-configs` | A |
| GET | `/api/new-hire-defaults` | A |
| POST | `/api/new-hire-defaults` | A R(admin,manager) |
| PATCH | `/api/new-hire-defaults/:id` | A R(admin,manager) |
| DELETE | `/api/new-hire-defaults/:id` | A R(admin,manager) |
| GET | `/api/currencies` | A |
| POST | `/api/currencies` | R(admin,manager) |
| PATCH | `/api/currencies/:id` | R(admin,manager) |
| DELETE | `/api/currencies/:id` | R(admin,manager) |

### 3k. Roles & Permissions
| Method | Path | Guard |
|--------|------|-------|
| GET | `/api/roles` | R(admin) |
| POST | `/api/roles` | R(admin,system_admin,platform_*,tenant_*) |
| PATCH | `/api/roles/:id` | R(admin,system_admin,platform_*,tenant_*) |
| DELETE | `/api/roles/:id` | R(admin,system_admin,platform_*,tenant_*) |
| GET | `/api/role-permissions` | R(admin) |
| POST | `/api/role-permissions` | R(admin,system_admin,platform_*,tenant_*) |
| PATCH | `/api/role-permissions/:id` | R(admin,system_admin,platform_*,tenant_*) |
| DELETE | `/api/role-permissions/:id` | R(admin,system_admin,platform_*,tenant_*) |
| POST | `/api/role-permissions/bulk` | R(admin,system_admin,platform_*,tenant_*) |
| GET | `/api/user-roles` | R(admin) |
| POST | `/api/user-roles` | R(admin) |
| DELETE | `/api/user-roles/:id` | R(admin) |
| GET | `/api/permissions/matrix` | A R(admin) |
| GET | `/api/permissions/effective/:userId` | A R(admin) |
| GET | `/api/debug/permissions/me` | A |
| GET | `/api/permissions/audit-log` | A R(admin) |
| GET | `/api/permissions/export-csv` | A R(admin) |
| POST | `/api/permissions/check` | A |

### 3l. Expenses & Receipts
| Method | Path | Guard |
|--------|------|-------|
| GET | `/api/expenses` | A |
| GET | `/api/expenses/:id` | A |
| POST | `/api/expenses` | A |
| PATCH | `/api/expenses/:id` | A |
| DELETE | `/api/expenses/:id` | A |
| POST | `/api/expenses/:id/submit` | A |
| POST | `/api/expenses/:id/approve` | A R(admin,manager) |
| POST | `/api/expenses/:id/reject` | A R(admin,manager) |
| POST | `/api/expenses/:id/mark-paid` | A R(admin,manager) |
| GET | `/api/receipts` | A |
| POST | `/api/receipts` | A |
| PATCH | `/api/receipts/:id` | A R(admin,manager) |
| DELETE | `/api/receipts/:id` | A R(admin,manager) |
| POST | `/api/receipts/upload` | A |
| POST | `/api/receipts/ai-scan` | A |
| GET | `/api/expense-categories` | A |
| POST | `/api/expense-categories` | A R(admin,manager) |

### 3m. Contractor Hub
| Method | Path | Guard |
|--------|------|-------|
| GET | `/api/contractor-invoices` | A FF(contractor-hub) |
| POST | `/api/contractor-invoices` | A |
| PATCH | `/api/contractor-invoices/:id` | A |
| POST | `/api/contractor-invoices/:id/approve` | A R(admin,manager) |
| POST | `/api/contractor-invoices/:id/reject` | A R(admin,manager) |
| POST | `/api/contractor-invoices/:id/void` | A R(admin,manager) |
| POST | `/api/contractor-invoices/:id/mark-paid` | A R(admin,manager) |
| GET | `/api/contractor-proposals` | A FF(contractor-hub) |
| POST | `/api/contractor-proposals` | A |
| PATCH | `/api/contractor-proposals/:id` | A |
| DELETE | `/api/contractor-proposals/:id` | A |
| POST | `/api/contractor-proposals/:id/accept` | A R(admin,manager) |
| POST | `/api/contractor-proposals/:id/reject` | A R(admin,manager) |
| POST | `/api/contractor-proposals/:id/convert-to-contract` | A R(admin,manager) |
| GET | `/api/contractor-contracts` | A |
| POST | `/api/contractor-contracts` | A R(admin,manager) |
| PATCH | `/api/contractor-contracts/:id` | A R(admin,manager) |
| POST | `/api/contractor-contracts/:id/sign` | A |

### 3n. Documents & DAM
| Method | Path | Guard |
|--------|------|-------|
| GET | `/api/document-folders` | A CS |
| POST | `/api/document-folders` | A R(admin,manager) BD CS |
| GET | `/api/documents` | A CS |
| GET | `/api/documents/:id` | A |
| POST | `/api/documents` | A R(admin,manager) BD CS |
| PATCH | `/api/documents/:id` | A R(admin,manager) BD |
| DELETE | `/api/documents/:id` | A R(admin,manager) BD |
| GET | `/api/document-versions` | A |
| POST | `/api/document-versions` | A R(admin,manager) BD |
| POST | `/api/documents/:id/upload` | A R(admin,manager) BD |
| GET | `/api/document-audit-logs` | A CS |
| GET | `/api/document-audit-logs/export` | A R(admin) CS |
| GET | `/api/document-acls` | A CS |
| POST | `/api/document-acls` | A R(admin) BD CS |
| DELETE | `/api/document-acls/:id` | A R(admin) BD |
| GET | `/api/dam-documents` | A |
| POST | `/api/dam-documents` | A |
| GET | `/api/dam-documents/:id` | A |
| PATCH | `/api/dam-documents/:id` | A |
| DELETE | `/api/dam-documents/:id` | A |
| GET | `/api/document-retention-policies` | A CS |
| POST | `/api/document-retention-policies` | A R(admin) BD CS |
| PATCH | `/api/document-retention-policies/:id` | A R(admin) BD |
| DELETE | `/api/document-retention-policies/:id` | A R(admin) BD |

### 3o. Invoicing & Customers
| Method | Path | Guard |
|--------|------|-------|
| GET | `/api/customers` | A R(admin,manager) |
| POST | `/api/customers` | A R(admin,manager) BD |
| PATCH | `/api/customers/:id` | A R(admin,manager) BD |
| DELETE | `/api/customers/:id` | A R(admin,manager) BD |
| GET | `/api/invoices` | A R(admin,manager) |
| GET | `/api/invoices/:id` | A R(admin,manager) |
| POST | `/api/invoices` | A R(admin,manager) BD |
| PATCH | `/api/invoices/:id` | A R(admin,manager) BD |
| DELETE | `/api/invoices/:id` | A R(admin,manager) BD |
| POST | `/api/invoices/:id/send` | A R(admin,manager) BD |
| GET | `/api/payments` | A R(admin,manager) |
| POST | `/api/payments` | A R(admin,manager) BD |
| GET | `/api/recurring-billing` | A R(admin,manager) |
| POST | `/api/recurring-billing` | A R(admin,manager) BD |
| GET | `/api/invoice-templates` | A R(admin,manager) |
| POST | `/api/invoice-templates` | A R(admin,manager) BD |

### 3p. Marketplace (Shift Trading)
| Method | Path | Guard |
|--------|------|-------|
| GET | `/api/marketplace/listings` | A FF(marketplace) |
| GET | `/api/marketplace/listings/:id` | A |
| POST | `/api/marketplace/listings` | A |
| PATCH | `/api/marketplace/listings/:id` | A |
| GET | `/api/marketplace/requests` | A |
| POST | `/api/marketplace/requests` | A |
| PATCH | `/api/marketplace/requests/:id/review` | A R(admin,manager) |
| POST | `/api/marketplace/eligibility-check` | A |
| GET | `/api/eligibility-rule-sets` | A R(admin,manager) |
| POST | `/api/eligibility-rule-sets` | A R(admin,manager) |
| PATCH | `/api/eligibility-rule-sets/:id` | A R(admin,manager) |
| DELETE | `/api/eligibility-rule-sets/:id` | A R(admin) |

### 3q. Billing & Trial
| Method | Path | Guard |
|--------|------|-------|
| POST | `/api/billing/activate` | A R(admin) |
| GET | `/api/billing/summary` | A R(admin) |
| GET | `/api/trial/status` | A |

### 3r. Onboarding Wizard (Company Setup)
| Method | Path | Guard |
|--------|------|-------|
| GET | `/api/onboarding/progress` | A |
| PATCH | `/api/onboarding/progress` | A |
| POST | `/api/onboarding/business-info` | A |
| POST | `/api/onboarding/add-employees-csv` | A |
| POST | `/api/onboarding/bank-info` | A |
| POST | `/api/onboarding/payroll-setup` | A |
| GET | `/api/onboarding/payroll-preview` | A |
| POST | `/api/onboarding/complete-wizard` | A |

### 3s. Worker Onboarding Packets
| Method | Path | Guard |
|--------|------|-------|
| GET | `/api/worker-onboarding` | A R(admin,manager) |
| GET | `/api/worker-onboarding/:id` | A R(admin,manager) |
| POST | `/api/worker-onboarding` | A R(admin,manager) |
| PATCH | `/api/worker-onboarding/:id` | A R(admin,manager) |
| DELETE | `/api/worker-onboarding/:id` | A R(admin) |
| POST | `/api/worker-onboarding/:id/review` | A R(admin,manager) |
| GET | `/api/worker-onboarding/:id/steps` | A R(admin,manager) |
| PATCH | `/api/worker-onboarding/:id/steps/:stepId` | A R(admin,manager) |

### 3t. Notifications & Webhooks
| Method | Path | Guard |
|--------|------|-------|
| GET | `/api/notifications` | A |
| PATCH | `/api/notifications/:id` | A |
| GET | `/api/notification-preferences/:workerId` | A |
| POST | `/api/notification-preferences` | A |
| GET | `/api/webhook-configs` | A CS |
| POST | `/api/webhook-configs` | A R(admin) BD CS |
| PATCH | `/api/webhook-configs/:id` | A R(admin) BD |
| DELETE | `/api/webhook-configs/:id` | A R(admin) BD |
| GET | `/api/integration-events` | A CS |
| POST | `/api/integration-events/:id/retry` | A R(admin) BD |

### 3u. Reporting & KPI
| Method | Path | Guard |
|--------|------|-------|
| GET | `/api/reports/expense-by-category` | A R(admin,manager) |
| GET | `/api/reports/vendor-payments` | A R(admin,manager) |
| GET | `/api/reports/expense-payment-status` | A R(admin,manager) |
| GET | `/api/reports/vendor-checks` | A R(admin,manager) |
| GET | `/api/kpi/labor-goals` | A R(...KPI_GOAL_ROLES) |
| POST | `/api/kpi/labor-goals` | A R(...KPI_GOAL_ROLES) |
| PATCH | `/api/kpi/labor-goals/:id` | A R(...KPI_GOAL_ROLES) |
| DELETE | `/api/kpi/labor-goals/:id` | A R(...KPI_GOAL_ROLES) |
| GET | `/api/kpi/labor-cost-summary` | A R(admin,manager,supervisor) |
| GET | `/api/kpi/financial-summary` | A R(admin,manager,supervisor) |

### 3v. Tax & Compliance
| Method | Path | Guard |
|--------|------|-------|
| GET | `/api/tax-wizard/snapshots` | A |
| POST | `/api/tax-wizard/calculate` | A R(admin,manager) |
| PATCH | `/api/tax-wizard/snapshots/:id` | A R(admin,manager) |
| DELETE | `/api/tax-wizard/snapshots/:id` | A R(admin) |
| GET | `/api/compliance/jurisdictions` | A |
| GET | `/api/compliance/wage-orders` | A |
| GET | `/api/compliance/company/:companyId` | A |
| PATCH | `/api/compliance/company/:companyId/profile` | A R(admin) |
| GET | `/api/compliance/worker/:workerId` | A |
| PATCH | `/api/compliance/worker/:workerId/profile` | A R(admin) |
| GET | `/api/payroll-runs/:id/compliance-events` | A |
| POST | `/api/payroll-runs/:id/preflight` | A R(admin,manager) |
| GET | `/api/privacy-audit-log` | A R(admin,platform_*,tenant_*) |
| GET | `/api/privacy-audit-log/export-csv` | A R(admin,platform_*,tenant_*) |
| GET | `/api/breach-incidents` | A R(platform_super_admin,platform_admin) |
| POST | `/api/breach-incidents` | A R(platform_super_admin,platform_admin) |
| GET | `/api/audit-log` | A R(admin,platform_super_admin) |
| GET | `/api/audit-log/export-csv` | A R(admin,platform_super_admin) |

### 3w. Check Printing
| Method | Path | Guard |
|--------|------|-------|
| GET | `/api/check-templates` | A |
| POST | `/api/check-templates` | A |
| PATCH | `/api/check-templates/:id` | A |
| DELETE | `/api/check-templates/:id` | A |
| GET | `/api/check-print-audit` | A R(admin,manager,platform_*) |
| POST | `/api/check-print-audit` | A |
| GET | `/api/checks/calibration-pdf` | A R(admin,manager) |
| GET | `/api/checks/:payrollItemId/pdf` | A R(admin,manager) |
| POST | `/api/checks/:payrollItemId/void` | A R(admin,manager) |
| POST | `/api/checks/:payrollItemId/reprint` | A R(admin,manager) |

### 3x. Admin Config (SMTP/SMS)
All protected by `requireRole(...CHANNEL_CONFIG_ROLES)` (implicitly auth-checked).

| Method | Path | Guard |
|--------|------|-------|
| GET | `/api/admin/smtp-config` | R(CHANNEL_CONFIG_ROLES) |
| PUT | `/api/admin/smtp-config` | R(CHANNEL_CONFIG_ROLES) |
| POST | `/api/admin/smtp-config/test` | R(CHANNEL_CONFIG_ROLES) |
| GET | `/api/admin/sms-config` | R(CHANNEL_CONFIG_ROLES) |
| PUT | `/api/admin/sms-config` | R(CHANNEL_CONFIG_ROLES) |
| POST | `/api/admin/sms-config/test` | R(CHANNEL_CONFIG_ROLES) |

### 3y. Feature Registry
| Method | Path | Guard |
|--------|------|-------|
| GET | `/api/feature-registry` | A PM |
| GET | `/api/feature-registry/tenant/:companyId` | A PM |
| GET | `/api/feature-registry/log` | A PM |
| POST | `/api/feature-registry/activate` | A PM |
| POST | `/api/feature-registry/bulk-activate` | A PM |
| GET | `/api/feature-flags` | A |
| GET | `/api/feature-registry/my-features` | A |

---

## 4. Platform-Scoped Routes

Accessible only to `platform_*` roles or `platform_super_admin`.

| Method | Path | Guard |
|--------|------|-------|
| GET | `/api/tenants` | A PM |
| POST | `/api/tenants` | A SA |
| GET | `/api/tenants/:id` | A PM |
| PATCH | `/api/tenants/:id` | A PM |
| POST | `/api/tenants/:id/companies` | A SA |
| DELETE | `/api/tenants/:id/companies/:companyId` | A SA |
| GET | `/api/admin/lifecycle-overview` | A R(platform_super_admin) |
| GET | `/api/platform/audit/*` (13 routes) | PA |
| POST | `/api/platform/audit/contracts/:companyId/sign` | PA |
| POST | `/api/platform/audit/licensing/:companyId/gate-override` | PA |
| GET | `/api/platform/audit/export` | PA |
| GET | `/api/admin/provision-demo` | A SA |
| GET | `/api/provisioning/templates` | A PM |
| GET | `/api/provisioning/tenants` | A PM |
| GET | `/api/provisioning/tenants/:companyId` | A PM |
| POST | `/api/provisioning/event` | A PM |
| PATCH | `/api/provisioning/tenants/:companyId/gates` | A PM |

> All `/api/provisioning/*` routes now use `requirePlatformRole()` — tenant admins cannot reach these.

---

## 5. role_permissions Scope Column Enforcement

The `role_permissions` table contains granular scope flags per resource:

| Column | Meaning |
|--------|---------|
| `canViewOwn` | User can view records they own |
| `canEditOwn` | User can edit records they own |
| `canViewSubordinates` | User can view direct reports' records |
| `canEditSubordinates` | User can edit direct reports' records |
| `canViewDepartment` | User can view all records in own department |
| `canEditDepartment` | User can edit all records in own department |
| `canViewCompany` | User can view all records in own company |
| `canEditCompany` | User can edit all records in own company |
| `canApprove*` | Approve-level equivalents |

### How scope columns are enforced server-side

Two complementary enforcement layers exist:

**Layer 1 — Inline company-level isolation (all tenant routes)**  
Every tenant-facing endpoint uses `isPlatformUser(user.role)` + `user.companyId` scoping to guarantee cross-tenant isolation. Non-managers see only their own records; managers see only their company's records.

**Layer 2 — Authorization module (`server/auth/authorization.ts`)**  
The `checkPermission(userId, resource, permission, ScopeContext)` function evaluates the scope columns from `role_permissions` for a given resource + permission tuple. This is the runtime enforcement of the RBAC scope matrix.

Routes with `checkPermission` enforcement:
| Route | Permission checked | Fallback |
|-------|--------------------|---------|
| `GET /api/workers/:id` | `workers / view_company` | Company-level isolation |
| `POST /api/permissions/check` | Caller-specified | — |
| `GET /api/permissions/matrix` | — (metadata endpoint) | — |
| `GET /api/permissions/effective/:userId` | — (metadata endpoint) | — |

Test coverage for scope column logic is in `server/__tests__/auth-guard.test.ts` (Suite 4).

### Platform user `companyId` invariant

Platform-role users (`platform_*`) must **never** have a `companyId` assigned. This invariant is enforced at two points:

1. **Login** (`POST /api/auth/login`): if the authenticated user has a `platform_*` role AND `companyId != null`, login is blocked with HTTP 403.
2. **User creation** (`POST /api/users`): if `desiredRole` starts with `platform_`, `effectiveCompanyId` must be null or the request is rejected with HTTP 400.

---

## 6. Gaps Patched This Session

90 endpoint middlewares were added. Key groups:

| Route Group | Routes Fixed | Guard Added |
|-------------|-------------|------------|
| Dashboard stats | 1 | `requireAuth` |
| Pay periods (GET) | 1 | `requireAuth` |
| Pay periods (POST/PATCH) | 2 | `requireAuth, requireRole("admin","manager")` |
| Taxes & deductions | 4 | `requireAuth` / `requireAuth, requireRole("admin","manager")` |
| Policy groups / pay codes | 2 | `requireAuth` |
| Holidays (GET/POST) | 2 | `requireAuth` / `+ requireRole` |
| Qualifications / reviews / KPI groups / qual-groups | 4 | `requireAuth` |
| Worker languages (4 methods) | 4 | `requireAuth` |
| Worker memberships (4 methods) | 4 | `requireAuth` |
| Accrual accounts | 1 | `requireAuth` |
| Enterprises | 1 | `requireAuth` |
| Currencies | 1 | `requireAuth` |
| Schedules POST | 1 | `requireAuth` |
| Schedules/generate | 1 | `requireAuth, requireRole("admin","manager")` |
| Secondary / employee wage groups | 2 | `requireAuth` |
| Funding accounts | 1 | `requireAuth, requireRole("admin","manager")` |
| Recurring schedules (4 methods) | 4 | `requireAuth, requireRole("admin","manager")` |
| Remittance sources (4 methods) | 4 | `requireAuth, requireRole("admin","manager")` |
| Remittance agencies (4 methods) | 4 | `requireAuth, requireRole("admin","manager")` |
| Remittance agency events (4 methods) | 4 | `requireAuth, requireRole("admin","manager")` |
| Pay-stub accounts (4 methods) | 4 | `requireAuth, requireRole("admin","manager")` |
| Pay-stub amendments (4 methods) | 4 | `requireAuth, requireRole("admin","manager")` |
| Pay-stub transactions (3 methods) | 3 | `requireAuth, requireRole("admin","manager")` |
| Pay-period schedules | 1 | `requireAuth` |
| Employee titles (4 methods) | 4 | `requireAuth` / `+ requireRole` |
| Employee groups (4 methods) | 4 | `requireAuth, requireRole("admin","manager")` |
| Employee group configs | 1 | `requireAuth` |
| New-hire defaults (4 methods) | 4 | `requireAuth` / `+ requireRole` |
| Pay formulas | 1 | `requireAuth` |
| Contributing pay codes (4 methods) | 4 | `requireAuth` / `+ requireRole("admin")` |
| Contributing shifts (4 methods) | 4 | `requireAuth` / `+ requireRole("admin")` |
| All policy GETs (12 policy types) | 12 | `requireAuth` |
| Accrual policy milestones (2 methods) | 2 | `requireAuth` / `+ requireRole("admin")` |
| Legal entities | 1 | `requireAuth` |

---

## 7. Remaining Accepted Risks

| Route | Reason Not Patched |
|-------|------------------|
| `/api/time-clock/*` (8 routes) | Kiosk design — uses station PIN, no session cookie |
| `/api/time-punches` POST | Kiosk punch intake — same pattern |
| `/api/stations` GET | No PII; needed before authentication for kiosk setup |
| `/api/client-ip` GET | Non-sensitive; IP echo for kiosk geo-detection |
| `/api/pay/:invoiceId/*` | Customer-facing payment portal (intentionally public) |
| `/api/portal/*` | Token-gated contractor/worker portals |
| `/api/portal/proposals/*` | Client-approval portal (link-shared) |
| `/api/webhooks/*` | Inbound from external providers (signature-verified internally) |
| `/api/trial/signup` | SaaS acquisition funnel |
| `/api/demo/*` | Demo environment entry |
| `/api/analytics/event` | Anonymous telemetry |
| `/api/license/request` | Pre-auth license request |
| `/api/auth/*` | Auth endpoints themselves |

---

## 7. Role Hierarchy Quick Reference

```
platform_super_admin  ← most privileged
platform_admin
platform_support
platform_audit
─────────────────── tenant boundary ──────────────────
tenant_owner
tenant_admin
tenant_finance_admin
admin            ← legacy alias for tenant_admin
manager
supervisor
employee
worker           ← least privileged
```

- `requirePlatformRole()` → accepts any `platform_*` role
- `requireSuperAdmin()` → accepts only `platform_super_admin`
- `requirePlatformAudit` → header-token-based (audit key), for `/api/platform/audit/*`
- `requireRole("admin")` → accepts `admin` (tenant admin), checked via `expandRoleForGuard`

---

*This document was auto-generated by the Permission Matrix Audit (Task #11). Re-run the audit after significant route additions.*
