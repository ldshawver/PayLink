/**
 * Job board — pure rules (server/job-board/rules.ts). Contractor proposals and
 * employee applications are separate paths; these tests pin the classification
 * rules, both state machines, capacity, and the projections.
 * No DB, no network. Run: npx tsx tests/contractor-job-board.test.ts
 */
import assert from "node:assert/strict";
import {
  applicationVisibleToAdmin, awardProposalAmount, bidIsContractorEditable, bidVisibleToAdmin, dateOnlyString,
  decideApplicationTransition, decideBidTransition, decideClassificationChange, decideFill, decidePostEdit,
  decidePostTransition, derivePostDefaults, effectiveOpenings, employmentIndicators, hasUnacknowledgedIndicators,
  normalizeApplicationInput, normalizeBidInput, normalizePostInput, normalizeScreeningAnswer, normalizeScreeningQuestion,
  postingExpired, projectApplicationForApplicant, projectBidForContractor, projectPostForWorker,
  reconcileClassificationColumns, submissionCta, submissionKind, submissionsOpen, validateApplicationConsent,
  validateBidForSubmit, validatePostShape, workerEligibleForPost, CLASSIFICATION_NOTICE,
} from "../server/job-board/rules";

let pass = 0, fail = 0;
function t(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); } catch (e) { fail++; console.error(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const contractorPost = (over: Record<string, unknown> = {}) => ({
  worker_classification: "contractor", opportunity_type: "project", schedule_type: "one_time", employment_type: null,
  duration_type: "fixed_term", compensation_type: "fixed_bid", number_of_openings: 1, filled_count: 0, visibility: "all_eligible",
  eligible_groups: [], title: "Paint", summary: "Paint the hall", status: "draft", company_id: "co", ...over,
});
const employeePost = (over: Record<string, unknown> = {}) => ({
  worker_classification: "employee", opportunity_type: "position", schedule_type: "full_time", employment_type: "full_time",
  duration_type: "ongoing", compensation_type: "salary", compensation_min: "50000", number_of_openings: 2, filled_count: 0,
  visibility: "all_eligible", eligible_groups: [], title: "Bookkeeper", summary: "Keep books", status: "draft", company_id: "co", ...over,
});

console.log("classification → submission path");
t("contractor posting → proposal path, CTA 'Submit Proposal'", () => {
  assert.equal(submissionKind(contractorPost()), "proposal");
  assert.equal(submissionCta(contractorPost()), "Submit Proposal");
});
t("employee posting → application path, CTA 'Apply'", () => {
  assert.equal(submissionKind(employeePost()), "application");
  assert.equal(submissionCta(employeePost()), "Apply");
});
t("worker projection always carries classification + CTA", () => {
  const p = projectPostForWorker(employeePost({ id: "x" }));
  assert.equal(p.workerClassification, "employee");
  assert.equal(p.cta, "Apply");
  const c = projectPostForWorker(contractorPost({ id: "y" }));
  assert.equal(c.workerClassification, "contractor");
  assert.equal(c.cta, "Submit Proposal");
});
t("worker projection hides creator, cost job, and per-candidate data", () => {
  const p = projectPostForWorker(contractorPost({ id: "x", created_by_user_id: "u", cost_job_id: "j", filled_count: 1, number_of_openings: 3 })) as any;
  assert.equal(p.createdByUserId, undefined);
  assert.equal(p.costJobId, undefined);
  assert.equal(p.openingsRemaining, 2);
});

console.log("posting input");
t("create requires classification first, then schedule", () => {
  assert.equal(normalizePostInput({ title: "x" }, { partial: false }).ok, false);
  assert.equal(normalizePostInput({ title: "x", workerClassification: "employee" }, { partial: false }).ok, false);
  assert.equal(normalizePostInput({ title: "x", workerClassification: "employee", scheduleType: "full_time" }, { partial: false }).ok, true);
});
t("unknown classification / schedule rejected", () => {
  assert.equal(normalizePostInput({ title: "x", workerClassification: "freelancer", scheduleType: "one_time" }, { partial: false }).ok, false);
  assert.equal(normalizePostInput({ title: "x", workerClassification: "contractor", scheduleType: "weekly" }, { partial: false }).ok, false);
});
t("status / companyId / filled_count are not settable", () => {
  const n = normalizePostInput({ status: "published", companyId: "evil", filledCount: 9 }, { partial: true }) as any;
  assert.equal(n.ok, true);
  assert.deepEqual(n.fields, []);
});
t("hours/week bounded 0–168; required skills de-duplicated", () => {
  assert.equal(normalizePostInput({ hoursPerWeekMax: 200 }, { partial: true }).ok, false);
  const n = normalizePostInput({ requiredSkills: ["A", "A", " B "] }, { partial: true }) as any;
  assert.deepEqual(n.values.required_skills, ["A", "B"]);
});
t("employee defaults: position, employment_type = schedule, 1 opening", () => {
  const v = derivePostDefaults({ worker_classification: "employee", schedule_type: "part_time" }) as any;
  assert.equal(v.opportunity_type, "position");
  assert.equal(v.employment_type, "part_time");
  assert.equal(v.number_of_openings, 1);
});
t("contractor defaults: one_time → project (1 opening); recurring → recurring_work (unlimited)", () => {
  const a = derivePostDefaults({ worker_classification: "contractor", schedule_type: "one_time" }) as any;
  assert.equal(a.opportunity_type, "project");
  assert.equal(a.employment_type, null);
  assert.equal(a.number_of_openings, 1);
  const b = derivePostDefaults({ worker_classification: "contractor", schedule_type: "recurring" }) as any;
  assert.equal(b.opportunity_type, "recurring_work");
  assert.equal(b.number_of_openings, undefined);
});
t("contractor part-/full-time may be a project OR recurring work", () => {
  for (const opp of ["project", "recurring_work"]) {
    for (const sched of ["part_time", "full_time"]) {
      assert.equal(validatePostShape(contractorPost({ opportunity_type: opp, schedule_type: sched, number_of_openings: 2 }), { forPublish: false }).ok, true, `${opp}/${sched}`);
    }
  }
});

console.log("shape validation (mirrors the DB CHECKs)");
t("employee must be position + part/full time + matching employment_type", () => {
  assert.equal(validatePostShape(employeePost(), { forPublish: false }).ok, true);
  assert.equal(validatePostShape(employeePost({ opportunity_type: "project" }), { forPublish: false }).ok, false);
  assert.equal(validatePostShape(employeePost({ schedule_type: "one_time", employment_type: "one_time" }), { forPublish: false }).ok, false);
  assert.equal(validatePostShape(employeePost({ employment_type: "part_time" }), { forPublish: false }).ok, false);
});
t("employee positions cannot be fixed-bid", () => {
  assert.equal(validatePostShape(employeePost({ compensation_type: "fixed_bid" }), { forPublish: false }).ok, false);
});
t("contractor work can never be a 'position' or carry employment_type", () => {
  assert.equal(validatePostShape(contractorPost({ opportunity_type: "position" }), { forPublish: false }).ok, false);
  assert.equal(validatePostShape(contractorPost({ employment_type: "full_time" }), { forPublish: false }).ok, false);
});
t("project cannot be 'recurring'; recurring_work cannot be 'one_time'", () => {
  assert.equal(validatePostShape(contractorPost({ schedule_type: "recurring" }), { forPublish: false }).ok, false);
  assert.equal(validatePostShape(contractorPost({ opportunity_type: "recurring_work", schedule_type: "one_time", number_of_openings: null }), { forPublish: false }).ok, false);
});
t("unlimited openings only for recurring work", () => {
  assert.equal(validatePostShape(contractorPost({ number_of_openings: null }), { forPublish: false }).ok, false);
  assert.equal(validatePostShape(contractorPost({ opportunity_type: "recurring_work", schedule_type: "recurring", number_of_openings: null }), { forPublish: false }).ok, true);
});
t("ranges: hours, compensation, dates", () => {
  assert.equal(validatePostShape(employeePost({ hours_per_week_min: 40, hours_per_week_max: 20 }), { forPublish: false }).ok, false);
  assert.equal(validatePostShape(employeePost({ compensation_min: 10, compensation_max: 5 }), { forPublish: false }).ok, false);
  assert.equal(validatePostShape(employeePost({ start_date: "2027-02-01", end_date: "2027-01-01" }), { forPublish: false }).ok, false);
});
t("invitations are a contractor concept: employee posting cannot be invited_only", () => {
  assert.equal(validatePostShape(employeePost({ visibility: "invited_only" }), { forPublish: false }).ok, false);
});
t("publish: salaried employee position needs a pay amount; range needs both ends", () => {
  assert.equal(validatePostShape(employeePost({ compensation_min: null }), { forPublish: true }).ok, false);
  assert.equal(validatePostShape(employeePost({ compensation_type: "range", compensation_min: 1, compensation_max: null }), { forPublish: true }).ok, false);
  assert.equal(validatePostShape(employeePost(), { forPublish: true }).ok, true);
});
t("reconcile keeps a draft consistent after a classification/schedule edit", () => {
  assert.deepEqual(reconcileClassificationColumns(employeePost({ schedule_type: "part_time" })), { employment_type: "part_time" });
  const fix = reconcileClassificationColumns({ ...employeePost(), worker_classification: "contractor" }) as any;
  assert.equal(fix.employment_type, null);
  assert.equal(fix.opportunity_type, "project");
});

console.log("classification indicators (advisory only)");
t("plain one-time contractor project → no indicators", () => assert.deepEqual(employmentIndicators(contractorPost()), []));
t("contractor full-time / ongoing / 30+ h / salary → indicators", () => {
  const i = employmentIndicators(contractorPost({ schedule_type: "full_time", duration_type: "ongoing", hours_per_week_max: 40, compensation_type: "salary" }));
  assert.deepEqual(i.sort(), ["full_time_schedule", "hours_30_plus", "ongoing_duration", "salary_compensation"]);
  assert.deepEqual(employmentIndicators(contractorPost({ schedule_type: "part_time" })), ["part_time_schedule"]);
});
t("an open-ended recurring service is not flagged on duration alone", () => {
  assert.deepEqual(employmentIndicators(contractorPost({ opportunity_type: "recurring_work", schedule_type: "recurring", duration_type: "ongoing" })), []);
});
t("employee postings never produce indicators", () => assert.deepEqual(employmentIndicators(employeePost({ hours_per_week_max: 40 })), []));
t("acknowledgement covers only the indicators shown", () => {
  assert.equal(hasUnacknowledgedIndicators(["ongoing_duration"], ["ongoing_duration"]), false);
  assert.equal(hasUnacknowledgedIndicators(["ongoing_duration", "hours_30_plus"], ["ongoing_duration"]), true);
  assert.equal(hasUnacknowledgedIndicators([], null), false);
});
t("notice text makes no legal determination", () => assert.match(CLASSIFICATION_NOTICE, /does not determine/));
t("classification frozen once published", () => {
  assert.equal(decideClassificationChange({ status: "draft", worker_classification: "contractor" }, "employee").ok, true);
  for (const s of ["published", "paused", "closed", "archived"]) {
    assert.equal(decideClassificationChange({ status: s, worker_classification: "contractor" }, "employee").ok, false, s);
  }
  assert.equal(decideClassificationChange({ status: "published", worker_classification: "employee" }, "employee").ok, true);
});

console.log("posting state machine");
t("draft → published → paused → published → closed → archived", () => {
  assert.equal((decidePostTransition("draft", "publish") as any).to, "published");
  assert.equal((decidePostTransition("published", "pause") as any).to, "paused");
  assert.equal((decidePostTransition("paused", "reopen") as any).to, "published");
  assert.equal((decidePostTransition("published", "close") as any).to, "closed");
  assert.equal((decidePostTransition("closed", "archive") as any).to, "archived");
});
t("archived is terminal; publishing twice is 409", () => {
  for (const a of ["publish", "pause", "reopen", "close", "archive"] as const) assert.equal(decidePostTransition("archived", a).ok, false);
  assert.equal((decidePostTransition("published", "publish") as any).status, 409);
});
t("edits: draft/paused free, published audited, closed/archived locked", () => {
  assert.deepEqual(decidePostEdit("draft"), { ok: true, audited: false });
  assert.deepEqual(decidePostEdit("published"), { ok: true, audited: true });
  assert.equal(decidePostEdit("closed").ok, false);
});

console.log("capacity");
t("one-time project closes when its single opening is awarded", () => {
  assert.deepEqual(decideFill({ status: "published", opportunity_type: "project", number_of_openings: 1, filled_count: 0 }), { ok: true, closeAfter: true });
  assert.equal(decideFill({ status: "published", opportunity_type: "project", number_of_openings: 1, filled_count: 1 }).ok, false);
});
t("recurring work with no limit stays open after any number of awards", () => {
  for (const n of [0, 1, 5, 50]) {
    assert.deepEqual(decideFill({ status: "published", opportunity_type: "recurring_work", number_of_openings: null, filled_count: n }), { ok: true, closeAfter: false });
  }
});
t("multi-opening posting (employee or PT/FT contractor) closes when every opening is filled", () => {
  assert.deepEqual(decideFill({ status: "published", opportunity_type: "position", number_of_openings: 2, filled_count: 0 }), { ok: true, closeAfter: false });
  assert.deepEqual(decideFill({ status: "published", opportunity_type: "position", number_of_openings: 2, filled_count: 1 }), { ok: true, closeAfter: true });
  assert.equal(decideFill({ status: "published", opportunity_type: "position", number_of_openings: 2, filled_count: 2 }).ok, false);
});
t("cannot fill a draft/closed posting", () => {
  assert.equal(decideFill({ status: "draft", opportunity_type: "project", number_of_openings: 1, filled_count: 0 }).ok, false);
  assert.equal(decideFill({ status: "closed", opportunity_type: "project", number_of_openings: 1, filled_count: 0 }).ok, false);
});
t("effective openings default: project/position 1, recurring unlimited", () => {
  assert.equal(effectiveOpenings({ opportunity_type: "project", number_of_openings: null }), 1);
  assert.equal(effectiveOpenings({ opportunity_type: "position", number_of_openings: null }), 1);
  assert.equal(effectiveOpenings({ opportunity_type: "recurring_work", number_of_openings: null }), null);
});
t("expiry only for recurring work past its end date", () => {
  assert.equal(postingExpired({ status: "published", opportunity_type: "recurring_work", end_date: "2026-01-01" }, "2026-02-01"), true);
  assert.equal(postingExpired({ status: "published", opportunity_type: "position", end_date: "2026-01-01" }, "2026-02-01"), false);
});

console.log("eligibility");
const who = (workerType: string, over: Record<string, unknown> = {}) => ({ workerId: "w", companyId: "co", workerType, workerGroup: null, status: "active", ...over });
t("contractor postings: contractors only", () => {
  assert.equal(workerEligibleForPost(contractorPost(), who("contractor"), false), true);
  assert.equal(workerEligibleForPost(contractorPost(), who("employee"), false), false);
});
t("employee postings: employees and contractors of the company may apply", () => {
  assert.equal(workerEligibleForPost(employeePost(), who("employee"), false), true);
  assert.equal(workerEligibleForPost(employeePost(), who("contractor"), false), true);
});
t("never cross-company; inactive workers excluded", () => {
  assert.equal(workerEligibleForPost(employeePost(), who("employee", { companyId: "other" }), false), false);
  assert.equal(workerEligibleForPost(contractorPost(), who("contractor", { status: "terminated" }), false), false);
});
t("invitations widen contractor postings only", () => {
  assert.equal(workerEligibleForPost(contractorPost({ visibility: "invited_only" }), who("contractor"), true), true);
  assert.equal(workerEligibleForPost(employeePost({ visibility: "selected_groups", eligible_groups: ["x"] }), who("employee"), true), false);
});

console.log("contractor proposals");
t("proposal state machine: award only from submitted/under_review/shortlisted", () => {
  for (const s of ["submitted", "under_review", "shortlisted"]) assert.equal(decideBidTransition(s, "award").ok, true, s);
  for (const s of ["draft", "withdrawn", "rejected", "awarded", "converted_to_proposal", "revision_requested"]) assert.equal(decideBidTransition(s, "award").ok, false, s);
});
t("proposal input carries schedule, availability, scope & deliverables", () => {
  const n = normalizeBidInput({ proposedSchedule: "Mon–Wed", availability: "From May", scopeAndDeliverables: "All rooms", estimatedHours: 12 }) as any;
  assert.equal(n.values.proposed_schedule, "Mon–Wed");
  assert.equal(n.values.availability, "From May");
  assert.equal(n.values.scope_and_deliverables, "All rooms");
});
t("submit needs price, hours-or-completion date, and scope", () => {
  assert.equal(validateBidForSubmit({ scope_and_deliverables: "x", estimated_hours: 2 }).ok, false);
  assert.equal(validateBidForSubmit({ proposed_amount: "10", scope_and_deliverables: "x" }).ok, false);
  assert.equal(validateBidForSubmit({ proposed_amount: "10", estimated_hours: 2 }).ok, false);
  assert.equal(validateBidForSubmit({ proposed_amount: "10", estimated_completion_date: "2027-01-01", scope_and_deliverables: "x" }).ok, true);
});
t("editable/visibility helpers", () => {
  assert.equal(bidIsContractorEditable("draft"), true);
  assert.equal(bidIsContractorEditable("awarded"), false);
  assert.equal(bidVisibleToAdmin({ revision_number: 0 }), false);
  assert.equal(bidVisibleToAdmin({ revision_number: 1 }), true);
});
t("award amount: fixed, else rate × hours, else null", () => {
  assert.equal(awardProposalAmount({ proposed_amount: "100" }), "100.00");
  assert.equal(awardProposalAmount({ hourly_rate: "50", estimated_hours: "3" }), "150.00");
  assert.equal(awardProposalAmount({ hourly_rate: "50" }), null);
});
t("contractor projection omits reviewer + idempotency internals", () => {
  const p = projectBidForContractor({ id: "b", award_idempotency_key: "k", reviewed_by_user_id: "u" }) as any;
  assert.equal(p.awardIdempotencyKey, undefined);
  assert.equal(p.reviewedByUserId, undefined);
});

console.log("employee applications");
t("application state machine: submit → review → interview → offer → hire", () => {
  assert.equal((decideApplicationTransition("draft", "submit") as any).to, "submitted");
  assert.equal((decideApplicationTransition("submitted", "review") as any).to, "under_review");
  assert.equal((decideApplicationTransition("under_review", "interview") as any).to, "interviewing");
  assert.equal((decideApplicationTransition("interviewing", "offer") as any).to, "offer_extended");
  assert.equal((decideApplicationTransition("offer_extended", "hire") as any).to, "hired");
});
t("hire only from offer_extended; nothing leaves hired/rejected/withdrawn", () => {
  for (const s of ["draft", "submitted", "under_review", "interviewing"]) assert.equal(decideApplicationTransition(s, "hire").ok, false, s);
  for (const s of ["hired", "rejected", "withdrawn"]) {
    for (const a of ["submit", "withdraw", "review", "interview", "offer", "hire", "reject"] as const) assert.equal(decideApplicationTransition(s, a).ok, false, `${s}/${a}`);
  }
});
t("application statuses have no proposal/contract/award vocabulary", () => {
  for (const a of ["award", "convert", "request_revision", "shortlist"]) assert.equal(decideApplicationTransition("submitted", a as any).ok, false, a);
});
t("unsent application drafts stay private", () => {
  assert.equal(applicationVisibleToAdmin({ submitted_at: null }), false);
  assert.equal(applicationVisibleToAdmin({ submitted_at: new Date() }), true);
});
t("application input: cover message, availability, desired compensation, qualifications", () => {
  const n = normalizeApplicationInput({ coverMessage: "Hi", availability: "Now", desiredCompensation: "$60k", qualifications: "CPA", status: "hired" }) as any;
  assert.deepEqual(Object.keys(n.values).sort(), ["availability", "cover_message", "desired_compensation", "qualifications"]);
});
t("consent: every acknowledgement required", () => {
  assert.equal(validateApplicationConsent({}).ok, false);
  assert.equal(validateApplicationConsent({ information_accurate: true, privacy_notice: true }).ok, false);
  assert.equal(validateApplicationConsent({ information_accurate: true, privacy_notice: true, no_offer_until_hired: true }).ok, true);
});
t("screening questions + answers validated by type", () => {
  assert.equal(normalizeScreeningQuestion({ prompt: "Pick", answerType: "choice", options: ["a"] }).ok, false);
  assert.equal(normalizeScreeningQuestion({ prompt: "Pick", answerType: "choice", options: ["a", "b"] }).ok, true);
  assert.equal(normalizeScreeningAnswer({ answer_type: "yes_no", options: [], required: true }, "maybe").ok, false);
  assert.equal(normalizeScreeningAnswer({ answer_type: "number", options: [], required: false }, "12").ok, true);
  assert.equal(normalizeScreeningAnswer({ answer_type: "text", options: [], required: true }, "").ok, false);
  assert.equal(normalizeScreeningAnswer({ answer_type: "choice", options: ["a", "b"], required: true }, "c").ok, false);
});
t("applicant projection omits reviewer, rejection reason and conversion internals", () => {
  const p = projectApplicationForApplicant({ id: "a", reviewed_by_user_id: "u", rejection_reason: "r", converted_worker_id: "w" }) as any;
  assert.equal(p.reviewedByUserId, undefined);
  assert.equal(p.rejectionReason, undefined);
  assert.equal(p.convertedWorkerId, undefined);
});

console.log("dates + deadlines");
t("deadline in the past closes submissions", () => {
  assert.equal(submissionsOpen({ status: "published", application_deadline: "2000-01-01T00:00:00Z" }).ok, false);
  assert.equal(submissionsOpen({ status: "paused" }).ok, false);
  assert.equal(submissionsOpen({ status: "published" }).ok, true);
});
t("DATE values read back as local calendar dates", () => {
  assert.equal(dateOnlyString(new Date(2027, 0, 5)), "2027-01-05");
  assert.equal(dateOnlyString("2027-01-05"), "2027-01-05");
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
