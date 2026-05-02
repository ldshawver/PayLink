/**
 * Pure payroll calculation logic — no DB, no Express, no side effects.
 *
 * This is the SINGLE SOURCE OF TRUTH for all payroll math in PayLink.
 * Every payroll path MUST use calculateWorkerPay() and nothing else:
 *   - POST /api/payroll-runs           (draft creation / initial processing)
 *   - POST /api/payroll-runs/:id/process (reprocess)
 *   - POST /api/payroll/recalculate-ytd  (YTD reconciliation)
 *
 * Supported pay categories (all 15):
 *   Hourly:       regular, overtime, double_time
 *   Side-hourly:  commission_hours, special_event, volunteer
 *   Leave (paid): pto, sick, holiday
 *   Leave (unpd): unpaid
 *   Fixed:        salary, commission_pay, bonus, tips, reimbursements
 *
 * Multi-company identity rule:
 *   A worker belongs to one legal employer (companyId/legalEntityId).
 *   A person may be a worker at multiple companies.
 *   YTD is ALWAYS computed per (workerId × legalEntityId × year) for
 *   employer tax purposes. Consolidated person-level YTD is a read-only
 *   view and MUST NEVER be used for W-2/1099 or tax remittance calculations.
 */

// ── Input types ───────────────────────────────────────────────────────────────

export type CalcTimeEntry = {
  workerId: string;
  totalHours: string | number;
  overtimeHours: string | number;
  doubleTimeHours?: string | number | null;
  /** one of: regular | overtime | double_time | commission_hours | volunteer |
   *          special_event | pto | sick | holiday | unpaid */
  payCategory?: string | null;
  overridePayRate?: string | number | null;
  wageGroupId?: string | null;
  /** Tips reported/collected on this specific shift */
  tipsAmount?: string | number | null;
};

export type CalcWorker = {
  id: string;
  /** "hourly" | "salary" | "commission" */
  payType: string;
  /** Annual salary (for salary workers) OR hourly rate (for hourly/commission workers) */
  payRate: string | number;
  workerType?: string;
  workerGroup?: string;
};

export type WageGroupMap = Record<string, { hourlyRate: number; overtimeRate: number }>;

/**
 * All non-time-entry inputs for a single worker's payroll period.
 * The route is responsible for loading these from the DB and passing them as
 * plain numbers. The calculator never touches the database.
 */
export type PayrollAdditions = {
  /** Approved commission records (from commissions table, separate from commission_hours entries) */
  commissionPay?: number;
  /** Bonus pay (from amendments or bonus records) */
  bonusPay?: number;
  /** Employer-collected tips paid through payroll (from time entry tipsAmount sum
   *  or an explicit tip record; passing this overrides the sum from time entries) */
  tipsPay?: number;
  /** Non-taxable reimbursements (approved expense reports, mileage) */
  reimburseAmount?: number;
  /** Paid-time-off hours (hourly workers: generates pay at regular rate;
   *  salary workers: tracked only, no incremental pay) */
  ptoHours?: number;
  /** Sick leave hours (same semantics as ptoHours) */
  sickHours?: number;
  /** Holiday pay hours (same semantics as ptoHours) */
  holidayHours?: number;
  /** Unpaid leave hours (salary: deducted at hourly-equiv rate; hourly: no entry = no pay) */
  unpaidHours?: number;
  /** Net earnings from pay-stub amendments (already classified as "earning" by route) */
  earningAdjustments?: number;
  /** Net deductions from pay-stub amendments (already classified as "deduction" by route).
   *  NOT subtracted inside the calculator — returned as-is so the route can apply them
   *  after the grossPay-based deduction calculation. */
  deductionAdjustments?: number;
  /** Pay periods per year (required for salary workers; default 26 = biweekly) */
  periodsPerYear?: number;
  /** Overtime multiplier (default 1.5) */
  overtimeMultiplier?: number;
  /** Secondary wage group rates keyed by wageGroupId */
  wageGroups?: WageGroupMap;
};

// ── Output type ───────────────────────────────────────────────────────────────

