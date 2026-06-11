# Demo Tenant Validation Checklist

Run this checklist after any seed run, schema migration, or role/permission refactor to confirm that demo and test tenants are fully valid.

---

## 1. Demo Tenant Data Completeness

Run against each `is_demo = TRUE` company (excluding `__dev_test_tenant__`):

```sql
SELECT
  c.id,
  c.name,
  (SELECT COUNT(*) FROM users         u   WHERE u.company_id    = c.id)                 AS users,
  (SELECT COUNT(*) FROM workers       w   WHERE w.company_id    = c.id)                 AS workers,
  (SELECT COUNT(*) FROM payroll_runs  pr  WHERE pr.company_id   = c.id)                 AS payroll_runs,
  (SELECT COUNT(*) FROM schedules     s   WHERE s.company_id    = c.id)                 AS schedules,
  (SELECT COUNT(*) FROM time_entries  te  WHERE te.company_id   = c.id)                 AS time_entries,
  (SELECT COUNT(*) FROM taxes_deductions td WHERE td.company_id = c.id)                 AS tax_deductions,
  (SELECT COUNT(*) FROM contractor_proposals cp WHERE cp.company_id = c.id)             AS proposals,
  (SELECT COUNT(*) FROM contractor_invoices  ci WHERE ci.company_id = c.id)             AS invoices,
  (SELECT COUNT(*) FROM pay_periods   pp  WHERE pp.company_id   = c.id)                 AS pay_periods,
  (SELECT COUNT(*) FROM departments   d   WHERE d.company_id    = c.id)                 AS departments
FROM companies c
WHERE c.is_demo = TRUE AND c.name != '__dev_test_tenant__'
ORDER BY c.name, c.id;
```

**Expected per demo tenant:**

| Metric | Minimum | Notes |
|---|---|---|
| users | ≥ 1 | Must include at least one admin |
| workers | ≥ 6 | Mix of employees and contractors |
| payroll_runs | ≥ 1 | At least one completed run |
| schedules | ≥ 10 | At least 1 week for hourly workers |
| time_entries | ≥ 10 | Matching the schedule period |
| tax_deductions | ≥ 3 | Fed income, FICA employee, Medicare |
| proposals | ≥ 1 | Contractor proposal chain present |
| invoices | ≥ 1 | Invoice linked to the proposal |
| pay_periods | ≥ 1 | At least one closed period |
| departments | ≥ 2 | Org structure present |

---

## 2. Demo Tenant Uniqueness (Duplicate Guard)

Each `provisionDemoTenant()` call creates a brand-new company. Duplicate "Acme Services Demo" rows indicate the public provision endpoint was called multiple times on the same DB.

```sql
SELECT name, COUNT(*) AS copies
FROM companies
WHERE is_demo = TRUE AND name != '__dev_test_tenant__'
GROUP BY name
HAVING COUNT(*) > 1;
```

**Expected:** 0 rows. Multiple copies are harmless for demos but waste DB space.  
**Action if duplicates found:** Delete older copies that are expired (`trial_end < NOW()`) or flag for manual cleanup.

---

## 3. Test Tenant (`__dev_test_tenant__`) Integrity

```sql
SELECT
  c.id, c.name,
  (SELECT COUNT(*) FROM users    u WHERE u.company_id = c.id) AS users,
  (SELECT COUNT(*) FROM workers  w WHERE w.company_id = c.id) AS workers
FROM companies c
WHERE c.name = '__dev_test_tenant__';
```

**Expected:** 9 users, ≥ 2 workers (one employee, one contractor).

---

## 4. Test Account Role & Company Assignments

```sql
SELECT username, role, company_id IS NOT NULL AS has_company, worker_id IS NOT NULL AS has_worker, is_active
FROM users
WHERE username LIKE 'test_%'
ORDER BY role, username;
```

**Invariants:**

| Account class | `company_id` | `worker_id` | Notes |
|---|---|---|---|
| `test_platform_*` | NULL | NULL | Must never have companyId — RBAC invariant |
| `test_tenant_*` | Set | NULL | Admin-level, no worker record needed |
| `test_employee` | Set | Set | Needs worker record for timesheets/paystubs |
| `test_contractor` | Set | Set | Needs worker record for proposals/invoices |

