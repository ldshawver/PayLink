/**
 * Job board — pure client logic (no React).
 *
 * One posting model, two separate submission paths:
 *   contractor work     → "Submit Proposal"  (bids → award → contractor proposal)
 *   employee positions  → "Apply"            (applications → hire; never billing)
 *
 * Types mirror the camelCase projections in server/job-board/rules.ts.
 * POST_ACTIONS / BID_REVIEW_FROM / APPLICATION_ACTIONS_FROM / the editable
 * lists and clientEmploymentIndicators mirror the server rules so the UI only
 * offers actions the server accepts; tests/contractor-job-board-ui.test.ts
 * fails if they drift.
 */
// ─── Types ───────────────────────────────────────────────────────────────────

export type PostStatus = "draft" | "published" | "paused" | "closed" | "archived";
/** Public-board visibility (migration 0030). NULL = never chosen → behaves as access_required. */
export type PublicVisibility = "public" | "access_required" | "invite_only";
export const PUBLIC_VISIBILITY_LABEL: Record<PublicVisibility, string> = {
  public: "Public — anyone with the board code sees the public summary",
  access_required: "Access required — approved people only (default)",
  invite_only: "Invite only — only people you grant",
};
export type WorkerClassification = "contractor" | "employee";
export type OpportunityType = "project" | "recurring_work" | "position";
export type ScheduleType = "one_time" | "recurring" | "part_time" | "full_time";
export type CompensationType = "fixed_bid" | "hourly" | "salary" | "range" | "undisclosed";
export type BidStatus =
  | "draft" | "submitted" | "under_review" | "shortlisted" | "revision_requested"
  | "rejected" | "withdrawn" | "awarded" | "converted_to_proposal" | "converted_to_contract";
export type ApplicationStatus =
  | "draft" | "submitted" | "under_review" | "interviewing" | "offer_extended" | "hired" | "rejected" | "withdrawn";

export interface JobAttachment { id: string; fileName: string; contentType?: string; fileSize?: number; bidId?: string | null; createdAt?: string }
export interface ScreeningQuestion { id: string; prompt: string; answerType: "text" | "yes_no" | "choice" | "number"; options: string[]; required: boolean; position?: number }
export interface ApplicationDocument { id: string; documentType: string; fileName: string; contentType?: string; fileSize?: number; createdAt?: string }

export interface JobPost {
  id: string;
  companyId: string;
  companyName?: string | null;
  workerClassification: WorkerClassification;
  submissionKind: "proposal" | "application";
  cta: "Submit Proposal" | "Apply";
  opportunityType: OpportunityType;
  scheduleType: ScheduleType;
  employmentType?: "part_time" | "full_time" | null;
  durationType: "fixed_term" | "ongoing";
  hoursPerWeekMin?: string | null;
  hoursPerWeekMax?: string | null;
  title: string;
  summary?: string | null;
  scopeOfWork?: string | null;
  requirements?: string | null;
  deliverables?: string | null;
  requiredSkills?: string[];
  experienceRequirements?: string | null;
  workLocationType: "onsite" | "remote" | "hybrid";
  locationText?: string | null;
  recurrenceFrequency?: string | null;
  recurrenceDescription?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  applicationDeadline?: string | null;
  compensationType: CompensationType;
  compensationMin?: string | null;
  compensationMax?: string | null;
  currency?: string | null;
  paymentTerms?: string | null;
  numberOfOpenings?: number | null;
  status: PostStatus;
  hasFills?: boolean;
  openingsRemaining?: number | null;
  publishedAt?: string | null;
  closedAt?: string | null;
  // administrator projection
  numberOfOpeningsSetting?: number | null;
  filledCount?: number;
  visibility?: "all_eligible" | "invited_only" | "selected_groups";
  eligibleGroups?: string[];
  classificationIndicators?: string[];
  acknowledgedIndicators?: string[];
  classificationAcknowledgedAt?: string | null;
  closeReason?: string | null;
  updatedAt?: string | null;
  submissionCounts?: { kind: "proposals" | "applications"; total: number; awaitingReview: number; shortlisted: number; filled: number };
  // public board (migration 0030; administrator projection)
  publicVisibility?: PublicVisibility | null;
  publicDescription?: string | null;
  publicShowCompensation?: boolean;
  // detail
  attachments?: JobAttachment[];
  screeningQuestions?: ScreeningQuestion[];
  viewer?: "admin" | "worker";
  // worker projection
  acceptingSubmissions?: boolean;
  myBid?: JobBid | null;
  myBidId?: string | null;
  myBidStatus?: BidStatus | null;
  myApplication?: JobApplication | null;
  myApplicationId?: string | null;
  myApplicationStatus?: ApplicationStatus | null;
  invited?: boolean;
}

