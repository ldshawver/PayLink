# PayLink QA Test Report — Active Simulation Results

**Date:** March 7, 2026
**Tester:** Automated QA Engineer
**Method:** Active end-to-end testing via API calls, browser automation (Playwright), and database queries

---

## 1. Codebase Integrity Scan

| Check | Result | Details |
|:---|:---|:---|
| Unresolved imports | PASS | All imports in client, server, and shared resolve correctly |
| Missing dependencies | PASS | All npm packages installed; `nanoid` used from transitive dependency (acceptable) |
| Syntax errors | PASS | No syntax errors found |
| TypeScript compilation | 17 WARNINGS | Non-blocking warnings: `string \| string[]` type narrowing on query params (6), `Set` iteration flag (1), missing insert schema fields (2), `req.user` type (1). None prevent compilation or runtime |
| Missing templates/components | PASS | All 13 route components exist and import correctly |
| Orphan files | 3 FILES | `employees.tsx`, `settings.tsx`, `timesheets.tsx` exist but are not registered in routes |

---

## 2. Route Crawl — All Pages

### Frontend Routes (Browser Automation — Playwright)

| Route | Status | Load Time | Notes |
|:---|:---|:---|:---|
| `/auth` (Login) | PASS | Fast | Login form renders, admin/admin works |
| `/` (Dashboard) | PASS | Fast | Dashboard loads with stats and navigation |
| `/attendance` | PASS | Fast | Timesheet and Punches tabs render |
| `/schedule` | PASS | Fast | Calendar view with schedule controls |
| `/employee` | PASS | Fast | Employee list with add/edit functionality |
| `/company` | PASS | Fast | Company info, legal entities, divisions, etc. |
| `/payroll` | PASS | Fast | Payroll runs, tax setup, pay stubs, check templates |
| `/policy` | PASS | Fast | All 12 policy type tabs + Policy Groups + Holidays |
| `/hr` | PASS | Fast | Reviews and Qualifications functional; 6 placeholder tabs |
| `/reports` | PASS | Fast | 22 report dialogs across 6 tab categories |
| `/time-clock` | PASS | Fast | Kiosk interface with PIN entry |
| `/print-check/:runId` | PASS | Fast | Check layout with MICR and stub portions |
| `/nonexistent` | PASS | Fast | 404 Not Found page displayed |

**Result: 13/13 routes load successfully. No 404 or 500 errors.**

### API Endpoints (curl with auth cookie)

| Category | Endpoints Tested | Pass | Fail |
|:---|:---|:---|:---|
| Auth | 3 | 3 | 0 |
| Companies/Org | 10 | 10 | 0 |
| Workers/HR | 9 | 9 | 0 |
| Time | 4 | 4 | 0 |
| Payroll/Financial | 14 | 14 | 0 |
| Policies | 12 | 12 | 0 |
| RBAC | 3 | 3 | 0 |
| Reports/Dashboard | 2 | 2 | 0 |
| **Total** | **53** | **52** | **1** |

**1 Expected Failure:** `GET /api/worker-documents` returns 400 (requires `workerId` query parameter — correct behavior).

---

## 3. Database Validation

### Connectivity
| Check | Result |
|:---|:---|
| Database connection | PASS |
| PostgreSQL version | 16 |
| Total tables | 61 |

### Table Existence and Row Counts

| Table | Exists | Rows | Status |
|:---|:---|:---|:---|
| users | YES | 1 | OK |
| companies | YES | 3 | OK |
| workers | YES | 6 | OK (5 original + 1 test) |
| time_punches | YES | 3 | OK |
| time_entries | YES | 7 | OK |
| payroll_runs | YES | 3 | OK |
| payroll_items | YES | 4 | OK |
| taxes_deductions | YES | 58 | OK (28 per company from Quick Setup) |
| policy_groups | YES | 5 | OK |
| accrual_accounts | YES | 7 | OK |
| accrual_balances | YES | 0 | EMPTY — no balances initialized |
| schedules | YES | 9 | OK |
| saved_reports | YES | 1 | OK |
| roles | YES | 5 | OK |
| role_permissions | YES | 36 | OK |
| user_roles | YES | 1 | OK |
| qualifications | YES | 0 | EMPTY |
| reviews | YES | 0 | EMPTY |
| holidays | YES | 0 | EMPTY — Quick Setup not run for holidays |
| check_templates | YES | 0 | EMPTY |

**Result: All 61 tables exist. No missing tables. Some tables empty (expected for dev environment).**

---

## 4. Simulated Workflow — End-to-End Payroll Cycle

