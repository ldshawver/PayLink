/**
 * Runtime regression tests for contract signing authorization and Documenso completion side effects.
 * Run: npx tsx tests/contract-signing-flow.test.ts
 */
import assert from "node:assert/strict";
import {
  autoCreateProposalBackedInvoice,
  buildContractDocumensoReturnUrl,
  canSignContract,
} from "../server/contract-signing-flow.js";

console.log("=== contract signing flow runtime regression ===\n");

assert.equal(canSignContract({ isContractor: false, isAdmin: true, isPlatformAdmin: false, userCompanyMatches: false, hasExplicitCompanyAccess: true, hasRegisteredSigner: false }), true, "authorized company user succeeds");
assert.equal(canSignContract({ isContractor: false, isAdmin: true, isPlatformAdmin: false, userCompanyMatches: false, hasExplicitCompanyAccess: false, hasRegisteredSigner: false }), false, "unauthorized/cross-company user fails");
assert.equal(canSignContract({ isContractor: false, isAdmin: false, isPlatformAdmin: false, userCompanyMatches: false, hasExplicitCompanyAccess: false, hasRegisteredSigner: false }), false, "missing company access fails safely");
assert.equal(canSignContract({ isContractor: false, isAdmin: false, isPlatformAdmin: false, userCompanyMatches: false, hasExplicitCompanyAccess: false, hasRegisteredSigner: true }), true, "registered signer succeeds");
console.log("PASS: internal contract signing authorization matrix");

const returnUrl = buildContractDocumensoReturnUrl("https://mypaylink.app///", "contract 1/?bad=https://evil.example");
assert.equal(returnUrl, "https://mypaylink.app/sign/contracts/contract%201%2F%3Fbad%3Dhttps%3A%2F%2Fevil.example/status", "return URL is anchored to the public signing status route and encodes the signer token");
assert.ok(!returnUrl.startsWith("https://evil.example"), "return URL is not an open redirect");
assert.ok(!returnUrl.includes("/app/contractor-hub/contracts/"), "return URL does not use the old authenticated contract signing route");
console.log("PASS: public token return URL is not open redirectable");

const contract = { id: "contract-1", company_id: "company-a", proposal_id: "proposal-1", status: "sent" };
const proposal = { id: "proposal-1", contractor_id: "worker-a", amount: "125.00", title: "Approved work", proposal_number: "PROP-1", converted_to_invoice_id: null };
const invoices: any[] = [];
let markedProposal: any = null;
const deps = {
  countInvoicesForContractor: async (contractorId: string) => invoices.filter(i => i.contractor_id === contractorId && i.company_id === contract.company_id).length,
  createInvoice: async (values: Record<string, unknown>) => {
    const invoice = { id: `invoice-${invoices.length + 1}`, ...values };
    invoices.push(invoice);
    return invoice;
  },
  markProposalConverted: async (proposalId: string, invoiceId: string) => {
    markedProposal = { proposalId, invoiceId };
    proposal.converted_to_invoice_id = invoiceId;
  },
};

const created = await autoCreateProposalBackedInvoice(contract, proposal, deps, new Date("2026-06-16T12:00:00Z"));
assert.equal(created?.id, "invoice-1", "completed Documenso contract creates invoice");
assert.equal(invoices.length, 1, "invoice is created exactly once on first completion");
assert.equal(invoices[0].company_id, "company-a", "invoice creation is company-scoped from contract");
assert.equal(invoices[0].proposal_id, "proposal-1", "invoice is proposal-backed");
assert.deepEqual(markedProposal, { proposalId: "proposal-1", invoiceId: "invoice-1" }, "proposal is marked converted");

const duplicate = await autoCreateProposalBackedInvoice(contract, proposal, deps, new Date("2026-06-16T12:01:00Z"));
assert.equal(duplicate, null, "duplicate Documenso completion is idempotent");
assert.equal(invoices.length, 1, "duplicate webhook does not create duplicate invoices");

const unmarkedProposal = { ...proposal, converted_to_invoice_id: null };
let remappedExistingInvoice: any = null;
const duplicateByContract = await autoCreateProposalBackedInvoice(contract, unmarkedProposal, {
  ...deps,
  findExistingInvoice: async () => invoices[0],
  markProposalConverted: async (proposalId: string, invoiceId: string) => { remappedExistingInvoice = { proposalId, invoiceId }; },
}, new Date("2026-06-16T12:02:00Z"));
assert.equal(duplicateByContract, null, "existing contract/proposal invoice blocks duplicate creation even before proposal is marked converted");
assert.deepEqual(remappedExistingInvoice, { proposalId: "proposal-1", invoiceId: "invoice-1" }, "existing invoice is linked back to the proposal during idempotency repair");
assert.equal(invoices.length, 1, "existing-invoice idempotency repair does not create another invoice");
console.log("PASS: completed contract invoice creation and idempotency");

assert.equal(await autoCreateProposalBackedInvoice({ ...contract, id: "missing-contract", proposal_id: undefined }, proposal, deps), null, "missing contract proposal link does not mutate");
assert.equal(await autoCreateProposalBackedInvoice({ ...contract, proposal_id: "other-proposal" }, proposal, deps), null, "wrong metadata/proposal mismatch does not mutate");
assert.equal(await autoCreateProposalBackedInvoice({ ...contract, status: "fully_signed" }, { ...proposal, converted_to_invoice_id: "invoice-existing" }, deps), null, "already signed/converted contract does not duplicate invoice");
const alreadySignedProposal = { ...proposal, id: "proposal-2", converted_to_invoice_id: "invoice-existing" };
assert.equal(await autoCreateProposalBackedInvoice({ ...contract, status: "fully_signed", proposal_id: "proposal-2" }, alreadySignedProposal, deps), null, "already signed contract with converted proposal does not mutate");
assert.equal(invoices.length, 1, "negative webhook cases do not mutate invoice state");
console.log("PASS: negative webhook invoice cases");

console.log("\nAll contract signing flow runtime checks passed.");