export interface JobBid {
  id: string;
  jobPostId: string;
  status: BidStatus;
  coverMessage?: string | null;
  scopeAndDeliverables?: string | null;
  proposedAmount?: string | null;
  rateType?: "fixed" | "hourly" | "recurring" | "custom" | null;
  hourlyRate?: string | null;
  estimatedHours?: string | null;
  proposedSchedule?: string | null;
  availability?: string | null;
  estimatedStartDate?: string | null;
  estimatedCompletionDate?: string | null;
  recurrenceTerms?: string | null;
  assumptions?: string | null;
  exclusions?: string | null;
  revisionNumber?: number;
  revisionRequestNote?: string | null;
  rejectionReason?: string | null;
  submittedAt?: string | null;
  withdrawnAt?: string | null;
  awardedAt?: string | null;
  convertedProposalId?: string | null;
  convertedContractId?: string | null;
  updatedAt?: string | null;
  jobTitle?: string;
  jobStatus?: PostStatus;
  // administrator projection
  contractorId?: string;
  contractorName?: string | null;
  attachmentCount?: number;
}

export interface JobApplication {
  id: string;
  jobPostId: string;
  status: ApplicationStatus;
  coverMessage?: string | null;
  availability?: string | null;
  desiredCompensation?: string | null;
  qualifications?: string | null;
  consentVersion?: string | null;
  consentAcceptedAt?: string | null;
  submittedAt?: string | null;
  withdrawnAt?: string | null;
  hiredAt?: string | null;
  updatedAt?: string | null;
  jobTitle?: string;
  jobStatus?: PostStatus;
  answers?: { questionId: string; prompt: string; answer: string | null }[];
  documents?: ApplicationDocument[];
  // administrator projection
  applicantName?: string | null;
  rejectionReason?: string | null;
  convertedWorkerId?: string | null;
  convertedWorkerType?: string | null;
  convertedAt?: string | null;
  documentCount?: number;
}

export interface JobQuestion {
  id: string; question: string; answer?: string | null; answeredAt?: string | null; isPublic: boolean;
  createdAt: string; contractorName?: string; mine?: boolean;
}
export interface JobInvitation { id: string; contractorId: string; contractorName?: string | null; status: string; invitedAt: string }
export interface JobEvent { id: string; bidId?: string | null; applicationId?: string | null; eventType: string; oldStatus?: string | null; newStatus?: string | null; details?: any; createdAt: string }

export type JobBoardNavigate = (section: "proposals" | "contracts", entityId?: string) => void;

// ─── Role → view (mirrors expandRoleForGuard admin/manager on the server) ────

export const JOB_ADMIN_ROLES = new Set([
  "admin", "manager", "owner", "system_admin",
  "platform_super_admin", "platform_admin", "platform_owner",
  "tenant_owner", "tenant_admin", "tenant_hr_admin", "tenant_payroll_admin", "tenant_finance_admin",
  "tenant_manager", "tenant_supervisor",
]);

/**
 * canManage: administrators/managers. canPropose: contractor workers (contractor work).
 * canApply: any contractor or employee worker (employee positions). canBrowse: either.
 */
