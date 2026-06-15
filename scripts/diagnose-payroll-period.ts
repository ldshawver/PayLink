import "dotenv/config";
import { db } from "../server/db.js";
import { sql } from "drizzle-orm";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(a => a.startsWith(prefix))?.slice(prefix.length);
}

const start = arg("start") || "2026-05-31";
const end = arg("end") || "2026-06-06";
const payDate = arg("payDate") || "2026-06-10";
const companyIdArg = arg("companyId");
const names = (arg("names") || "Phil,Marek,Jamie").split(",").map(n => n.trim()).filter(Boolean);

const rows = (result: any) => result.rows ?? result;
const namePredicate = sql.join(
  names.map(n => sql`w.first_name ILIKE ${`%${n}%`} OR w.last_name ILIKE ${`%${n}%`}`),
  sql` OR `,
);

const runFilter = companyIdArg
  ? sql`WHERE company_id = ${companyIdArg} AND pay_date = ${payDate}`
  : sql`WHERE pay_date = ${payDate}`;
const runRes = await db.execute(sql`
  SELECT id, company_id, period_start, period_end, pay_date, status, is_locked, locked_at, worker_count, total_hours
  FROM payroll_runs
  ${runFilter}
  ORDER BY created_at DESC
`);
const runs = rows(runRes);
const companyIds = [...new Set(runs.map((r: any) => r.company_id).filter(Boolean))];
const companyIdsToInspect = companyIdArg ? [companyIdArg] : companyIds;

if (companyIdsToInspect.length === 0) {
  console.log(JSON.stringify({
    period: { start, end, payDate, companyId: companyIdArg || null },
    payrollRuns: [],
    message: "No payroll_runs matched the supplied payDate/companyId. Provide --companyId if the run is not discoverable by payDate alone.",
  }, null, 2));
  process.exit(0);
}

const duplicateUsersRes = await db.execute(sql`
  WITH normalized_users AS (
    SELECT
      u.id,
      u.email,
      u.username,
      u.first_name,
      u.last_name,
      u.company_id,
      c.name AS company_name,
      u.role,
      u.created_at,
      lower(coalesce(nullif(u.email, ''), u.username)) AS duplicate_key,
      (
        lower(coalesce(u.email, '')) LIKE '%test%'
        OR lower(coalesce(u.username, '')) LIKE '%test%'
        OR lower(coalesce(u.first_name, '')) LIKE '%test%'
        OR lower(coalesce(u.last_name, '')) LIKE '%test%'
        OR lower(coalesce(c.name, '')) LIKE '%test%'
        OR lower(coalesce(u.email, '')) LIKE '%demo%'
        OR lower(coalesce(u.username, '')) LIKE '%demo%'
        OR lower(coalesce(c.name, '')) LIKE '%demo%'
      ) AS appears_test_or_demo
    FROM users u
    LEFT JOIN companies c ON c.id = u.company_id
  ), duplicate_keys AS (
    SELECT duplicate_key
    FROM normalized_users
    WHERE duplicate_key IS NOT NULL AND duplicate_key <> ''
    GROUP BY duplicate_key
    HAVING COUNT(*) > 1
  )
  SELECT
    nu.id,
    nu.email,
    nu.username,
    nu.first_name,
    nu.last_name,
    nu.company_id,
    nu.company_name,
    nu.role,
    nu.created_at,
    NULL::text AS last_login,
    (dk.duplicate_key IS NOT NULL) AS appears_duplicated,
    nu.appears_test_or_demo,
    CASE
      WHEN dk.duplicate_key IS NOT NULL AND nu.appears_test_or_demo THEN 'review duplicate test/demo account for later cleanup'
      WHEN dk.duplicate_key IS NOT NULL THEN 'review duplicate account before cleanup'
      WHEN nu.appears_test_or_demo THEN 'review test/demo account for later cleanup'
      ELSE 'no cleanup recommendation from test/duplicate heuristic'
    END AS recommended_cleanup_action
  FROM normalized_users nu
  LEFT JOIN duplicate_keys dk ON dk.duplicate_key = nu.duplicate_key
  WHERE nu.appears_test_or_demo OR dk.duplicate_key IS NOT NULL
  ORDER BY nu.appears_test_or_demo DESC, nu.appears_duplicated DESC, nu.created_at DESC
`);

