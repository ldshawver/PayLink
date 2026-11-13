/**
 * Job board UI — pure logic + drift checks against the server rules for BOTH
 * paths (contractor proposals, employee applications). No DOM, no database,
 * no network. Run: npx tsx tests/contractor-job-board-ui.test.ts
 */
import {
  APPLICANT_EDITABLE, APPLICANT_WITHDRAWABLE, APPLICATION_ACKNOWLEDGEMENTS, APPLICATION_ACTIONS_FROM, BID_REVIEW_FROM,
  CLASSIFICATION_NOTICE as CLIENT_NOTICE, CONTRACTOR_EDITABLE, CONTRACTOR_WITHDRAWABLE, EMPLOYMENT_INDICATOR_LABELS as CLIENT_LABELS,
  EMPTY_FILTERS, POST_ACTIONS, applicationFormFrom, applicationPayload, applicationSubmitProblem, applyJobFilters, bidFormFrom,
  bidPayload, bidSubmitProblem, classificationBadge, clientEmploymentIndicators, compensationLabel, compensationTypesFor,
  defaultOpportunity, formFromPost, jobBoardViewsFor, opportunityChoicesFor, postBadges, postPayload, schedulesFor,
  type ApplicationStatus, type BidStatus, type JobPost,
} from "../client/src/lib/job-board";
import {
  APPLICATION_FIELD_COLUMNS, APPLICATION_STATUSES, BID_FIELD_COLUMNS, BID_STATUSES, CLASSIFICATION_NOTICE, EMPLOYMENT_INDICATOR_LABELS,
  POST_FIELD_COLUMNS, POST_STATUSES, REQUIRED_APPLICATION_ACKNOWLEDGEMENTS, applicationIsApplicantEditable, bidIsContractorEditable,
  decideApplicationTransition, decideBidTransition, decidePostTransition, derivePostDefaults, employmentIndicators,
  normalizeApplicationInput, normalizeBidInput, normalizePostInput, submissionCta, validateBidForSubmit, validatePostShape,
  type ApplicationAction, type BidAction, type PostAction,
} from "../server/job-board/rules";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (!cond) { console.error(`FAIL: ${name}`, detail ?? ""); process.exit(1); }
  passed++;
  console.log(`PASS: ${name}`);
}

// ── State-machine mirrors ───────────────────────────────────────────────────
for (const a of ["publish", "pause", "reopen", "close", "archive"] as PostAction[]) {
  const mirror = POST_ACTIONS.find((x) => x.action === a);
  ok(`POST_ACTIONS has ${a}`, !!mirror);
  for (const s of POST_STATUSES) {
    ok(`posting ${a} from ${s} mirrors server`, decidePostTransition(s, a).ok === mirror!.from.includes(s));
  }
}
for (const a of Object.keys(BID_REVIEW_FROM) as (keyof typeof BID_REVIEW_FROM)[]) {
  for (const s of BID_STATUSES) {
    ok(`proposal ${a} from ${s} mirrors server`, decideBidTransition(s, a as BidAction).ok === (BID_REVIEW_FROM[a] as readonly string[]).includes(s));
  }
}
for (const s of BID_STATUSES) {
  ok(`contractor edit ${s} mirrors server`, CONTRACTOR_EDITABLE.includes(s as BidStatus) === bidIsContractorEditable(s));
  ok(`contractor withdraw ${s} mirrors server`, CONTRACTOR_WITHDRAWABLE.includes(s as BidStatus) === decideBidTransition(s, "withdraw").ok);
}
for (const a of Object.keys(APPLICATION_ACTIONS_FROM) as (keyof typeof APPLICATION_ACTIONS_FROM)[]) {
  for (const s of APPLICATION_STATUSES) {
    ok(`application ${a} from ${s} mirrors server`, decideApplicationTransition(s, a as ApplicationAction).ok === (APPLICATION_ACTIONS_FROM[a] as readonly string[]).includes(s));
  }
}
for (const s of APPLICATION_STATUSES) {
  ok(`applicant edit ${s} mirrors server`, APPLICANT_EDITABLE.includes(s as ApplicationStatus) === applicationIsApplicantEditable(s));
  ok(`applicant withdraw ${s} mirrors server`, APPLICANT_WITHDRAWABLE.includes(s as ApplicationStatus) === decideApplicationTransition(s, "withdraw").ok);
}
ok("acknowledgement keys mirror the server", JSON.stringify(APPLICATION_ACKNOWLEDGEMENTS.map((a) => a.key)) === JSON.stringify([...REQUIRED_APPLICATION_ACKNOWLEDGEMENTS]));
ok("classification notice mirrors the server", CLIENT_NOTICE === CLASSIFICATION_NOTICE);
ok("indicator labels mirror the server", JSON.stringify(CLIENT_LABELS) === JSON.stringify(EMPLOYMENT_INDICATOR_LABELS));

