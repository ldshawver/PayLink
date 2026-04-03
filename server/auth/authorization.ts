import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { users, roles, rolePermissions, userRoles, authorizationAuditLog } from "@shared/schema";

export type Permission = "view" | "create" | "edit" | "delete" | "export" | "approve";

export type AuthorizationResult = {
  granted: boolean;
  reason: string;
  role?: string;
  scope?: string;
};

const PERMISSION_COLUMN: Record<Permission, keyof typeof rolePermissions.$inferSelect> = {
  view: "canView",
  create: "canCreate",
  edit: "canEdit",
  delete: "canDelete",
  export: "canExport",
  approve: "canApprove",
};

const SYSTEM_ROLE_PERMISSIONS: Record<string, Record<string, Permission[]>> = {
  admin: {
    "*": ["view", "create", "edit", "delete", "export", "approve"],
  },
  manager: {
    payroll: ["view"],
    hr: ["view", "edit"],
    employee: ["view", "create", "edit"],
    attendance: ["view", "edit", "approve"],
    schedule: ["view", "create", "edit", "delete"],
    reports: ["view", "export"],
  },
  employee: {
    attendance: ["view"],
    schedule: ["view"],
    "my-profile": ["view", "edit"],
  },
};

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

  // Platform super admin always has access
  if (systemRole === "platform_super_admin") {
    return { granted: true, reason: "Platform super admin", role: systemRole };
  }

  // Check system role shortcut permissions
  const systemRolePerms = SYSTEM_ROLE_PERMISSIONS[systemRole];
  if (systemRolePerms) {
    const allResources = systemRolePerms["*"];
    if (allResources && allResources.includes(permission)) {
      return { granted: true, reason: `System role '${systemRole}' has wildcard access`, role: systemRole };
    }
    const resourcePerms = systemRolePerms[resource];
    if (resourcePerms && resourcePerms.includes(permission)) {
      return { granted: true, reason: `System role '${systemRole}' has '${permission}' on '${resource}'`, role: systemRole };
    }
  }

  // Check database role assignments
  const userRoleRows = await db
    .select({ roleId: userRoles.roleId, scopeType: userRoles.scopeType, scopeId: userRoles.scopeId })
    .from(userRoles)
    .where(eq(userRoles.userId, userId));

  if (userRoleRows.length > 0) {
    for (const ur of userRoleRows) {
      const permColumn = PERMISSION_COLUMN[permission];
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
        const perm = rolePerms[0];
        if (perm[permColumn as keyof typeof perm]) {
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

  if (systemRole === "platform_super_admin" || systemRole === "admin") {
    const allPerms: Permission[] = ["view", "create", "edit", "delete", "export", "approve"];
    const allResources = ["payroll", "hr", "employee", "attendance", "schedule", "reports", "billing", "permissions", "users", "company"];
    for (const r of allResources) {
      addPerms(r, allPerms, `system role: ${systemRole}`);
    }
  } else {
    const systemRolePerms = SYSTEM_ROLE_PERMISSIONS[systemRole];
    if (systemRolePerms) {
      for (const [res, perms] of Object.entries(systemRolePerms)) {
        if (res === "*") {
          const allPerms: Permission[] = ["view", "create", "edit", "delete", "export", "approve"];
          addPerms("*", allPerms, `system role: ${systemRole}`);
        } else {
          addPerms(res, perms as Permission[], `system role: ${systemRole}`);
        }
      }
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
