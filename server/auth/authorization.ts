import { db } from "../db";
import { eq, and, inArray } from "drizzle-orm";
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
  ownerId?: string;       // workerId of the record owner
  departmentId?: string;  // department slug/id the record belongs to
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

const FLAT_PERMISSIONS: Permission[] = ["view", "create", "edit", "delete", "export", "approve", "configure"];

type RolePermRow = typeof rolePermissions.$inferSelect;

type UserScopeInfo = {
  userId: string;
  workerId?: string;
  department?: string;
  companyId?: string;
  directReportIds: string[];
};

async function getUserScopeInfo(userId: string, companyId?: string | null): Promise<UserScopeInfo> {
  const workerRows = await db
    .select({ id: workers.id, companyId: workers.companyId, department: workers.department })
    .from(workers)
    .where(eq(workers.companyId, companyId ?? ""))
    .limit(50);

  const userRow = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const userCompanyId = userRow[0]?.companyId ?? companyId ?? undefined;

  const workerRow = workerRows.find(w => w.companyId === userCompanyId) ?? undefined;
  let directReportIds: string[] = [];

  if (workerRow) {
    const reports = await db
      .select({ employeeId: employeeManagerRelations.employeeId })
      .from(employeeManagerRelations)
      .where(
        and(
          eq(employeeManagerRelations.managerId, workerRow.id),
          eq(employeeManagerRelations.isActive, true)
        )
      );
    directReportIds = reports.map(r => r.employeeId);
  }

  return {
    userId,
    workerId: workerRow?.id,
    department: workerRow?.department ?? undefined,
    companyId: userCompanyId ?? undefined,
    directReportIds,
  };
}

function permSatisfiedByRow(
  row: RolePermRow,
  permission: Permission,
  userScope?: UserScopeInfo,
  ctx?: ScopeContext
): boolean {
  const directCol = PERMISSION_COLUMN[permission];
  const hasDirectFlag = !!(row[directCol as keyof RolePermRow]);

  if (FLAT_PERMISSIONS.includes(permission)) {
    return hasDirectFlag;
  }

  switch (permission) {
    case "view_own":
    case "edit_own": {
      const isView = permission === "view_own";
      const hasFlag = isView
        ? !!(row.canViewOwn || row.canViewSubordinates || row.canViewDepartment || row.canViewCompany)
        : !!(row.canEditOwn || row.canEditSubordinates || row.canEditDepartment || row.canEditCompany);
      if (!hasFlag) return false;
      if (!ctx || !userScope) return hasFlag;
      if (ctx.ownerId) {
        return ctx.ownerId === userScope.workerId || ctx.ownerId === userScope.userId;
      }
      if (ctx.companyId && userScope.companyId) return ctx.companyId === userScope.companyId;
      return hasFlag;
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
        return userScope.directReportIds.includes(ctx.ownerId);
      }
      if (ctx.companyId && userScope.companyId) return ctx.companyId === userScope.companyId;
      return hasFlag;
    }
    case "view_department":
    case "edit_department":
    case "approve_department": {
      const isView = permission === "view_department";
      const isEdit = permission === "edit_department";
      const hasFlag = isView
        ? !!(row.canViewDepartment || row.canViewCompany)
        : isEdit
        ? !!(row.canEditDepartment || row.canEditCompany)
        : !!(row.canApproveDepartment || row.canApproveCompany);
      if (!hasFlag) return false;
      if (!ctx || !userScope) return hasFlag;
      if (ctx.departmentId && userScope.department) {
        return ctx.departmentId === userScope.department;
      }
      if (ctx.companyId && userScope.companyId) return ctx.companyId === userScope.companyId;
      return hasFlag;
    }
    case "view_company":
    case "edit_company":
    case "approve_company": {
      const isView = permission === "view_company";
      const isApprove = permission === "approve_company";
      const hasFlag = isView
        ? !!(row.canViewCompany)
        : isApprove
        ? !!(row.canApproveCompany)
        : !!(row.canEditCompany);
      if (!hasFlag) return false;
      if (!ctx || !userScope) return hasFlag;
      if (ctx.companyId && userScope.companyId) return ctx.companyId === userScope.companyId;
      return hasFlag;
    }
    default:
      return hasDirectFlag;
  }
}

async function checkRolePermissions(
  roleId: string,
  roleName: string,
  resource: string,
  permission: Permission,
  userScope: UserScopeInfo,
  scopeType: string | undefined | null,
  ctx?: ScopeContext
): Promise<AuthorizationResult | null> {
  const rolePerms = await db
    .select()
    .from(rolePermissions)
    .where(
      and(
        eq(rolePermissions.roleId, roleId),
        eq(rolePermissions.resource, resource)
      )
    )
    .limit(1);

  if (rolePerms.length > 0) {
    const row = rolePerms[0];
    if (permSatisfiedByRow(row, permission, userScope, ctx)) {
      return {
        granted: true,
        reason: `Role '${roleName}' grants '${permission}' on '${resource}'`,
        role: roleName,
        scope: scopeType ?? undefined,
      };
    }
  }
  return null;
}

export async function checkPermission(
  userId: string,
  resource: string,
  permission: Permission,
  scopeContext?: ScopeContext
): Promise<AuthorizationResult> {
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (userRows.length === 0) {
    return { granted: false, reason: "User not found" };
  }

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

  if (userRoleRows.length > 0) {
    for (const ur of userRoleRows) {
      const roleRows = await db.select().from(roles).where(eq(roles.id, ur.roleId)).limit(1);
      const roleName = roleRows[0]?.name || ur.roleId;
      const result = await checkRolePermissions(
        ur.roleId, roleName, resource, permission,
        userScope, ur.scopeType, scopeContext
      );
      if (result) return result;
    }
  } else {
    const namedRoleRows = await db.select().from(roles).where(eq(roles.name, systemRole)).limit(1);
    if (namedRoleRows.length > 0) {
      const r = namedRoleRows[0];
      const result = await checkRolePermissions(
        r.id, r.name, resource, permission,
        userScope, "company", scopeContext
      );
      if (result) return result;
    }
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
    if (!result.has(resource)) {
      result.set(resource, { permissions: new Set(), source, scope });
    }
    for (const p of perms) {
      result.get(resource)!.permissions.add(p);
    }
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
    ];
    for (const r of allResources) {
      addPerms(r, allPerms, `system role: ${systemRole}`);
    }
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
    : await (async () => {
        const namedRole = await db.select().from(roles).where(eq(roles.name, systemRole)).limit(1);
        return namedRole.map(r => ({ roleId: r.id, scopeType: "company" as const, scopeId: null }));
      })();

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
    resource,
    permissions: Array.from(permissions),
    source,
    scope,
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
