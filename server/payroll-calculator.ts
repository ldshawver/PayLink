/**
 * Pure payroll calculation logic — no DB, no Express.
 * Extracted from the process route so it can be unit-tested in isolation.
 */

export type CalcTimeEntry = {
  workerId: string;
  totalHours: string | number;
  overtimeHours: string | number;
  doubleTimeHours?: string | number | null;
  payCategory?: string | null;
  overridePayRate?: string | number | null;
  wageGroupId?: string | null;
};

export type CalcWorker = {
  id: string;
  payType: string;       // "hourly" | "salary"
  payRate: string | number;
  workerType?: string;
  workerGroup?: string;
};

export type WageGroupMap = Record<string, { hourlyRate: number; overtimeRate: number }>;

export type WorkerPayResult = {
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  commissionHours: number;
  volunteerHours: number;
  specialEventHours: number;
  regularPay: number;
  overtimePay: number;
  doubleTimePay: number;
  commissionHourlyPay: number;
  specialEventPay: number;
  grossPay: number;
};

/**
 * Calculate pay for a single hourly worker given their time entries.
 * commission_hours entries must NOT contribute to regularHours or regularPay.
 */
export function calculateHourlyWorkerPay(
  worker: CalcWorker,
  entries: CalcTimeEntry[],
  opts: {
    overtimeMultiplier?: number;
    wageGroups?: WageGroupMap;
  } = {}
): WorkerPayResult {
  const workerEntries = entries.filter(e => e.workerId === worker.id);
  const defaultRate = parseFloat(String(worker.payRate || "0"));
  const otMultiplier = opts.overtimeMultiplier ?? 1.5;
  const dtMultiplier = 2.0;
  const wageGroupMap = opts.wageGroups ?? {};

  // ── Pass 1: count reg/OT/DT hours — skip any non-wage category ──────────
  // commission_hours, volunteer, special_event must NEVER contribute here.
  let regHrs = 0, otHrs = 0, dtHrs = 0;
  for (const e of workerEntries) {
    const cat = (e.payCategory ?? "regular") || "regular";
    if (cat !== "regular" && cat !== "overtime" && cat !== "double_time") continue;
    const total = parseFloat(String(e.totalHours || "0"));
    const ot    = Math.min(parseFloat(String(e.overtimeHours || "0")), total);
    const dt    = Math.min(parseFloat(String(e.doubleTimeHours || "0")), Math.max(0, total - ot));
    regHrs += Math.max(0, total - ot - dt);
    otHrs  += ot;
    dtHrs  += dt;
  }

  // ── Pass 2: calculate pay amounts ────────────────────────────────────────
  let regPay = 0, otPay = 0, dtPay = 0;
  let commHrs = 0, commHrlyPay = 0;
  let volHrs = 0;
  let evtHrs = 0, evtPay = 0;

  for (const e of workerEntries) {
    const total   = parseFloat(String(e.totalHours || "0"));
    const ot      = parseFloat(String(e.overtimeHours || "0"));
    const dt      = parseFloat(String(e.doubleTimeHours || "0"));
    const reg     = Math.max(0, total - ot - dt);
    const cat     = (e.payCategory ?? "regular") || "regular";

    const wg = e.wageGroupId ? wageGroupMap[e.wageGroupId] : null;
    const override = e.overridePayRate != null && e.overridePayRate !== ""
      ? parseFloat(String(e.overridePayRate))
      : null;
    const rate   = override ?? (wg ? wg.hourlyRate : defaultRate);
    const otRate = (wg && wg.overtimeRate > 0) ? wg.overtimeRate : rate * otMultiplier;

    if (cat === "volunteer") {
      volHrs += total;
    } else if (cat === "commission_hours") {
      commHrs     += total;
      commHrlyPay += total * rate;
    } else if (cat === "special_event") {
      evtHrs += total;
      evtPay += total * rate;
    } else {
      // "regular" | "overtime" | "double_time" — standard wage entries
      regPay += reg * rate;
      otPay  += ot  * otRate;
      dtPay  += dt  * rate * dtMultiplier;
    }
  }

  const grossPay = regPay + otPay + dtPay + commHrlyPay + evtPay;

  return {
    regularHours:      regHrs,
    overtimeHours:     otHrs,
    doubleTimeHours:   dtHrs,
    commissionHours:   commHrs,
    volunteerHours:    volHrs,
    specialEventHours: evtHrs,
    regularPay:        regPay,
    overtimePay:       otPay,
    doubleTimePay:     dtPay,
    commissionHourlyPay: commHrlyPay,
    specialEventPay:   evtPay,
    grossPay,
  };
}
