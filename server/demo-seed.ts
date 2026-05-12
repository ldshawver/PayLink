/**
 * demo-seed.ts — Comprehensive demo tenant provisioner
 *
 * Called by POST /api/demo/provision (public) and can also be imported
 * by the admin idempotent provisioner.  Every record created here is
 * scoped to the returned companyId; nothing touches any other tenant.
 */

import { sql } from "drizzle-orm";
import bcrypt from "bcrypt";
import crypto from "crypto";
import type { PostgresJsTransaction } from "drizzle-orm/postgres-js";

/** Unwrap the RETURNING id from a db.execute result */
function rowId(result: { rows: unknown[] }): string {
  const r = result.rows[0] as Record<string, unknown>;
  if (!r || typeof r.id !== "string") throw new Error("Expected RETURNING id");
  return r.id;
}

export interface DemoSeedResult {
  companyId: string;
  adminUserId: string;
  adminUsername: string;
  workerIds: string[];
  payrollRunId: string;
}

export interface DemoSeedOptions {
  /** UUID or human-readable suffix to make usernames unique (default: random hex) */
  suffix?: string;
  /** Company name override */
  companyName?: string;
  /** When the demo tenant expires (default: now + 24 h) */
  trialEnd?: Date;
  /** IP for analytics events */
  ipAddress?: string | null;
}

/**
 * Provision a complete, fully-seeded demo tenant inside an existing
 * Drizzle transaction.  All FK relationships are respected; no cross-tenant
 * data is created.
 */
