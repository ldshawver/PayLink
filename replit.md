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
├── routes.ts        # API route handlers (70+ endpoints)
├── storage.ts       # Database storage layer (IStorage interface with 60+ methods)
├── db.ts            # Drizzle database connection
├── seed.ts          # Database seed data
shared/
├── schema.ts        # Drizzle schema + Zod validation + TypeScript types (20+ tables)
```

## Navigation Structure
Sidebar with collapsible sections:
1. **Dashboard** - Configurable dashlets (News, Exceptions, Messages, Who's In/Out, Schedule Summary, Timesheet Summary, etc.)
2. **Attendance** - Timesheet, Punches, Accrual Balances, Accruals (tabs)
3. **Schedule** - Schedules (week view), Scheduled Shifts, Recurring Schedule, Recurring Templates (tabs)
4. **Employee** - Employee list/CRUD, Contacts, Preferences, Wages, Pay Methods, Titles, Groups (tabs)
5. **Company** - Company Info, Legal Entity, Branches, Departments, Hierarchy, Permissions, Import (tabs)
6. **Payroll** - Process Payroll, Tax Wizard, Pay Stubs, Pay Periods, Taxes & Deductions, Remittance (tabs)
7. **Policy** - Policy Groups, Pay Codes, Accrual Accounts, Recurring Holidays, 14+ policy type placeholders (tabs)
8. **HR** - Reviews, Qualifications, KPI Groups, Skills, Education, Memberships, Licenses, Languages (tabs)
9. **Report** - Saved Reports, Employee/Timesheet/Payroll/Tax/HR report generators (tabs)

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
- `employee_contacts` - Emergency/personal contacts
- `pay_methods` - Direct deposit/check payment methods
- `pay_periods` - Pay period definitions
- `taxes_deductions` - Tax and deduction configurations
- `policy_groups` - Named policy groupings
- `pay_codes` - Pay code definitions
- `holidays` - Recurring and one-time holidays
- `qualifications` - Skills, certifications, licenses
- `reviews` - Performance reviews with ratings
- `recurring_schedules` - Repeating weekly schedules
- `users` - System users

## API Routes
Company: GET/POST /api/companies, PATCH /api/companies/:id
Workers: GET/POST /api/workers, PATCH /api/workers/:id
Time: GET/POST /api/time-punches, GET/PATCH /api/time-entries
Schedules: GET/POST /api/schedules
Payroll: GET/POST /api/payroll-runs, GET /api/payroll-runs/:id/items, PATCH /api/payroll-runs/:id
Departments: GET/POST/PATCH/DELETE /api/departments
Branches: GET/POST/PATCH/DELETE /api/branches
Accruals: GET/POST/PATCH /api/accrual-accounts, /api/accrual-balances
Contacts: GET/POST/PATCH/DELETE /api/employee-contacts
Pay Methods: GET/POST/PATCH/DELETE /api/pay-methods
Pay Periods: GET/POST/PATCH /api/pay-periods
Taxes: GET/POST/PATCH/DELETE /api/taxes-deductions
Policies: GET/POST/PATCH/DELETE /api/policy-groups, /api/pay-codes
Holidays: GET/POST/PATCH/DELETE /api/holidays
HR: GET/POST/PATCH/DELETE /api/qualifications, /api/reviews
Recurring: GET/POST/PATCH/DELETE /api/recurring-schedules
Dashboard: GET /api/dashboard/stats

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
