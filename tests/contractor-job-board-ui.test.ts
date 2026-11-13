/**
 * Contractor Hub job board UI — pure logic + drift checks against the server
 * state machines. No DOM, no database, no network.
 * Run: npx tsx tests/contractor-job-board-ui.test.ts
 */
import {
  POST_ACTIONS, BID_REVIEW_FROM, CONTRACTOR_EDITABLE, CONTRACTOR_WITHDRAWABLE,
  jobBoardViewsFor, postPayload, bidPayload, formFromPost, bidFormFrom, postBadges,
  applyJobFilters, budgetLabel, EMPTY_FILTERS, type JobPost, type BidStatus,
} from "../client/src/lib/job-board";
import {
  POST_STATUSES, BID_STATUSES, POST_FIELD_COLUMNS, BID_FIELD_COLUMNS,
  decidePostTransition, decideBidTransition, bidIsContractorEditable,
  normalizePostInput, validatePostShape, normalizeBidInput, validateBidForSubmit,
  type PostAction, type BidAction,
} from "../server/contractor-jobs/rules";

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
    const server = decidePostTransition(s, a).ok;
    const client = mirror!.from.includes(s);
    ok(`posting ${a} from ${s}: client ${client} = server ${server}`, server === client);
  }
}

for (const a of Object.keys(BID_REVIEW_FROM) as (keyof typeof BID_REVIEW_FROM)[]) {
  for (const s of BID_STATUSES) {
    const server = decideBidTransition(s, a as BidAction).ok;
    const client = (BID_REVIEW_FROM[a] as readonly string[]).includes(s);
    ok(`bid ${a} from ${s}: client ${client} = server ${server}`, server === client);
  }
}

for (const s of BID_STATUSES) {
  ok(`contractor edit ${s} mirrors bidIsContractorEditable`, CONTRACTOR_EDITABLE.includes(s as BidStatus) === bidIsContractorEditable(s));
  ok(`contractor withdraw ${s} mirrors server`, CONTRACTOR_WITHDRAWABLE.includes(s as BidStatus) === decideBidTransition(s, "withdraw").ok);
}

// ── Role → view (server: expandRoleForGuard → admin|manager; fail closed for platform support roles) ──
const manage = (role: string) => jobBoardViewsFor({ role }).canManage;
for (const r of ["admin", "manager", "owner", "system_admin", "platform_super_admin", "platform_admin", "platform_owner",
  "tenant_owner", "tenant_admin", "tenant_hr_admin", "tenant_payroll_admin", "tenant_finance_admin", "tenant_manager", "tenant_supervisor"]) {
  ok(`role ${r} gets the administrator view`, manage(r));
}
for (const r of ["supervisor", "employee", "contractor", "platform_support", "platform_implementation", "vendor", ""]) {
  ok(`role ${r || "(none)"} does not get the administrator view`, !manage(r));
}
ok("contractor worker gets the bid view", jobBoardViewsFor({ role: "employee", workerId: "w1", workerType: "contractor" }).canBid);
ok("employee worker does not get the bid view", !jobBoardViewsFor({ role: "employee", workerId: "w1", workerType: "employee" }).canBid);
ok("no user → no views", !jobBoardViewsFor(null).canBid && !jobBoardViewsFor(undefined).canManage);

// ── Posting payload ─────────────────────────────────────────────────────────
const blank = formFromPost(null);
const recurring = { ...blank, title: "Weekly cleaning", summary: "Office", workType: "recurring", recurrenceFrequency: "weekly",
  budgetType: "range", budgetMin: "100", budgetMax: "250", maximumAwards: "3", submissionDeadline: "2099-01-01T09:00" };
const full = postPayload(recurring, null);
ok("payload keys are all server-settable posting fields", Object.keys(full).every((k) => k in POST_FIELD_COLUMNS), Object.keys(full));
const norm = normalizePostInput(full, { partial: false });
ok("server accepts the full create payload", norm.ok, norm);
const merged = { work_type: "one_time", budget_type: "contractor_quote", visibility: "all_eligible", eligible_groups: [], awards_made: 0, ...(norm as any).values };
ok("merged recurring posting passes publish validation", validatePostShape(merged, { forPublish: true }).ok, validatePostShape(merged, { forPublish: true }));
ok("maximumAwards sent as a number", full.maximumAwards === 3);
ok("deadline sent as ISO", typeof full.submissionDeadline === "string" && /Z$/.test(full.submissionDeadline as string));

