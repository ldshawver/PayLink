/**
 * Behavioral tests for server/contractor-proposal-identity.ts — the shared
 * reconciliation logic that fixes the contractor/profile/proposal identity
 * defect found during the 2026-08-13 staging Documenso E2E test (proposal
 * CP-9D07-0006 silently resolved to an unrelated "LUX Contractor" instead of
 * the newly created QA contractor).
 *
 * Unlike the source-string "mirror" pattern used by some other tests in this
 * repo (routes.ts handlers aren't exported, so those tests re-implement the
 * control flow and pin it with static assertions), this file imports and
 * calls the REAL exported functions that server/routes.ts now calls for
 * proposal creation and contract-signer creation. This is a step up in
 * integrity: there is no way for the test and the implementation to drift
 * apart, because they are the same code.
 *
 * Run: npx tsx tests/contractor-proposal-identity.test.ts
 */
import assert from "node:assert/strict";
import {
  isValidUuid,
  reconcileProposalContractor,
  resolveContractorSignerIdentity,
  normalizeEmailForCompare,
  type WorkerLike,
  type ContractorProfileLike,
} from "../server/contractor-proposal-identity";

let pass = 0;
let fail = 0;
function ok(name: string, result: boolean, detail?: string) {
  if (result) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const LUX: WorkerLike = { id: "11111111-1111-1111-1111-111111111111", workerType: "contractor", companyId: "company-lux" };
const QA_CONTRACTOR: WorkerLike = { id: "22222222-2222-2222-2222-222222222222", workerType: "contractor", companyId: "42b281dd-6503-4220-94c5-44e4b253b944" };
const EMPLOYEE_NOT_CONTRACTOR: WorkerLike = { id: "33333333-3333-3333-3333-333333333333", workerType: "employee", companyId: "42b281dd-6503-4220-94c5-44e4b253b944" };
const ORPHAN_CONTRACTOR: WorkerLike = { id: "44444444-4444-4444-4444-444444444444", workerType: "contractor", companyId: null };

console.log("isValidUuid");
ok("accepts a well-formed UUID", isValidUuid("22222222-2222-2222-2222-222222222222"));
ok("rejects empty string", !isValidUuid(""));
ok("rejects undefined", !isValidUuid(undefined));
ok("rejects a non-UUID slug like a name fragment", !isValidUuid("lux-contractor"));
ok("rejects a numeric-looking id", !isValidUuid("12345"));

console.log("\nreconcileProposalContractor — the core LUX-mismatch fix");
{
  // The exact staging scenario: UI shows "Greenfield Solutions" selected as
  // the company, but the contractor selection is stale and still points at
  // a contractor from a different company (LUX). This must be rejected, not
  // silently created under LUX's company.
  const r = reconcileProposalContractor(LUX.id, "42b281dd-6503-4220-94c5-44e4b253b944", LUX);
  ok("rejects a contractor whose company disagrees with the selected company", !r.ok && r.status === 409, JSON.stringify(r));
}
{
  // Correct path: contractor and company agree.
  const r = reconcileProposalContractor(QA_CONTRACTOR.id, QA_CONTRACTOR.companyId, QA_CONTRACTOR);
  ok("accepts a matching contractor + company", r.ok && r.workerId === QA_CONTRACTOR.id && r.companyId === QA_CONTRACTOR.companyId, JSON.stringify(r));
}
{
  // No companyId sent at all (legacy client) — trust the contractor's own company, as before.
  const r = reconcileProposalContractor(QA_CONTRACTOR.id, undefined, QA_CONTRACTOR);
  ok("derives company from the contractor when no companyId is sent", r.ok && r.companyId === QA_CONTRACTOR.companyId, JSON.stringify(r));
}
{
  const r = reconcileProposalContractor("not-a-uuid", undefined, undefined);
  ok("rejects a malformed contractor id before any DB lookup would even matter", !r.ok && r.status === 400, JSON.stringify(r));
}
{
  const r = reconcileProposalContractor(QA_CONTRACTOR.id, undefined, undefined);
  ok("rejects an unknown contractor (404)", !r.ok && r.status === 404, JSON.stringify(r));
}
{
  const r = reconcileProposalContractor(EMPLOYEE_NOT_CONTRACTOR.id, undefined, EMPLOYEE_NOT_CONTRACTOR);
  ok("rejects a worker that is not workerType=contractor", !r.ok && r.status === 400, JSON.stringify(r));
}
{
  const r = reconcileProposalContractor(ORPHAN_CONTRACTOR.id, undefined, ORPHAN_CONTRACTOR);
  ok("rejects a contractor with no company assigned", !r.ok && r.status === 400, JSON.stringify(r));
}
{
  const r = reconcileProposalContractor(QA_CONTRACTOR.id, "", QA_CONTRACTOR);
  ok("treats an empty-string companyId as 'not sent' rather than a mismatch", r.ok, JSON.stringify(r));
}

console.log("\nresolveContractorSignerIdentity — blocks silent signer-email divergence");
const CONTRACT_ID = QA_CONTRACTOR.id;
const PROFILE: ContractorProfileLike = { id: QA_CONTRACTOR.id, firstName: "Jamie", lastName: "Rivera", email: "jamie.rivera@example.com", workEmail: null };
{
  // The exact vulnerability found in addContractSigner: role=contractor,
  // workerId correctly points at the real contractor, but the caller (or a
  // client bug) supplies a completely different email. Must be blocked.
  const r = resolveContractorSignerIdentity(CONTRACT_ID, QA_CONTRACTOR.id, "someone-else@attacker.example", PROFILE);
  ok("blocks a mismatched signer email even when workerId is correct", !r.ok && r.status === 400, JSON.stringify(r));
}
{
  const r = resolveContractorSignerIdentity(CONTRACT_ID, LUX.id, "jamie.rivera@example.com", PROFILE);
  ok("blocks a workerId that does not match the contract's own contractor", !r.ok && r.status === 400, JSON.stringify(r));
}
{
  const r = resolveContractorSignerIdentity(CONTRACT_ID, null, null, PROFILE);
  ok("derives name+email from the profile when the caller supplies neither", r.ok && r.email === "jamie.rivera@example.com" && r.name === "Jamie Rivera", JSON.stringify(r));
}
{
  const r = resolveContractorSignerIdentity(CONTRACT_ID, QA_CONTRACTOR.id, "Jamie.Rivera@EXAMPLE.com", PROFILE);
  ok("accepts an email that matches only up to case/whitespace", r.ok, JSON.stringify(r));
}
{
  const noEmailProfile: ContractorProfileLike = { ...PROFILE, email: null, workEmail: null };
  const r = resolveContractorSignerIdentity(CONTRACT_ID, null, null, noEmailProfile);
  ok("blocks when the contractor profile itself has no email on file", !r.ok && r.status === 400, JSON.stringify(r));
}
{
  const workEmailOnly: ContractorProfileLike = { ...PROFILE, email: null, workEmail: "jamie.work@example.com" };
  const r = resolveContractorSignerIdentity(CONTRACT_ID, null, null, workEmailOnly);
  ok("falls back to workEmail when the primary email is unset", r.ok && r.email === "jamie.work@example.com", JSON.stringify(r));
}
{
  const r = resolveContractorSignerIdentity(null, null, null, PROFILE);
  ok("blocks when the contract has no linked contractor at all", !r.ok && r.status === 400, JSON.stringify(r));
}
{
  const r = resolveContractorSignerIdentity(CONTRACT_ID, null, null, undefined);
  ok("blocks when the contractor profile could not be loaded", !r.ok && r.status === 400, JSON.stringify(r));
}

console.log("\nnormalizeEmailForCompare");
ok("normalizes case and surrounding whitespace", normalizeEmailForCompare("  Jamie@Example.com ") === "jamie@example.com");
ok("normalizes null/undefined to empty string", normalizeEmailForCompare(null) === "" && normalizeEmailForCompare(undefined) === "");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
