# PayLink - HR, Payroll & Time-clock Software

## Overview
PayLink is a comprehensive full-stack HR, Payroll & Time-clock application designed to manage employee and contractor time-tracking, scheduling, payroll, policies, and HR functions for multiple businesses. It aims to streamline human resources and payroll operations.

## User Preferences
When deploying updates to the VPS, ALWAYS follow this exact sequence:
1. BACKUP the database FIRST.
2. Pull new code.
3. Install any new dependencies.
4. Build.
5. Copy session table SQL (required after every build).
6. Apply schema changes (safe - only adds, never drops).
7. Restart the app.
8. Verify.
Create the backups directory first: `mkdir -p ~/backups`.
If anything goes wrong, restore: `psql -U lshawver -h 127.0.0.1 paylink < ~/backups/paylink_backup_YYYYMMDD_HHMMSS.sql`.

Schema Change Rules (CRITICAL - NEVER VIOLATE):
1. NEVER drop existing tables - only add new tables.
2. NEVER remove columns from existing tables - only add new columns with ALTER TABLE ADD COLUMN IF NOT EXISTS.
3. NEVER rename tables or columns - this breaks existing data and foreign keys.
4. NEVER change column types on existing columns.
5. When adding features, ADD columns/tables alongside existing ones - never replace.
6. All new columns MUST have defaults or be nullable so existing rows are not affected.
7. Test all schema changes on Replit dev database BEFORE deploying to VPS.
8. The VPS database contains REAL production data - treat it as sacred.

## System Architecture
PayLink is built with a React frontend, an Express.js backend, and a PostgreSQL database.

**Frontend:**
-   **Frameworks & Libraries:** React + TypeScript, Tailwind CSS, shadcn/ui components, Wouter for routing, TanStack Query for data fetching.
-   **UI/UX:** Features a sidebar with collapsible navigation sections. The color theme uses a teal-to-blue gradient (primary HSL(180, 55%, 42%)) matching the PayLink logo for a consistent visual identity.

**Backend:**
-   **Framework:** Express.js + TypeScript.
-   **Authentication:** Session-based using `express-session` and `connect-pg-simple` (PostgreSQL session store), with `bcrypt` for password hashing. All API routes, except authentication endpoints and the time clock, are protected.
-   **RBAC:** Role-based access enforced at both frontend and backend levels. Frontend sidebar filters navigation sections by user role (employees see Dashboard, Attendance, Schedule only; managers see those plus Employee, Company, Payroll, HR, Reports; admins see everything including Policy). Route guards redirect unauthorized users to Dashboard. Backend enforces `requireRole()` middleware on write operations: companies/workers/payroll/HR/company-structure require `admin` or `manager`; policy management and user account CRUD require `admin` only; deleting payroll runs and workers requires `admin` only.
-   **API Design:** Provides a comprehensive set of RESTful API endpoints for managing various entities like companies, workers, time punches, schedules, payroll, and HR components. Includes `/api/payroll-summary` for aggregated payroll data used by tax reports.

**Database:**
-   **Type:** PostgreSQL, managed with Drizzle ORM.
-   **Schema Design:** Features a robust schema supporting enterprise hierarchy (enterprises, companies, divisions, positions, cost centers, jobs), core operational data (workers, time punches, time entries, schedules, payroll runs), and extended functionalities (accruals, legal entities, pay methods, policies, taxes, HR records).
-   **Permissions:** A flexible role-based access control system is implemented via `roles`, `role_permissions`, and `user_roles` tables, allowing granular control over resource access and actions (view, create, edit, delete, export, approve). Five standard Permission Groups are seeded: System Administrator, HR Manager, Payroll Manager, Department Manager, Employee. Quick Setup endpoint at POST `/api/permission-groups/quick-setup` creates/updates all 5 groups with proper permissions. The Permission Matrix UI in the Company page shows 6 action columns (View, Create, Edit, Delete, Export, Approve) across 17 resource modules.

