import { db } from "../db";
import { eq, and, sql as rawSql } from "drizzle-orm";
import {
  users, roles, rolePermissions, userRoles,
  authorizationAuditLog, workers, employeeManagerRelations,
} from "@shared/schema";

export type Permission =
  | "view" | "create" | "edit" | "delete" | "export" | "approve" | "configure"
  | "view_own" | "edit_own"
  | "view_subordinates" | "edit_subordinates" | "approve_subordinates"
  | "view_department" | "edit_department" | "approve_department"
  | "view_company" | "edit_company" | "approve_company";

export type ScopeContext = {
  ownerId?: string;       // workerId of the record's owner
  departmentId?: string;  // department name/id the record belongs to
  companyId?: string;     // companyId the record belongs to
};

export type AuthorizationResult = {
  granted: boolean;
  reason: string;
  role?: string;
  scope?: string;
};

export const PERMISSION_COLUMN: Record<Permission, keyof typeof rolePermissions.$inferSelect> = {
  view:                 "canView",
  create:               "canCreate",
  edit:                 "canEdit",
  delete:               "canDelete",
  export:               "canExport",
  approve:              "canApprove",
  configure:            "canConfigure",
  view_own:             "canViewOwn",
  edit_own:             "canEditOwn",
  view_subordinates:    "canViewSubordinates",
  edit_subordinates:    "canEditSubordinates",
  approve_subordinates: "canApproveSubordinates",
  view_department:      "canViewDepartment",
  edit_department:      "canEditDepartment",
  approve_department:   "canApproveDepartment",
  view_company:         "canViewCompany",
  edit_company:         "canEditCompany",
  approve_company:      "canApproveCompany",
};

// Maps users.role (lowercase/underscore) to canonical role names in the roles table
const ROLE_NAME_MAP: Record<string, string> = {
  "system_administrator":   "System Administrator",
  "admin":                  "System Administrator",
  "tenant_admin":           "System Administrator",
  "owner":                  "Owner",
  "tenant_owner":           "Owner",
  "hr_manager":             "HR Manager",
  "tenant_hr_admin":        "HR Manager",
  "payroll_manager":        "Payroll Manager",
  "tenant_payroll_admin":   "Payroll Manager",
  "tenant_finance_admin":   "Payroll Manager",
  "department_manager":     "Department Manager",
  "tenant_manager":         "Department Manager",
  "supervisor":             "Supervisor",
  "tenant_supervisor":      "Supervisor",
  "employee":               "Employee",
  "contractor":             "Contractor",
};

const FLAT_PERMISSIONS = new Set<Permission>([
  "view", "create", "edit", "delete", "export", "approve", "configure",
]);

type RolePermRow = typeof rolePermissions.$inferSelect;

type UserScopeInfo = {
  userId: string;
  workerId?: string;
  department?: string;
  companyId?: string;
  directReportIds: string[];
};

async function getUserScopeInfo(userId: string, userCompanyId?: string | null): Promise<UserScopeInfo> {
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (userRows.length === 0) return { userId, directReportIds: [] };

  const user = userRows[0];
  const companyId = userCompanyId ?? user.companyId ?? undefined;

  if (!user.workerId) {
    return { userId, companyId: companyId ?? undefined, directReportIds: [] };
  }

  const workerRows = await db
    .select({ id: workers.id, companyId: workers.companyId, department: workers.department })
    .from(workers)
    .where(eq(workers.id, user.workerId))
    .limit(1);

  const worker = workerRows[0];
  if (!worker) return { userId, companyId: companyId ?? undefined, directReportIds: [] };

  const reports = await db
    .select({ employeeId: employeeManagerRelations.employeeId })
    .from(employeeManagerRelations)
    .where(
      and(
        eq(employeeManagerRelations.managerId, worker.id),
        eq(employeeManagerRelations.isActive, true)
      )
    );

  return {
    userId,
    workerId: worker.id,
    department: worker.department ?? undefined,
    companyId: worker.companyId ?? companyId ?? undefined,
    directReportIds: reports.map(r => r.employeeId),
  };
}

