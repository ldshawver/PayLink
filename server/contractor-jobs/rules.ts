/**
 * Contractor Hub job board — pure rules (migration 0029).
 *
 * No DB, no Express, no side effects: state machines, input normalization,
 * eligibility and award-capacity decisions, and the contractor-facing
 * projections. Everything here is unit-tested in tests/contractor-job-board.test.ts;
 * server/contractor-jobs/service.ts applies these decisions inside transactions.
 */

// ── Enumerations (mirror the CHECK constraints in migrations/0029) ──────────
export const POST_STATUSES = ["draft", "published", "paused", "closed", "archived"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const BID_STATUSES = [
  "draft", "submitted", "under_review", "shortlisted", "revision_requested",
  "rejected", "withdrawn", "awarded", "converted_to_proposal", "converted_to_contract",
] as const;
export type BidStatus = (typeof BID_STATUSES)[number];

export const LOCATION_TYPES = ["onsite", "remote", "hybrid"] as const;
export const WORK_TYPES = ["one_time", "recurring"] as const;
export const RECURRENCE_FREQUENCIES = ["weekly", "biweekly", "monthly", "quarterly", "custom"] as const;
export const BUDGET_TYPES = ["fixed", "hourly", "range", "contractor_quote", "undisclosed"] as const;
export const VISIBILITIES = ["all_eligible", "invited_only", "selected_groups"] as const;
export const RATE_TYPES = ["fixed", "hourly", "recurring", "custom"] as const;

// ── Posting state machine ───────────────────────────────────────────────────
// draft → published ⇄ paused → closed → archived; closed may be reopened.
export type PostAction = "publish" | "pause" | "reopen" | "close" | "archive";

const POST_TRANSITIONS: Record<PostAction, { from: readonly PostStatus[]; to: PostStatus }> = {
  publish: { from: ["draft"], to: "published" },
  pause:   { from: ["published"], to: "paused" },
  reopen:  { from: ["paused", "closed"], to: "published" },
  close:   { from: ["draft", "published", "paused"], to: "closed" },
  archive: { from: ["draft", "closed"], to: "archived" },
};

export function decidePostTransition(current: string, action: PostAction): { ok: true; to: PostStatus } | { ok: false; status: number; message: string } {
  const rule = POST_TRANSITIONS[action];
  if (!rule) return { ok: false, status: 400, message: "Unknown action" };
  if (!(rule.from as readonly string[]).includes(current)) {
    return { ok: false, status: 409, message: `Cannot ${action} a posting that is ${current}` };
  }
  return { ok: true, to: rule.to };
}

/** Only draft or paused postings may be freely edited; published edits are audited; closed/archived are locked. */
export function decidePostEdit(current: string): { ok: true; audited: boolean } | { ok: false; status: number; message: string } {
  if (current === "draft" || current === "paused") return { ok: true, audited: false };
  if (current === "published") return { ok: true, audited: true };
  return { ok: false, status: 409, message: `A ${current} posting cannot be edited` };
}

// ── Bid state machine ───────────────────────────────────────────────────────
export type BidAction =
  | "submit" | "revise" | "withdraw"                                        // contractor
  | "review" | "shortlist" | "request_revision" | "reject" | "award";       // administrator

const PRE_AWARD: readonly BidStatus[] = ["draft", "submitted", "under_review", "shortlisted", "revision_requested"];

const BID_TRANSITIONS: Record<BidAction, { from: readonly BidStatus[]; to: BidStatus }> = {
  submit:           { from: ["draft", "revision_requested"], to: "submitted" },
  // A contractor may revise a bid that is waiting for review; it returns to "submitted" as a new revision.
  revise:           { from: ["submitted", "under_review"], to: "submitted" },
  withdraw:         { from: PRE_AWARD, to: "withdrawn" },
  review:           { from: ["submitted"], to: "under_review" },
  shortlist:        { from: ["submitted", "under_review"], to: "shortlisted" },
  request_revision: { from: ["submitted", "under_review", "shortlisted"], to: "revision_requested" },
  reject:           { from: ["submitted", "under_review", "shortlisted", "revision_requested"], to: "rejected" },
  award:            { from: ["submitted", "under_review", "shortlisted"], to: "awarded" },
};

export function decideBidTransition(current: string, action: BidAction): { ok: true; to: BidStatus } | { ok: false; status: number; message: string } {
  const rule = BID_TRANSITIONS[action];
  if (!rule) return { ok: false, status: 400, message: "Unknown action" };
  if (!(rule.from as readonly string[]).includes(current)) {
    return { ok: false, status: 409, message: `Cannot ${action.replace("_", " ")} a bid that is ${current.replace(/_/g, " ")}` };
  }
  return { ok: true, to: rule.to };
}

/** Contractor field edits are allowed while the bid is theirs to change. */
export function bidIsContractorEditable(status: string): boolean {
  return status === "draft" || status === "revision_requested" || status === "submitted" || status === "under_review";
}

/**
 * Bids an administrator sees: only those submitted at least once. An unsent
 * draft — including a draft the contractor later withdrew — stays private.
 */
export function bidVisibleToAdmin(bid: { revision_number: number | string | null }): boolean {
  return Number(bid.revision_number ?? 0) > 0;
}

// ── Submissions-open check ──────────────────────────────────────────────────
export function submissionsOpen(post: { status: string; submission_deadline?: Date | string | null }, now: Date = new Date()):
  { ok: true } | { ok: false; status: number; message: string } {
  if (post.status !== "published") return { ok: false, status: 409, message: `This posting is ${post.status} and is not accepting bids` };
  if (post.submission_deadline && new Date(post.submission_deadline).getTime() < now.getTime()) {
    return { ok: false, status: 409, message: "The submission deadline for this posting has passed" };
  }
  return { ok: true };
}

// ── Award capacity ──────────────────────────────────────────────────────────
/**
 * Whether an award may be made, and whether the posting must close afterwards.
 * One-time postings default to a capacity of 1 when no maximum is set.
 * Recurring postings stay open after an award until capacity (if any) is reached.
 */
export function effectiveMaxAwards(post: { work_type: string; maximum_awards: number | null }): number | null {
  if (post.maximum_awards != null) return post.maximum_awards;
  return post.work_type === "one_time" ? 1 : null;
}

export function decideAward(post: { status: string; work_type: string; maximum_awards: number | null; awards_made: number }):
  { ok: true; closeAfter: boolean } | { ok: false; status: number; message: string } {
  if (post.status !== "published" && post.status !== "paused") {
    return { ok: false, status: 409, message: `Cannot award a bid on a ${post.status} posting` };
  }
  const max = effectiveMaxAwards(post);
  if (max != null && post.awards_made >= max) {
    return { ok: false, status: 409, message: "This posting has reached its award limit" };
  }
  const closeAfter = max != null && post.awards_made + 1 >= max;
  return { ok: true, closeAfter };
}

/** Whether the expiration worker should close this posting (recurring fixed-term end date passed). */
export function postingExpired(post: { status: string; work_type: string; estimated_end_date?: string | Date | null }, today: string): boolean {
  if (post.status !== "published" && post.status !== "paused") return false;
  if (post.work_type !== "recurring" || !post.estimated_end_date) return false;
  return (dateOnlyString(post.estimated_end_date) ?? "9999-12-31") < today;
}

/** UTC calendar date of an instant (used for "today"). */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * YYYY-MM-DD for a DATE column value. node-postgres parses DATE into a Date at
 * LOCAL midnight, so read it back with local getters (toISOString could shift
 * the day); strings are already calendar dates.
 */
export function dateOnlyString(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v).slice(0, 10);
}

