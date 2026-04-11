import { db } from "./db";
import { eq, sql } from "drizzle-orm";
import { companies, workers, timeEntries, schedules, taxesDeductions, users, roles, rolePermissions, userRoles, employeeGroupConfigs, tradeTransactions, permissionGroups, permissions, enterpriseRolePermissions, locations, departments, legalEntities, platformModules } from "@shared/schema";
import bcrypt from "bcrypt";

const PERMISSION_RESOURCES = [
  "dashboard", "companies", "workers", "schedules", "payroll", "timesheets",
  "departments", "branches", "divisions", "positions",
  "policies", "hr", "reports", "timeclock", "settings", "permissions", "system_admin"
];

async function ensureAdminUser() {
  try {
    const existing = await db.select().from(users).where(eq(users.username, "admin"));
    if (existing.length === 0) {
      const initialPassword = process.env.ADMIN_PASSWORD || "admin";
      const hashedPassword = await bcrypt.hash(initialPassword, 10);
      await db.insert(users).values({
        username: "admin",
        password: hashedPassword,
        role: "platform_super_admin",
      });
      if (process.env.ADMIN_PASSWORD) {
        console.log("Platform admin user created with ADMIN_PASSWORD env var and role platform_super_admin");
      } else {
        console.log("Platform admin user created (admin/admin) with role platform_super_admin");
      }
    } else {
      const adminUser = existing[0];
      if (process.env.ADMIN_PASSWORD) {
        const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
        const updates: Record<string, any> = { password: hashedPassword };
        if (adminUser.role === "admin" && !adminUser.companyId) {
          updates.role = "platform_super_admin";
          console.log("Admin user upgraded from 'admin' to 'platform_super_admin' (no company assigned)");
        }
        await db.update(users).set(updates).where(eq(users.username, "admin"));
        console.log("Admin user password reset via ADMIN_PASSWORD env var");
      } else if (process.env.NODE_ENV === "production") {
        console.log("Admin user exists, skipping password reset (production mode)");
      } else {
        const hashedPassword = await bcrypt.hash("admin", 10);
        const updates: Record<string, any> = { password: hashedPassword };
        // Upgrade legacy "admin" role to platform_super_admin if the user has no tenant company
        if (adminUser.role === "admin" && !adminUser.companyId) {
          updates.role = "platform_super_admin";
          console.log("Admin user upgraded from 'admin' to 'platform_super_admin' (no company assigned)");
        }
        await db.update(users).set(updates).where(eq(users.username, "admin"));
        console.log("Admin user password reset to default (dev mode)");
      }
    }
  } catch (e) {
    console.log("Could not ensure admin user (tables may not exist yet)");
  }
}

async function seedTestAccounts() {
  // Only seed test accounts in development
  if (process.env.NODE_ENV === "production") return;
  try {
    const TEST_PASSWORD = "test1234";
    const hashedPw = await bcrypt.hash(TEST_PASSWORD, 10);

    // Platform-scoped test accounts (no companyId)
    const platformTestUsers = [
      { username: "test_platform_sales",          role: "platform_sales" },
      { username: "test_platform_implementation", role: "platform_implementation" },
      { username: "test_platform_support",        role: "platform_support" },
      { username: "test_platform_billing",        role: "platform_billing" },
      { username: "test_platform_auditor",        role: "platform_auditor" },
    ];

    for (const u of platformTestUsers) {
      const exists = await db.select().from(users).where(eq(users.username, u.username));
      if (exists.length === 0) {
        await db.insert(users).values({ username: u.username, password: hashedPw, role: u.role });
        console.log(`Test account created: ${u.username} / ${TEST_PASSWORD} [${u.role}]`);
      }
    }

    // Find or create a dev test tenant company for tenant-scoped accounts
    let testCompany = await db.select().from(companies).where(eq(companies.name, "__dev_test_tenant__"));
    let testCompanyId: string;
    if (testCompany.length === 0) {
      const [c] = await db.insert(companies).values({
        name: "__dev_test_tenant__",
        subscriptionStatus: "trial",
        planName: "basic",
        isDemo: true,
      }).returning();
      testCompanyId = c.id;
      console.log(`Dev test tenant company created (id: ${testCompanyId})`);
    } else {
      testCompanyId = testCompany[0].id;
    }

    // Tenant-scoped test accounts
    const tenantTestUsers = [
      { username: "test_tenant_owner",           role: "tenant_owner" },
      { username: "test_tenant_admin",           role: "tenant_admin" },
      { username: "test_tenant_hr_admin",        role: "tenant_hr_admin" },
      { username: "test_tenant_payroll_admin",   role: "tenant_payroll_admin" },
      { username: "test_tenant_finance_admin",   role: "tenant_finance_admin" },
      { username: "test_tenant_manager",         role: "tenant_manager" },
      { username: "test_tenant_supervisor",      role: "tenant_supervisor" },
      { username: "test_employee",               role: "employee" },
      { username: "test_contractor",             role: "contractor" },
    ];

    for (const u of tenantTestUsers) {
      const exists = await db.select().from(users).where(eq(users.username, u.username));
      if (exists.length === 0) {
        await db.insert(users).values({
          username: u.username,
          password: hashedPw,
          role: u.role,
          companyId: testCompanyId,
        });
        console.log(`Test account created: ${u.username} / ${TEST_PASSWORD} [${u.role}]`);
      }
    }
  } catch (e: any) {
    console.log("Could not seed test accounts:", e?.message || e);
  }
}