function permSatisfiedByRow(
  row: RolePermRow,
  permission: Permission,
  userScope?: UserScopeInfo,
  ctx?: ScopeContext
): boolean {
  if (FLAT_PERMISSIONS.has(permission)) {
    return !!(row[PERMISSION_COLUMN[permission] as keyof RolePermRow]);
  }

  switch (permission) {
    case "view_own":
    case "edit_own": {
      const isView = permission === "view_own";
      const hasAnyScope = isView
        ? !!(row.canViewOwn || row.canViewSubordinates || row.canViewDepartment || row.canViewCompany)
        : !!(row.canEditOwn || row.canEditSubordinates || row.canEditDepartment || row.canEditCompany);
      if (!hasAnyScope) return false;
      if (!ctx || !userScope) return hasAnyScope;

      if (ctx.ownerId) {
        const isSelf = ctx.ownerId === userScope.workerId || ctx.ownerId === userScope.userId;
        if (isSelf) return hasAnyScope;

        if (userScope.directReportIds.includes(ctx.ownerId)) {
          return isView
            ? !!(row.canViewSubordinates || row.canViewDepartment || row.canViewCompany)
            : !!(row.canEditSubordinates || row.canEditDepartment || row.canEditCompany);
        }

        if (ctx.departmentId && userScope.department && ctx.departmentId === userScope.department) {
          return isView
            ? !!(row.canViewDepartment || row.canViewCompany)
            : !!(row.canEditDepartment || row.canEditCompany);
        }

        if (ctx.companyId && userScope.companyId && ctx.companyId === userScope.companyId) {
          return isView ? !!(row.canViewCompany) : !!(row.canEditCompany);
        }

        // ownerId present but no scope match
        return false;
      }
      // No ownerId in context — cascade applies; if dept/company in context, check those
      if (ctx.departmentId && userScope?.department && ctx.departmentId !== userScope.department) {
        return isView
          ? !!(row.canViewDepartment || row.canViewCompany)
          : !!(row.canEditDepartment || row.canEditCompany);
      }
      return hasAnyScope;
    }

    case "view_subordinates":
    case "edit_subordinates":
    case "approve_subordinates": {
      const isView = permission === "view_subordinates";
      const isEdit = permission === "edit_subordinates";
      const hasFlag = isView
        ? !!(row.canViewSubordinates || row.canViewDepartment || row.canViewCompany)
        : isEdit
        ? !!(row.canEditSubordinates || row.canEditDepartment || row.canEditCompany)
        : !!(row.canApproveSubordinates || row.canApproveDepartment || row.canApproveCompany);
      if (!hasFlag) return false;
      if (!ctx || !userScope) return hasFlag;

      if (ctx.ownerId) {
        if (userScope.directReportIds.includes(ctx.ownerId)) return hasFlag;

        if (ctx.departmentId && userScope.department && ctx.departmentId === userScope.department) {
          return isView
            ? !!(row.canViewDepartment || row.canViewCompany)
            : isEdit
            ? !!(row.canEditDepartment || row.canEditCompany)
            : !!(row.canApproveDepartment || row.canApproveCompany);
        }

        if (ctx.companyId && userScope.companyId && ctx.companyId === userScope.companyId) {
          return isView ? !!(row.canViewCompany) : isEdit ? !!(row.canEditCompany) : !!(row.canApproveCompany);
        }
        return false;
      }
      return hasFlag;
    }

    case "view_department":
    case "edit_department":
    case "approve_department": {
      const isView = permission === "view_department";
      const isEdit = permission === "edit_department";
      const hasDeptFlag = isView
        ? !!(row.canViewDepartment || row.canViewCompany)
        : isEdit
        ? !!(row.canEditDepartment || row.canEditCompany)
        : !!(row.canApproveDepartment || row.canApproveCompany);
      if (!hasDeptFlag) return false;
      if (!ctx || !userScope) return hasDeptFlag;

      if (ctx.departmentId && userScope.department) {
        if (ctx.departmentId === userScope.department) return hasDeptFlag;
        // Different dept — need company scope
        if (ctx.companyId && userScope.companyId && ctx.companyId === userScope.companyId) {
          return isView ? !!(row.canViewCompany) : isEdit ? !!(row.canEditCompany) : !!(row.canApproveCompany);
        }
        return false;
      }

      if (ctx.companyId && userScope.companyId && ctx.companyId !== userScope.companyId) return false;
      return hasDeptFlag;
    }

    case "view_company":
    case "edit_company":
    case "approve_company": {
      const isView = permission === "view_company";
      const isApprove = permission === "approve_company";
      const hasCoFlag = isView ? !!(row.canViewCompany)
        : isApprove ? !!(row.canApproveCompany)
        : !!(row.canEditCompany);
      if (!hasCoFlag) return false;
      if (!ctx || !userScope) return hasCoFlag;
      if (ctx.companyId && userScope.companyId) return ctx.companyId === userScope.companyId;
      return hasCoFlag;
    }

    default:
      return !!(row[PERMISSION_COLUMN[permission] as keyof RolePermRow]);
  }
}

