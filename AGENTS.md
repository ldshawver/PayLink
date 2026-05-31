# AGENTS.md — Codex / App Doctor Rules

This is a **production payroll/HR/compliance SaaS** (PayLink). All automated agents,
AI code-repair tools, and Codex models must follow these rules without exception.

---

## Absolute Restrictions (NEVER do these)

- **Do not redesign or restructure UI/layout/pages.** Only targeted, minimal changes.
- **Do not modify login, session, or authentication logic** without explicit global admin approval.
- **Do not change payroll or tax calculation logic** (server/tax-engine.ts or related) without explicit global admin approval.
- **Do not alter check layout, invoice totals, paystub formats, or W-2/1099 structures** without approval.
- **Do not run destructive database migrations** — no DROP TABLE, DROP COLUMN, TRUNCATE, or DELETE on production data.
- **Do not rename tables or columns** — this breaks existing data and foreign keys.
- **Do not push directly to main.** All fixes go through a branch + PR.
- **Do not deploy to production automatically.** Human review and deploy is required.
- **Do not expose secrets, API keys, tokens, or PII** in logs, output, or code.
- **Do not overwrite or alter signed PDFs, immutable audit logs, or legal hold documents.**
- **Do not merge company payroll or tax records across companies** — financial separation is mandatory.

---

## Required Practices

- Use **additive migrations only**: ALTER TABLE ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS.
- All new columns must have defaults or be nullable so existing rows are unaffected.
- Preserve `company_id` on ALL financial records. Never strip or change company assignment.
- Follow the canAccessCompany() helper for cross-company permission checks. Do not use raw `===` equality on companyId.
- For every fix, provide: summary, root cause, affected files, proposed patch, test plan, rollback plan, risk level.
- Add `data-testid` attributes to any new interactive elements.
- Open PRs — never push directly to main.
- Label PRs: `app-doctor`, `bugfix`, `needs-review`, `severity-minor/medium/major`.

---

## Severity Classification

| Class  | Description                                             | Required Approver   |
|--------|---------------------------------------------------------|---------------------|
| minor  | Single-file bug fix, cache fix, missing guard, label    | Admin               |
| medium | Multi-file workflow, permission logic, PDF/doc flow     | Admin               |
| major  | Payroll/tax, auth/session, DB migrations, company model | Global Admin        |

---

## Repair Restrictions

App Doctor **may** propose patches for:
- API routing issues
- 403/permission bugs (using canAccessCompany helper)
- Missing JSON guards
- Cache invalidation bugs
- Broken endpoints
- Document/PDF flow errors
- Notification workflow bugs
- Webhook processing errors

App Doctor **may NOT** automatically apply:
- Any change classified as major
- Auth or session changes
- Payroll or tax calculation changes
- Database schema changes
- Multi-company access model changes
- Production deploy configuration

---

## Branch Naming

```
app-doctor/fix-{ticket-id-8chars}-{short-slug}
```

Example: `app-doctor/fix-a1b2c3d4-proposal-403-fix`

---

## Stack Reference

- **Frontend:** React, TypeScript, Tailwind CSS, shadcn/ui, Wouter, TanStack Query, Vite
- **Backend:** Express.js, TypeScript
- **Database:** PostgreSQL (Drizzle ORM) — schema in `shared/schema.ts`, migrations in `server/index.ts`
- **Auth:** express-session + connect-pg-simple + bcrypt
- **Company Access:** `canAccessCompany()` in `server/routes.ts` — use this, never raw companyId equality
- **Upload Dir:** Always use `resolvedUploadDir` (respects UPLOAD_DIR env var), never hardcode `process.cwd()/uploads`
- **Timezone:** All DB timestamps stored in UTC (forced in `server/db.ts`)
