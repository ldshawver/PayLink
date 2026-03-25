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
-   **Expense Management:** CRUD for expense receipts, including photo uploads, approval workflows, and check printing with job-cost allocation. AI-powered receipt scanning via OpenAI vision (`POST /api/receipts/ai-scan`) extracts vendor, items, quantities, costs, tax, totals, and payment method from receipt photos. Job cost field is a dropdown of existing jobs (not a boolean). Receipts track payment method, subtotal, tax amount, and line items (stored as JSON). Accessible from both Time & Attendance and Payroll sidebar sections.
-   **User Account Management:** Admins can manage user accounts with role assignments and worker linkages. Login system supports employee PIN, manager username/password, and time clock kiosk modes.
-   **Schedule Publishing:** Managers can publish draft schedules, triggering email and SMS notifications to employees. Publishing is blocked (HTTP 409) if any scheduled employee has approved time-off during a shift.
-   **Time-Off Management:** Time-off requests with approval workflow. On approval/denial, email and SMS notifications are sent to the employee. Approved time-off is visible on the schedule grid as orange "TIME OFF" overlays.
-   **NACHA ACH Direct Deposit:** Each payroll run has a "Direct Deposit (ACH) this payroll" toggle (on by default) and a Pay Date field. When a run is processed and direct deposit is enabled, a "Download ACH File" button generates a NACHA-formatted `.ach` file to upload to the company's bank, initiating all direct deposits. Workers without bank account info on file are skipped and receive checks. Source bank info is pulled from the company's Remittance Sources. Backend: `GET /api/payroll-runs/:id/nacha`. DB: `payroll_runs.use_direct_deposit` (boolean, default true), `payroll_runs.pay_date` (date).
-   **Payroll Audit:** Audit engine (`GET /api/payroll-audit`) scans all companies for missing EINs, missing SSNs, worker classification mismatches (workerType vs workerGroup), contractor deductions in processed runs, missing tax setup, and volunteer time entries. Dashboard at `/payroll-audit` with summary cards and detailed issue list.
-   **Worker Groups:** 7 worker group types: `hourly_employee`, `salaried_employee`, `hourly_contractor`, `invoiced_contractor`, `shareholder_employee`, `owner_distribution`, `volunteer`. Stored in `workers.worker_group` column. Volunteers are excluded from payroll runs. Contractors (by group or type) always get zero deductions. Managed via `employee_group_configs` table.
-   **RBAC Roles:** System Administrator, Owner, HR Manager, Payroll Manager, Department Manager, Supervisor, Employee, Contractor — seeded with permission matrices in `server/seed.ts`.
-   **Universal Entities:** Divisions, Cost Centers, and Secondary Wage Groups have nullable `companyId` — null means "available to all companies." Storage queries return universal + company-specific items.
-   **Shift Marketplace (HotSchedules-style):** Employees post shifts for pickup via `shift_marketplace_listings` table. Other workers request to pick up shifts via `shift_marketplace_requests` with automatic eligibility checks (company/dept/branch/group/position/conflict/leave/weekly hours/rest periods via `server/eligibility.ts`). Managers approve/deny requests; approval reassigns `schedules.workerId`. Eligibility rule sets (`eligibility_rule_sets` table) allow configurable constraints. All actions logged to `schedule_audit_logs`. Responsibility policy: original worker keeps shift until approved replacement. Server-side authorization enforces worker ownership (listedByWorkerId/requestingWorkerId derived from session). Frontend: MarketplaceSection component with sub-tabs (Available Shifts, My Posted, My Requests, Approvals, Legacy Offers, Audit Log). API: `GET/POST /api/marketplace/listings`, `PATCH /api/marketplace/listings/:id`, `GET/POST /api/marketplace/requests`, `PATCH /api/marketplace/requests/:id/review`, `POST /api/marketplace/eligibility-check`, `GET /api/schedule-audit-logs`.
-   **SaaS Trial & Billing System:** Starter plan at $29/mo base + $4/active employee. 30-day free trial via self-service signup at `mypaylink.app/signup`. Subscription statuses: `trial_active`, `trial_expired`, `active_paid`, `past_due`, `suspended`, `canceled`. Trial expired accounts get soft lockout (read-only, payroll/exports/employee creation blocked). Upgrade modal prompts on trial expiry. DB tables: `trial_signups`, `analytics_events`, `onboarding_progress`. Companies table has `subscription_status`, `plan_name`, `trial_start`, `trial_end`, `trial_used`, `billing_active`, `payment_method_on_file`, `is_demo` columns. API: `POST /api/trial/signup`, `GET /api/trial/status`, `GET/PATCH /api/onboarding/progress`, `POST /api/analytics/event`, `POST /api/demo/login`, `POST /api/billing/activate`.
-   **Interactive Demo Mode:** `/demo` page on public site launches a pre-seeded demo company with 5 sample employees. Demo session is read-only with purple banner. Demo data auto-created on first launch. API: `POST /api/demo/login`.
-   **Onboarding Checklist:** Dashboard widget for trial accounts with 6 setup steps: company details, first employee, pay schedule, payroll config, time clock, payroll preview. Progress tracked in `onboarding_progress` table. Disappears after all steps completed.
-   **Analytics Tracking:** Event tracking for signup flow, trial lifecycle, and key user actions. Events: `pricing_page_view`, `signup_started`, `signup_completed`, `trial_started`, `view_demo_click`, `demo_started`, `subscription_activated`. Stored in `analytics_events` table.

