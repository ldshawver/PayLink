import type { Worker, Schedule, EligibilityRuleSet } from "@shared/schema";

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
  blockers: string[];
}

export interface EligibilityContext {
  candidateWorker: Worker;
  listingWorker: Worker;
  schedule: Schedule;
  ruleSet: EligibilityRuleSet | null;
  candidateSchedules: Schedule[];
  candidateTimeOff: { startDate: string; endDate: string; status: string }[];
  candidateWeeklyHours: number;
}

export function evaluateEligibility(ctx: EligibilityContext): EligibilityResult {
  const reasons: string[] = [];
  const blockers: string[] = [];

  const rules = ctx.ruleSet || getDefaultRules();

  if (rules.requireActiveStatus) {
    if (ctx.candidateWorker.isActive) {
      reasons.push("Worker is active");
    } else {
      blockers.push("Worker is not active");
    }
  }

  if (rules.requireSameCompany) {
    if (ctx.candidateWorker.companyId === ctx.listingWorker.companyId) {
      reasons.push("Same company");
    } else {
      blockers.push("Different company");
    }
  }

  if (rules.requireSameDepartment) {
    if (ctx.candidateWorker.defaultDepartmentId && ctx.listingWorker.defaultDepartmentId) {
      if (ctx.candidateWorker.defaultDepartmentId === ctx.listingWorker.defaultDepartmentId) {
        reasons.push("Same department");
      } else {
        blockers.push("Different department");
      }
    }
  }

  if (rules.requireSameBranch) {
    if (ctx.candidateWorker.defaultBranchId && ctx.listingWorker.defaultBranchId) {
      if (ctx.candidateWorker.defaultBranchId === ctx.listingWorker.defaultBranchId) {
        reasons.push("Same branch");
      } else {
        blockers.push("Different branch");
      }
    }
  }

  if (rules.requireSameEmployeeGroup) {
    const candGroup = (ctx.candidateWorker as any).workerGroup || "hourly_employee";
    const listGroup = (ctx.listingWorker as any).workerGroup || "hourly_employee";
    if (candGroup === listGroup) {
      reasons.push("Same employee group");
    } else {
      blockers.push(`Different employee group (${candGroup} vs ${listGroup})`);
    }
  }

  if (rules.requireSamePosition) {
    if (ctx.candidateWorker.positionId && ctx.listingWorker.positionId) {
      if (ctx.candidateWorker.positionId === ctx.listingWorker.positionId) {
        reasons.push("Same position");
      } else {
        blockers.push("Different position");
      }
    }
  }

  if (rules.requireNoScheduleConflict) {
    const shiftDate = ctx.schedule.date;
    const shiftStart = ctx.schedule.startTime;
    const shiftEnd = ctx.schedule.endTime;

    const hasConflict = ctx.candidateSchedules.some(s => {
      if (s.date !== shiftDate) return false;
      return timesOverlap(s.startTime, s.endTime, shiftStart, shiftEnd);
    });

    if (hasConflict) {
      blockers.push("Schedule conflict — already working during this time");
    } else {
      reasons.push("No schedule conflict");
    }
  }

  if (rules.requireNoLeaveConflict) {
    const shiftDate = ctx.schedule.date;
    const onLeave = ctx.candidateTimeOff.some(to =>
      to.status === "approved" && shiftDate >= to.startDate && shiftDate <= to.endDate
    );
    if (onLeave) {
      blockers.push("On approved leave during this shift");
    } else {
      reasons.push("Not on leave");
    }
  }

  if (rules.maxWeeklyHours) {
    const max = parseFloat(rules.maxWeeklyHours);
    const shiftHours = calculateShiftHours(ctx.schedule.startTime, ctx.schedule.endTime);
    if (ctx.candidateWeeklyHours + shiftHours > max) {
      if (rules.allowOvertimePickup) {
        reasons.push(`Would exceed ${max}h weekly cap but overtime pickup allowed`);
      } else {
        blockers.push(`Would exceed weekly hours cap (${ctx.candidateWeeklyHours + shiftHours}h > ${max}h)`);
      }
    } else {
      reasons.push(`Within weekly hours cap (${ctx.candidateWeeklyHours + shiftHours}h / ${max}h)`);
    }
  }

  if (rules.minRestHours) {
    const minRest = parseFloat(rules.minRestHours);
    const shiftDate = ctx.schedule.date;
    const shiftStart = ctx.schedule.startTime;
    const shiftEnd = ctx.schedule.endTime;

    const insufficientRest = ctx.candidateSchedules.some(s => {
      if (s.date !== shiftDate) return false;
      const gap = calculateGapHours(s.endTime, shiftStart);
      const gap2 = calculateGapHours(shiftEnd, s.startTime);
      return (gap > 0 && gap < minRest) || (gap2 > 0 && gap2 < minRest);
    });

    if (insufficientRest) {
      blockers.push(`Insufficient rest period (minimum ${minRest}h required)`);
    } else {
      reasons.push("Meets minimum rest period");
    }
  }

  if (ctx.candidateWorker.id === ctx.listingWorker.id) {
    blockers.push("Cannot pick up own listed shift");
  }

  return {
    eligible: blockers.length === 0,
    reasons,
    blockers,
  };
}

function getDefaultRules(): EligibilityRuleSet {
  return {
    id: "default",
    companyId: null,
    name: "Default Rules",
    description: "Default eligibility rules",
    requireSameCompany: true,
    requireSameDepartment: true,
    requireSameBranch: true,
    requireSameEmployeeGroup: true,
    requireSamePosition: false,
    requireNoScheduleConflict: true,
    requireNoLeaveConflict: true,
    requireActiveStatus: true,
    maxWeeklyHours: null,
    minRestHours: null,
    requireCertifications: false,
    allowOvertimePickup: false,
    isDefault: true,
    isActive: true,
    createdAt: null,
  };
}

function timesOverlap(s1Start: string, s1End: string, s2Start: string, s2End: string): boolean {
  const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  let a1 = toMin(s1Start), a2 = toMin(s1End);
  let b1 = toMin(s2Start), b2 = toMin(s2End);
  if (a2 <= a1) a2 += 1440;
  if (b2 <= b1) b2 += 1440;
  return a1 < b2 && b1 < a2;
}

function calculateShiftHours(startTime: string, endTime: string): number {
  const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  let mins = toMin(endTime) - toMin(startTime);
  if (mins < 0) mins += 1440;
  return Math.round((mins / 60) * 100) / 100;
}

function calculateGapHours(endTime: string, startTime: string): number {
  const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  let gap = toMin(startTime) - toMin(endTime);
  if (gap < 0) gap += 1440;
  return gap / 60;
}