export function jobBoardViewsFor(user: { role?: string | null; workerId?: string | null; workerType?: string | null } | null | undefined) {
  const canManage = !!user?.role && JOB_ADMIN_ROLES.has(user.role);
  const isWorker = !!user?.workerId && (user?.workerType === "contractor" || user?.workerType === "employee");
  // Limited applicant identity (role 'applicant', no worker): may apply to employee positions only.
  const isApplicant = user?.role === "applicant" && !user?.workerId;
  const canPropose = isWorker && user?.workerType === "contractor";
  const canApply = isWorker || isApplicant;
  return { canManage, canPropose, canApply, canBrowse: canPropose || canApply, canBid: canPropose };
}

// ─── Labels ──────────────────────────────────────────────────────────────────

export const POST_STATUS_LABEL: Record<PostStatus, string> = {
  draft: "Draft", published: "Published", paused: "Paused", closed: "Closed", archived: "Archived",
};
export const BID_STATUS_LABEL: Record<BidStatus, string> = {
  draft: "Draft", submitted: "Submitted", under_review: "Under review", shortlisted: "Shortlisted",
  revision_requested: "Revision requested", rejected: "Not selected", withdrawn: "Withdrawn", awarded: "Awarded",
  converted_to_proposal: "Awarded · proposal created", converted_to_contract: "Awarded · under contract",
};
export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
  draft: "Draft", submitted: "Submitted", under_review: "Under review", interviewing: "Interviewing",
  offer_extended: "Offer extended", hired: "Hired", rejected: "Not selected", withdrawn: "Withdrawn",
};
export const CLASSIFICATION_LABEL: Record<WorkerClassification, string> = { contractor: "Contractor", employee: "Employee" };
export const OPPORTUNITY_LABEL: Record<OpportunityType, string> = { project: "Project", recurring_work: "Recurring work", position: "Position" };
export const SCHEDULE_LABEL: Record<ScheduleType, string> = { one_time: "One-time", recurring: "Recurring", part_time: "Part-time", full_time: "Full-time" };
export const COMPENSATION_LABEL: Record<CompensationType, string> = { fixed_bid: "Fixed bid", hourly: "Hourly", salary: "Salary", range: "Range", undisclosed: "Undisclosed" };
export const LOCATION_LABEL = { onsite: "On-site", remote: "Remote", hybrid: "Hybrid" } as const;
export const FREQUENCY_LABEL: Record<string, string> = { weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly", quarterly: "Quarterly", custom: "Custom schedule" };
export const AWARDED_STATUSES: BidStatus[] = ["awarded", "converted_to_proposal", "converted_to_contract"];
export const ACTIVE_BID_STATUSES: BidStatus[] = ["draft", "submitted", "under_review", "shortlisted", "revision_requested"];
export const ACTIVE_APPLICATION_STATUSES: ApplicationStatus[] = ["draft", "submitted", "under_review", "interviewing", "offer_extended"];
export const CLOSING_SOON_MS = 3 * 24 * 60 * 60 * 1000;

/** Mirrors CLASSIFICATION_NOTICE in server/job-board/rules.ts. */
export const CLASSIFICATION_NOTICE =
  "Worker classification is your decision. MyPayLink records the classification you declare and does not determine whether it is legally correct.";

/** Mirrors EMPLOYMENT_INDICATOR_LABELS in server/job-board/rules.ts. */
export const EMPLOYMENT_INDICATOR_LABELS: Record<string, string> = {
  part_time_schedule: "Part-time schedule",
  full_time_schedule: "Full-time schedule",
  ongoing_duration: "Ongoing, open-ended part-/full-time engagement",
  hours_30_plus: "30 or more hours per week",
  salary_compensation: "Paid as a salary",
};

/** Mirrors employmentIndicators() in server/job-board/rules.ts (advisory; never a legal conclusion). */
export function clientEmploymentIndicators(p: {
  workerClassification?: string; scheduleType?: string; durationType?: string;
  hoursPerWeekMin?: string | number | null; hoursPerWeekMax?: string | number | null; compensationType?: string;
}): string[] {
  if (p.workerClassification !== "contractor") return [];
  const out: string[] = [];
  if (p.scheduleType === "part_time") out.push("part_time_schedule");
  if (p.scheduleType === "full_time") out.push("full_time_schedule");
  if (p.durationType === "ongoing" && (p.scheduleType === "part_time" || p.scheduleType === "full_time")) out.push("ongoing_duration");
  const hours = Math.max(Number(p.hoursPerWeekMax ?? 0) || 0, Number(p.hoursPerWeekMin ?? 0) || 0);
  if (hours >= 30) out.push("hours_30_plus");
  if (p.compensationType === "salary") out.push("salary_compensation");
  return out;
}

export function unacknowledgedIndicators(p: Pick<JobPost, "classificationIndicators" | "acknowledgedIndicators">): string[] {
  const ack = new Set(p.acknowledgedIndicators ?? []);
  return (p.classificationIndicators ?? []).filter((i) => !ack.has(i));
}

export function money(v: string | number | null | undefined, currency = "USD") {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: n % 1 ? 2 : 0 }).format(n); }
  catch { return `$${n.toFixed(2)}`; }
}

