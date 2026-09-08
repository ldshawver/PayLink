/**
 * Release B — 1099 / tax-ledger boundary regression.
 * Run: npx tsx tests/contractor-payments-1099-unchanged.test.ts
 *
 * Release B changes how contractor-invoice PAYMENTS are recorded. It must not
 * silently change 1099-NEC output. calculate1099Summary / generateAll1099Summaries
 * (server/storage.ts) read contractor_invoices (status='paid', is_1099_reportable)
 * and trade_transactions — NOT contractor_payments or contractor_trade_compensation.
 * This pins those function bodies and asserts Release B's code touches neither the
 * 1099 aggregation nor trade_transactions nor the reporting threshold.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

const storage = fs.readFileSync("server/storage.ts", "utf8").split("\n");
const routes = fs.readFileSync("server/routes.ts", "utf8");
const mod = fs.readFileSync("server/contractor-payments.ts", "utf8");
const migration = fs.readFileSync("migrations/0016_contractor_payment_lifecycle.sql", "utf8");

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}`); } };

console.log("=== Release B — 1099 / tax-ledger boundary (regression) ===\n");

function fnBody(startsWith: string): string {
  const si = storage.findIndex((l) => l.includes(startsWith));
  assert.ok(si >= 0, `not found: ${startsWith}`);
  let depth = 0, started = false;
  const buf: string[] = [];
  for (let i = si; i < storage.length; i++) {
    buf.push(storage[i]);
    for (const c of storage[i]) {
      if (c === "{") { depth++; started = true; }
      else if (c === "}") depth--;
    }
    if (started && depth === 0) return buf.join("\n");
  }
  throw new Error(`unterminated: ${startsWith}`);
}
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

ok("calculate1099Summary body is byte-for-byte unchanged",
  sha(fnBody("async calculate1099Summary(")) === "b689f6aa257a8af76e199cd348c7942ac34b69881fc412b2d2ddfcb49b293140");
ok("generateAll1099Summaries body is byte-for-byte unchanged",
  sha(fnBody("async generateAll1099Summaries(")) === "409a96a7fc6881ce6f7e81a84bb69bef0a65cedc5af26dbc9901bb1dae50f876");

ok("1099 summary still reads contractor_invoices status='paid' + is1099Reportable (not contractor_payments)",
  fnBody("async calculate1099Summary(").includes("eq(contractorInvoices.is1099Reportable, true)") &&
  fnBody("async calculate1099Summary(").includes('eq(contractorInvoices.status, "paid")') &&
  !fnBody("async calculate1099Summary(").includes("contractor_payments") &&
  !fnBody("async calculate1099Summary(").includes("contractorPayments"));

// Release B's new code / migration must not touch the tax path.
const releaseBCode = mod + "\n" + migration + "\n" + (routes.split("// ── Contractor-payment lifecycle helpers (Release B)")[1]?.split("// GET /api/contractor-invoices/:id/payments")[0] ?? "");
ok("Release B code does not write trade_transactions",
  !/(INSERT INTO trade_transactions|UPDATE trade_transactions|db\.insert\(tradeTransactions\))/.test(releaseBCode));
ok("Release B code does not reference calculate1099Summary / generateAll1099Summaries",
  !/(calculate1099Summary|generateAll1099Summaries|1099-summaries\/generate)/.test(releaseBCode));
ok("Release B code does not touch the $600 / meetsThreshold reporting rule",
  !/(meetsThreshold|>= 600|threshold: "600")/.test(releaseBCode));
ok("contractor_trade_compensation.included_in_1099 default is untouched (still TRUE)",
  fs.readFileSync("shared/schema.ts", "utf8").includes('includedIn1099: boolean("included_in_1099").notNull().default(true)') &&
  !migration.toLowerCase().includes("included_in_1099"));
ok("migration does not alter contractor_invoices status/is_1099_reportable/amount columns",
  !/contractor_invoices\s+(ADD COLUMN|ALTER COLUMN|DROP COLUMN)/i.test(migration));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
