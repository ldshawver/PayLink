/**
 * PayLink Role Hierarchy
 * ─────────────────────
 * Three principal namespaces:
 *   1. Platform roles  — access to /platform/* Console (internal staff only)
 *   2. Tenant roles    — access to /app/* Tenant App (licensed customers)
 *   3. Worker roles    — access to Employee Portal subset of /app/*
 *
 * Data scopes (applied on top of role):
 *   platform → tenant → branch → department → direct_reports → self
 *
 * CRITICAL RULE:
 *   "admin" is a tenant role (company admin) ONLY.
 *   It must NEVER have access to /platform/*.
 *   Platform Console requires an explicit platform_* role.
 */

// ── Platform-scoped roles ──────────────────────────────────────────────────
// These are the ONLY roles that may access the Platform Console.
// No tenant role — not even tenant_owner — should appear here.
export const PLATFORM_ROLES = [
  "platform_super_admin",    // Full access to all platform modules
  "platform_admin",          // Full access; cannot change super admin settings
  "platform_sales",          // Sales & Licensing modules only
  "platform_implementation", // Implementation / CS modules only
  "platform_support",        // Read access to tenant data for support; no billing
  "platform_billing",        // Platform Finance / billing only
  "platform_auditor",        // Read-only audit log across all tenants
] as const;

export type PlatformRole = typeof PLATFORM_ROLES[number];

// ── Tenant-scoped roles ────────────────────────────────────────────────────
// These roles operate within a single licensed tenant company.
// They must NEVER gain access to /platform/* routes.
export const TENANT_ADMIN_ROLES = [
  "tenant_owner",            // Company owner — full tenant authority
  "tenant_admin",            // Company-wide admin — all modules
  "tenant_hr_admin",         // HR modules, employee records, documents
  "tenant_payroll_admin",    // Payroll processing and audit
  "tenant_finance_admin",    // Finance, invoicing, expenses
  // ── Legacy backward-compat roles ──────────────────────────────────────────
  // "admin" is kept for existing database rows. It maps to tenant_admin.
  // "admin" must ALWAYS have a companyId — it is NOT a platform role.
  "admin",
] as const;

export const TENANT_MANAGER_ROLES = [
  "tenant_manager",          // Team/shift manager — manages direct reports
  "tenant_supervisor",       // Floor supervisor — limited approval rights
  // Legacy
  "manager",
  "supervisor",
] as const;

export type TenantAdminRole   = typeof TENANT_ADMIN_ROLES[number];
export type TenantManagerRole = typeof TENANT_MANAGER_ROLES[number];

// ── Worker-scoped roles ────────────────────────────────────────────────────
export const WORKER_ROLES = [
  "employee",   // Standard employee — personal portal only
  "contractor", // External contractor — contractor hub + portal
] as const;

export type WorkerRole = typeof WORKER_ROLES[number];

// ── Scope types ───────────────────────────────────────────────────────────
export const SCOPE_TYPES = [
  "platform",       // Affects all tenants
  "tenant",         // One tenant only
  "branch",         // One branch within a tenant
  "department",     // One department
  "direct_reports", // Manager's direct reports only
  "self",           // Own records only
] as const;

export type ScopeType = typeof SCOPE_TYPES[number];

// ── Permission action types ────────────────────────────────────────────────
export const PERMISSION_ACTIONS = [
  "view", "create", "edit", "approve", "delete",
  "export", "process", "configure", "assign",
  "impersonate", "audit_read",
] as const;

export type PermissionAction = typeof PERMISSION_ACTIONS[number];

