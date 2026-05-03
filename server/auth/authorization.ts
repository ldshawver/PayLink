import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { users, roles, rolePermissions, userRoles, authorizationAuditLog } from "@shared/schema";

export type Permission =
  | "view" | "create" | "edit" | "delete" | "export" | "approve" | "configure"
  | "view_own" | "edit_own"
  | "view_subordinates" | "edit_subordinates" | "approve_subordinates"
  | "view_department" | "edit_department" | "approve_department"
  | "view_company" | "edit_company" | "approve_company";

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

type RolePermRow = typeof rolePermissions.$inferSelect;

function permSatisfiedByRow(row: RolePermRow, permission: Permission): boolean {
  const directCol = PERMISSION_COLUMN[permission];
  if (row[directCol as keyof RolePermRow]) return true;

  switch (permission) {
    case "view_own":
      return !!(row.canViewSubordinates || row.canViewDepartment || row.canViewCompany);
    case "edit_own":
      return !!(row.canEditSubordinates || row.canEditDepartment || row.canEditCompany);
    case "view_subordinates":
      return !!(row.canViewDepartment || row.canViewCompany);
    case "edit_subordinates":
      return !!(row.canEditDepartment || row.canEditCompany);
    case "approve_subordinates":
      return !!(row.canApproveDepartment || row.canApproveCompany);
    case "view_department":
      return !!(row.canViewCompany);
    case "edit_department":
      return !!(row.canEditCompany);
    case "approve_department":
      return !!(row.canApproveCompany);
    default:
      return false;
  }
}

export async function checkPermission(
  userId: string,
  resource: string,
  permission: Permission,
  _resourceContext?: Record<string, unknown>
): Promise<AuthorizationResult> {
  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (userRows.length === 0) {
    return { granted: false, reason: "User not found" };
  }

  const user = userRows[0];
  const systemRole = user.role || "employee";

  if (systemRole === "platform_super_admin") {
    return { granted: true, reason: "Platform super admin", role: systemRole };
  }

  const userRoleRows = await db
    .select({ roleId: userRoles.roleId, scopeType: userRoles.scopeType, scopeId: userRoles.scopeId })
    .from(userRoles)
    .where(eq(userRoles.userId, userId));

  if (userRoleRows.length > 0) {
    for (const ur of userRoleRows) {
      const rolePerms = await db
        .select()
        .from(rolePermissions)
        .where(
          and(
            eq(rolePermissions.roleId, ur.roleId),
            eq(rolePermissions.resource, resource)
          )
        )
        .limit(1);

      if (rolePerms.length > 0) {
        const row = rolePerms[0];
        if (permSatisfiedByRow(row, permission)) {
          const roleRows = await db.select().from(roles).where(eq(roles.id, ur.roleId)).limit(1);
          const roleName = roleRows[0]?.name || ur.roleId;
          return {
            granted: true,
            reason: `Role '${roleName}' grants '${permission}' on '${resource}'`,
            role: roleName,
            scope: ur.scopeType,
          };
        }
      }
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
  resourceContext?: Record<string, unknown>
): Promise<void> {
  const result = await checkPermission(userId, resource, permission, resourceContext);
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
  }

  const userRoleRows = await db
    .select({ roleId: userRoles.roleId, scopeType: userRoles.scopeType, scopeId: userRoles.scopeId })
    .from(userRoles)
    .where(eq(userRoles.userId, userId));

  for (const ur of userRoleRows) {
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
        addPerms(perm.resource, granted, `role: ${roleName}`, ur.scopeType);
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