/**
 * Applies role-assignment scope constraints to the ScopeContext.
 * Returns null when the resource is definitively outside the role's scope boundaries.
 * Returns an enriched ScopeContext when the resource is within scope.
 */
function applyRoleScopeGate(
  ctx: ScopeContext | undefined,
  userScope: UserScopeInfo,
  scopeType: string | null | undefined,
  scopeId: string | null | undefined
): ScopeContext | null | undefined {
  const gated: ScopeContext = { ...ctx };

  // Propagate user's known company into context when caller didn't provide it
  if (!gated.companyId && userScope.companyId) {
    gated.companyId = userScope.companyId;
  }

  if (!scopeType || scopeType === "enterprise") {
    // Enterprise scope: no additional restriction
    return gated;
  }

  if (scopeType === "company") {
    // Company-scoped role: scopeId is the allowed companyId
    if (scopeId) {
      if (gated.companyId && gated.companyId !== scopeId) {
        return null; // Resource belongs to a different company
      }
      if (!gated.companyId) gated.companyId = scopeId;
    }
    return gated;
  }

  if (scopeType === "department") {
    // Department-scoped role: scopeId is the allowed departmentId
    const requiredDept = scopeId ?? userScope.department;
    if (requiredDept) {
      if (gated.departmentId && gated.departmentId !== requiredDept) {
        return null; // Resource belongs to a different department
      }
      if (!gated.departmentId) gated.departmentId = requiredDept;
    }
    // Also enforce company boundary
    if (scopeId && gated.companyId && userScope.companyId && gated.companyId !== userScope.companyId) {
      return null;
    }
    return gated;
  }

  // location or unknown scope types: no additional restriction for now
  return gated;
}

async function checkRolePermissions(
  roleId: string,
  roleName: string,
  resource: string,
  permission: Permission,
  userScope: UserScopeInfo,
  scopeType: string | null | undefined,
  scopeId: string | null | undefined,
  ctx?: ScopeContext
): Promise<AuthorizationResult | null> {
  const rolePerms = await db
    .select()
    .from(rolePermissions)
    .where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.resource, resource)))
    .limit(1);

  if (rolePerms.length === 0) return null;

  const gatedCtx = applyRoleScopeGate(ctx, userScope, scopeType, scopeId);
  if (gatedCtx === null) return null; // Resource is outside this role assignment's scope

  const row = rolePerms[0];
  if (permSatisfiedByRow(row, permission, userScope, gatedCtx ?? undefined)) {
    return {
      granted: true,
      reason: `Role '${roleName}' grants '${permission}' on '${resource}'`,
      role: roleName,
      scope: scopeType ?? undefined,
    };
  }
  return null;
}

async function resolveRolesBySystemRole(systemRole: string): Promise<Array<{
  roleId: string;
  scopeType: string | null;
  scopeId: string | null;
}>> {
  const canonicalName = ROLE_NAME_MAP[systemRole] ?? systemRole;
  const namedRole = await db
    .select({ id: roles.id })
    .from(roles)
    .where(rawSql`lower(${roles.name}) = lower(${canonicalName})`)
    .limit(1);
  return namedRole.map(r => ({ roleId: r.id, scopeType: "company", scopeId: null }));
}

export async function checkPermission(
  userId: string,
  resource: string,
  permission: Permission,
  scopeContext?: ScopeContext
): Promise<AuthorizationResult> {
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (userRows.length === 0) return { granted: false, reason: "User not found" };

  const user = userRows[0];
  const systemRole = user.role || "employee";

  if (systemRole === "platform_super_admin") {
    return { granted: true, reason: "Platform super admin", role: systemRole };
  }

  const userScope = await getUserScopeInfo(userId, user.companyId);

  const userRoleRows = await db
    .select({ roleId: userRoles.roleId, scopeType: userRoles.scopeType, scopeId: userRoles.scopeId })
    .from(userRoles)
    .where(eq(userRoles.userId, userId));

  const assignedRoles = userRoleRows.length > 0
    ? userRoleRows
    : await resolveRolesBySystemRole(systemRole);

  for (const ur of assignedRoles) {
    const roleRows = await db.select().from(roles).where(eq(roles.id, ur.roleId)).limit(1);
    const roleName = roleRows[0]?.name || ur.roleId;
    const result = await checkRolePermissions(
      ur.roleId, roleName, resource, permission,
      userScope, ur.scopeType, ur.scopeId, scopeContext
    );
    if (result) return result;
  }

  return {
    granted: false,
    reason: `No permission '${permission}' on resource '${resource}' for user`,
    role: systemRole,
  };
}

