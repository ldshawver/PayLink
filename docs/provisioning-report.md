# Provisioning Report: PayLink Tenant Lifecycle & Automation

**Document version:** 1.0  
**Date:** April 2026  
**Scope:** Tenant provisioning triggers, automation steps, billing lifecycle enforcement, and audit framework

---

## 1. Provisioning Triggers

### 1.1 Trial Sign-Up
- **Trigger:** `POST /api/trial/signup`
- **Automation:**
  1. Creates a new `companies` record with `subscription_status = 'trial_active'`, `trial_start = NOW()`, `trial_end = NOW() + 14 days`
  2. Creates a default admin `users` record
  3. Seeds required default data: currencies, pay periods, company logo
  4. Logs the event to `analytics_events`
- **Result:** Tenant is in `trial_active` state. Full read/write access allowed.

### 1.2 Demo Provisioning
- **Trigger:** `POST /api/demo/provision`
- **Automation:**
  1. Creates a `companies` record with `is_demo = TRUE`
  2. Seeds sample workers, schedules, pay periods, and payroll data
  3. Sets session as demo mode (blocking all writes on non-demo paths)
- **Result:** Read-only demo tenant. All write attempts blocked by `blockDemoWrites` middleware.

### 1.3 Subscription Activation (Manual Billing)
- **Trigger:** `POST /api/billing/activate` (requires admin, authenticated)
- **Automation:**
  1. Updates `companies.subscription_status = 'active_paid'`
  2. Sets `billing_active = TRUE`, `payment_method_on_file = TRUE`
  3. Updates `trial_signups` table in parallel
  4. Logs a `subscription_activated` analytics event
- **Result:** Tenant transitions to fully active paid state.

### 1.4 Stripe Webhook: Payment Success
- **Trigger:** `invoice.payment_succeeded` Stripe event
- **Automation:**
  1. Looks up company by `stripe_customer_id`
  2. If tenant was in `grace_period` or `suspended`, transitions to `active_paid`
  3. Sets `billing_active = TRUE`, clears `grace_period_end`
  4. Writes `lifecycle_transition` audit log entry
  5. Sends `tenant_reactivated` in-app and email notification to owner
- **Emits:** `tenant.reactivated`

### 1.5 Stripe Webhook: Payment Failure
- **Trigger:** `invoice.payment_failed` Stripe event
- **Automation:**
  1. Looks up company by `stripe_customer_id`
  2. Transitions to `grace_period` (configurable per tenant via `grace_period_days`, default 14)
  3. Sets `grace_period_end = NOW() + grace_period_days`
  4. Sets `billing_active = FALSE`
  5. Writes `lifecycle_transition` audit log
  6. Sends `grace_period_started` in-app and email notification to owner
- **Note:** Tenant retains full read/write access during grace period.

### 1.6 Stripe Webhook: Subscription Deleted
- **Trigger:** `customer.subscription.deleted` Stripe event
- **Automation:**
  1. Looks up company by `stripe_customer_id` or `stripe_subscription_id`
  2. Transitions to `suspended`
  3. Sets `billing_active = FALSE`, clears `grace_period_end`
  4. Writes `lifecycle_transition` audit log
  5. Sends `tenant_suspended` in-app and email notification to owner
- **Result:** All non-GET API requests return 403 with `reason: "tenant_suspended"`.

### 1.7 Grace Period Expiry (Automated Check)
- **Trigger:** `checkAndSuspendExpiredGracePeriods()` in `server/billingLifecycle.ts`
- **Automation:**
  1. Queries all tenants with `subscription_status = 'grace_period'` AND `grace_period_end < NOW()`
  2. Transitions each to `suspended`
  3. Writes `lifecycle_transition` audit log for each
  4. Sends `tenant_suspended` notification for each
- **Limitation:** This function must be invoked by a scheduled job or cron. No built-in scheduler currently runs this automatically on a set interval. Recommend wiring to a cron endpoint or external scheduler (e.g., Replit Scheduled Deployments).

---

## 2. Lifecycle State Machine

```
trial_active ──► trial_expired ──► [upgrade required]
     │
     └──► active_paid ◄──────────────────────────────────────────────────┐
               │                                                          │
               └──► grace_period ──[auto after 14 days]──► suspended     │
                         │                                     │         │
                         └──────── payment resolved ───────────┘         │
                                        └──────────────────────────────► ┘
```

**Subscription Statuses in `companies` table:**
| Status | Platform Access | Billing Active |
|--------|----------------|----------------|
| `trial_active` | Full | No |
| `trial_expired` | Blocked (read: yes, write: no) | No |
| `active_paid` | Full | Yes |
| `grace_period` | Full (temporary) | No |
| `suspended` | Write-blocked (403) | No |
| `canceled` | Write-blocked (403) | No |

---

## 3. Authorization Gates

### `requireActiveSubscription` Middleware
Located in `server/routes.ts`. Applied to all non-public, non-GET API requests.