// ── Eligibility ─────────────────────────────────────────────────────────────
export interface ContractorIdentity {
  workerId: string;
  companyId: string | null;
  workerType: string | null;
  workerGroup: string | null;
  status: string | null;
}

/**
 * Can this contractor see (and bid on) this posting? Always company-bound:
 * a contractor only ever reaches postings of the company their worker record
 * belongs to — invitations are validated against the same company on creation.
 */
export function contractorEligibleForPost(
  post: { company_id: string; status: string; visibility: string; eligible_groups: unknown },
  who: ContractorIdentity,
  invited: boolean,
): boolean {
  if (!who.companyId || who.companyId !== post.company_id) return false;
  if (who.workerType !== "contractor") return false;
  if (who.status && who.status !== "active") return false;
  if (invited) return true;
  if (post.visibility === "all_eligible") return true;
  if (post.visibility === "selected_groups") {
    const groups = Array.isArray(post.eligible_groups) ? (post.eligible_groups as unknown[]).map(String) : [];
    return !!who.workerGroup && groups.includes(who.workerGroup);
  }
  return false; // invited_only without an invitation
}

// ── Input normalization ─────────────────────────────────────────────────────
type Fields = Record<string, unknown>;

function str(v: unknown, max = 20000): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function oneOf<T extends readonly string[]>(v: unknown, allowed: T): T[number] | null | "invalid" {
  if (v === undefined || v === null || v === "") return null;
  return (allowed as readonly string[]).includes(String(v)) ? (String(v) as T[number]) : "invalid";
}