export async function requirePermission(
  userId: string,
  resource: string,
  permission: Permission,
  scopeContext?: ScopeContext
): Promise<void> {
  const result = await checkPermission(userId, resource, permission, scopeContext);
  if (!result.granted) {
    const err = new Error(result.reason) as Error & { statusCode: number };
    err.statusCode = 403;
    throw err;
  }
}

export async function getEffectivePermissions(
  userId: string
): Promise<{ resource: string; permissions: Permission[]; source: string; scope?: string }[]> {
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (userRows.length === 0) return [];

  const user = userRows[0];
  const systemRole = user.role || "employee";
  const result: Map<string, { permissions: Set<Permission>; source: string; scope?: string }> = new Map();

  const addPerms = (resource: string, perms: Permission[], source: string, scope?: string) => {
    if (!result.has(resource)) result.set(resource, { permissions: new Set(), source, scope });
    for (const p of perms) result.get(resource)!.permissions.add(p);
  };

  if (systemRole === "platform_super_admin") {
    const allPerms: Permission[] = [
      "view", "create", "edit", "delete", "export", "approve", "configure",
      "view_own", "edit_own",
      "view_subordinates", "edit_subordinates", "approve_subordinates",
      "view_department", "edit_department", "approve_department",
      "view_company", "edit_company", "approve_company",
    ];
    const allResources = [
      "payroll", "hr", "workers", "timesheets", "schedules", "reports",
      "billing", "permissions", "users", "company", "settings", "system_admin",
      "profile", "paystubs", "preferences", "documents", "contractor_hub",
      "dashboard", "companies", "departments", "branches", "divisions", "positions", "policies", "timeclock",
    ];
    for (const r of allResources) addPerms(r, allPerms, `system role: ${systemRole}`);
    return Array.from(result.entries()).map(([resource, { permissions, source, scope }]) => ({
      resource, permissions: Array.from(permissions), source, scope,
    }));
  }

  const userRoleRows = await db
    .select({ roleId: userRoles.roleId, scopeType: userRoles.scopeType, scopeId: userRoles.scopeId })
    .from(userRoles)
    .where(eq(userRoles.userId, userId));

  const allRoleRows = userRoleRows.length > 0
    ? userRoleRows
    : await resolveRolesBySystemRole(systemRole);

  for (const ur of allRoleRows) {
    const roleRows = await db.select().from(roles).where(eq(roles.id, ur.roleId)).limit(1);
    const roleName = roleRows[0]?.name || ur.roleId;

    const perms = await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, ur.roleId));
    for (const perm of perms) {
      const granted: Permission[] = [];
      if (perm.canView) granted.push("view");
      if (perm.canCreate) granted.push("create");
      if (perm.canEdit) granted.push("edit");
      if (perm.canDelete) granted.push("delete");
      if (perm.canExport) granted.push("export");
      if (perm.canApprove) granted.push("approve");
      if (perm.canConfigure) granted.push("configure");
      if (perm.canViewOwn) granted.push("view_own");
      if (perm.canEditOwn) granted.push("edit_own");
      if (perm.canViewSubordinates) granted.push("view_subordinates");
      if (perm.canEditSubordinates) granted.push("edit_subordinates");
      if (perm.canApproveSubordinates) granted.push("approve_subordinates");
      if (perm.canViewDepartment) granted.push("view_department");
      if (perm.canEditDepartment) granted.push("edit_department");
      if (perm.canApproveDepartment) granted.push("approve_department");
      if (perm.canViewCompany) granted.push("view_company");
      if (perm.canEditCompany) granted.push("edit_company");
      if (perm.canApproveCompany) granted.push("approve_company");
      if (granted.length > 0) {
        addPerms(perm.resource, granted, `role: ${roleName}`, ur.scopeType ?? undefined);
      }
    }
  }

  return Array.from(result.entries()).map(([resource, { permissions, source, scope }]) => ({
    resource, permissions: Array.from(permissions), source, scope,
  }));
}

export async function logAuthorizationChange(
  actorUserId: string,
  changeType: string,
  opts: {
    targetUserId?: string;
    targetRoleId?: string;
    targetResource?: string;
    beforeValue?: string;
    afterValue?: string;
    note?: string;
  }
): Promise<void> {
  await db.insert(authorizationAuditLog).values({
    actorUserId,
    changeType,
    targetUserId: opts.targetUserId,
    targetRoleId: opts.targetRoleId,
    targetResource: opts.targetResource,
    beforeValue: opts.beforeValue,
    afterValue: opts.afterValue,
    note: opts.note,
  });
}
