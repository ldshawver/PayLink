/**
 * Contractor Hub job board — pure client logic (no React).
 *
 * Types mirror the camelCase projections in server/contractor-jobs/rules.ts.
 * POST_ACTIONS / BID_REVIEW_FROM / CONTRACTOR_EDITABLE / CONTRACTOR_WITHDRAWABLE
 * mirror the server state machines so the UI only offers actions the server
 * accepts; tests/contractor-job-board-ui.test.ts fails if they drift.
 */
// ─── Types (camelCase projections from server/contractor-jobs/rules.ts) ──────

export type PostStatus = "draft" | "published" | "paused" | "closed" | "archived";
export type BidStatus =
  | "draft" | "submitted" | "under_review" | "shortlisted" | "revision_requested"
  | "rejected" | "withdrawn" | "awarded" | "converted_to_proposal" | "converted_to_contract";

export interface JobAttachment { id: string; fileName: string; contentType?: string; fileSize?: number; bidId?: string | null; createdAt?: string }

export interface JobPost {
  id: string;
  companyId: string;
  companyName?: string | null;
  title: string;
  summary?: string | null;
  scopeOfWork?: string | null;
  requirements?: string | null;
  deliverables?: string | null;
  locationType: "onsite" | "remote" | "hybrid";
  locationText?: string | null;
  workType: "one_time" | "recurring";
  recurrenceFrequency?: string | null;
  recurrenceDescription?: string | null;
  estimatedStartDate?: string | null;
  estimatedEndDate?: string | null;
  submissionDeadline?: string | null;
  budgetType: "fixed" | "hourly" | "range" | "contractor_quote" | "undisclosed";
  budgetMin?: string | null;
  budgetMax?: string | null;
  currency?: string | null;
  paymentTerms?: string | null;
  status: PostStatus;
  hasAwards?: boolean;
  capacityRemaining?: number | null;
  publishedAt?: string | null;
  closedAt?: string | null;
  // administrator projection
  maximumAwards?: number | null;
  awardsMade?: number;
  visibility?: "all_eligible" | "invited_only" | "selected_groups";
  eligibleGroups?: string[];
  closeReason?: string | null;
  updatedAt?: string | null;
  bidCounts?: { total: number; awaitingReview: number; shortlisted: number; awarded: number };
  // detail
  attachments?: JobAttachment[];
  viewer?: "admin" | "contractor";
  // contractor projection
  acceptingBids?: boolean;
  myBid?: JobBid | null;
  myBidId?: string | null;
  myBidStatus?: BidStatus | null;
  invited?: boolean;
}