function money(v: unknown): string | null | "invalid" {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > 999_999_999_999) return "invalid";
  return n.toFixed(2);
}

function num(v: unknown, max: number): string | null | "invalid" {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) return "invalid";
  return String(n);
}

function dateOnly(v: unknown): string | null | "invalid" {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s + "T00:00:00Z"))) return "invalid";
  return s;
}

function timestampVal(v: unknown): string | null | "invalid" {
  if (v === undefined || v === null || v === "") return null;
  const t = Date.parse(String(v));
  if (Number.isNaN(t)) return "invalid";
  return new Date(t).toISOString();
}

/** Posting columns an administrator may set, keyed by API (camelCase) name → column. */
export const POST_FIELD_COLUMNS = {
  title: "title",
  summary: "summary",
  scopeOfWork: "scope_of_work",
  requirements: "requirements",
  deliverables: "deliverables",
  locationType: "location_type",
  locationText: "location_text",
  workType: "work_type",
  recurrenceFrequency: "recurrence_frequency",
  recurrenceDescription: "recurrence_description",
  estimatedStartDate: "estimated_start_date",
  estimatedEndDate: "estimated_end_date",
  submissionDeadline: "submission_deadline",
  budgetType: "budget_type",
  budgetMin: "budget_min",
  budgetMax: "budget_max",
  currency: "currency",
  paymentTerms: "payment_terms",
  maximumAwards: "maximum_awards",
  visibility: "visibility",
  eligibleGroups: "eligible_groups",
  costJobId: "cost_job_id",
} as const;
export type PostField = keyof typeof POST_FIELD_COLUMNS;

/** Edits to these after publication notify existing bidders and are audited as material. */
export const MATERIAL_POST_FIELDS: ReadonlySet<PostField> = new Set<PostField>([
  "scopeOfWork", "requirements", "deliverables", "locationType", "locationText", "workType",
  "recurrenceFrequency", "estimatedStartDate", "estimatedEndDate", "submissionDeadline",
  "budgetType", "budgetMin", "budgetMax", "currency", "paymentTerms", "maximumAwards",
]);

export type NormalizedPost = Partial<Record<(typeof POST_FIELD_COLUMNS)[PostField], unknown>>;

/**
 * Validate and normalize posting input. `partial` = PATCH (only supplied keys).
 * Returns column-keyed values ready for a parameterized INSERT/UPDATE.
 */
export function normalizePostInput(body: Fields, opts: { partial: boolean }):
  { ok: true; values: NormalizedPost; fields: PostField[] } | { ok: false; status: 400; message: string } {
  const out: NormalizedPost = {};
  const fields: PostField[] = [];
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body ?? {}, k);
  const bad = (m: string) => ({ ok: false as const, status: 400 as const, message: m });

  for (const key of Object.keys(POST_FIELD_COLUMNS) as PostField[]) {
    if (!has(key)) continue;
    const raw = body[key];
    let v: unknown;
    switch (key) {
      case "title":
        v = str(raw, 200);
        if (!v) return bad("Title is required");
        break;
      case "locationType": v = oneOf(raw, LOCATION_TYPES); break;
      case "workType": v = oneOf(raw, WORK_TYPES); break;
      case "recurrenceFrequency": v = oneOf(raw, RECURRENCE_FREQUENCIES); break;
      case "budgetType": v = oneOf(raw, BUDGET_TYPES); break;
      case "visibility": v = oneOf(raw, VISIBILITIES); break;
      case "estimatedStartDate":
      case "estimatedEndDate": v = dateOnly(raw); break;
      case "submissionDeadline": v = timestampVal(raw); break;
      case "budgetMin":
      case "budgetMax": v = money(raw); break;
      case "currency": {
        const c = str(raw, 3);
        v = c == null ? null : /^[A-Za-z]{3}$/.test(c) ? c.toUpperCase() : "invalid";
        break;
      }
      case "maximumAwards": {
        if (raw === null || raw === "" || raw === undefined) { v = null; break; }
        const n = Number(raw);
        v = Number.isInteger(n) && n >= 1 && n <= 10000 ? n : "invalid";
        break;
      }
      case "eligibleGroups": {
        if (raw == null) { v = []; break; }
        if (!Array.isArray(raw) || raw.length > 50) { v = "invalid"; break; }
        const groups = raw.map((g) => str(g, 100)).filter((g): g is string => !!g);
        v = Array.from(new Set(groups));
        break;
      }
      case "costJobId": v = str(raw, 64); break;
      default: v = str(raw);
    }
    if (v === "invalid") return bad(`Invalid ${key}`);
    // Required enums cannot be cleared.
    if (v === null && (key === "locationType" || key === "workType" || key === "budgetType" || key === "visibility" || key === "currency")) {
      return bad(`${key} cannot be empty`);
    }
    out[POST_FIELD_COLUMNS[key]] = v;
    fields.push(key);
  }

  if (!opts.partial && !out.title) return bad("Title is required");
  return { ok: true, values: out, fields };
}

