/**
 * California Compliance Engine — pure evaluation logic (no DB calls).
 *
 * evaluateCompliance(ctx) applies all applicable labor rules to a worker's
 * time entries and pay data, returning structured ComplianceResult objects.
 * The caller is responsible for writing compliance_audit_events to the DB.
 *
 * Design:
 *  - Rules are passed in as LaborRule rows resolved by getApplicableRules().
 *  - Overtime calculation uses CA daily-first bucketing:
 *      1. Daily OT/DT is computed first per day.
 *      2. Weekly OT is computed on remaining regular hours (after daily OT).
 *      3. 7th-consecutive-day rule overrides the daily OT thresholds for day 7.
 *  - All monetary thresholds are in USD; all hours are in decimal.
 */

export type ComplianceSeverity = "block" | "warn" | "info";

export interface ComplianceResult {
  ruleType: string;
  ruleId: string | null;
  severity: ComplianceSeverity;
  message: string;
  detail: Record<string, unknown>;
}

export interface ComplianceTimeEntry {
  date: string;           // YYYY-MM-DD
  totalHours: number;
  breakMinutes: number;   // unpaid break minutes recorded
  scheduledHours?: number;
  clockIn?: string | null;
  clockOut?: string | null;
}

export interface ComplianceWorker {
  id: string;
  payRate: number;        // hourly rate (or annual salary / 2080 for salaried)
  payType: string;        // "hourly" | "salary"
  workerType: string;     // "employee" | "contractor"
  status: string;         // "active" | "terminated" etc.
  terminationDate?: string | null;
  hireDate?: string | null;
  /** From worker_compliance_profiles */
  exemptStatus?: string;
  abcTestA?: boolean | null;
  abcTestB?: boolean | null;
  abcTestC?: boolean | null;
}

export interface LaborRuleInput {
  id: string;
  ruleType: string;
  ruleValue: number;
  ruleUnit?: string | null;
  overrideLevel?: string | null;
}

export interface ComplianceContext {
  worker: ComplianceWorker;
  entries: ComplianceTimeEntry[];
  rules: LaborRuleInput[];
  periodStart: string;
  periodEnd: string;
  /** Total gross pay for this period (used for split-shift, reporting-time calcs) */
  grossPay?: number;
}

