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
9. Marketing site static files are served by nginx from /home/mypaylink/htdocs/mypaylink.appsite/ (NOT mypaylink.app). Marketing site Node.js server runs on port 3000 as PM2 process "paylink-site" and also serves as a fallback.
10. Do not change production ports unless explicitly instructed. PayLink app runs behind reverse proxy on 127.0.0.1:8000.
11. deploy.yml MUST use APP_PORT="8000", ENV_FILE="/etc/paylink/.env", and WEB_ROOT="/home/mypaylink/htdocs/mypaylink.appsite". The rsync step copies public-site/public/ to WEB_ROOT (NOT dist/public/ which would overwrite marketing files).

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
-   **Technology Stack:** React + TypeScript, Tailwind CSS, shadcn/ui, Wouter, TanStack Query.
-   **UI/UX Design:** Sidebar navigation, teal-to-blue gradient theme (primary HSL(180, 55%, 42%)), responsive design.
-   **PWA Configuration:** Utilizes `vite-plugin-pwa` for offline capabilities and installability.

**Backend:**
-   **Framework:** Express.js + TypeScript.
-   **Authentication:** Session-based with `express-session`, `connect-pg-simple`, and `bcrypt`.
-   **Authorization (RBAC):** Role-based access control (admin, manager, employee) for frontend and API protection.
-   **API Design:** RESTful API for managing companies, workers, time, payroll, and HR functions, including payroll summaries and time clock punches.
-   **Key Features:** Time & Attendance, Employee Management, Company Management, Payroll Processing (multi-step wizard, tax form generation, ACH direct deposit), Policy & HR Management, Reporting (with CSV export), Expense Management (photo uploads, approval, AI receipt scanning), User Account Management (PIN, username/password, kiosk login), Schedule Publishing & Time-Off, Payroll Audit, Worker Groups, Shift Marketplace, SaaS Trial & Billing, Interactive Demo Mode, Onboarding (Customer & Employee), Invoicing System, Document Management (versioning, e-signatures, audit logs), Integration Event Bus (webhooks), Automation Engine, Notifications System (admin-editable email + SMS templates via `notification_templates` table), System Documents, Contractor Onboarding + Agreement System, Trade / Non-Cash Compensation, Unified Invoices & Proposals Module (biz-docs: business creates customer invoices/proposals; Contractor Hub: contractors send proposals to companies, companies accept/reject/pay).

**Database:**
-   **Type:** PostgreSQL, managed with Drizzle ORM.
-   **Schema Design:** Supports enterprise hierarchy, core operational data, and granular role-based access control.

**Production Deployment:**
-   **Environment:** Consolidated under `mypaylink.app`. Nginx reverse-proxies app paths to Node.js (port 8000); other paths to marketing site (port 3000). Legacy `app.mypaylink.app` redirects to `mypaylink.app/app`.
-   **URL Structure:** `/login`, `/clock-in` (public); authenticated pages under `/app/*`.
-   **Security:** Secure cookie settings, hidden error details, security headers.
-   **Logout:** Redirects to `https://mypaylink.app`.

**Mobile App (Capacitor):**
-   **Configuration:** `capacitor.config.ts`, app ID `app.mypaylink.paylink`, web assets from `dist/public/`.
-   **Plugins:** Push-notifications, camera, filesystem, haptics, keyboard, status-bar, app, share, browser, capacitor-native-biometric.
-   **CORS:** Express middleware configured for Capacitor WebView origins.
-   **Session cookies:** `sameSite: "none"` for cross-origin WebView compatibility.
-   **API base URL:** Detects native platform to prepend production API URL.
-   **Native Feature Hooks:** Push notifications, biometric authentication, native camera/photo library, status bar/keyboard management, haptic feedback.
-   **Native Backend Endpoints:** Device token management, notification preferences, biometric restore tokens.
-   **Native UI Pages:** Notification settings, biometric toggle in profile.
-   **NativeFileUpload component:** Replaces file inputs for native camera/photo library integration.

## External Dependencies
-   **PostgreSQL:** Primary application database.
-   **NGINX:** Reverse proxy for production deployments.
-   **PM2:** Node.js process manager for production.
-   **Nodemailer:** For email notifications.
-   **Twilio:** For SMS notifications.
-   **OpenAI:** Utilized for AI-powered receipt scanning via GPT-4o vision.
-   **Capacitor:** Cross-platform native runtime for Android and iOS apps.