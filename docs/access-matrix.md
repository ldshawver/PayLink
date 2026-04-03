# Enterprise Access Matrix — Role × Permission Reference

**Version:** 1.0  
**Date:** 2026-04-03  
**Status:** Source of Truth for Task 2 (Authorization Enforcement)

---

## Overview

This document defines the complete role-permission mapping for the enterprise platform. It is the authoritative reference for Task 2 (authorization enforcement), and all middleware, UI guards, and API checks must derive their rules from this matrix.

### Hierarchy Model

```
Enterprise
  └─ Company (Tenant)
       ├─ Legal Entity
       │    └─ Location
       │         ├─ Department
       │         │    ├─ Team
       │         │    └─ Position
       │         └─ Employee (Worker)
       │              └─ EmployeeManagerRelation (primary / secondary)
       └─ [Shared] Roles / Permissions / User Access
```

---

## Scope Levels (permission_scope enum)

| Scope | Description |
|---|---|
| `self` | Only the requesting user's own records |
| `direct_reports` | Records belonging to the user's direct reports |
| `department` | All records within the user's assigned department |
| `location` | All records within the user's assigned location |
| `legal_entity` | All records within the same legal entity |
| `entire_tenant` | All records within the entire company/enterprise tenant |

---

## 12 System Roles

| # | Role Name | Level | Description | Scope |
|---|---|---|---|---|
| 1 | Platform Super Admin | 0 | Unrestricted access to entire platform across all tenants | Cross-tenant |
| 2 | Platform Operations | 0 | Operational access for platform team: provisioning, support, monitoring | Cross-tenant |
| 3 | Enterprise Admin | 1 | Full access within their enterprise across all companies | entire_tenant |
| 4 | Enterprise HR Director | 1 | HR oversight across all entities within the enterprise | entire_tenant |
| 5 | Company Admin | 2 | Full access within a single company | entire_tenant |
| 6 | Company HR Manager | 2 | Manages employee records and HR operations for a company | legal_entity |
| 7 | Payroll Manager | 2 | Processes and approves payroll for a company | legal_entity |
| 8 | Department Manager | 3 | Manages employees and scheduling within a department | department |
| 9 | Team Lead | 4 | Limited management scope over a direct team | direct_reports |
| 10 | Employee | 5 | Standard self-service employee access | self |
| 11 | Contractor | 6 | External contractor with minimal access | self |
| 12 | Support Agent | 0 | Customer support read-only access | Cross-tenant (read-only) |

> **Note:** The existing legacy roles (System Administrator, Owner, HR Manager, Payroll Manager, Department Manager, Supervisor, Employee, Contractor) from the initial seed remain and continue to drive the `role_permissions` table for the existing UI. The 12 enterprise roles above populate `enterprise_role_permissions` and drive the new layered system.

---

## 14 Permission Groups

| # | Module | Group Name | Description |
|---|---|---|---|
| 1 | `platform` | Platform Administration | System-wide platform configuration and administration |
| 2 | `tenant` | Tenant Management | Enterprise and company provisioning, billing, and lifecycle |
| 3 | `org` | Organization Structure | Manage hierarchy: enterprises, companies, legal entities, locations, departments, teams |
| 4 | `workforce` | Workforce Management | Employee records, onboarding, terminations, and HR operations |
| 5 | `time` | Time & Attendance | Time tracking, punches, timesheets, and schedules |
| 6 | `payroll` | Payroll Processing | Payroll runs, pay items, deductions, and disbursements |
| 7 | `compensation` | Compensation & Benefits | Pay rates, wage history, benefits, and accruals |
| 8 | `compliance` | Compliance & Documents | Document management, retention policies, e-signatures, and audits |
| 9 | `reporting` | Reporting & Analytics | Reports, dashboards, exports, and data analytics |
| 10 | `access` | Access & Permissions | Role assignments, permission overrides, and user company access |
| 11 | `billing` | Billing & Subscriptions | Subscription plans, payment methods, and invoicing |
| 12 | `integrations` | Integrations & API | Third-party integrations, webhooks, and API key management |
| 13 | `support` | Support & Impersonation | Customer support tools, audit logs, and impersonation |
| 14 | `self_service` | Employee Self-Service | Employee-facing self-service: own profile, pay stubs, time off |

