/**
 * Release B2 — vendor/expense Cut Check pure-logic tests.
 * Run: npx tsx tests/expense-payments.test.ts   (no DB, no network)
 */
import assert from "node:assert/strict";
import {
  EXPENSE_PAYMENT_METHOD, EXPENSE_VOID_STOP_PAYMENT_NOTE,
  recomputeExpensePaymentStatus, expensePaymentFingerprint, checkExpenseEligibility,
  toCents, fromCents, checkPaymentAmount, requireIdempotencyKey,
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

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