export function compensationLabel(p: Pick<JobPost, "compensationType" | "compensationMin" | "compensationMax" | "currency">) {
  const c = p.currency || "USD";
  const one = p.compensationMax ?? p.compensationMin;
  switch (p.compensationType) {
    case "fixed_bid": return one != null ? `Fixed bid · up to ${money(one, c)}` : "Fixed bid · contractor quotes";
    case "hourly": return one != null ? (p.compensationMin != null && p.compensationMax != null && p.compensationMin !== p.compensationMax
      ? `${money(p.compensationMin, c)}–${money(p.compensationMax, c)}/hr` : `${money(one, c)}/hr`) : "Hourly";
    case "salary": return one != null ? (p.compensationMin != null && p.compensationMax != null && p.compensationMin !== p.compensationMax
      ? `${money(p.compensationMin, c)}–${money(p.compensationMax, c)}/yr` : `${money(one, c)}/yr`) : "Salary";
    case "range": return `${money(p.compensationMin, c)} – ${money(p.compensationMax, c)}`;
    default: return "Undisclosed";
  }
}

export function hoursLabel(p: Pick<JobPost, "hoursPerWeekMin" | "hoursPerWeekMax">) {
  const a = p.hoursPerWeekMin != null ? Number(p.hoursPerWeekMin) : null;
  const b = p.hoursPerWeekMax != null ? Number(p.hoursPerWeekMax) : null;
  if (a == null && b == null) return null;
  if (a != null && b != null && a !== b) return `${a}–${b} h/week`;
  return `${a ?? b} h/week`;
}

export function closingSoon(p: JobPost, now = Date.now()) {
  if (p.status !== "published" || !p.applicationDeadline) return false;
  const t = new Date(p.applicationDeadline).getTime();
  return t > now && t - now <= CLOSING_SOON_MS;
}

/** The prominent classification badge shown on every card. */
export function classificationBadge(p: Pick<JobPost, "workerClassification">): { label: string; className: string } {
  return p.workerClassification === "employee"
    ? { label: "EMPLOYEE POSITION", className: "bg-sky-600 text-white dark:bg-sky-500 dark:text-sky-950" }
    : { label: "CONTRACTOR WORK", className: "bg-orange-600 text-white dark:bg-orange-500 dark:text-orange-950" };
}

