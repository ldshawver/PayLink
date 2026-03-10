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
-   **RBAC:** Write operations on companies, workers, and payroll require `admin` or `manager` role via `requireRole()` middleware. Deleting payroll runs requires `admin` only.
-   **API Design:** Provides a comprehensive set of RESTful API endpoints for managing various entities like companies, workers, time punches, schedules, payroll, and HR components. Includes `/api/payroll-summary` for aggregated payroll data used by tax reports.

**Database:**
-   **Type:** PostgreSQL, managed with Drizzle ORM.
-   **Schema Design:** Features a robust schema supporting enterprise hierarchy (enterprises, companies, divisions, positions, cost centers, jobs), core operational data (workers, time punches, time entries, schedules, payroll runs), and extended functionalities (accruals, legal entities, pay methods, policies, taxes, HR records).
-   **Permissions:** A flexible role-based access control system is implemented via `roles`, `role_permissions`, and `user_roles` tables, allowing granular control over resource access and actions (view, create, edit, delete, export, approve). Five standard Permission Groups are seeded: System Administrator, HR Manager, Payroll Manager, Department Manager, Employee. Quick Setup endpoint at POST `/api/permission-groups/quick-setup` creates/updates all 5 groups with proper permissions. The Permission Matrix UI in the Company page shows 6 action columns (View, Create, Edit, Delete, Export, Approve) across 17 resource modules.

**Key Features:**
-   **Dashboard:** Configurable with various dashlets.
-   **Time & Attendance:** Includes timesheet, punches, accrual balances, and scheduling capabilities. Time entries track optional `wageGroupId` for secondary wage group rate overrides.
-   **Employee Management:** Comprehensive CRUD for employees, contacts, preferences, documents, wages, pay methods, titles, and groups. Employees can be assigned multiple Secondary Wage Groups via the "Wage Groups" tab (uses `employee_wage_groups` linking table).
-   **Company Management:** Full CRUD for company information, legal entities, enterprise structures, divisions, branches, departments, positions, cost centers, jobs (with payType/defaultWage/department fields), stations, secondary wage groups, currencies, and hierarchical visualization. Includes permission management with role-based access. CSV Import wizard supports bulk importing employees, departments, and jobs. Quick Start checklist guides initial setup.
-   **Payroll Processing:** Features a multi-step tax wizard for payroll processing, generation of tax forms (W-2, 1099-NEC, 941, 940), management of pay stubs, pay periods, taxes, and deductions. Quick Setup seeds 28 CA-compliant tax items (Federal + CA state taxes, employer taxes, SE tax references). Supports check layout customization with MICR font. Payroll engine supports daily OT (8hr threshold), double time (12hr threshold at 2x), SE Tax filtering (excluded for W-2 employees), and secondary wage group rate overrides per time entry. Pay stubs show employer address, total hours, and accrual/leave balances.
-   **Remittance Management:** Quick Setup creates default company checking account (Remittance Source), IRS and CA EDD (Remittance Agencies). Agencies link to sources for tax payment routing.
-   **Policy Management:** Extensive policy engine covering regular time, overtime, premium pay, meal/break rules, scheduling, exceptions, accruals, absences, holidays, and rounding. Policy Groups link to all 12 individual policy types via FK columns. Quick Setup endpoints seed CA-compliant defaults for all policy types and 10 US recurring holidays.
-   **HR Functions:** Full CRUD modules for reviews, qualifications, qualification groups, KPI groups, skills, education, languages, memberships, and licenses. Skills/Education/Licenses filter from qualifications table by type; KPI groups, qualification groups, languages, and memberships have dedicated tables.
-   **Reporting:** Employee, Timesheet, Payroll, Tax (W-2 Annual, 1099-NEC quarterly/annual, Form 941, Form 940, DE 9, DE 9C, Form 1096), and HR reports with CSV export and print functionality. Tax reports use actual payroll data from `/api/payroll-summary` endpoint (not estimates). Saved Reports system allows saving any generated report to a `saved_reports` table, browsing saved reports with search/category filters, viewing saved data, re-exporting CSV, and deleting reports.
-   **File Upload:** Supports secure document uploads for employee records (W-4, W-9, I-9, DE 4, Photo ID, tax forms, employment/contractor agreements; PDF/DOC/images up to 10MB).
-   **Header Clock In/Out:** Persistent clock in/out button in the top header bar, visible on all pages. Admin/managers can select any clockable worker; linked workers see their own status. Shows live time, current clock status (Clocked In/On Break), and today's activity history.
-   **Contractor Subtypes:** Workers of type "contractor" have an additional `contractorType` field: "hourly" (clocks in/out like employees) or "invoice" (submits invoices, excluded from time clock). Backend enforces that invoice-based contractors cannot punch in/out.
-   **User Account Management:** Admins can create, edit, and delete user accounts from the Employee > User Accounts tab. Each account has a username, password, role (admin/manager/employee), optional company assignment, and optional link to a worker record. Accounts can be enabled/disabled. The `users` table includes `worker_id`, `is_active`, and `created_at` columns. User listing requires admin or manager role; create/update/delete require admin role.
-   **Login System:** The login page has three tabs: (1) **Employee** — sign in with employee number + PIN (default tab), auto-creates a user account linked to the worker if one doesn't exist; (2) **Manager** — sign in with username + password for admin/manager accounts; (3) **Time Clock** — employee number + PIN for punch-only kiosk mode (no full app access). PIN login endpoint: `POST /api/auth/pin-login`.

## External Dependencies
-   **PostgreSQL:** Primary database for all application data.
-   **NGINX:** Used as a reverse proxy in production deployments.
-   **PM2:** Process manager for Node.js applications in production.