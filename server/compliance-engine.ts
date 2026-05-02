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
 *      3. 7th-consecutive-day rule is scoped to the CA workweek (Sun–Sat).
 *  - Override layers: state < company < worker (higher layer wins).
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
  payRate: number;        // hourly rate (or annual salary for salaried)
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
  overrideLevel?: string | null;  // "state" | "company" | "worker"
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

/**
 * Resolve the effective value for a rule type, respecting the override layer hierarchy.
 * Layer priority: worker > company > state (highest wins).
 */
function ruleVal(rules: LaborRuleInput[], type: string, fallback: number): number {
  const matching = rules.filter(r => r.ruleType === type);
  if (matching.length === 0) return fallback;
  // Sort by override level: worker=3, company=2, state=1 — highest wins
  const priority = (r: LaborRuleInput) => {
    if (r.overrideLevel === "worker")  return 3;
    if (r.overrideLevel === "company") return 2;
    return 1; // state or undefined
  };
  const best = matching.reduce((a, b) => priority(a) >= priority(b) ? a : b);
  return Number(best.ruleValue);
}

function ruleId(rules: LaborRuleInput[], type: string): string | null {
  return rules.find(r => r.ruleType === type)?.id ?? null;
}

function isoToDate(s: string): Date {
  return new Date(s + "T12:00:00");
}

/**
 * Return the Sunday (start) of the CA workweek containing the given YYYY-MM-DD date.
 * CA Labor Code defines the workweek as 7 consecutive days — typically Sun–Sat,
 * but employers can designate a different start. We default to Sunday.
 */
function workweekSunday(dateStr: string): string {
  const d = isoToDate(dateStr);
  const dayOfWeek = d.getDay(); // 0=Sun
  const sun = new Date(d);
  sun.setDate(d.getDate() - dayOfWeek);
  return sun.toISOString().split("T")[0];
}

/**
 * Find all dates that are the 7th consecutive day worked within a CA workweek (Sun–Sat).
 * The 7th-day rule only applies if all 7 days of the same workweek are worked.
 */
function consecutive7thDayInWorkweek(entries: ComplianceTimeEntry[]): Set<string> {
  const workedDates = new Set(entries.filter(e => e.totalHours > 0).map(e => e.date));
  const result = new Set<string>();

  // Group worked dates by workweek (Sunday as start)
  const byWeek: Record<string, string[]> = {};
  for (const date of workedDates) {
    const sun = workweekSunday(date);
    if (!byWeek[sun]) byWeek[sun] = [];
    byWeek[sun].push(date);
  }

  for (const [sun, dates] of Object.entries(byWeek)) {
    if (dates.length < 7) continue; // Must have worked all 7 days

    // Build the full 7-day window Sun–Sat
    const weekDates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = isoToDate(sun);
      d.setDate(d.getDate() + i);
      weekDates.push(d.toISOString().split("T")[0]);
    }

    // All 7 must be worked
    if (weekDates.every(d => workedDates.has(d))) {
      // The 7th day (Saturday) is the 7th-day OT day
      result.add(weekDates[6]);
    }
  }

  return result;
}

/**
 * Detect split shifts: two or more separate work segments in one day with an
 * unpaid gap > 1 hour between them. We approximate this from clockIn/clockOut
 * if available, or flag as info if breakMinutes suggests a gap.
 * Returns true if the entry likely involves a split shift.
 */
function isSplitShift(entry: ComplianceTimeEntry): boolean {
  // If we have break minutes > 60 and worked hours > 0, treat as potential split shift.
  // A break ≥ 60 min (non-meal) that splits the day would trigger the premium.
  return (entry.breakMinutes ?? 0) > 60;
}

// ── Main evaluator ────────────────────────────────────────────────────────────

