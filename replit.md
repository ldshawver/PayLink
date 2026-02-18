# PayLink - HR, Payroll & Time-clock Software

## Overview
PayLink is a comprehensive full-stack HR, Payroll & Time-clock application for managing employee and contractor time-tracking, scheduling, payroll, policies, and HR for multiple businesses. Built with React + Express + PostgreSQL.

## Tech Stack
- **Frontend**: React + TypeScript, Tailwind CSS, shadcn/ui components, Wouter routing, TanStack Query
- **Backend**: Express.js + TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Build**: Vite for frontend, TSX for backend

## Project Structure
```
client/src/
├── pages/           # Section pages (dashboard, attendance, schedule, employee, company, payroll, policy, hr, reports)
├── components/      # Reusable components (app-sidebar with collapsible nav, theme-provider, theme-toggle)
├── components/ui/   # shadcn/ui base components
├── hooks/           # Custom hooks
├── lib/             # Utilities (queryClient)
server/
├── index.ts         # Express server entry
├── routes.ts        # API route handlers (150+ endpoints)
├── storage.ts       # Database storage layer (IStorage interface with 130+ methods)
├── db.ts            # Drizzle database connection
├── seed.ts          # Database seed data
shared/
├── schema.ts        # Drizzle schema + Zod validation + TypeScript types (43+ tables)
```

