# Contractor Trade Compensation Statements

## Merge and production guard
Do not merge or deploy contractor trade compensation to production until the change has passed isolated staging validation with contractor and employee fixtures.

## Migration 0013 confirmation
`migrations/0013_contractor_trade_compensation.sql` is additive only: it uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`, with no `DROP`, `TRUNCATE`, destructive `DELETE`, column rename, or table rename statements.

## Employee paystub/check isolation
Employee paystub, tax, MICR, and check-face layout logic remains conditional. Contractor statement wording and cash-remainder settlement are gated by Independent Contractor worker groups (`hourly_contractor`, `invoiced_contractor`, or `independent_contractor`) and not by ordinary employee records.

## 1099 treatment
Trade goods credits are stored with `included_in_1099 BOOLEAN DEFAULT TRUE`. This documents the expected default that trade compensation is part of total contractor compensation for 1099 reporting. Tax filing/export logic must explicitly decide how to include or exclude these credits before production use; this change does not alter payroll tax calculations or employee W-2 logic.

## Rollback plan for migration 0013
1. Revert the application commit.
2. Leave the additive `contractor_trade_compensation` table and indexes in place if the migration has already run; the reverted app will stop reading/writing them.
3. If a physical rollback is required, take a database backup first, obtain Global Admin approval for the destructive action, then drop only the unused `contractor_trade_compensation` table/indexes in a controlled rollback window.

## Required staging validation before production
- Apply migration 0013 to isolated staging after a backup.
- Verify employee paystub/check PDF output byte/visual layout is unchanged for employee fixtures.
- Verify an Independent Contractor sees Contractor Statements and can download only their own statement.
- Verify tenant/company isolation by attempting cross-company statement and trade-credit access.
- Verify over-credit and unapproved trade credit block check printing.
- Verify approved trade credit reduces the printed check to the cash remainder while the statement shows total compensation, goods credit, and check amount.
- Verify MICR line placement/check-face layout against the existing check calibration fixture.
