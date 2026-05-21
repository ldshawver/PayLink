# PayLink Financial Reports Audit

**Date:** 2025-05-21  
**Scope:** All reports in `client/src/pages/reports.tsx` evaluated for accounting usefulness and tax/compliance coverage.

---

## 1. What Currently Exists

### Payroll Reports
| Report | Location | Status |
|--------|----------|--------|
| W-2 Generator | `W2ReportDialog` (line 1909) | ✅ Complete |
| 1099-NEC Generator | Within W-2 dialog | ✅ Complete |
| Payroll Summary | `PayrollSummaryReport` | ✅ Complete |
| Tax Liability | `TaxReportFilters` (line 1745) | ✅ Complete |
| Check Register | `CheckRegisterDialog` (line 3802) | ✅ Complete — columns: date, payee, check#, routing, account, amount, run |
| Payroll by Department | Embedded in payroll section | ✅ Present |
| Workers Comp | Mentioned in report cards | ✅ Present |

### Expense Reports
| Report | Location | Status |
|--------|----------|--------|
| Expense List (CSV export) | `ExpenseReportSection` (line 3503) | ⚠️ Partial — exports flat list, no grouping |
| Expense by Category | Not implemented | ❌ Missing |
| Expense by Vendor | Not implemented | ❌ Missing |
| Unpaid Expenses / Accounts Payable Aging | Not implemented | ❌ Missing |
| Expense Payment History | Not implemented | ❌ Missing |

### Job Costing
| Report | Location | Status |
|--------|----------|--------|
| Job Cost Report | `JobCostReportSection` (line 3280) | ✅ Present |

### Missing Financial Reports
| Report | Priority | Notes |
|--------|----------|-------|
| Profit & Loss Summary | HIGH | Revenue (invoices paid) minus expenses by period — essential for tax prep |
| Vendor Payment History | HIGH | All checks/payments to each vendor — needed for 1099 threshold tracking |
| Accounts Payable Aging | HIGH | Unpaid approved expenses past due date |
| Expense by Category with Totals | MEDIUM | Grouped by expense category with subtotals and YTD — IRS Schedule C line items |
| Check Register (AP/Vendor) | MEDIUM | Currently shows payroll checks only; should include vendor/expense checks |
| Contractor Invoice Aging | MEDIUM | Outstanding unpaid contractor invoices |
| Reimbursement Liability Report | MEDIUM | Employee expenses approved but not yet reimbursed via payroll |
| Sales Tax / Use Tax Summary | LOW | Taxable purchases by category |
| Budget vs Actual | LOW | Requires budget module (not built) |

---

## 2. Accounting Usefulness Assessment

### Check Register (`CheckRegisterDialog`)
- **What it does:** Lists all payroll checks printed, by company/date range.
- **Gap:** Does NOT include vendor/expense checks generated via the AP workflow. After Task 3 implementation, expense checks should be logged here.
- **Fix:** Union the check_print_audit_logs with expense records where `payment_status='paid' AND check_number IS NOT NULL`.

### Expense Report (`ExpenseReportSection`)
- **What it does:** Flat CSV export of all expenses with status/vendor/amount/category.
- **Gap 1:** No subtotals by category. IRS Schedule C requires category-level totals (meals/travel/utilities/etc).
- **Gap 2:** Does not distinguish between `payment_status` states (unpaid/paid/voided). Adding the `payment_status` column from Task 2 would fix this.
- **Gap 3:** No date-range filter on the frontend (query is a full dump).
- **Fix (minimum):** Add `payment_status`, `check_number`, `paid_at` to the CSV export query. Add category subtotals in the UI table. Add a date-range filter.

---

## 3. Minimum Fixes for Tax Usefulness

### Fix A: Expense CSV includes payment data (immediate — schema already added)
The expense CSV export at `GET /api/expenses/export/csv` should include the new columns:
- `payment_status` — distinguishes unpaid vs paid
- `check_number` — for vendor check reconciliation  
- `paid_at` — payment date for cash-basis accounting
- `memo` — check memo / GL description

### Fix B: Vendor Payment Summary report (medium effort)
New endpoint `GET /api/reports/vendor-payments` returning:
```
vendor, total_paid, check_count, last_payment_date, ytd_amount
FROM expenses WHERE payment_status = 'paid'
GROUP BY payee_name
```
This is directly usable for 1099 threshold identification (vendors paid $600+).

### Fix C: AP Aging report (medium effort)
```sql
SELECT vendor, amount, expense_date, approved_at,
       CURRENT_DATE - approved_at::date AS days_outstanding
FROM expenses
WHERE status = 'approved' AND payment_status = 'unpaid'
ORDER BY days_outstanding DESC
```

### Fix D: P&L Summary (medium effort)
```sql
-- Revenue: sum of paid contractor invoices
SELECT SUM(amount) AS revenue FROM contractor_invoices WHERE status = 'paid'
-- Expenses: sum of paid/reimbursed expenses by category
SELECT category_name, SUM(amount) FROM expenses WHERE status IN ('approved','paid') GROUP BY 1
-- Payroll: sum of net pay from payroll runs
SELECT SUM(net_pay) FROM payroll_items pi JOIN payroll_runs pr ON pi.payroll_run_id = pr.id
WHERE pr.status = 'completed'
```

### Fix E: Check Register includes vendor checks (small effort)
In `CheckRegisterDialog`, union the existing `check_print_audit_logs` query with:
```sql
SELECT payee_name AS payee, check_number, paid_at AS check_date,
       amount, 'vendor' AS type
FROM expenses WHERE payment_status = 'paid' AND check_number IS NOT NULL
```

---

## 4. Priority Roadmap

1. **Immediate** (no new schema needed): Add `payment_status`/`check_number`/`paid_at` to expense CSV export.
2. **Short-term**: Add expense-by-category table with subtotals to `ExpenseReportSection` UI.
3. **Medium-term**: Vendor Payment Summary report + AP Aging report.
4. **Medium-term**: Extend Check Register to include vendor/AP checks.
5. **Long-term**: P&L Summary combining invoices + expenses + payroll.

---

## 5. Tax Filing Cross-Reference

| Tax Form | Data Source | Current Coverage |
|----------|-------------|-----------------|
| W-2 | payroll_items + workers | ✅ W-2 Generator exists |
| 1099-NEC | contractor_invoices + contractor payments | ✅ 1099 Generator exists (≥$600 threshold) |
| Schedule C (self-employed) | expenses by category | ⚠️ Expenses exist but no category totals |
| Form 940 (FUTA) | payroll tax records | ✅ Tax liability report covers this |
| Form 941 (quarterly payroll) | payroll tax records | ✅ Tax report covers quarterly view |
| Sales tax returns | N/A | ❌ Not tracked |