export type WorkerPayResult = {
  // ── Hours tracked ─────────────────────────────────────────────────────────
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  commissionHours: number;
  volunteerHours: number;
  specialEventHours: number;
  ptoHours: number;
  sickHours: number;
  holidayHours: number;
  unpaidHours: number;

  // ── Earnings ──────────────────────────────────────────────────────────────
  /** Hourly regular pay (hrs × rate). Zero for salary workers (use salaryPay). */
  regularPay: number;
  overtimePay: number;
  doubleTimePay: number;
  /** Pay from commission_hours time entries (hrs × rate) */
  commissionHourlyPay: number;
  specialEventPay: number;
  /** Base salary per period (salary workers only; zero for hourly) */
  salaryPay: number;
  /** Bonus pay (from amendments/bonus records) */
  bonusPay: number;
  /** Employer-collected tips paid through payroll */
  tipsPay: number;
  /** Commission pay from commission records (separate from commission_hours) */
  commissionPay: number;
  /** PTO pay (hourly workers only; salary workers: zero — salary already covers it) */
  ptoPay: number;
  /** Sick pay (same semantics as ptoPay) */
  sickPay: number;
  /** Holiday pay (same semantics as ptoPay) */
  holidayPay: number;
  /** Non-taxable reimbursement pass-through (NOT included in grossPay) */
  reimburseAmount: number;
  /** Unpaid-leave deduction (salary only: hours × hourlyEquiv; subtracted from gross) */
  unpaidDeduction: number;

  // ── Totals ────────────────────────────────────────────────────────────────
  /**
   * Taxable gross earnings for this pay period.
   * = all earning lines EXCEPT reimburseAmount.
   * The route applies worker-level deductions on top of this.
   */
  grossPay: number;
};

// ── Internal constants ────────────────────────────────────────────────────────

const DT_MULTIPLIER = 2.0;
/** Standard full-time annual hours used for salary → hourly equivalence */
const ANNUAL_HOURS = 2080;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Calculate pay for a single worker (hourly OR salary) for one pay period.
 *
 * This is the ONLY entry point routes should use. Never call the type-specific
 * helpers directly from a route.
 */
export function calculateWorkerPay(
  worker: CalcWorker,
  entries: CalcTimeEntry[],
  additions: PayrollAdditions = {}
): WorkerPayResult {
  if (worker.payType === "salary") {
    return _calcSalary(worker, entries, additions);
  }
  return _calcHourly(worker, entries, additions);
}

/**
 * Kept for backward compatibility with existing call sites.
 * New code should call calculateWorkerPay() instead.
 * @deprecated Use calculateWorkerPay()
 */
export function calculateHourlyWorkerPay(
  worker: CalcWorker,
  entries: CalcTimeEntry[],
  opts: { overtimeMultiplier?: number; wageGroups?: WageGroupMap } = {}
): WorkerPayResult {
  return _calcHourly(worker, entries, {
    overtimeMultiplier: opts.overtimeMultiplier,
    wageGroups: opts.wageGroups,
  });
}

// ── Hourly worker calculator ───────────────────────────────────────────────────

