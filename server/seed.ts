import { db } from "./db";
import { eq } from "drizzle-orm";
import { companies, workers, timeEntries, schedules, taxesDeductions, users, roles, rolePermissions, userRoles, employeeGroupConfigs } from "@shared/schema";
import bcrypt from "bcrypt";

const PERMISSION_RESOURCES = [
  "dashboard", "companies", "workers", "schedules", "payroll", "timesheets",
  "departments", "branches", "divisions", "positions",
  "policies", "hr", "reports", "timeclock", "settings", "permissions", "system_admin"
];

async function ensureAdminUser() {
  try {
    const existing = await db.select().from(users).where(eq(users.username, "admin"));
    const hashedPassword = await bcrypt.hash("admin", 10);
    if (existing.length === 0) {
      await db.insert(users).values({
        username: "admin",
        password: hashedPassword,
        role: "admin",
      });
      console.log("Admin user created (admin/admin)");
    } else {
      await db.update(users).set({ password: hashedPassword }).where(eq(users.username, "admin"));
      console.log("Admin user password reset to default");
    }
  } catch (e) {
    console.log("Could not ensure admin user (tables may not exist yet)");
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

export async function seedDatabase() {
  await ensureAdminUser();
  await seedRolesAndPermissions();
  await seedExpenseCategories();

  try {
    const existingCompanies = await db.select().from(companies);
    if (existingCompanies.length > 0) {
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

  console.log("Database seeded successfully");
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