// ── Permission keys ────────────────────────────────────────────────────────
// These are the enforceable permission keys for route guards and UI decisions.
// Format: <layer>.<module>.<action>  (or  <layer>.<module>.<scope>.<action>)
export const PERMISSION_KEYS = {
  // Platform layer — internal staff only
  platform: {
    console:        "platform.console.access",
    provisioning:   { manage: "platform.provisioning.manage", execute: "platform.provisioning.execute" },
    licensing:      { view: "platform.licensing.view", approve: "platform.licensing.approve" },
    agreements:     { view: "platform.agreements.view", edit: "platform.agreements.edit" },
    sales:          { view: "platform.sales.view", edit: "platform.sales.edit" },
    implementation: { view: "platform.implementation.view", edit: "platform.implementation.edit", configure: "platform.implementation.configure" },
    billing:        { view: "platform.billing.view", manage: "platform.billing.manage" },
    permissions:    { manage: "platform.permissions.manage" },
    audit:          { read: "platform.audit.read" },
    features:       { view: "platform.feature-registry.view" },
  },
  // Tenant layer — company-scoped
  tenant: {
    dashboard:      { view: "tenant.dashboard.view" },
    employees:      { view: "tenant.employees.view", create: "tenant.employees.create", edit: "tenant.employees.edit" },
    users:          { manage: "tenant.users.manage" },
    wages:          { view: "tenant.wages.view", edit: "tenant.wages.edit" },
    attendance:     {
      viewSelf: "tenant.attendance.view.self",
      viewTeam: "tenant.attendance.view.team",
      editTeam: "tenant.attendance.edit.team",
      approve:  "tenant.attendance.approve.team",
    },
    punches:        { viewSelf: "tenant.punches.view.self", editTeam: "tenant.punches.edit.team" },
    timeOff:        { requestSelf: "tenant.time-off.request.self", approveTeam: "tenant.time-off.approve.team" },
    accruals:       { viewSelf: "tenant.accruals.view.self", viewTeam: "tenant.accruals.view.team" },
    schedule:       {
      viewSelf:   "tenant.schedule.view.self",
      manageTeam: "tenant.schedule.manage.team",
      marketplace: { view: "tenant.schedule.marketplace.view", publish: "tenant.schedule.marketplace.publish" },
      templates:  { manage: "tenant.schedule.templates.manage" },
    },
    expenses:       { submitSelf: "tenant.expenses.submit.self", approveTeam: "tenant.expenses.approve.team" },
    hr: {
      reviews:        { viewSelf: "tenant.hr.reviews.view.self", manageTeam: "tenant.hr.reviews.manage.team" },
      qualifications: { manage: "tenant.hr.qualifications.manage" },
      education:      { manage: "tenant.hr.education.manage" },
    },
    payroll: {
      process:  "tenant.payroll.process",
      approve:  "tenant.payroll.approve",
      audit:    "tenant.payroll.audit.read",
      taxes:    "tenant.payroll.taxes.configure",
    },
    paystubs:       { viewTeam: "tenant.paystubs.view.team", manage: "tenant.paystubs.manage" },
    policy:         { configure: "tenant.policy.configure", payCodes: "tenant.policy.pay-codes.configure" },
    invoices:       { view: "tenant.invoices.view", create: "tenant.invoices.create", approve: "tenant.invoices.approve" },
    bizDocs:        { view: "tenant.biz-docs.view", create: "tenant.biz-docs.create" },
    contractorHub:  { view: "tenant.contractor-hub.view", approve: "tenant.contractor-hub.approve" },
    trade:          { manage: "tenant.trade.manage", approve: "tenant.trade.approve" },
    customers:      { view: "tenant.customers.view", manage: "tenant.customers.manage" },
    company:        { view: "tenant.company.view", configure: "tenant.company.configure" },
    org:            { configure: "tenant.org.configure" },
    documents:      { view: "tenant.documents.view", manage: "tenant.documents.manage", approve: "tenant.documents.approve", sign: "tenant.documents.sign", requestSig: "tenant.documents.request-signature" },
    reports:        { payroll: "tenant.reports.payroll.view", hr: "tenant.reports.hr.view", export: "tenant.reports.export" },
    messages:       { view: "tenant.messages.view", broadcast: "tenant.messages.broadcast" },
    settings:       { configure: "tenant.settings.configure" },
    notifications:  { configure: "tenant.notifications.configure" },
    treasury:       { view: "tenant.treasury.view", manage: "tenant.treasury.manage" },
  },
  // Self layer — own data only
  self: {
    profile:        { view: "self.profile.view", edit: "self.profile.edit" },
    schedule:       { view: "self.schedule.view", marketplaceRequest: "self.schedule.marketplace.request" },
    punches:        { view: "self.punches.view", clockAction: "self.clock.action" },
    timesheet:      { view: "self.timesheet.view" },
    timeOff:        { request: "self.time-off.request" },
    paystubs:       { view: "self.paystubs.view" },
    documents:      { view: "self.documents.view", acknowledge: "self.documents.acknowledge" },
    notifications:  { configure: "self.notifications.configure" },
    messages:       { view: "self.messages.view", reply: "self.messages.reply" },
    expenses:       { submit: "self.expenses.submit" },
  },
} as const;

