# PayLink - HR, Payroll & Time-clock Software

## Overview
PayLink is a comprehensive full-stack HR, Payroll & Time-clock application designed to manage employee and contractor time-tracking, scheduling, payroll, policies, and HR functions for multiple businesses. Its core purpose is to streamline human resources and payroll operations, providing a robust solution for efficient workforce management within a scalable architecture. The project aims to address common HR and payroll challenges, empowering businesses with advanced tools for employee management, payroll processing, and extensive HR functionalities.

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

Production VPS Safety Rules (CRITICAL - NEVER VIOLATE):
1. NEVER overwrite, recreate, or reset the VPS .env file. Production source of truth: /etc/paylink/.env (outside the git repo).
2. NEVER assume MySQL/MariaDB. PayLink production uses PostgreSQL only.
3. Required production env vars: DATABASE_URL, SESSION_SECRET, APP_BASE_URL, PORT=8000, NODE_ENV=production.
4. Always start PM2 with explicit dotenv path: dotenv_config_path=/etc/paylink/.env
5. Do not use shell-string PM2 startup if direct node startup can be used.
6. Do not add destructive startup resets, schema drops, or automatic database recreation.
7. Before restarting production, validate: .env file exists, DATABASE_URL exists, SESSION_SECRET exists, APP_BASE_URL exists.
8. Keep deploy backup logic aligned to PostgreSQL. Use pg_dump, not mysqldump.
9. Marketing site is static and does not need its own database connection variable. It talks to the app API.
10. Do not change production ports unless explicitly instructed. PayLink app runs behind reverse proxy on 127.0.0.1:8000.

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
PayLink is built with a React frontend, an Express.js backend, and a PostgreSQL database, following a microservices-inspired approach.

**Frontend:**
-   **Technology Stack:** React + TypeScript, Tailwind CSS, shadcn/ui for components, Wouter for routing, TanStack Query for data fetching.
-   **UI/UX Design:** Features a sidebar with collapsible navigation and a consistent teal-to-blue gradient color theme (primary HSL(180, 55%, 42%)). Responsive components ensure adaptability across devices.
-   **PWA Configuration:** Utilizes `vite-plugin-pwa` for service worker and manifest generation, offering offline capabilities and installability.

**Backend:**
-   **Framework:** Express.js + TypeScript.
-   **Authentication:** Session-based using `express-session` and `connect-pg-simple` with `bcrypt`.
-   **Authorization (RBAC):** Role-based access control (admin, manager, employee) at both frontend and backend for navigation visibility and API protection.
-   **API Design:** RESTful API endpoints for managing companies, workers, time, payroll, and HR functions. Includes specialized endpoints for payroll summaries and time clock punches.
-   **Key Features:**
    -   **Time & Attendance:** Time tracking, accrual management, scheduling, shift marketplace, and overtime calculations.
    -   **Employee Management:** CRUD for employees, contacts, wages, pay methods, and documents, including self-service.
    -   **Company Management:** Management of company structure, legal entities, and universal entities.
    -   **Payroll Processing:** Multi-step tax wizard, tax form generation, pay stub management, complex tax/deduction rules, NACHA ACH direct deposit.
    -   **Policy & HR Management:** Extensive HR and payroll policy engine, CRUD for reviews, qualifications, skills, education, languages, memberships, and licenses.
    -   **Reporting:** Various reports (Employee, Timesheet, Payroll, Tax, Expense, Job Cost) with CSV export.
    -   **Expense Management:** CRUD for expense receipts, photo uploads, approval workflows, check printing, and AI-powered receipt scanning.
    -   **User Account Management:** Admin management of user accounts, roles, and worker linkages. Supports PIN, username/password, and kiosk login.
    -   **Schedule Publishing & Time-Off:** Managers publish schedules with notifications; time-off requests with approval workflows.
    -   **Payroll Audit:** Scans for missing data and inconsistencies.
    -   **Worker Groups:** Seven distinct worker groups influencing payroll.
    -   **Shift Marketplace:** Allows employees to post/pick up shifts with approval.
    -   **SaaS Trial & Billing System:** Manages trial periods and subscription statuses.
    -   **Interactive Demo Mode:** Public-facing demo with pre-seeded data, tenant provisioning, and 24-hour expiration.
    -   **Onboarding:** Customer Onboarding Hub with deal pipeline, project management, templates, and engagement feed. Employee Onboarding Workflows with template-driven packets and external portal access for workers.
    -   **Invoicing System:** Create, edit, and manage invoices with line items, statuses, and payment tracking. Supports multiple payment methods with configurable fees.
    -   **Document Management:** Handles folders, documents, versioning, signature requests, and audit logs. Includes tamper-evident versioning, legal hold, compliance retention, and e-signature provider integration.
    -   **Integration Event Bus:** Outbound webhook system for events like document creation/updates and signature requests, with HMAC-signed events and audit logging.
    -   **Automation Engine:** Rules-based automation with event logging.
    -   **Notifications System:** Company/user-scoped notification tracking.

**Database:**
-   **Type:** PostgreSQL, managed with Drizzle ORM.
-   **Schema Design:** Supports an enterprise hierarchy, core operational data, and extended functionalities with granular role-based access control.

**Production Deployment:**
-   **Environment:** Deployed to `app.mypaylink.app` behind an Nginx reverse proxy with SSL termination.
-   **Security:** Enforces secure cookie settings, hides sensitive error details, and uses security headers.
-   **Public Marketing Website:** A separate static site (`mypaylink.app`) is hosted for marketing.

## Mobile App (Capacitor)
PayLink includes Capacitor configuration for building native Android and iOS apps from the web codebase.

-   **Config:** `capacitor.config.ts` — app ID `app.mypaylink.paylink`, web assets from `dist/public/`
-   **Plugins installed:** push-notifications, camera, filesystem, haptics, keyboard, status-bar, app, share, browser, capacitor-native-biometric
-   **CORS:** Express middleware in `server/index.ts` accepts Capacitor WebView origins (`capacitor://localhost` for iOS, `http://localhost` for Android) with credentials
-   **Session cookies:** `sameSite: "none"` in production so cross-origin cookies work in the WebView
-   **API base URL:** `client/src/lib/queryClient.ts` detects native platform via `Capacitor.isNativePlatform()` and prepends the production API URL to all fetch calls
-   **Asset directories:** `resources/android/` and `resources/ios/` with icon and splash subdirectories; see `resources/ASSET_GENERATION.md`
-   **Build guide:** `MOBILE_BUILD_GUIDE.md` — complete step-by-step instructions for local Android/iOS builds

## External Dependencies
-   **PostgreSQL:** Primary application database.
-   **NGINX:** Reverse proxy for production deployments.
-   **PM2:** Node.js process manager for production.
-   **Nodemailer:** For email notifications.
-   **Twilio:** For SMS notifications.
-   **OpenAI:** Utilized for AI-powered receipt scanning via GPT-4o vision.
-   **Capacitor:** Cross-platform native runtime for wrapping the web app as Android/iOS apps.
