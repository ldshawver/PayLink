# PayLink

PayLink is a comprehensive HR, Payroll & Time-clock application designed to manage employee and contractor time-tracking, scheduling, payroll, policies, and HR functions for multiple businesses.

## Run & Operate

**Required `ENV` vars:** `DATABASE_URL`, `SESSION_SECRET`, `APP_BASE_URL`, `PORT=8000`, `NODE_ENV=production`.
`dotenv_config_path=/etc/paylink/.env` must be used for PM2.

```bash
# Install dependencies
npm install

# Build the application
npm run build

# Run in development
npm run dev

# Typecheck
npm run typecheck

# Generate Drizzle migrations
npm run generate

# Push DB schema changes
npm run db:push
```

## Stack

**Frontend:** React, TypeScript, Tailwind CSS, shadcn/ui, Wouter, TanStack Query, Vite.
**Backend:** Express.js, TypeScript.
**Database:** PostgreSQL (Drizzle ORM).
**Auth:** `express-session`, `connect-pg-simple`, `bcrypt`.
**Runtime:** Node.js.
**Build Tool:** Vite.
**Mobile:** Capacitor.

## Where things live

-   **Frontend Source:** `client/src/`
-   **Backend Source:** `server/`
-   **Database Schema:** `server/db/schema.ts`
-   **Drizzle Migrations:** `server/db/migrations/`
-   **API Routes:** `server/routes.ts`
-   **RBAC Definitions:** `client/src/lib/roles.ts`
-   **Notification Templates:** `notification_templates` table in DB.
-   **Mobile App Config:** `capacitor.config.ts`
-   **Disaster Recovery Runbook:** `DISASTER_RECOVERY.md`

## Architecture decisions

-   **Multi-Company Scheduling:** A worker's `companyId` is their home/payroll company, but they can be scheduled at any company. The schedule's `companyId` determines the effective company for all downstream records (punches, time entries, payroll).
-   **Timezone Handling:** `server/db.ts` forces `SET timezone = 'UTC'` for all PostgreSQL connections to ensure consistent UTC storage and retrieval of `TIMESTAMP` columns.
-   **Role-Based Access Control (RBAC):** Implemented with a 3-layer hierarchy (Platform, Tenant, Worker) and scope-based permission columns (`can_view_own`, `can_edit_company`, etc.) in the `role_permissions` table.
-   **Feature Registry & Activation System:** Platform-level feature flags are managed per tenant via `feature_registry`, `feature_overrides`, and `feature_activation_log` DB tables, enabling granular control over feature rollout.
-   **Tax Engine Design:** `server/tax-engine.ts` is a pure, deterministic module for tax calculation, ensuring consistency and testability by avoiding direct DB calls during computation.

## Product

-   Time & Attendance tracking with cross-company scheduling.
-   Employee and Contractor Management.
-   Multi-step Payroll Processing with tax form generation and ACH direct deposit.
-   Policy & HR Management.
-   Reporting with CSV export.
-   Expense Management with AI receipt scanning.
-   TOTP MFA and comprehensive SOC 2 + GDPR compliance features (PII export/anonymization, audit logs, breach response).
-   Mobile app with native features (push notifications, biometrics, camera).
-   SaaS Trial & Billing, Customer & Employee Onboarding.
-   Document Management with versioning and e-signatures.
-   Contract Lifecycle Management from proposals to payment.
-   Platform Audit Readiness tab for comprehensive system health checks.
-   Native Feedback & Bug Reporting (floating button across the authenticated app, admin dashboard at `/app/feedback-admin` with filters, statuses, internal notes, assignment, Priority Fix flag, and in-app + email notifications on submit and status change).

## User preferences

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
9. Marketing site is served by nginx from web root /home/mypaylink/htdocs/mypaylink.appsite/ (NOT mypaylink.app). CloudPanel configured nginx with `try_files $uri $uri/ /index.html` — nginx serves ALL marketing traffic directly from this static web root. Port 3000 (PM2 process "paylink-site") is NOT used by nginx as a fallback; it runs but is bypassed by the static-root config. CRITICAL: paylinkssh DOES NOT have write permission to the web root — rsync and sudo rsync both fail silently. Automated deploys cannot update the marketing site web root until VPS permissions are fixed. To fix permanently, SSH into VPS as root and run: `sudo usermod -aG mypaylink paylinkssh && sudo chmod -R g+w /home/mypaylink/htdocs/mypaylink.appsite && sudo find /home/mypaylink/htdocs/mypaylink.appsite -type d -exec chmod g+s {} \; && rsync -av /home/paylinkssh/paylink-app/PayLink/public-site/public/ /home/mypaylink/htdocs/mypaylink.appsite/`. Alternative: update nginx location / to proxy_pass http://127.0.0.1:3000 (no web root sync needed ever again).
10. Do not change production ports unless explicitly instructed. PayLink app runs behind reverse proxy on 127.0.0.1:8000.
11. deploy.yml MUST use APP_PORT="8000", ENV_FILE="/etc/paylink/.env", and WEB_ROOT="/home/mypaylink/htdocs/mypaylink.appsite". The rsync step copies public-site/public/ to WEB_ROOT (NOT dist/public/ which would overwrite marketing files). Due to permission issue #9, rsync currently fails on every deploy — VPS fix required first.

Schema Change Rules (CRITICAL - NEVER VIOLATE):
1. NEVER drop existing tables - only add new tables.
2. NEVER remove columns from existing tables - only add new columns with ALTER TABLE ADD COLUMN IF NOT EXISTS.
3. NEVER rename tables or columns - this breaks existing data and foreign keys.
4. NEVER change column types on existing columns.
5. When adding features, ADD columns/tables alongside existing ones - never replace.
6. All new columns MUST have defaults or be nullable so existing rows are not affected.
7. Test all schema changes on Replit dev database BEFORE deploying to VPS.
8. The VPS database contains REAL production data - treat it as sacred.

## Gotchas

-   `paylinkssh` user on the VPS does not have write permissions to the marketing site web root, causing `rsync` failures during deployment for the static marketing site.
-   Tenant-scoped users (`companyId != null`) must never access `/platform/*` routes.
-   Platform-scoped users must never have a `companyId` assigned.
-   `admin` role in legacy context refers to `tenant_admin`, not a platform role.
-   Capacitor WebView requires `sameSite: "none"` for session cookies due to cross-origin nature.

## Pointers

-   **PostgreSQL Documentation:** [https://www.postgresql.org/docs/](https://www.postgresql.org/docs/)
-   **Express.js Documentation:** [https://expressjs.com/](https://expressjs.com/)
-   **React Documentation:** [https://react.dev/](https://react.dev/)
-   **Drizzle ORM Documentation:** [https://orm.drizzle.team/](https://orm.drizzle.team/)
-   **Capacitor Documentation:** [https://capacitorjs.com/docs/](https://capacitorjs.com/docs/)
-   **Tailwind CSS Documentation:** [https://tailwindcss.com/docs](https://tailwindcss.com/docs)
-   **Node.js Crypto Module (for TOTP):** [https://nodejs.org/api/crypto.html](https://nodejs.org/api/crypto.html)
-   **IRS Publication 15-T (for tax calculations):** _Populate as you build_
-   **GDPR Official Text:** [https://gdpr-info.eu/](https://gdpr-info.eu/)