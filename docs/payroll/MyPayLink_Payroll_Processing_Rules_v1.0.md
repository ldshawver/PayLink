# MyPayLink Payroll Processing Rules
**Version:** 1.0  
**Date:** April 2026  
**Scope:** USD payrolls only

---

## 1. Pay Period Resolution

1. Each company must have exactly one **active Pay Period Schedule** (`pay_period_schedules.isActive = true`).
2. The schedule type determines the number of periods per year used for salary proration:
   - `weekly` → 52 periods
   - `biweekly` → 26 periods
   - `semimonthly` → 24 periods
   - `monthly` → 12 periods
3. If no active schedule exists, the company's `payFrequency` field is used as the fallback.
4. Pay period start and end dates are resolved from the schedule or passed explicitly when creating a payroll run.
5. YTD (year-to-date) is anchored to the **payDate** (check date). If `payDate` is absent, `periodStart` year is used.

---

## 2. Worker Eligibility

1. Only **active** workers (`isActive = true`) are included in a payroll run.
2. Workers with `workerGroup = "volunteer"` are skipped (no compensation).
3. Workers with `workerGroup = "hourly_contractor"` or `"invoiced_contractor"` are treated as contractors — employee-side tax deductions are not applied.
4. `workerGroup = "owner_distribution"` workers follow the same rules as regular employees for deduction purposes unless custom tax records exclude them.

---

## 3. Pay Calculation

### Hourly Workers
- **Regular pay** = regular hours × hourly rate (from worker record or assigned wage group)
- **Overtime pay** = OT hours × (hourly rate × OT multiplier, or wage group overtime rate if set)
- **Double-time pay** = DT hours × hourly rate × 2.0
- Gross = regular + overtime + double-time + amendment earnings

### Salaried Workers
- **Regular pay** = annual salary ÷ periods per year
- OT and DT are calculated at `(annualSalary / 2080) × multiplier × hours`

### Amendments
- Active pay stub amendments with an `effectiveDate` within the pay period are included.
- Amendment type `"earning"` adds to gross; type `"deduction"` increases deductions.
- Amount is computed as: fixed amount, rate × units, or percentage of gross.

---

## 4. Deductions

1. Employee-side deductions (`isEmployerPaid = false`, `isReferenceOnly = false`) are applied to each eligible worker.
2. Deductions marked with `appliesTo = "contractor"` are skipped for employees.
3. Percentage-based deductions with a `maxAmount` apply a **wage-base cap** — the deduction is limited to the remaining cap relative to the worker's YTD gross.
4. After applying all deductions: `netPay = grossPay – totalDeductions`.

---

## 5. Payment Method Handling

Each payroll item carries a `paymentMethod` field. Supported values:

| Value | Description |
|-------|-------------|
| `ach` / `direct_deposit` | ACH electronic transfer |
| `check` | Paper check (default) |
| `cash` | Cash disbursement |
| `trade` | Trade/barter compensation |
| `other` | All other methods |

The **payroll summary** groups worker counts and amounts by payment method for funding reconciliation.

---

## 6. ACH vs. Check vs. Cash/Trade Flow

### ACH (Direct Deposit)
1. Worker must have an active pay method with `methodType = "direct_deposit"`, a valid routing number, and an account number.
2. A NACHA-format ACH file can be generated via `GET /api/payroll-runs/:id/nacha`.
3. After ACH file generation, call `POST /api/payroll-runs/:id/submit-ach` to:
   - Create an `ach_batches` record (`status = "submitted"`, `submittedAt = now`).
   - Link all ACH transaction rows in `payroll_transaction_runs` to the batch (`status = "submitted"`).
4. `ach_batches.settlementStatus` and `settledAt` are updated when settlement confirmation is received.
5. **"processed"** (run status) and **"ACH submitted"** (batch status) are separate states — a processed run is not automatically considered ACH-submitted.

### Check
1. Check numbers are assigned sequentially starting from `company.nextCheckNumber`.
2. `company.nextCheckNumber` is incremented and persisted after each payroll run.
3. Check numbers are stored on `payroll_items.checkNumber` and `payroll_transaction_runs.checkNumber`.

### Cash / Trade / Other
1. These methods do not generate electronic files.
2. They are tracked in `payroll_transaction_runs` and the payment-method breakout in `payroll_summaries`.

---

## 7. Funding Account Requirements

1. A `fundingAccountId` on a `payroll_run` or `payroll_transaction_run` identifies the company bank/wallet account funding the disbursement.
2. Funding accounts are defined in the `funding_accounts` table (`allowForPayroll = true`).
3. `fundingAccountId` can be set on the run when calling `POST /api/payroll-runs/:id/submit-ach`.
4. The `payroll_summaries.totalFundingRequired` = totalNet + totalEmployerTaxes — this is the minimum amount that must be available in the funding account.

---

## 8. Payroll Summary

After processing, a `payroll_summaries` record is automatically created (or upserted) containing:

| Field | Description |
|-------|-------------|
| `totalGross` | Sum of all workers' gross pay |
| `totalDeductions` | Sum of all employee-side deductions |
| `totalNet` | Sum of all workers' net pay |
| `totalEmployerTaxes` | Computed from active employer-paid tax records |
| `totalReimbursements` | Reserved for future reimbursement tracking |
| `totalFundingRequired` | `totalNet + totalEmployerTaxes` |
| `achCount` / `achAmount` | Workers paid via ACH |
| `checkCount` / `checkAmount` | Workers paid via check |
| `cashCount` / `cashAmount` | Workers paid via cash |
| `tradeCount` / `tradeAmount` | Workers paid via trade |
| `otherCount` / `otherAmount` | Workers paid via other methods |
| `workerCount` | Total workers included |

The summary always reconciles to the same totals as the individual `payroll_items` rows.

---

## 9. Payroll Transaction Runs

After processing, one `payroll_transaction_runs` row is created per worker containing:

| Field | Description |
|-------|-------------|
| `payrollRunId` | Parent payroll run |
| `payrollItemId` | Associated payroll item |
| `workerId` | Worker |
| `paymentMethod` | Payment method for this worker |
| `netPay` | Net pay amount |
| `payDate` | Disbursement date |
| `status` | `draft` → `approved` → `submitted` → `processed` → `paid` / `failed` / `voided` |
| `fundingAccountId` | Funding account (optional) |
| `checkNumber` | Check number (for check payments) |
| `achBatchId` | ACH batch reference (for ACH payments) |

---

## 10. Locking Rules

1. A payroll run can be locked by calling `POST /api/payroll-runs/:id/lock`.
2. Only runs with status `processed` or `paid` can be locked.
3. Once locked (`isLocked = true`):
   - Re-processing the run is blocked (409 response).
   - Mutations to `payroll_items` for this run are blocked (409 response).
   - Mutations to `pay_stub_transactions` linked to this run's items are blocked (409 response).
   - Mutations to `payroll_summaries` for this run are blocked (409 response).
4. Locking does **not** prevent reading or generating reports.
5. Locked runs cannot be deleted.

---

## 11. Duplicate Period Guard

Before processing, the system checks for another finalized run (`status = "processed"` or `"paid"`) covering the exact same `periodStart` / `periodEnd`. If found, processing is blocked with a 409 conflict response identifying the conflicting run.

---

## 12. YTD Deduplication

When computing YTD values, multiple processed/paid runs for the same period are deduplicated — only the canonical run (preferred: `paid` > `processed`, then latest `processedAt`) counts toward YTD accumulation.
