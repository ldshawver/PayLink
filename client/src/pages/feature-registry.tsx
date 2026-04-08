import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Info } from "lucide-react";

type FeatureEntry = {
  id: string;
  featureKey: string;
  route: string;
  module: string;
  feature: string;
  layer: "platform" | "tenant" | "employee";
  deptOwner: string;
  permissionKeys: string;
  scopeType: "platform" | "tenant" | "branch" | "department" | "direct_reports" | "self";
  visibility: string;
  editRights: string;
  approvalRights: string;
  auditRequired: boolean;
  tenantIsolated: boolean;
  sensitiveData: boolean;
  billingImpact: boolean;
  dependencies: string;
};

const FEATURES: FeatureEntry[] = [
  // ── Platform Console ───────────────────────────────────────────────────────
  { id: "p01", featureKey: "platform.sales.deal-pipeline", route: "/platform/deal-pipeline", module: "Sales & Licensing", feature: "Deal Pipeline", layer: "platform", deptOwner: "Sales / CSM", permissionKeys: "platform.console.access, platform.sales.view, platform.sales.edit", scopeType: "platform", visibility: "Platform Admins only", editRights: "Admin + CSM", approvalRights: "CSM Lead", auditRequired: true, tenantIsolated: false, sensitiveData: false, billingImpact: true, dependencies: "CRM" },
  { id: "p02", featureKey: "platform.sales.license-requests", route: "/platform/license-requests", module: "Sales & Licensing", feature: "License Requests", layer: "platform", deptOwner: "Legal / IT", permissionKeys: "platform.console.access, platform.licensing.view, platform.licensing.approve", scopeType: "platform", visibility: "Platform Admins only", editRights: "Admin only", approvalRights: "Platform Owner", auditRequired: true, tenantIsolated: false, sensitiveData: false, billingImpact: true, dependencies: "Deal Pipeline" },
  { id: "p03", featureKey: "platform.sales.agreements", route: "/platform/agreements", module: "Sales & Licensing", feature: "Agreement Templates", layer: "platform", deptOwner: "Legal", permissionKeys: "platform.console.access, platform.agreements.view, platform.agreements.edit", scopeType: "platform", visibility: "Platform Admins only", editRights: "Admin only", approvalRights: "Legal Team", auditRequired: true, tenantIsolated: false, sensitiveData: true, billingImpact: false, dependencies: "License Requests" },
  { id: "p04", featureKey: "platform.sales.signed-agreements", route: "/platform/agreements?tab=agreements", module: "Sales & Licensing", feature: "Signed Agreements", layer: "platform", deptOwner: "Legal", permissionKeys: "platform.console.access, platform.agreements.view", scopeType: "platform", visibility: "Platform Admins only", editRights: "Read-only", approvalRights: "Legal Team", auditRequired: true, tenantIsolated: false, sensitiveData: true, billingImpact: false, dependencies: "Agreements Templates" },
  { id: "p05", featureKey: "platform.cs.onboarding-projects", route: "/platform/onboarding-projects", module: "Implementation", feature: "Onboarding Projects", layer: "platform", deptOwner: "Customer Success", permissionKeys: "platform.console.access, platform.implementation.view, platform.implementation.edit", scopeType: "tenant", visibility: "Platform Admins + CS Team", editRights: "CS Lead + Admin", approvalRights: "CS Lead", auditRequired: true, tenantIsolated: false, sensitiveData: false, billingImpact: false, dependencies: "Deal Pipeline" },
  { id: "p06", featureKey: "platform.cs.onboarding-templates", route: "/platform/onboarding-templates", module: "Implementation", feature: "Onboarding Templates", layer: "platform", deptOwner: "Customer Success", permissionKeys: "platform.console.access, platform.implementation.configure", scopeType: "platform", visibility: "Platform Admins only", editRights: "Admin only", approvalRights: "None", auditRequired: false, tenantIsolated: false, sensitiveData: false, billingImpact: false, dependencies: "Onboarding Projects" },
  { id: "p07", featureKey: "platform.cs.engagement-feed", route: "/platform/engagement-feed", module: "Implementation", feature: "Engagement Feed", layer: "platform", deptOwner: "Customer Success", permissionKeys: "platform.console.access, platform.implementation.view", scopeType: "platform", visibility: "Platform Admins + CS Team", editRights: "CS Team", approvalRights: "None", auditRequired: false, tenantIsolated: false, sensitiveData: false, billingImpact: false, dependencies: "Onboarding Projects" },
  { id: "p08", featureKey: "platform.cs.contractor-onboarding", route: "/platform/contractor-onboarding", module: "Implementation", feature: "Contractor Onboarding", layer: "platform", deptOwner: "Operations", permissionKeys: "platform.console.access, platform.implementation.edit", scopeType: "tenant", visibility: "Platform Admins only", editRights: "Admin", approvalRights: "Admin", auditRequired: true, tenantIsolated: false, sensitiveData: true, billingImpact: false, dependencies: "Agreements" },
  { id: "p09", featureKey: "platform.admin.provisioning", route: "/platform/provisioning", module: "Provisioning & Controls", feature: "Provisioning & Tenant Setup", layer: "platform", deptOwner: "Engineering / DevOps", permissionKeys: "platform.console.access, platform.provisioning.manage, platform.provisioning.execute", scopeType: "platform", visibility: "Platform Admins only", editRights: "Admin only", approvalRights: "Platform Owner", auditRequired: true, tenantIsolated: false, sensitiveData: true, billingImpact: true, dependencies: "License Requests" },
  { id: "p10", featureKey: "platform.admin.permissions", route: "/platform/permissions", module: "Provisioning & Controls", feature: "Platform Permissions", layer: "platform", deptOwner: "Security", permissionKeys: "platform.console.access, platform.permissions.manage", scopeType: "platform", visibility: "Platform Admins only", editRights: "Admin only", approvalRights: "Platform Owner", auditRequired: true, tenantIsolated: false, sensitiveData: true, billingImpact: false, dependencies: "Provisioning" },
  { id: "p11", featureKey: "platform.oversight.audit-log", route: "/platform/audit-log", module: "Oversight", feature: "Platform Audit Log", layer: "platform", deptOwner: "Security / Legal", permissionKeys: "platform.console.access, platform.audit.read", scopeType: "platform", visibility: "Admin + Auditor", editRights: "Read-only", approvalRights: "None", auditRequired: true, tenantIsolated: false, sensitiveData: true, billingImpact: false, dependencies: "All modules" },
  { id: "p12", featureKey: "platform.finance.billing", route: "/platform/billing", module: "Platform Finance", feature: "Platform Billing", layer: "platform", deptOwner: "Finance", permissionKeys: "platform.console.access, platform.billing.view, platform.billing.manage", scopeType: "platform", visibility: "Platform Admins + Billing role", editRights: "Admin only", approvalRights: "Platform Owner", auditRequired: true, tenantIsolated: false, sensitiveData: true, billingImpact: true, dependencies: "Stripe" },
  { id: "p13", featureKey: "platform.oversight.feature-registry", route: "/platform/feature-registry", module: "Oversight", feature: "Feature Registry", layer: "platform", deptOwner: "Product", permissionKeys: "platform.console.access, platform.feature-registry.view", scopeType: "platform", visibility: "Platform Admins only", editRights: "Product team", approvalRights: "Product Owner", auditRequired: false, tenantIsolated: false, sensitiveData: false, billingImpact: false, dependencies: "None" },

  // ── Tenant App ─────────────────────────────────────────────────────────────
  { id: "t01", featureKey: "tenant.home.dashboard", route: "/app", module: "Home", feature: "Dashboard", layer: "tenant", deptOwner: "All / HR", permissionKeys: "tenant.dashboard.view", scopeType: "tenant", visibility: "All users", editRights: "None (read-only)", approvalRights: "None", auditRequired: false, tenantIsolated: true, sensitiveData: false, billingImpact: false, dependencies: "All modules" },
  { id: "t02", featureKey: "tenant.home.messages", route: "/app/messages", module: "Home", feature: "Messages / Message Center", layer: "tenant", deptOwner: "HR / Management", permissionKeys: "tenant.messages.view, tenant.messages.broadcast", scopeType: "tenant", visibility: "All users (send: Admin/Manager)", editRights: "Admin + Manager (broadcast)", approvalRights: "None", auditRequired: false, tenantIsolated: true, sensitiveData: false, billingImpact: false, dependencies: "Workers, SMTP, Twilio" },
  { id: "t03", featureKey: "tenant.attendance.timesheet", route: "/app/attendance", module: "My Work", feature: "Timesheet", layer: "tenant", deptOwner: "HR / Operations", permissionKeys: "tenant.attendance.view.self, tenant.attendance.view.team, tenant.attendance.edit.team", scopeType: "direct_reports", visibility: "All (own), Manager (team)", editRights: "Manager (team), Admin", approvalRights: "Manager", auditRequired: true, tenantIsolated: true, sensitiveData: false, billingImpact: false, dependencies: "Time Clock, Schedules" },
  { id: "t04", featureKey: "tenant.attendance.punches", route: "/app/attendance?tab=punches", module: "My Work", feature: "Time Punches", layer: "tenant", deptOwner: "Operations", permissionKeys: "tenant.punches.view.self, tenant.punches.edit.team", scopeType: "direct_reports", visibility: "All (own), Manager (team)", editRights: "Manager + Admin", approvalRights: "Manager", auditRequired: true, tenantIsolated: true, sensitiveData: false, billingImpact: false, dependencies: "Stations, Schedules" },
  { id: "t05", featureKey: "tenant.attendance.accrual-balances", route: "/app/attendance?tab=accrual-balances", module: "My Work", feature: "Accrual Balances", layer: "tenant", deptOwner: "HR", permissionKeys: "tenant.accruals.view.self, tenant.accruals.view.team", scopeType: "self", visibility: "All (own)", editRights: "Admin only", approvalRights: "Manager", auditRequired: false, tenantIsolated: true, sensitiveData: false, billingImpact: false, dependencies: "Accrual Policies" },
  { id: "t06", featureKey: "tenant.attendance.pending-approvals", route: "/app/attendance?tab=pending-approvals", module: "My Work", feature: "Pending Approvals", layer: "tenant", deptOwner: "HR / Management", permissionKeys: "tenant.attendance.approve.team", scopeType: "direct_reports", visibility: "Admin + Manager", editRights: "Admin + Manager", approvalRights: "Manager", auditRequired: true, tenantIsolated: true, sensitiveData: false, billingImpact: false, dependencies: "Attendance" },
  { id: "t07", featureKey: "tenant.attendance.time-off", route: "/app/attendance?tab=time-off", module: "My Work", feature: "Time Off", layer: "tenant", deptOwner: "HR", permissionKeys: "tenant.time-off.request.self, tenant.time-off.approve.team", scopeType: "direct_reports", visibility: "All (own), Manager (team)", editRights: "Self (request), Manager (approve)", approvalRights: "Manager", auditRequired: false, tenantIsolated: true, sensitiveData: false, billingImpact: false, dependencies: "Absence Policies" },
  { id: "t08", featureKey: "tenant.schedule.view", route: "/app/schedule", module: "My Work", feature: "Schedule", layer: "tenant", deptOwner: "Operations", permissionKeys: "tenant.schedule.view.self, tenant.schedule.manage.team", scopeType: "branch", visibility: "All (own), Manager (team)", editRights: "Manager", approvalRights: "Manager", auditRequired: false, tenantIsolated: true, sensitiveData: false, billingImpact: false, dependencies: "Departments, Positions" },
  { id: "t09", featureKey: "tenant.schedule.marketplace", route: "/app/schedule?tab=marketplace", module: "My Work", feature: "Shift Marketplace", layer: "tenant", deptOwner: "Operations", permissionKeys: "tenant.schedule.marketplace.view, tenant.schedule.marketplace.publish", scopeType: "tenant", visibility: "All", editRights: "Admin + Manager (publish)", approvalRights: "Manager", auditRequired: false, tenantIsolated: true, sensitiveData: false, billingImpact: false, dependencies: "Schedule" },
  { id: "t10", featureKey: "tenant.expenses.manage", route: "/app/expenses", module: "My Work", feature: "Expenses & Invoices", layer: "tenant", deptOwner: "Finance", permissionKeys: "tenant.expenses.submit.self, tenant.expenses.approve.team", scopeType: "direct_reports", visibility: "All (own), Admin/Manager (team)", editRights: "Self (submit), Admin/Manager (approve)", approvalRights: "Manager", auditRequired: false, tenantIsolated: true, sensitiveData: false, billingImpact: true, dependencies: "Workers" },
  { id: "t11", featureKey: "tenant.employee.directory", route: "/app/employee", module: "Workforce", feature: "Employee Directory", layer: "tenant", deptOwner: "HR", permissionKeys: "tenant.employees.view, tenant.employees.edit, tenant.employees.create", scopeType: "tenant", visibility: "Admin + Manager", editRights: "Admin + Manager", approvalRights: "Admin", auditRequired: true, tenantIsolated: true, sensitiveData: true, billingImpact: true, dependencies: "None" },
  { id: "t12", featureKey: "tenant.employee.user-accounts", route: "/app/employee?tab=user-accounts", module: "Workforce", feature: "User Accounts", layer: "tenant", deptOwner: "IT / HR", permissionKeys: "tenant.users.manage", scopeType: "tenant", visibility: "Admin only", editRights: "Admin only", approvalRights: "Admin", auditRequired: true, tenantIsolated: true, sensitiveData: true, billingImpact: true, dependencies: "Workers" },
  { id: "t13", featureKey: "tenant.employee.wages", route: "/app/employee?tab=wages", module: "Workforce", feature: "Wages & Pay Methods", layer: "tenant", deptOwner: "Finance / HR", permissionKeys: "tenant.wages.view, tenant.wages.edit", scopeType: "tenant", visibility: "Admin + Manager", editRights: "Admin", approvalRights: "Admin", auditRequired: true, tenantIsolated: true, sensitiveData: true, billingImpact: true, dependencies: "Workers" },
  { id: "t14", featureKey: "tenant.hr.reviews", route: "/app/hr?tab=reviews", module: "HR", feature: "Performance Reviews", layer: "tenant", deptOwner: "HR", permissionKeys: "tenant.hr.reviews.view.self, tenant.hr.reviews.manage.team", scopeType: "direct_reports", visibility: "Admin/Manager + own", editRights: "Admin + Manager", approvalRights: "Manager", auditRequired: false, tenantIsolated: true, sensitiveData: true, billingImpact: false, dependencies: "Workers, KPI Groups" },
  { id: "t15", featureKey: "tenant.hr.qualifications", route: "/app/hr?tab=qualifications", module: "HR", feature: "Qualifications & Skills", layer: "tenant", deptOwner: "HR", permissionKeys: "tenant.hr.qualifications.manage", scopeType: "tenant", visibility: "Admin + Manager", editRights: "Admin", approvalRights: "None", auditRequired: false, tenantIsolated: true, sensitiveData: false, billingImpact: false, dependencies: "Workers" },
  { id: "t16", featureKey: "tenant.hr.education", route: "/app/hr?tab=education", module: "HR", feature: "Education & Licenses", layer: "tenant", deptOwner: "HR", permissionKeys: "tenant.hr.education.manage", scopeType: "tenant", visibility: "Admin + Manager", editRights: "Admin", approvalRights: "None", auditRequired: false, tenantIsolated: true, sensitiveData: false, billingImpact: false, dependencies: "Workers" },
  { id: "t17", featureKey: "tenant.payroll.process", route: "/app/payroll?tab=process", module: "Payroll", feature: "Process Payroll", layer: "tenant", deptOwner: "Finance / HR", permissionKeys: "tenant.payroll.process, tenant.payroll.approve", scopeType: "tenant", visibility: "Admin + Manager", editRights: "Admin", approvalRights: "Admin", auditRequired: true, tenantIsolated: true, sensitiveData: true, billingImpact: true, dependencies: "Workers, Pay Periods, Taxes" },
  { id: "t18", featureKey: "tenant.payroll.pay-stubs", route: "/app/payroll?tab=pay-stubs", module: "Payroll", feature: "Pay Stubs (All)", layer: "tenant", deptOwner: "Finance", permissionKeys: "tenant.paystubs.view.team, tenant.paystubs.manage", scopeType: "tenant", visibility: "Admin/Manager (all), Employee (own)", editRights: "Admin only", approvalRights: "Admin", auditRequired: true, tenantIsolated: true, sensitiveData: true, billingImpact: false, dependencies: "Payroll Runs" },
  { id: "t19", featureKey: "tenant.payroll.taxes", route: "/app/payroll?tab=taxes-deductions", module: "Payroll", feature: "Taxes & Deductions", layer: "tenant", deptOwner: "Finance", permissionKeys: "tenant.payroll.taxes.configure", scopeType: "tenant", visibility: "Admin only", editRights: "Admin", approvalRights: "Admin", auditRequired: true, tenantIsolated: true, sensitiveData: true, billingImpact: false, dependencies: "Payroll" },
  { id: "t20", featureKey: "tenant.payroll.audit", route: "/app/payroll-audit", module: "Payroll", feature: "Payroll Audit", layer: "tenant", deptOwner: "Finance / Audit", permissionKeys: "tenant.payroll.audit.read", scopeType: "tenant", visibility: "Admin + Manager", editRights: "Read-only", approvalRights: "None", auditRequired: true, tenantIsolated: true, sensitiveData: true, billingImpact: false, dependencies: "Payroll Runs" },
  { id: "t21", featureKey: "tenant.policy.groups", route: "/app/policy?tab=groups", module: "Policies & Rules", feature: "Policy Groups", layer: "tenant", deptOwner: "HR / Operations", permissionKeys: "tenant.policy.configure", scopeType: "tenant", visibility: "Admin only", editRights: "Admin", approvalRights: "Admin", auditRequired: false, tenantIsolated: true, sensitiveData: false, billingImpact: false, dependencies: "None" },
  { id: "t22", featureKey: "tenant.policy.pay-codes", route: "/app/policy?tab=pay-codes", module: "Policies & Rules", feature: "Pay Codes & Formulas", layer: "tenant", deptOwner: "Finance", permissionKeys: "tenant.policy.pay-codes.configure", scopeType: "tenant", visibility: "Admin only", editRights: "Admin", approvalRights: "None", auditRequired: false, tenantIsolated: true, sensitiveData: false, billingImpact: false, dependencies: "Policy Groups" },
  { id: "t23", featureKey: "tenant.finance.invoicing", route: "/app/invoices", module: "Finance", feature: "Invoicing (Business)", layer: "tenant", deptOwner: "Finance / Sales", permissionKeys: "tenant.invoices.view, tenant.invoices.create, tenant.invoices.approve", scopeType: "tenant", visibility: "Admin + Manager", editRights: "Admin + Manager", approvalRights: "Admin", auditRequired: true, tenantIsolated: true, sensitiveData: false, billingImpact: true, dependencies: "Customers" },
  { id: "t24", featureKey: "tenant.finance.biz-docs", route: "/app/biz-docs", module: "Finance", feature: "Invoices & Proposals", layer: "tenant", deptOwner: "Finance", permissionKeys: "tenant.biz-docs.view, tenant.biz-docs.create", scopeType: "tenant", visibility: "Admin + Manager", editRights: "Admin + Manager", approvalRights: "Admin", auditRequired: true, tenantIsolated: true, sensitiveData: false, billingImpact: true, dependencies: "Customers, Workers" },
  { id: "t25", featureKey: "tenant.finance.contractor-hub", route: "/app/contractor-hub", module: "Finance", feature: "Contractor Hub", layer: "tenant", deptOwner: "Finance / Operations", permissionKeys: "tenant.contractor-hub.view, tenant.contractor-hub.approve", scopeType: "tenant", visibility: "Admin/Manager + Contractor (own)", editRights: "Contractor (proposals), Admin (payments)", approvalRights: "Admin", auditRequired: true, tenantIsolated: true, sensitiveData: true, billingImpact: true, dependencies: "Workers, Contractors" },
  { id: "t26", featureKey: "tenant.finance.trade-compensation", route: "/app/trade-compensation", module: "Finance", feature: "Trade Compensation", layer: "tenant", deptOwner: "Finance", permissionKeys: "tenant.trade.manage, tenant.trade.approve", scopeType: "tenant", visibility: "Admin + Manager", editRights: "Admin", approvalRights: "Admin", auditRequired: true, tenantIsolated: true, sensitiveData: true, billingImpact: true, dependencies: "Workers, Payroll" },
  { id: "t27", featureKey: "tenant.finance.customers", route: "/app/customers", module: "Finance", feature: "Customers & Vendors", layer: "tenant", deptOwner: "Sales / Admin", permissionKeys: "tenant.customers.view, tenant.customers.manage", scopeType: "tenant", visibility: "Admin + Manager", editRights: "Admin + Manager", approvalRights: "None", auditRequired: false, tenantIsolated: true, sensitiveData: false, billingImpact: false, dependencies: "None" },
  { id: "t28", featureKey: "tenant.org.company", route: "/app/company", module: "Organization", feature: "Company Information", layer: "tenant", deptOwner: "Admin", permissionKeys: "tenant.company.view, tenant.company.configure", scopeType: "tenant", visibility: "Admin + Manager (view)", editRights: "Admin", approvalRights: "None", auditRequired: false, tenantIsolated: true, sensitiveData: false, billingImpact: false, dependencies: "None" },
  { id: "t29", featureKey: "tenant.org.departments", route: "/app/company?tab=departments", module: "Organization", feature: "Departments / Divisions / Branches", layer: "tenant", deptOwner: "Admin", permissionKeys: "tenant.org.configure", scopeType: "tenant", visibility: "Admin + Manager", editRights: "Admin", approvalRights: "None", auditRequired: false, tenantIsolated: true, sensitiveData: false, billingImpact: false, dependencies: "Company" },
  { id: "t30", featureKey: "tenant.docs.company-documents", route: "/app/company-documents", module: "Documents & Compliance", feature: "Company Documents", layer: "tenant", deptOwner: "Legal / HR", permissionKeys: "tenant.documents.view, tenant.documents.manage, tenant.documents.approve", scopeType: "tenant", visibility: "Admin + Manager", editRights: "Admin", approvalRights: "Admin", auditRequired: true, tenantIsolated: true, sensitiveData: true, billingImpact: false, dependencies: "None" },
  { id: "t31", featureKey: "tenant.docs.e-signatures", route: "/app/company-documents?tab=documents", module: "Documents & Compliance", feature: "Document E-Signatures", layer: "tenant", deptOwner: "Legal", permissionKeys: "tenant.documents.sign, tenant.documents.request-signature", scopeType: "tenant", visibility: "Admin + Manager + Signers", editRights: "Admin", approvalRights: "Admin", auditRequired: true, tenantIsolated: true, sensitiveData: true, billingImpact: false, dependencies: "Company Documents" },
  { id: "t32", featureKey: "tenant.reports.payroll", route: "/app/reports?tab=payroll", module: "Reports", feature: "Payroll Reports", layer: "tenant", deptOwner: "Finance", permissionKeys: "tenant.reports.payroll.view, tenant.reports.export", scopeType: "tenant", visibility: "Admin + Manager", editRights: "None (read-only)", approvalRights: "None", auditRequired: false, tenantIsolated: true, sensitiveData: true, billingImpact: false, dependencies: "Payroll" },
  { id: "t33", featureKey: "tenant.reports.hr", route: "/app/reports?tab=hr", module: "Reports", feature: "HR & Employee Reports", layer: "tenant", deptOwner: "HR", permissionKeys: "tenant.reports.hr.view, tenant.reports.export", scopeType: "tenant", visibility: "Admin + Manager", editRights: "None (read-only)", approvalRights: "None", auditRequired: false, tenantIsolated: true, sensitiveData: true, billingImpact: false, dependencies: "Workers, HR" },
  { id: "t34", featureKey: "tenant.system.settings", route: "/app/settings", module: "System Admin", feature: "Settings", layer: "tenant", deptOwner: "IT / Admin", permissionKeys: "tenant.settings.configure", scopeType: "tenant", visibility: "Admin only", editRights: "Admin", approvalRights: "None", auditRequired: false, tenantIsolated: true, sensitiveData: false, billingImpact: false, dependencies: "None" },
  { id: "t35", featureKey: "tenant.system.alert-templates", route: "/app/notification-templates", module: "System Admin", feature: "Alert Templates", layer: "tenant", deptOwner: "IT / HR", permissionKeys: "tenant.notifications.configure", scopeType: "tenant", visibility: "Admin only", editRights: "Admin", approvalRights: "None", auditRequired: false, tenantIsolated: true, sensitiveData: false, billingImpact: false, dependencies: "Notifications" },
  { id: "t36", featureKey: "tenant.finance.treasury", route: "/app/treasury", module: "Payroll", feature: "Stripe Treasury", layer: "tenant", deptOwner: "Finance", permissionKeys: "tenant.treasury.view, tenant.treasury.manage", scopeType: "tenant", visibility: "Admin only", editRights: "Admin", approvalRights: "Admin", auditRequired: true, tenantIsolated: true, sensitiveData: true, billingImpact: true, dependencies: "Stripe" },

  // ── Employee Portal ────────────────────────────────────────────────────────
  { id: "e01", featureKey: "employee.profile.view", route: "/app/my-profile", module: "Employee Portal", feature: "My Profile", layer: "employee", deptOwner: "HR / Self", permissionKeys: "self.profile.view, self.profile.edit", scopeType: "self", visibility: "Self only", editRights: "Self", approvalRights: "None", auditRequired: false, tenantIsolated: true, sensitiveData: true, billingImpact: false, dependencies: "Workers" },
  { id: "e02", featureKey: "employee.schedule.personal", route: "/app/schedule?tab=schedules", module: "Employee Portal", feature: "Personal Schedule", layer: "employee", deptOwner: "Operations", permissionKeys: "self.schedule.view", scopeType: "self", visibility: "Self only", editRights: "None (read-only)", approvalRights: "Manager", auditRequired: false, tenantIsolated: true, sensitiveData: false, billingImpact: false, dependencies: "Schedule" },
  { id: "e03", featureKey: "employee.attendance.punches", route: "/app/attendance?tab=punches", module: "Employee Portal", feature: "Personal Punches / Clock In-Out", layer: "employee", deptOwner: "Operations", permissionKeys: "self.punches.view, self.clock.action", scopeType: "self", visibility: "Self only", editRights: "None (Manager adjusts)", approvalRights: "Manager", auditRequired: true, tenantIsolated: true, sensitiveData: false, billingImpact: false, dependencies: "Stations, Schedules" },
  { id: "e04", featureKey: "employee.attendance.timesheet", route: "/app/attendance?tab=timesheet", module: "Employee Portal", feature: "Personal Timesheets", layer: "employee", deptOwner: "HR", permissionKeys: "self.timesheet.view", scopeType: "self", visibility: "Self only", editRights: "None (read-only)", approvalRights: "Manager", auditRequired: false, tenantIsolated: true, sensitiveData: false, billingImpact: false, dependencies: "Attendance" },
  { id: "e05", featureKey: "employee.attendance.time-off", route: "/app/attendance?tab=time-off", module: "Employee Portal", feature: "Time Off Requests", layer: "employee", deptOwner: "HR", permissionKeys: "self.time-off.request", scopeType: "self", visibility: "Self only", editRights: "Self (submit only)", approvalRights: "Manager", auditRequired: false, tenantIsolated: true, sensitiveData: false, billingImpact: false, dependencies: "Absence Policies" },
  { id: "e06", featureKey: "employee.payroll.pay-stubs", route: "/app/my-profile?tab=paystubs", module: "Employee Portal", feature: "Pay Stubs (Personal)", layer: "employee", deptOwner: "Finance", permissionKeys: "self.paystubs.view", scopeType: "self", visibility: "Self only", editRights: "None (read-only)", approvalRights: "None", auditRequired: false, tenantIsolated: true, sensitiveData: true, billingImpact: false, dependencies: "Payroll" },
  { id: "e07", featureKey: "employee.docs.personal", route: "/app/my-profile?tab=documents", module: "Employee Portal", feature: "Personal Documents", layer: "employee", deptOwner: "HR / Legal", permissionKeys: "self.documents.view, self.documents.acknowledge", scopeType: "self", visibility: "Self + Admin/HR", editRights: "Self (acknowledge), Admin (assign)", approvalRights: "Admin", auditRequired: false, tenantIsolated: true, sensitiveData: true, billingImpact: false, dependencies: "Company Documents" },
  { id: "e08", featureKey: "employee.notifications.settings", route: "/app/notification-settings", module: "Employee Portal", feature: "Notification Settings", layer: "employee", deptOwner: "IT / HR", permissionKeys: "self.notifications.configure", scopeType: "self", visibility: "Self only", editRights: "Self (preferences)", approvalRights: "None", auditRequired: false, tenantIsolated: true, sensitiveData: false, billingImpact: false, dependencies: "Alert Templates" },
  { id: "e09", featureKey: "employee.messages.personal", route: "/app/messages", module: "Employee Portal", feature: "Messages (Personal Inbox)", layer: "employee", deptOwner: "HR / Management", permissionKeys: "self.messages.view, self.messages.reply", scopeType: "self", visibility: "Self only", editRights: "Self (reply only)", approvalRights: "None", auditRequired: false, tenantIsolated: true, sensitiveData: false, billingImpact: false, dependencies: "Staff Messages" },
  { id: "e10", featureKey: "employee.expenses.submit", route: "/app/expenses", module: "Employee Portal", feature: "Expense Submission", layer: "employee", deptOwner: "Finance", permissionKeys: "self.expenses.submit", scopeType: "self", visibility: "Self only", editRights: "Self (submit)", approvalRights: "Manager", auditRequired: false, tenantIsolated: true, sensitiveData: false, billingImpact: false, dependencies: "Expenses" },
  { id: "e11", featureKey: "employee.schedule.marketplace", route: "/app/schedule?tab=marketplace", module: "Employee Portal", feature: "Shift Marketplace (Personal)", layer: "employee", deptOwner: "Operations", permissionKeys: "self.schedule.marketplace.request", scopeType: "self", visibility: "Self — available shifts", editRights: "Self (request shifts)", approvalRights: "Manager", auditRequired: false, tenantIsolated: true, sensitiveData: false, billingImpact: false, dependencies: "Schedule" },
];

