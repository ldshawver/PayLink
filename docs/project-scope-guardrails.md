# MyPayLink — Project Scope Guardrails

## What MyPayLink IS

MyPayLink is a **Payroll, HR, Workforce Management, Timeclock, Contractor Management, Onboarding, Compliance, Expenses/AP, Finance Reporting, Check Printing, and Document Management SaaS** platform powered by AI.

Its core modules are:

| Module | Description |
|--------|-------------|
| Time & Attendance | Kiosk timeclock, GPS punch validation, cross-company scheduling |
| Employee Management | HR profiles, onboarding workflows, document management |
| Payroll Processing | Multi-step payroll runs, federal/state taxes, ACH direct deposit, tax forms |
| Contractor Hub | Contractor lifecycle, proposals, contracts, invoicing, portal, branding |
| Scheduling | Drag-and-drop shift scheduling across locations, shift marketplace, labor rules |
| Expenses & AP | AI receipt scanning, expense approvals, check printing |
| Policies & Documents | Policy library, e-signatures, DAM versioning, retention policies, legal hold |
| Reports & KPIs | Labor cost analysis, payroll audits, KPI tracking, CSV exports |
| Compliance & Security | SOC 2-ready audit logs, GDPR PII export/anonymization, TOTP MFA, breach response |
| Check Printing | Payroll and expense check PDF generation with calibration |
| Platform Admin | Tenant provisioning, billing, feature flags, license requests, app doctor |

## What MyPayLink is NOT

- **NOT LUXit** — LUXit is a separate product. Do not apply LUXit branding, copy, navigation, features, or product assumptions to MyPayLink.
- **NOT a CRM-first product** — MyPayLink does not have a customer leads pipeline, sales funnel, or marketing automation layer for tenant admins.
- **NOT MyOrder** — separate product entirely.
- **NOT a marketing/sales dashboard** for Adiken or Lucifer Cruz marketing projects.

## Forbidden Cross-Project Contamination

**NEVER apply instructions, features, routes, or UI from these other projects to MyPayLink unless the user explicitly requests it and confirms it belongs in this product:**

- LUXit.app (CRM/sales/marketing platform)
- MyOrder (ordering/commerce platform)
- Any other Lucifer Cruz / Adiken marketing or commerce projects

Do NOT add any of the following to MyPayLink unless explicitly requested:

- CRM deal pipeline (lead → qualified → proposal → negotiation → closed_won/lost)
- "Leads" (CRM), "Campaigns" (marketing), "Marketing Automation"
- Campaign management or broadcast customer messaging tools
- Sales dashboard replacing the payroll/workforce dashboard
- "Open Deals" / "Pipeline Value" / "Won Revenue" (sales CRM)
- "Sales & Deals" navigation group (CRM)
- LUXit-specific workflows, branding, or navigation patterns
- Adiken marketing site copy applied to authenticated app screens

## Correct Route Behavior

| Route | Should serve |
|---|---|
| `/` | MyPayLink marketing site (payroll/HR/workforce SaaS positioning) |
| `/login` | Login page |
| `/clock-in` | Employee timeclock (kiosk) |
| `/app/*` | Authenticated payroll/workforce dashboard |
| `/platform/*` | Platform-owner admin console (tenant management, billing, licensing) |
| `/contractor-hub` | Contractor proposal/contract/invoice hub |
| `/proposal/:id` | Public client proposal portal |

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

## Approved Product Positioning

> "MyPayLink — Modern Payroll, HR, Workforce, Contractor, Compliance, Finance, and Check Printing SaaS powered by AI."

The public marketing homepage (`/`) describes MyPayLink as payroll, HR, finance, and workforce infrastructure. It does NOT present the app as a CRM, sales tool, or lead management system.

## Definition of Done (Scope Check)

Before shipping any feature, verify:

- [ ] Dashboard shows payroll/HR/workforce content, not CRM views
- [ ] Navigation does not contain sales/CRM/marketing-specific groups
- [ ] No routes point to CRM/deal pipeline pages
- [ ] Public marketing site describes MyPayLink as payroll/HR/workforce SaaS
- [ ] Payroll, timeclock, and contractor workflows remain intact
- [ ] No blank white pages from removed CRM routes

## Rule

> Do not apply instructions from LUXit, MyOrder, Lucifer Cruz, or Adiken marketing projects to MyPayLink unless the user explicitly requests it and confirms the feature belongs in this product.