async function seedRolesAndPermissions() {
  try {
    const existingRoles = await db.select().from(roles);
    if (existingRoles.length > 0) {
      console.log("Roles already seeded, skipping");
      return;
    }

    const roleDefinitions = [
      { name: "System Administrator", description: "Full access to everything across the entire system", level: 1, isSystem: true },
      { name: "Owner", description: "Company owner with full operational access", level: 1, isSystem: true },
      { name: "HR Manager", description: "Handles employee records and HR compliance", level: 2, isSystem: true },
      { name: "Payroll Manager", description: "Handles payroll processing and tax configuration", level: 2, isSystem: true },
      { name: "Department Manager", description: "Manages employees within their department", level: 3, isSystem: true },
      { name: "Supervisor", description: "Team lead with limited management access", level: 4, isSystem: true },
      { name: "Employee", description: "Self-service access to own data", level: 5, isSystem: true },
      { name: "Contractor", description: "External contractor with limited access", level: 6, isSystem: true },
    ];

    const createdRoles: Record<string, string> = {};
    for (const roleDef of roleDefinitions) {
      const [r] = await db.insert(roles).values(roleDef).returning();
      createdRoles[roleDef.name] = r.id;
    }

    type PermDef = { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport: boolean; canApprove: boolean };
    const full: PermDef = { canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: true, canApprove: true };
    const viewOnly: PermDef = { canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false, canApprove: false };
    const viewExport: PermDef = { canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true, canApprove: false };
    const none: PermDef = { canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false, canApprove: false };

    const permissionMatrix: Record<string, Record<string, PermDef>> = {
      "System Administrator": Object.fromEntries(PERMISSION_RESOURCES.map(r => [r, full])),
      "HR Manager": {
        dashboard: viewOnly,
        companies: viewOnly,
        workers: full,
        schedules: viewOnly,
        payroll: viewOnly,
        timesheets: viewOnly,
        departments: viewOnly,
        branches: viewOnly,
        divisions: viewOnly,
        positions: viewOnly,
        policies: viewOnly,
        hr: full,
        reports: viewExport,
        timeclock: viewOnly,
        settings: none,
        permissions: none,
        system_admin: none,
      },
      "Payroll Manager": {
        dashboard: viewOnly,
        companies: viewOnly,
        workers: viewOnly,
        schedules: viewOnly,
        payroll: full,
        timesheets: { canView: true, canCreate: false, canEdit: true, canDelete: false, canExport: true, canApprove: true },
        departments: viewOnly,
        branches: viewOnly,
        divisions: viewOnly,
        positions: viewOnly,
        policies: viewOnly,
        hr: viewOnly,
        reports: viewExport,
        timeclock: viewOnly,
        settings: { canView: true, canCreate: false, canEdit: true, canDelete: false, canExport: false, canApprove: false },
        permissions: none,
        system_admin: none,
      },
      "Department Manager": {
        dashboard: viewOnly,
        companies: viewOnly,
        workers: { canView: true, canCreate: false, canEdit: true, canDelete: false, canExport: false, canApprove: false },
        schedules: { canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false, canApprove: true },
        payroll: viewOnly,
        timesheets: { canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false, canApprove: true },
        departments: viewOnly,
        branches: viewOnly,
        divisions: viewOnly,
        positions: viewOnly,
        policies: viewOnly,
        hr: viewOnly,
        reports: { canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true, canApprove: false },
        timeclock: viewOnly,
        settings: none,
        permissions: none,
        system_admin: none,
      },
      "Owner": Object.fromEntries(PERMISSION_RESOURCES.map(r => [r, r === "system_admin" ? none : full])),
      "Supervisor": {
        dashboard: viewOnly,
        companies: viewOnly,
        workers: { canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false, canApprove: false },
        schedules: { canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false, canApprove: true },
        payroll: viewOnly,
        timesheets: { canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false, canApprove: true },
        departments: viewOnly,
        branches: viewOnly,
        divisions: viewOnly,
        positions: viewOnly,
        policies: viewOnly,
        hr: viewOnly,
        reports: viewOnly,
        timeclock: { canView: true, canCreate: true, canEdit: false, canDelete: false, canExport: false, canApprove: false },
        settings: none,
        permissions: none,
        system_admin: none,
      },
      "Employee": {
        dashboard: viewOnly,
        companies: none,
        workers: none,
        schedules: viewOnly,
        payroll: viewOnly,
        timesheets: viewOnly,
        departments: none,
        branches: none,
        divisions: none,
        positions: none,
        policies: viewOnly,
        hr: none,
        reports: viewOnly,
        timeclock: { canView: true, canCreate: true, canEdit: false, canDelete: false, canExport: false, canApprove: false },
        settings: none,
        permissions: none,
        system_admin: none,
      },
      "Contractor": {
        dashboard: viewOnly,
        companies: none,
        workers: none,
        schedules: viewOnly,
        payroll: viewOnly,
        timesheets: viewOnly,
        departments: none,
        branches: none,
        divisions: none,
        positions: none,
        policies: none,
        hr: none,
        reports: none,
        timeclock: { canView: true, canCreate: true, canEdit: false, canDelete: false, canExport: false, canApprove: false },
        settings: none,
        permissions: none,
        system_admin: none,
      },
    };

    for (const roleName of Object.keys(createdRoles)) {
      const roleId = createdRoles[roleName];
      const rolePerms = permissionMatrix[roleName];
      for (const resource of PERMISSION_RESOURCES) {
        const perms = rolePerms[resource] || none;
        await db.insert(rolePermissions).values({
          roleId,
          resource,
          ...perms,
        });
      }
    }

    const adminUser = await db.select().from(users).where(eq(users.username, "admin"));
    if (adminUser.length > 0 && createdRoles["System Administrator"]) {
      await db.insert(userRoles).values({
        userId: adminUser[0].id,
        roleId: createdRoles["System Administrator"],
        scopeType: "enterprise",
        scopeId: null,
      });
    }

    console.log("Default roles, permissions, and admin assignment seeded");
  } catch (e: any) {
    console.log("Could not seed roles:", e?.message || e);
  }
}

async function seedExpenseCategories() {
  try {
    const existing = await db.execute(sql`SELECT COUNT(*) as cnt FROM expense_categories`);
    if (Number((existing.rows[0] as any).cnt) > 0) {
      console.log("Expense categories already seeded, skipping");
      return;
    }
  } catch { return; }

  const cats = [
    { name: "Office Supplies", accountingCode: "6100", reimbursableDefault: true, receiptRequired: true },
    { name: "Materials", accountingCode: "5100", reimbursableDefault: true, receiptRequired: true },
    { name: "Tools & Equipment", accountingCode: "5200", reimbursableDefault: true, receiptRequired: true, preapprovalRequired: true },
    { name: "Travel", accountingCode: "6200", reimbursableDefault: true, receiptRequired: true },
    { name: "Lodging", accountingCode: "6210", reimbursableDefault: true, receiptRequired: true },
    { name: "Meals", accountingCode: "6220", reimbursableDefault: true, receiptRequired: true },
    { name: "Mileage", accountingCode: "6230", reimbursableDefault: true, receiptRequired: false },
    { name: "Fuel", accountingCode: "6240", reimbursableDefault: true, receiptRequired: true },
    { name: "Software & Subscriptions", accountingCode: "6300", reimbursableDefault: false, receiptRequired: true, preapprovalRequired: true },
    { name: "Marketing & Advertising", accountingCode: "6400", reimbursableDefault: false, receiptRequired: true, preapprovalRequired: true },
    { name: "Professional Services", accountingCode: "6500", reimbursableDefault: false, receiptRequired: true, preapprovalRequired: true },
    { name: "Permits & Fees", accountingCode: "6600", reimbursableDefault: false, receiptRequired: true },
    { name: "Shipping & Postage", accountingCode: "6700", reimbursableDefault: true, receiptRequired: true },
    { name: "Utilities", accountingCode: "6800", reimbursableDefault: false, receiptRequired: true },
    { name: "Phone & Internet", accountingCode: "6810", reimbursableDefault: false, receiptRequired: true },
    { name: "Training & Education", accountingCode: "6900", reimbursableDefault: true, receiptRequired: true, preapprovalRequired: true },
    { name: "Client Expense", accountingCode: "7100", reimbursableDefault: true, receiptRequired: true, projectRequired: true },
    { name: "Project Expense", accountingCode: "7200", reimbursableDefault: false, receiptRequired: true, projectRequired: true },
    { name: "Repair & Maintenance", accountingCode: "7300", reimbursableDefault: false, receiptRequired: true },
    { name: "Other", accountingCode: "9900", reimbursableDefault: false, receiptRequired: false },
  ];

  for (let i = 0; i < cats.length; i++) {
    const c = cats[i];
    await db.execute(sql`INSERT INTO expense_categories (name, accounting_code, reimbursable_default, receipt_required, preapproval_required, project_required, sort_order) VALUES (${c.name}, ${c.accountingCode}, ${c.reimbursableDefault}, ${c.receiptRequired}, ${c.preapprovalRequired || false}, ${c.projectRequired || false}, ${i + 1})`);
  }
  console.log("Seeded expense categories");
}