const LAYER_CONFIG = {
  platform: { label: "Platform Console", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300", dot: "bg-amber-500" },
  tenant:   { label: "Tenant App",       color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",   dot: "bg-blue-500" },
  employee: { label: "Employee Portal",  color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300", dot: "bg-green-500" },
};

const SCOPE_CONFIG: Record<string, string> = {
  "platform":       "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  "tenant":         "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  "branch":         "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  "department":     "bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  "direct_reports": "bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  "self":           "bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
};

function Flag({ value, yes, no }: { value: boolean; yes?: string; no?: string }) {
  if (value) return <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 text-xs font-bold">{yes ?? "✓"}</span>;
  return <span className="text-muted-foreground/30 text-xs">{no ?? "—"}</span>;
}

export default function FeatureRegistryPage() {
  const [search, setSearch] = useState("");
  const [layerFilter, setLayerFilter] = useState("all");
  const [moduleFilter, setModuleFilter] = useState("all");

  const allModules = Array.from(new Set(FEATURES.map(f => f.module))).sort();

  const filtered = FEATURES.filter(f => {
    const matchSearch = !search || [f.module, f.feature, f.featureKey, f.deptOwner, f.permissionKeys, f.dependencies]
      .some(v => v.toLowerCase().includes(search.toLowerCase()));
    const matchLayer = layerFilter === "all" || f.layer === layerFilter;
    const matchModule = moduleFilter === "all" || f.module === moduleFilter;
    return matchSearch && matchLayer && matchModule;
  });

  const counts = {
    platform: FEATURES.filter(f => f.layer === "platform").length,
    tenant: FEATURES.filter(f => f.layer === "tenant").length,
    employee: FEATURES.filter(f => f.layer === "employee").length,
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="px-6 py-4 border-b shrink-0">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-lg font-semibold">Feature Registry</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {FEATURES.length} features — permission keys, scope model, tenant isolation, and data sensitivity mapped for governance enforcement
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(counts).map(([layer, count]) => {
              const cfg = LAYER_CONFIG[layer as keyof typeof LAYER_CONFIG];
              return (
                <span key={layer} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.color}`}>
                  <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
                  {cfg.label}: {count}
                </span>
              );
            })}
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mt-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search feature key, permission, module, owner..." className="pl-8 h-8 text-sm" data-testid="input-registry-search" />
          </div>
          <Select value={layerFilter} onValueChange={setLayerFilter}>
            <SelectTrigger className="h-8 w-40 text-sm" data-testid="select-layer-filter"><SelectValue placeholder="All Layers" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Layers</SelectItem>
              <SelectItem value="platform">Platform Console</SelectItem>
              <SelectItem value="tenant">Tenant App</SelectItem>
              <SelectItem value="employee">Employee Portal</SelectItem>
            </SelectContent>
          </Select>
          <Select value={moduleFilter} onValueChange={setModuleFilter}>
            <SelectTrigger className="h-8 w-48 text-sm" data-testid="select-module-filter"><SelectValue placeholder="All Modules" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Modules</SelectItem>
              {allModules.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Column legend */}
        <div className="flex gap-4 mt-2 text-[10px] text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1"><span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 font-bold">✓</span> = Required / Yes</span>
          <span>Scope = data boundary (platform → self)</span>
          <span>Tenant Iso. = data never crosses tenant boundary</span>
          <span>PII/Sensitive = contains personal or financial data</span>
          <span>Billing = action has billing/cost implications</span>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs min-w-[1600px]">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur z-10">
            <tr>
              <th className="text-left p-2 font-semibold text-muted-foreground w-36">Feature Key</th>
              <th className="text-left p-2 font-semibold text-muted-foreground w-28">Route</th>
              <th className="text-left p-2 font-semibold text-muted-foreground w-24">Module</th>
              <th className="text-left p-2 font-semibold text-muted-foreground w-36">Feature</th>
              <th className="text-left p-2 font-semibold text-muted-foreground w-28">Layer</th>
              <th className="text-left p-2 font-semibold text-muted-foreground w-24">Dept Owner</th>
              <th className="text-left p-2 font-semibold text-muted-foreground w-44">Permission Keys</th>
              <th className="text-left p-2 font-semibold text-muted-foreground w-24">Scope</th>
              <th className="text-left p-2 font-semibold text-muted-foreground w-32">Visibility</th>
              <th className="text-left p-2 font-semibold text-muted-foreground w-28">Edit Rights</th>
              <th className="text-left p-2 font-semibold text-muted-foreground w-24">Approval</th>
              <th className="text-center p-2 font-semibold text-muted-foreground w-16">Audit</th>
              <th className="text-center p-2 font-semibold text-muted-foreground w-16">Ten. Iso.</th>
              <th className="text-center p-2 font-semibold text-muted-foreground w-16">PII</th>
              <th className="text-center p-2 font-semibold text-muted-foreground w-16">Billing</th>
              <th className="text-left p-2 font-semibold text-muted-foreground">Dependencies</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 && (
              <tr><td colSpan={16} className="text-center py-10 text-muted-foreground">No features match your filter</td></tr>
            )}
            {filtered.map(f => {
              const layerCfg = LAYER_CONFIG[f.layer];
              const scopeClass = SCOPE_CONFIG[f.scopeType] || "";
              return (
                <tr key={f.id} className="hover:bg-muted/30 transition-colors" data-testid={`row-feature-${f.id}`}>
                  <td className="p-2 font-mono text-[10px] text-muted-foreground">{f.featureKey}</td>
                  <td className="p-2 font-mono text-[10px] text-muted-foreground truncate max-w-[7rem]">{f.route}</td>
                  <td className="p-2 font-medium text-foreground">{f.module}</td>
                  <td className="p-2 text-foreground font-medium">{f.feature}</td>
                  <td className="p-2">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${layerCfg.color}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${layerCfg.dot}`} />
                      {layerCfg.label}
                    </span>
                  </td>
                  <td className="p-2 text-muted-foreground">{f.deptOwner}</td>
                  <td className="p-2 font-mono text-[10px] text-muted-foreground leading-relaxed">{f.permissionKeys.split(", ").map(k => <div key={k}>{k}</div>)}</td>
                  <td className="p-2">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${scopeClass}`}>{f.scopeType}</span>
                  </td>
                  <td className="p-2 text-muted-foreground">{f.visibility}</td>
                  <td className="p-2 text-muted-foreground">{f.editRights}</td>
                  <td className="p-2 text-muted-foreground">{f.approvalRights}</td>
                  <td className="p-2 text-center"><Flag value={f.auditRequired} /></td>
                  <td className="p-2 text-center"><Flag value={f.tenantIsolated} /></td>
                  <td className="p-2 text-center"><Flag value={f.sensitiveData} /></td>
                  <td className="p-2 text-center"><Flag value={f.billingImpact} /></td>
                  <td className="p-2 text-muted-foreground">{f.dependencies}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="px-6 py-2 border-t bg-muted/20 flex items-center justify-between text-xs text-muted-foreground shrink-0">
        <span>Showing {filtered.length} of {FEATURES.length} features</span>
        <span>Last updated: {new Date().toLocaleDateString()}</span>
      </div>
    </div>
  );
}