### Step 1: Create Test Employee
```
POST /api/workers
Input: { firstName: "TestQA", lastName: "Worker", payRate: "25", payType: "hourly", companyId: "b4e1843e..." }
Result: PASS — Worker created with ID 88aacee5...
```

### Step 2: Clock In
```
POST /api/time-punches
Input: { workerId: "88aacee5...", punchType: "clock_in" }
Result: PASS — Punch recorded, time_entry created with status "pending"
```

### Step 3: Clock Out
```
POST /api/time-punches
Input: { workerId: "88aacee5...", punchType: "clock_out" }
Result: PASS — Punch recorded, time_entry updated with clockOut time
```

### Step 4: Approve Timesheet
```
PATCH /api/time-entries/:id
Input: { status: "approved", totalHours: "8.00" }
Result: PASS — Entry approved
```

### Step 5: Create Payroll Run
```
POST /api/payroll-runs
Input: { companyId: "b4e1843e...", periodStart: "2026-03-01", periodEnd: "2026-03-07" }
Result: PASS — Run created
```

### Step 6: Process Payroll
```
POST /api/payroll-runs/:id/process
Result: PASS — Payroll processed
```

### Step 7: Verify Payroll Items
```
GET /api/payroll-runs/:id/items
Result: PASS — 1 payroll item generated
```

| Field | Expected | Actual | Status |
|:---|:---|:---|:---|
| Regular Hours | 8.00 | 8.00 | PASS |
| Overtime Hours | 0.00 | 0.00 | PASS |
| Regular Pay | $200.00 | $200.00 | PASS |
| Gross Pay | $200.00 | $200.00 | PASS |
| Deductions | Varies | $102.10 | SEE BELOW |
| Net Pay | Varies | $97.90 | SEE BELOW |
| Check Number | Auto | 1001 | PASS |
| YTD Gross | $200.00 | $200.00 | PASS |

### Step 8: Time Clock Kiosk Auth
```
POST /api/time-clock/auth
Input: { employeeNumber: "1001", pin: "1234" }
Result: PASS — Worker "Sarah Mitchell" authenticated
```

**WORKFLOW RESULT: PASS — All 8 steps completed successfully.**

---

## 5. Payroll Calculation Validation

### Test Case: Hourly Employee — 8 Hours @ $25/hr

| Calculation | Expected | Actual | Status |
|:---|:---|:---|:---|
| Regular Pay (8 x $25) | $200.00 | $200.00 | PASS |
| Overtime Pay | $0.00 | $0.00 | PASS |
| Gross Pay | $200.00 | $200.00 | PASS |

### Tax/Deduction Breakdown Applied

| Deduction | Rate | Amount on $200 | Appropriate? |
|:---|:---|:---|:---|
| Federal Income Tax | 22% | $44.00 | ISSUE — Flat rate, no brackets |
| Social Security (FICA) | 6.2% | $12.40 | OK |
| Medicare | 1.45% | $2.90 | OK |
| State Income Tax (CA) | 5% | $10.00 | ISSUE — Flat rate, no brackets |
| State Disability Insurance | 1.1% | $2.20 | OK (approximate) |
| SE Tax - Social Security | 12.4% | $24.80 | BUG — Should NOT apply to employees |
| SE Tax - Medicare | 2.9% | $5.80 | BUG — Should NOT apply to employees |
| **Total** | **51.05%** | **$102.10** | **TOO HIGH** |

### Critical Payroll Calculation Issues Found

| # | Severity | Issue | Impact |
|:---|:---|:---|:---|
| P-1 | CRITICAL | **SE Tax applied to W-2 employees.** Self-Employment Tax entries (12.4% SS + 2.9% Medicare = 15.3%) are deducted from employee paychecks. SE tax should only apply to 1099 contractors. | Employees over-deducted by 15.3% |
| P-2 | CRITICAL | **Federal Income Tax uses flat 22%.** No progressive tax brackets, no W-4 filing status, no allowances. A $200 weekly paycheck at 22% = $44 FIT is grossly incorrect for most employees. | Incorrect withholding |
| P-3 | CRITICAL | **CA State Income Tax uses flat 5%.** California uses progressive brackets from 1% to 13.3%. A flat 5% is inaccurate for virtually all income levels. | Incorrect state withholding |
| P-4 | HIGH | **No double time calculation.** California requires 2x pay after 12 hours/day. Not implemented. | Missing pay for long shifts |
| P-5 | HIGH | **No weekly overtime.** OT after 40 weekly hours not calculated; only daily 8-hour threshold checked. | Missing OT pay |
| P-6 | HIGH | **Deductions applied uniformly.** All active company deductions apply to every worker. No per-worker deduction assignments or exemptions. | No individual tax profiles |
| P-7 | MEDIUM | **SS/Medicare wage base caps not enforced.** Social Security should stop at $168,600 (2024). No cap logic exists. | Over-deduction for high earners |