async function seedEnterprisePermissions() {
  try {
    const existing = await db.select().from(permissionGroups);
    if (existing.length > 0) {
      console.log("Enterprise permission groups already seeded, skipping");
      return;
    }
  } catch { return; }

  const PERMISSION_GROUP_DEFS = [
    { name: "Platform Administration", module: "platform", description: "System-wide platform configuration and administration", displayOrder: 1 },
    { name: "Tenant Management", module: "tenant", description: "Enterprise and company provisioning, billing, and lifecycle", displayOrder: 2 },
    { name: "Organization Structure", module: "org", description: "Manage hierarchy: enterprises, companies, legal entities, locations, departments, teams", displayOrder: 3 },
    { name: "Workforce Management", module: "workforce", description: "Employee records, onboarding, terminations, and HR operations", displayOrder: 4 },
    { name: "Time & Attendance", module: "time", description: "Time tracking, punches, timesheets, and schedules", displayOrder: 5 },
    { name: "Payroll Processing", module: "payroll", description: "Payroll runs, pay items, deductions, and disbursements", displayOrder: 6 },
    { name: "Compensation & Benefits", module: "compensation", description: "Pay rates, wage history, benefits, and accruals", displayOrder: 7 },
    { name: "Compliance & Documents", module: "compliance", description: "Document management, retention policies, e-signatures, and audits", displayOrder: 8 },
    { name: "Reporting & Analytics", module: "reporting", description: "Reports, dashboards, exports, and data analytics", displayOrder: 9 },
    { name: "Access & Permissions", module: "access", description: "Role assignments, permission overrides, and user company access", displayOrder: 10 },
    { name: "Billing & Subscriptions", module: "billing", description: "Subscription plans, payment methods, and invoicing", displayOrder: 11 },
    { name: "Integrations & API", module: "integrations", description: "Third-party integrations, webhooks, and API key management", displayOrder: 12 },
    { name: "Support & Impersonation", module: "support", description: "Customer support tools, audit logs, and impersonation", displayOrder: 13 },
    { name: "Employee Self-Service", module: "self_service", description: "Employee-facing self-service: own profile, pay stubs, time off", displayOrder: 14 },
  ];

  // Build module lookup map (key → id) for FK linking
  const moduleRows = await db.select().from(platformModules);
  const moduleIdMap: Record<string, string> = {};
  for (const m of moduleRows) {
    moduleIdMap[m.key] = m.id;
  }

  const groupMap: Record<string, string> = {};
  for (const g of PERMISSION_GROUP_DEFS) {
    const [pg] = await db.insert(permissionGroups).values({
      ...g,
      moduleId: moduleIdMap[g.module] || null,
    }).returning();
    groupMap[g.module] = pg.id;
  }

  const PERMISSION_DEFS = [
    // Platform Administration
    { module: "platform", name: "View Platform Settings", code: "platform.settings.view", scope: "entire_tenant" as const, isCustomerFacing: false },
    { module: "platform", name: "Edit Platform Settings", code: "platform.settings.edit", scope: "entire_tenant" as const, isCustomerFacing: false },
    { module: "platform", name: "Manage System Users", code: "platform.users.manage", scope: "entire_tenant" as const, isCustomerFacing: false },
    { module: "platform", name: "View Audit Logs", code: "platform.audit.view", scope: "entire_tenant" as const, isCustomerFacing: false },
    // Tenant Management
    { module: "tenant", name: "Create Tenant", code: "tenant.create", scope: "entire_tenant" as const, isCustomerFacing: false },
    { module: "tenant", name: "Suspend Tenant", code: "tenant.suspend", scope: "entire_tenant" as const, isCustomerFacing: false },
    { module: "tenant", name: "Delete Tenant", code: "tenant.delete", scope: "entire_tenant" as const, isCustomerFacing: false },
    { module: "tenant", name: "View All Tenants", code: "tenant.view_all", scope: "entire_tenant" as const, isCustomerFacing: false },
    { module: "tenant", name: "Manage Tenant Billing", code: "tenant.billing.manage", scope: "entire_tenant" as const, isCustomerFacing: false },
    // Organization Structure
    { module: "org", name: "View Organization", code: "org.view", scope: "entire_tenant" as const, isCustomerFacing: true },
    { module: "org", name: "Manage Locations", code: "org.locations.manage", scope: "entire_tenant" as const, isCustomerFacing: true },
    { module: "org", name: "Manage Departments", code: "org.departments.manage", scope: "legal_entity" as const, isCustomerFacing: true },
    { module: "org", name: "Manage Teams", code: "org.teams.manage", scope: "department" as const, isCustomerFacing: true },
    { module: "org", name: "Manage Positions", code: "org.positions.manage", scope: "legal_entity" as const, isCustomerFacing: true },
    // Workforce Management
    { module: "workforce", name: "View All Employees", code: "workforce.employees.view_all", scope: "entire_tenant" as const, isCustomerFacing: true },
    { module: "workforce", name: "View Department Employees", code: "workforce.employees.view_dept", scope: "department" as const, isCustomerFacing: true },
    { module: "workforce", name: "View Direct Reports", code: "workforce.employees.view_direct", scope: "direct_reports" as const, isCustomerFacing: true },
    { module: "workforce", name: "View Own Profile", code: "workforce.employees.view_self", scope: "self" as const, isCustomerFacing: true },
    { module: "workforce", name: "Create Employee", code: "workforce.employees.create", scope: "entire_tenant" as const, isCustomerFacing: true },
    { module: "workforce", name: "Edit Employee", code: "workforce.employees.edit", scope: "department" as const, isCustomerFacing: true },
    { module: "workforce", name: "Terminate Employee", code: "workforce.employees.terminate", scope: "legal_entity" as const, isCustomerFacing: true },
    { module: "workforce", name: "Manage Manager Relations", code: "workforce.managers.manage", scope: "department" as const, isCustomerFacing: true },
    // Time & Attendance
    { module: "time", name: "View Own Timesheets", code: "time.timesheets.view_self", scope: "self" as const, isCustomerFacing: true },
    { module: "time", name: "View Direct Report Timesheets", code: "time.timesheets.view_direct", scope: "direct_reports" as const, isCustomerFacing: true },
    { module: "time", name: "View All Timesheets", code: "time.timesheets.view_all", scope: "entire_tenant" as const, isCustomerFacing: true },
    { module: "time", name: "Approve Timesheets", code: "time.timesheets.approve", scope: "direct_reports" as const, isCustomerFacing: true },
    { module: "time", name: "Manage Schedules", code: "time.schedules.manage", scope: "department" as const, isCustomerFacing: true },
    { module: "time", name: "Override Punch", code: "time.punch.override", scope: "direct_reports" as const, isCustomerFacing: true },
    // Payroll Processing
    { module: "payroll", name: "View Own Pay Stubs", code: "payroll.paystubs.view_self", scope: "self" as const, isCustomerFacing: true },
    { module: "payroll", name: "Run Payroll", code: "payroll.run", scope: "legal_entity" as const, isCustomerFacing: true },
    { module: "payroll", name: "Approve Payroll", code: "payroll.approve", scope: "entire_tenant" as const, isCustomerFacing: true },
    { module: "payroll", name: "View All Payroll", code: "payroll.view_all", scope: "entire_tenant" as const, isCustomerFacing: true },
    { module: "payroll", name: "Manage Tax Deductions", code: "payroll.taxes.manage", scope: "legal_entity" as const, isCustomerFacing: true },
    // Compensation & Benefits
    { module: "compensation", name: "View Own Compensation", code: "compensation.view_self", scope: "self" as const, isCustomerFacing: true },
    { module: "compensation", name: "View Direct Report Compensation", code: "compensation.view_direct", scope: "direct_reports" as const, isCustomerFacing: true },
    { module: "compensation", name: "View All Compensation", code: "compensation.view_all", scope: "entire_tenant" as const, isCustomerFacing: true },
    { module: "compensation", name: "Edit Compensation", code: "compensation.edit", scope: "legal_entity" as const, isCustomerFacing: true },
    { module: "compensation", name: "Manage Benefits", code: "compensation.benefits.manage", scope: "legal_entity" as const, isCustomerFacing: true },
    // Compliance & Documents
    { module: "compliance", name: "View Own Documents", code: "compliance.documents.view_self", scope: "self" as const, isCustomerFacing: true },
    { module: "compliance", name: "View All Documents", code: "compliance.documents.view_all", scope: "entire_tenant" as const, isCustomerFacing: true },
    { module: "compliance", name: "Manage Documents", code: "compliance.documents.manage", scope: "legal_entity" as const, isCustomerFacing: true },
    { module: "compliance", name: "Manage Retention Policies", code: "compliance.retention.manage", scope: "entire_tenant" as const, isCustomerFacing: false },
    { module: "compliance", name: "Send for E-Signature", code: "compliance.esign.send", scope: "department" as const, isCustomerFacing: true },
    // Reporting & Analytics
    { module: "reporting", name: "View Standard Reports", code: "reporting.standard.view", scope: "department" as const, isCustomerFacing: true },
    { module: "reporting", name: "View All Reports", code: "reporting.all.view", scope: "entire_tenant" as const, isCustomerFacing: true },
    { module: "reporting", name: "Export Reports", code: "reporting.export", scope: "legal_entity" as const, isCustomerFacing: true },
    { module: "reporting", name: "Create Custom Reports", code: "reporting.custom.create", scope: "entire_tenant" as const, isCustomerFacing: true },
    // Access & Permissions
    { module: "access", name: "View Role Assignments", code: "access.roles.view", scope: "entire_tenant" as const, isCustomerFacing: true },
    { module: "access", name: "Assign Roles", code: "access.roles.assign", scope: "legal_entity" as const, isCustomerFacing: true },
    { module: "access", name: "Create Custom Roles", code: "access.roles.create", scope: "entire_tenant" as const, isCustomerFacing: false },
    { module: "access", name: "Grant Permission Overrides", code: "access.overrides.grant", scope: "entire_tenant" as const, isCustomerFacing: false },
    // Billing & Subscriptions
    { module: "billing", name: "View Own Invoices", code: "billing.invoices.view_self", scope: "self" as const, isCustomerFacing: true },
    { module: "billing", name: "Manage Billing", code: "billing.manage", scope: "entire_tenant" as const, isCustomerFacing: true },
    { module: "billing", name: "View All Billing", code: "billing.view_all", scope: "entire_tenant" as const, isCustomerFacing: false },
    { module: "billing", name: "Adjust Subscription", code: "billing.subscription.adjust", scope: "entire_tenant" as const, isCustomerFacing: false },
    // Integrations & API
    { module: "integrations", name: "View Integrations", code: "integrations.view", scope: "entire_tenant" as const, isCustomerFacing: true },
    { module: "integrations", name: "Manage Integrations", code: "integrations.manage", scope: "entire_tenant" as const, isCustomerFacing: true },
    { module: "integrations", name: "Manage API Keys", code: "integrations.api_keys.manage", scope: "entire_tenant" as const, isCustomerFacing: true },
    { module: "integrations", name: "View Webhooks", code: "integrations.webhooks.view", scope: "entire_tenant" as const, isCustomerFacing: true },
    // Support & Impersonation
    { module: "support", name: "View Support Tickets", code: "support.tickets.view", scope: "entire_tenant" as const, isCustomerFacing: false },
    { module: "support", name: "Impersonate User", code: "support.impersonate", scope: "entire_tenant" as const, isCustomerFacing: false },
    { module: "support", name: "View System Audit Logs", code: "support.audit.view", scope: "entire_tenant" as const, isCustomerFacing: false },
    { module: "support", name: "Access Admin Tools", code: "support.admin_tools.access", scope: "entire_tenant" as const, isCustomerFacing: false },
    // Employee Self-Service
    { module: "self_service", name: "View Own Profile", code: "self_service.profile.view", scope: "self" as const, isCustomerFacing: true },
    { module: "self_service", name: "Edit Own Profile", code: "self_service.profile.edit", scope: "self" as const, isCustomerFacing: true },
    { module: "self_service", name: "View Own Schedule", code: "self_service.schedule.view", scope: "self" as const, isCustomerFacing: true },
    { module: "self_service", name: "Submit Time Off Request", code: "self_service.time_off.request", scope: "self" as const, isCustomerFacing: true },
    { module: "self_service", name: "View Own Pay Stubs", code: "self_service.pay_stubs.view", scope: "self" as const, isCustomerFacing: true },
    { module: "self_service", name: "View Own Documents", code: "self_service.documents.view", scope: "self" as const, isCustomerFacing: true },
  ];

  const permMap: Record<string, string> = {};
  for (const p of PERMISSION_DEFS) {
    const [perm] = await db.insert(permissions).values({
      permissionGroupId: groupMap[p.module],
      moduleId: moduleIdMap[p.module] || null,
      name: p.name,
      code: p.code,
      scope: p.scope,
      isCustomerFacing: p.isCustomerFacing,
    }).returning();
    permMap[p.code] = perm.id;
  }

  const allRoles = await db.select().from(roles);
  const roleMap: Record<string, string> = {};
  for (const r of allRoles) {
    roleMap[r.name] = r.id;
  }

  const ENTERPRISE_ROLES: { name: string; description: string; level: number }[] = [
    { name: "Platform Super Admin", description: "Unrestricted access to entire platform across all tenants", level: 0 },
    { name: "Platform Operations", description: "Operational access for platform team: provisioning, support, monitoring", level: 0 },
    { name: "Enterprise Admin", description: "Full access within their enterprise across all companies", level: 1 },
    { name: "Enterprise HR Director", description: "HR oversight across all entities within the enterprise", level: 1 },
    { name: "Company Admin", description: "Full access within a single company", level: 2 },
    { name: "Company HR Manager", description: "Manages employee records and HR operations for a company", level: 2 },
    { name: "Payroll Manager", description: "Processes and approves payroll for a company", level: 2 },
    { name: "Department Manager", description: "Manages employees and scheduling within a department", level: 3 },
    { name: "Team Lead", description: "Limited management scope over a direct team", level: 4 },
    { name: "Employee", description: "Standard self-service employee access", level: 5 },
    { name: "Contractor", description: "External contractor with minimal access", level: 6 },
    { name: "Support Agent", description: "Customer support read-only access", level: 0 },
  ];

  for (const rd of ENTERPRISE_ROLES) {
    if (!roleMap[rd.name]) {
      const [r] = await db.insert(roles).values({ ...rd, isSystem: true }).returning();
      roleMap[rd.name] = r.id;
    }
  }

  const ROLE_PERMISSION_MATRIX: Record<string, string[]> = {
    "Platform Super Admin": Object.keys(permMap),
    "Platform Operations": [
      "platform.settings.view", "platform.audit.view", "platform.users.manage",
      "tenant.view_all", "tenant.suspend",
      "support.tickets.view", "support.impersonate", "support.audit.view", "support.admin_tools.access",
      "org.view", "workforce.employees.view_all",
      "reporting.all.view", "reporting.export",
    ],
    "Enterprise Admin": [
      "org.view", "org.locations.manage", "org.departments.manage", "org.teams.manage", "org.positions.manage",
      "workforce.employees.view_all", "workforce.employees.create", "workforce.employees.edit", "workforce.employees.terminate", "workforce.managers.manage",
      "time.timesheets.view_all", "time.timesheets.approve", "time.schedules.manage", "time.punch.override",
      "payroll.view_all", "payroll.run", "payroll.approve", "payroll.taxes.manage",
      "compensation.view_all", "compensation.edit", "compensation.benefits.manage",
      "compliance.documents.view_all", "compliance.documents.manage", "compliance.esign.send",
      "reporting.all.view", "reporting.export", "reporting.custom.create",
      "access.roles.view", "access.roles.assign", "access.roles.create",
      "billing.view_all", "billing.manage",
      "integrations.view", "integrations.manage", "integrations.api_keys.manage", "integrations.webhooks.view",
    ],
    "Enterprise HR Director": [
      "org.view", "org.departments.manage", "org.positions.manage",
      "workforce.employees.view_all", "workforce.employees.create", "workforce.employees.edit", "workforce.employees.terminate", "workforce.managers.manage",
      "compensation.view_all", "compensation.edit", "compensation.benefits.manage",
      "compliance.documents.view_all", "compliance.documents.manage", "compliance.esign.send", "compliance.retention.manage",
      "reporting.all.view", "reporting.export",
      "access.roles.view",
    ],
    "Company Admin": [
      "org.view", "org.locations.manage", "org.departments.manage", "org.teams.manage", "org.positions.manage",
      "workforce.employees.view_all", "workforce.employees.create", "workforce.employees.edit", "workforce.employees.terminate", "workforce.managers.manage",
      "time.timesheets.view_all", "time.timesheets.approve", "time.schedules.manage", "time.punch.override",
      "payroll.view_all", "payroll.run", "payroll.approve", "payroll.taxes.manage",
      "compensation.view_all", "compensation.edit", "compensation.benefits.manage",
      "compliance.documents.view_all", "compliance.documents.manage", "compliance.esign.send",
      "reporting.all.view", "reporting.export", "reporting.custom.create",
      "access.roles.view", "access.roles.assign",
      "billing.manage",
      "integrations.view", "integrations.manage", "integrations.api_keys.manage",
    ],
    "Company HR Manager": [
      "org.view", "org.departments.manage",
      "workforce.employees.view_all", "workforce.employees.create", "workforce.employees.edit", "workforce.employees.terminate", "workforce.managers.manage",
      "compensation.view_all", "compensation.edit", "compensation.benefits.manage",
      "compliance.documents.view_all", "compliance.documents.manage", "compliance.esign.send",
      "reporting.standard.view", "reporting.export",
      "access.roles.view",
      "self_service.profile.view", "self_service.profile.edit", "self_service.schedule.view", "self_service.time_off.request", "self_service.pay_stubs.view", "self_service.documents.view",
    ],
    "Payroll Manager": [
      "org.view",
      "workforce.employees.view_all",
      "time.timesheets.view_all", "time.timesheets.approve",
      "payroll.view_all", "payroll.run", "payroll.approve", "payroll.taxes.manage",
      "compensation.view_all",
      "reporting.standard.view", "reporting.export",
      "self_service.pay_stubs.view",
    ],
    "Department Manager": [
      "org.view",
      "workforce.employees.view_dept", "workforce.employees.view_direct", "workforce.employees.edit", "workforce.managers.manage",
      "time.timesheets.view_direct", "time.timesheets.approve", "time.schedules.manage", "time.punch.override",
      "payroll.paystubs.view_self",
      "compensation.view_direct",
      "compliance.esign.send",
      "reporting.standard.view",
      "self_service.profile.view", "self_service.profile.edit", "self_service.schedule.view", "self_service.time_off.request", "self_service.pay_stubs.view", "self_service.documents.view",
    ],
    "Team Lead": [
      "org.view",
      "workforce.employees.view_direct",
      "time.timesheets.view_direct", "time.timesheets.approve", "time.schedules.manage",
      "self_service.profile.view", "self_service.profile.edit", "self_service.schedule.view", "self_service.time_off.request", "self_service.pay_stubs.view", "self_service.documents.view",
    ],
    "Employee": [
      "workforce.employees.view_self",
      "self_service.profile.view", "self_service.profile.edit", "self_service.schedule.view", "self_service.time_off.request", "self_service.pay_stubs.view", "self_service.documents.view",
    ],
    "Contractor": [
      "self_service.profile.view", "self_service.schedule.view", "self_service.pay_stubs.view",
    ],
    "Support Agent": [
      "platform.audit.view",
      "tenant.view_all",
      "org.view",
      "workforce.employees.view_all",
      "support.tickets.view", "support.audit.view",
    ],
  };

  for (const [roleName, permCodes] of Object.entries(ROLE_PERMISSION_MATRIX)) {
    const roleId = roleMap[roleName];
    if (!roleId) continue;
    for (const code of permCodes) {
      const permId = permMap[code];
      if (!permId) continue;
      const perm = PERMISSION_DEFS.find(p => p.code === code);
      await db.insert(enterpriseRolePermissions).values({
        roleId,
        permissionId: permId,
        scope: perm?.scope || "self",
        isGranted: true,
      }).onConflictDoNothing();
    }
  }

  console.log("Enterprise permission system seeded: 14 permission groups, permissions, and role mappings");
}

