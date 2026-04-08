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
 */

// ── Platform-scoped roles ──────────────────────────────────────────────────
// These are the ONLY roles that may access the Platform Console.
// No tenant role — not even tenant_owner — should appear here.
export const PLATFORM_ROLES = [
  "platform_super_admin",   // Full access to all platform modules
  "platform_admin",         // Full access, cannot change super admin settings
  "platform_sales",         // Sales & Licensing modules only
  "platform_implementation",// Implementation / CS modules only
  "platform_support",       // Read access to tenant data for support; no billing
  "platform_billing",       // Platform Finance / billing only
  "platform_auditor",       // Read-only audit log across all tenants
] as const;

export type PlatformRole = typeof PLATFORM_ROLES[number];

// ── Tenant-scoped roles ────────────────────────────────────────────────────
// These roles operate within a single licensed tenant company.
// They must NEVER gain access to /platform/* routes.
export const TENANT_ADMIN_ROLES = [
  "tenant_owner",           // Company owner — full tenant authority
  "tenant_admin",           // Company-wide admin — all modules
  "tenant_hr_admin",        // HR modules, employee records, documents
  "tenant_payroll_admin",   // Payroll processing and audit
  "tenant_finance_admin",   // Finance, invoicing, expenses
  // ─── Legacy backward-compat roles ─────────────────────────────────────────
  // "admin" is kept for existing database rows. New records should use tenant_admin.
  // "admin" with companyId !== null is treated as tenant_admin everywhere.
  "admin",
] as const;

export const TENANT_MANAGER_ROLES = [
  "tenant_manager",         // Team/shift manager — manages direct reports
  "tenant_supervisor",      // Floor supervisor — limited approval rights
  // Legacy
  "manager",
  "supervisor",
] as const;

export type TenantAdminRole  = typeof TENANT_ADMIN_ROLES[number];
export type TenantManagerRole = typeof TENANT_MANAGER_ROLES[number];

// ── Worker-scoped roles ────────────────────────────────────────────────────
export const WORKER_ROLES = [
  "employee",               // Standard employee — personal portal only
  "contractor",             // External contractor — contractor hub + portal
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

// ── Helper functions ───────────────────────────────────────────────────────

export function isPlatformRole(role: string): boolean {
  return (PLATFORM_ROLES as readonly string[]).includes(role);
}

export function isTenantAdminRole(role: string): boolean {
  return (TENANT_ADMIN_ROLES as readonly string[]).includes(role);
}

export function isTenantManagerRole(role: string): boolean {
  return (TENANT_MANAGER_ROLES as readonly string[]).includes(role);
}

export function isManagerOrAbove(role: string): boolean {
  return isTenantAdminRole(role) || isTenantManagerRole(role);
}

export function isWorkerRole(role: string): boolean {
  return (WORKER_ROLES as readonly string[]).includes(role);
}

/**
 * Determine if a user may access the Platform Console.
 *
 * Rules:
 *   1. Any explicit platform_* role → YES
 *   2. Legacy "admin" with no companyId (platform-level user, not a tenant admin) → YES
 *   3. Everything else → NO
 *
 * This prevents tenant admins (who have role "admin" with a companyId) from
 * ever accessing /platform/* routes or seeing other tenants' data.
 */
export function canAccessPlatformConsole(
  role: string | null | undefined,
  companyId: number | null | undefined
): boolean {
  if (!role) return false;
  if (isPlatformRole(role)) return true;
  // Legacy dev admin without a tenant company = platform admin
  if (role === "admin" && !companyId) return true;
  return false;
}

/**
 * Platform Console module-level role guards.
 * Used in the sidebar to show/hide sections by platform role.
 */
export const PLATFORM_MODULE_ACCESS: Record<string, PlatformRole[]> = {
  licensing:         ["platform_super_admin", "platform_admin", "platform_sales", "platform_billing"],
  implementation:    ["platform_super_admin", "platform_admin", "platform_implementation", "platform_support"],
  provisioning:      ["platform_super_admin", "platform_admin", "platform_implementation", "platform_support"],
  platform_finance:  ["platform_super_admin", "platform_admin", "platform_billing"],
  oversight:         ["platform_super_admin", "platform_admin", "platform_auditor", "platform_support"],
  feature_registry:  ["platform_super_admin", "platform_admin"],
};

/**
 * Check if a platform role can access a specific platform module.
 * platform_super_admin always passes.
 */
export function canAccessPlatformModule(role: string, module: keyof typeof PLATFORM_MODULE_ACCESS): boolean {
  if (role === "platform_super_admin" || role === "admin") return true; // legacy admin gets full access
  const allowed = PLATFORM_MODULE_ACCESS[module] as string[];
  return allowed.includes(role);
}
