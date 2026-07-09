import assert from "node:assert/strict";
import fs from "node:fs";
import { calculateContractorTradeSettlement, assertContractorTradeCreditsPrintable } from "../server/contractor-trade-compensation";

const settlement = calculateContractorTradeSettlement({
  grossCompensation: 4250,
  tradeCredits: [{ totalValue: 3000, approvedAt: new Date() }],
});
assert.equal(settlement.totalCompensation, 4250, "gross contractor compensation is preserved as total compensation");
assert.equal(settlement.paidByTradeGoods, 3000, "trade goods credit is tracked separately");
assert.equal(settlement.paidByCheck, 1250, "check amount equals gross minus approved trade credit");
assert.equal(settlement.remainingBalance, 0, "remaining balance is zero when gross equals goods plus check");

assert.throws(
  () => calculateContractorTradeSettlement({ grossCompensation: 1000, tradeCredits: [{ totalValue: 1001, approvedAt: new Date() }] }),
  /cannot exceed gross contractor compensation/i,
  "negative contractor check amount / over-credit is blocked by default",
);
assert.throws(
  () => assertContractorTradeCreditsPrintable({ grossCompensation: 1000, tradeCredits: [{ totalValue: 100 }] }),
  /approved before contractor check printing/i,
  "unapproved trade credit blocks check printing",
);

const routes = fs.readFileSync("server/routes.ts", "utf8");
assert(routes.includes("isIndependentContractorWorker(worker)"), "contractor behavior is gated by Independent Contractor worker-group helper");
assert(routes.includes('"hourly_contractor"') && routes.includes('"invoiced_contractor"'), "Independent Contractor security groups are recognized");
assert(routes.includes("CONTRACTOR STATEMENT"), "contractor PDF/check panel is labeled Contractor Statement");
assert(routes.includes("TRADE COMPENSATION - GOODS"), "contractor statement includes trade goods credit detail");
assert(routes.includes("CASH PAYMENT / CHECK AMOUNT"), "contractor statement labels cash/check remainder explicitly");
assert(routes.includes("trade_credit_print_blocked"), "unapproved/invalid trade credits are audit logged when printing is blocked");
assert(routes.includes('app.get("/api/my/paystubs/:id/pdf"'), "contractor can download own statement PDF endpoint");
assert(routes.includes("itemRow.workerId !== user.workerId"), "self-service download requires the worker to own the statement");
assert(routes.includes("user.companyId && runRow.company_id && user.companyId !== runRow.company_id"), "self-service download enforces company isolation");
assert(routes.includes("canAccessCompany(user!, companyId)"), "trade credit APIs use canAccessCompany for tenant/company isolation");
assert(routes.includes('isContractor ? "NET PAY"') === false, "contractor label changes are conditional and do not replace employee NET PAY label globally");

const myProfile = fs.readFileSync("client/src/pages/my-profile.tsx", "utf8");
assert(myProfile.includes("Contractor Statements"), "My Workspace/My Profile shows Contractor Statements for contractors");
assert(myProfile.includes("hourly_contractor") && myProfile.includes("invoiced_contractor"), "UI contractor labels are gated by Independent Contractor groups");
assert(myProfile.includes("button-download-statement"), "statement download button is exposed to the worker");

const migration = fs.readFileSync("migrations/0013_contractor_trade_compensation.sql", "utf8");
assert(migration.includes("CREATE TABLE IF NOT EXISTS contractor_trade_compensation"), "trade compensation migration is additive and idempotent");
assert(migration.includes("CREATE INDEX IF NOT EXISTS"), "trade compensation indexes are idempotent");
assert(!/\b(DROP|TRUNCATE|DELETE\s+FROM|ALTER\s+TABLE\s+[^;]+\s+DROP|RENAME)\b/i.test(migration), "migration 0013 contains no destructive statements");
assert(migration.includes("contractor_statement_id") && migration.includes("settlement_id"), "trade credits are decoupled from payroll item by preferred statement/settlement references");
assert(migration.includes("included_in_1099 BOOLEAN NOT NULL DEFAULT TRUE"), "1099 inclusion default is represented in migration");

const docs = fs.readFileSync("docs/contractor-trade-compensation.md", "utf8");
assert(docs.includes("Do not merge or deploy") && docs.includes("isolated staging"), "production merge is blocked pending isolated staging validation");
assert(docs.includes("1099 treatment") && docs.includes("included_in_1099"), "1099 treatment is documented");
assert(docs.includes("Rollback plan for migration 0013"), "migration rollback plan is documented");
assert(docs.includes("MICR"), "MICR/check layout validation requirement is documented");

console.log("PASS: contractor trade compensation static checks passed");
