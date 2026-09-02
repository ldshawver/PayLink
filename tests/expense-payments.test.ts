/**
 * Release B2 — vendor/expense Cut Check pure-logic tests.
 * Run: npx tsx tests/expense-payments.test.ts   (no DB, no network)
 */
import assert from "node:assert/strict";
import {
  EXPENSE_PAYMENT_METHOD, EXPENSE_VOID_STOP_PAYMENT_NOTE,
  recomputeExpensePaymentStatus, expensePaymentFingerprint, checkExpenseEligibility,
  toCents, fromCents, checkPaymentAmount, requireIdempotencyKey,
  EXPENSE_PAYMENT_METHODS, EXPENSE_RECORD_PAYMENT_METHODS, EXPENSE_DESCRIPTION_REQUIRED_METHODS,
  EXPENSE_TRADE_COMP_MISSING_REASON,
  normalizeExpensePaymentMethod, checkExpenseTradeCreditApplicable, expenseTradeCompLinked,
} from "../server/expense-payments.ts";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

console.log("=== vendor/expense Cut Check (pure logic) ===\n");

ok("B2 is check-only", EXPENSE_PAYMENT_METHOD === "check");
ok("void note tells the user a paper check needs a bank stop-payment",
  EXPENSE_VOID_STOP_PAYMENT_NOTE.includes("stop-payment") && EXPENSE_VOID_STOP_PAYMENT_NOTE.includes("cannot recall"));

// -- money helpers reused from the contractor ledger --------------------
ok("shares the cents model (no float drift)", toCents("19.99") === 1999 && fromCents(1999) === 19.99);
ok("rejects zero / negative / over-balance", !checkPaymentAmount(0, 5000).ok && !checkPaymentAmount(-1, 5000).ok &&
  (() => { const r = checkPaymentAmount("60.00", 5000); return !r.ok && r.code === "AMOUNT_EXCEEDS_BALANCE"; })());
ok("Idempotency-Key required + trimmed", !requireIdempotencyKey("").ok &&
  (() => { const r = requireIdempotencyKey("  k1 "); return r.ok && r.key === "k1"; })());

// -- status recompute -------------------------------------------------
ok("fully covered -> paid", recomputeExpensePaymentStatus(10000, 10000) === "paid" && recomputeExpensePaymentStatus(10000, 12000) === "paid");
ok("some paid -> partially_paid", recomputeExpensePaymentStatus(10000, 4000) === "partially_paid");
ok("reversed to zero -> unpaid", recomputeExpensePaymentStatus(10000, 0) === "unpaid");

// -- fingerprint -----------------------------------------------------
{
  const base = { companyId: "co1", expenseId: "e1", amountCents: 5000, method: "check", fundingAccountId: "rs1", payeeName: "Acme" };
  ok("stable for identical input", expensePaymentFingerprint(base) === expensePaymentFingerprint({ ...base }));
  ok("changes with amount / expense / company / funding account / payee", [
    expensePaymentFingerprint({ ...base, amountCents: 5001 }),
    expensePaymentFingerprint({ ...base, expenseId: "e2" }),
    expensePaymentFingerprint({ ...base, companyId: "co2" }),
    expensePaymentFingerprint({ ...base, fundingAccountId: "rs2" }),
    expensePaymentFingerprint({ ...base, payeeName: "Other" }),
  ].every((fp) => fp !== expensePaymentFingerprint(base)));
  ok("payee comparison is case-insensitive / trimmed",
    expensePaymentFingerprint({ ...base, payeeName: "  ACME " }) === expensePaymentFingerprint(base));
}

// -- eligibility ---------------------------------------------------
const approved = { companyId: "co1", status: "approved", paymentStatus: "unpaid", vendor: "Acme", payeeName: null, amount: "100.00" };
ok("approved, in-company, has vendor, unpaid -> eligible", checkExpenseEligibility(approved, { companyId: "co1" }).ok);
ok("missing expense -> not eligible", (() => { const r = checkExpenseEligibility(null, { companyId: "co1" }); return !r.ok && r.code === "EXPENSE_NOT_FOUND"; })());
ok("cross-company -> rejected", (() => { const r = checkExpenseEligibility({ ...approved, companyId: "coX" }, { companyId: "co1" }); return !r.ok && r.code === "EXPENSE_CROSS_COMPANY"; })());
ok("no vendor / payee -> rejected", (() => { const r = checkExpenseEligibility({ ...approved, vendor: null, payeeName: null }, { companyId: "co1" }); return !r.ok && r.code === "EXPENSE_NO_VENDOR"; })());
ok("not approved (submitted) -> rejected", (() => { const r = checkExpenseEligibility({ ...approved, status: "submitted" }, { companyId: "co1" }); return !r.ok && r.code === "EXPENSE_NOT_APPROVED"; })());
ok("rejected expense -> rejected", (() => { const r = checkExpenseEligibility({ ...approved, status: "rejected" }, { companyId: "co1" }); return !r.ok && (r.code === "EXPENSE_NOT_APPROVED" || r.code === "EXPENSE_NOT_PAYABLE"); })());
ok("archived -> rejected", (() => { const r = checkExpenseEligibility({ ...approved, isArchived: true }, { companyId: "co1" }); return !r.ok && r.code === "EXPENSE_ARCHIVED"; })());
ok("already fully paid -> rejected", (() => { const r = checkExpenseEligibility({ ...approved, paymentStatus: "paid" }, { companyId: "co1" }); return !r.ok && r.code === "EXPENSE_ALREADY_PAID"; })());
ok("partially_paid is still eligible for another partial check",
  checkExpenseEligibility({ ...approved, paymentStatus: "partially_paid" }, { companyId: "co1" }).ok);