async function seedPlatformModules() {
  try {
    const existing = await db.select().from(platformModules);
    if (existing.length > 0) {
      console.log("Platform modules already seeded, skipping");
      return;
    }
  } catch { return; }

  const MODULE_DEFS = [
    { key: "platform", name: "Platform Administration", description: "System-wide platform configuration and administration", isCoreModule: true, displayOrder: 1 },
    { key: "tenant", name: "Tenant Management", description: "Enterprise and company provisioning, billing, and lifecycle", isCoreModule: true, displayOrder: 2 },
    { key: "org", name: "Organization Structure", description: "Manage hierarchy: enterprises, companies, legal entities, locations, departments, teams", isCoreModule: true, displayOrder: 3 },
    { key: "workforce", name: "Workforce Management", description: "Employee records, onboarding, terminations, and HR operations", isCoreModule: true, displayOrder: 4 },
    { key: "time", name: "Time & Attendance", description: "Time tracking, punches, timesheets, and schedules", isCoreModule: false, displayOrder: 5 },
    { key: "payroll", name: "Payroll Processing", description: "Payroll runs, pay items, deductions, and disbursements", isCoreModule: false, displayOrder: 6 },
    { key: "compensation", name: "Compensation & Benefits", description: "Pay rates, wage history, benefits, and accruals", isCoreModule: false, displayOrder: 7 },
    { key: "compliance", name: "Compliance & Documents", description: "Document management, retention policies, e-signatures, and audits", isCoreModule: false, displayOrder: 8 },
    { key: "reporting", name: "Reporting & Analytics", description: "Reports, dashboards, exports, and data analytics", isCoreModule: false, displayOrder: 9 },
    { key: "access", name: "Access & Permissions", description: "Role assignments, permission overrides, and user company access", isCoreModule: true, displayOrder: 10 },
    { key: "billing", name: "Billing & Subscriptions", description: "Subscription plans, payment methods, and invoicing", isCoreModule: false, displayOrder: 11 },
    { key: "integrations", name: "Integrations & API", description: "Third-party integrations, webhooks, and API key management", isCoreModule: false, displayOrder: 12 },
    { key: "support", name: "Support & Impersonation", description: "Customer support tools, audit logs, and impersonation", isCoreModule: false, displayOrder: 13 },
    { key: "self_service", name: "Employee Self-Service", description: "Employee-facing self-service: own profile, pay stubs, time off", isCoreModule: true, displayOrder: 14 },
  ];

  for (const m of MODULE_DEFS) {
    await db.insert(platformModules).values(m);
  }
  console.log(`Seeded ${MODULE_DEFS.length} platform modules`);
}