// ── Role → Permission mapping ──────────────────────────────────────────────
// Maps each role to the platform modules it may access.
export const PLATFORM_MODULE_ACCESS: Record<string, PlatformRole[]> = {
  licensing:         ["platform_super_admin", "platform_admin", "platform_sales", "platform_billing"],
  implementation:    ["platform_super_admin", "platform_admin", "platform_implementation", "platform_support"],
  provisioning:      ["platform_super_admin", "platform_admin", "platform_implementation", "platform_support"],
  platform_finance:  ["platform_super_admin", "platform_admin", "platform_billing"],
  oversight:         ["platform_super_admin", "platform_admin", "platform_auditor", "platform_support"],
  feature_registry:  ["platform_super_admin", "platform_admin"],
};

// ── Helper functions ───────────────────────────────────────────────────────

export function isPlatformRole(role: string): role is PlatformRole {
  return (PLATFORM_ROLES as readonly string[]).includes(role);
}

export function isTenantAdminRole(role: string): boolean {
  return (TENANT_ADMIN_ROLES as readonly string[]).includes(role);
}

export function isTenantManagerRole(role: string): boolean {
  return (TENANT_MANAGER_ROLES as readonly string[]).includes(role);
}

export function isManagerOrAbove(role: string): boolean {
  return isTenantAdminRole(role) || isTenantManagerRole(role) || isPlatformRole(role);
}

export function isWorkerRole(role: string): boolean {
  return (WORKER_ROLES as readonly string[]).includes(role);
}

/**
 * Determine if a user may access the Platform Console.
 *
 * STRICT RULE: Only explicit platform_* roles are allowed.
 * "admin" is a TENANT role and must NEVER access /platform/*.
 *
 * The dev environment platform account should use role "platform_super_admin".
 * There is intentionally NO legacy bypass here — that was the security flaw.
 */
export function canAccessPlatformConsole(
  role: string | null | undefined,
  _companyId?: number | null | undefined,
): boolean {
  if (!role) return false;
  return isPlatformRole(role);
}

/**
 * Check if a platform role can access a specific platform module.
 * platform_super_admin always passes (superuser of the platform).
 */
export function canAccessPlatformModule(
  role: string,
  module: keyof typeof PLATFORM_MODULE_ACCESS,
): boolean {
  if (role === "platform_super_admin") return true;
  const allowed = PLATFORM_MODULE_ACCESS[module] as string[];
  return allowed.includes(role);
}

/**
 * Expand a role to its effective role set for backward-compatible requireRole() checks.
 * New role names map to the legacy strings used in server-side guards.
 *
 * Example: tenant_admin → ["admin", "tenant_admin"]
 *          tenant_manager → ["manager", "tenant_manager"]
 *          platform_super_admin → ["admin", "manager", "platform_super_admin"]
 */
export function expandRoleForLegacyGuards(role: string): string[] {
  if (role === "platform_super_admin" || role === "platform_admin") {
    return ["admin", "manager", "supervisor", role];
  }
  if (role === "system_admin") {
    return ["admin", "system_admin"];
  }
  if (role === "platform_support" || role === "platform_implementation") {
    return ["admin", "manager", role];
  }
  if (["tenant_owner", "tenant_admin", "tenant_hr_admin", "tenant_payroll_admin", "tenant_finance_admin"].includes(role)) {
    return ["admin", role];
  }
  if (["tenant_manager", "tenant_supervisor"].includes(role)) {
    return ["manager", "supervisor", role];
  }
  return [role];
}