function _calcHourly(
  worker: CalcWorker,
  entries: CalcTimeEntry[],
  additions: PayrollAdditions
): WorkerPayResult {
  const workerEntries = entries.filter(e => e.workerId === worker.id);
  const defaultRate   = parseFloat(String(worker.payRate || "0"));
  const otMult        = additions.overtimeMultiplier ?? 1.5;
  const wgMap         = additions.wageGroups ?? {};

  // ── Pass 1: tally regular / OT / DT hours ─────────────────────────────────
  // RULE: Only entries with payCategory in {regular, overtime, double_time}
  //       contribute to the OT threshold. PTO/sick/holiday/commission_hours/etc.
  //       do NOT count toward overtime.
  let regHrs = 0, otHrs = 0, dtHrs = 0;
  for (const e of workerEntries) {
    const cat = _cat(e.payCategory);
    if (cat !== "regular" && cat !== "overtime" && cat !== "double_time") continue;
    const tot = _f(e.totalHours);
    const ot  = Math.min(_f(e.overtimeHours), tot);
    const dt  = Math.min(_f(e.doubleTimeHours), Math.max(0, tot - ot));
    regHrs += Math.max(0, tot - ot - dt);
    otHrs  += ot;
    dtHrs  += dt;
  }

  // ── Pass 2: calculate all earnings per entry ───────────────────────────────
  let regPay = 0, otPay = 0, dtPay = 0;
  let commHrs = 0, commHrlyPay = 0;
  let volHrs = 0;
  let evtHrs = 0, evtPay = 0;
  let ptoHrs = 0, ptoPay = 0;
  let sickHrs = 0, sickPay = 0;
  let holHrs = 0, holPay = 0;
  let unpaidHrs = 0;
  let tipsFromEntries = 0;

  for (const e of workerEntries) {
    const tot = _f(e.totalHours);
    const ot  = _f(e.overtimeHours);
    const dt  = _f(e.doubleTimeHours);
    const reg = Math.max(0, tot - ot - dt);
    const cat = _cat(e.payCategory);

    const wg       = e.wageGroupId ? wgMap[e.wageGroupId] : null;
    const override = _overrideRate(e.overridePayRate);
    const rate     = override ?? (wg ? wg.hourlyRate : defaultRate);
    const otRate   = (wg && wg.overtimeRate > 0) ? wg.overtimeRate : rate * otMult;

    tipsFromEntries += _f(e.tipsAmount);

    switch (cat) {
      case "volunteer":
        volHrs += tot;
        break;
      case "commission_hours":
        commHrs     += tot;
        commHrlyPay += tot * rate;
        break;
      case "special_event":
        evtHrs += tot;
        evtPay += tot * rate;
        break;
      case "pto":
        ptoHrs += tot;
        ptoPay += tot * rate;
        break;
      case "sick":
        sickHrs += tot;
        sickPay += tot * rate;
        break;
      case "holiday":
        holHrs += tot;
        holPay += tot * rate;
        break;
      case "unpaid":
        // Hourly: unpaid = no entry → no pay generated. Track hours for reporting.
        unpaidHrs += tot;
        break;
      default:
        // regular | overtime | double_time
        regPay += reg * rate;
        otPay  += ot  * otRate;
        dtPay  += dt  * rate * DT_MULTIPLIER;
    }
  }

  // ── Additions from non-time-entry sources ─────────────────────────────────
  // Tips: caller may override the sum from time entries (e.g. from a tip record)
  const tipsPay      = additions.tipsPay ?? tipsFromEntries;
  // PTO/sick/holiday hours may be overridden (e.g. from a leave balance system)
  if (additions.ptoHours != null)     { ptoHrs  = additions.ptoHours;     ptoPay  = ptoHrs  * defaultRate; }
  if (additions.sickHours != null)    { sickHrs  = additions.sickHours;    sickPay = sickHrs  * defaultRate; }
  if (additions.holidayHours != null) { holHrs   = additions.holidayHours; holPay  = holHrs   * defaultRate; }
  if (additions.unpaidHours != null)  { unpaidHrs = additions.unpaidHours; }

  const bonusPay      = additions.bonusPay ?? 0;
  const commissionPay = additions.commissionPay ?? 0;
  const reimburseAmt  = additions.reimburseAmount ?? 0;
  const earningAdj    = additions.earningAdjustments ?? 0;

  const grossPay =
    regPay + otPay + dtPay +
    commHrlyPay + evtPay +
    ptoPay + sickPay + holPay +
    tipsPay + bonusPay + commissionPay +
    earningAdj;

  return {
    regularHours:       regHrs,
    overtimeHours:      otHrs,
    doubleTimeHours:    dtHrs,
    commissionHours:    commHrs,
    volunteerHours:     volHrs,
    specialEventHours:  evtHrs,
    ptoHours:           ptoHrs,
    sickHours:          sickHrs,
    holidayHours:       holHrs,
    unpaidHours:        unpaidHrs,
    regularPay:         regPay,
    overtimePay:        otPay,
    doubleTimePay:      dtPay,
    commissionHourlyPay: commHrlyPay,
    specialEventPay:    evtPay,
    salaryPay:          0,
    bonusPay,
    tipsPay,
    commissionPay,
    ptoPay,
    sickPay,
    holidayPay:         holPay,
    reimburseAmount:    reimburseAmt,
    unpaidDeduction:    0,
    grossPay,
  };
}

// ── Salary worker calculator ───────────────────────────────────────────────────