async function seedDemoHierarchy() {
  try {
    const existingLocations = await db.select().from(locations);
    if (existingLocations.length > 0) {
      console.log("Demo hierarchy already seeded, skipping");
      return;
    }
  } catch { return; }

  try {
    // Ensure at least one company exists; create a demo one if not
    let existingCompanies = await db.select().from(companies);
    let company = existingCompanies[0];
    if (!company) {
      const [c] = await db.insert(companies).values({
        name: "Demo Corp",
        legalName: "Demo Corp LLC",
        ein: "00-0000001",
        entityType: "llc",
        address: "100 Demo Way",
        city: "Austin",
        state: "TX",
        zip: "78701",
        phone: "(512) 555-0001",
        payFrequency: "biweekly",
        overtimeThreshold: 40,
        overtimeMultiplier: "1.5",
      }).returning();
      company = c;
      console.log("Created demo company for hierarchy seeding");
    }

    // Create a legal entity for the company
    let legalEntityId: string | undefined;
    try {
      const [le] = await db.insert(legalEntities).values({
        companyId: company.id,
        legalName: `${company.legalName || company.name}`,
        type: "llc",
        status: "active",
        address: company.address || "100 Demo Way",
        city: company.city || "Austin",
        state: company.state || "TX",
        zip: company.zip || "78701",
        country: "US",
      }).returning();
      legalEntityId = le.id;
      console.log("Created demo legal entity");
    } catch (e: any) {
      console.log("Could not create legal entity:", e?.message?.substring(0, 80));
    }

    // Create sample departments
    const [deptHQ, deptEng] = await db.insert(departments).values([
      { companyId: company.id, name: "Headquarters", code: "HQ", isActive: true },
      { companyId: company.id, name: "Engineering", code: "ENG", isActive: true },
    ]).returning();

    // Create sample locations linked to legal entity
    await db.insert(locations).values([
      {
        companyId: company.id,
        legalEntityId: legalEntityId,
        name: "Headquarters",
        code: "HQ",
        address: "123 Main Street",
        city: "Austin",
        state: "TX",
        zip: "78701",
        country: "US",
        timezone: "America/Chicago",
      },
      {
        companyId: company.id,
        legalEntityId: legalEntityId,
        name: "West Office",
        code: "WEST",
        address: "789 Sunset Blvd",
        city: "Los Angeles",
        state: "CA",
        zip: "90028",
        country: "US",
        timezone: "America/Los_Angeles",
      },
    ]);

    console.log("Demo hierarchy seeded: company + legal entity + 2 departments + 2 locations");
  } catch (e: any) {
    console.log("Could not seed demo hierarchy:", e?.message || e);
  }
}