// ── Rule type constants ───────────────────────────────────────────────────────
const R = {
  DAILY_OT_1:          "daily_ot_threshold_1",       // hours → 1.5x starts
  DAILY_OT_2:          "daily_ot_threshold_2",       // hours → 2x starts
  SEVENTH_DAY_OT:      "seventh_day_ot_threshold",   // hours into 7th day → 2x starts
  WEEKLY_OT:           "weekly_ot_threshold",        // hours → weekly OT
  MEAL_BREAK_1:        "meal_break_trigger_1",       // hours worked → first meal required
  MEAL_BREAK_2:        "meal_break_trigger_2",       // hours → second meal required
  REST_BREAK_PERIOD:   "rest_break_period",          // hours per rest break entitlement
  MIN_WAGE:            "min_wage",                   // $/hr
  SICK_ACCRUAL_RATE:   "sick_leave_accrual_rate",    // 1 hr per N hrs worked
  SICK_MAX_HOURS:      "sick_leave_max_hours",       // annual cap
  FINAL_DISCHARGE:     "final_paycheck_discharge",   // days (0 = immediately)
  FINAL_RESIGNATION:   "final_paycheck_resignation", // days (3 = 72 hrs)
  EXEMPT_MULTIPLIER:   "exempt_salary_multiplier",   // 2x (state min × 2080)
  SPLIT_SHIFT_PREMIUM: "split_shift_premium",        // flag (1 = enforce)
  REPORTING_TIME_MIN:  "reporting_time_min_pay",     // min hours to pay if sent home early
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function ruleVal(rules: LaborRuleInput[], type: string, fallback: number): number {
  const r = rules.find(r => r.ruleType === type);
  return r != null ? Number(r.ruleValue) : fallback;
}

function ruleId(rules: LaborRuleInput[], type: string): string | null {
  return rules.find(r => r.ruleType === type)?.id ?? null;
}

function isoToDate(s: string): Date {
  return new Date(s + "T12:00:00");
}

function daysBetween(a: string, b: string): number {
  return Math.round((isoToDate(b).getTime() - isoToDate(a).getTime()) / 86400000);
}

function consecutive7thDay(entries: ComplianceTimeEntry[], periodStart: string): Set<string> {
  // Find any date within the period that is the 7th consecutive day worked in a 7-day block.
  // CA rule: 7 consecutive days within a single workweek (Sun–Sat).
  const workedDates = new Set(entries.filter(e => e.totalHours > 0).map(e => e.date));
  const result = new Set<string>();

  for (const entry of entries) {
    // Check 7 consecutive days ending on this date
    const d = isoToDate(entry.date);
    let allWorked = true;
    for (let i = 6; i >= 1; i--) {
      const prev = new Date(d);
      prev.setDate(d.getDate() - i);
      const key = prev.toISOString().split("T")[0];
      if (!workedDates.has(key)) { allWorked = false; break; }
    }
    if (allWorked && workedDates.has(entry.date)) {
      result.add(entry.date);
    }
  }
  return result;
}

// ── Main evaluator ────────────────────────────────────────────────────────────

export function evaluateCompliance(ctx: ComplianceContext): ComplianceResult[] {
  const { worker, entries, rules } = ctx;
  const results: ComplianceResult[] = [];

  // Skip evaluation for exempt salaried workers on most hourly rules
  const isExempt = (worker.exemptStatus ?? "nonexempt") !== "nonexempt";

  // ── Contractor ABC test warning ───────────────────────────────────────────
  if (worker.workerType === "contractor") {
    const failsAbc: string[] = [];
    if (worker.abcTestA === false) failsAbc.push("A (free from control)");
    if (worker.abcTestB === false) failsAbc.push("B (outside usual business)");
    if (worker.abcTestC === false) failsAbc.push("C (independent trade/occupation)");
    if (failsAbc.length > 0) {
      results.push({
        ruleType: "contractor_abc_test",
        ruleId: null,
        severity: "warn",
        message: `Contractor may not meet CA ABC test criteria: factor(s) ${failsAbc.join(", ")} failed.`,
        detail: { workerId: worker.id, failedFactors: failsAbc },
      });
    }
  }

  // ── Minimum wage check ────────────────────────────────────────────────────
  const minWage = ruleVal(rules, R.MIN_WAGE, 16.50);
  const effectiveRate = worker.payRate;
  if (!isExempt && worker.workerType === "employee" && effectiveRate < minWage) {
    results.push({
      ruleType: R.MIN_WAGE,
      ruleId: ruleId(rules, R.MIN_WAGE),
      severity: "block",
      message: `Worker pay rate $${effectiveRate.toFixed(2)}/hr is below CA minimum wage $${minWage.toFixed(2)}/hr.`,
      detail: { workerId: worker.id, payRate: effectiveRate, minWage },
    });
  }

  // ── Exempt classification salary basis test ───────────────────────────────
  const exemptMultiplier = ruleVal(rules, R.EXEMPT_MULTIPLIER, 2);
  if (worker.payType === "salary" && !isExempt) {
    // Salary is annual; payRate for salary workers = annual figure
    const annualSalary = worker.payRate * 2080; // if payRate is hourly-equiv; handle both
    // payRate may be annual already if payType === "salary"
    const actualAnnual = worker.payRate >= 100 ? worker.payRate : worker.payRate * 2080;
    const basisThreshold = minWage * exemptMultiplier * 2080;
    if (actualAnnual < basisThreshold) {
      results.push({
        ruleType: R.EXEMPT_MULTIPLIER,
        ruleId: ruleId(rules, R.EXEMPT_MULTIPLIER),
        severity: "warn",
        message: `Salaried worker annual salary $${actualAnnual.toLocaleString()} is below CA exempt salary basis threshold $${basisThreshold.toLocaleString()} (${exemptMultiplier}× min wage × 2080).`,
        detail: { workerId: worker.id, annualSalary: actualAnnual, threshold: basisThreshold },
      });
    }
  }

  // ── Final paycheck timing ─────────────────────────────────────────────────
  if (worker.status === "terminated" && worker.terminationDate && ctx.periodEnd >= worker.terminationDate) {
    const dischargeDays = ruleVal(rules, R.FINAL_DISCHARGE, 0);
    const resignDays    = ruleVal(rules, R.FINAL_RESIGNATION, 3);
    results.push({
      ruleType: "final_paycheck_timing",
      ruleId: ruleId(rules, R.FINAL_DISCHARGE),
      severity: "warn",
      message: `Terminated worker requires final paycheck: immediately on discharge (${dischargeDays}d) or within ${resignDays} days on resignation.`,
      detail: { workerId: worker.id, terminationDate: worker.terminationDate, dischargeDays, resignDays },
    });
  }

  // ── Per-day / hourly rules (skip for exempt) ──────────────────────────────
  if (isExempt || entries.length === 0) return results;

  const dailyOt1   = ruleVal(rules, R.DAILY_OT_1, 8);
  const dailyOt2   = ruleVal(rules, R.DAILY_OT_2, 12);
  const seventh    = ruleVal(rules, R.SEVENTH_DAY_OT, 8);
  const weeklyOt   = ruleVal(rules, R.WEEKLY_OT, 40);
  const meal1Trig  = ruleVal(rules, R.MEAL_BREAK_1, 5);
  const meal2Trig  = ruleVal(rules, R.MEAL_BREAK_2, 10);
  const restPeriod = ruleVal(rules, R.REST_BREAK_PERIOD, 4);

  const seventhDayDates = consecutive7thDay(entries, ctx.periodStart);

  let weeklyRegularHours = 0;  // tracks regular (non-OT) hours for weekly OT test

  // ── Sick leave accrual quick check ────────────────────────────────────────
  const sickRate    = ruleVal(rules, R.SICK_ACCRUAL_RATE, 30);
  const totalWorked = entries.reduce((s, e) => s + e.totalHours, 0);
  const sickAccrued = totalWorked / sickRate;
  if (sickAccrued > 0) {
    results.push({
      ruleType: R.SICK_ACCRUAL_RATE,
      ruleId: ruleId(rules, R.SICK_ACCRUAL_RATE),
      severity: "info",
      message: `Worker accrued ~${sickAccrued.toFixed(2)} sick leave hours this period (1 hr per ${sickRate} hrs worked).`,
      detail: { workerId: worker.id, hoursWorked: totalWorked, accrued: sickAccrued },
    });
  }

  for (const entry of entries) {
    const h = entry.totalHours;
    if (h <= 0) continue;

    const is7th = seventhDayDates.has(entry.date);

    // ── Daily OT violations ───────────────────────────────────────────────
    if (!is7th) {
      if (h > dailyOt2) {
        results.push({
          ruleType: R.DAILY_OT_2,
          ruleId: ruleId(rules, R.DAILY_OT_2),
          severity: "warn",
          message: `CA double time: ${h.toFixed(2)}h on ${entry.date} exceeds ${dailyOt2}h threshold.`,
          detail: { date: entry.date, hours: h, threshold: dailyOt2, rate: "2x" },
        });
      } else if (h > dailyOt1) {
        results.push({
          ruleType: R.DAILY_OT_1,
          ruleId: ruleId(rules, R.DAILY_OT_1),
          severity: "info",
          message: `CA daily OT: ${h.toFixed(2)}h on ${entry.date} exceeds ${dailyOt1}h (1.5× applies to excess).`,
          detail: { date: entry.date, hours: h, threshold: dailyOt1, rate: "1.5x" },
        });
      }
      // Track regular hours (capped at dailyOt1) for weekly OT accumulation
      weeklyRegularHours += Math.min(h, dailyOt1);
    } else {
      // 7th consecutive day rules
      if (h > seventh) {
        results.push({
          ruleType: R.SEVENTH_DAY_OT,
          ruleId: ruleId(rules, R.SEVENTH_DAY_OT),
          severity: "warn",
          message: `CA 7th-day double time: ${h.toFixed(2)}h on ${entry.date} (7th consecutive day) exceeds ${seventh}h — 2× applies to hours beyond ${seventh}.`,
          detail: { date: entry.date, hours: h, threshold: seventh, rate: "2x" },
        });
      } else {
        results.push({
          ruleType: R.SEVENTH_DAY_OT,
          ruleId: ruleId(rules, R.SEVENTH_DAY_OT),
          severity: "info",
          message: `CA 7th-day OT: all ${h.toFixed(2)}h on ${entry.date} (7th consecutive day) paid at 1.5×.`,
          detail: { date: entry.date, hours: h, rate: "1.5x" },
        });
      }
      // 7th-day hours don't accumulate toward weekly threshold
    }

    // ── Meal break check ──────────────────────────────────────────────────
    const breakHours = (entry.breakMinutes ?? 0) / 60;
    if (h > meal2Trig && breakHours < 1.0) {
      results.push({
        ruleType: R.MEAL_BREAK_2,
        ruleId: ruleId(rules, R.MEAL_BREAK_2),
        severity: "warn",
        message: `Possible second meal break violation on ${entry.date}: ${h.toFixed(2)}h shift, only ${breakHours.toFixed(2)}h break recorded (second 30-min meal required after ${meal2Trig}h).`,
        detail: { date: entry.date, hoursWorked: h, breakHours, trigger: meal2Trig },
      });
    } else if (h > meal1Trig && breakHours < 0.5) {
      results.push({
        ruleType: R.MEAL_BREAK_1,
        ruleId: ruleId(rules, R.MEAL_BREAK_1),
        severity: "warn",
        message: `Possible meal break violation on ${entry.date}: ${h.toFixed(2)}h shift, only ${(breakHours * 60).toFixed(0)}min break recorded (30-min meal required after ${meal1Trig}h).`,
        detail: { date: entry.date, hoursWorked: h, breakMinutes: entry.breakMinutes, trigger: meal1Trig },
      });
    }

    // ── Rest break check ──────────────────────────────────────────────────
    const restEntitlements = Math.floor(h / restPeriod);
    // We can only warn — we can't verify actual rest breaks from time entries alone
    if (restEntitlements > 0) {
      results.push({
        ruleType: R.REST_BREAK_PERIOD,
        ruleId: ruleId(rules, R.REST_BREAK_PERIOD),
        severity: "info",
        message: `${restEntitlements} × 10-min paid rest break(s) required on ${entry.date} (${h.toFixed(2)}h shift).`,
        detail: { date: entry.date, hoursWorked: h, entitlements: restEntitlements },
      });
    }

    // ── Reporting-time pay ────────────────────────────────────────────────
    if (entry.scheduledHours && entry.scheduledHours > 0 && h < entry.scheduledHours / 2) {
      const minPay = Math.max(2, entry.scheduledHours / 2);
      results.push({
        ruleType: R.REPORTING_TIME_MIN,
        ruleId: ruleId(rules, R.REPORTING_TIME_MIN),
        severity: "warn",
        message: `Reporting-time pay may apply on ${entry.date}: worked ${h.toFixed(2)}h of ${entry.scheduledHours}h scheduled. Employee may be entitled to pay for ${minPay.toFixed(2)}h minimum.`,
        detail: { date: entry.date, worked: h, scheduled: entry.scheduledHours, minPay },
      });
    }
  }

  // ── Weekly OT check ───────────────────────────────────────────────────────
  if (weeklyRegularHours > weeklyOt) {
    const excess = weeklyRegularHours - weeklyOt;
    results.push({
      ruleType: R.WEEKLY_OT,
      ruleId: ruleId(rules, R.WEEKLY_OT),
      severity: "info",
      message: `Weekly OT: ${weeklyRegularHours.toFixed(2)} regular hours this period exceeds ${weeklyOt}h threshold — ${excess.toFixed(2)}h at 1.5× applies (after daily OT adjustments).`,
      detail: { weeklyHours: weeklyRegularHours, threshold: weeklyOt, excessHours: excess },
    });
  }

  return results;
}