**Key Features:**
-   **Dashboard:** Configurable with various dashlets.
-   **Time & Attendance:** Includes timesheet, punches, accrual balances, and scheduling capabilities. Time entries track optional `wageGroupId` for secondary wage group rate overrides.
-   **Employee Management:** Comprehensive CRUD for employees, contacts, preferences, documents, wages, pay methods, titles, and groups. Employees can be assigned multiple Secondary Wage Groups via the "Wage Groups" tab (uses `employee_wage_groups` linking table).
-   **Company Management:** Full CRUD for company information, legal entities, enterprise structures, divisions, branches, departments, positions, cost centers, jobs (with payType/defaultWage/department fields), stations, secondary wage groups, currencies, and hierarchical visualization. Includes permission management with role-based access. CSV Import wizard supports bulk importing employees, departments, and jobs. Quick Start checklist guides initial setup. **Universal entities**: Branches, Departments, Jobs, Positions, Stations, and Employee Titles can all be set to "All Companies (Universal)" (null companyId) or assigned to a specific company — just like stations. The `company_id` column is nullable for all these tables.
-   **Payroll Processing:** Features a multi-step tax wizard for payroll processing, generation of tax forms (W-2, 1099-NEC, 941, 940), management of pay stubs, pay periods, taxes, and deductions. Quick Setup seeds 28 CA-compliant tax items (Federal + CA state taxes, employer taxes, SE tax references). Supports check layout customization with MICR font. Payroll engine supports daily OT (8hr threshold), double time (12hr threshold at 2x), SE Tax filtering (excluded for W-2 employees), and secondary wage group rate overrides per time entry. Pay stubs show employer address, total hours, and accrual/leave balances.
-   **Remittance Management:** Quick Setup creates default company checking account (Remittance Source), IRS and CA EDD (Remittance Agencies). Agencies link to sources for tax payment routing.
-   **Policy Management:** Extensive policy engine covering regular time, overtime, premium pay, meal/break rules, scheduling, exceptions, accruals, absences, holidays, and rounding. Policy Groups link to all 12 individual policy types via FK columns. Quick Setup endpoints seed CA-compliant defaults for all policy types and 10 US recurring holidays.
-   **HR Functions:** Full CRUD modules for reviews, qualifications, qualification groups, KPI groups, skills, education, languages, memberships, and licenses. Skills/Education/Licenses filter from qualifications table by type; KPI groups, qualification groups, languages, and memberships have dedicated tables.
-   **Reporting:** Employee, Timesheet, Payroll, Tax (W-2 Annual, 1099-NEC quarterly/annual, Form 941, Form 940, DE 9, DE 9C, Form 1096), HR, **Expense Reports**, and **Job Cost Reports** with CSV export and print functionality. Expense Reports tab groups receipts by cost center, job, category, or company with CSV export. Tax reports use actual payroll data from `/api/payroll-summary` endpoint (not estimates). Saved Reports system allows saving any generated report to a `saved_reports` table, browsing saved reports with search/category filters, viewing saved data, re-exporting CSV, and deleting reports. **Job Cost Report**: Groups scheduled shifts by job, calculates labor cost (hours × pay rate) per job, includes receipt expenses (where includeInJobCost=true), shows expandable rows per job with per-shift breakdown, date range and company filters, CSV export.
-   **Dashboard Widget Permissions (T009):** Dashboard dashlets are filtered by user role. Employees see only role-appropriate widgets (News, Messages, Requests, Schedule Summary, Who's In/Out, Timesheet Summary). Manager/admin-only widgets (Exception Summary, Request Authorizations, Exceptions, Exceptions Subordinates, Schedule Summary Subordinates) are hidden from employee role users and excluded from the Configure dialog.
-   **File Upload:** Supports secure document uploads for employee records (W-4, W-9, I-9, DE 4, Photo ID, tax forms, employment/contractor agreements; PDF/DOC/images up to 10MB).
-   **Header Clock In/Out:** Persistent clock in/out button in the top header bar, visible on all pages. Admin/managers can select any clockable worker; linked workers see their own status. Shows live time, current clock status (Clocked In/On Break), and today's activity history. Stale open time entries from previous days are auto-closed (capped at 8h) when a new clock_in is recorded. Employee role users can only punch for themselves; admin/managers can punch for any worker. **Station enforcement**: if a company has active stations configured, employees MUST select a station to clock in — the Clock In button is disabled until a station is chosen. Station selection removes the "No Station" option and highlights the requirement in amber. Both header and kiosk endpoints enforce this at the server side as well. Time Clock kiosk uses dedicated `/api/time-clock/punch` and `/api/time-clock/punches` endpoints that authenticate via employeeNumber+PIN inline (no session required), enabling session-free kiosk operation.
-   **Expenses & Receipts:** Full CRUD for expense receipts at `/expenses` page. Receipts track vendor, amount, date, category, cost center, job, company, employee, photo upload, approval status (pending/approved/rejected), and `includeInJobCost` boolean. Accessible from Attendance section in sidebar. Backend: `receipts` table with `include_in_job_cost` and `check_number` columns, `/api/receipts` CRUD routes, `/api/receipts/upload` for photo uploads. **Expense Check Printing**: multi-select checkboxes in the receipts table plus "Print Check" per-row action navigate to `/print-expense-check?ids=...` which renders standard 3-part checks (check body + remittance stub + vendor copy) for each selected expense, with MICR line, amount in words, company as payer, vendor as payee, job-cost allocation box, and auto-assigned check numbers saved back to the receipt.
-   **Shift Marketplace (T008):** Employees can offer shifts for others to pick up directly from the schedule grid (hover to see amber ⚡ button). Other employees can claim offered shifts; managers approve via the "Shift Marketplace" tab on the Schedule page. Offered shifts appear highlighted in amber on the schedule grid. Backend: `shift_offers` table, `/api/shift-offers` CRUD routes.
-   **Job Assignment on Shifts:** Schedules have a `job_id` FK to the `jobs` table. Add/Edit Shift dialogs include a Job dropdown (filtered by company + universal jobs). The assigned job name is shown on shift cards in the schedule grid in blue. Job cost is tracked via the Job Cost report in Reports.
-   **Contractor Subtypes:** Workers of type "contractor" have an additional `contractorType` field: "hourly" (clocks in/out like employees) or "invoice" (submits invoices, excluded from time clock). Backend enforces that invoice-based contractors cannot punch in/out.
-   **User Account Management:** Admins can create, edit, and delete user accounts from the Employee > User Accounts tab. Each account has a username, password, role (admin/manager/employee), optional company assignment, and optional link to a worker record. Accounts can be enabled/disabled. The `users` table includes `worker_id`, `is_active`, and `created_at` columns. User listing requires admin or manager role; create/update/delete require admin role.
-   **Login System:** The login page has three tabs: (1) **Employee** — sign in with employee number + PIN (default tab) using on-screen NumPad (buttons have type="button" to prevent form submission), auto-creates a user account linked to the worker if one doesn't exist; (2) **Manager** — sign in with username + password for admin/manager accounts; (3) **Time Clock** — employee number + PIN for punch-only kiosk mode (no full app access). PIN login endpoint: `POST /api/auth/pin-login`.
-   **Company Icons:** Company cards display a gradient letter icon (teal-to-blue, showing first letter of company name) when no logo/icon image is uploaded. Uploaded logos/icons take priority over the letter fallback.

## External Dependencies
-   **PostgreSQL:** Primary database for all application data.
-   **NGINX:** Used as a reverse proxy in production deployments.
-   **PM2:** Process manager for Node.js applications in production.