export async function seedDatabase() {
  await ensureAdminUser();
  await seedRolesAndPermissions();
  await seedExpenseCategories();
  await seedPlatformModules();
  await seedEnterprisePermissions();
  await seedTestAccounts();

  try {
    const existingCompanies = await db.select().from(companies);
    if (existingCompanies.length > 0) {
      // Companies already exist — still seed hierarchy (idempotent)
      await seedDemoHierarchy();
      return;
    }
  } catch (e) {
    console.log("Tables may not exist yet, will try to seed anyway");
  }

  const [company1] = await db.insert(companies).values({
    name: "Greenfield Solutions",
    legalName: "Greenfield Solutions LLC",
    ein: "12-3456789",
    entityType: "llc",
    address: "123 Main Street",
    city: "Austin",
    state: "TX",
    zip: "78701",
    phone: "(512) 555-0100",
    payFrequency: "biweekly",
    overtimeThreshold: 40,
    overtimeMultiplier: "1.5",
  }).returning();

  const [company2] = await db.insert(companies).values({
    name: "Helping Hands Foundation",
    legalName: "Helping Hands Foundation Inc.",
    ein: "98-7654321",
    entityType: "nonprofit_501c3",
    address: "456 Oak Avenue",
    city: "Denver",
    state: "CO",
    zip: "80202",
    phone: "(303) 555-0200",
    payFrequency: "semimonthly",
    overtimeThreshold: 40,
    overtimeMultiplier: "1.5",
  }).returning();

  const workerData = [
    {
      companyId: company1.id,
      firstName: "Sarah",
      lastName: "Mitchell",
      email: "sarah.mitchell@greenfield.com",
      phone: "(512) 555-0101",
      workerType: "employee" as const,
      jobTitle: "Senior Developer",
      department: "Engineering",
      payRate: "52.00",
      payType: "hourly",
      hireDate: "2023-03-15",
      isActive: true,
      employeeNumber: "1001",
      pin: "1234",
    },
    {
      companyId: company1.id,
      firstName: "James",
      lastName: "Rodriguez",
      email: "james.r@greenfield.com",
      phone: "(512) 555-0102",
      workerType: "employee" as const,
      jobTitle: "Project Manager",
      department: "Operations",
      payRate: "95000.00",
      payType: "salary",
      hireDate: "2022-08-01",
      isActive: true,
      employeeNumber: "1002",
      pin: "5678",
    },
    {
      companyId: company1.id,
      firstName: "Emily",
      lastName: "Chen",
      email: "emily.chen@freelance.com",
      phone: "(512) 555-0103",
      workerType: "contractor" as const,
      jobTitle: "UX Designer",
      department: "Design",
      payRate: "75.00",
      payType: "hourly",
      hireDate: "2024-01-10",
      isActive: true,
      employeeNumber: "1003",
      pin: "9012",
    },
    {
      companyId: company2.id,
      firstName: "Michael",
      lastName: "Thompson",
      email: "m.thompson@helpinghands.org",
      phone: "(303) 555-0201",
      workerType: "employee" as const,
      jobTitle: "Program Director",
      department: "Programs",
      payRate: "68000.00",
      payType: "salary",
      hireDate: "2021-06-01",
      isActive: true,
      employeeNumber: "2001",
      pin: "1111",
    },
    {
      companyId: company2.id,
      firstName: "Lisa",
      lastName: "Wang",
      email: "l.wang@helpinghands.org",
      phone: "(303) 555-0202",
      workerType: "employee" as const,
      jobTitle: "Office Administrator",
      department: "Admin",
      payRate: "24.50",
      payType: "hourly",
      hireDate: "2023-11-15",
      isActive: true,
      employeeNumber: "2002",
      pin: "2222",
    },
  ];

  const insertedWorkers = await db.insert(workers).values(workerData).returning();

  const today = new Date();
  const yesterdayDate = new Date(today);
  yesterdayDate.setDate(today.getDate() - 1);
  const twoDaysAgoDate = new Date(today);
  twoDaysAgoDate.setDate(today.getDate() - 2);

  const yStr = yesterdayDate.toISOString().split("T")[0];
  const tdStr = twoDaysAgoDate.toISOString().split("T")[0];

  const timeEntryData = [
    {
      workerId: insertedWorkers[0].id,
      companyId: company1.id,
      date: yStr,
      clockIn: new Date(`${yStr}T08:00:00.000Z`),
      clockOut: new Date(`${yStr}T17:00:00.000Z`),
      breakMinutes: 30,
      totalHours: "8.50",
      overtimeHours: "0.50",
      status: "approved" as const,
    },
    {
      workerId: insertedWorkers[1].id,
      companyId: company1.id,
      date: yStr,
      clockIn: new Date(`${yStr}T09:00:00.000Z`),
      clockOut: new Date(`${yStr}T17:30:00.000Z`),
      breakMinutes: 60,
      totalHours: "7.50",
      overtimeHours: "0.00",
      status: "pending" as const,
    },
    {
      workerId: insertedWorkers[0].id,
      companyId: company1.id,
      date: tdStr,
      clockIn: new Date(`${tdStr}T07:30:00.000Z`),
      clockOut: new Date(`${tdStr}T16:30:00.000Z`),
      breakMinutes: 30,
      totalHours: "8.50",
      overtimeHours: "0.50",
      status: "approved" as const,
    },
    {
      workerId: insertedWorkers[3].id,
      companyId: company2.id,
      date: yStr,
      clockIn: new Date(`${yStr}T08:30:00.000Z`),
      clockOut: new Date(`${yStr}T17:00:00.000Z`),
      breakMinutes: 30,
      totalHours: "8.00",
      overtimeHours: "0.00",
      status: "pending" as const,
    },
    {
      workerId: insertedWorkers[4].id,
      companyId: company2.id,
      date: yStr,
      clockIn: new Date(`${yStr}T09:00:00.000Z`),
      clockOut: new Date(`${yStr}T15:00:00.000Z`),
      breakMinutes: 30,
      totalHours: "5.50",
      overtimeHours: "0.00",
      status: "approved" as const,
    },
  ];

  await db.insert(timeEntries).values(timeEntryData);

  const nextMonday = new Date(today);
  nextMonday.setDate(today.getDate() + ((1 + 7 - today.getDay()) % 7 || 7));

  const scheduleData = [];
  for (let i = 0; i < 5; i++) {
    const schedDate = new Date(nextMonday);
    schedDate.setDate(nextMonday.getDate() + i);
    const dateStr = schedDate.toISOString().split("T")[0];

    scheduleData.push({
      workerId: insertedWorkers[0].id,
      companyId: company1.id,
      date: dateStr,
      startTime: "08:00",
      endTime: "17:00",
      department: "Engineering",
      status: "published" as const,
    });
    if (i < 4) {
      scheduleData.push({
        workerId: insertedWorkers[4].id,
        companyId: company2.id,
        date: dateStr,
        startTime: "09:00",
        endTime: "15:00",
        department: "Admin",
        status: "published" as const,
      });
    }
  }

  await db.insert(schedules).values(scheduleData);

  await db.insert(taxesDeductions).values([
    {
      companyId: company1.id,
      name: "Federal Income Tax",
      type: "tax",
      calculationType: "percentage",
      rate: "12.00",
      isActive: true,
      isEmployerPaid: false,
    },
    {
      companyId: company1.id,
      name: "Social Security (FICA)",
      type: "tax",
      calculationType: "percentage",
      rate: "6.20",
      maxAmount: "160200",
      isActive: true,
      isEmployerPaid: false,
    },
    {
      companyId: company1.id,
      name: "Medicare",
      type: "tax",
      calculationType: "percentage",
      rate: "1.45",
      isActive: true,
      isEmployerPaid: false,
    },
    {
      companyId: company1.id,
      name: "State Income Tax (TX)",
      type: "tax",
      calculationType: "percentage",
      rate: "0.00",
      isActive: true,
      isEmployerPaid: false,
    },
    {
      companyId: company2.id,
      name: "Federal Income Tax",
      type: "tax",
      calculationType: "percentage",
      rate: "10.00",
      isActive: true,
      isEmployerPaid: false,
    },
    {
      companyId: company2.id,
      name: "Social Security (FICA)",
      type: "tax",
      calculationType: "percentage",
      rate: "6.20",
      maxAmount: "160200",
      isActive: true,
      isEmployerPaid: false,
    },
    {
      companyId: company2.id,
      name: "Medicare",
      type: "tax",
      calculationType: "percentage",
      rate: "1.45",
      isActive: true,
      isEmployerPaid: false,
    },
    {
      companyId: company2.id,
      name: "CO State Income Tax",
      type: "tax",
      calculationType: "percentage",
      rate: "4.40",
      isActive: true,
      isEmployerPaid: false,
    },
  ]);

  await seedEmployeeGroupConfigs();
  await seedTradeCompensationDemo(insertedWorkers, company1.id);
  await seedDemoHierarchy();

  console.log("Database seeded successfully");
}

