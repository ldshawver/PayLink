/**
 * Static checks for Contractor Hub lifecycle audit diagnostics.
 * Run: npx tsx tests/contractor-lifecycle-audit-static.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const signingFlow = fs.readFileSync("server/contract-signing-flow.ts", "utf8");

assert(routes.includes("async function collectContractorLifecycleAudit"), "lifecycle audit collector exists");
assert(routes.includes("report_only_no_production_mutation"), "lifecycle audit is report-only before production repair");
for (const category of [
  "approvedProposalsWithNoContract",
  "contractsAwaitingSignatures",
  "duplicateSignerMappings",
  "brokenPublicSigningLinks",
  "completedDocumensoEnvelopesNotCompleteLocally",
  "completedContractsWithNoInvoice",
  "duplicateInvoices",
  "outdatedVisibleVersions",
  "missingFinalSignedPdfs",
  "missingProposalToContractReferences",
]) {
  assert(routes.includes(category), `lifecycle audit includes ${category}`);
}
assert(routes.includes("contractorLifecycleAudit: await collectContractorLifecycleAudit"), "diagnostics response includes lifecycle audit report");
assert(routes.includes("real_documenso_send") && routes.includes("webhook_replay_idempotency"), "live acceptance gates are included in diagnostics report");
assert(signingFlow.includes("findExistingInvoice?") && signingFlow.includes("await deps.findExistingInvoice?.(contract, proposal)"), "auto invoice creation checks existing proposal/contract invoice before insert");
assert(routes.includes("SELECT id FROM contractor_invoices") && routes.includes("contract_id = ${contractForInvoice.id} OR proposal_id = ${proposalForInvoice.id}"), "webhook invoice creation supplies contract/proposal idempotency lookup");

console.log("PASS: contractor lifecycle audit static checks");