/** Secondary posting badges. */
export function postBadges(p: JobPost, now = Date.now()): { label: string; className: string }[] {
  const out: { label: string; className: string }[] = [];
  const sched = p.scheduleType === "recurring" && p.recurrenceFrequency
    ? `Recurring · ${FREQUENCY_LABEL[p.recurrenceFrequency] ?? p.recurrenceFrequency}`
    : SCHEDULE_LABEL[p.scheduleType] ?? p.scheduleType;
  out.push({ label: sched, className: "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300" });
  if (p.workerClassification === "contractor" && p.opportunityType === "recurring_work" && p.scheduleType !== "recurring") {
    out.push({ label: "Recurring work", className: "bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300" });
  }
  if (closingSoon(p, now)) out.push({ label: "Closing soon", className: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" });
  if (p.status === "paused") out.push({ label: "Paused", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300" });
  const filled = (p.filledCount ?? 0) > 0 || !!p.hasFills;
  if (filled && p.status === "published") {
    out.push({ label: p.workerClassification === "employee" ? "Hiring · still open" : "Awarded · still open", className: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300" });
  }
  if (p.status === "closed") out.push({ label: "Closed", className: "bg-muted text-muted-foreground" });
  if (p.status === "draft") out.push({ label: "Draft", className: "bg-muted text-muted-foreground" });
  if (p.status === "archived") out.push({ label: "Archived", className: "bg-muted text-muted-foreground" });
  return out;
}

// ─── Filters ─────────────────────────────────────────────────────────────────

export interface JobFilters {
  search: string;
  opportunity: "all" | OpportunityType;
  schedule: "all" | ScheduleType;
  classification: "all" | WorkerClassification;
  location: "all" | "onsite" | "remote" | "hybrid";
  compensation: "all" | CompensationType;
  deadline: "all" | "soon" | "none";
}
export const EMPTY_FILTERS: JobFilters = { search: "", opportunity: "all", schedule: "all", classification: "all", location: "all", compensation: "all", deadline: "all" };

export function applyJobFilters(posts: JobPost[], f: JobFilters, now = Date.now()) {
  const q = f.search.trim().toLowerCase();
  return posts.filter((p) => {
    if (q && !`${p.title} ${p.summary ?? ""} ${p.locationText ?? ""} ${(p.requiredSkills ?? []).join(" ")}`.toLowerCase().includes(q)) return false;
    if (f.opportunity !== "all" && p.opportunityType !== f.opportunity) return false;
    if (f.schedule !== "all" && p.scheduleType !== f.schedule) return false;
    if (f.classification !== "all" && p.workerClassification !== f.classification) return false;
    if (f.location !== "all" && p.workLocationType !== f.location) return false;
    if (f.compensation !== "all" && p.compensationType !== f.compensation) return false;
    if (f.deadline === "soon" && !closingSoon(p, now)) return false;
    if (f.deadline === "none" && p.applicationDeadline) return false;
    return true;
  });
}

// ─── Posting wizard (create + edit) ──────────────────────────────────────────

export interface PostForm {
  workerClassification: "" | WorkerClassification;
  scheduleType: "" | ScheduleType;
  opportunityType: "" | OpportunityType;
  durationType: string; hoursPerWeekMin: string; hoursPerWeekMax: string;
  title: string; summary: string; scopeOfWork: string; requirements: string; deliverables: string;
  requiredSkills: string; experienceRequirements: string;
  workLocationType: string; locationText: string;
  recurrenceFrequency: string; recurrenceDescription: string;
  startDate: string; endDate: string; applicationDeadline: string;
  compensationType: string; compensationMin: string; compensationMax: string; currency: string; paymentTerms: string;
  numberOfOpenings: string; visibility: string; eligibleGroups: string;
  publicVisibility: PublicVisibility; publicDescription: string; publicShowCompensation: boolean;
}

/** Schedules offered after the first choice. Employee positions are part-time or full-time only. */
export function schedulesFor(cls: "" | WorkerClassification): ScheduleType[] {
  return cls === "employee" ? ["part_time", "full_time"] : ["one_time", "recurring", "part_time", "full_time"];
}
/** Compensation types offered per classification (employee positions are never fixed-bid). */
export function compensationTypesFor(cls: "" | WorkerClassification): CompensationType[] {
  return cls === "employee" ? ["hourly", "salary", "range", "undisclosed"] : ["fixed_bid", "hourly", "range", "undisclosed", "salary"];
}
/** Opportunity type implied by the first two choices (contractor PT/FT may be either project or recurring work). */
export function defaultOpportunity(cls: "" | WorkerClassification, sched: "" | ScheduleType): "" | OpportunityType {
  if (cls === "employee") return "position";
  if (cls === "contractor") return sched === "recurring" ? "recurring_work" : "project";
  return "";
}
export function opportunityChoicesFor(cls: "" | WorkerClassification, sched: "" | ScheduleType): OpportunityType[] {
  if (cls === "employee") return ["position"];
  if (sched === "one_time") return ["project"];
  if (sched === "recurring") return ["recurring_work"];
  return ["project", "recurring_work"];
}

export function toLocalInput(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formFromPost(p: JobPost | null): PostForm {
  return {
    workerClassification: p?.workerClassification ?? "",
    scheduleType: p?.scheduleType ?? "",
    opportunityType: p?.opportunityType ?? "",
    durationType: p?.durationType ?? "",
    hoursPerWeekMin: p?.hoursPerWeekMin != null ? String(Number(p.hoursPerWeekMin)) : "",
    hoursPerWeekMax: p?.hoursPerWeekMax != null ? String(Number(p.hoursPerWeekMax)) : "",
    title: p?.title ?? "", summary: p?.summary ?? "", scopeOfWork: p?.scopeOfWork ?? "",
    requirements: p?.requirements ?? "", deliverables: p?.deliverables ?? "",
    requiredSkills: (p?.requiredSkills ?? []).join(", "), experienceRequirements: p?.experienceRequirements ?? "",
    workLocationType: p?.workLocationType ?? "onsite", locationText: p?.locationText ?? "",
    recurrenceFrequency: p?.recurrenceFrequency ?? "", recurrenceDescription: p?.recurrenceDescription ?? "",
    startDate: p?.startDate ?? "", endDate: p?.endDate ?? "",
    applicationDeadline: toLocalInput(p?.applicationDeadline),
    compensationType: p?.compensationType ?? "undisclosed",
    compensationMin: p?.compensationMin ?? "", compensationMax: p?.compensationMax ?? "",
    currency: p?.currency ?? "USD", paymentTerms: p?.paymentTerms ?? "",
    numberOfOpenings: p ? (p.numberOfOpeningsSetting != null ? String(p.numberOfOpeningsSetting) : "") : "1",
    visibility: p?.visibility ?? "all_eligible", eligibleGroups: (p?.eligibleGroups ?? []).join(", "),
    publicVisibility: (p?.publicVisibility as PublicVisibility | null | undefined) ?? "access_required",
    publicDescription: p?.publicDescription ?? "",
    publicShowCompensation: p?.publicShowCompensation === true,
  };
}

const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/**
 * Form → API payload. On create the classification + schedule are sent first;
 * on edit only changed keys are sent (the server diffs too), and the
 * classification is only sent while the posting is still a draft.
 */
export function postPayload(form: PostForm, initial: PostForm | null, opts: { status?: PostStatus } = {}): Record<string, unknown> {
  const f = { ...form };
  const recurring = f.scheduleType === "recurring" || f.opportunityType === "recurring_work";
  if (!recurring) { f.recurrenceFrequency = ""; f.recurrenceDescription = ""; }
  if (f.compensationType === "undisclosed") { f.compensationMin = ""; f.compensationMax = ""; }
  const full: Record<string, unknown> = {
    workerClassification: f.workerClassification || undefined,
    scheduleType: f.scheduleType || undefined,
    opportunityType: f.workerClassification === "contractor" ? (f.opportunityType || defaultOpportunity(f.workerClassification, f.scheduleType) || undefined) : undefined,
    durationType: f.durationType || undefined,
    hoursPerWeekMin: f.hoursPerWeekMin || null, hoursPerWeekMax: f.hoursPerWeekMax || null,
    title: f.title, summary: f.summary, scopeOfWork: f.scopeOfWork, requirements: f.requirements, deliverables: f.deliverables,
    requiredSkills: splitList(f.requiredSkills), experienceRequirements: f.experienceRequirements,
    workLocationType: f.workLocationType, locationText: f.locationText,
    recurrenceFrequency: f.recurrenceFrequency || null, recurrenceDescription: f.recurrenceDescription,
    startDate: f.startDate || null, endDate: f.endDate || null,
    applicationDeadline: f.applicationDeadline ? new Date(f.applicationDeadline).toISOString() : null,
    compensationType: f.compensationType, compensationMin: f.compensationMin || null, compensationMax: f.compensationMax || null,
    currency: f.currency || "USD", paymentTerms: f.paymentTerms,
    numberOfOpenings: f.numberOfOpenings ? Number(f.numberOfOpenings) : null,
    visibility: f.visibility,
    eligibleGroups: f.visibility === "selected_groups" ? splitList(f.eligibleGroups) : [],
    publicVisibility: f.publicVisibility || "access_required",
    publicDescription: f.publicDescription,
    publicShowCompensation: f.publicShowCompensation === true,
  };
  for (const k of Object.keys(full)) if (full[k] === undefined) delete full[k];
  if (!initial) return full;
  const before = postPayload(initial, null);
  const changed: Record<string, unknown> = {};
  for (const k of Object.keys(full)) {
    if (JSON.stringify(full[k] ?? null) !== JSON.stringify(before[k] ?? null)) changed[k] = full[k];
  }
  if (opts.status && opts.status !== "draft") delete changed.workerClassification;
  return changed;
}

/** Mirrors POST_TRANSITIONS in server/job-board/rules.ts. */
export const POST_ACTIONS: { action: "publish" | "pause" | "reopen" | "close" | "archive"; from: PostStatus[]; label: string }[] = [
  { action: "publish", from: ["draft"], label: "Publish" },
  { action: "pause", from: ["published"], label: "Pause" },
  { action: "reopen", from: ["paused", "closed"], label: "Reopen" },
  { action: "close", from: ["draft", "published", "paused"], label: "Close" },
  { action: "archive", from: ["draft", "closed"], label: "Archive" },
];

/** Mirrors BID_TRANSITIONS (administrator actions) in server/job-board/rules.ts. */
export const BID_REVIEW_FROM = {
  review: ["submitted"],
  shortlist: ["submitted", "under_review"],
  request_revision: ["submitted", "under_review", "shortlisted"],
  reject: ["submitted", "under_review", "shortlisted", "revision_requested"],
  award: ["submitted", "under_review", "shortlisted"],
} as const satisfies Record<string, readonly BidStatus[]>;

export function canDo(action: keyof typeof BID_REVIEW_FROM, status: BidStatus) {
  return (BID_REVIEW_FROM[action] as readonly string[]).includes(status);
}

/** Mirrors APPLICATION_TRANSITIONS (administrator actions) in server/job-board/rules.ts. */
export const APPLICATION_ACTIONS_FROM = {
  review: ["submitted"],
  interview: ["submitted", "under_review"],
  offer: ["under_review", "interviewing"],
  hire: ["offer_extended"],
  reject: ["submitted", "under_review", "interviewing", "offer_extended"],
} as const satisfies Record<string, readonly ApplicationStatus[]>;

export function canDoApplication(action: keyof typeof APPLICATION_ACTIONS_FROM, status: ApplicationStatus) {
  return (APPLICATION_ACTIONS_FROM[action] as readonly string[]).includes(status);
}

// ─── Contractor proposal form ────────────────────────────────────────────────

export interface BidForm {
  coverMessage: string; scopeAndDeliverables: string; rateType: string; proposedAmount: string; hourlyRate: string; estimatedHours: string;
  proposedSchedule: string; availability: string;
  estimatedStartDate: string; estimatedCompletionDate: string; recurrenceTerms: string; assumptions: string; exclusions: string;
}
export function bidFormFrom(b: JobBid | null | undefined, post: JobPost): BidForm {
  return {
    coverMessage: b?.coverMessage ?? "", scopeAndDeliverables: b?.scopeAndDeliverables ?? "",
    rateType: b?.rateType ?? (post.compensationType === "hourly" ? "hourly" : post.opportunityType === "recurring_work" ? "recurring" : "fixed"),
    proposedAmount: b?.proposedAmount ?? "", hourlyRate: b?.hourlyRate ?? "", estimatedHours: b?.estimatedHours ?? "",
    proposedSchedule: b?.proposedSchedule ?? "", availability: b?.availability ?? "",
    estimatedStartDate: b?.estimatedStartDate ?? "", estimatedCompletionDate: b?.estimatedCompletionDate ?? "",
    recurrenceTerms: b?.recurrenceTerms ?? "", assumptions: b?.assumptions ?? "", exclusions: b?.exclusions ?? "",
  };
}
export function bidPayload(f: BidForm): Record<string, unknown> {
  const hourly = f.rateType === "hourly";
  return {
    coverMessage: f.coverMessage, scopeAndDeliverables: f.scopeAndDeliverables, rateType: f.rateType,
    proposedAmount: hourly ? null : f.proposedAmount || null,
    hourlyRate: hourly ? f.hourlyRate || null : null,
    estimatedHours: f.estimatedHours || null,
    proposedSchedule: f.proposedSchedule, availability: f.availability,
    estimatedStartDate: f.estimatedStartDate || null, estimatedCompletionDate: f.estimatedCompletionDate || null,
    recurrenceTerms: f.recurrenceTerms, assumptions: f.assumptions, exclusions: f.exclusions,
  };
}
/** Mirrors validateBidForSubmit in server/job-board/rules.ts — returns the first problem or null. */
export function bidSubmitProblem(f: BidForm): string | null {
  const hourly = f.rateType === "hourly";
  if (hourly ? !f.hourlyRate : !f.proposedAmount) return hourly ? "Enter your hourly rate" : "Enter your proposed price";
  if (!f.estimatedHours && !f.estimatedCompletionDate) return "Enter estimated hours or a completion date";
  if (!f.scopeAndDeliverables.trim()) return "Describe the scope and deliverables";
  return null;
}

/** Mirrors bidIsContractorEditable / withdraw rule in server/job-board/rules.ts. */
export const CONTRACTOR_EDITABLE: BidStatus[] = ["draft", "revision_requested", "submitted", "under_review"];
export const CONTRACTOR_WITHDRAWABLE: BidStatus[] = ["draft", "submitted", "under_review", "shortlisted", "revision_requested"];

// ─── Employee application form ───────────────────────────────────────────────

/** Mirrors REQUIRED_APPLICATION_ACKNOWLEDGEMENTS in server/job-board/rules.ts. */
export const APPLICATION_ACKNOWLEDGEMENTS: { key: string; label: string }[] = [
  { key: "information_accurate", label: "The information I provide is accurate and complete." },
  { key: "privacy_notice", label: "I understand my application, résumé and answers are kept as private HR records visible only to this company's administrators and managers." },
  { key: "no_offer_until_hired", label: "Applying does not create an offer of employment or a contractor engagement." },
];
export const APPLICANT_EDITABLE: ApplicationStatus[] = ["draft"];
export const APPLICANT_WITHDRAWABLE: ApplicationStatus[] = ["draft", "submitted", "under_review", "interviewing", "offer_extended"];

export interface ApplicationForm { coverMessage: string; availability: string; desiredCompensation: string; qualifications: string; answers: Record<string, string> }
export function applicationFormFrom(a: JobApplication | null | undefined): ApplicationForm {
  const answers: Record<string, string> = {};
  for (const x of a?.answers ?? []) answers[x.questionId] = x.answer ?? "";
  return {
    coverMessage: a?.coverMessage ?? "", availability: a?.availability ?? "",
    desiredCompensation: a?.desiredCompensation ?? "", qualifications: a?.qualifications ?? "", answers,
  };
}
export function applicationPayload(f: ApplicationForm): Record<string, unknown> {
  return { coverMessage: f.coverMessage, availability: f.availability, desiredCompensation: f.desiredCompensation, qualifications: f.qualifications, answers: f.answers };
}
/** Client-side pre-check before submit (the server re-validates). */
export function applicationSubmitProblem(f: ApplicationForm, questions: ScreeningQuestion[], acks: Record<string, boolean>): string | null {
  for (const q of questions) {
    if (q.required && !(f.answers[q.id] ?? "").trim()) return `Answer: ${q.prompt}`;
  }
  for (const a of APPLICATION_ACKNOWLEDGEMENTS) if (!acks[a.key]) return "Confirm every acknowledgement before applying";
  return null;
}