const oneTime = postPayload({ ...recurring, workType: "one_time" }, null);
ok("one-time payload clears recurrence frequency", oneTime.recurrenceFrequency === null);
ok("one-time payload passes server shape check", validatePostShape({ ...merged, ...(normalizePostInput(oneTime, { partial: false }) as any).values }, { forPublish: true }).ok);
const quote = postPayload({ ...recurring, budgetType: "contractor_quote" }, null);
ok("quote payload clears budget amounts", quote.budgetMin === null && quote.budgetMax === null);
const fixed = postPayload({ ...recurring, budgetType: "fixed", budgetMin: "5", budgetMax: "500" }, null);
ok("fixed payload keeps only the amount", fixed.budgetMin === null && fixed.budgetMax === "500");
ok("eligible groups only sent for selected_groups", (postPayload({ ...recurring, eligibleGroups: "a, b" }, null).eligibleGroups as string[]).length === 0);
ok("eligible groups parsed for selected_groups", JSON.stringify(postPayload({ ...recurring, visibility: "selected_groups", eligibleGroups: "a, b ,," }, null).eligibleGroups) === '["a","b"]');

const stored: JobPost = {
  id: "p1", companyId: "c1", title: "Weekly cleaning", summary: "Office", locationType: "onsite", workType: "recurring",
  recurrenceFrequency: "weekly", budgetType: "range", budgetMin: "100.00", budgetMax: "250.00", currency: "USD", status: "published",
  maximumAwards: 3, visibility: "all_eligible", eligibleGroups: [], submissionDeadline: "2099-01-01T15:00:00.000Z",
};
const initial = formFromPost(stored);
ok("unchanged edit form sends nothing", Object.keys(postPayload(initial, initial)).length === 0);
const edit = postPayload({ ...initial, budgetMax: "300" }, initial);
ok("edit sends only changed keys", JSON.stringify(Object.keys(edit)) === '["budgetMax"]', edit);
ok("partial edit payload accepted by server", normalizePostInput(edit, { partial: true }).ok);

// ── Bid payload ─────────────────────────────────────────────────────────────
const bf = { ...bidFormFrom(null, stored), proposedAmount: "200", hourlyRate: "50", estimatedHours: "4" };
ok("recurring posting defaults bid rate type to recurring", bidFormFrom(null, stored).rateType === "recurring");
const bp = bidPayload(bf);
ok("bid payload keys are all server-settable bid fields", Object.keys(bp).every((k) => k in BID_FIELD_COLUMNS), Object.keys(bp));
ok("non-hourly bid drops the hourly rate", bp.hourlyRate === null && bp.proposedAmount === "200");
const hp = bidPayload({ ...bf, rateType: "hourly" });
ok("hourly bid drops the fixed amount", hp.proposedAmount === null && hp.hourlyRate === "50");
const nb = normalizeBidInput(hp);
ok("server accepts the bid payload", nb.ok, nb);
ok("hourly bid passes server submit validation", validateBidForSubmit((nb as any).values).ok);

// ── Badges / filters / labels ───────────────────────────────────────────────
const now = Date.parse("2026-11-13T12:00:00Z");
const labels = (p: JobPost) => postBadges(p, now).map((b) => b.label);
ok("recurring badge names the frequency", labels(stored).includes("Recurring · Weekly"));
ok("awarded recurring published posting shows still-open badge", labels({ ...stored, awardsMade: 1 }).includes("Awarded · still open"));
ok("contractor projection (hasAwards) shows still-open badge", labels({ ...stored, hasAwards: true }).includes("Awarded · still open"));
ok("closed posting does not show still-open", !labels({ ...stored, awardsMade: 1, status: "closed" }).includes("Awarded · still open") && labels({ ...stored, status: "closed" }).includes("Closed"));
ok("closing soon within 3 days", labels({ ...stored, submissionDeadline: "2026-11-15T12:00:00Z" }).includes("Closing soon"));
ok("not closing soon after 3 days", !labels({ ...stored, submissionDeadline: "2026-11-20T12:00:00Z" }).includes("Closing soon"));
ok("paused badge", labels({ ...stored, status: "paused" }).includes("Paused"));
ok("one-time badge", labels({ ...stored, workType: "one_time" }).includes("One-time"));

const posts: JobPost[] = [stored, { ...stored, id: "p2", title: "Roof repair", workType: "one_time", locationType: "remote", budgetType: "contractor_quote", submissionDeadline: null }];
ok("filter by work type", applyJobFilters(posts, { ...EMPTY_FILTERS, workType: "one_time" }, now).map((p) => p.id).join() === "p2");
ok("filter by location", applyJobFilters(posts, { ...EMPTY_FILTERS, location: "onsite" }, now).map((p) => p.id).join() === "p1");
ok("filter by budget stated", applyJobFilters(posts, { ...EMPTY_FILTERS, budget: "stated" }, now).map((p) => p.id).join() === "p1");
ok("filter by no deadline", applyJobFilters(posts, { ...EMPTY_FILTERS, deadline: "none" }, now).map((p) => p.id).join() === "p2");
ok("search matches title", applyJobFilters(posts, { ...EMPTY_FILTERS, search: "roof" }, now).map((p) => p.id).join() === "p2");
ok("range budget label", budgetLabel(stored) === "$100.00 – $250.00");
ok("undisclosed budget label never shows amounts", budgetLabel({ ...stored, budgetType: "undisclosed" }) === "Undisclosed");

console.log(`\nContractor job board UI: ${passed} checks passed.`);