---

## Full Permission Catalog

### Platform Administration (`platform`)

| Permission Code | Name | Scope | Customer-Facing |
|---|---|---|---|
| `platform.settings.view` | View Platform Settings | entire_tenant | No |
| `platform.settings.edit` | Edit Platform Settings | entire_tenant | No |
| `platform.users.manage` | Manage System Users | entire_tenant | No |
| `platform.audit.view` | View Audit Logs | entire_tenant | No |

### Tenant Management (`tenant`)

| Permission Code | Name | Scope | Customer-Facing |
|---|---|---|---|
| `tenant.create` | Create Tenant | entire_tenant | No |
| `tenant.suspend` | Suspend Tenant | entire_tenant | No |
| `tenant.delete` | Delete Tenant | entire_tenant | No |
| `tenant.view_all` | View All Tenants | entire_tenant | No |
| `tenant.billing.manage` | Manage Tenant Billing | entire_tenant | No |

### Organization Structure (`org`)

| Permission Code | Name | Scope | Customer-Facing |
|---|---|---|---|
| `org.view` | View Organization | entire_tenant | Yes |
| `org.locations.manage` | Manage Locations | entire_tenant | Yes |
| `org.departments.manage` | Manage Departments | legal_entity | Yes |
| `org.teams.manage` | Manage Teams | department | Yes |
| `org.positions.manage` | Manage Positions | legal_entity | Yes |

### Workforce Management (`workforce`)

| Permission Code | Name | Scope | Customer-Facing |
|---|---|---|---|
| `workforce.employees.view_all` | View All Employees | entire_tenant | Yes |
| `workforce.employees.view_dept` | View Department Employees | department | Yes |
| `workforce.employees.view_direct` | View Direct Reports | direct_reports | Yes |
| `workforce.employees.view_self` | View Own Profile | self | Yes |
| `workforce.employees.create` | Create Employee | entire_tenant | Yes |
| `workforce.employees.edit` | Edit Employee | department | Yes |
| `workforce.employees.terminate` | Terminate Employee | legal_entity | Yes |
| `workforce.managers.manage` | Manage Manager Relations | department | Yes |

### Time & Attendance (`time`)

| Permission Code | Name | Scope | Customer-Facing |
|---|---|---|---|
| `time.timesheets.view_self` | View Own Timesheets | self | Yes |
| `time.timesheets.view_direct` | View Direct Report Timesheets | direct_reports | Yes |
| `time.timesheets.view_all` | View All Timesheets | entire_tenant | Yes |
| `time.timesheets.approve` | Approve Timesheets | direct_reports | Yes |
| `time.schedules.manage` | Manage Schedules | department | Yes |
| `time.punch.override` | Override Punch | direct_reports | Yes |

### Payroll Processing (`payroll`)

| Permission Code | Name | Scope | Customer-Facing |
|---|---|---|---|
| `payroll.paystubs.view_self` | View Own Pay Stubs | self | Yes |
| `payroll.run` | Run Payroll | legal_entity | Yes |
| `payroll.approve` | Approve Payroll | entire_tenant | Yes |
| `payroll.view_all` | View All Payroll | entire_tenant | Yes |
| `payroll.taxes.manage` | Manage Tax Deductions | legal_entity | Yes |

### Compensation & Benefits (`compensation`)

| Permission Code | Name | Scope | Customer-Facing |
|---|---|---|---|
| `compensation.view_self` | View Own Compensation | self | Yes |
| `compensation.view_direct` | View Direct Report Compensation | direct_reports | Yes |
| `compensation.view_all` | View All Compensation | entire_tenant | Yes |
| `compensation.edit` | Edit Compensation | legal_entity | Yes |
| `compensation.benefits.manage` | Manage Benefits | legal_entity | Yes |