export function evaluateCompliance(ctx: ComplianceContext): ComplianceResult[] {
  const { worker, entries, rules } = ctx;
  const results: ComplianceResult[] = [];

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
  // Only applies to workers who ARE classified as exempt — warn if their salary
  // falls below the statutory threshold (2× min wage × 2080 hrs/year).
  const exemptMultiplier = ruleVal(rules, R.EXEMPT_MULTIPLIER, 2);
  if (isExempt && worker.workerType === "employee") {
    // payRate for salaried workers may be stored as annual or as hourly equivalent.
    // We treat payRate >= 500 as already annual; otherwise multiply by 2080.
    const actualAnnual = worker.payRate >= 500 ? worker.payRate : worker.payRate * 2080;
    const basisThreshold = minWage * exemptMultiplier * 2080;
    if (actualAnnual < basisThreshold) {
      results.push({
        ruleType: R.EXEMPT_MULTIPLIER,
        ruleId: ruleId(rules, R.EXEMPT_MULTIPLIER),
        severity: "block",
        message: `Exempt worker annual salary $${actualAnnual.toLocaleString()} is below CA exempt salary basis threshold $${basisThreshold.toLocaleString()} (${exemptMultiplier}× min wage × 2080 hrs). Exempt classification is invalid.`,
        detail: { workerId: worker.id, annualSalary: actualAnnual, threshold: basisThreshold, exemptStatus: worker.exemptStatus },
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
      message: `Terminated worker requires final paycheck: immediately on discharge (${dischargeDays}d) or within ${resignDays} days on resignation. Verify paycheck was issued on time.`,
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
  const splitFlag  = ruleVal(rules, R.SPLIT_SHIFT_PREMIUM, 1);

  // 7th-day detection scoped to CA workweek (Sun–Sat)
  const seventhDayDates = consecutive7thDayInWorkweek(entries);

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

  let weeklyRegularHours = 0; // tracks regular (non-OT) hours for weekly OT test

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
          message: `CA double time: ${h.toFixed(2)}h on ${entry.date} exceeds ${dailyOt2}h threshold (2× on excess hours).`,
          detail: { date: entry.date, hours: h, threshold: dailyOt2, rate: "2x" },
        });
      } else if (h > dailyOt1) {
        results.push({
          ruleType: R.DAILY_OT_1,
          ruleId: ruleId(rules, R.DAILY_OT_1),
          severity: "info",
          message: `CA daily OT: ${h.toFixed(2)}h on ${entry.date} exceeds ${dailyOt1}h (1.5× applies to excess ${(h - dailyOt1).toFixed(2)}h).`,
          detail: { date: entry.date, hours: h, threshold: dailyOt1, rate: "1.5x" },
        });
      }
      // Track regular hours (capped at dailyOt1) for weekly OT accumulation
      weeklyRegularHours += Math.min(h, dailyOt1);
    } else {
      // 7th consecutive day in CA workweek — all hours at 1.5×; >threshold at 2×
      if (h > seventh) {
        results.push({
          ruleType: R.SEVENTH_DAY_OT,
          ruleId: ruleId(rules, R.SEVENTH_DAY_OT),
          severity: "warn",
          message: `CA 7th-day double time: ${h.toFixed(2)}h on ${entry.date} (7th day of workweek) — first ${seventh}h at 1.5×, remaining ${(h - seventh).toFixed(2)}h at 2×.`,
          detail: { date: entry.date, hours: h, threshold: seventh, rate1: "1.5x", rate2: "2x" },
        });
      } else {
        results.push({
          ruleType: R.SEVENTH_DAY_OT,
          ruleId: ruleId(rules, R.SEVENTH_DAY_OT),
          severity: "info",
          message: `CA 7th-day OT: all ${h.toFixed(2)}h on ${entry.date} (7th day of CA workweek) paid at 1.5×.`,
          detail: { date: entry.date, hours: h, rate: "1.5x" },
        });
      }
      // 7th-day hours don't accumulate toward weekly threshold (already OT-rated)
    }

    // ── Meal break check ──────────────────────────────────────────────────
    const breakHours = (entry.breakMinutes ?? 0) / 60;
    if (h > meal2Trig && breakHours < 1.0) {
      results.push({
        ruleType: R.MEAL_BREAK_2,
        ruleId: ruleId(rules, R.MEAL_BREAK_2),
        severity: "warn",
        message: `Possible second meal break violation on ${entry.date}: ${h.toFixed(2)}h shift, only ${(breakHours * 60).toFixed(0)}min break recorded (second 30-min meal required after ${meal2Trig}h).`,
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
    if (restEntitlements > 0) {
      results.push({
        ruleType: R.REST_BREAK_PERIOD,
        ruleId: ruleId(rules, R.REST_BREAK_PERIOD),
        severity: "info",
        message: `${restEntitlements} × 10-min paid rest break(s) required on ${entry.date} (${h.toFixed(2)}h shift, 1 per ${restPeriod}h).`,
        detail: { date: entry.date, hoursWorked: h, entitlements: restEntitlements },
      });
    }

    // ── Split-shift premium check ─────────────────────────────────────────
    // CA split-shift premium: if a worker works two non-continuous shifts in one day
    // with a non-meal break >1h between them, they are entitled to an extra hour at
    // minimum wage. We detect this from breakMinutes > 60 (beyond meal break allowance).
    if (splitFlag >= 1 && isSplitShift(entry)) {
      const extraHourPremium = minWage;
      results.push({
        ruleType: R.SPLIT_SHIFT_PREMIUM,
        ruleId: ruleId(rules, R.SPLIT_SHIFT_PREMIUM),
        severity: "warn",
        message: `Split shift detected on ${entry.date} (${(entry.breakMinutes / 60).toFixed(1)}h break). CA split-shift premium may apply: +$${extraHourPremium.toFixed(2)} (1 hr at min wage $${minWage.toFixed(2)}).`,
        detail: { date: entry.date, hoursWorked: h, breakMinutes: entry.breakMinutes, premium: extraHourPremium },
      });
    }

    // ── Reporting-time pay ────────────────────────────────────────────────
    if (entry.scheduledHours && entry.scheduledHours > 0 && h < entry.scheduledHours / 2) {
      const minPayHours = Math.max(2, entry.scheduledHours / 2);
      results.push({
        ruleType: R.REPORTING_TIME_MIN,
        ruleId: ruleId(rules, R.REPORTING_TIME_MIN),
        severity: "warn",
        message: `Reporting-time pay may apply on ${entry.date}: worked ${h.toFixed(2)}h of ${entry.scheduledHours}h scheduled — employee entitled to pay for at least ${minPayHours.toFixed(2)}h.`,
        detail: { date: entry.date, worked: h, scheduled: entry.scheduledHours, minPayHours },
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
      message: `Weekly OT: ${weeklyRegularHours.toFixed(2)} regular hours this period exceeds ${weeklyOt}h threshold — ${excess.toFixed(2)}h at 1.5× (after CA daily-first OT adjustments).`,
      detail: { weeklyHours: weeklyRegularHours, threshold: weeklyOt, excessHours: excess },
    });
  }

  return results;
}