/** Cross-field checks on the MERGED posting (stored row + edits) — run before publish and on every edit. */
export function validatePostShape(p: Record<string, any>, opts: { forPublish: boolean }): { ok: true } | { ok: false; status: 400; message: string } {
  const bad = (m: string) => ({ ok: false as const, status: 400 as const, message: m });
  if (p.budget_min != null && p.budget_max != null && Number(p.budget_min) > Number(p.budget_max)) return bad("Budget minimum exceeds maximum");
  if (p.estimated_start_date && p.estimated_end_date && dateOnlyString(p.estimated_start_date)! > dateOnlyString(p.estimated_end_date)!) {
    return bad("Estimated start date is after the end date");
  }
  if (p.work_type === "one_time" && p.recurrence_frequency) return bad("A one-time posting cannot have a recurrence frequency");
  if (p.maximum_awards != null && Number(p.awards_made ?? 0) > Number(p.maximum_awards)) return bad("Award limit is below the awards already made");
  if (p.visibility === "selected_groups" && (!Array.isArray(p.eligible_groups) || p.eligible_groups.length === 0)) {
    return bad("Select at least one contractor group for a group-restricted posting");
  }
  if (opts.forPublish) {
    if (!p.title) return bad("Title is required");
    if (!p.scope_of_work && !p.summary) return bad("Add a summary or scope of work before publishing");
    if (p.work_type === "recurring" && !p.recurrence_frequency) return bad("Choose a recurrence frequency for a recurring posting");
    if ((p.budget_type === "fixed" || p.budget_type === "hourly") && p.budget_max == null && p.budget_min == null) {
      return bad("Enter the budget amount for a fixed or hourly posting");
    }
    if (p.budget_type === "range" && (p.budget_min == null || p.budget_max == null)) return bad("Enter both ends of the budget range");
    if (p.submission_deadline && new Date(p.submission_deadline).getTime() < Date.now()) return bad("The submission deadline is in the past");
  }
  return { ok: true };
}

export const BID_FIELD_COLUMNS = {
  coverMessage: "cover_message",
  proposedScope: "proposed_scope",
  proposedAmount: "proposed_amount",
  rateType: "rate_type",
  hourlyRate: "hourly_rate",
  estimatedHours: "estimated_hours",
  estimatedStartDate: "estimated_start_date",
  estimatedCompletionDate: "estimated_completion_date",
  recurrenceTerms: "recurrence_terms",
  assumptions: "assumptions",
  exclusions: "exclusions",
} as const;
export type BidField = keyof typeof BID_FIELD_COLUMNS;

export function normalizeBidInput(body: Fields):
  { ok: true; values: Partial<Record<(typeof BID_FIELD_COLUMNS)[BidField], unknown>> } | { ok: false; status: 400; message: string } {
  const out: Partial<Record<(typeof BID_FIELD_COLUMNS)[BidField], unknown>> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body ?? {}, k);
  for (const key of Object.keys(BID_FIELD_COLUMNS) as BidField[]) {
    if (!has(key)) continue;
    const raw = body[key];
    let v: unknown;
    switch (key) {
      case "proposedAmount":
      case "hourlyRate": v = money(raw); break;
      case "estimatedHours": v = num(raw, 100000); break;
      case "rateType": v = oneOf(raw, RATE_TYPES); break;
      case "estimatedStartDate":
      case "estimatedCompletionDate": v = dateOnly(raw); break;
      default: v = str(raw);
    }
    if (v === "invalid") return { ok: false, status: 400, message: `Invalid ${key}` };
    out[BID_FIELD_COLUMNS[key]] = v;
  }
  return { ok: true, values: out };
}

/** A bid must state its price before it can be submitted. */
export function validateBidForSubmit(b: Record<string, any>): { ok: true } | { ok: false; status: 400; message: string } {
  if (b.proposed_amount == null && b.hourly_rate == null) return { ok: false, status: 400, message: "Enter a proposed amount or hourly rate before submitting" };
  if (b.rate_type === "hourly" && b.hourly_rate == null) return { ok: false, status: 400, message: "Enter an hourly rate for an hourly bid" };
  if (b.estimated_start_date && b.estimated_completion_date && dateOnlyString(b.estimated_start_date)! > dateOnlyString(b.estimated_completion_date)!) {
    return { ok: false, status: 400, message: "Estimated start date is after the completion date" };
  }
  return { ok: true };
}