### Compliance & Documents (`compliance`)

| Permission Code | Name | Scope | Customer-Facing |
|---|---|---|---|
| `compliance.documents.view_self` | View Own Documents | self | Yes |
| `compliance.documents.view_all` | View All Documents | entire_tenant | Yes |
| `compliance.documents.manage` | Manage Documents | legal_entity | Yes |
| `compliance.retention.manage` | Manage Retention Policies | entire_tenant | No |
| `compliance.esign.send` | Send for E-Signature | department | Yes |

### Reporting & Analytics (`reporting`)

| Permission Code | Name | Scope | Customer-Facing |
|---|---|---|---|
| `reporting.standard.view` | View Standard Reports | department | Yes |
| `reporting.all.view` | View All Reports | entire_tenant | Yes |
| `reporting.export` | Export Reports | legal_entity | Yes |
| `reporting.custom.create` | Create Custom Reports | entire_tenant | Yes |

### Access & Permissions (`access`)

| Permission Code | Name | Scope | Customer-Facing |
|---|---|---|---|
| `access.roles.view` | View Role Assignments | entire_tenant | Yes |
| `access.roles.assign` | Assign Roles | legal_entity | Yes |
| `access.roles.create` | Create Custom Roles | entire_tenant | No |
| `access.overrides.grant` | Grant Permission Overrides | entire_tenant | No |

### Billing & Subscriptions (`billing`)

| Permission Code | Name | Scope | Customer-Facing |
|---|---|---|---|
| `billing.invoices.view_self` | View Own Invoices | self | Yes |
| `billing.manage` | Manage Billing | entire_tenant | Yes |
| `billing.view_all` | View All Billing | entire_tenant | No |
| `billing.subscription.adjust` | Adjust Subscription | entire_tenant | No |

### Integrations & API (`integrations`)

| Permission Code | Name | Scope | Customer-Facing |
|---|---|---|---|
| `integrations.view` | View Integrations | entire_tenant | Yes |
| `integrations.manage` | Manage Integrations | entire_tenant | Yes |
| `integrations.api_keys.manage` | Manage API Keys | entire_tenant | Yes |
| `integrations.webhooks.view` | View Webhooks | entire_tenant | Yes |

### Support & Impersonation (`support`)

| Permission Code | Name | Scope | Customer-Facing |
|---|---|---|---|
| `support.tickets.view` | View Support Tickets | entire_tenant | No |
| `support.impersonate` | Impersonate User | entire_tenant | No |
| `support.audit.view` | View System Audit Logs | entire_tenant | No |
| `support.admin_tools.access` | Access Admin Tools | entire_tenant | No |

### Employee Self-Service (`self_service`)

| Permission Code | Name | Scope | Customer-Facing |
|---|---|---|---|
| `self_service.profile.view` | View Own Profile | self | Yes |
| `self_service.profile.edit` | Edit Own Profile | self | Yes |
| `self_service.schedule.view` | View Own Schedule | self | Yes |
| `self_service.time_off.request` | Submit Time Off Request | self | Yes |
| `self_service.pay_stubs.view` | View Own Pay Stubs | self | Yes |
| `self_service.documents.view` | View Own Documents | self | Yes |

---

## Role × Permission Group Matrix

Legend: ✅ = Full access to group | 🔍 = Partial/read-only | ❌ = No access