export async function provisionDemoTenant(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  opts: DemoSeedOptions = {}
): Promise<DemoSeedResult> {
  const suffix      = opts.suffix ?? crypto.randomBytes(4).toString("hex");
  const name        = opts.companyName ?? "Acme Services Demo";
  const trialEnd    = opts.trialEnd   ?? new Date(Date.now() + 24 * 60 * 60 * 1000);
  const adminPw     = await bcrypt.hash("demo123", 10);
  const workerPw    = await bcrypt.hash("demo123", 10);
  const adminUser   = `demo_${suffix}`;

  // ── 1. Enterprise & Company ──────────────────────────────────────────────
  const entRes = await tx.execute(sql`
    INSERT INTO enterprises (name, description)
    VALUES (${name + " Enterprise"}, 'Demo enterprise for product walk-throughs')
    RETURNING id
  `);
  const enterpriseId = rowId(entRes);

  const coRes = await tx.execute(sql`
    INSERT INTO companies (
      name, enterprise_id, subscription_status, plan_name,
      is_demo, pay_frequency, overtime_threshold, trial_end,
      timezone, timezone_confirmed, state, city,
      address, phone, email, entity_type,
      overtime_multiplier, break_policy_minutes, break_after_hours,
      next_check_number, station_enforcement_enabled
    )
    VALUES (
      ${name}, ${enterpriseId}, 'active_paid', 'professional',
      TRUE, 'biweekly', 40, ${trialEnd},
      'America/Los_Angeles', TRUE, 'CA', 'Los Angeles',
      '1234 Demo Boulevard', '(800) 555-0100', 'admin@demo.paylink.app', 'llc',
      '1.5', 30, 6,
      1001, FALSE
    )
    RETURNING id
  `);
  const companyId = rowId(coRes);

  // ── 2. Org Hierarchy — Divisions → Departments → Branches → Positions ───
  const divRes = await tx.execute(sql`
    INSERT INTO divisions (company_id, name, description, is_active)
    VALUES
      (${companyId}, 'Field Operations', 'All field-facing operations', TRUE),
      (${companyId}, 'Corporate',        'Corporate and administrative functions', TRUE)
    RETURNING id, name
  `);
  const divField = (divRes.rows[0] as any).id as string;
  const divCorp  = (divRes.rows[1] as any).id as string;

  const deptRes = await tx.execute(sql`
    INSERT INTO departments (company_id, division_id, name)
    VALUES
      (${companyId}, ${divField}, 'Field Services'),
      (${companyId}, ${divField}, 'Warehouse'),
      (${companyId}, ${divCorp},  'Human Resources'),
      (${companyId}, ${divCorp},  'Finance')
    RETURNING id, name
  `);
  const deptField = (deptRes.rows[0] as any).id as string;
  const deptWH    = (deptRes.rows[1] as any).id as string;
  const deptHR    = (deptRes.rows[2] as any).id as string;
  const deptFin   = (deptRes.rows[3] as any).id as string;

  const branchRes = await tx.execute(sql`
    INSERT INTO branches (company_id, name, address, city, state, zip, is_active)
    VALUES
      (${companyId}, 'Main Office',  '1234 Demo Blvd',  'Los Angeles', 'CA', '90001', TRUE),
      (${companyId}, 'Warehouse #1', '5678 Depot St',   'Burbank',     'CA', '91502', TRUE)
    RETURNING id
  `);
  const branchMain = (branchRes.rows[0] as any).id as string;
  const branchWH   = (branchRes.rows[1] as any).id as string;

  const posRes = await tx.execute(sql`
    INSERT INTO positions (company_id, department_id, title, pay_type, salary_range_min, salary_range_max, is_active)
    VALUES
      (${companyId}, ${deptField}, 'Field Technician',    'hourly',  '20.00', '30.00', TRUE),
      (${companyId}, ${deptField}, 'Field Supervisor',    'hourly',  '28.00', '38.00', TRUE),
      (${companyId}, ${deptWH},    'Warehouse Associate', 'hourly',  '18.00', '24.00', TRUE),
      (${companyId}, ${deptHR},    'HR Generalist',       'salary',  '55000', '75000', TRUE),
      (${companyId}, ${deptFin},   'Finance Analyst',     'salary',  '65000', '95000', TRUE),
      (${companyId}, ${deptField}, 'Operations Manager',  'salary',  '80000','110000', TRUE)
    RETURNING id
  `);
  const posFieldTech = (posRes.rows[0] as any).id as string;
  const posFieldSup  = (posRes.rows[1] as any).id as string;
  const posWH        = (posRes.rows[2] as any).id as string;
  const posHR        = (posRes.rows[3] as any).id as string;
  const posFin       = (posRes.rows[4] as any).id as string;
  const posMgr       = (posRes.rows[5] as any).id as string;

  // Cost centres
  await tx.execute(sql`
    INSERT INTO cost_centers (company_id, name, code, is_active)
    VALUES
      (${companyId}, 'Field Ops',      'CC-FIELD', TRUE),
      (${companyId}, 'Warehouse Ops',  'CC-WH',    TRUE),
      (${companyId}, 'Administration', 'CC-ADMIN',  TRUE)
  `);

  // ── 3. Pay Period Schedule ───────────────────────────────────────────────
  const ppsRes = await tx.execute(sql`
    INSERT INTO pay_period_schedules (company_id, name, type, anchor_date, transaction_day_offset, annual_pay_periods, is_active)
    VALUES (${companyId}, 'Biweekly Standard', 'biweekly', '2025-01-06', 3, 26, TRUE)
    RETURNING id
  `);
  const payPeriodScheduleId = rowId(ppsRes);

  // ── 4. Accrual Accounts ──────────────────────────────────────────────────
  const accPtoRes = await tx.execute(sql`
    INSERT INTO accrual_accounts (company_id, name, type, accrual_rate, accrual_frequency, max_balance, is_active)
    VALUES (${companyId}, 'Paid Time Off', 'pto', '0.077', 'per_hour_worked', '120', TRUE)
    RETURNING id
  `);
  const accPtoId = rowId(accPtoRes);

  const accSickRes = await tx.execute(sql`
    INSERT INTO accrual_accounts (company_id, name, type, accrual_rate, accrual_frequency, max_balance, is_active)
    VALUES (${companyId}, 'Sick Leave', 'sick', '0.033', 'per_hour_worked', '40', TRUE)
    RETURNING id
  `);
  const accSickId = rowId(accSickRes);

  // ── 5. Taxes & Deductions ────────────────────────────────────────────────
  await tx.execute(sql`
    INSERT INTO taxes_deductions (company_id, name, type, category, calculation_type, rate, is_employer_paid, applies_to, is_active, tax_code, state_code, deduction_timing)
    VALUES
      (${companyId}, 'Federal Income Tax',    'tax', 'mandatory_tax', 'percentage', '0.22', FALSE, 'all', TRUE, 'fed_income_tax',    NULL, 'post_tax'),
      (${companyId}, 'Social Security (EE)',  'tax', 'mandatory_tax', 'percentage', '0.062', FALSE,'all', TRUE, 'ss_employee',       NULL, 'post_tax'),
      (${companyId}, 'Medicare (EE)',         'tax', 'mandatory_tax', 'percentage', '0.0145',FALSE,'all', TRUE, 'medicare_employee', NULL, 'post_tax'),
      (${companyId}, 'Social Security (ER)',  'tax', 'mandatory_tax', 'percentage', '0.062', TRUE, 'all', TRUE, 'ss_employer',       NULL, 'post_tax'),
      (${companyId}, 'Medicare (ER)',         'tax', 'mandatory_tax', 'percentage', '0.0145',TRUE, 'all', TRUE, 'medicare_employer', NULL, 'post_tax'),
      (${companyId}, 'CA State Income Tax',   'tax', 'mandatory_tax', 'percentage', '0.093', FALSE,'all', TRUE, 'ca_income_tax',    'CA',  'post_tax'),
      (${companyId}, 'CA SDI',               'tax', 'mandatory_tax', 'percentage', '0.009', FALSE,'all', TRUE, 'ca_sdi',           'CA',  'post_tax'),
      (${companyId}, 'FUTA',                 'tax', 'mandatory_tax', 'percentage', '0.006', TRUE, 'all', TRUE, 'futa',              NULL, 'post_tax'),
      (${companyId}, 'CA SUI',               'tax', 'mandatory_tax', 'percentage', '0.034', TRUE, 'all', TRUE, 'ca_sui',           'CA',  'post_tax'),
      (${companyId}, 'Health Insurance',     'deduction','benefit',  'fixed',       '250.00',FALSE,'all', TRUE, NULL,                NULL, 'pre_tax'),
      (${companyId}, '401(k) Employee',      'deduction','retirement','percentage', '0.05',  FALSE,'all', TRUE, NULL,                NULL, 'pre_tax'),
      (${companyId}, '401(k) Employer Match','deduction','retirement','percentage', '0.03',  TRUE, 'all', TRUE, NULL,                NULL, 'pre_tax')
  `);

  // ── 6. Roles — idempotent upsert (unique constraint on name) ─────────────
  await tx.execute(sql`
    INSERT INTO roles (name, description, level, is_system, capabilities)
    VALUES ('Demo Admin', 'Full administrative access to all modules', 1, FALSE,
      'payroll,timeclock,scheduling,hr,reports,documents,settings')
    ON CONFLICT (name) DO NOTHING
  `);
  const roleAdminRow = await tx.execute(sql`SELECT id FROM roles WHERE name = 'Demo Admin'`);
  const roleAdminId = (roleAdminRow.rows[0] as any).id as string;

  await tx.execute(sql`
    INSERT INTO roles (name, description, level, is_system, capabilities)
    VALUES ('Demo Manager', 'Department-level management access', 3, FALSE,
      'timeclock,scheduling,hr_view,reports_view')
    ON CONFLICT (name) DO NOTHING
  `);
  const roleMgrRow = await tx.execute(sql`SELECT id FROM roles WHERE name = 'Demo Manager'`);
  const roleMgrId = (roleMgrRow.rows[0] as any).id as string;

  await tx.execute(sql`
    INSERT INTO roles (name, description, level, is_system, capabilities)
    VALUES ('Demo Employee', 'Self-service access only', 5, FALSE,
      'timeclock_self,schedule_self,payslip_self')
    ON CONFLICT (name) DO NOTHING
  `);
  const roleEmpRow = await tx.execute(sql`SELECT id FROM roles WHERE name = 'Demo Employee'`);
  const roleEmpId = (roleEmpRow.rows[0] as any).id as string;

  // Role permission matrix
  const resources = ['payroll','timeclock','scheduling','hr','reports','documents','settings','users','audit_log'];
  for (const resource of resources) {
    const isAdmin = true;
    const isMgr   = ['timeclock','scheduling','hr','reports'].includes(resource);
    const isEmp   = resource === 'timeclock';
    await tx.execute(sql`
      INSERT INTO role_permissions (role_id, resource, can_view, can_create, can_edit, can_delete, can_export, can_approve, can_configure, can_view_own, can_edit_own, can_view_company, can_edit_company, can_approve_company)
      VALUES
        (${roleAdminId}, ${resource}, ${isAdmin}, ${isAdmin}, ${isAdmin}, ${isAdmin}, ${isAdmin}, ${isAdmin}, ${isAdmin}, TRUE, TRUE, TRUE, TRUE, TRUE),
        (${roleMgrId},   ${resource}, ${isMgr},   ${isMgr},   ${isMgr},   FALSE,      ${isMgr},   FALSE,      FALSE,      TRUE, TRUE, ${isMgr}, FALSE, FALSE),
        (${roleEmpId},   ${resource}, ${isEmp},   FALSE,      FALSE,      FALSE,      FALSE,      FALSE,      FALSE,      TRUE, TRUE, FALSE, FALSE, FALSE)
    `);
  }

  // ── 7. Workers ───────────────────────────────────────────────────────────
  interface WorkerSpec {
    first: string; last: string; type: 'employee'|'contractor';
    payType: 'hourly'|'salary'; rate: string;
    dept: string; deptId: string; posId: string;
    branchId: string; jobTitle: string; managerIdx?: number;
    roleId: string; employeeNumber: string;
    w4: string; allowances: number;
  }
  const workerSpecs: WorkerSpec[] = [
    { first:'Alice',  last:'Navarro',  type:'employee',   payType:'hourly',  rate:'24.00', dept:'Field Services',  deptId:deptField, posId:posFieldTech, branchId:branchMain, jobTitle:'Field Technician',    employeeNumber:'EMP-001', w4:'single',           allowances:1, roleId:roleEmpId,  managerIdx:5 },
    { first:'Ben',    last:'Torres',   type:'employee',   payType:'hourly',  rate:'20.00', dept:'Warehouse',        deptId:deptWH,    posId:posWH,        branchId:branchWH,   jobTitle:'Warehouse Associate', employeeNumber:'EMP-002', w4:'single',           allowances:0, roleId:roleEmpId,  managerIdx:5 },
    { first:'Carol',  last:'Kim',      type:'employee',   payType:'salary',  rate:'72000', dept:'Human Resources',  deptId:deptHR,    posId:posHR,        branchId:branchMain, jobTitle:'HR Generalist',       employeeNumber:'EMP-003', w4:'married',          allowances:2, roleId:roleEmpId,  managerIdx:6 },
    { first:'David',  last:'Singh',    type:'employee',   payType:'salary',  rate:'85000', dept:'Finance',          deptId:deptFin,   posId:posFin,       branchId:branchMain, jobTitle:'Finance Analyst',     employeeNumber:'EMP-004', w4:'head_of_household',allowances:1, roleId:roleEmpId,  managerIdx:6 },
    { first:'Eva',    last:'Brooks',   type:'employee',   payType:'hourly',  rate:'22.50', dept:'Field Services',   deptId:deptField, posId:posFieldSup,  branchId:branchMain, jobTitle:'Field Supervisor',    employeeNumber:'EMP-005', w4:'single',           allowances:0, roleId:roleEmpId,  managerIdx:5 },
    { first:'Frank',  last:'Delgado',  type:'employee',   payType:'hourly',  rate:'32.00', dept:'Field Services',   deptId:deptField, posId:posMgr,       branchId:branchMain, jobTitle:'Operations Manager',  employeeNumber:'EMP-006', w4:'married',          allowances:2, roleId:roleMgrId },
    { first:'Grace',  last:'Okafor',   type:'employee',   payType:'salary',  rate:'95000', dept:'Human Resources',  deptId:deptHR,    posId:posHR,        branchId:branchMain, jobTitle:'HR Manager',          employeeNumber:'EMP-007', w4:'married',          allowances:3, roleId:roleMgrId },
    { first:'Hector', last:'Lee',      type:'contractor', payType:'hourly',  rate:'55.00', dept:'Field Services',   deptId:deptField, posId:posFieldTech, branchId:branchMain, jobTitle:'Contract Technician', employeeNumber:'CON-001', w4:'single',           allowances:0, roleId:roleEmpId },
  ];

  const workerIds: string[] = [];
  for (const w of workerSpecs) {
    const wRes = await tx.execute(sql`
      INSERT INTO workers (
        company_id, first_name, last_name, worker_type, status,
        hire_date, pay_rate, pay_type, department, job_title,
        default_department_id, position_id, default_branch_id,
        pay_period_schedule_id, worker_group, compensation_type,
        employee_number, state, country,
        w4_filing_status, w4_allowances,
        email, work_email, is_active
      )
      VALUES (
        ${companyId}, ${w.first}, ${w.last}, ${w.type}, 'active',
        '2024-01-15', ${w.rate}, ${w.payType}, ${w.dept}, ${w.jobTitle},
        ${w.deptId}, ${w.posId}, ${w.branchId},
        ${payPeriodScheduleId}, ${w.type === 'contractor' ? 'hourly_contractor' : 'hourly_employee'}, ${w.payType === 'salary' ? 'salary' : 'hourly'},
        ${w.employeeNumber}, 'CA', 'US',
        ${w.w4}, ${w.allowances},
        ${(w.first.toLowerCase() + '.' + w.last.toLowerCase() + '@demo.paylink.app')},
        ${(w.first.toLowerCase() + '.' + w.last.toLowerCase() + '@acme-demo.com')},
        TRUE
      )
      RETURNING id
    `);
    workerIds.push(rowId(wRes));
  }

  // Set manager relationships (Frank=idx5 manages Alice,Ben,Eva; Grace=idx6 manages Carol,David)
  await tx.execute(sql`UPDATE workers SET manager_id=${workerIds[5]} WHERE id IN (${sql.raw("'" + [workerIds[0],workerIds[1],workerIds[4]].join("','") + "'")})`);
  await tx.execute(sql`UPDATE workers SET manager_id=${workerIds[6]} WHERE id IN (${sql.raw("'" + [workerIds[2],workerIds[3]].join("','") + "'")})`);

  // Pay methods (direct deposit for all employees)
  for (let i = 0; i < 7; i++) {
    await tx.execute(sql`
      INSERT INTO pay_methods (worker_id, method_type, bank_name, account_type, routing_number, account_number, is_primary, is_active, amount_type)
      VALUES (${workerIds[i]}, 'direct_deposit', 'First National Bank', 'checking', '021000021', ${`****${String(1000+i*111).slice(-4)}`}, TRUE, TRUE, 'remainder')
    `);
  }

  // Accrual balances (PTO + Sick for each employee)
  const ptoBals  = ['48.00','32.00','64.00','80.00','40.00','96.00','112.00'];
  const sickBals = ['24.00','16.00','32.00','40.00','20.00','40.00','40.00'];
  for (let i = 0; i < 7; i++) {
    await tx.execute(sql`
      INSERT INTO accrual_balances (worker_id, accrual_account_id, balance, used_hours)
      VALUES (${workerIds[i]}, ${accPtoId},  ${ptoBals[i]},  '0')
    `);
    await tx.execute(sql`
      INSERT INTO accrual_balances (worker_id, accrual_account_id, balance, used_hours)
      VALUES (${workerIds[i]}, ${accSickId}, ${sickBals[i]}, '0')
    `);
  }

  // Emergency contacts
  const contacts = [
    { name:'Maria Navarro',  rel:'Spouse',  phone:'(213)555-0101' },
    { name:'Luis Torres',    rel:'Parent',  phone:'(213)555-0102' },
    { name:'James Kim',      rel:'Spouse',  phone:'(213)555-0103' },
    { name:'Priya Singh',    rel:'Spouse',  phone:'(213)555-0104' },
    { name:'Tom Brooks',     rel:'Parent',  phone:'(213)555-0105' },
    { name:'Ana Delgado',    rel:'Spouse',  phone:'(213)555-0106' },
    { name:'Emeka Okafor',   rel:'Spouse',  phone:'(213)555-0107' },
  ];
  for (let i = 0; i < 7; i++) {
    await tx.execute(sql`
      INSERT INTO employee_contacts (worker_id, contact_type, name, relationship, phone, is_primary)
      VALUES (${workerIds[i]}, 'emergency', ${contacts[i].name}, ${contacts[i].rel}, ${contacts[i].phone}, TRUE)
    `);
  }

  // Worker login accounts
  const adminUserRes = await tx.execute(sql`
    INSERT INTO users (username, password, role, company_id)
    VALUES (${adminUser}, ${adminPw}, 'admin', ${companyId})
    RETURNING id, username
  `);
  const adminUserId   = rowId(adminUserRes);
  const adminUsername = (adminUserRes.rows[0] as any).username as string;

  for (let i = 0; i < workerSpecs.length; i++) {
    const uname = `demo_${workerSpecs[i].first.toLowerCase()}_${suffix}`;
    const uRole = workerSpecs[i].roleId === roleMgrId ? 'manager' : (workerSpecs[i].type === 'contractor' ? 'contractor' : 'employee');
    await tx.execute(sql`
      INSERT INTO users (username, password, role, company_id, worker_id)
      VALUES (${uname}, ${workerPw}, ${uRole}, ${companyId}, ${workerIds[i]})
    `);
  }

  // ── 8. Published Schedules (two weeks for hourly workers) ────────────────
  const hourlyWorkerIds = [workerIds[0],workerIds[1],workerIds[4],workerIds[5]]; // Alice,Ben,Eva,Frank
  const weekDays = ['2025-05-05','2025-05-06','2025-05-07','2025-05-08','2025-05-09',
                    '2025-05-12','2025-05-13','2025-05-14','2025-05-15','2025-05-16'];
  for (const wid of hourlyWorkerIds) {
    for (const d of weekDays) {
      await tx.execute(sql`
        INSERT INTO schedules (worker_id, company_id, date, start_time, end_time, department, status)
        VALUES (${wid}, ${companyId}, ${d}, '08:00', '16:30', 'Field Services', 'published')
      `);
    }
  }

  // ── 9. Time Entries & Punches (pay period 2025-05-05 → 2025-05-16) ───────
  const hourlyWorkerData = [
    { wid:workerIds[0], rate:'24.00' },
    { wid:workerIds[1], rate:'20.00' },
    { wid:workerIds[4], rate:'22.50' },
    { wid:workerIds[5], rate:'32.00' },
  ];
  const timeEntryIds: string[] = [];
  for (const hw of hourlyWorkerData) {
    for (const d of weekDays) {
      const clockIn  = new Date(d + 'T08:02:00-07:00');
      const clockOut = new Date(d + 'T16:31:00-07:00');
      const teRes = await tx.execute(sql`
        INSERT INTO time_entries (worker_id, company_id, date, clock_in, clock_out, break_minutes, total_hours, overtime_hours, status, source)
        VALUES (${hw.wid}, ${companyId}, ${d}, ${clockIn.toISOString()}, ${clockOut.toISOString()}, 30, '8.0', '0', 'approved', 'timeclock')
        RETURNING id
      `);
      timeEntryIds.push(rowId(teRes));

      // Corresponding punches
      await tx.execute(sql`
        INSERT INTO time_punches (worker_id, company_id, punch_type, punch_time, approval_status)
        VALUES
          (${hw.wid}, ${companyId}, 'clock_in',  ${clockIn.toISOString()},  'approved'),
          (${hw.wid}, ${companyId}, 'clock_out', ${clockOut.toISOString()}, 'approved')
      `);
    }
  }

  // Salary workers get time entries (tracked only) for the same period
  const salaryWorkerData = [
    { wid:workerIds[2] }, // Carol
    { wid:workerIds[3] }, // David
    { wid:workerIds[6] }, // Grace
  ];
  for (const sw of salaryWorkerData) {
    for (const d of weekDays) {
      await tx.execute(sql`
        INSERT INTO time_entries (worker_id, company_id, date, clock_in, clock_out, break_minutes, total_hours, overtime_hours, status, source)
        VALUES (${sw.wid}, ${companyId}, ${d}, ${new Date(d+'T09:00:00-07:00').toISOString()}, ${new Date(d+'T17:00:00-07:00').toISOString()}, 30, '7.5', '0', 'approved', 'manual')
      `);
    }
  }

  // ── 10. Payroll Run (completed, paid) ────────────────────────────────────
  const periodStart = '2025-05-05';
  const periodEnd   = '2025-05-16';
  const payDate     = '2025-05-21';

  type ItemSeed = { wid:string; payType:'hourly'|'salary'; rate:string };
  const runSeeds: ItemSeed[] = [
    { wid:workerIds[0], payType:'hourly',  rate:'24.00' },  // Alice
    { wid:workerIds[1], payType:'hourly',  rate:'20.00' },  // Ben
    { wid:workerIds[2], payType:'salary',  rate:'72000' },  // Carol
    { wid:workerIds[3], payType:'salary',  rate:'85000' },  // David
    { wid:workerIds[4], payType:'hourly',  rate:'22.50' },  // Eva
    { wid:workerIds[5], payType:'hourly',  rate:'32.00' },  // Frank
    { wid:workerIds[6], payType:'salary',  rate:'95000' },  // Grace
  ];

  let totalGross = 0;
  const payrollItemData = runSeeds.map(w => {
    let gross: number;
    if (w.payType === 'hourly') {
      gross = parseFloat(w.rate) * 80;
    } else {
      gross = parseFloat(w.rate) / 26; // biweekly
    }
    const deductions = parseFloat((gross * 0.28).toFixed(2));
    const net        = parseFloat((gross - deductions).toFixed(2));
    totalGross += gross;
    return { ...w, gross: gross.toFixed(2), deductions: deductions.toFixed(2), net: net.toFixed(2) };
  });

  const totalNet  = payrollItemData.reduce((s,i) => s + parseFloat(i.net),  0).toFixed(2);
  const totalHours = '560'; // 7 workers * 80 hours

  const runRes = await tx.execute(sql`
    INSERT INTO payroll_runs (
      company_id, period_start, period_end, pay_date, status,
      total_gross, total_net, total_hours, worker_count,
      processed_at, approved_at, use_direct_deposit, is_locked, total_deductions, needs_recalculation
    )
    VALUES (
      ${companyId}, ${periodStart}, ${periodEnd}, ${payDate}, 'paid',
      ${totalGross.toFixed(2)}, ${totalNet}, ${totalHours}, 7,
      NOW() - INTERVAL '7 days', NOW() - INTERVAL '6 days',
      TRUE, TRUE, ${(totalGross - parseFloat(totalNet)).toFixed(2)}, FALSE
    )
    RETURNING id
  `);
  const payrollRunId = rowId(runRes);

  let checkNum = 1001;
  for (const item of payrollItemData) {
    const isSalary = item.payType === 'salary';
    await tx.execute(sql`
      INSERT INTO payroll_items (
        payroll_run_id, worker_id, company_id,
        regular_hours, overtime_hours,
        regular_pay, salary_pay, gross_pay, deductions, net_pay,
        pay_rate, pay_type, check_number,
        ytd_gross, ytd_deductions, ytd_net,
        payment_method
      )
      VALUES (
        ${payrollRunId}, ${item.wid}, ${companyId},
        '80', '0',
        ${isSalary ? '0' : item.gross}, ${isSalary ? item.gross : '0'},
        ${item.gross}, ${item.deductions}, ${item.net},
        ${item.rate}, ${item.payType}, ${String(checkNum++)},
        ${(parseFloat(item.gross) * 5).toFixed(2)},
        ${(parseFloat(item.deductions) * 5).toFixed(2)},
        ${(parseFloat(item.net) * 5).toFixed(2)},
        'direct_deposit'
      )
    `);
  }

  // ── 11. Document Folders & Documents ─────────────────────────────────────
  const folderRes = await tx.execute(sql`
    INSERT INTO document_folders (company_id, name, category, color)
    VALUES
      (${companyId}, 'HR Documents',   'hr',      '#3B82F6'),
      (${companyId}, 'Legal',          'legal',   '#8B5CF6'),
      (${companyId}, 'Finance',        'finance', '#10B981'),
      (${companyId}, 'Compliance',     'compliance','#F59E0B')
    RETURNING id, category
  `);
  const folderMap: Record<string,string> = {};
  for (const row of folderRes.rows) {
    const r = row as Record<string,string>;
    folderMap[r.category] = r.id;
  }

  await tx.execute(sql`
    INSERT INTO documents (company_id, folder_id, title, file_name, file_url, is_template, status, category)
    VALUES
      (${companyId}, ${folderMap['hr']},         'Offer Letter — Alice Navarro',     'offer_alice.pdf',    '/demo/offer_alice.pdf',    FALSE, 'signed',  'hr'),
      (${companyId}, ${folderMap['hr']},         'W-4 Tax Form — Alice Navarro',     'w4_alice.pdf',       '/demo/w4_alice.pdf',       FALSE, 'signed',  'hr'),
      (${companyId}, ${folderMap['hr']},         'Employee Handbook v2025',          'handbook_2025.pdf',  '/demo/handbook_2025.pdf',  TRUE,  'active',  'hr'),
      (${companyId}, ${folderMap['hr']},         'I-9 Eligibility — Ben Torres',     'i9_ben.pdf',         '/demo/i9_ben.pdf',         FALSE, 'signed',  'hr'),
      (${companyId}, ${folderMap['legal']},      'Non-Disclosure Agreement',         'nda_template.pdf',   '/demo/nda_template.pdf',   TRUE,  'active',  'legal'),
      (${companyId}, ${folderMap['legal']},      'Contractor Agreement — Hector Lee','contract_hector.pdf','/demo/contract_hector.pdf',FALSE, 'signed',  'legal'),
      (${companyId}, ${folderMap['finance']},    'Payroll Register May 2025',        'payroll_reg_may.pdf','/demo/payroll_reg_may.pdf',FALSE, 'active',  'finance'),
      (${companyId}, ${folderMap['compliance']},'CA Wage & Hour Compliance Guide',   'ca_wage_hour.pdf',   '/demo/ca_wage_hour.pdf',   TRUE,  'active',  'compliance')
  `);

  // ── 12. Contractor Proposal & Invoice ────────────────────────────────────
  const propRes = await tx.execute(sql`
    INSERT INTO contractor_proposals (company_id, contractor_id, title, status, subtotal, amount, issue_date)
    VALUES (${companyId}, ${workerIds[7]}, 'Site Maintenance — May 2025', 'approved', '4400.00', '4400.00', '2025-05-01')
    RETURNING id
  `);
  const proposalId = rowId(propRes);

  await tx.execute(sql`
    INSERT INTO proposal_line_items (proposal_id, name, quantity, unit_price, line_total, sort_order)
    VALUES
      (${proposalId}, 'HVAC inspection (8 hrs @ $55/hr)',      '8',  '55.00', '440.00',  0),
      (${proposalId}, 'Electrical check (16 hrs @ $55/hr)',    '16', '55.00', '880.00',  1),
      (${proposalId}, 'Plumbing maintenance (56 hrs @ $55/hr)','56', '55.00', '3080.00', 2)
  `);

  const invoiceRes = await tx.execute(sql`
    INSERT INTO contractor_invoices (company_id, contractor_id, proposal_id, invoice_number, status, amount, amount_paid, invoice_date, due_date, paid_at, notes, is_1099_reportable)
    VALUES (${companyId}, ${workerIds[7]}, ${proposalId}, 'INV-2025-001', 'paid', '4400.00', '4400.00', '2025-05-16', '2025-05-31', NOW() - INTERVAL '3 days', 'May 2025 maintenance services — approved and paid', TRUE)
    RETURNING id
  `);
  const invoiceId = rowId(invoiceRes);
  void invoiceId;

  // ── 13. Implementation Checklist (analytics events as task log) ───────────
  const checklistItems = [
    { event:'impl_step_completed', label:'Company profile configured',          completed:true  },
    { event:'impl_step_completed', label:'Pay period schedule created',         completed:true  },
    { event:'impl_step_completed', label:'Tax & deduction rules configured',    completed:true  },
    { event:'impl_step_completed', label:'Employee records imported',           completed:true  },
    { event:'impl_step_completed', label:'Direct deposit accounts verified',    completed:true  },
    { event:'impl_step_completed', label:'Time & attendance rules set',         completed:true  },
    { event:'impl_step_pending',   label:'Run first live payroll',              completed:false },
    { event:'impl_step_pending',   label:'Enable employee self-service portal', completed:false },
  ];
  for (const item of checklistItems) {
    await tx.execute(sql`
      INSERT INTO analytics_events (event_name, page_source, metadata, ip_address)
      VALUES (${item.event}, 'implementation', ${JSON.stringify({ companyId, label: item.label, completed: item.completed })}, NULL)
    `);
  }

  // ── 14. Audit Log Entries ─────────────────────────────────────────────────
  const auditEntries = [
    { resource:'company',          change:'DEMO_PROVISIONED',    note:'Demo tenant created',                          after:'is_demo=true' },
    { resource:'workers',          change:'BULK_IMPORT',         note:'8 worker records created during demo setup',   after:'count=8' },
    { resource:'payroll_run',      change:'RUN_APPROVED',        note:'Demo payroll run approved',                    after:'status=approved' },
    { resource:'payroll_run',      change:'RUN_PAID',            note:'Demo payroll disbursed via direct deposit',    after:'status=paid' },
    { resource:'documents',        change:'DOCUMENTS_UPLOADED',  note:'8 documents added to DMS',                    after:'count=8' },
    { resource:'schedules',        change:'SCHEDULES_PUBLISHED', note:'2-week schedule published for 4 workers',      after:'status=published' },
    { resource:'pay_period_schedule', change:'SCHEDULE_CREATED', note:'Biweekly pay period schedule created',         after:'type=biweekly' },
    { resource:'roles',            change:'ROLES_CONFIGURED',    note:'Admin, Manager, Employee roles created',       after:'count=3' },
  ];
  for (const e of auditEntries) {
    await tx.execute(sql`
      INSERT INTO authorization_audit_log (actor_user_id, target_resource, change_type, after_value, note, company_id)
      VALUES (${adminUserId}, ${e.resource}, ${e.change}, ${e.after}, ${e.note}, ${companyId})
    `);
  }

  // ── 15. Analytics event ──────────────────────────────────────────────────
  await tx.execute(sql`
    INSERT INTO analytics_events (event_name, page_source, metadata, ip_address)
    VALUES ('demo_provisioned', 'api', ${JSON.stringify({ companyId, suffix, by:'public_provision' })}, ${opts.ipAddress ?? null})
  `);

  return { companyId, adminUserId, adminUsername, workerIds, payrollRunId };
}