// Client indicator mirror == server for every combination.
for (const cls of ["contractor", "employee"]) for (const sched of ["one_time", "recurring", "part_time", "full_time"])
  for (const dur of ["fixed_term", "ongoing"]) for (const hrs of ["", "20", "35"]) for (const comp of ["hourly", "salary", "fixed_bid"]) {
    const server = employmentIndicators({ worker_classification: cls, schedule_type: sched, duration_type: dur, hours_per_week_max: hrs || null, compensation_type: comp });
    const client = clientEmploymentIndicators({ workerClassification: cls, scheduleType: sched, durationType: dur, hoursPerWeekMax: hrs || null, compensationType: comp });
    if (JSON.stringify(server) !== JSON.stringify(client)) ok(`indicator mirror ${cls}/${sched}/${dur}/${hrs}/${comp}`, false, { server, client });
  }
ok("indicator mirror matches the server for all 144 combinations", true);

// ── Role → view ─────────────────────────────────────────────────────────────
const manage = (role: string) => jobBoardViewsFor({ role }).canManage;
for (const r of ["admin", "manager", "owner", "system_admin", "platform_super_admin", "platform_admin", "platform_owner",
  "tenant_owner", "tenant_admin", "tenant_hr_admin", "tenant_payroll_admin", "tenant_finance_admin", "tenant_manager", "tenant_supervisor"]) {
  ok(`role ${r} gets the administrator view`, manage(r));
}
for (const r of ["supervisor", "employee", "contractor", "platform_support", "platform_implementation", "vendor", ""]) {
  ok(`role ${r || "(none)"} does not get the administrator view`, !manage(r));
}
const cv = jobBoardViewsFor({ role: "employee", workerId: "w1", workerType: "contractor" });
ok("contractor worker can propose AND apply", cv.canPropose && cv.canApply && cv.canBrowse);
const ev = jobBoardViewsFor({ role: "employee", workerId: "w1", workerType: "employee" });
ok("employee worker can apply but never propose", ev.canApply && !ev.canPropose && ev.canBrowse);
ok("no user → no views", !jobBoardViewsFor(null).canBrowse && !jobBoardViewsFor(undefined).canManage);

// ── Classification-first wizard ─────────────────────────────────────────────
ok("employee schedules are part-time / full-time only", JSON.stringify(schedulesFor("employee")) === '["part_time","full_time"]');
ok("contractor schedules are all four", schedulesFor("contractor").length === 4);
ok("employee positions are never fixed-bid", !compensationTypesFor("employee").includes("fixed_bid"));
ok("contractor PT/FT may be posted as project or recurring work", JSON.stringify(opportunityChoicesFor("contractor", "full_time")) === '["project","recurring_work"]');
for (const [cls, sched] of [["contractor", "one_time"], ["contractor", "recurring"], ["contractor", "part_time"], ["employee", "part_time"], ["employee", "full_time"]] as const) {
  const srv = derivePostDefaults({ worker_classification: cls, schedule_type: sched }) as any;
  ok(`default opportunity ${cls}/${sched} mirrors server (${srv.opportunity_type})`, defaultOpportunity(cls, sched) === srv.opportunity_type);
}

const blank = formFromPost(null);
ok("a new posting starts with no classification chosen", blank.workerClassification === "" && blank.scheduleType === "");
const contractorForm = { ...blank, workerClassification: "contractor" as const, scheduleType: "recurring" as const, opportunityType: "recurring_work" as const,
  title: "Weekly cleaning", summary: "Office", recurrenceFrequency: "weekly", compensationType: "range", compensationMin: "100", compensationMax: "250",
  numberOfOpenings: "", applicationDeadline: "2099-01-01T09:00", requiredSkills: "Floor care, Windows" };
const full = postPayload(contractorForm, null);
ok("payload keys are all server-settable posting fields", Object.keys(full).every((k) => k in POST_FIELD_COLUMNS), Object.keys(full));
ok("create payload carries classification + schedule", full.workerClassification === "contractor" && full.scheduleType === "recurring");
const norm = normalizePostInput(full, { partial: false });
ok("server accepts the contractor create payload", norm.ok, norm);
const merged = { visibility: "all_eligible", eligible_groups: [], filled_count: 0, work_location_type: "onsite", ...derivePostDefaults((norm as any).values) };
ok("…and it passes publish validation", validatePostShape(merged, { forPublish: true }).ok, validatePostShape(merged, { forPublish: true }));
ok("skills sent as a list", JSON.stringify(full.requiredSkills) === '["Floor care","Windows"]');
ok("blank openings on recurring work = unlimited (null)", full.numberOfOpenings === null);
ok("deadline sent as ISO", typeof full.applicationDeadline === "string" && /Z$/.test(full.applicationDeadline as string));