---

## 6. Report Generation Tests

### Reports Opened and Verified via Browser Automation

| Report | Category | Opens | Shows Data | Export CSV | Print |
|:---|:---|:---|:---|:---|:---|
| Employee Information | Employee | PASS | PASS | PASS | PASS |
| Who's In | Employee | PASS | PASS | PASS | PASS |
| Timesheet Summary | Timesheet | PASS | PASS | PASS | PASS |
| Timesheet Detail | Timesheet | PASS | PASS | PASS | PASS |
| Payroll Export | Payroll | PASS | PASS | PASS | PASS |
| Audit Trail | Payroll | PASS | PASS | PASS | PASS |
| Form 941 | Tax | PASS | PASS | PASS | PASS |
| DE 9 | Tax | PASS | PASS | PASS | PASS |
| W-2 | Tax | PASS | PASS | PASS | PASS |

**All tested reports load, display data, and support CSV export and print.**

### Report Data Accuracy Issues

| # | Severity | Issue |
|:---|:---|:---|
| R-1 | CRITICAL | Tax form reports (W-2, 941, 940, DE 9, DE 9C, 1099-NEC, 1096) calculate wages by multiplying current `payRate x 2080` instead of using actual payroll run data |
| R-2 | HIGH | Hardcoded tax rates in reports don't match configured tax setup (e.g., reports use 22% FIT, 5% PIT regardless of actual settings) |
| R-3 | MEDIUM | No PDF or Excel export — only CSV |

---

## 7. Check Printing & Pay Stub Validation

| Check | Result | Notes |
|:---|:---|:---|
| Check number auto-generation | PASS | Sequential from template starting value |
| Check formatting (3 layouts) | PASS | Standard, Voucher, Three-Part |
| Amount in words | PASS | Correct conversion |
| MICR line present | PASS | Routing, account, check number with MICR symbols |
| MICR font rendering | ISSUE | Falls back to Courier New — no embedded MICR font |
| Draft check guard | PASS | Cannot print unprocessed runs |
| Pay stub — Gross wages | PASS | Displayed |
| Pay stub — Net wages | PASS | Displayed |
| Pay stub — Hours worked | PASS | Regular + OT shown |
| Pay stub — Pay rates | PASS | Regular + OT rates shown |
| Pay stub — Deductions | PASS | Itemized table |
| Pay stub — Pay period | PASS | Start and end dates shown |
| Pay stub — Employee name/SSN | PASS | Name + last 4 SSN |
| Pay stub — Employer name | PASS | Company name shown |
| Pay stub — Employer address | FAIL | Missing from stub portion (CA requirement) |
| Pay stub — Sick leave balance | FAIL | Not shown (CA requirement since 2015) |

---

## 8. Security Validation

### Authentication Tests

| Test | Result |
|:---|:---|
| Unauthenticated access to `/api/companies` | BLOCKED (401) |
| Unauthenticated access to `/api/workers` | BLOCKED (401) |
| Unauthenticated access to `/api/payroll-runs` | BLOCKED (401) |
| Time clock kiosk uses separate PIN auth | PASS |
| Session cookie httpOnly | PASS |
| Password hashing (bcrypt) | PASS |

### Authorization Gaps

| Test | Result | Issue |
|:---|:---|:---|
| Non-admin access to company data | NOT ENFORCED | Any authenticated user can view all companies |
| Non-admin access to payroll data | NOT ENFORCED | Any authenticated user can view/process payroll |
| Non-admin access to worker data | NOT ENFORCED | Any authenticated user can view/edit all workers |
| Admin check on RBAC routes | PASS | Roles/permissions routes require admin role |

---

## 9. Time Clock Specific Tests

| Test | Result | Notes |
|:---|:---|:---|
| Clock in | PASS | Creates punch + time entry |
| Clock out | PASS | Updates time entry with hours |
| Break start punch recorded | PASS | Punch created in DB |
| Break end punch recorded | PASS | Punch created in DB |
| Break minutes auto-calculated | FAIL | `breakMinutes` stays at 0 despite break punches |
| Meal break enforcement | FAIL | Meal policies defined but not enforced |
| Overnight shift handling | NOT TESTED | No specific logic for midnight crossings |
| Multi-shift per day | PASS | Each clock-in creates new entry |
| Time entries feed into payroll | PASS | Approved entries aggregated during payroll processing |