**Checks:**
1. `suspended` / `canceled` → 403 `tenant_suspended`
2. `trial_expired` → 403 upgrade required
3. `grace_period` + expired → auto-transitions to `suspended`, returns 403
4. `grace_period` (active) → allowed through
5. `trial_active` + expired → auto-transitions to `trial_expired`, returns 403

### Public Write Paths (bypassed)
- `/auth/`, `/trial/signup`, `/demo/login`, `/demo/provision`, `/analytics/event`, `/billing/activate`, `/webhooks/product-events`, `/webhooks/esign/`, `/portal/`

---

## 4. Audit Logging

All significant lifecycle and authorization changes are recorded in the `authorization_audit_log` table.

### Auditable Event Types
| Change Type | Description |
|---|---|
| `role_assigned` | User assigned to a role |
| `role_removed` | Role removed from user |
| `permission_changed` | Role permission modified |
| `override_added` | Per-user permission override added |
| `override_removed` | Per-user permission override removed |
| `lifecycle_transition` | Tenant subscription state change |
| `billing_event` | Stripe billing events |
| `department_changed` | Department reassignment |
| `location_changed` | Location reassignment |
| `reporting_changed` | Manager/reporting relationship change |
| `provisioning_step` | Tenant provisioning events |

### API Endpoints
- `GET /api/audit-log` — Paginated, filterable (by `changeType`, `companyId`, `actorUserId`, `fromDate`, `toDate`)
- `GET /api/audit-log/export-csv` — Same filters, full export up to 10,000 rows
- `GET /api/permissions/audit-log` — Legacy endpoint (limit only)
- `GET /api/admin/lifecycle-overview` — Super-admin lifecycle health summary

### Storage Schema (`authorization_audit_log`)
| Column | Description |
|---|---|
| `id` | UUID primary key |
| `actor_user_id` | Who made the change (`"system"` for automated events) |
| `target_user_id` | Affected user (if applicable) |
| `target_role_id` | Affected role (if applicable) |
| `target_resource` | Resource name (if applicable) |
| `change_type` | Event type (see above) |
| `before_value` | State before change |
| `after_value` | State after change |
| `note` | Human-readable description |
| `company_id` | Tenant scope |
| `tenant_id` | (Reserved for enterprise multi-tenant) |
| `created_at` | Event timestamp |

---

## 5. Notification Service

Located at `server/notifications/TenantNotificationService.ts`.

### Channels
1. **In-App:** Inserts a record into `notifications` for all admin users in the company
2. **Email:** Sends via SMTP (configured via `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` environment variables)

### Events and Notifications
| Event | In-App | Email |
|---|---|---|
| `grace_period_started` (payment_failed) | Yes | Yes (if SMTP configured) |
| `grace_period_warning` | Yes | Yes |
| `tenant_suspended` | Yes | Yes |
| `tenant_reactivated` | Yes | Yes |
| `subscription_cancelled` | Yes | Yes |

---

## 6. Known Limitations

1. **Grace Period Cron:** The `checkAndSuspendExpiredGracePeriods()` function exists but has no automated scheduler. Requires external cron or manual invocation. Suspension will still occur on next API write attempt via the middleware check.

2. **Stripe Customer ID Matching:** Tenant-to-Stripe mapping relies on `companies.stripe_customer_id`. If a company doesn't have this field populated, billing webhooks will not trigger lifecycle transitions. The field is populated when a subscription event is first processed.

3. **Email Delivery:** Email notifications require SMTP configuration (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`). Without this, only in-app notifications are sent.

4. **Permission Group Changes Not Yet Captured:** Changes to `permissionGroups` table don't yet auto-log to the audit log. This requires adding `logAuthorizationChange()` calls to those mutation routes.

5. **Reporting Relationship Changes:** `employeeManagerRelations` changes don't yet emit audit events. This can be added to the respective CRUD routes.

---

## 7. Recommended Next Steps

1. **Wire grace period check to a scheduled job** — Invoke `checkAndSuspendExpiredGracePeriods()` hourly via a scheduled deployment or background worker.

2. **Add Stripe Customer ID provisioning** — During trial signup or first billing activation, store the Stripe customer ID in `companies.stripe_customer_id` to ensure billing webhooks can route to the correct tenant.

3. **Expand audit coverage** — Add `logAuthorizationChange()` calls to:
   - `employeeManagerRelations` mutations
   - `permissionGroups` CRUD
   - `userCompanyAccess` grants/revocations
   - Department and location reassignments

4. **Implement grace period warning notifications** — Send a reminder 2 days before grace period expiry by checking `grace_period_end` at scheduled intervals.

5. **Add per-tenant grace period configuration UI** — Allow super admins to override `grace_period_days` per tenant from the admin panel.

6. **Audit log retention policy** — Implement automated archival or pruning of audit logs older than a configurable retention period (e.g., 2 years).