const employeeForm = { ...blank, workerClassification: "employee" as const, scheduleType: "full_time" as const, opportunityType: "position" as const,
  title: "Bookkeeper", summary: "Books", compensationType: "salary", compensationMin: "52000", compensationMax: "60000", numberOfOpenings: "2" };
const ep = postPayload(employeeForm, null);
ok("employee payload never sends opportunityType (server derives 'position')", !("opportunityType" in ep));
const en = normalizePostInput(ep, { partial: false });
ok("server accepts the employee create payload", en.ok, en);
const em = { visibility: "all_eligible", eligible_groups: [], filled_count: 0, work_location_type: "onsite", ...derivePostDefaults((en as any).values) };
ok("…and it passes publish validation as a position", em.opportunity_type === "position" && em.employment_type === "full_time" && validatePostShape(em, { forPublish: true }).ok);
ok("undisclosed pay clears the amounts", postPayload({ ...employeeForm, compensationType: "undisclosed" }, null).compensationMin === null);
ok("eligible groups only for selected_groups", (postPayload({ ...employeeForm, eligibleGroups: "a, b" }, null).eligibleGroups as string[]).length === 0);

const stored: JobPost = {
  id: "p1", companyId: "c1", workerClassification: "contractor", submissionKind: "proposal", cta: "Submit Proposal",
  opportunityType: "recurring_work", scheduleType: "recurring", durationType: "ongoing", title: "Weekly cleaning", summary: "Office",
  workLocationType: "onsite", recurrenceFrequency: "weekly", compensationType: "range", compensationMin: "100.00", compensationMax: "250.00",
  currency: "USD", status: "published", numberOfOpenings: null, numberOfOpeningsSetting: null, filledCount: 0, visibility: "all_eligible",
  eligibleGroups: [], applicationDeadline: "2099-01-01T15:00:00.000Z", requiredSkills: [],
};
const initial = formFromPost(stored);
ok("unchanged edit form sends nothing", Object.keys(postPayload(initial, initial, { status: "published" })).length === 0);
const edit = postPayload({ ...initial, compensationMax: "300" }, initial, { status: "published" });
ok("edit sends only changed keys", JSON.stringify(Object.keys(edit)) === '["compensationMax"]', edit);
ok("partial edit payload accepted by server", normalizePostInput(edit, { partial: true }).ok);
ok("a published posting's classification is never sent on edit",
  !("workerClassification" in postPayload({ ...initial, workerClassification: "employee" }, initial, { status: "published" })));
ok("a draft's classification change is sent", "workerClassification" in postPayload({ ...initial, workerClassification: "employee" }, initial, { status: "draft" }));

// ── CTA + classification badge ──────────────────────────────────────────────
ok("contractor posting CTA is 'Submit Proposal' (server)", submissionCta({ worker_classification: "contractor" }) === "Submit Proposal");
ok("employee posting CTA is 'Apply' (server)", submissionCta({ worker_classification: "employee" }) === "Apply");
ok("contractor badge reads CONTRACTOR WORK", classificationBadge({ workerClassification: "contractor" }).label === "CONTRACTOR WORK");
ok("employee badge reads EMPLOYEE POSITION", classificationBadge({ workerClassification: "employee" }).label === "EMPLOYEE POSITION");

// ── Proposal payload ────────────────────────────────────────────────────────
const bf = { ...bidFormFrom(null, stored), proposedAmount: "200", hourlyRate: "50", estimatedHours: "4", scopeAndDeliverables: "Floors", proposedSchedule: "Mon AM", availability: "Now" };
ok("recurring work defaults proposal rate type to recurring", bidFormFrom(null, stored).rateType === "recurring");
const bp = bidPayload(bf);
ok("proposal payload keys are all server-settable bid fields", Object.keys(bp).every((k) => k in BID_FIELD_COLUMNS), Object.keys(bp));
ok("proposal payload carries schedule + availability + scope", bp.proposedSchedule === "Mon AM" && bp.availability === "Now" && bp.scopeAndDeliverables === "Floors");
const hp = bidPayload({ ...bf, rateType: "hourly" });
ok("hourly proposal drops the fixed amount", hp.proposedAmount === null && hp.hourlyRate === "50");
const nb = normalizeBidInput(hp);
ok("server accepts the proposal payload", nb.ok, nb);
ok("…and it passes server submit validation", validateBidForSubmit((nb as any).values).ok);
ok("client submit check mirrors server: missing scope", !!bidSubmitProblem({ ...bf, scopeAndDeliverables: "" }) && !validateBidForSubmit({ proposed_amount: "1", estimated_hours: "1" }).ok);
ok("client submit check mirrors server: missing hours and completion", !!bidSubmitProblem({ ...bf, estimatedHours: "", estimatedCompletionDate: "" }));
ok("client submit check passes a complete proposal", bidSubmitProblem(bf) === null);