## Navigation Structure
Sidebar with collapsible sections:
1. **Dashboard** - Configurable dashlets (News, Exceptions, Messages, Who's In/Out, Schedule Summary, Timesheet Summary, etc.)
2. **Attendance** - Timesheet, Punches, Accrual Balances, Accruals (tabs)
3. **Schedule** - Schedules (week view), Scheduled Shifts, Recurring Schedule, Recurring Templates (tabs)
4. **Employee** - Employee list/CRUD (enhanced form with Employment/Identity/Contact/Payroll/Notes sections), Contacts, Preferences, Wages (wage history with effective dates), Pay Methods (with remittance source/priority/amount type), Titles (CRUD), Employee Groups (CRUD with hierarchy), Ethnic Groups, New Hire Defaults (CRUD)
5. **Company** - Company Info, Legal Entity (full CRUD with status/type/classification/address), Branches, Departments, Hierarchy, Permissions, Import (tabs)
6. **Payroll** - Process Payroll, Tax Wizard (4-step wizard: Select Events → Review/Verify → Submit → Complete), Pay Stubs, Pay Periods, Taxes & Deductions, Remittance (tabs)
7. **Policy** - Policy Groups, Pay Codes, Accrual Accounts, Recurring Holidays, Pay Formulas, Contributing Pay Codes, Contributing Shifts, Regular Time, Overtime, Premium, Meal, Break, Schedule, Exception, Accrual, Absence, Holiday, Rounding policies (18 tabs, all with full CRUD)
8. **HR** - Reviews, Qualifications, KPI Groups, Skills, Education, Memberships, Licenses, Languages (tabs)
9. **Report** - Saved Reports, Employee Reports (Who's In, Employee Info, Audit Trail), Timesheet Reports (Schedule/Timesheet Summary/Detail, Punch Summary, Accrual Balance, Exception Summary), Payroll Reports (Paystub Summary, Payroll Export, General Ledger), Tax Reports, HR Reports (Qualification/Review Summary) - all with CSV export

## Database Schema
Core tables:
- `companies` - Business entities with policy settings (OT threshold, break policies, rounding)
- `workers` - Employees and contractors with pay rates, contacts, ethnicity
- `time_punches` - Clock in/out/break events
- `time_entries` - Daily time records with hours/overtime
- `schedules` - Shift schedules per worker
- `payroll_runs` - Payroll processing runs
- `payroll_items` - Per-worker payroll line items

Extended tables:
- `departments` - Company departments
- `branches` - Company branch locations
- `accrual_accounts` - PTO/sick/vacation accrual types
- `accrual_balances` - Per-worker accrual balances
- `legal_entities` - Legal/tax entities under a company (status, type, classification, addresses)
- `employee_contacts` - Emergency/personal contacts
- `pay_methods` - Direct deposit/check payment methods
- `pay_periods` - Pay period definitions
- `taxes_deductions` - Tax and deduction configurations
- `policy_groups` - Named policy groupings
- `pay_codes` - Pay code definitions
- `holidays` - Recurring and one-time holidays
- `qualifications` - Skills, certifications, licenses
- `reviews` - Performance reviews with ratings
- `employee_titles` - Company title definitions
- `employee_groups` - Hierarchical employee groups with parentId
- `wage_history` - Wage tracking with effective dates, labor burden, average hours
- `new_hire_defaults` - Company-level default configuration templates
- `recurring_schedules` - Repeating weekly schedules
- `users` - System users
- `remittance_sources` - Bank accounts/payment sources for paying employees
- `remittance_agencies` - Government entities for tax filings/payments
- `remittance_agency_events` - Scheduled events (payments/filings) for agencies
- `pay_stub_accounts` - Pay stub line item categories (earnings/deductions/benefits)
- `pay_stub_amendments` - One-time pay adjustments per worker
- `pay_stub_transactions` - Payment transaction records
- `pay_period_schedules` - Recurring pay period schedule definitions

Policy tables (15 types):
- `pay_formulas` - Pay calculation formulas (multiplier, flat rate, hourly, salary)
- `contributing_pay_codes` - Pay code groups for policy calculations
- `contributing_shifts` - Shift filters for policy calculations
- `regular_time_policies` - Regular time calculation rules
- `overtime_policies` - OT rules (daily/weekly/biweekly/consecutive)
- `premium_policies` - Premium pay rules (shift differential, holiday, etc.)
- `meal_policies` - Meal break rules (normal/auto-deduct/auto-add)
- `break_policies` - Break rules (normal/auto-deduct/auto-add)
- `schedule_policies` - Schedule adherence rules
- `exception_policies` - Time exception rules (missed punch, late, etc.)
- `accrual_policies` - Accrual earning rules (standard/calendar/hour-based)
- `accrual_policy_milestones` - Accrual policy length-of-service milestones
- `absence_policies` - Absence/leave rules
- `holiday_policies` - Holiday pay rules
- `rounding_policies` - Time rounding rules (day total/punch)

## API Routes
Company: GET/POST /api/companies, PATCH /api/companies/:id
Workers: GET/POST /api/workers, PATCH /api/workers/:id
Time: GET/POST /api/time-punches, GET/PATCH /api/time-entries
Schedules: GET/POST /api/schedules
Payroll: GET/POST /api/payroll-runs, GET /api/payroll-runs/:id/items, PATCH /api/payroll-runs/:id
Departments: GET/POST/PATCH/DELETE /api/departments
Branches: GET/POST/PATCH/DELETE /api/branches
Legal Entities: GET/POST/PATCH/DELETE /api/legal-entities
Accruals: GET/POST/PATCH /api/accrual-accounts, /api/accrual-balances
Contacts: GET/POST/PATCH/DELETE /api/employee-contacts
Pay Methods: GET/POST/PATCH/DELETE /api/pay-methods
Pay Periods: GET/POST/PATCH /api/pay-periods
Taxes: GET/POST/PATCH/DELETE /api/taxes-deductions
Policies: GET/POST/PATCH/DELETE /api/policy-groups, /api/pay-codes
Holidays: GET/POST/PATCH/DELETE /api/holidays
HR: GET/POST/PATCH/DELETE /api/qualifications, /api/reviews
Recurring: GET/POST/PATCH/DELETE /api/recurring-schedules
Remittance Sources: GET/POST/PATCH/DELETE /api/remittance-sources
Remittance Agencies: GET/POST/PATCH/DELETE /api/remittance-agencies
Agency Events: GET/POST/PATCH/DELETE /api/remittance-agency-events (filtered by agencyId)
Pay Stub Accounts: GET/POST/PATCH/DELETE /api/pay-stub-accounts
Pay Stub Amendments: GET/POST/PATCH/DELETE /api/pay-stub-amendments
Pay Stub Transactions: GET/POST/PATCH /api/pay-stub-transactions
Pay Period Schedules: GET/POST/PATCH/DELETE /api/pay-period-schedules
Dashboard: GET /api/dashboard/stats
Policy Types: GET/POST/PATCH/DELETE for /api/pay-formulas, /api/contributing-pay-codes, /api/contributing-shifts, /api/regular-time-policies, /api/overtime-policies, /api/premium-policies, /api/meal-policies, /api/break-policies, /api/schedule-policies, /api/exception-policies, /api/accrual-policies, /api/absence-policies, /api/holiday-policies, /api/rounding-policies
Accrual Milestones: GET/POST/DELETE /api/accrual-policy-milestones

## Color Theme
Teal-to-blue gradient matching PayLink logo: primary HSL(180, 55%, 42%), dark sidebar

## Running
- `npm run dev` - Start development server (port 5000)
- `npm run db:push` - Push schema to database

## VPS Deployment
1. Push to GitHub
2. Clone on VPS, install Node.js 20+ and PostgreSQL
3. Set DATABASE_URL, SESSION_SECRET, PORT env vars
4. `npm install && npm run build`
5. `npm run db:push` to create tables
6. `NODE_ENV=production node dist/index.js`
7. Use NGINX reverse proxy + PM2