ok("payeeName wins over vendor for the printed name",
  checkExpenseEligibility({ ...approved, payeeName: "Payee Co", vendor: "Vendor Co" }, { companyId: "co1" }).ok &&
  (checkExpenseEligibility({ ...approved, payeeName: "Payee Co", vendor: "Vendor Co" }, { companyId: "co1" }) as any).payeeName === "Payee Co");

// ── combined usability release: non-check methods on the same ledger ─────────
console.log("\n--- non-check payment methods (migration 0018) ---");
ok("the ledger accepts exactly check + cash + ach + trade_credit + rent_credit + other",
  JSON.stringify([...EXPENSE_PAYMENT_METHODS]) === JSON.stringify(["check", "cash", "ach", "trade_credit", "rent_credit", "other"]));
ok("record-payment methods are the non-check subset (check is issued via /cut-check)",
  JSON.stringify([...EXPENSE_RECORD_PAYMENT_METHODS]) === JSON.stringify(["cash", "ach", "trade_credit", "rent_credit", "other"]));
ok("wire / credit_card are never accepted", normalizeExpensePaymentMethod("wire") === null && normalizeExpensePaymentMethod("credit_card") === null);
ok("method normalization is case / separator tolerant",
  normalizeExpensePaymentMethod("Trade-Credit") === "trade_credit" && normalizeExpensePaymentMethod(" ACH ") === "ach" && normalizeExpensePaymentMethod("CHECK") === "check");
ok("description is required for trade_credit / rent_credit / other only",
  EXPENSE_DESCRIPTION_REQUIRED_METHODS.has("trade_credit") && EXPENSE_DESCRIPTION_REQUIRED_METHODS.has("rent_credit") &&
  EXPENSE_DESCRIPTION_REQUIRED_METHODS.has("other") && !EXPENSE_DESCRIPTION_REQUIRED_METHODS.has("cash") && !EXPENSE_DESCRIPTION_REQUIRED_METHODS.has("ach"));

// a trade_credit payment's fingerprint differs from an otherwise-identical check
{
  const base = { companyId: "co1", expenseId: "e1", amountCents: 5000, fundingAccountId: null, payeeName: "Acme" };
  ok("check fingerprint is byte-identical with/without a null tradeCompensationId (back-compat)",
    expensePaymentFingerprint({ ...base, method: "check" }) === expensePaymentFingerprint({ ...base, method: "check", tradeCompensationId: null }));
  ok("a trade_credit payment linked to a valuation has its own stable fingerprint",
    expensePaymentFingerprint({ ...base, method: "trade_credit", tradeCompensationId: "tc1" }) ===
    expensePaymentFingerprint({ ...base, method: "trade_credit", tradeCompensationId: "tc1" }) &&
    expensePaymentFingerprint({ ...base, method: "trade_credit", tradeCompensationId: "tc1" }) !==
    expensePaymentFingerprint({ ...base, method: "trade_credit", tradeCompensationId: "tc2" }));
}

console.log("\n--- trade / barter FMV valuation gate (must be tied to the expense's payee) ---");
const comp = {
  id: "tc1", companyId: "co1", contractorUserId: "w1", approvedAt: new Date(),
  valuationMethod: "fair_market_value", totalValue: "500.00", contractorPaymentId: null, expensePaymentId: null,
};
// expense submitted BY worker w1, payee name "Jane Contractor"
const ctxOk = { companyId: "co1", paymentCents: 40000, expensePayeeWorkerId: "w1", expensePayeeName: "Jane Contractor", compContractorName: "Jane Contractor" };