function _calcSalary(
  worker: CalcWorker,
  entries: CalcTimeEntry[],
  additions: PayrollAdditions
): WorkerPayResult {
  const workerEntries  = entries.filter(e => e.workerId === worker.id);
  const annualSalary   = parseFloat(String(worker.payRate || "0"));
  const otMult         = additions.overtimeMultiplier ?? 1.5;
  const periodsPerYear = additions.periodsPerYear ?? 26;
  const wgMap          = additions.wageGroups ?? {};
  const hourlyEquiv    = annualSalary / ANNUAL_HOURS;

  // ── Regular / OT / DT hours from standard time entries ───────────────────
  let regHrs = 0, otHrs = 0, dtHrs = 0;
  for (const e of workerEntries) {
    const cat = _cat(e.payCategory);
    if (cat !== "regular" && cat !== "overtime" && cat !== "double_time") continue;
    const tot = _f(e.totalHours);
    const ot  = Math.min(_f(e.overtimeHours), tot);
    const dt  = Math.min(_f(e.doubleTimeHours), Math.max(0, tot - ot));
    otHrs  += ot;
    dtHrs  += dt;
    regHrs += Math.max(0, tot - ot - dt);
  }

  const salaryPay = annualSalary / periodsPerYear;
  const otPay     = otHrs * hourlyEquiv * otMult;
  const dtPay     = dtHrs * hourlyEquiv * DT_MULTIPLIER;

  // ── Side-category entries ─────────────────────────────────────────────────
  let commHrs = 0, commHrlyPay = 0;
  let volHrs = 0;
  let evtHrs = 0, evtPay = 0;
  let ptoHrs = 0, sickHrs = 0, holHrs = 0, unpaidHrs = 0;
  let tipsFromEntries = 0;

  for (const e of workerEntries) {
    const tot = _f(e.totalHours);
    const cat = _cat(e.payCategory);
    if (cat === "regular" || cat === "overtime" || cat === "double_time") continue;

    const wg       = e.wageGroupId ? wgMap[e.wageGroupId] : null;
    const override = _overrideRate(e.overridePayRate);
    const rate     = override ?? (wg ? wg.hourlyRate : hourlyEquiv);

    tipsFromEntries += _f(e.tipsAmount);

    switch (cat) {
      case "volunteer":
        volHrs += tot;
        break;
      case "commission_hours":
        commHrs     += tot;
        commHrlyPay += tot * rate;
        break;
      case "special_event":
        evtHrs += tot;
        evtPay += tot * rate;
        break;
      case "pto":
        ptoHrs += tot;
        // Salary: PTO is tracked for reporting; no incremental pay (salary covers it)
        break;
      case "sick":
        sickHrs += tot;
        break;
      case "holiday":
        holHrs += tot;
        break;
      case "unpaid":
        unpaidHrs += tot;
        break;
    }
  }

  // ── Additions ─────────────────────────────────────────────────────────────
  const tipsPay      = additions.tipsPay ?? tipsFromEntries;
  if (additions.ptoHours != null)     ptoHrs    = additions.ptoHours;
  if (additions.sickHours != null)    sickHrs   = additions.sickHours;
  if (additions.holidayHours != null) holHrs    = additions.holidayHours;
  if (additions.unpaidHours != null)  unpaidHrs = additions.unpaidHours;

  const bonusPay      = additions.bonusPay ?? 0;
  const commissionPay = additions.commissionPay ?? 0;
  const reimburseAmt  = additions.reimburseAmount ?? 0;
  const earningAdj    = additions.earningAdjustments ?? 0;

  // Unpaid leave: salary workers are docked hourlyEquiv × unpaidHours
  const unpaidDeduction = unpaidHrs * hourlyEquiv;

  const grossPay = Math.max(
    0,
    salaryPay + otPay + dtPay +
    commHrlyPay + evtPay +
    tipsPay + bonusPay + commissionPay +
    earningAdj -
    unpaidDeduction
  );

  return {
    regularHours:       regHrs,
    overtimeHours:      otHrs,
    doubleTimeHours:    dtHrs,
    commissionHours:    commHrs,
    volunteerHours:     volHrs,
    specialEventHours:  evtHrs,
    ptoHours:           ptoHrs,
    sickHours:          sickHrs,
    holidayHours:       holHrs,
    unpaidHours:        unpaidHrs,
    regularPay:         0,          // salary: base pay is in salaryPay
    overtimePay:        otPay,
    doubleTimePay:      dtPay,
    commissionHourlyPay: commHrlyPay,
    specialEventPay:    evtPay,
    salaryPay,
    bonusPay,
    tipsPay,
    commissionPay,
    ptoPay:             0,          // salary: no incremental PTO pay
    sickPay:            0,
    holidayPay:         0,
    reimburseAmount:    reimburseAmt,
    unpaidDeduction,
    grossPay,
  };
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _f(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v));
  return isNaN(n) ? 0 : n;
}

function _cat(v: string | null | undefined): string {
  return (v ?? "regular") || "regular";
}

function _overrideRate(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v));
  return isNaN(n) ? null : n;
}
