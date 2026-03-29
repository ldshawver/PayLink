# PayLink - HR, Payroll & Time-clock Software

## Overview
PayLink is a full-stack HR, Payroll & Time-clock application designed to manage employee and contractor time-tracking, scheduling, payroll, policies, and HR functions for multiple businesses. It aims to streamline human resources and payroll operations with a robust feature set, including detailed employee management, advanced payroll processing, and extensive HR functionalities, all within a scalable architecture. The business vision is to provide a comprehensive solution for HR and payroll challenges, enabling businesses to manage their workforce efficiently.

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

VPS Deploy Architecture:
- App repo: /home/paylinkssh/paylink-app/PayLink
- App SSH user: paylinkssh
- App domain: app.mypaylink.app (reverse proxy to 127.0.0.1:8000)
- App site root: /home/mypaylink-app/htdocs/app.mypaylink.app
- Env file: /etc/paylink/.env (outside git, owned by paylinkssh, chmod 600)
- Marketing domain: mypaylink.app (port 3000)
- Marketing site root: /home/mypaylink/htdocs/mypaylink.appsite
- Marketing site user: mypaylink
- Marketing SSH user: mypaylinks
- GitHub secrets needed: VPS_HOST, VPS_USER, VPS_SSH_KEY, WEBSITE_SSH_USER, WEBSITE_SSH_KEY

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
PayLink is built with a React frontend, an Express.js backend, and a PostgreSQL database, utilizing a microservices-inspired approach for distinct functionalities.

**Frontend:**
-   **Technology Stack:** React + TypeScript, Tailwind CSS, shadcn/ui for components, Wouter for routing, TanStack Query for data fetching.
-   **UI/UX Design:** Features a sidebar with collapsible navigation and a consistent teal-to-blue gradient color theme (primary HSL(180, 55%, 42%)).

**Backend:**
-   **Framework:** Express.js + TypeScript.
-   **Authentication:** Session-based using `express-session` and `connect-pg-simple` with `bcrypt` for password hashing. API routes are protected, with exceptions for authentication and time clock functions.
-   **Authorization (RBAC):** Role-based access control is implemented at both frontend and backend levels, managing navigation visibility and protecting API write operations based on user roles (admin, manager, employee).
-   **API Design:** RESTful API endpoints for comprehensive management of companies, workers, time, payroll, and HR. Specialized endpoints exist for payroll summaries and time clock punches.
-   **Key Features:**
    -   **Time & Attendance:** Time tracking, accrual management, scheduling with shift marketplace, station-enforced clock in/out, and overtime calculations.
    -   **Employee Management:** CRUD operations for employees, contacts, wages, pay methods, and documents, including employee self-service.
    -   **Company Management:** Management of company structure, legal entities, and universal entities (Branches, Departments, Jobs, Positions, Stations, Employee Titles) with CSV import.
    -   **Payroll Processing:** Multi-step tax wizard, generation of tax forms, pay stub management, complex tax and deduction rules, NACHA ACH direct deposit generation.
    -   **Policy Management:** Extensive HR and payroll policy engine.
    -   **HR Functions:** CRUD for reviews, qualifications, skills, education, languages, memberships, and licenses.
    -   **Reporting:** Various reports (Employee, Timesheet, Payroll, Tax, Expense, Job Cost) with CSV export and saved reports functionality.
    -   **Expense Management:** CRUD for expense receipts, photo uploads, approval workflows, check printing, and AI-powered receipt scanning for data extraction.
    -   **User Account Management:** Admin management of user accounts, role assignments, and worker linkages. Supports PIN, username/password, and kiosk login modes.
    -   **Schedule Publishing & Time-Off:** Managers publish schedules with email/SMS notifications; time-off requests with approval workflows and notifications.
    -   **Payroll Audit:** Scans for missing data, classification mismatches, and other payroll inconsistencies.
    -   **Worker Groups:** Seven distinct worker groups (e.g., hourly employee, salaried employee, contractor, volunteer) influencing payroll processing.
    -   **Shift Marketplace:** Allows employees to post and pick up shifts with manager approval and eligibility checks.
    -   **SaaS Trial & Billing System:** Manages trial periods, subscription statuses, and soft lockouts for expired trials.
    -   **Interactive Demo Mode:** Provides a public-facing demo environment with pre-seeded data.
    -   **Onboarding Checklist:** Guides new trial accounts through initial setup steps.
    -   **Analytics Tracking:** Event tracking for signup, trial, and key user actions.
    -   **Customer & Vendor Management:** Full CRUD for customers and vendors, including a public vendor portal for invoice submission. Customer detail view with Info and Onboarding tabs.
    -   **Customer Onboarding Hub:** Frontend pages for managing deals (Kanban pipeline), onboarding projects (list + detail with task checklists and engagement timelines), onboarding templates (with nested task editor, training resources, document links), and engagement feed (chronological event stream). Sidebar section "Onboarding Hub" with sub-items. Pages at: /deal-pipeline, /onboarding-projects, /onboarding-templates, /engagement-feed. Types defined in client/src/lib/onboarding-types.ts. Backend APIs pending.
    -   **Invoicing System:** Create, edit, and manage invoices with line items, statuses, and payment tracking. Multiple payment methods (ACH, Card, Instant Bank, Wire) with configurable per-method fees, fee disclosure at checkout, savings nudges, and a Payment Methods settings tab. API: `GET/POST/PATCH/DELETE /api/payment-method-configs`, `POST /api/payments/calculate-fee`.
    -   **Document Management:** Handles folders, documents, versioning, signature requests, and audit logs.
    -   **Automation Engine:** Rules-based automation with event logging.
    -   **Notifications System:** Company/user-scoped notification tracking.
    -   **Customer Onboarding Hub:** Deal pipeline (Lead → Qualified → Proposal → Negotiation → Closed Won → Closed Lost) with automatic onboarding project creation on "Closed Won". Product-specific onboarding templates with task checklists. Onboarding task tracking with progress percentage. Engagement events for customer activity (internal + webhook). Public webhook endpoint (`POST /api/webhooks/product-events`) authenticated via product API keys. Tables: `deals`, `onboarding_templates`, `onboarding_template_tasks`, `customer_onboarding_projects`, `onboarding_tasks`, `onboarding_documents`, `engagement_events`, `product_api_keys`.

**Database:**
-   **Type:** PostgreSQL, managed with Drizzle ORM.
-   **Schema Design:** Supports an enterprise hierarchy (enterprises, companies, divisions, positions, cost centers, jobs), core operational data (workers, time punches, schedules, payroll runs), and extended functionalities (accruals, policies, HR records). Granular role-based access control is implemented via dedicated tables. Universal entities can be assigned globally or to specific companies.

**Production Deployment:**
-   **Environment:** Deployed to `app.mypaylink.app` behind an Nginx reverse proxy with SSL termination.
-   **Security:** Enforces secure cookie settings, hides sensitive error details, and utilizes security headers.
-   **Public Marketing Website:** A separate static HTML/CSS/JS site (`mypaylink.app`) is hosted at `/public-site/` for marketing purposes, running on PM2.

## External Dependencies
-   **PostgreSQL:** Primary database for all application data.
-   **NGINX:** Used as a reverse proxy for production deployments.
-   **PM2:** Node.js process manager for keeping the application and public site running in production.
-   **Nodemailer:** For optional email notifications.
-   **Twilio:** For optional SMS notifications.
-   **OpenAI:** Utilized for AI-powered receipt scanning via GPT-4o vision.