| Permission Group | Platform Super Admin | Platform Ops | Enterprise Admin | Enterprise HR Dir | Company Admin | Company HR Mgr | Payroll Mgr | Dept Manager | Team Lead | Employee | Contractor | Support Agent |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Platform Administration | ✅ | 🔍 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 🔍 |
| Tenant Management | ✅ | 🔍 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 🔍 |
| Organization Structure | ✅ | 🔍 | ✅ | 🔍 | ✅ | 🔍 | 🔍 | 🔍 | 🔍 | ❌ | ❌ | 🔍 |
| Workforce Management | ✅ | 🔍 | ✅ | ✅ | ✅ | ✅ | 🔍 | 🔍 | 🔍 | 🔍 | ❌ | 🔍 |
| Time & Attendance | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ | 🔍 | ✅ | 🔍 | ❌ | ❌ | ❌ |
| Payroll Processing | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ | ✅ | 🔍 | ❌ | 🔍 | ❌ | ❌ |
| Compensation & Benefits | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | 🔍 | 🔍 | ❌ | 🔍 | ❌ | ❌ |
| Compliance & Documents | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | 🔍 | ❌ | 🔍 | ❌ | ❌ |
| Reporting & Analytics | ✅ | 🔍 | ✅ | 🔍 | ✅ | 🔍 | 🔍 | 🔍 | ❌ | ❌ | ❌ | ❌ |
| Access & Permissions | ✅ | ❌ | ✅ | 🔍 | 🔍 | 🔍 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Billing & Subscriptions | ✅ | ❌ | 🔍 | ❌ | 🔍 | ❌ | ❌ | ❌ | ❌ | 🔍 | ❌ | ❌ |
| Integrations & API | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Support & Impersonation | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 🔍 |
| Employee Self-Service | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | 🔍 | ✅ | ✅ | ✅ | 🔍 | ❌ |

---

## Detailed Role-Permission Assignments

### Platform Super Admin
All permissions granted at `entire_tenant` scope.

### Platform Operations
- `platform.settings.view`, `platform.audit.view`, `platform.users.manage`
- `tenant.view_all`, `tenant.suspend`
- `support.tickets.view`, `support.impersonate`, `support.audit.view`, `support.admin_tools.access`
- `org.view`, `workforce.employees.view_all`
- `reporting.all.view`, `reporting.export`

### Enterprise Admin
- Full org management: locations, departments, teams, positions
- Full workforce: view/create/edit/terminate employees, manage manager relations
- Full time & attendance: view all timesheets, approve, manage schedules, override punches
- Full payroll: run, approve, view all, manage taxes
- Full compensation: view/edit all, manage benefits
- Full compliance: view/manage documents, e-sign
- Full reporting: view all, export, create custom
- Access management: view, assign, create roles
- Billing: view all, manage
- Integrations: manage all

### Enterprise HR Director
- Org: view, manage departments and positions
- Workforce: full CRUD, terminations, manager relations
- Compensation: view/edit all, manage benefits
- Compliance: view/manage all documents, retention policies, e-sign
- Reporting: view all, export
- Access: view role assignments

### Company Admin
Same as Enterprise Admin but scoped to single company. Cannot cross-enterprise.

### Company HR Manager
- Org: view, manage departments
- Workforce: view all, create, edit, terminate, manage managers
- Compensation: view/edit all, manage benefits
- Compliance: view/manage documents, e-sign
- Reporting: standard reports, export
- Access: view role assignments
- Self-service: full self-service

### Payroll Manager
- Org: view
- Workforce: view all employees
- Time: view all timesheets, approve
- Payroll: view all, run, approve, manage taxes
- Compensation: view all
- Reporting: standard reports, export
- Self-service: view own pay stubs

### Department Manager
- Org: view
- Workforce: view own dept & direct reports, edit employees, manage manager relations
- Time: view/approve direct reports' timesheets, manage schedules, override punches
- Payroll: view own pay stubs
- Compensation: view direct reports' compensation
- Compliance: e-sign
- Reporting: standard reports
- Self-service: full self-service

### Team Lead
- Org: view
- Workforce: view direct reports
- Time: view/approve direct reports' timesheets, manage schedules
- Self-service: full self-service

### Employee
- Workforce: view own profile
- Self-service: view own profile, edit profile, view schedule, request time off, view pay stubs, view documents

### Contractor
- Self-service: view profile, view schedule, view pay stubs

