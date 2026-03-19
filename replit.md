# PayLink - HR, Payroll & Time-clock Software

## Overview
PayLink is a comprehensive full-stack HR, Payroll & Time-clock application designed to manage employee and contractor time-tracking, scheduling, payroll, policies, and HR functions for multiple businesses. It aims to streamline human resources and payroll operations with a robust feature set including detailed employee management, advanced payroll processing, and extensive HR functionalities, all within a scalable architecture.

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
-   **UI/UX:** Features a sidebar with collapsible navigation and a consistent teal-to-blue gradient color theme (primary HSL(180, 55%, 42%)).

**Backend:**
-   **Framework:** Express.js + TypeScript.
-   **Authentication:** Session-based using `express-session` and `connect-pg-simple` with `bcrypt` for password hashing. All API routes, except authentication and time clock, are protected.
-   **RBAC:** Role-based access control is enforced at both frontend and backend levels, filtering navigation and protecting API write operations based on user roles (admin, manager, employee).
-   **API Design:** Provides comprehensive RESTful API endpoints for managing companies, workers, time, payroll, and HR. Includes specialized endpoints like `/api/payroll-summary` for reporting and `/api/time-clock/punch` for kiosk mode.

**Database:**
-   **Type:** PostgreSQL, managed with Drizzle ORM.
-   **Schema Design:** Supports an enterprise hierarchy (enterprises, companies, divisions, positions, cost centers, jobs), core operational data (workers, time punches, schedules, payroll runs), and extended functionalities (accruals, policies, HR records). Universal entities (Branches, Departments, Jobs, Positions, Stations, Employee Titles) can be assigned to all companies or specific ones.
-   **Permissions:** Granular role-based access control through `roles`, `role_permissions`, and `user_roles` tables, supporting five standard Permission Groups and a quick setup endpoint.

**Key Features:**
-   **Time & Attendance:** Time tracking, accrual management, scheduling with shift marketplace, and station-enforced clock in/out. Supports daily and double overtime calculations and secondary wage group rate overrides.
-   **Employee Management:** Full CRUD for employees, contacts, wages, pay methods, and documents. Includes self-service "My Profile" for employees.
-   **Company Management:** Comprehensive management of company structure, legal entities, and universal entities. Supports CSV import for bulk data entry.
-   **Payroll Processing:** Multi-step tax wizard, generation of tax forms, pay stub management, and support for complex tax and deduction rules.
-   **Policy Management:** Extensive engine covering various HR and payroll policies with quick setup for CA-compliant defaults.
-   **HR Functions:** Full CRUD for reviews, qualifications, skills, education, languages, memberships, and licenses, with company-level filtering.
-   **Reporting:** Employee, Timesheet, Payroll, Tax (W-2, 1099-NEC, 941, 940, DE 9, DE 9C, 1096), Expense, and Job Cost reports with CSV export and a saved reports system.
-   **Expense Management:** CRUD for expense receipts, including photo uploads, approval workflows, and check printing with job-cost allocation.
-   **User Account Management:** Admins can manage user accounts with role assignments and worker linkages. Login system supports employee PIN, manager username/password, and time clock kiosk modes.
-   **Schedule Publishing:** Managers can publish draft schedules, triggering email and SMS notifications to employees.
-   **My Profile (Self-Service):** All users see a "My Profile" section in the sidebar at `/my-profile` with 8 tabs: Preferences (language, timezone, date format, notification toggles for SMS/email on schedule and payday events, stored in `workers.preferences` JSON); Pay Stubs; Documents; Reviews (read-only); Qualifications (CRUD for skills/education/licenses); Languages; Memberships; Time Off. Admin accounts without a linked worker see graceful notices instead of errors.
-   **Time-Off Requests:** Employees submit time-off requests from My Profile → Time Off (`/my-profile?tab=time-off`). Fields: type (Vacation, Personal Day, Sick Leave, Unpaid Leave, Bereavement, Jury Duty, Medical Appointment, Other), start/end dates, optional start/end times, total days, reason. Status badge shows Pending/Approved/Rejected; pending requests can be cancelled. On submission, all admin/manager users for the company receive email + SMS. DB: `time_off_requests`. Backend: `GET/POST /api/my/time-off-requests`, `DELETE /api/my/time-off-requests/:id`.
-   **Schedule Preferences:** Employees record shift scheduling preferences from the same Time Off tab. Types: Day Off Preference (day of week: Sun–Sat) or Shift Time Preference (Early Morning 4–8am, Morning 8–12pm, Midday 11am–2pm, Afternoon 2–6pm, Evening 6–10pm, Graveyard 10pm–4am). Each preference has prefer/prefer-not toggle, importance 1–5 (1=Critical, 5=Lowest), optional note. DB: `schedule_preferences`. Backend: `GET/POST/PATCH/DELETE /api/my/schedule-preferences`.
-   **Time-Off Review (Manager):** Admins/managers review time-off requests at Attendance → Time-Off Requests (`/attendance?tab=time-off-requests`). Filterable by status (All/Pending/Approved/Rejected) and company. Clicking "Review" opens a dialog to Approve or Reject with an optional note. Decision triggers email + SMS notification to the worker. Backend: `GET /api/time-off-requests`, `PATCH /api/time-off-requests/:id/review`.
-   **HR Company Filters:** All HR tabs (Reviews, Qualifications, Skills, Education, Licenses, Languages, Memberships) have "All Companies" filter dropdowns.
-   **Permission System Extended:** Quick Setup endpoint includes new employee-facing resources: `my_preferences`, `my_paystubs`, `my_documents`, `my_reviews`, `my_qualifications`.

## External Dependencies
-   **PostgreSQL:** Primary application database.
-   **NGINX:** Reverse proxy for production.
-   **PM2:** Node.js process manager for production.
-   **Nodemailer:** Optional email notifications (requires SMTP configuration).
-   **Twilio:** Optional SMS notifications (requires Twilio account configuration).