## Production Deployment
-   **Target:** `app.mypaylink.app` behind Nginx reverse proxy with SSL termination.
-   **App binds to:** `127.0.0.1:8000` (configurable via `HOST` and `PORT` env vars).
-   **Health endpoints:** `GET /health` (basic) and `GET /ready` (DB connectivity) — registered before session middleware, no auth required.
-   **Startup validation:** Production mode requires `DATABASE_URL` and `SESSION_SECRET` env vars (fails fast if missing). Warns if `APP_BASE_URL` is unset.
-   **Cookie security:** `httpOnly: true`, `secure: true` in production (behind HTTPS proxy), `sameSite: "lax"`.
-   **Error handling:** Production error responses hide stack traces, SQL errors, and internal paths. 5xx returns generic "Internal server error". 4xx passes through error message.
-   **Upload directory:** Configurable via `UPLOAD_DIR` env var (defaults to `./uploads`). Auto-created on startup with write permission check.
-   **Absolute URLs:** All email/SMS link generation uses `getAppBaseUrl()` helper which reads `APP_BASE_URL` env var, falling back to request headers.
-   **Security headers:** HSTS, X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy (production only).
-   **No CORS:** Frontend and backend served on same origin; no CORS middleware needed.
-   **Deployment docs:** See `DEPLOYMENT.md` for full Nginx config, systemd service, deploy checklist, rollback procedure, and troubleshooting guide.

## Public Marketing Website
-   **Location:** `public-site/` directory in the repository.
-   **Domain:** `mypaylink.app` (marketing site). App remains at `app.mypaylink.app`.
-   **Stack:** Static HTML/CSS/JS served by lightweight Express server (no build step needed).
-   **Pages:** Home, Features, Pricing, Security, Contact/Demo, Vendor Portal, Quick Clock In, Terms, Privacy, Signup, Demo.
-   **Design:** Dark premium SaaS aesthetic with teal-to-blue gradient, Inter font, scroll animations.
-   **Deployment:** `cd public-site && npm install && pm2 start ecosystem.config.cjs`. Runs on port 3000 behind Nginx.
-   **VPS path:** `/home/mypaylink/public-site/` (under the `mypaylink` site user).

## External Dependencies
-   **PostgreSQL:** Primary application database.
-   **NGINX:** Reverse proxy for production.
-   **PM2:** Node.js process manager for production.
-   **Nodemailer:** Optional email notifications (requires SMTP configuration).
-   **Twilio:** Optional SMS notifications (requires Twilio account configuration).
-   **OpenAI:** AI-powered receipt scanning via GPT-4o vision (requires OPENAI_API_KEY).