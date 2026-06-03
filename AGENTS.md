# AGENTS.md — PayLink AI Agent / Codex / App Doctor Rules

This is a production payroll, HR, payments, contractor, compliance, and financial document SaaS platform.  
All AI agents, Codex models, Replit agents, GitHub Copilot agents, App Doctor tools, and automated repair systems must follow these rules without exception.

## Core AI Agent Rules

1. Never edit production directly.
2. Never replace, wipe, truncate, or reset production databases.
3. Never commit `.env`, `.venv`, `node_modules`, credentials, database backups, private keys, SSH keys, API keys, or secrets.
4. Reuse existing routes, templates, components, schemas, services, and helpers before creating new ones.
5. Do not create duplicate pages, duplicate routes, duplicate tables, or duplicate components.
6. All new routes must be linked correctly in navigation.
7. All backend routes must have authentication, authorization, and company access checks.
8. All company/tenant data queries must filter by `company_id` unless explicitly global admin.
9. All schema changes must be idempotent, additive, and include a database backup step.
10. All changes must include tests or explain why tests are not possible.
11. No deployment unless tests pass.
12. Pull requests must include affected routes, affected tables, risk list, rollback plan, and tests run.

---

## Absolute Restrictions

AI agents must never:

- Redesign or restructure UI/layout/pages unless explicitly approved.
- Modify login, session, authentication, authorization, or password logic without Global Admin approval.
- Change payroll, tax, withholding, deduction, W-2, 1099, or compliance calculation logic without Global Admin approval.
- Alter check layout, MICR line placement, invoice totals, paystub formats, W-2/1099 layouts, or PDF dimensions without approval.
- Run destructive migrations: no `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, production `DELETE`, table rename, or column rename.
- Push directly to `main`.
- Deploy to production automatically.
- Expose secrets, tokens, API keys, PII, payroll data, banking data, tax data, or private company data in logs/output/code.
- Overwrite signed PDFs, immutable audit logs, check records, legal hold documents, or compliance records.
- Merge payroll, tax, invoice, contractor, or bank records across companies.
- Remove audit history.
- Disable security checks to make tests pass.
- Commit generated dependency folders or local runtime files.

---

## Required Development Practices

- Use additive migrations only:
  - `CREATE TABLE IF NOT EXISTS`
  - `CREATE INDEX IF NOT EXISTS`
  - `ALTER TABLE ADD COLUMN`
- New columns must be nullable or have safe defaults.
- Preserve `company_id` on all financial, payroll, contractor, invoice, expense, check, and document records.
- Use `canAccessCompany()` for company permission checks.
- Never use raw company ID equality as the only access control.
- Use existing helpers before creating new access logic.
- Add `data-testid` attributes to new interactive elements.
- Every fix must include:
  - Summary
  - Root cause
  - Affected files
  - Affected routes
  - Affected tables
  - Test plan
  - Rollback plan
  - Risk level
- All work must happen on a branch and through a PR.

---

## Severity Classification

| Class | Description | Required Approver |
|---|---|---|
| minor | Single-file UI bug, cache issue, label, missing guard | Admin |
| medium | Multi-file workflow, permission logic, document/PDF flow | Admin |
| major | Payroll, tax, auth/session, DB migration, company model, Stripe/payment logic | Global Admin |

---

## Repair Permissions

App Doctor may propose patches for:

- API routing issues
- 403/permission bugs using `canAccessCompany()`
- Missing JSON guards
- Cache invalidation bugs
- Broken endpoints
- Document/PDF flow errors
- Notification workflow bugs
- Webhook processing errors
- UI link/navigation bugs
- Missing `data-testid` attributes

App Doctor may not automatically apply:

- Major changes
- Auth/session changes
- Payroll/tax calculation changes
- Database schema changes
- Multi-company access model changes
- Stripe/payment state changes
- Production deploy configuration changes
- Check layout changes
- Signed document handling changes

---

## Branch Naming

Use:

```text
app-doctor/fix-{ticket-id-8chars}-{short-slug}
codex/fix-{short-slug}
copilot/fix-{short-slug}
feature/{short-slug}