async function seedTradeCompensationDemo(insertedWorkers: any[], companyId: string) {
  try {
    const existing = await db.select().from(tradeTransactions).where(eq(tradeTransactions.companyId, companyId));
    if (existing.length > 0) {
      console.log("Trade transactions already seeded, skipping");
      return;
    }
    const contractor = insertedWorkers.find(w => w.workerType === "contractor");
    if (!contractor) return;

    const currentYear = new Date().getFullYear();
    const adminUser = await db.select().from(users).where(eq(users.username, "admin")).then(r => r[0]);
    const createdBy = adminUser?.id || "admin";

    await db.insert(tradeTransactions).values([
      {
        companyId, createdBy,
        title: "Logo & Brand Identity Design",
        transactionType: "services",
        counterpartyType: "contractor",
        counterpartyId: contractor.id,
        counterpartyName: `${contractor.firstName} ${contractor.lastName}`,
        description: "Custom logo, brand guidelines, and identity package in exchange for 3 months free SaaS access ($250/mo value).",
        fairMarketValue: "750.00",
        currency: "USD",
        status: "completed",
        isReportable: true,
        taxYear: currentYear,
        reportingNotes: "Trade value equals retail SaaS subscription value. Must be included in 1099-NEC.",
      },
      {
        companyId, createdBy,
        title: "UX Audit & Wireframes",
        transactionType: "services",
        counterpartyType: "contractor",
        counterpartyId: contractor.id,
        counterpartyName: `${contractor.firstName} ${contractor.lastName}`,
        description: "Full UX audit of the dashboard and new feature wireframes in exchange for equipment (refurbished laptop).",
        fairMarketValue: "420.00",
        currency: "USD",
        status: "approved",
        isReportable: true,
        taxYear: currentYear,
        reportingNotes: "FMV of laptop provided as consideration.",
      },
      {
        companyId, createdBy,
        title: "Office Space Sub-let",
        transactionType: "property_rights",
        counterpartyType: "vendor",
        counterpartyId: null,
        counterpartyName: "Eastside Co-work LLC",
        description: "Provided 2 desks for 6 months in exchange for accounting software licenses.",
        fairMarketValue: "1200.00",
        currency: "USD",
        status: "draft",
        isReportable: false,
        taxYear: currentYear,
      },
    ]);
    console.log("Trade compensation demo data seeded");
  } catch (e) {
    console.log("Could not seed trade compensation demo:", e);
  }
}