// ── Application payload ─────────────────────────────────────────────────────
const af = { ...applicationFormFrom(null), coverMessage: "Hi", availability: "Now", desiredCompensation: "$58k", qualifications: "CPA", answers: { q1: "yes" } };
const ap = applicationPayload(af);
ok("application payload fields are all server-settable (plus answers)", Object.keys(ap).filter((k) => k !== "answers").every((k) => k in APPLICATION_FIELD_COLUMNS), Object.keys(ap));
ok("server accepts the application payload", normalizeApplicationInput(ap).ok);
const qs = [{ id: "q1", prompt: "Authorized?", answerType: "yes_no" as const, options: [], required: true }, { id: "q2", prompt: "Shift", answerType: "text" as const, options: [], required: true }];
const allAcks = Object.fromEntries(APPLICATION_ACKNOWLEDGEMENTS.map((a) => [a.key, true]));
ok("required screening answers block submit", !!applicationSubmitProblem(af, qs, allAcks));
ok("missing acknowledgements block submit", !!applicationSubmitProblem({ ...af, answers: { q1: "yes", q2: "Day" } }, qs, {}));
ok("complete application passes the client check", applicationSubmitProblem({ ...af, answers: { q1: "yes", q2: "Day" } }, qs, allAcks) === null);

// ── Badges / filters / labels ───────────────────────────────────────────────
const now = Date.parse("2026-11-13T12:00:00Z");
const labels = (p: JobPost) => postBadges(p, now).map((b) => b.label);
ok("recurring badge names the frequency", labels(stored).includes("Recurring · Weekly"));
ok("awarded recurring published posting shows still-open badge", labels({ ...stored, filledCount: 1 }).includes("Awarded · still open"));
ok("worker projection (hasFills) shows still-open badge", labels({ ...stored, hasFills: true }).includes("Awarded · still open"));
ok("employee posting with a hire shows hiring still-open", labels({ ...stored, workerClassification: "employee", hasFills: true }).includes("Hiring · still open"));
ok("closed posting does not show still-open", !labels({ ...stored, filledCount: 1, status: "closed" }).includes("Awarded · still open"));
ok("closing soon within 3 days", labels({ ...stored, applicationDeadline: "2026-11-15T12:00:00Z" }).includes("Closing soon"));
ok("part-time badge", labels({ ...stored, scheduleType: "part_time" }).includes("Part-time"));

const posts: JobPost[] = [
  stored,
  { ...stored, id: "p2", title: "Roof repair", opportunityType: "project", scheduleType: "one_time", workLocationType: "remote", compensationType: "fixed_bid", applicationDeadline: null },
  { ...stored, id: "p3", title: "Bookkeeper", workerClassification: "employee", submissionKind: "application", cta: "Apply", opportunityType: "position", scheduleType: "full_time", compensationType: "salary", requiredSkills: ["QuickBooks"] },
];
const ids = (f: Partial<typeof EMPTY_FILTERS>) => applyJobFilters(posts, { ...EMPTY_FILTERS, ...f }, now).map((p) => p.id).join();
ok("filter: project", ids({ opportunity: "project" }) === "p2");
ok("filter: recurring", ids({ schedule: "recurring" }) === "p1");
ok("filter: full-time", ids({ schedule: "full_time" }) === "p3");
ok("filter: contractor", ids({ classification: "contractor" }) === "p1,p2");
ok("filter: employee", ids({ classification: "employee" }) === "p3");
ok("filter: location", ids({ location: "remote" }) === "p2");
ok("filter: compensation type", ids({ compensation: "salary" }) === "p3");
ok("filter: no deadline", ids({ deadline: "none" }) === "p2");
ok("search matches skills", ids({ search: "quickbooks" }) === "p3");
ok("range label", compensationLabel(stored) === "$100 – $250");
ok("salary label", compensationLabel({ ...stored, compensationType: "salary", compensationMin: "52000", compensationMax: "60000" }) === "$52,000–$60,000/yr");
ok("undisclosed label never shows amounts", compensationLabel({ ...stored, compensationType: "undisclosed" }) === "Undisclosed");

console.log(`\nJob board UI: ${passed} checks passed.`);
