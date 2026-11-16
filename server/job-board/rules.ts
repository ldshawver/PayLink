/**
 * Job board — pure rules (migration 0029).
 *
 * Two physically separate submission paths share one posting model:
 *   - contractor postings  → bids/proposals (contractor_job_bids → contractor_proposals)
 *   - employee postings    → applications  (employment_applications → hiring only)
 *
 * No DB, no Express, no side effects: state machines, input normalization,
 * classification indicators, capacity decisions and projections. Unit-tested in
 * tests/contractor-job-board.test.ts; server/job-board/service.ts and
 * server/job-board/employment.ts apply these decisions inside transactions.
 *
 * Classification note: the administrator DECLARES a posting's worker
 * classification. Nothing here concludes whether that classification is
 * legally correct; employmentIndicators() only surfaces facts for the
 * administrator to acknowledge, and the acknowledgement is audited.
 */

// ── Enumerations (mirror the CHECK constraints in migrations/0029) ──────────
export const POST_STATUSES = ["draft", "published", "paused", "closed", "archived"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const WORKER_CLASSIFICATIONS = ["contractor", "employee"] as const;
export type WorkerClassification = (typeof WORKER_CLASSIFICATIONS)[number];
export const OPPORTUNITY_TYPES = ["project", "recurring_work", "position"] as const;
export const SCHEDULE_TYPES = ["one_time", "recurring", "part_time", "full_time"] as const;
export const EMPLOYMENT_TYPES = ["part_time", "full_time"] as const;
export const DURATION_TYPES = ["fixed_term", "ongoing"] as const;
export const COMPENSATION_TYPES = ["fixed_bid", "hourly", "salary", "range", "undisclosed"] as const;
export const WORK_LOCATION_TYPES = ["onsite", "remote", "hybrid"] as const;
export const RECURRENCE_FREQUENCIES = ["weekly", "biweekly", "monthly", "quarterly", "custom"] as const;
export const VISIBILITIES = ["all_eligible", "invited_only", "selected_groups"] as const;
export const RATE_TYPES = ["fixed", "hourly", "recurring", "custom"] as const;

export const BID_STATUSES = [
  "draft", "submitted", "under_review", "shortlisted", "revision_requested",
  "rejected", "withdrawn", "awarded", "converted_to_proposal", "converted_to_contract",
] as const;
export type BidStatus = (typeof BID_STATUSES)[number];

export const APPLICATION_STATUSES = [
  "draft", "submitted", "under_review", "interviewing", "offer_extended", "hired", "rejected", "withdrawn",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const SCREENING_ANSWER_TYPES = ["text", "yes_no", "choice", "number"] as const;
export const APPLICATION_DOCUMENT_TYPES = ["resume", "cover_letter", "certification", "other"] as const;

/** Current wording version of the applicant consent/acknowledgement set. */
export const APPLICATION_CONSENT_VERSION = "job-application-v1";
export const REQUIRED_APPLICATION_ACKNOWLEDGEMENTS = ["information_accurate", "privacy_notice", "no_offer_until_hired"] as const;

/** The submission path a posting uses — derived ONLY from its declared classification. */
export function submissionKind(post: { worker_classification?: string | null }): "proposal" | "application" {
  return post.worker_classification === "employee" ? "application" : "proposal";
}

/** Call-to-action label shown on every posting card. */
export function submissionCta(post: { worker_classification?: string | null }): "Submit Proposal" | "Apply" {
  return submissionKind(post) === "application" ? "Apply" : "Submit Proposal";
}

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

type Decision<T = {}> = ({ ok: true } & T) | { ok: false; status: number; message: string };

export function decidePostTransition(current: string, action: PostAction): Decision<{ to: PostStatus }> {
  const rule = POST_TRANSITIONS[action];
  if (!rule) return { ok: false, status: 400, message: "Unknown action" };
  if (!(rule.from as readonly string[]).includes(current)) {
    return { ok: false, status: 409, message: `Cannot ${action} a posting that is ${current}` };
  }
  return { ok: true, to: rule.to };
}

/** Only draft or paused postings may be freely edited; published edits are audited; closed/archived are locked. */
export function decidePostEdit(current: string): Decision<{ audited: boolean }> {
  if (current === "draft" || current === "paused") return { ok: true, audited: false };
  if (current === "published") return { ok: true, audited: true };
  return { ok: false, status: 409, message: `A ${current} posting cannot be edited` };
}

/** worker_classification may change only while the posting is a draft (a DB trigger enforces the same). */
export function decideClassificationChange(current: { status: string; worker_classification: string }, next: string): Decision {
  if (next === current.worker_classification) return { ok: true };
  if (current.status !== "draft") {
    return { ok: false, status: 409, message: "Worker classification cannot change after a posting is published. Close it and create a new posting instead." };
  }
  return { ok: true };
}

// ── Bid state machine (contractor path) ─────────────────────────────────────
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

export function decideBidTransition(current: string, action: BidAction): Decision<{ to: BidStatus }> {
  const rule = BID_TRANSITIONS[action];
  if (!rule) return { ok: false, status: 400, message: "Unknown action" };
  if (!(rule.from as readonly string[]).includes(current)) {
    return { ok: false, status: 409, message: `Cannot ${action.replace("_", " ")} a proposal that is ${current.replace(/_/g, " ")}` };
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

// ── Application state machine (employee path) ───────────────────────────────
export type ApplicationAction =
  | "submit" | "withdraw"                                                   // applicant
  | "review" | "interview" | "offer" | "hire" | "reject";                   // administrator

const PRE_HIRE: readonly ApplicationStatus[] = ["draft", "submitted", "under_review", "interviewing", "offer_extended"];

const APPLICATION_TRANSITIONS: Record<ApplicationAction, { from: readonly ApplicationStatus[]; to: ApplicationStatus }> = {
  submit:    { from: ["draft"], to: "submitted" },
  withdraw:  { from: PRE_HIRE, to: "withdrawn" },
  review:    { from: ["submitted"], to: "under_review" },
  interview: { from: ["submitted", "under_review"], to: "interviewing" },
  offer:     { from: ["under_review", "interviewing"], to: "offer_extended" },
  hire:      { from: ["offer_extended"], to: "hired" },
  reject:    { from: ["submitted", "under_review", "interviewing", "offer_extended"], to: "rejected" },
};

export function decideApplicationTransition(current: string, action: ApplicationAction): Decision<{ to: ApplicationStatus }> {
  const rule = APPLICATION_TRANSITIONS[action];
  if (!rule) return { ok: false, status: 400, message: "Unknown action" };
  if (!(rule.from as readonly string[]).includes(current)) {
    return { ok: false, status: 409, message: `Cannot ${action} an application that is ${current.replace(/_/g, " ")}` };
  }
  return { ok: true, to: rule.to };
}

export function applicationIsApplicantEditable(status: string): boolean {
  return status === "draft";
}

/** Applications an administrator sees: submitted at least once (unsent drafts stay private). */
export function applicationVisibleToAdmin(a: { submitted_at: unknown }): boolean {
  return a.submitted_at != null;
}

// ── Submissions-open check (both paths) ─────────────────────────────────────
export function submissionsOpen(post: { status: string; application_deadline?: Date | string | null }, now: Date = new Date()): Decision {
  if (post.status !== "published") return { ok: false, status: 409, message: `This posting is ${post.status} and is not accepting submissions` };
  if (post.application_deadline && new Date(post.application_deadline).getTime() < now.getTime()) {
    return { ok: false, status: 409, message: "The deadline for this posting has passed" };
  }
  return { ok: true };
}

// ── Capacity (awards for contractor work, hires for employee positions) ─────
/**
 * Openings a posting can fill. NULL = unlimited, allowed only for recurring
 * contractor work (DB CHECK ck_job_posts_unlimited_only_recurring). Projects and
 * positions default to 1 when unset.
 */
export function effectiveOpenings(post: { opportunity_type: string; number_of_openings: number | null }): number | null {
  if (post.number_of_openings != null) return Number(post.number_of_openings);
  return post.opportunity_type === "recurring_work" ? null : 1;
}

/**
 * Whether one more award/hire may be made, and whether the posting must close
 * afterwards. One-time work closes at capacity; recurring work with no limit
 * stays open after any number of awards; employee positions close when every
 * opening is filled.
 */
export function decideFill(post: { status: string; opportunity_type: string; number_of_openings: number | null; filled_count: number }):
  Decision<{ closeAfter: boolean }> {
  if (post.status !== "published" && post.status !== "paused") {
    return { ok: false, status: 409, message: `Cannot fill a ${post.status} posting` };
  }
  const max = effectiveOpenings(post);
  const filled = Number(post.filled_count ?? 0);
  if (max != null && filled >= max) {
    return { ok: false, status: 409, message: "Every opening on this posting is already filled" };
  }
  return { ok: true, closeAfter: max != null && filled + 1 >= max };
}

/** Whether the expiration worker should close this posting (fixed-term recurring end date passed). */
export function postingExpired(post: { status: string; opportunity_type: string; end_date?: string | Date | null }, today: string): boolean {
  if (post.status !== "published" && post.status !== "paused") return false;
  if (post.opportunity_type !== "recurring_work" || !post.end_date) return false;
  return (dateOnlyString(post.end_date) ?? "9999-12-31") < today;
}

// ── Classification indicators (advisory; never a legal conclusion) ──────────
export const EMPLOYMENT_INDICATOR_LABELS: Record<string, string> = {
  part_time_schedule: "Part-time schedule",
  full_time_schedule: "Full-time schedule",
  ongoing_duration: "Ongoing, open-ended part-/full-time engagement",
  hours_30_plus: "30 or more hours per week",
  salary_compensation: "Paid as a salary",
};

/**
 * Facts about a CONTRACTOR posting that commonly resemble employment. Returned
 * as stable codes; an administrator must acknowledge them before publishing.
 * Employee postings never produce indicators.
 */
export function employmentIndicators(p: {
  worker_classification?: string | null; schedule_type?: string | null; duration_type?: string | null;
  hours_per_week_max?: unknown; hours_per_week_min?: unknown; compensation_type?: string | null;
}): string[] {
  if (p.worker_classification !== "contractor") return [];
  const out: string[] = [];
  if (p.schedule_type === "part_time") out.push("part_time_schedule");
  if (p.schedule_type === "full_time") out.push("full_time_schedule");
  // Open-ended duration counts alongside a part-/full-time schedule; an ongoing
  // recurring service (e.g. weekly cleaning) is not flagged on duration alone.
  if (p.duration_type === "ongoing" && (p.schedule_type === "part_time" || p.schedule_type === "full_time")) out.push("ongoing_duration");
  const hours = Math.max(Number(p.hours_per_week_max ?? 0) || 0, Number(p.hours_per_week_min ?? 0) || 0);
  if (hours >= 30) out.push("hours_30_plus");
  if (p.compensation_type === "salary") out.push("salary_compensation");
  return out;
}

/** True when `current` contains an indicator not present in the acknowledged set. */
export function hasUnacknowledgedIndicators(current: string[], acknowledged: unknown): boolean {
  const ack = new Set(Array.isArray(acknowledged) ? acknowledged.map(String) : []);
  return current.some((c) => !ack.has(c));
}

export const CLASSIFICATION_NOTICE =
  "Worker classification is your decision. MyPayLink records the classification you declare and does not determine whether it is legally correct.";

// ── Date helpers ────────────────────────────────────────────────────────────
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
/** The caller's worker identity (users.worker_id → workers), whatever its type. */
export interface WorkerIdentity {
  workerId: string;
  companyId: string | null;
  workerType: string | null;
  workerGroup: string | null;
  status: string | null;
}
/** Kept for the contractor path; same shape. */
export type ContractorIdentity = WorkerIdentity;

function groupAndInviteCheck(post: { visibility: string; eligible_groups: unknown }, who: WorkerIdentity, invited: boolean): boolean {
  if (invited) return true;
  if (post.visibility === "all_eligible") return true;
  if (post.visibility === "selected_groups") {
    const groups = Array.isArray(post.eligible_groups) ? (post.eligible_groups as unknown[]).map(String) : [];
    return !!who.workerGroup && groups.includes(who.workerGroup);
  }
  return false; // invited_only without an invitation
}

/**
 * Can this worker see (and, when open, bid on / apply to) this posting?
 * Always company-bound. Contractor postings are for contractor workers only;
 * employee positions are open to any active worker of the company (an existing
 * contractor may apply for an employee position — the application never
 * touches their contractor record).
 */
export function workerEligibleForPost(
  post: { company_id: string; worker_classification: string; visibility: string; eligible_groups: unknown },
  who: WorkerIdentity,
  invited: boolean,
): boolean {
  if (!who.companyId || who.companyId !== post.company_id) return false;
  if (who.status && who.status !== "active") return false;
  if (post.worker_classification === "contractor") {
    if (who.workerType !== "contractor") return false;
    return groupAndInviteCheck(post, who, invited);
  }
  if (post.worker_classification === "employee") {
    if (who.workerType !== "contractor" && who.workerType !== "employee") return false;
    return groupAndInviteCheck(post, who, false);
  }
  return false;
}

/** Back-compat name for the contractor path. */
export function contractorEligibleForPost(
  post: { company_id: string; status?: string; worker_classification?: string; visibility: string; eligible_groups: unknown },
  who: ContractorIdentity,
  invited: boolean,
): boolean {
  return workerEligibleForPost({ ...post, worker_classification: post.worker_classification ?? "contractor" }, who, invited);
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

function stringList(v: unknown, maxItems: number, maxLen: number): string[] | "invalid" {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > maxItems) return "invalid";
  return Array.from(new Set(v.map((g) => str(g, maxLen)).filter((g): g is string => !!g)));
}

/** Posting columns an administrator may set, keyed by API (camelCase) name → column. */
export const POST_FIELD_COLUMNS = {
  workerClassification: "worker_classification",
  opportunityType: "opportunity_type",
  scheduleType: "schedule_type",
  employmentType: "employment_type",
  durationType: "duration_type",
  hoursPerWeekMin: "hours_per_week_min",
  hoursPerWeekMax: "hours_per_week_max",
  title: "title",
  summary: "summary",
  scopeOfWork: "scope_of_work",
  requirements: "requirements",
  deliverables: "deliverables",
  requiredSkills: "required_skills",
  experienceRequirements: "experience_requirements",
  workLocationType: "work_location_type",
  locationText: "location_text",
  recurrenceFrequency: "recurrence_frequency",
  recurrenceDescription: "recurrence_description",
  startDate: "start_date",
  endDate: "end_date",
  applicationDeadline: "application_deadline",
  compensationType: "compensation_type",
  compensationMin: "compensation_min",
  compensationMax: "compensation_max",
  currency: "currency",
  paymentTerms: "payment_terms",
  numberOfOpenings: "number_of_openings",
  visibility: "visibility",
  eligibleGroups: "eligible_groups",
  costJobId: "cost_job_id",
} as const;
export type PostField = keyof typeof POST_FIELD_COLUMNS;
export const JSON_POST_COLUMNS: ReadonlySet<string> = new Set(["eligible_groups", "required_skills"]);

/** Edits to these after publication notify existing candidates and are audited as material. */
export const MATERIAL_POST_FIELDS: ReadonlySet<PostField> = new Set<PostField>([
  "scheduleType", "employmentType", "durationType", "hoursPerWeekMin", "hoursPerWeekMax",
  "scopeOfWork", "requirements", "deliverables", "requiredSkills", "experienceRequirements",
  "workLocationType", "locationText", "recurrenceFrequency", "startDate", "endDate", "applicationDeadline",
  "compensationType", "compensationMin", "compensationMax", "currency", "paymentTerms", "numberOfOpenings",
]);

const REQUIRED_ENUM_FIELDS: ReadonlySet<PostField> = new Set<PostField>([
  "workerClassification", "opportunityType", "scheduleType", "durationType",
  "workLocationType", "compensationType", "visibility", "currency",
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
      case "workerClassification": v = oneOf(raw, WORKER_CLASSIFICATIONS); break;
      case "opportunityType": v = oneOf(raw, OPPORTUNITY_TYPES); break;
      case "scheduleType": v = oneOf(raw, SCHEDULE_TYPES); break;
      case "employmentType": v = oneOf(raw, EMPLOYMENT_TYPES); break;
      case "durationType": v = oneOf(raw, DURATION_TYPES); break;
      case "workLocationType": v = oneOf(raw, WORK_LOCATION_TYPES); break;
      case "recurrenceFrequency": v = oneOf(raw, RECURRENCE_FREQUENCIES); break;
      case "compensationType": v = oneOf(raw, COMPENSATION_TYPES); break;
      case "visibility": v = oneOf(raw, VISIBILITIES); break;
      case "hoursPerWeekMin":
      case "hoursPerWeekMax": v = num(raw, 168); break;
      case "startDate":
      case "endDate": v = dateOnly(raw); break;
      case "applicationDeadline": v = timestampVal(raw); break;
      case "compensationMin":
      case "compensationMax": v = money(raw); break;
      case "currency": {
        const c = str(raw, 3);
        v = c == null ? null : /^[A-Za-z]{3}$/.test(c) ? c.toUpperCase() : "invalid";
        break;
      }
      case "numberOfOpenings": {
        if (raw === null || raw === "" || raw === undefined) { v = null; break; }
        const n = Number(raw);
        v = Number.isInteger(n) && n >= 1 && n <= 10000 ? n : "invalid";
        break;
      }
      case "eligibleGroups": v = stringList(raw, 50, 100); break;
      case "requiredSkills": v = stringList(raw, 50, 100); break;
      case "costJobId": v = str(raw, 64); break;
      default: v = str(raw);
    }
    if (v === "invalid") return bad(`Invalid ${key}`);
    if (v === null && REQUIRED_ENUM_FIELDS.has(key)) return bad(`${key} cannot be empty`);
    out[POST_FIELD_COLUMNS[key]] = v;
    fields.push(key);
  }

  if (!opts.partial) {
    if (!out.title) return bad("Title is required");
    if (!out.worker_classification) return bad("Choose Contractor Work or Employee Position");
    if (!out.schedule_type) return bad("Choose One-time, Recurring, Part-time or Full-time");
  }
  return { ok: true, values: out, fields };
}

/**
 * Derive the classification-dependent columns for a NEW posting from the
 * administrator's two first choices (classification, then schedule). The
 * administrator may override opportunity_type for contractor work
 * (project vs recurring_work); employee postings are always 'position'.
 */
export function derivePostDefaults(v: NormalizedPost): NormalizedPost {
  const cls = v.worker_classification as string;
  const sched = v.schedule_type as string;
  const out: NormalizedPost = { ...v };
  if (cls === "employee") {
    out.opportunity_type = "position";
    out.employment_type = sched;
    if (out.duration_type == null) out.duration_type = "ongoing";
    if (out.compensation_type == null) out.compensation_type = "undisclosed";
    if (!("number_of_openings" in out) || out.number_of_openings == null) out.number_of_openings = 1;
  } else {
    out.employment_type = null;
    if (out.opportunity_type == null) out.opportunity_type = sched === "recurring" ? "recurring_work" : "project";
    if (out.duration_type == null) out.duration_type = sched === "one_time" ? "fixed_term" : "ongoing";
    if (out.compensation_type == null) out.compensation_type = "undisclosed";
    if (!("number_of_openings" in out) && out.opportunity_type !== "recurring_work") out.number_of_openings = 1;
  }
  return out;
}

/**
 * Re-derive the dependent columns after a PATCH so a draft stays internally
 * consistent (e.g. employee schedule change → employment_type follows).
 */
export function reconcileClassificationColumns(merged: Record<string, any>): Record<string, unknown> {
  const fix: Record<string, unknown> = {};
  if (merged.worker_classification === "employee") {
    if (merged.opportunity_type !== "position") fix.opportunity_type = "position";
    if (merged.employment_type !== merged.schedule_type && (merged.schedule_type === "part_time" || merged.schedule_type === "full_time")) {
      fix.employment_type = merged.schedule_type;
    }
    if (merged.number_of_openings == null) fix.number_of_openings = 1;
  } else if (merged.worker_classification === "contractor") {
    if (merged.employment_type != null) fix.employment_type = null;
    if (merged.opportunity_type === "position") fix.opportunity_type = merged.schedule_type === "recurring" ? "recurring_work" : "project";
    const opp = fix.opportunity_type ?? merged.opportunity_type;
    if (merged.number_of_openings == null && opp !== "recurring_work") fix.number_of_openings = 1;
  }
  return fix;
}

/** Cross-field checks on the MERGED posting (stored row + edits) — run on every write and before publish. */
export function validatePostShape(p: Record<string, any>, opts: { forPublish: boolean; now?: Date }): { ok: true } | { ok: false; status: 400; message: string } {
  const bad = (m: string) => ({ ok: false as const, status: 400 as const, message: m });
  const cls = p.worker_classification;
  if (cls !== "contractor" && cls !== "employee") return bad("Choose Contractor Work or Employee Position");
  if (cls === "employee") {
    if (p.opportunity_type !== "position") return bad("An employee posting must be a position");
    if (p.schedule_type !== "part_time" && p.schedule_type !== "full_time") return bad("An employee position must be part-time or full-time");
    if (p.employment_type !== p.schedule_type) return bad("Employment type must match the part-time/full-time schedule");
    if (p.compensation_type === "fixed_bid") return bad("Employee positions cannot use fixed-bid compensation");
    if (p.visibility === "invited_only") return bad("Invitations are for contractor work; choose all eligible or selected groups");
  } else {
    if (p.opportunity_type === "position") return bad("Contractor work must be a project or recurring work");
    if (p.employment_type != null) return bad("Employment type applies only to employee positions");
    if (p.opportunity_type === "project" && p.schedule_type === "recurring") return bad("A recurring schedule must be posted as recurring work");
    if (p.opportunity_type === "recurring_work" && p.schedule_type === "one_time") return bad("One-time work must be posted as a project");
  }
  if (p.hours_per_week_min != null && p.hours_per_week_max != null && Number(p.hours_per_week_min) > Number(p.hours_per_week_max)) {
    return bad("Minimum hours per week exceeds maximum");
  }
  if (p.compensation_min != null && p.compensation_max != null && Number(p.compensation_min) > Number(p.compensation_max)) {
    return bad("Compensation minimum exceeds maximum");
  }
  if (p.start_date && p.end_date && dateOnlyString(p.start_date)! > dateOnlyString(p.end_date)!) return bad("Start date is after the end date");
  if (p.schedule_type !== "recurring" && p.opportunity_type !== "recurring_work" && p.recurrence_frequency) {
    return bad("Only recurring work can have a recurrence frequency");
  }
  if (p.number_of_openings == null && p.opportunity_type !== "recurring_work") return bad("Set the number of openings");
  if (p.number_of_openings != null && Number(p.filled_count ?? 0) > Number(p.number_of_openings)) {
    return bad("Number of openings is below the number already filled");
  }
  if (p.visibility === "selected_groups" && (!Array.isArray(p.eligible_groups) || p.eligible_groups.length === 0)) {
    return bad("Select at least one worker group for a group-restricted posting");
  }
  if (opts.forPublish) {
    if (!p.title) return bad("Title is required");
    if (!p.scope_of_work && !p.summary) return bad("Add a summary or description before publishing");
    if (p.opportunity_type === "recurring_work" && p.schedule_type === "recurring" && !p.recurrence_frequency) {
      return bad("Choose a recurrence frequency for recurring work");
    }
    if ((p.compensation_type === "hourly" || p.compensation_type === "salary" || p.compensation_type === "fixed_bid")
        && p.compensation_min == null && p.compensation_max == null && cls === "employee") {
      return bad("Enter the pay amount for this position");
    }
    if (p.compensation_type === "range" && (p.compensation_min == null || p.compensation_max == null)) return bad("Enter both ends of the compensation range");
    const now = opts.now ?? new Date();
    if (p.application_deadline && new Date(p.application_deadline).getTime() < now.getTime()) return bad("The application deadline is in the past");
  }
  return { ok: true };
}

// ── Contractor bid input ────────────────────────────────────────────────────
export const BID_FIELD_COLUMNS = {
  coverMessage: "cover_message",
  scopeAndDeliverables: "scope_and_deliverables",
  proposedAmount: "proposed_amount",
  rateType: "rate_type",
  hourlyRate: "hourly_rate",
  estimatedHours: "estimated_hours",
  proposedSchedule: "proposed_schedule",
  availability: "availability",
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

/** A proposal must state its price, and either hours or a completion date, before it can be submitted. */
export function validateBidForSubmit(b: Record<string, any>): { ok: true } | { ok: false; status: 400; message: string } {
  const bad = (m: string) => ({ ok: false as const, status: 400 as const, message: m });
  if (b.proposed_amount == null && b.hourly_rate == null) return bad("Enter a proposed price or rate before submitting");
  if (b.rate_type === "hourly" && b.hourly_rate == null) return bad("Enter an hourly rate for an hourly proposal");
  if (b.estimated_hours == null && !b.estimated_completion_date) return bad("Enter estimated hours or a completion date");
  if (!b.scope_and_deliverables) return bad("Describe the scope and deliverables");
  if (b.estimated_start_date && b.estimated_completion_date && dateOnlyString(b.estimated_start_date)! > dateOnlyString(b.estimated_completion_date)!) {
    return bad("Estimated start date is after the completion date");
  }
  return { ok: true };
}

/** Award proposal amount: the bid's fixed amount, else hourly rate × estimated hours, else null (contractor completes it). */
export function awardProposalAmount(b: { proposed_amount?: string | null; hourly_rate?: string | null; estimated_hours?: string | null }): string | null {
  if (b.proposed_amount != null) return Number(b.proposed_amount).toFixed(2);
  if (b.hourly_rate != null && b.estimated_hours != null) return (Number(b.hourly_rate) * Number(b.estimated_hours)).toFixed(2);
  return null;
}

// ── Employee application input ──────────────────────────────────────────────
export const APPLICATION_FIELD_COLUMNS = {
  coverMessage: "cover_message",
  availability: "availability",
  desiredCompensation: "desired_compensation",
  qualifications: "qualifications",
} as const;
export type ApplicationField = keyof typeof APPLICATION_FIELD_COLUMNS;

export function normalizeApplicationInput(body: Fields):
  { ok: true; values: Partial<Record<(typeof APPLICATION_FIELD_COLUMNS)[ApplicationField], unknown>> } | { ok: false; status: 400; message: string } {
  const out: Partial<Record<(typeof APPLICATION_FIELD_COLUMNS)[ApplicationField], unknown>> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body ?? {}, k);
  for (const key of Object.keys(APPLICATION_FIELD_COLUMNS) as ApplicationField[]) {
    if (!has(key)) continue;
    out[APPLICATION_FIELD_COLUMNS[key]] = str(body[key], key === "desiredCompensation" ? 200 : 20000);
  }
  return { ok: true, values: out };
}

/** Normalize one screening answer against its question definition. */
export function normalizeScreeningAnswer(q: { answer_type: string; options: unknown; required: boolean }, raw: unknown):
  { ok: true; value: string | null } | { ok: false; message: string } {
  const s = raw == null ? null : String(raw).trim().slice(0, 4000) || null;
  if (s == null) return q.required ? { ok: false, message: "required" } : { ok: true, value: null };
  switch (q.answer_type) {
    case "yes_no": return s === "yes" || s === "no" ? { ok: true, value: s } : { ok: false, message: "must be yes or no" };
    case "number": return Number.isFinite(Number(s)) ? { ok: true, value: String(Number(s)) } : { ok: false, message: "must be a number" };
    case "choice": {
      const opts = Array.isArray(q.options) ? q.options.map(String) : [];
      return opts.includes(s) ? { ok: true, value: s } : { ok: false, message: "must be one of the listed options" };
    }
    default: return { ok: true, value: s };
  }
}

export function normalizeScreeningQuestion(body: Fields):
  { ok: true; values: { prompt: string; answer_type: string; options: string[]; required: boolean; position: number } } | { ok: false; status: 400; message: string } {
  const prompt = str(body?.prompt, 1000);
  if (!prompt) return { ok: false, status: 400, message: "Enter the question" };
  const t = oneOf(body?.answerType ?? "text", SCREENING_ANSWER_TYPES);
  if (t === "invalid" || t == null) return { ok: false, status: 400, message: "Invalid answerType" };
  const options = stringList(body?.options, 30, 200);
  if (options === "invalid") return { ok: false, status: 400, message: "Invalid options" };
  if (t === "choice" && options.length < 2) return { ok: false, status: 400, message: "A choice question needs at least two options" };
  const pos = Number(body?.position ?? 0);
  return { ok: true, values: { prompt, answer_type: t, options: t === "choice" ? options : [], required: body?.required === true, position: Number.isInteger(pos) ? pos : 0 } };
}

/** Consent + acknowledgements an applicant must give before submitting. */
export function validateApplicationConsent(acks: unknown): { ok: true; acknowledgements: Record<string, true> } | { ok: false; status: 400; message: string } {
  const a = (acks && typeof acks === "object" ? acks : {}) as Record<string, unknown>;
  const missing = REQUIRED_APPLICATION_ACKNOWLEDGEMENTS.filter((k) => a[k] !== true);
  if (missing.length) return { ok: false, status: 400, message: `Confirm every acknowledgement before applying (${missing.join(", ")})` };
  const out: Record<string, true> = {};
  for (const k of REQUIRED_APPLICATION_ACKNOWLEDGEMENTS) out[k] = true;
  return { ok: true, acknowledgements: out };
}

// ── Projections ─────────────────────────────────────────────────────────────
/**
 * What a worker may see of a posting. Never: who created it, internal cost job,
 * other candidates, per-candidate award/hire counts. Exposes only whether
 * capacity remains — not who filled it.
 */
export function projectPostForWorker(p: Record<string, any>) {
  const max = effectiveOpenings({ opportunity_type: p.opportunity_type, number_of_openings: p.number_of_openings });
  return {
    id: p.id,
    companyId: p.company_id,
    companyName: p.company_name ?? null,
    workerClassification: p.worker_classification,
    submissionKind: submissionKind(p),
    cta: submissionCta(p),
    opportunityType: p.opportunity_type,
    scheduleType: p.schedule_type,
    employmentType: p.employment_type,
    durationType: p.duration_type,
    hoursPerWeekMin: p.hours_per_week_min,
    hoursPerWeekMax: p.hours_per_week_max,
    title: p.title,
    summary: p.summary,
    scopeOfWork: p.scope_of_work,
    requirements: p.requirements,
    deliverables: p.deliverables,
    requiredSkills: Array.isArray(p.required_skills) ? p.required_skills : [],
    experienceRequirements: p.experience_requirements,
    workLocationType: p.work_location_type,
    locationText: p.location_text,
    recurrenceFrequency: p.recurrence_frequency,
    recurrenceDescription: p.recurrence_description,
    startDate: dateOnlyString(p.start_date),
    endDate: dateOnlyString(p.end_date),
    applicationDeadline: p.application_deadline,
    compensationType: p.compensation_type,
    compensationMin: p.compensation_type === "undisclosed" ? null : p.compensation_min,
    compensationMax: p.compensation_type === "undisclosed" ? null : p.compensation_max,
    currency: p.currency,
    paymentTerms: p.payment_terms,
    numberOfOpenings: max,
    status: p.status,
    hasFills: Number(p.filled_count ?? 0) > 0,
    openingsRemaining: max == null ? null : Math.max(0, max - Number(p.filled_count ?? 0)),
    publishedAt: p.published_at,
    closedAt: p.closed_at,
  };
}
/** Back-compat alias. */
export const projectPostForContractor = projectPostForWorker;

export function projectPostForAdmin(p: Record<string, any>) {
  return {
    ...projectPostForWorker(p),
    tenantId: p.tenant_id,
    createdByUserId: p.created_by_user_id,
    compensationMin: p.compensation_min,
    compensationMax: p.compensation_max,
    numberOfOpeningsSetting: p.number_of_openings,
    filledCount: Number(p.filled_count ?? 0),
    visibility: p.visibility,
    eligibleGroups: Array.isArray(p.eligible_groups) ? p.eligible_groups : [],
    costJobId: p.cost_job_id,
    classificationDeclaredByUserId: p.classification_declared_by_user_id,
    classificationDeclaredAt: p.classification_declared_at,
    classificationIndicators: employmentIndicators(p),
    acknowledgedIndicators: Array.isArray(p.classification_indicators) ? p.classification_indicators : [],
    classificationAcknowledgedAt: p.classification_acknowledged_at,
    closeReason: p.close_reason,
    archivedAt: p.archived_at,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    submissionCounts: p.submission_counts ?? undefined,
  };
}

/** A contractor's own bid. Internal review fields (reviewer id, idempotency key) are omitted. */
export function projectBidForContractor(b: Record<string, any>) {
  return {
    id: b.id,
    jobPostId: b.job_post_id,
    status: b.status,
    coverMessage: b.cover_message,
    scopeAndDeliverables: b.scope_and_deliverables,
    proposedAmount: b.proposed_amount,
    rateType: b.rate_type,
    hourlyRate: b.hourly_rate,
    estimatedHours: b.estimated_hours,
    proposedSchedule: b.proposed_schedule,
    availability: b.availability,
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

/** An applicant's own application. Reviewer ids and conversion internals are omitted. */
export function projectApplicationForApplicant(a: Record<string, any>) {
  return {
    id: a.id,
    jobPostId: a.job_post_id,
    status: a.status,
    coverMessage: a.cover_message,
    availability: a.availability,
    desiredCompensation: a.desired_compensation,
    qualifications: a.qualifications,
    consentVersion: a.consent_version,
    consentAcceptedAt: a.consent_accepted_at,
    submittedAt: a.submitted_at,
    withdrawnAt: a.withdrawn_at,
    hiredAt: a.hired_at,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
    jobTitle: a.job_title ?? undefined,
    jobStatus: a.job_status ?? undefined,
  };
}

export function projectApplicationForAdmin(a: Record<string, any>) {
  return {
    ...projectApplicationForApplicant(a),
    applicantUserId: a.applicant_user_id,
    applicantWorkerId: a.applicant_worker_id,
    applicantName: a.applicant_name ?? null,
    acknowledgements: a.acknowledgements ?? {},
    rejectionReason: a.rejection_reason,
    reviewedAt: a.reviewed_at,
    reviewedByUserId: a.reviewed_by_user_id,
    hiredByUserId: a.hired_by_user_id,
    convertedWorkerId: a.converted_worker_id,
    convertedWorkerType: a.converted_worker_type,
    convertedAt: a.converted_at,
    documentCount: a.document_count ?? undefined,
  };
}