async function seedEmployeeGroupConfigs() {
  try {
    const existing = await db.select().from(employeeGroupConfigs);
    if (existing.length > 0) {
      console.log("Employee group configs already seeded, skipping");
      return;
    }

    await db.insert(employeeGroupConfigs).values([
      {
        groupKey: "hourly_employee",
        label: "Hourly Employee (W-2)",
        taxForm: "W-2",
        payrollTaxesWithheld: true,
        employerTaxesApply: true,
        timeTracking: "required",
        overtimeEligible: true,
        invoiceWorkflow: false,
        distributions: false,
        volunteerEligible: false,
        payrollEnabled: true,
        yearEndDocType: "W-2",
        description: "Standard hourly W-2 employee with time tracking and overtime",
      },
      {
        groupKey: "salaried_employee",
        label: "Salaried Employee (W-2)",
        taxForm: "W-2",
        payrollTaxesWithheld: true,
        employerTaxesApply: true,
        timeTracking: "optional",
        overtimeEligible: false,
        invoiceWorkflow: false,
        distributions: false,
        volunteerEligible: false,
        payrollEnabled: true,
        yearEndDocType: "W-2",
        description: "Salaried W-2 employee, exempt from overtime",
      },
      {
        groupKey: "hourly_contractor",
        label: "Hourly Contractor (1099)",
        taxForm: "1099-NEC",
        payrollTaxesWithheld: false,
        employerTaxesApply: false,
        timeTracking: "required",
        overtimeEligible: false,
        invoiceWorkflow: false,
        distributions: false,
        volunteerEligible: false,
        payrollEnabled: true,
        yearEndDocType: "1099-NEC",
        description: "Hourly contractor paid by time tracked, no tax withholding",
      },
      {
        groupKey: "invoiced_contractor",
        label: "Invoiced Contractor (1099)",
        taxForm: "1099-NEC",
        payrollTaxesWithheld: false,
        employerTaxesApply: false,
        timeTracking: "optional",
        overtimeEligible: false,
        invoiceWorkflow: true,
        distributions: false,
        volunteerEligible: false,
        payrollEnabled: true,
        yearEndDocType: "1099-NEC",
        description: "Contractor paid by invoice, no tax withholding",
      },
      {
        groupKey: "shareholder_employee",
        label: "Shareholder-Employee (S-Corp W-2)",
        taxForm: "W-2",
        payrollTaxesWithheld: true,
        employerTaxesApply: true,
        timeTracking: "optional",
        overtimeEligible: false,
        invoiceWorkflow: false,
        distributions: true,
        volunteerEligible: false,
        payrollEnabled: true,
        yearEndDocType: "W-2",
        description: "S-Corp shareholder receiving reasonable salary plus distributions",
      },
      {
        groupKey: "owner_distribution",
        label: "Owner Distribution (K-1)",
        taxForm: "K-1",
        payrollTaxesWithheld: false,
        employerTaxesApply: false,
        timeTracking: "optional",
        overtimeEligible: false,
        invoiceWorkflow: false,
        distributions: true,
        volunteerEligible: false,
        payrollEnabled: false,
        yearEndDocType: "K-1",
        description: "Owner receiving distributions only, not on payroll",
      },
      {
        groupKey: "volunteer",
        label: "Volunteer",
        taxForm: "none",
        payrollTaxesWithheld: false,
        employerTaxesApply: false,
        timeTracking: "optional",
        overtimeEligible: false,
        invoiceWorkflow: false,
        distributions: false,
        volunteerEligible: true,
        payrollEnabled: false,
        yearEndDocType: "none",
        description: "Unpaid volunteer, time tracked for reporting only",
      },
    ]);
    console.log("Employee group configs seeded");
  } catch (e) {
    console.log("Could not seed employee group configs:", e);
  }
}
