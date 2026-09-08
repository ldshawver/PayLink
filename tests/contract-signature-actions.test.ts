/**
 * E2E-style policy regression checks for Contractor Hub contract signature actions.
 * Run: npx tsx tests/contract-signature-actions.test.ts
 */
import assert from "node:assert/strict";
import {
  canShowContractSignatureActions,
  getDocumensoDisabledReason,
  CONTRACT_SIGNATURE_ACTION_STATUSES,
  CONTRACT_SIGNATURE_TERMINAL_STATUSES,
  isDocumensoManagedContract,
  canManuallyActivateContract,
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

assert.equal(getDocumensoDisabledReason({ role: "admin", signerCount: 0 }), "Add at least one signer with an email before sending.", "no signer is disabled, not hidden");
assert.equal(getDocumensoDisabledReason({ role: "admin", signerCount: 1 }), null, "signer with email enables Documenso action");
assert.equal(getDocumensoDisabledReason({ role: "manager", signerCount: 1 }), null, "manager signer with email enables Documenso action");
assert.equal(getDocumensoDisabledReason({ role: "contractor", signerCount: 1 }), "Only admins, managers, and global admins can send contracts for Documenso signature", "unauthorized role stays disabled");
console.log("PASS: Documenso disabled/enabled policy matches signer requirement");

assert.ok(CONTRACT_SIGNATURE_TERMINAL_STATUSES.includes("active" as any), "active is a terminal signing status (no resend/sign-internally once active)");
console.log("PASS: active is treated as terminal for signature actions");

// ── isDocumensoManagedContract ──────────────────────────────────────────────
assert.equal(isDocumensoManagedContract(null), false, "null contract is not Documenso-managed");
assert.equal(isDocumensoManagedContract({ documensoDocumentId: null, documensoSigningUrl: null }, []), false, "no Documenso data anywhere means not managed");
assert.equal(isDocumensoManagedContract({ documensoDocumentId: "doc_1" }), true, "a contract-level Documenso document id marks it managed");
assert.equal(isDocumensoManagedContract({}, [{ documensoRecipientId: "42" }]), true, "a single signer with a Documenso recipient id marks the whole contract managed");
console.log("PASS: isDocumensoManagedContract detects Documenso data at contract or signer level");

// ── canManuallyActivateContract ─────────────────────────────────────────────
assert.equal(canManuallyActivateContract({ role: "admin", status: "fully_signed", documensoManaged: true }), false, "Documenso-backed contracts never allow manual activation, even when fully signed");
assert.equal(canManuallyActivateContract({ role: "admin", status: "fully_signed", documensoManaged: false }), true, "non-Documenso (imported/manual) fully-signed contracts can be manually activated");
assert.equal(canManuallyActivateContract({ role: "admin", status: "active", documensoManaged: false }), false, "already-active contracts cannot be activated again");
assert.equal(canManuallyActivateContract({ role: "contractor", status: "fully_signed", documensoManaged: false }), false, "unauthorized roles cannot manually activate");
console.log("PASS: canManuallyActivateContract restricts manual activation to non-Documenso contracts in an eligible status");

console.log("\nContract signature action visibility checks passed.");
