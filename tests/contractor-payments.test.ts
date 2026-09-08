/**
 * Release B — contractor-invoice payment lifecycle pure-logic tests.
 * Run: npx tsx tests/contractor-payments.test.ts
 * No database, no network.
 */
import assert from "node:assert/strict";
import {
  CONTRACTOR_PAYMENT_METHODS, DESCRIPTION_REQUIRED_METHODS, EXTERNAL_SETTLEMENT_METHODS,
  normalizeContractorPaymentMethod, toCents, fromCents, checkPaymentAmount,
  recomputeInvoiceStatus, paymentFingerprint, requireIdempotencyKey,
  checkTradeCreditApplicable, tradeCompFingerprint, externalSettlementDisclaimer,
} from "../server/contractor-payments.ts";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

console.log("=== contractor payment lifecycle (pure logic) ===\n");

// -- method allowlist ---------------------------------------------------
ok("allowlist is exactly the six approved methods",
  JSON.stringify([...CONTRACTOR_PAYMENT_METHODS].sort()) ===
  JSON.stringify(["ach", "cash", "check", "other", "rent_credit", "trade_credit"]));
ok("normalize accepts canonical values", CONTRACTOR_PAYMENT_METHODS.every((m) => normalizeContractorPaymentMethod(m) === m));
ok("normalize is case/space/hyphen tolerant",
  normalizeContractorPaymentMethod(" Trade-Credit ") === "trade_credit" &&
  normalizeContractorPaymentMethod("ACH") === "ach");
ok("normalize rejects anything off-list (no reinterpretation of free text)",
  normalizeContractorPaymentMethod("wire") === null &&
  normalizeContractorPaymentMethod("Paid by Venmo") === null &&
  normalizeContractorPaymentMethod("") === null &&
  normalizeContractorPaymentMethod(null) === null);
ok("trade_credit / rent_credit / other require a description",
  DESCRIPTION_REQUIRED_METHODS.has("trade_credit") &&
  DESCRIPTION_REQUIRED_METHODS.has("rent_credit") &&
  DESCRIPTION_REQUIRED_METHODS.has("other") &&
  !DESCRIPTION_REQUIRED_METHODS.has("cash") && !DESCRIPTION_REQUIRED_METHODS.has("check"));
ok("check is the only method whose reversal is fully internal",
  !EXTERNAL_SETTLEMENT_METHODS.has("check") &&
  ["cash", "ach", "trade_credit", "rent_credit"].every((m) => EXTERNAL_SETTLEMENT_METHODS.has(m)));
ok("externalSettlementDisclaimer set for non-check, null for check",
  externalSettlementDisclaimer("cash")!.includes("does not reverse an external bank transfer") &&
  externalSettlementDisclaimer("check") === null);

// -- money math -------------------------------------------------------
ok("toCents/fromCents round-trip without float drift",
  toCents("19.99") === 1999 && fromCents(1999) === 19.99 &&
  toCents(0.1) + toCents(0.2) === 30 && fromCents(toCents(0.1) + toCents(0.2)) === 0.3);
ok("toCents(non-numeric) is NaN", Number.isNaN(toCents("abc")) && Number.isNaN(toCents(undefined as any) as any) === false);

// -- amount validation ----------------------------------------------
ok("rejects zero / negative / non-finite",
  !checkPaymentAmount(0, 10000).ok && !checkPaymentAmount(-5, 10000).ok && !checkPaymentAmount("x", 10000).ok);
ok("rejects amount exceeding the authoritative balance",
  (() => { const r = checkPaymentAmount("100.01", 10000); return !r.ok && r.code === "AMOUNT_EXCEEDS_BALANCE"; })());
ok("accepts an exact-balance payment", (() => { const r = checkPaymentAmount("100.00", 10000); return r.ok && r.cents === 10000; })());
ok("accepts a partial payment", (() => { const r = checkPaymentAmount("40.00", 10000); return r.ok && r.cents === 4000; })());

// -- invoice status recompute -------------------------------------
ok("fully covered -> paid", recomputeInvoiceStatus(10000, 10000) === "paid" && recomputeInvoiceStatus(10000, 12000) === "paid");
ok("some paid -> partially_paid", recomputeInvoiceStatus(10000, 4000) === "partially_paid");
ok("nothing paid (or reversed to zero) -> sent", recomputeInvoiceStatus(10000, 0) === "sent");