const companies: any[] = [];
for (const companyId of companyIdsToInspect) {
  const [companyRes, scheduleRes, workerRes, punchRes, entryRes, itemRes, scheduleShiftRes, orphanPunchRes, orphanEntryRes] = await Promise.all([
    db.execute(sql`SELECT id, name FROM companies WHERE id = ${companyId}`),
    db.execute(sql`SELECT id, name, type, is_active, transaction_day_offset, semi_monthly_day_1, semi_monthly_day_2 FROM pay_period_schedules WHERE company_id = ${companyId} ORDER BY is_active DESC, created_at DESC`),
    db.execute(sql`
      SELECT w.id, w.person_id, u.id AS user_id, w.company_id, w.first_name, w.last_name, w.status, w.is_active,
             w.worker_type, w.worker_group, w.pay_type, w.compensation_type, w.pay_rate, w.hire_date,
             w.termination_date, w.department
      FROM workers w
      LEFT JOIN users u ON u.worker_id = w.id
      WHERE w.company_id = ${companyId} AND (${namePredicate})
      ORDER BY w.first_name, w.last_name
    `),
    db.execute(sql`
      SELECT worker_id, approval_status, punch_type, COUNT(*)::int AS punches,
             MIN(punch_time) AS first_punch, MAX(punch_time) AS last_punch
      FROM time_punches
      WHERE company_id = ${companyId}
        AND punch_time >= ${start + "T00:00:00"}
        AND punch_time <= ${end + "T23:59:59"}
      GROUP BY worker_id, approval_status, punch_type
      ORDER BY worker_id, approval_status, punch_type
    `),
    db.execute(sql`
      SELECT worker_id, status, source, COUNT(*)::int AS entries,
             COALESCE(SUM(CAST(total_hours AS numeric)),0)::text AS hours,
             MIN(date) AS first_date, MAX(date) AS last_date
      FROM time_entries
      WHERE company_id = ${companyId} AND date >= ${start} AND date <= ${end}
      GROUP BY worker_id, status, source
      ORDER BY worker_id, status, source
    `),
    db.execute(sql`
      SELECT pi.worker_id, pi.id AS payroll_item_id, pi.payroll_run_id,
             pi.regular_hours, pi.overtime_hours, pi.double_time_hours, pi.gross_pay, pi.net_pay
      FROM payroll_items pi
      JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
      WHERE pr.company_id = ${companyId} AND pr.pay_date = ${payDate}
      ORDER BY pi.worker_id, pi.id
    `),
    db.execute(sql`
      SELECT worker_id, status, COUNT(*)::int AS shifts, MIN(date) AS first_shift, MAX(date) AS last_shift
      FROM schedules
      WHERE company_id = ${companyId} AND date >= ${start} AND date <= ${end}
      GROUP BY worker_id, status
      ORDER BY worker_id, status
    `),
    db.execute(sql`
      SELECT tp.company_id, COUNT(*)::int AS punches_without_company
      FROM time_punches tp
      LEFT JOIN companies c ON c.id = tp.company_id
      WHERE c.id IS NULL
      GROUP BY tp.company_id
    `),
    db.execute(sql`
      SELECT te.company_id, COUNT(*)::int AS entries_without_company
      FROM time_entries te
      LEFT JOIN companies c ON c.id = te.company_id
      WHERE c.id IS NULL
      GROUP BY te.company_id
    `),
  ]);

  const companyRuns = runs.filter((r: any) => r.company_id === companyId);
  const itemsByWorker = new Map<string, any[]>();
  for (const item of rows(itemRes)) itemsByWorker.set(item.worker_id, [...(itemsByWorker.get(item.worker_id) || []), item]);

  const grouped = (rs: any[]) => {
    const out = new Map<string, any[]>();
    for (const r of rs) out.set(r.worker_id, [...(out.get(r.worker_id) || []), r]);
    return out;
  };
  const punchesByWorker = grouped(rows(punchRes));
  const entriesByWorker = grouped(rows(entryRes));
  const shiftsByWorker = grouped(rows(scheduleShiftRes));

  companies.push({
    company: rows(companyRes)[0] || { id: companyId },
    payrollRuns: companyRuns,
    activePayPeriodSchedules: rows(scheduleRes).filter((s: any) => s.is_active),
    allPayPeriodSchedules: rows(scheduleRes),
    fkIntegrity: {
      orphanTimePunchCompanyIds: rows(orphanPunchRes),
      orphanTimeEntryCompanyIds: rows(orphanEntryRes),
      note: "If the earlier FK error happened during INSERT, PostgreSQL rejected that punch row; this report checks for persisted orphan rows and missing downstream entries for the named workers.",
    },
    workers: rows(workerRes).map((w: any) => {
      const timeEntries = entriesByWorker.get(w.id) || [];
      const payrollItems = itemsByWorker.get(w.id) || [];
      const approvedHours = timeEntries
        .filter((e: any) => e.status === "approved")
        .reduce((sum: number, e: any) => sum + Number(e.hours || 0), 0);
      const rejectedHours = timeEntries
        .filter((e: any) => e.status === "rejected")
        .reduce((sum: number, e: any) => sum + Number(e.hours || 0), 0);
      return {
        name: `${w.first_name} ${w.last_name}`,
        workerRecord: {
          workerId: w.id,
          userId: w.user_id,
          personId: w.person_id,
          companyId: w.company_id,
          activeStatus: w.is_active,
          employmentStatus: w.status,
          workerType: w.worker_type,
          payType: w.pay_type,
          hireDate: w.hire_date,
          terminationDate: w.termination_date,
          department: w.department,
        },
        timeData: {
          schedules: shiftsByWorker.get(w.id) || [],
          timePunches: punchesByWorker.get(w.id) || [],
          generatedTimeEntries: timeEntries,
          approvedEntryHours: approvedHours,
          rejectedEntryHours: rejectedHours,
        },
        payroll: {
          payrollItems,
          includedInPayrollItems: payrollItems.length > 0,
          inclusionExclusionReason: payrollItems.length > 0
            ? "payroll item exists for matching payDate run"
            : approvedHours > 0
              ? "approved time entries exist, but no payroll item exists for matching payDate run"
              : timeEntries.length > 0
                ? "time entries exist, but none are approved hours"
                : "no time entries persisted for this company/date range",
        },
        timeEntriesPage: {
          endpoint: `/api/time-entries?startDate=${start}&endDate=${end}&companyId=${companyId}&workerId=${w.id}`,
          workerNameLookupEndpoint: `/api/workers?companyId=${companyId}`,
          expectedVisibility: timeEntries.length > 0 ? "time entry rows should be returned by the date/company filter; names require this worker to be present in /api/workers for the same company" : "no rows for the date/company filter, so the worker will not appear in the Time Entries table",
        },
      };
    }),
  });
}

console.log(JSON.stringify({
  period: { start, end, payDate, companyId: companyIdArg || null, names },
  companies,
  duplicateAndTestUsers: rows(duplicateUsersRes).map((u: any) => ({
    userId: u.id,
    email: u.email,
    username: u.username,
    name: [u.first_name, u.last_name].filter(Boolean).join(" ") || null,
    companyId: u.company_id,
    companyName: u.company_name,
    role: u.role,
    createdAt: u.created_at,
    lastLogin: u.last_login,
    appearsDuplicated: u.appears_duplicated,
    appearsTestOrDemo: u.appears_test_or_demo,
    recommendedCleanupAction: u.recommended_cleanup_action,
  })),
}, null, 2));
