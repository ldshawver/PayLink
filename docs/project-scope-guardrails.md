# MyPayLink — Project Scope Guardrails

## What MyPayLink IS

MyPayLink is a **Payroll, HR, Workforce Management, Timeclock, Contractor Management, Onboarding, Compliance, Expenses/AP, Finance Reporting, Check Printing, and Document Management SaaS** platform powered by AI.

## What MyPayLink is NOT

- MyPayLink is **NOT** LUXit.app
- MyPayLink is **NOT** a CRM-first product
- MyPayLink is **NOT** a sales/marketing pipeline tool
- MyPayLink is **NOT** a marketing automation platform
- MyPayLink is **NOT** a customer messaging or campaign management tool

## Core Modules (Approved)

| Module | Description |
|--------|-------------|
| Time & Attendance | Kiosk timeclock, GPS punch validation, cross-company scheduling |
| Employee Management | HR profiles, onboarding workflows, document management |
| Payroll Processing | Multi-step payroll runs, federal/state taxes, ACH, tax forms |
| Contractor Hub | Contractor lifecycle, proposals, contracts, payments |
| Scheduling | Drag-and-drop shift scheduling across locations |
| Expenses & AP | AI receipt scanning, expense approvals, invoicing |
| Policies & Documents | Policy library, e-signatures, versioned storage |
| Reports & KPIs | Labour cost analysis, payroll audits, CSV exports |
| Compliance & Security | SOC 2 audit logs, GDPR PII, TOTP MFA |
| Check Printing | Payroll and expense check PDF generation |
| Platform Console | Tenant provisioning, billing, feature flags (internal only) |

## Approved Route Behavior

| Path | Purpose |
|------|---------|
| `/` | MyPayLink public marketing site — payroll/HR/workforce SaaS |
| `/login` | Login page |
| `/clock-in` | Employee timeclock kiosk |
| `/app/*` | Authenticated payroll/workforce dashboard |
| `/platform/*` | Internal platform console (platform roles only) |

## Forbidden Cross-Project Contamination

**NEVER apply instructions, features, routes, or UI from these other projects to MyPayLink:**

- LUXit.app (CRM/sales/marketing platform)
- MyOrder (ordering/commerce platform)
- Any other Lucifer Cruz / Adiken marketing or commerce projects

**Unless the user explicitly requests a feature from another project, do not bring it in.**

## Forbidden UI/Language in MyPayLink

Do NOT add any of the following to MyPayLink unless explicitly requested:

- "Leads" (CRM)
- "Campaigns" (marketing)
- "CRM Pipeline" or "Deal Pipeline" (sales CRM)
- "Marketing Automation" (marketing)
- "Customer Messaging" / "Campaign Billing" (marketing)
- "Sales Dashboard" / "Marketing Dashboard" (CRM)
- "Open Deals" / "Pipeline Value" / "Won Revenue" (sales CRM)
- "Sales & Deals" navigation group (CRM)
- LUXit-specific workflows, terminology, or branding

## Navigation Priority Order (Correct)

The app sidebar for authenticated users must prioritize:

1. **Dashboard** — Payroll/HR/workforce dashlets
2. **Workers** — Employees, contractors, scheduling
3. **Time & Attendance** — Timeclock, punches, exceptions
4. **Payroll** — Payroll runs, check printing, tax forms
5. **Contractor Hub** — Contractor lifecycle management
6. **Expenses** — Expense reports, AP workflows
7. **HR** — Policies, documents, compliance
8. **Reports** — Analytics, KPI tracking, exports
9. **Billing** — Customers, invoices, recurring billing
10. **Settings** — Company and account configuration

## Definition of Done (Scope Check)

Before shipping any feature, verify:

- [ ] Dashboard shows payroll/HR/workforce content, not CRM views
- [ ] Navigation does not contain sales/CRM/marketing-specific groups
- [ ] No routes point to CRM/deal pipeline pages
- [ ] Public marketing site describes MyPayLink as payroll/HR/workforce SaaS
- [ ] Payroll, timeclock, and contractor workflows remain intact
- [ ] No blank white pages from removed CRM routes
