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
 *  - Override layers: state < company < worker < wage-order (higher layer wins).
 *  - Wage-order rules (tagged with wageOrderNumber) override generic state rules
 *    when the company's active IWC wage order matches the rule's order number.
 *  - Sick-leave validation checks employer cap and accrual rate against CA minimums.
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
  /** IWC Wage Order this rule applies to (null = applies to all orders) */
  wageOrderNumber?: string | null;
}

/** Which enforcement checks are active (from company compliance profile) */
export interface ComplianceEnforceFlags {
  enforceDailyOt?: boolean;
  enforceWeeklyOt?: boolean;
  enforceSeventhDay?: boolean;
  enforceMealBreaks?: boolean;
  enforceRestBreaks?: boolean;
  enforceMinWage?: boolean;
  enforceFinalPaycheck?: boolean;
}

export interface ComplianceContext {
  worker: ComplianceWorker;
  entries: ComplianceTimeEntry[];
  rules: LaborRuleInput[];
  periodStart: string;
  periodEnd: string;
  /** Total gross pay for this period (used for split-shift, reporting-time calcs) */
  grossPay?: number;
  /**
   * Enforcement flags from the company compliance profile.
   * When a flag is false the corresponding rule category is skipped.
   * When undefined (omitted) the check defaults to enabled.
   */
  enforceFlags?: ComplianceEnforceFlags;
  /**
   * Company-level local minimum wage override (dollars/hour).
   * Takes precedence over the state labor rule but is superseded by a worker-level override.
   * Use to model city/county minimum wages (e.g. LA City $17.28/hr, SF $18.67/hr).
   */
  companyLocalMinWage?: number | null;
  /**
   * Worker-level minimum wage override (dollars/hour).
   * Takes precedence over both the state rule and the company local minimum wage when set.
   */
  workerMinWageOverride?: number | null;
  /**
   * Active IWC Wage Order number for the company (e.g. "4", "14", "15").
   * When set, wage-order-specific rules are preferred over generic state rules.
   */
  wageOrderNumber?: string | null;
  /**
   * Employer's configured sick leave annual cap in hours (from accrual account maxBalance).
   * Used to validate against CA minimum (40 usable hours per year, SB 616 2024).
   * null = not configured (skip cap validation).
   */
  sickLeaveMaxHours?: number | null;
  /**
   * Employer's sick leave accrual divisor: how many hours worked earn 1 sick hour.
   * CA minimum: 1 hour per 30 hours worked (divisor = 30).
   * A divisor > 30 means the employer accrues slower than CA requires.
   * null = not configured or using per-period accrual (skip divisor validation).
   */
  sickLeaveAccrualDivisor?: number | null;
  /**
   * Worker's current sick leave balance in hours (from accrual_balances).
   * Used to warn when balance is near the employer's annual cap.
   * null = not tracked.
   */
  sickLeaveBalance?: number | null;
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
  SICK_MAX_HOURS:      "sick_leave_max_hours",       // annual usable cap
  FINAL_DISCHARGE:     "final_paycheck_discharge",   // days (0 = immediately)
  FINAL_RESIGNATION:   "final_paycheck_resignation", // days (3 = 72 hrs)
  EXEMPT_MULTIPLIER:   "exempt_salary_multiplier",   // 2x (state min × 2080)
  SPLIT_SHIFT_PREMIUM: "split_shift_premium",        // flag (1 = enforce)
  REPORTING_TIME_MIN:  "reporting_time_min_pay",     // min hours to pay if sent home early
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolve the effective value for a rule type, respecting the full override hierarchy.
 *
 * Step 1 — Eligibility filter: rules tagged with a wageOrderNumber are only
 *   eligible when that number matches the active wage order. Rules with no
 *   wageOrderNumber (generic state rules) are always eligible. Rules tagged
 *   for a DIFFERENT wage order are excluded entirely — they must never bleed
 *   into a company on a different or unset wage order.
 *
 * Step 2 — Priority among eligible rules (highest wins):
 *   4 — wage-order-specific rule (wageOrderNumber === activeWageOrder)
 *   3 — worker-level override
 *   2 — company-level override
 *   1 — generic state rule (no wage-order tag)
 *
 * Step 3 — Tie-break: among equal-priority rules pick the highest value
 *   (most protective for the worker).
 */
function ruleVal(
  rules: LaborRuleInput[],
  type: string,
  fallback: number,
  activeWageOrder?: string | null,
): number {
  const matching = rules.filter(r => r.ruleType === type);
  if (matching.length === 0) return fallback;

  // Exclude rules tagged for a DIFFERENT wage order (they don't apply here)
  const eligible = matching.filter(r =>
    r.wageOrderNumber == null || r.wageOrderNumber === (activeWageOrder ?? null),
  );
  if (eligible.length === 0) return fallback;

  const priority = (r: LaborRuleInput): number => {
    if (r.wageOrderNumber && activeWageOrder && r.wageOrderNumber === activeWageOrder) return 4;
    if (r.overrideLevel === "worker")  return 3;
    if (r.overrideLevel === "company") return 2;
    return 1; // generic state rule
  };

  // Among eligible rules: highest priority wins; tie → highest value (most protective)
  const best = eligible.reduce((a, b) => {
    const pa = priority(a);
    const pb = priority(b);
    if (pa !== pb) return pa > pb ? a : b;
    return a.ruleValue >= b.ruleValue ? a : b;
  });

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
  // Use timestamp arithmetic to safely copy and adjust — avoids mutating d
  const sunTs = d.getTime() - dayOfWeek * 86400000;
  const sun = new Date(sunTs);
  // Format as YYYY-MM-DD using local date parts to avoid UTC/local skew
  const yr  = sun.getFullYear();
  const mo  = String(sun.getMonth() + 1).padStart(2, "0");
  const dy  = String(sun.getDate()).padStart(2, "0");
  return `${yr}-${mo}-${dy}`;
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
      const sunTs = isoToDate(sun).getTime() + i * 86400000;
      const d = new Date(sunTs);
      const yr = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, "0");
      const dy = String(d.getDate()).padStart(2, "0");
      weekDates.push(`${yr}-${mo}-${dy}`);
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

/** Helper: returns true if an enforcement flag is active (defaults to true when absent) */
function isEnforced(flags: ComplianceEnforceFlags | undefined, key: keyof ComplianceEnforceFlags): boolean {
  if (!flags || flags[key] === undefined) return true;
  return !!flags[key];
}

export function evaluateCompliance(ctx: ComplianceContext): ComplianceResult[] {
  const { worker, entries, rules } = ctx;
  const ef = ctx.enforceFlags;
  const wo = ctx.wageOrderNumber ?? null; // active IWC wage order
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
  // Priority: worker-level override > company local min wage > state rule
  const minWage = ctx.workerMinWageOverride != null && ctx.workerMinWageOverride > 0
    ? ctx.workerMinWageOverride
    : ctx.companyLocalMinWage != null && ctx.companyLocalMinWage > 0
      ? ctx.companyLocalMinWage
      : ruleVal(rules, R.MIN_WAGE, 16.50, wo);
  const minWageSource = ctx.workerMinWageOverride != null && ctx.workerMinWageOverride > 0
    ? "worker_override"
    : ctx.companyLocalMinWage != null && ctx.companyLocalMinWage > 0
      ? "company_local"
      : "state_rule";
  const effectiveRate = worker.payRate;
  if (isEnforced(ef, "enforceMinWage") && !isExempt && worker.workerType === "employee" && effectiveRate < minWage) {
    const sourceLabel = minWageSource === "worker_override" ? "worker-level"
      : minWageSource === "company_local" ? "company local"
      : "CA state";
    results.push({
      ruleType: R.MIN_WAGE,
      ruleId: ruleId(rules, R.MIN_WAGE),
      severity: "block",
      message: `Worker pay rate $${effectiveRate.toFixed(2)}/hr is below ${sourceLabel} minimum wage $${minWage.toFixed(2)}/hr.`,
      detail: { workerId: worker.id, payRate: effectiveRate, minWage, source: minWageSource },
    });
  }

  // ── Exempt classification salary basis test ───────────────────────────────
  // Only applies to workers who ARE classified as exempt — block if their salary
  // falls below the statutory threshold (2× min wage × 2080 hrs/year).
  const exemptMultiplier = ruleVal(rules, R.EXEMPT_MULTIPLIER, 2, wo);
  if (isEnforced(ef, "enforceMinWage") && isExempt && worker.workerType === "employee") {
    // payRate >= 500 is treated as already annual; otherwise multiply by 2080
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
  if (isEnforced(ef, "enforceFinalPaycheck") && worker.status === "terminated" && worker.terminationDate && ctx.periodEnd >= worker.terminationDate) {
    const dischargeDays = ruleVal(rules, R.FINAL_DISCHARGE, 0, wo);
    const resignDays    = ruleVal(rules, R.FINAL_RESIGNATION, 3, wo);
    results.push({
      ruleType: "final_paycheck_timing",
      ruleId: ruleId(rules, R.FINAL_DISCHARGE),
      severity: "warn",
      message: `Terminated worker requires final paycheck: immediately on discharge (${dischargeDays}d) or within ${resignDays} days on resignation. Verify paycheck was issued on time.`,
      detail: { workerId: worker.id, terminationDate: worker.terminationDate, dischargeDays, resignDays },
    });
  }

  // ── Sick leave compliance validation ──────────────────────────────────────
  // CA SB 616 (effective Jan 1, 2024):
  //   • Minimum accrual rate: 1 hour per 30 hours worked
  //   • Minimum usable annual hours: 40 (5 days)
  //   • Accrual cap: 80 hours
  //
  // We validate the EMPLOYER'S sick leave configuration against these minimums.
  // A cap below 40h or accrual divisor above 30 (slower rate) is a violation.
  const caMinSickUsable  = ruleVal(rules, R.SICK_MAX_HOURS, 40, wo);   // CA required usable floor
  const caMinAccrualDiv  = ruleVal(rules, R.SICK_ACCRUAL_RATE, 30, wo); // CA required divisor (max allowed)

  // Sick leave validation is always enforced — it is independent of the min-wage
  // enforcement toggle. CA SB 616 sick leave obligations apply regardless of whether
  // the company has opted to suppress minimum wage checks.
  if (worker.workerType === "employee") {
    // 1. Employer cap below CA minimum usable hours → block
    if (ctx.sickLeaveMaxHours != null && ctx.sickLeaveMaxHours < caMinSickUsable) {
      results.push({
        ruleType: R.SICK_MAX_HOURS,
        ruleId: ruleId(rules, R.SICK_MAX_HOURS),
        severity: "block",
        message: `Employer sick leave cap (${ctx.sickLeaveMaxHours}h) is below CA minimum usable annual sick leave (${caMinSickUsable}h per SB 616). Update the sick leave account cap to at least ${caMinSickUsable} hours.`,
        detail: { workerId: worker.id, employerCap: ctx.sickLeaveMaxHours, caMinimum: caMinSickUsable, wageOrder: wo },
      });
    }

    // 2. Employer accrual rate slower than CA minimum → block
    // Divisor is hours worked per 1 sick hour earned; higher = slower.
    if (ctx.sickLeaveAccrualDivisor != null && ctx.sickLeaveAccrualDivisor > caMinAccrualDiv) {
      results.push({
        ruleType: R.SICK_ACCRUAL_RATE,
        ruleId: ruleId(rules, R.SICK_ACCRUAL_RATE),
        severity: "block",
        message: `Employer sick leave accrual rate (1 hr per ${ctx.sickLeaveAccrualDivisor.toFixed(0)} hrs worked) is slower than CA minimum (1 hr per ${caMinAccrualDiv.toFixed(0)} hrs worked, per SB 616). Adjust the accrual account configuration.`,
        detail: { workerId: worker.id, employerDivisor: ctx.sickLeaveAccrualDivisor, caMaxDivisor: caMinAccrualDiv, wageOrder: wo },
      });
    }

    // 3. Worker balance near employer cap → warn (upcoming accrual will be lost)
    if (ctx.sickLeaveBalance != null && ctx.sickLeaveMaxHours != null && ctx.sickLeaveMaxHours > 0) {
      const capPct = ctx.sickLeaveBalance / ctx.sickLeaveMaxHours;
      if (capPct >= 0.9) {
        results.push({
          ruleType: R.SICK_MAX_HOURS,
          ruleId: ruleId(rules, R.SICK_MAX_HOURS),
          severity: "warn",
          message: `Worker sick leave balance (${ctx.sickLeaveBalance.toFixed(1)}h) is ${Math.round(capPct * 100)}% of the ${ctx.sickLeaveMaxHours}h cap — future accruals may be forfeited. Encourage time-off usage.`,
          detail: { workerId: worker.id, balance: ctx.sickLeaveBalance, cap: ctx.sickLeaveMaxHours, pct: Math.round(capPct * 100) },
        });
      }
    }
  }

  // ── Per-day / hourly rules (skip for exempt) ──────────────────────────────
  if (isExempt || entries.length === 0) return results;

  const dailyOt1   = ruleVal(rules, R.DAILY_OT_1, 8, wo);
  const dailyOt2   = ruleVal(rules, R.DAILY_OT_2, 12, wo);
  const seventh    = ruleVal(rules, R.SEVENTH_DAY_OT, 8, wo);
  const weeklyOt   = ruleVal(rules, R.WEEKLY_OT, 40, wo);
  const meal1Trig  = ruleVal(rules, R.MEAL_BREAK_1, 5, wo);
  const meal2Trig  = ruleVal(rules, R.MEAL_BREAK_2, 10, wo);
  const restPeriod = ruleVal(rules, R.REST_BREAK_PERIOD, 4, wo);
  const splitFlag  = ruleVal(rules, R.SPLIT_SHIFT_PREMIUM, 1, wo);

  // 7th-day detection scoped to CA workweek (Sun–Sat)
  const seventhDayDates = consecutive7thDayInWorkweek(entries);

  // ── Group entries by CA workweek (Sun–Sat) for per-week OT accumulation ──
  // Weekly OT must be computed within each workweek independently to avoid
  // cross-week accumulation (false positives on multi-week payroll periods).
  const entriesByWeek: Record<string, ComplianceTimeEntry[]> = {};
  for (const entry of entries) {
    const sun = workweekSunday(entry.date);
    if (!entriesByWeek[sun]) entriesByWeek[sun] = [];
    entriesByWeek[sun].push(entry);
  }

  for (const entry of entries) {
    const h = entry.totalHours;
    if (h <= 0) continue;

    const is7th = seventhDayDates.has(entry.date);

    // ── Daily OT violations ───────────────────────────────────────────────
    if (!is7th) {
      if (isEnforced(ef, "enforceDailyOt")) {
        if (h > dailyOt2) {
          results.push({
            ruleType: R.DAILY_OT_2,
            ruleId: ruleId(rules, R.DAILY_OT_2),
            severity: "warn",
            message: `CA double time: ${h.toFixed(2)}h on ${entry.date} exceeds ${dailyOt2}h threshold (2× on excess hours).`,
            detail: { date: entry.date, hours: h, threshold: dailyOt2, rate: "2x", wageOrder: wo },
          });
        } else if (h > dailyOt1) {
          results.push({
            ruleType: R.DAILY_OT_1,
            ruleId: ruleId(rules, R.DAILY_OT_1),
            severity: "info",
            message: `CA daily OT: ${h.toFixed(2)}h on ${entry.date} exceeds ${dailyOt1}h (1.5× applies to excess ${(h - dailyOt1).toFixed(2)}h).${wo ? ` [WO-${wo}]` : ""}`,
            detail: { date: entry.date, hours: h, threshold: dailyOt1, rate: "1.5x", wageOrder: wo },
          });
        }
      }
    } else {
      // 7th consecutive day in CA workweek — all hours at 1.5×; >threshold at 2×
      if (isEnforced(ef, "enforceSeventhDay")) {
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
      }
    }

    // ── Meal break check ──────────────────────────────────────────────────
    if (isEnforced(ef, "enforceMealBreaks")) {
      const breakHours = (entry.breakMinutes ?? 0) / 60;
      if (h > meal2Trig && breakHours < 1.0) {
        results.push({
          ruleType: R.MEAL_BREAK_2,
          ruleId: ruleId(rules, R.MEAL_BREAK_2),
          severity: "warn",
          message: `Possible second meal break violation on ${entry.date}: ${h.toFixed(2)}h shift, only ${(breakHours * 60).toFixed(0)}min break recorded (second 30-min meal required after ${meal2Trig}h).`,
          detail: { date: entry.date, hoursWorked: h, breakHours, trigger: meal2Trig, wageOrder: wo },
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
    }

    // ── Rest break entitlement check ──────────────────────────────────────
    // CA requires one 10-min paid rest break per restPeriod hours (default 4h).
    // We have no explicit rest-break punch records, so we cannot confirm whether
    // breaks were provided or missed. This is surfaced as INFO only — not a warn —
    // to avoid generating false-positive violations on every qualifying shift.
    // Upgrade to warn/block when rest-break punch data is available.
    if (isEnforced(ef, "enforceRestBreaks")) {
      const restEntitlements = Math.floor(h / restPeriod);
      if (restEntitlements > 0) {
        results.push({
          ruleType: R.REST_BREAK_PERIOD,
          ruleId: ruleId(rules, R.REST_BREAK_PERIOD),
          severity: "info",
          message: `Rest break entitlement on ${entry.date}: ${restEntitlements} × 10-min paid rest break(s) required for ${h.toFixed(2)}h shift. Verify breaks were provided.`,
          detail: { date: entry.date, hoursWorked: h, entitlements: restEntitlements, breakPeriodHours: restPeriod },
        });
      }
    }

    // ── Split-shift premium check ─────────────────────────────────────────
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

  // ── Weekly OT check — computed per CA workweek (Sun–Sat) ─────────────────
  // For each workweek in the period, sum regular hours (after daily OT removal)
  // for non-7th-day entries, then flag if the weekly total exceeds weeklyOt.
  if (isEnforced(ef, "enforceWeeklyOt")) {
    for (const [weekSun, weekEntries] of Object.entries(entriesByWeek)) {
      let weeklyRegularHours = 0;
      for (const we of weekEntries) {
        if (we.totalHours <= 0) continue;
        if (seventhDayDates.has(we.date)) continue; // 7th-day hours excluded (already OT)
        // Regular hours per day are capped at dailyOt1 (hours above that are daily OT)
        weeklyRegularHours += Math.min(we.totalHours, dailyOt1);
      }
      if (weeklyRegularHours > weeklyOt) {
        const excess = weeklyRegularHours - weeklyOt;
        const weekEndTs = isoToDate(weekSun).getTime() + 6 * 86400000;
        const we = new Date(weekEndTs);
        const weekEnd = `${we.getFullYear()}-${String(we.getMonth() + 1).padStart(2, "0")}-${String(we.getDate()).padStart(2, "0")}`;
        results.push({
          ruleType: R.WEEKLY_OT,
          ruleId: ruleId(rules, R.WEEKLY_OT),
          severity: "info",
          message: `Weekly OT (week of ${weekSun}–${weekEnd}): ${weeklyRegularHours.toFixed(2)} regular hours exceeds ${weeklyOt}h — ${excess.toFixed(2)}h at 1.5× applies.${wo ? ` [WO-${wo}]` : ""}`,
          detail: { weekStart: weekSun, weekEnd, weeklyHours: weeklyRegularHours, threshold: weeklyOt, excessHours: excess, wageOrder: wo },
        });
      }
    }
  }

  return results;
}