export interface JobBid {
  id: string;
  jobPostId: string;
  status: BidStatus;
  coverMessage?: string | null;
  proposedScope?: string | null;
  proposedAmount?: string | null;
  rateType?: "fixed" | "hourly" | "recurring" | "custom" | null;
  hourlyRate?: string | null;
  estimatedHours?: string | null;
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

export interface JobQuestion {
  id: string; question: string; answer?: string | null; answeredAt?: string | null; isPublic: boolean;
  createdAt: string; contractorName?: string; mine?: boolean;
}
export interface JobInvitation { id: string; contractorId: string; contractorName?: string | null; status: string; invitedAt: string }
export interface JobEvent { id: string; bidId?: string | null; eventType: string; oldStatus?: string | null; newStatus?: string | null; details?: any; createdAt: string }

export type JobBoardNavigate = (section: "proposals" | "contracts", entityId?: string) => void;

// ─── Role → view (mirrors expandRoleForGuard admin/manager on the server) ────

export const JOB_ADMIN_ROLES = new Set([
  "admin", "manager", "owner", "system_admin",
  "platform_super_admin", "platform_admin", "platform_owner",
  "tenant_owner", "tenant_admin", "tenant_hr_admin", "tenant_payroll_admin", "tenant_finance_admin",
  "tenant_manager", "tenant_supervisor",
]);

export function jobBoardViewsFor(user: { role?: string | null; workerId?: string | null; workerType?: string | null } | null | undefined) {
  const canManage = !!user?.role && JOB_ADMIN_ROLES.has(user.role);
  const canBid = !!user?.workerId && user?.workerType === "contractor";
  return { canManage, canBid };
}

export const POST_STATUS_LABEL: Record<PostStatus, string> = {
  draft: "Draft", published: "Published", paused: "Paused", closed: "Closed", archived: "Archived",
};
export const BID_STATUS_LABEL: Record<BidStatus, string> = {
  draft: "Draft", submitted: "Submitted", under_review: "Under review", shortlisted: "Shortlisted",
  revision_requested: "Revision requested", rejected: "Not selected", withdrawn: "Withdrawn", awarded: "Awarded",
  converted_to_proposal: "Awarded · proposal created", converted_to_contract: "Awarded · under contract",
};

export const LOCATION_LABEL = { onsite: "On-site", remote: "Remote", hybrid: "Hybrid" } as const;
export const FREQUENCY_LABEL: Record<string, string> = { weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly", quarterly: "Quarterly", custom: "Custom schedule" };
export const AWARDED_STATUSES: BidStatus[] = ["awarded", "converted_to_proposal", "converted_to_contract"];
export const ACTIVE_BID_STATUSES: BidStatus[] = ["draft", "submitted", "under_review", "shortlisted", "revision_requested"];
export const CLOSING_SOON_MS = 3 * 24 * 60 * 60 * 1000;

export function money(v: string | number | null | undefined, currency = "USD") {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(n); }
  catch { return `$${n.toFixed(2)}`; }
}

export function budgetLabel(p: Pick<JobPost, "budgetType" | "budgetMin" | "budgetMax" | "currency">) {
  const c = p.currency || "USD";
  switch (p.budgetType) {
    case "fixed": return money(p.budgetMax ?? p.budgetMin, c);
    case "hourly": return `${money(p.budgetMax ?? p.budgetMin, c)}/hr`;
    case "range": return `${money(p.budgetMin, c)} – ${money(p.budgetMax, c)}`;
    case "contractor_quote": return "Contractor quote";
    default: return "Undisclosed";
  }
}

export function closingSoon(p: JobPost, now = Date.now()) {
  if (p.status !== "published" || !p.submissionDeadline) return false;
  const t = new Date(p.submissionDeadline).getTime();
  return t > now && t - now <= CLOSING_SOON_MS;
}

/** Posting badges from the framework spec (§8). */
export function postBadges(p: JobPost, now = Date.now()): { label: string; className: string }[] {
  const out: { label: string; className: string }[] = [];
  out.push(p.workType === "recurring"
    ? { label: p.recurrenceFrequency ? `Recurring · ${FREQUENCY_LABEL[p.recurrenceFrequency] ?? p.recurrenceFrequency}` : "Recurring", className: "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300" }
    : { label: "One-time", className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" });
  if (closingSoon(p, now)) out.push({ label: "Closing soon", className: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" });
  if (p.status === "paused") out.push({ label: "Paused", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300" });
  const awarded = (p.awardsMade ?? 0) > 0 || !!p.hasAwards;
  if (awarded && p.status === "published") out.push({ label: "Awarded · still open", className: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300" });
  if (p.status === "closed") out.push({ label: "Closed", className: "bg-muted text-muted-foreground" });
  if (p.status === "draft") out.push({ label: "Draft", className: "bg-muted text-muted-foreground" });
  if (p.status === "archived") out.push({ label: "Archived", className: "bg-muted text-muted-foreground" });
  return out;
}

// ─── Filters ─────────────────────────────────────────────────────────────────

export interface JobFilters { search: string; workType: "all" | "one_time" | "recurring"; location: "all" | "onsite" | "remote" | "hybrid"; budget: "all" | "stated" | "quote"; deadline: "all" | "soon" | "none" }
export const EMPTY_FILTERS: JobFilters = { search: "", workType: "all", location: "all", budget: "all", deadline: "all" };

export function applyJobFilters(posts: JobPost[], f: JobFilters, now = Date.now()) {
  const q = f.search.trim().toLowerCase();
  return posts.filter((p) => {
    if (q && !`${p.title} ${p.summary ?? ""} ${p.locationText ?? ""}`.toLowerCase().includes(q)) return false;
    if (f.workType !== "all" && p.workType !== f.workType) return false;
    if (f.location !== "all" && p.locationType !== f.location) return false;
    if (f.budget === "stated" && !["fixed", "hourly", "range"].includes(p.budgetType)) return false;
    if (f.budget === "quote" && !["contractor_quote", "undisclosed"].includes(p.budgetType)) return false;
    if (f.deadline === "soon" && !closingSoon(p, now)) return false;
    if (f.deadline === "none" && p.submissionDeadline) return false;
    return true;
  });
}

// ─── Posting wizard (create + edit) ──────────────────────────────────────────

export interface PostForm {
  title: string; summary: string; scopeOfWork: string; requirements: string; deliverables: string;
  locationType: string; locationText: string;
  workType: string; recurrenceFrequency: string; recurrenceDescription: string;
  estimatedStartDate: string; estimatedEndDate: string; submissionDeadline: string;
  budgetType: string; budgetMin: string; budgetMax: string; currency: string; paymentTerms: string;
  maximumAwards: string; visibility: string; eligibleGroups: string;
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
    title: p?.title ?? "", summary: p?.summary ?? "", scopeOfWork: p?.scopeOfWork ?? "",
    requirements: p?.requirements ?? "", deliverables: p?.deliverables ?? "",
    locationType: p?.locationType ?? "onsite", locationText: p?.locationText ?? "",
    workType: p?.workType ?? "one_time", recurrenceFrequency: p?.recurrenceFrequency ?? "", recurrenceDescription: p?.recurrenceDescription ?? "",
    estimatedStartDate: p?.estimatedStartDate ?? "", estimatedEndDate: p?.estimatedEndDate ?? "",
    submissionDeadline: toLocalInput(p?.submissionDeadline),
    budgetType: p?.budgetType ?? "contractor_quote", budgetMin: p?.budgetMin ?? "", budgetMax: p?.budgetMax ?? "",
    currency: p?.currency ?? "USD", paymentTerms: p?.paymentTerms ?? "",
    maximumAwards: p?.maximumAwards != null ? String(p.maximumAwards) : "",
    visibility: p?.visibility ?? "all_eligible", eligibleGroups: (p?.eligibleGroups ?? []).join(", "),
  };
}

/** Form → API payload. On edit only changed keys are sent (the server diffs too). */
export function postPayload(form: PostForm, initial: PostForm | null): Record<string, unknown> {
  const f = { ...form };
  if (f.workType === "one_time") { f.recurrenceFrequency = ""; f.recurrenceDescription = ""; }
  if (f.budgetType === "fixed" || f.budgetType === "hourly") f.budgetMin = "";
  if (f.budgetType === "contractor_quote" || f.budgetType === "undisclosed") { f.budgetMin = ""; f.budgetMax = ""; }
  const full: Record<string, unknown> = {
    title: f.title, summary: f.summary, scopeOfWork: f.scopeOfWork, requirements: f.requirements, deliverables: f.deliverables,
    locationType: f.locationType, locationText: f.locationText,
    workType: f.workType, recurrenceFrequency: f.recurrenceFrequency || null, recurrenceDescription: f.recurrenceDescription,
    estimatedStartDate: f.estimatedStartDate || null, estimatedEndDate: f.estimatedEndDate || null,
    submissionDeadline: f.submissionDeadline ? new Date(f.submissionDeadline).toISOString() : null,
    budgetType: f.budgetType, budgetMin: f.budgetMin || null, budgetMax: f.budgetMax || null,
    currency: f.currency || "USD", paymentTerms: f.paymentTerms,
    maximumAwards: f.maximumAwards ? Number(f.maximumAwards) : null,
    visibility: f.visibility,
    eligibleGroups: f.visibility === "selected_groups" ? f.eligibleGroups.split(",").map((s) => s.trim()).filter(Boolean) : [],
  };
  if (!initial) return full;
  const before = postPayload(initial, null);
  const changed: Record<string, unknown> = {};
  for (const k of Object.keys(full)) {
    if (JSON.stringify(full[k] ?? null) !== JSON.stringify(before[k] ?? null)) changed[k] = full[k];
  }
  return changed;
}

/** Mirrors POST_TRANSITIONS in server/contractor-jobs/rules.ts. */
export const POST_ACTIONS: { action: "publish" | "pause" | "reopen" | "close" | "archive"; from: PostStatus[]; label: string }[] = [
  { action: "publish", from: ["draft"], label: "Publish" },
  { action: "pause", from: ["published"], label: "Pause" },
  { action: "reopen", from: ["paused", "closed"], label: "Reopen" },
  { action: "close", from: ["draft", "published", "paused"], label: "Close" },
  { action: "archive", from: ["draft", "closed"], label: "Archive" },
];

/** Mirrors BID_TRANSITIONS (administrator actions) in server/contractor-jobs/rules.ts. */
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


export interface BidForm {
  coverMessage: string; proposedScope: string; rateType: string; proposedAmount: string; hourlyRate: string; estimatedHours: string;
  estimatedStartDate: string; estimatedCompletionDate: string; recurrenceTerms: string; assumptions: string; exclusions: string;
}
export function bidFormFrom(b: JobBid | null | undefined, post: JobPost): BidForm {
  return {
    coverMessage: b?.coverMessage ?? "", proposedScope: b?.proposedScope ?? "",
    rateType: b?.rateType ?? (post.budgetType === "hourly" ? "hourly" : post.workType === "recurring" ? "recurring" : "fixed"),
    proposedAmount: b?.proposedAmount ?? "", hourlyRate: b?.hourlyRate ?? "", estimatedHours: b?.estimatedHours ?? "",
    estimatedStartDate: b?.estimatedStartDate ?? "", estimatedCompletionDate: b?.estimatedCompletionDate ?? "",
    recurrenceTerms: b?.recurrenceTerms ?? "", assumptions: b?.assumptions ?? "", exclusions: b?.exclusions ?? "",
  };
}
export function bidPayload(f: BidForm): Record<string, unknown> {
  const hourly = f.rateType === "hourly";
  return {
    coverMessage: f.coverMessage, proposedScope: f.proposedScope, rateType: f.rateType,
    proposedAmount: hourly ? null : f.proposedAmount || null,
    hourlyRate: hourly ? f.hourlyRate || null : null,
    estimatedHours: f.estimatedHours || null,
    estimatedStartDate: f.estimatedStartDate || null, estimatedCompletionDate: f.estimatedCompletionDate || null,
    recurrenceTerms: f.recurrenceTerms, assumptions: f.assumptions, exclusions: f.exclusions,
  };
}

/** Mirrors bidIsContractorEditable / withdraw rule in server/contractor-jobs/rules.ts. */
export const CONTRACTOR_EDITABLE: BidStatus[] = ["draft", "revision_requested", "submitted", "under_review"];
export const CONTRACTOR_WITHDRAWABLE: BidStatus[] = ["draft", "submitted", "under_review", "shortlisted", "revision_requested"];
