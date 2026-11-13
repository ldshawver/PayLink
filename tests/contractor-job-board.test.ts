/**
 * Contractor Hub job board — pure rules (server/contractor-jobs/rules.ts).
 * No DB, no network. Run: npx tsx tests/contractor-job-board.test.ts
 */
import assert from "node:assert/strict";
import {
  awardProposalAmount, bidIsContractorEditable, bidVisibleToAdmin, contractorEligibleForPost,
  dateOnlyString, decideAward, decideBidTransition, decidePostEdit, decidePostTransition,
  effectiveMaxAwards, normalizeBidInput, normalizePostInput, postingExpired,
  projectBidForContractor, projectPostForContractor, submissionsOpen, validateBidForSubmit, validatePostShape,
} from "../server/contractor-jobs/rules";

let pass = 0, fail = 0;
function t(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); } catch (e) { fail++; console.error(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

console.log("posting state machine");
t("draft → published via publish", () => assert.deepEqual(decidePostTransition("draft", "publish"), { ok: true, to: "published" }));
t("published ⇄ paused", () => {
  assert.equal((decidePostTransition("published", "pause") as any).to, "paused");
  assert.equal((decidePostTransition("paused", "reopen") as any).to, "published");
});
t("closed may be reopened and archived; archived is terminal", () => {
  assert.equal((decidePostTransition("closed", "reopen") as any).to, "published");
  assert.equal((decidePostTransition("closed", "archive") as any).to, "archived");
  for (const a of ["publish", "pause", "reopen", "close", "archive"] as const) assert.equal(decidePostTransition("archived", a).ok, false);
});
t("cannot publish twice / archive a live posting", () => {
  assert.equal(decidePostTransition("published", "publish").ok, false);
  assert.equal(decidePostTransition("published", "archive").ok, false);
  assert.equal((decidePostTransition("published", "archive") as any).status, 409);
});
t("edits: draft/paused free, published audited, closed/archived locked", () => {
  assert.deepEqual(decidePostEdit("draft"), { ok: true, audited: false });
  assert.deepEqual(decidePostEdit("paused"), { ok: true, audited: false });
  assert.deepEqual(decidePostEdit("published"), { ok: true, audited: true });
  assert.equal(decidePostEdit("closed").ok, false);
  assert.equal(decidePostEdit("archived").ok, false);
});

console.log("bid state machine");
t("draft → submitted; revision_requested → submitted", () => {
  assert.equal((decideBidTransition("draft", "submit") as any).to, "submitted");
  assert.equal((decideBidTransition("revision_requested", "submit") as any).to, "submitted");
});
t("submitted → under_review → shortlisted → awarded", () => {
  assert.equal((decideBidTransition("submitted", "review") as any).to, "under_review");
  assert.equal((decideBidTransition("under_review", "shortlist") as any).to, "shortlisted");
  assert.equal((decideBidTransition("shortlisted", "award") as any).to, "awarded");
});
t("cannot award a draft, withdrawn, rejected or already-awarded bid", () => {
  for (const s of ["draft", "withdrawn", "rejected", "awarded", "converted_to_proposal", "converted_to_contract", "revision_requested"]) {
    assert.equal(decideBidTransition(s, "award").ok, false, s);
  }
});
t("withdraw only before award", () => {
  for (const s of ["draft", "submitted", "under_review", "shortlisted", "revision_requested"]) assert.equal(decideBidTransition(s, "withdraw").ok, true, s);
  for (const s of ["awarded", "converted_to_proposal", "rejected", "withdrawn"]) assert.equal(decideBidTransition(s, "withdraw").ok, false, s);
});
t("reject from review states, not from draft", () => {
  assert.equal(decideBidTransition("draft", "reject").ok, false);
  assert.equal(decideBidTransition("revision_requested", "reject").ok, true);
});
t("contractor-editable statuses", () => {
  assert.ok(bidIsContractorEditable("draft") && bidIsContractorEditable("submitted") && bidIsContractorEditable("revision_requested"));
  assert.ok(!bidIsContractorEditable("shortlisted") && !bidIsContractorEditable("converted_to_proposal") && !bidIsContractorEditable("withdrawn"));
});
t("admins never see a never-submitted bid (incl. withdrawn draft)", () => {
  assert.equal(bidVisibleToAdmin({ revision_number: 0 }), false);
  assert.equal(bidVisibleToAdmin({ revision_number: "1" }), true);
});

console.log("submissions + capacity");
t("only published postings before the deadline accept bids", () => {
  const now = new Date("2026-11-13T12:00:00Z");
  assert.equal(submissionsOpen({ status: "published", submission_deadline: "2026-11-14T00:00:00Z" }, now).ok, true);
  assert.equal(submissionsOpen({ status: "published", submission_deadline: "2026-11-13T11:59:59Z" }, now).ok, false);
  assert.equal(submissionsOpen({ status: "paused" }, now).ok, false);
  assert.equal(submissionsOpen({ status: "closed" }, now).ok, false);
});
t("one-time defaults to capacity 1 and closes after its award", () => {
  assert.equal(effectiveMaxAwards({ work_type: "one_time", maximum_awards: null }), 1);
  assert.deepEqual(decideAward({ status: "published", work_type: "one_time", maximum_awards: null, awards_made: 0 }), { ok: true, closeAfter: true });
  assert.equal(decideAward({ status: "published", work_type: "one_time", maximum_awards: null, awards_made: 1 }).ok, false);
});
t("recurring unlimited never closes on award", () => {
  assert.equal(effectiveMaxAwards({ work_type: "recurring", maximum_awards: null }), null);
  assert.deepEqual(decideAward({ status: "published", work_type: "recurring", maximum_awards: null, awards_made: 40 }), { ok: true, closeAfter: false });
});
t("recurring with a limit closes on the last award", () => {
  assert.deepEqual(decideAward({ status: "published", work_type: "recurring", maximum_awards: 3, awards_made: 1 }), { ok: true, closeAfter: false });
  assert.deepEqual(decideAward({ status: "published", work_type: "recurring", maximum_awards: 3, awards_made: 2 }), { ok: true, closeAfter: true });
});
t("awards only on published or paused postings", () => {
  assert.equal(decideAward({ status: "paused", work_type: "recurring", maximum_awards: null, awards_made: 0 }).ok, true);
  assert.equal(decideAward({ status: "closed", work_type: "recurring", maximum_awards: null, awards_made: 0 }).ok, false);
  assert.equal(decideAward({ status: "draft", work_type: "one_time", maximum_awards: null, awards_made: 0 }).ok, false);
});
t("expiry applies to fixed-term recurring only", () => {
  assert.equal(postingExpired({ status: "published", work_type: "recurring", estimated_end_date: "2026-11-12" }, "2026-11-13"), true);
  assert.equal(postingExpired({ status: "published", work_type: "recurring", estimated_end_date: "2026-11-13" }, "2026-11-13"), false);
  assert.equal(postingExpired({ status: "published", work_type: "recurring", estimated_end_date: null }, "2026-11-13"), false);
  assert.equal(postingExpired({ status: "published", work_type: "one_time", estimated_end_date: "2020-01-01" }, "2026-11-13"), false);
  assert.equal(postingExpired({ status: "closed", work_type: "recurring", estimated_end_date: "2020-01-01" }, "2026-11-13"), false);
});

console.log("eligibility (company-bound)");
const post = { company_id: "A", status: "published", visibility: "all_eligible", eligible_groups: [] as string[] };
const who = { workerId: "w1", companyId: "A", workerType: "contractor", workerGroup: "1099_contractor", status: "active" };
t("same-company active contractor sees all_eligible", () => assert.equal(contractorEligibleForPost(post, who, false), true));
t("other company never eligible, even when 'invited'", () => assert.equal(contractorEligibleForPost(post, { ...who, companyId: "B" }, true), false));
t("employees and inactive contractors are not eligible", () => {
  assert.equal(contractorEligibleForPost(post, { ...who, workerType: "employee" }, false), false);
  assert.equal(contractorEligibleForPost(post, { ...who, status: "terminated" }, false), false);
});
t("invited_only needs an invitation", () => {
  const p = { ...post, visibility: "invited_only" };
  assert.equal(contractorEligibleForPost(p, who, false), false);
  assert.equal(contractorEligibleForPost(p, who, true), true);
});
t("selected_groups matches worker_group", () => {
  const p = { ...post, visibility: "selected_groups", eligible_groups: ["1099_contractor"] };
  assert.equal(contractorEligibleForPost(p, who, false), true);
  assert.equal(contractorEligibleForPost(p, { ...who, workerGroup: "other" }, false), false);
});

console.log("input normalization");
t("create requires a title", () => assert.equal(normalizePostInput({}, { partial: false }).ok, false));
t("rejects unknown enum values and negative money", () => {
  assert.equal(normalizePostInput({ title: "x", workType: "forever" }, { partial: false }).ok, false);
  assert.equal(normalizePostInput({ title: "x", budgetMax: -5 }, { partial: false }).ok, false);
  assert.equal(normalizePostInput({ title: "x", maximumAwards: 0 }, { partial: false }).ok, false);
});
t("ignores keys that are not posting fields (no status/company/awards injection)", () => {
  const r = normalizePostInput({ title: "x", status: "published", companyId: "B", awardsMade: 9, tenantId: "t" } as any, { partial: false });
  assert.ok(r.ok);
  assert.deepEqual(Object.keys((r as any).values), ["title"]);
});
t("money normalizes to 2dp; dates validate", () => {
  const r = normalizePostInput({ title: "x", budgetMin: "$1,200.5", estimatedStartDate: "2026-12-01" }, { partial: false }) as any;
  assert.equal(r.values.budget_min, "1200.50");
  assert.equal(r.values.estimated_start_date, "2026-12-01");
  assert.equal(normalizePostInput({ estimatedStartDate: "12/01/2026" }, { partial: true }).ok, false);
});
t("bid input ignores status/contractor/company keys", () => {
  const r = normalizeBidInput({ proposedAmount: 500, status: "awarded", contractorId: "x", companyId: "B" } as any) as any;
  assert.deepEqual(Object.keys(r.values), ["proposed_amount"]);
});
t("publish validation: recurring needs frequency; range needs both ends", () => {
  assert.equal(validatePostShape({ title: "x", summary: "s", work_type: "recurring" }, { forPublish: true }).ok, false);
  assert.equal(validatePostShape({ title: "x", summary: "s", work_type: "one_time", budget_type: "range", budget_min: "1" }, { forPublish: true }).ok, false);
  assert.equal(validatePostShape({ title: "x", summary: "s", work_type: "one_time", budget_type: "contractor_quote" }, { forPublish: true }).ok, true);
  assert.equal(validatePostShape({ title: "x", work_type: "one_time", recurrence_frequency: "weekly" }, { forPublish: false }).ok, false);
});
t("award limit cannot drop below awards already made", () => {
  assert.equal(validatePostShape({ maximum_awards: 1, awards_made: 2 }, { forPublish: false }).ok, false);
});
t("bid submit needs a price", () => {
  assert.equal(validateBidForSubmit({}).ok, false);
  assert.equal(validateBidForSubmit({ proposed_amount: "10.00" }).ok, true);
  assert.equal(validateBidForSubmit({ rate_type: "hourly", proposed_amount: "10.00" }).ok, false);
});
t("award amount: fixed, else rate × hours, else null", () => {
  assert.equal(awardProposalAmount({ proposed_amount: "1500" }), "1500.00");
  assert.equal(awardProposalAmount({ hourly_rate: "50", estimated_hours: "12.5" }), "625.00");
  assert.equal(awardProposalAmount({ hourly_rate: "50" }), null);
});
t("DATE values read back as local calendar dates", () => {
  assert.equal(dateOnlyString(new Date(2026, 10, 20)), "2026-11-20");
  assert.equal(dateOnlyString("2026-11-20"), "2026-11-20");
  assert.equal(dateOnlyString(null), null);
});

console.log("projections");
t("contractor posting view hides creator, cost job, award count and undisclosed budget", () => {
  const v = projectPostForContractor({ id: "p", company_id: "A", created_by_user_id: "u", cost_job_id: "j", awards_made: 2, maximum_awards: 5,
    work_type: "recurring", budget_type: "undisclosed", budget_min: "1", budget_max: "9", visibility: "invited_only", tenant_id: "t" }) as any;
  for (const k of ["createdByUserId", "costJobId", "awardsMade", "visibility", "tenantId", "maximumAwards"]) assert.ok(!(k in v), k);
  assert.equal(v.budgetMin, null);
  assert.equal(v.budgetMax, null);
  assert.equal(v.hasAwards, true);
  assert.equal(v.capacityRemaining, 3);
});
t("contractor bid view omits reviewer and idempotency key", () => {
  const v = projectBidForContractor({ id: "b", reviewed_by_user_id: "u", award_idempotency_key: "k", awarded_by_user_id: "u", contractor_id: "w" }) as any;
  for (const k of ["reviewedByUserId", "awardIdempotencyKey", "awardedByUserId", "contractorId"]) assert.ok(!(k in v), k);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