### Support Agent
- Platform: view audit logs
- Tenant: view all tenants
- Org: view
- Workforce: view all employees (read-only)
- Support: view tickets, view audit logs

---

## Lifecycle Events

The following events trigger permission-relevant state changes and should be enforced in Task 2:

| Event | Triggered By | Permission Impact |
|---|---|---|
| Employee Onboarded | HR Manager / Company Admin | `workforce.employees.create` required; auto-assigns `Employee` role |
| Employee Terminated | HR Manager / Company Admin | `workforce.employees.terminate` required; revokes user company access |
| Manager Reassignment | HR Manager / Dept Manager | `workforce.managers.manage` required; updates direct_reports scope |
| Role Assignment | Company Admin / Enterprise Admin | `access.roles.assign` required; creates `user_company_access` record |
| Permission Override Granted | Company Admin / Enterprise Admin | `access.overrides.grant` required; creates `user_permission_overrides` record |
| Permission Override Revoked | Company Admin / Enterprise Admin | `access.overrides.grant` required; deletes `user_permission_overrides` record |
| User Company Access Revoked | Company Admin / Enterprise Admin | `access.roles.assign` required; sets `user_company_access.is_active = false` |
| Payroll Run Initiated | Payroll Manager | `payroll.run` required |
| Payroll Approved | Company Admin / Enterprise Admin | `payroll.approve` required |
| Timesheet Approved | Manager / Payroll Manager | `time.timesheets.approve` required; scoped to direct_reports or entire_tenant |
| Document Sent for Signature | HR / Manager | `compliance.esign.send` required; scoped to department |
| Subscription Changed | Company Admin / Platform Ops | `billing.subscription.adjust` required |
| Tenant Suspended | Platform Ops / Super Admin | `tenant.suspend` required |
| User Impersonated | Support Agent / Super Admin | `support.impersonate` required |

---

## Constraints and Rules

1. **Scope Cascade**: A user with `entire_tenant` scope implicitly satisfies `legal_entity`, `location`, `department`, `direct_reports`, and `self` scope checks.

2. **Override Priority**: `user_permission_overrides` always take precedence over role-based permissions. A `isGranted: false` override revokes even if a role grants the permission.

3. **Multiple Roles**: A user can hold multiple roles via `user_company_access`. The effective permission set is the union of all granted permissions across all active role assignments, minus any `isGranted: false` overrides.

4. **Tenant Isolation**: All permissions are evaluated within the requesting user's `companyId`. Cross-company access requires `entire_tenant` scope and an enterprise-level role.

5. **Platform Roles**: `Platform Super Admin`, `Platform Operations`, and `Support Agent` are internal-only roles. They cannot be assigned to customer users.

6. **Manager Chain Queries**: The `employee_manager_relations` table supports querying the full manager chain (`getManagerChain`) and direct reports (`getDirectReports`). Both queries are scoped by `companyId` for tenant isolation.

7. **Scope Downgrade**: A user cannot assign a role that has a higher effective scope than their own role. A Department Manager cannot assign Company Admin.

8. **Expiring Overrides**: `user_permission_overrides.expires_at` is enforced at query time. Expired overrides are treated as non-existent.

---

## Tables Created (this task)

| Table | Purpose |
|---|---|
| `locations` | Physical locations within a company/legal entity |
| `teams` | Sub-groups within a department at a location |
| `employee_manager_relations` | Tracks primary/secondary manager assignments per employee |
| `permission_groups` | 14 functional permission categories |
| `permissions` | Individual permission records with scope and module |
| `enterprise_role_permissions` | Maps enterprise roles to specific permissions with scope |
| `user_company_access` | Multi-company role assignments per user |
| `user_permission_overrides` | Individual permission grants/revocations overriding role defaults |

---

*This document is generated as part of Task 16 (Org Hierarchy & Permission Schema) and is the authoritative source of truth for Task 2 (Authorization Enforcement).*
