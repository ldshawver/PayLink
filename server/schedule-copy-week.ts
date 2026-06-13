export type CopyWeekMode = "merge" | "replace";

export type ScheduleCopyShift = Record<string, any> & {
  id: string;
  companyId: string;
  workerId: string;
  date: string;
  startTime: string;
  endTime: string;
  department?: string | null;
  status?: string | null;
  note?: string | null;
};

export type CopyWeekRequest = {
  companyId: string;
  sourceWeekStart: string;
  targetWeekStart: string;
  departmentId?: string | null;
  mode?: CopyWeekMode;
};

export type CopyWeekDeps = {
  getSchedulesByDateRange(companyId: string, startDate: string, endDate: string): Promise<ScheduleCopyShift[]>;
  createSchedule(data: Record<string, any>): Promise<ScheduleCopyShift>;
  deleteSchedule(id: string): Promise<void>;
  writeAuditLog(entry: Record<string, any>): Promise<void>;
  now?: () => Date;
};

export type CopyWeekActor = {
  userId: string;
  ipAddress?: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function addUtcDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isSundayWeekStart(ymd: string): boolean {
  return DATE_RE.test(ymd) && new Date(`${ymd}T00:00:00Z`).getUTCDay() === 0;
}

export function targetDateForCopiedShift(sourceWeekStart: string, targetWeekStart: string, sourceDate: string): string {
  const dayOffset = Math.round((new Date(`${sourceDate}T00:00:00Z`).getTime() - new Date(`${sourceWeekStart}T00:00:00Z`).getTime()) / 86400000);
  return addUtcDays(targetWeekStart, dayOffset);
}

export function buildCopiedDraftSchedule(source: ScheduleCopyShift, sourceWeekStart: string, targetWeekStart: string): Record<string, any> {
  return {
    workerId: source.workerId,
    companyId: source.companyId,
    date: targetDateForCopiedShift(sourceWeekStart, targetWeekStart, source.date),
    startTime: source.startTime,
    endTime: source.endTime,
    department: source.department || null,
    jobId: source.jobId || null,
    positionId: source.positionId || null,
    costCenterId: source.costCenterId || null,
    note: source.note || null,
    notes: source.notes || null,
    shiftNotes: source.shiftNotes || null,
    originalShiftId: source.id,
    sourceShiftId: source.id,
    status: "draft",
    publishedAt: null,
    publishedBy: null,
    notifiedAt: null,
    notificationStatus: null,
    payrollExportedAt: null,
    payrollExportBatchId: null,
    completedAt: null,
    approvedAt: null,
    approvedBy: null,
  };
}

export async function copyPublishedScheduleWeek(req: CopyWeekRequest, actor: CopyWeekActor, deps: CopyWeekDeps) {
  const { companyId, sourceWeekStart, targetWeekStart, departmentId, mode = "merge" } = req;
  const now = deps.now ? deps.now() : new Date();
  const todayYmd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);

  if (!companyId || !sourceWeekStart || !targetWeekStart) throw Object.assign(new Error("companyId, sourceWeekStart, and targetWeekStart are required"), { status: 400 });
  if (!isSundayWeekStart(sourceWeekStart) || !isSundayWeekStart(targetWeekStart)) throw Object.assign(new Error("sourceWeekStart and targetWeekStart must be valid Sunday week starts in YYYY-MM-DD format"), { status: 400 });
  if (sourceWeekStart === targetWeekStart) throw Object.assign(new Error("Target week must be different from source week"), { status: 400 });
  if (targetWeekStart <= todayYmd) throw Object.assign(new Error("Target week must be in the future"), { status: 400 });
  if (!["merge", "replace"].includes(mode)) throw Object.assign(new Error("mode must be merge or replace"), { status: 400 });

  const sourceEnd = addUtcDays(sourceWeekStart, 6);
  const targetEnd = addUtcDays(targetWeekStart, 6);
  const sourceAll = await deps.getSchedulesByDateRange(companyId, sourceWeekStart, sourceEnd);
  const source = sourceAll.filter((s) => s.status === "published" && (!departmentId || s.department === departmentId));
  if (sourceAll.length === 0) throw Object.assign(new Error("Source week has no schedules"), { status: 404 });
  if (source.length === 0) throw Object.assign(new Error("Source week has no published shifts"), { status: 400 });

  const targetExisting = await deps.getSchedulesByDateRange(companyId, targetWeekStart, targetEnd);
  if (mode === "replace") {
    const replaceable = targetExisting.filter((s) => s.status !== "published" && (!departmentId || s.department === departmentId));
    await Promise.all(replaceable.map((s) => deps.deleteSchedule(s.id)));
  }

  const created: ScheduleCopyShift[] = [];
  for (const shift of source) {
    created.push(await deps.createSchedule(buildCopiedDraftSchedule(shift, sourceWeekStart, targetWeekStart)));
  }

  await deps.writeAuditLog({
    companyId,
    actorUserId: actor.userId,
    actionType: "copy_week",
    objectType: "schedule_week",
    objectId: targetWeekStart,
    metadataJson: JSON.stringify({ sourceWeekStart, targetWeekStart, copiedCount: created.length, companyId, departmentId: departmentId || null, mode, existingTargetShiftCount: targetExisting.length }),
    ipAddress: actor.ipAddress,
  });

  return { copiedCount: created.length, targetWeekStart, createdShiftIds: created.map((s) => s.id), existingTargetShiftCount: targetExisting.length };
}