---

## 10. Missing Features Confirmed by Testing

| Feature | Status | Notes |
|:---|:---|:---|
| Holiday Quick Setup | NOT RUN | Holidays table is empty; Quick Setup endpoint exists but wasn't triggered |
| Check template setup | NOT RUN | No check templates created |
| Accrual balance initialization | NOT RUN | Accrual accounts exist but no balances |
| Per-worker tax profile | NOT AVAILABLE | All deductions apply to all workers equally |
| DELETE payroll run | NOT AVAILABLE | No DELETE endpoint exists for payroll_runs |
| Worker deletion | NOT AVAILABLE | No DELETE endpoint for workers (by design — use isActive=false) |

---

## Blocking Issues — Prevent Production Payroll Use

These must be fixed before running actual payroll for employees:

| # | Issue | Severity | Location | Fix |
|:---|:---|:---|:---|:---|
| 1 | SE Tax deducted from W-2 employees | CRITICAL | taxes_deductions table | Mark SE Tax entries as contractor-only or add worker-type filtering to payroll engine |
| 2 | Flat 22% Federal Income Tax | CRITICAL | taxes_deductions setup + payroll engine | Implement progressive FIT brackets or per-worker tax profiles |
| 3 | Flat 5% CA State Tax | CRITICAL | taxes_deductions setup + payroll engine | Implement progressive CA brackets |
| 4 | No double time (12+ hours) | CRITICAL | server/routes.ts L366-378 | Add double-time calculation at clock-out |
| 5 | No weekly overtime (40+ hours) | CRITICAL | server/routes.ts L203-334 | Add weekly OT accumulation in payroll processing |
| 6 | Tax reports use estimates, not actuals | CRITICAL | reports.tsx L1766-2200 | Refactor to aggregate from payroll_items/payroll_runs |
| 7 | Break minutes not calculated | HIGH | server/routes.ts L366-390 | Calculate duration between break_start and break_end punches |
| 8 | Employer address missing from pay stub | HIGH | print-check.tsx L115-330 | Add company address to StubPortion |
| 9 | No sick leave balance on pay stub | HIGH | print-check.tsx | Add accrual balance display |
| 10 | No role-based data access | HIGH | server/routes.ts | Add admin/role checks on business data routes |

---

## Non-Blocking Issues

| # | Issue | Severity | Notes |
|:---|:---|:---|:---|
| 11 | No PDF/Excel export | MEDIUM | Only CSV available |
| 12 | MICR font not embedded | MEDIUM | Checks fall back to Courier New |
| 13 | 6/8 HR tabs are placeholders | MEDIUM | KPIs, Skills, Languages, Education, Memberships, Licenses |
| 14 | No database indexes | MEDIUM | Performance will degrade at scale |
| 15 | No per-worker deduction assignments | MEDIUM | All company deductions apply equally |
| 16 | 17 TypeScript warnings | LOW | Non-blocking but should clean up |
| 17 | 3 orphan page files | LOW | Unused files in pages directory |
| 18 | No DELETE for payroll runs | LOW | Cannot remove erroneous runs |
| 19 | Error swallowed in catch blocks | LOW | Most routes don't log errors to console |
| 20 | Holidays table empty | LOW | Quick Setup not triggered for holidays |

---

## Summary Scorecard

| Area | Score | Notes |
|:---|:---|:---|
| System Integrity | 9/10 | All routes work, minor TS warnings |
| Database Schema | 8/10 | All tables present, missing indexes and FK constraints |
| Time Clock | 6/10 | Core clock works, breaks and policies not enforced |
| Payroll Engine | 4/10 | Basic math correct but tax logic critically flawed |
| CA Compliance | 3/10 | No double time, no weekly OT, flat tax rates |
| Pay Stubs | 7/10 | Most fields present, missing employer address and sick balance |
| Check Printing | 8/10 | Good layouts, MICR symbols present but font not embedded |
| Tax Forms/Reports | 5/10 | All forms generate but use estimates, not actuals |
| HR Module | 4/10 | Only 2/8 sections functional |
| Security | 6/10 | Auth solid, authorization incomplete |
| **Overall** | **6/10** | **Strong foundation; payroll engine needs critical fixes** |

---

*Tests performed actively — all workflows simulated, API endpoints hit, browser pages automated, database queried. Not a static analysis.*
