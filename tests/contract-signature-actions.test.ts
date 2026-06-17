/**
 * E2E-style policy regression checks for Contractor Hub contract signature actions.
 * Run: npx tsx tests/contract-signature-actions.test.ts
 */
import assert from "node:assert/strict";
import {
  canShowContractSignatureActions,
  getDocumensoDisabledReason,
  CONTRACT_SIGNATURE_ACTION_STATUSES,
} from "../client/src/lib/contractSignatureActions";

console.log("=== contract signature action visibility regression ===\n");

for (const role of ["admin", "manager", "global_admin", "platform_super_admin"]) {
  for (const status of CONTRACT_SIGNATURE_ACTION_STATUSES) {
    assert.equal(canShowContractSignatureActions(role, status), true, `${role} sees actions for ${status}`);
  }
}
console.log("PASS: Admin, Manager, Global Admin see Sign Internally and Send via Documenso statuses");

for (const role of ["contractor", "employee", "reviewer", null]) {
  assert.equal(canShowContractSignatureActions(role, "draft"), false, `${role} cannot see signature actions`);
}
console.log("PASS: unauthorized users do not see signature actions");

assert.equal(getDocumensoDisabledReason({ role: "admin", signerCount: 0 }), "Add at least one signer with an email before sending via Documenso", "no signer is disabled, not hidden");
assert.equal(getDocumensoDisabledReason({ role: "admin", signerCount: 1 }), null, "signer with email enables Documenso action");
assert.equal(getDocumensoDisabledReason({ role: "manager", signerCount: 1 }), null, "manager signer with email enables Documenso action");
assert.equal(getDocumensoDisabledReason({ role: "contractor", signerCount: 1 }), "Only admins, managers, and global admins can send contracts for Documenso signature", "unauthorized role stays disabled");
console.log("PASS: Documenso disabled/enabled policy matches signer requirement");

console.log("\nContract signature action visibility checks passed.");
