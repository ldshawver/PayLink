/**
 * Release B2 — contractor-payment / payroll / 1099 boundary regression.
 * Run: npx tsx tests/vendor-expense-cut-check-boundary.test.ts
 *
 * B2 adds a NEW expense_payments ledger for vendor/expense checks. It must not
 * change: the contractor-payment ledger, contractor cut-check, payroll, or any
 * 1099 aggregation. This pins the untouched function bodies and asserts the B2
 * route block / migration / module reference none of them.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

const storageLines = fs.readFileSync("server/storage.ts", "utf8").split("\n");
const routes = fs.readFileSync("server/routes.ts", "utf8");
const mod = fs.readFileSync("server/expense-payments.ts", "utf8");
const migration = fs.readFileSync("migrations/0017_expense_payments.sql", "utf8");
const contractorMod = fs.readFileSync("server/contractor-payments.ts", "utf8");

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}`); } };

console.log("=== Release B2 — contractor/payroll/1099 boundary (regression) ===\n");

function fnBody(startsWith: string): string {
  const si = storageLines.findIndex((l) => l.includes(startsWith));
  assert.ok(si >= 0, `not found: ${startsWith}`);
  let depth = 0, started = false;
  const buf: string[] = [];
  for (let i = si; i < storageLines.length; i++) {
    buf.push(storageLines[i]);
    for (const c of storageLines[i]) {
      if (c === "{") { depth++; started = true; }
      else if (c === "}") depth--;
    }
    if (started && depth === 0) return buf.join("\n");
  }
  throw new Error(`unterminated: ${startsWith}`);
}
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

// The B2 route block only.
const b2 = routes.slice(
  routes.indexOf("Expense payment lifecycle helpers (Release B2)"),
  routes.indexOf("CONTRACTOR INVOICE MODULE"),
);
assert.ok(b2.length > 3000, "B2 route block not isolated");
const b2andMig = `${b2}\n${mod}\n${migration}`;

// ── 1099 aggregation is byte-for-byte unchanged ────────────────────
ok("calculate1099Summary body unchanged (same hash as Release B pin)",
  sha(fnBody("async calculate1099Summary(")) === "b689f6aa257a8af76e199cd348c7942ac34b69881fc412b2d2ddfcb49b293140");
ok("generateAll1099Summaries body unchanged (same hash as Release B pin)",
  sha(fnBody("async generateAll1099Summaries(")) === "409a96a7fc6881ce6f7e81a84bb69bef0a65cedc5af26dbc9901bb1dae50f876");

// ── B2 does not reach into the tax / payroll path ─────────────────
ok("B2 code never references calculate1099Summary / generateAll1099Summaries / 1099-summaries",
  !/(calculate1099Summary|generateAll1099Summaries|1099-summaries|is1099Reportable|is_1099_reportable)/.test(b2andMig));
ok("B2 code never writes trade_transactions",
  !/(INSERT INTO trade_transactions|UPDATE trade_transactions|tradeTransactions)/.test(b2andMig));
ok("B2 code never touches the $600 / meetsThreshold reporting rule",
  !/(meetsThreshold|>= ?600|threshold)/.test(b2andMig));
ok("B2 code touches no payroll run / YTD / withholding path",
  !/(payroll_run|payrollRun|calculatePayroll|payrollCalculator|ytd|YTD|withhold)/.test(b2andMig));

// ── contractor ledger untouched by B2 ────────────────────────────
ok("B2 never inserts / updates contractor_payments or contractor_invoices",
  !/(INSERT INTO contractor_payments|UPDATE contractor_payments|INSERT INTO contractor_invoices|UPDATE contractor_invoices)/.test(b2));
ok("the contractor cut-check route still exists and still writes contractor_payments",
  routes.includes('app.post("/api/contractor-invoices/:id/cut-check"') &&
  /contractor-invoices\/:id\/cut-check[\s\S]{0,7000}?INSERT INTO contractor_payments/.test(routes));
// B2 itself did not touch this module. The combined MyPayLink payment-usability
// release adds ONE audited cross-ledger reference: the FMV trade/barter valuation
// is "used exactly once" across BOTH the contractor and the expense ledgers, so
// checkTradeCreditApplicable must also reject a valuation already bound to an
// expense payment (comp.expensePaymentId). No expense-ledger WRITES and no
// expense check-issuance logic may live here.
ok("server/contractor-payments.ts holds no expense-ledger writes / no expense check-issuance logic",
  !/expense_payments\b|INSERT INTO expense|EXPENSE_PAYMENT_METHOD|checkExpenseEligibility|cut-check/.test(contractorMod));
ok("the one allowed cross-ledger reference is the FMV valuation's exactly-once guard (comp.expensePaymentId)",
  /comp\.contractorPaymentId \|\| comp\.expensePaymentId/.test(contractorMod));
ok("migration 0017 does not ALTER any contractor / payroll / 1099 table",
  !/(contractor_payments|contractor_invoices|contractor_trade_compensation|payroll|trade_transactions)/i.test(migration));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
