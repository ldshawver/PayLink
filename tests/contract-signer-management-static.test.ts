/**
 * Static regression checks for contractor contract pre-signature signer management.
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const hub = fs.readFileSync("client/src/pages/contractor-hub.tsx", "utf8");

assert(routes.includes('app.post("/api/contractor-contracts/:contractId/signers"'), "canonical add signer endpoint exists");
assert(routes.includes('normalizeSignerEmail') && routes.includes('trim().toLowerCase()'), "signer emails are normalized");
assert(routes.includes('hasDuplicateActiveContractSigner') && routes.includes('This signer is already assigned to this contract.'), "duplicate active signer emails are rejected");
assert(routes.includes('assertContractSignerManageAccess') && routes.includes('workerId === contract.contractor_id') && routes.includes('canAccessCompany(user, contract.company_id)'), "contractor owner and company-scoped admins can manage signers");
assert(routes.includes('actionType: "signer_added"') && routes.includes('actionType: "signer_reassigned"') && routes.includes('actionType: "signer_removed"') && routes.includes('actionType: "signer_request_resent"'), "all signer management actions are audit logged");
assert(routes.includes('Signed signers cannot be edited') && routes.includes('Signed signers cannot be deleted'), "signed signers are locked server-side");
assert(routes.includes("SET status = 'canceled'") && !routes.includes('DELETE FROM contract_signers WHERE id = ${req.params.signerId}'), "unsigned removal cancels locally instead of deleting signer history");
assert(routes.includes("status IN ('pending','sent','viewed','unsent','draft')") && routes.includes('COALESCE(is_required, TRUE) = TRUE'), "fully signed calculation ignores canceled signers and checks active required signers");
assert(routes.includes('app.post("/api/contractor-contracts/:contractId/signers/:signerId/resend"') && routes.includes('UPDATE contract_signers SET status = \'sent\''), "resend updates existing signer without inserting duplicates");
assert(hub.includes('canManageSigners = isAdmin || currentUserRole === "contractor"'), "contractor and admins see signer management controls");
assert(hub.includes('Signed — cannot edit') && hub.includes('btn-resend-signer') && hub.includes('Edit/Reassign'), "UI locks signed signers and exposes pending signer actions");
assert(hub.includes('text-add-signer-duplicate') && hub.includes('text-edit-signer-duplicate'), "UI validates duplicate signer emails before submit");

console.log("PASS: contractor contract signer management static checks passed");