// (2) correctly linked approved valuation is accepted — by worker id
ok("approved FMV valuation tied to the expense's submitter worker -> applicable",
  checkExpenseTradeCreditApplicable(comp, ctxOk).ok);
ok("approved FMV valuation tied only by matching payee name -> applicable",
  checkExpenseTradeCreditApplicable(comp, { companyId: "co1", paymentCents: 40000, expensePayeeWorkerId: "someone-else", expensePayeeName: "Jane  CONTRACTOR", compContractorName: "jane contractor" }).ok);

// (1) unrelated same-company approved valuation is rejected
ok("unrelated same-company valuation (different worker, different name) -> TRADE_COMP_UNRELATED",
  (checkExpenseTradeCreditApplicable(comp, { companyId: "co1", paymentCents: 40000, expensePayeeWorkerId: "w-other", expensePayeeName: "Acme Roofing LLC", compContractorName: "Jane Contractor" }) as any).code === "TRADE_COMP_UNRELATED");
ok("an unrelated valuation is rejected with the 'Missing approved trade/barter valuation' reason",
  (checkExpenseTradeCreditApplicable(comp, { companyId: "co1", paymentCents: 40000, expensePayeeWorkerId: "w-other", expensePayeeName: "Acme", compContractorName: "Jane Contractor" }) as any).message.startsWith(EXPENSE_TRADE_COMP_MISSING_REASON));
ok("no payee identity on the expense at all -> rejected (cannot prove the link)",
  !checkExpenseTradeCreditApplicable(comp, { companyId: "co1", paymentCents: 40000, expensePayeeWorkerId: null, expensePayeeName: null, compContractorName: "Jane Contractor" }).ok);

// (3) cross-company valuation is rejected
ok("cross-company valuation -> TRADE_COMP_CROSS_COMPANY", (checkExpenseTradeCreditApplicable({ ...comp, companyId: "coX" }, ctxOk) as any).code === "TRADE_COMP_CROSS_COMPANY");

// (4) missing valuation -> the expected disabled reason
ok("missing valuation -> TRADE_COMP_NOT_FOUND with the 'Missing approved trade/barter valuation' reason",
  (() => { const r = checkExpenseTradeCreditApplicable(null, ctxOk) as any; return r.code === "TRADE_COMP_NOT_FOUND" && r.message.startsWith(EXPENSE_TRADE_COMP_MISSING_REASON); })());
ok("the canonical disabled reason string is exactly 'Missing approved trade/barter valuation'",
  EXPENSE_TRADE_COMP_MISSING_REASON === "Missing approved trade/barter valuation");

// remaining gates still enforced (after the link is proven)
ok("unapproved valuation -> TRADE_COMP_NOT_APPROVED", (checkExpenseTradeCreditApplicable({ ...comp, approvedAt: null }, ctxOk) as any).code === "TRADE_COMP_NOT_APPROVED");
ok("non-FMV valuation -> TRADE_COMP_NOT_FMV", (checkExpenseTradeCreditApplicable({ ...comp, valuationMethod: "cost_basis" }, ctxOk) as any).code === "TRADE_COMP_NOT_FMV");
ok("already linked to a contractor payment -> TRADE_COMP_ALREADY_LINKED", (checkExpenseTradeCreditApplicable({ ...comp, contractorPaymentId: "cp9" }, ctxOk) as any).code === "TRADE_COMP_ALREADY_LINKED");
ok("already linked to an expense payment -> TRADE_COMP_ALREADY_LINKED", (checkExpenseTradeCreditApplicable({ ...comp, expensePaymentId: "ep9" }, ctxOk) as any).code === "TRADE_COMP_ALREADY_LINKED");
ok("payment exceeds the approved value -> TRADE_COMP_VALUE_INSUFFICIENT", (checkExpenseTradeCreditApplicable(comp, { ...ctxOk, paymentCents: 60000 }) as any).code === "TRADE_COMP_VALUE_INSUFFICIENT");

// the link helper in isolation
ok("expenseTradeCompLinked: worker-id match", expenseTradeCompLinked({ contractorUserId: "w1" }, { expensePayeeWorkerId: "w1" }));
ok("expenseTradeCompLinked: name match (normalized)", expenseTradeCompLinked({ contractorUserId: "w1" }, { expensePayeeName: "  Jane   Contractor ", compContractorName: "jane contractor" }));
ok("expenseTradeCompLinked: no link -> false", !expenseTradeCompLinked({ contractorUserId: "w1" }, { expensePayeeWorkerId: "w2", expensePayeeName: "X", compContractorName: "Y" }));
ok("expenseTradeCompLinked: empty names never match", !expenseTradeCompLinked({ contractorUserId: "w1" }, { expensePayeeName: "", compContractorName: "" }));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
