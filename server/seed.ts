import { db } from "./db";
import { eq } from "drizzle-orm";
import { companies, workers, timeEntries, schedules, taxesDeductions, users, roles, rolePermissions, userRoles } from "@shared/schema";
import bcrypt from "bcrypt";

const PERMISSION_RESOURCES = [
  "companies", "workers", "schedules", "payroll", "timesheets",
  "departments", "branches", "divisions", "positions",
  "policies", "hr", "reports", "settings", "permissions"
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
      { name: "Enterprise Admin", description: "Full access across all companies in the enterprise", level: 1, isSystem: true },
      { name: "Company Admin", description: "Full access within assigned company", level: 2, isSystem: true },
      { name: "Manager", description: "Manage employees, schedules, timesheets within scope", level: 3, isSystem: true },
      { name: "Supervisor", description: "View and approve timesheets, manage schedules within scope", level: 4, isSystem: true },
      { name: "Employee", description: "View own data, punch in/out, view schedule", level: 5, isSystem: true },
    ];

    const createdRoles: Record<string, string> = {};
    for (const roleDef of roleDefinitions) {
      const [r] = await db.insert(roles).values(roleDef).returning();
      createdRoles[roleDef.name] = r.id;
    }

    const permissionMatrix: Record<string, { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean }> = {
      "Enterprise Admin": { canView: true, canCreate: true, canEdit: true, canDelete: true },
      "Company Admin": { canView: true, canCreate: true, canEdit: true, canDelete: true },
      "Manager": { canView: true, canCreate: true, canEdit: true, canDelete: false },
      "Supervisor": { canView: true, canCreate: false, canEdit: true, canDelete: false },
      "Employee": { canView: true, canCreate: false, canEdit: false, canDelete: false },
    };

    const managerResources = ["workers", "schedules", "timesheets", "reports"];
    const supervisorResources = ["schedules", "timesheets"];
    const employeeResources = ["timesheets", "schedules"];

    for (const roleName of Object.keys(createdRoles)) {
      const roleId = createdRoles[roleName];
      const perms = permissionMatrix[roleName];
      let resources = PERMISSION_RESOURCES;

      if (roleName === "Manager") resources = managerResources;
      else if (roleName === "Supervisor") resources = supervisorResources;
      else if (roleName === "Employee") resources = employeeResources;

      for (const resource of resources) {
        let actualPerms = { ...perms };
        if (roleName === "Employee") {
          actualPerms = { canView: true, canCreate: false, canEdit: false, canDelete: false };
        }
        await db.insert(rolePermissions).values({
          roleId,
          resource,
          ...actualPerms,
        });
      }
    }

    const adminUser = await db.select().from(users).where(eq(users.username, "admin"));
    if (adminUser.length > 0 && createdRoles["Enterprise Admin"]) {
      await db.insert(userRoles).values({
        userId: adminUser[0].id,
        roleId: createdRoles["Enterprise Admin"],
        scopeType: "enterprise",
        scopeId: null,
      });
    }

    console.log("Default roles, permissions, and admin assignment seeded");
  } catch (e: any) {
    console.log("Could not seed roles:", e?.message || e);
  }
}

export async function seedDatabase() {
  await ensureAdminUser();
  await seedRolesAndPermissions();

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

  console.log("Database seeded successfully");
}