// -- idempotency key + fingerprint --------------------------------
ok("Idempotency-Key is required", !requireIdempotencyKey("").ok && !requireIdempotencyKey("   ").ok && !requireIdempotencyKey(null).ok);
ok("Idempotency-Key is trimmed", (() => { const r = requireIdempotencyKey("  abc-123 "); return r.ok && r.key === "abc-123"; })());
{
  const base = { companyId: "co1", invoiceId: "inv1", method: "cash", amountCents: 5000, tradeCompensationId: null };
  ok("fingerprint is stable for identical financial input", paymentFingerprint(base) === paymentFingerprint({ ...base }));
  ok("fingerprint changes when amount changes", paymentFingerprint(base) !== paymentFingerprint({ ...base, amountCents: 5001 }));
  ok("fingerprint changes when method changes", paymentFingerprint(base) !== paymentFingerprint({ ...base, method: "check" }));
  ok("fingerprint changes when invoice changes", paymentFingerprint(base) !== paymentFingerprint({ ...base, invoiceId: "inv2" }));
  ok("fingerprint changes when company changes", paymentFingerprint(base) !== paymentFingerprint({ ...base, companyId: "co2" }));
  ok("fingerprint changes when linked trade comp changes", paymentFingerprint(base) !== paymentFingerprint({ ...base, tradeCompensationId: "tc1" }));
}
ok("trade-comp fallback fingerprint distinguishes two same-value credits on different payroll items",
  tradeCompFingerprint({ companyId: "c", contractorUserId: "w", payrollItemId: "pi1", totalValueCents: 5000 }) !==
  tradeCompFingerprint({ companyId: "c", contractorUserId: "w", payrollItemId: "pi2", totalValueCents: 5000 }));

// -- trade credit applicability ----------------------------------
const okComp = { id: "tc1", companyId: "co1", contractorUserId: "w1", approvedAt: new Date(), valuationMethod: "fair_market_value", totalValue: "500.00", contractorPaymentId: null };
const ctx = { companyId: "co1", contractorId: "w1", paymentCents: 40000 };
ok("approved FMV, same company+contractor, unused, covers -> applicable", checkTradeCreditApplicable(okComp, ctx).ok);
ok("missing record -> not applicable", (() => { const r = checkTradeCreditApplicable(null, ctx); return !r.ok && r.code === "TRADE_COMP_NOT_FOUND"; })());
ok("cross-company -> rejected", (() => { const r = checkTradeCreditApplicable({ ...okComp, companyId: "coX" }, ctx); return !r.ok && r.code === "TRADE_COMP_CROSS_COMPANY"; })());
ok("different contractor -> rejected", (() => { const r = checkTradeCreditApplicable({ ...okComp, contractorUserId: "wX" }, ctx); return !r.ok && r.code === "TRADE_COMP_CONTRACTOR_MISMATCH"; })());
ok("not approved -> rejected", (() => { const r = checkTradeCreditApplicable({ ...okComp, approvedAt: null }, ctx); return !r.ok && r.code === "TRADE_COMP_NOT_APPROVED"; })());
ok("valuation not fair_market_value -> rejected", (() => { const r = checkTradeCreditApplicable({ ...okComp, valuationMethod: "cost" }, ctx); return !r.ok && r.code === "TRADE_COMP_NOT_FMV"; })());
ok("already linked to another contractor payment -> rejected", (() => { const r = checkTradeCreditApplicable({ ...okComp, contractorPaymentId: "pOther" }, ctx); return !r.ok && r.code === "TRADE_COMP_ALREADY_LINKED"; })());
ok("already linked to an EXPENSE payment (other ledger) -> rejected — one-time link spans both ledgers", (() => { const r = checkTradeCreditApplicable({ ...okComp, expensePaymentId: "epOther" }, ctx); return !r.ok && r.code === "TRADE_COMP_ALREADY_LINKED"; })());
ok("approved value does not cover the payment -> rejected", (() => { const r = checkTradeCreditApplicable({ ...okComp, totalValue: "100.00" }, ctx); return !r.ok && r.code === "TRADE_COMP_VALUE_INSUFFICIENT"; })());

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