**All accounts must have `is_active = TRUE`.**

---

## 5. Platform User RBAC Invariant

Platform-scoped accounts must NEVER have a `company_id`. A violation breaks the `platform/*` route guard.

```sql
SELECT username, role, company_id
FROM users
WHERE username LIKE 'test_platform_%' AND company_id IS NOT NULL;
```

**Expected:** 0 rows.

---

## 6. Proposal → Invoice Chain Integrity

Every demo tenant should have at least one complete proposal-to-invoice chain.

```sql
SELECT
  cp.company_id,
  cp.id          AS proposal_id,
  cp.status      AS proposal_status,
  ci.id          AS invoice_id,
  ci.status      AS invoice_status,
  ci.amount,
  ci.amount_paid
FROM contractor_proposals cp
JOIN contractor_invoices ci ON ci.proposal_id = cp.id
WHERE cp.company_id IN (
  SELECT id FROM companies WHERE is_demo = TRUE AND name != '__dev_test_tenant__'
)
ORDER BY cp.company_id;
```

**Expected per demo tenant:** ≥ 1 row with `proposal_status = 'approved'` and `invoice_status = 'paid'`.

---

## 7. Payroll Run Sanity

```sql
SELECT
  pr.company_id,
  pr.status,
  pr.total_gross::numeric,
  pr.worker_count,
  COUNT(pi.id) AS item_count
FROM payroll_runs pr
LEFT JOIN payroll_items pi ON pi.payroll_run_id = pr.id
WHERE pr.company_id IN (
  SELECT id FROM companies WHERE is_demo = TRUE AND name != '__dev_test_tenant__'
)
GROUP BY pr.company_id, pr.status, pr.total_gross, pr.worker_count
ORDER BY pr.company_id;
```

**Expected per demo tenant:** At least 1 run with `status = 'paid'`, `worker_count ≥ 6`, `item_count = worker_count`.

---

## 8. After-Seed Smoke Tests (manual, API-level)

After running `npm run db:push` + restarting the app:

1. **Demo admin login** — `POST /api/auth/login` with `demo_<suffix>` / `demo123` → 200, session cookie returned.
2. **Workers list** — `GET /api/workers` (as demo admin) → 200, array with ≥ 6 workers.
3. **Payroll runs** — `GET /api/payroll/runs` → 200, at least 1 item with `status: "paid"`.
4. **Proposals** — `GET /api/contractor-hub/proposals` → 200, at least 1 item.
5. **Test employee login** — `POST /api/auth/login` with `test_employee` / `test1234` → 200.
6. **Test employee timesheets** — `GET /api/time-entries?mine=true` (as test_employee) → 200 (may be empty, but must not 403).
7. **Platform login** — `POST /api/auth/login` with `test_platform_support` / `test1234` → 200.
8. **Platform route guard** — `GET /platform/tenants` (as test_employee) → 403 redirect (not 200).

---

## 9. Known Issues (Flagged for Future Cleanup)

| Issue | Status | Action |
|---|---|---|
| 6 duplicate "Acme Services Demo" companies in dev DB | Flagged | Safe to delete 5 older copies; keep the most recently created one. Run: `DELETE FROM companies WHERE is_demo = TRUE AND name = 'Acme Services Demo' AND id NOT IN (SELECT id FROM companies WHERE is_demo = TRUE AND name = 'Acme Services Demo' ORDER BY id DESC LIMIT 1);` |
| `pay_periods` table was empty for existing demo tenants | Resolved (backfilled 2025-06-11) | Monitor after new demo provisions |
| `test_employee` / `test_contractor` had no `worker_id` | Resolved (backfilled 2025-06-11) | `seedTestTenantWorkers()` now runs on every seed |

---

## Re-Running This Checklist

```bash
# From project root
npm run db:push          # apply any pending schema changes
# Then run each SQL block above in psql or the DB admin panel.
# For automated CI: see server/__tests__/api-json-guard.test.ts for the test harness.
```