/** Award proposal amount: the bid's fixed amount, else hourly rate × estimated hours, else null (contractor completes it). */
export function awardProposalAmount(b: { proposed_amount?: string | null; hourly_rate?: string | null; estimated_hours?: string | null }): string | null {
  if (b.proposed_amount != null) return Number(b.proposed_amount).toFixed(2);
  if (b.hourly_rate != null && b.estimated_hours != null) return (Number(b.hourly_rate) * Number(b.estimated_hours)).toFixed(2);
  return null;
}

// ── Projections ─────────────────────────────────────────────────────────────
/**
 * What a contractor may see of a posting. Never: who created it, internal cost
 * job, other contractors, award counts per bidder. Exposes only whether capacity
 * remains ("awarded but still open" badge) — not who was awarded.
 */
export function projectPostForContractor(p: Record<string, any>) {
  const max = effectiveMaxAwards({ work_type: p.work_type, maximum_awards: p.maximum_awards });
  return {
    id: p.id,
    companyId: p.company_id,
    companyName: p.company_name ?? null,
    title: p.title,
    summary: p.summary,
    scopeOfWork: p.scope_of_work,
    requirements: p.requirements,
    deliverables: p.deliverables,
    locationType: p.location_type,
    locationText: p.location_text,
    workType: p.work_type,
    recurrenceFrequency: p.recurrence_frequency,
    recurrenceDescription: p.recurrence_description,
    estimatedStartDate: dateOnlyString(p.estimated_start_date),
    estimatedEndDate: dateOnlyString(p.estimated_end_date),
    submissionDeadline: p.submission_deadline,
    budgetType: p.budget_type,
    budgetMin: p.budget_type === "undisclosed" ? null : p.budget_min,
    budgetMax: p.budget_type === "undisclosed" ? null : p.budget_max,
    currency: p.currency,
    paymentTerms: p.payment_terms,
    status: p.status,
    hasAwards: Number(p.awards_made ?? 0) > 0,
    capacityRemaining: max == null ? null : Math.max(0, max - Number(p.awards_made ?? 0)),
    publishedAt: p.published_at,
    closedAt: p.closed_at,
  };
}

export function projectPostForAdmin(p: Record<string, any>) {
  return {
    ...projectPostForContractor(p),
    tenantId: p.tenant_id,
    createdByUserId: p.created_by_user_id,
    budgetMin: p.budget_min,
    budgetMax: p.budget_max,
    maximumAwards: p.maximum_awards,
    awardsMade: Number(p.awards_made ?? 0),
    visibility: p.visibility,
    eligibleGroups: Array.isArray(p.eligible_groups) ? p.eligible_groups : [],
    costJobId: p.cost_job_id,
    closeReason: p.close_reason,
    archivedAt: p.archived_at,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    bidCounts: p.bid_counts ?? undefined,
  };
}

/** A contractor's own bid. Internal review fields (reviewer id, idempotency key) are omitted. */
export function projectBidForContractor(b: Record<string, any>) {
  return {
    id: b.id,
    jobPostId: b.job_post_id,
    status: b.status,
    coverMessage: b.cover_message,
    proposedScope: b.proposed_scope,
    proposedAmount: b.proposed_amount,
    rateType: b.rate_type,
    hourlyRate: b.hourly_rate,
    estimatedHours: b.estimated_hours,
    estimatedStartDate: dateOnlyString(b.estimated_start_date),
    estimatedCompletionDate: dateOnlyString(b.estimated_completion_date),
    recurrenceTerms: b.recurrence_terms,
    assumptions: b.assumptions,
    exclusions: b.exclusions,
    revisionNumber: b.revision_number,
    revisionRequestNote: b.revision_request_note,
    rejectionReason: b.rejection_reason,
    submittedAt: b.submitted_at,
    withdrawnAt: b.withdrawn_at,
    awardedAt: b.awarded_at,
    convertedProposalId: b.converted_proposal_id,
    convertedContractId: b.converted_contract_id,
    createdAt: b.created_at,
    updatedAt: b.updated_at,
    jobTitle: b.job_title ?? undefined,
    jobStatus: b.job_status ?? undefined,
  };
}

export function projectBidForAdmin(b: Record<string, any>) {
  return {
    ...projectBidForContractor(b),
    contractorId: b.contractor_id,
    contractorName: b.contractor_name ?? null,
    reviewedAt: b.reviewed_at,
    reviewedByUserId: b.reviewed_by_user_id,
    awardedByUserId: b.awarded_by_user_id,
  };
}
