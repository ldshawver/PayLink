/**
 * v2.2.11 bugfix — inline "record + approve a trade/barter valuation" in the
 * contractor-invoice and expense/AP payment modals.
 *
 * Bug: both modals offered a "trade_credit" method whose valuation dropdown reads
 * contractor_trade_compensation, a table with NO creation UI. The empty-state
 * linked users to /app/trade-compensation, which writes the unrelated
 * trade_transactions table — so a trade/barter payment always dead-ended.
 *
 * Fix: an inline create-and-approve affordance in each payment modal, scoped to
 * that payment's company + contractor/payee, using the existing
 * POST /api/contractor-trade-compensation (+ /:id/approve) routes. No schema
 * change. Server-side eligibility (checkTradeCreditApplicable /
 * checkExpenseTradeCreditApplicable) is unchanged and still enforced — its matrix
 * is covered behaviourally in contractor-payments.test.ts / expense-payments.test.ts.
 *
 * Run: npx tsx tests/inline-trade-valuation-wiring-static.test.ts   (no DB, no network)
 */
import fs from "node:fs";

const hub = fs.readFileSync("client/src/pages/contractor-hub.tsx", "utf8");
const expenses = fs.readFileSync("client/src/pages/expenses.tsx", "utf8");
const routes = fs.readFileSync("server/routes.ts", "utf8");

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
};

console.log("=== v2.2.11 — inline trade/barter valuation wiring (static) ===\n");

// -- the create + approve routes the UI depends on still exist -------------
ok("POST /api/contractor-trade-compensation exists (admin/manager)",
  /app\.post\("\/api\/contractor-trade-compensation", requireAuth, requireRole\("admin", "manager"\)/.test(routes));
ok("POST /api/contractor-trade-compensation/:id/approve exists (admin/manager)",
  /app\.post\("\/api\/contractor-trade-compensation\/:id\/approve", requireAuth, requireRole\("admin", "manager"\)/.test(routes));
ok("create route computes totalValue = quantity * unitValue server-side",
  routes.includes("const totalValue = (Number(req.body.quantity || 0) * Number(req.body.unitValue || 0)).toFixed(2);"));
ok("create route enforces company/tenant isolation via canAccessCompany",
  /\/api\/contractor-trade-compensation"[\s\S]{0,600}?canAccessCompany\(user!, companyId\)/.test(routes));
ok("approve route re-checks company access before approving",
  /\/approve"[\s\S]{0,700}?canAccessCompany\(user!, credit\.companyId\)/.test(routes));

// -- contractor-invoice payment modal --------------------------------------
ok("hub: inline create posts to the trade-compensation create route",
  hub.includes('await apiRequest("POST", "/api/contractor-trade-compensation", {'));
ok("hub: inline create then approves the new valuation",
  hub.includes('await apiRequest("POST", `/api/contractor-trade-compensation/${created.id}/approve`, {})'));
ok("hub: new valuation is scoped to THIS invoice's company + contractor (payee)",
  /handleCreateValuation[\s\S]{0,900}?companyId: invoice\.companyId,\s*\n\s*contractorUserId: invoice\.contractorId,/.test(hub));
ok("hub: inline create hard-codes fair_market_value valuation",
  /handleCreateValuation[\s\S]{0,900}?valuationMethod: "fair_market_value",/.test(hub));
ok("hub: inline create sends a fresh idempotency key",
  /handleCreateValuation[\s\S]{0,900}?const idempotencyKey = crypto\.randomUUID\(\);/.test(hub));
ok("hub: after create it invalidates + refetches the dropdown and selects the new id",
  /handleCreateValuation[\s\S]{0,1200}?invalidateQueries\(\{ queryKey: \["\/api\/contractor-trade-compensation"\] \}\)[\s\S]{0,300}?refetchTradeComps\(\)[\s\S]{0,200}?setPayTradeCompId\(created\.id\)/.test(hub));
ok("hub: guards create on a valid item + positive amount",
  hub.includes("const newValValid = newVal.itemName.trim().length > 0 && parseFloat(newVal.amount) > 0;") &&
  hub.includes('data-testid="btn-create-valuation"') &&
  /disabled=\{creatingVal \|\| !newValValid\}/.test(hub));

ok("hub: dropdown filter is strict — invoice contractor MUST match, no bypass, no dead field",
  hub.includes("!!invoice.contractorId && t.contractorUserId === invoice.contractorId") &&
  !hub.includes("!invoice.contractorId || t.contractorUserId === invoice.contractorId || t.contractorId === invoice.contractorId"));
ok("hub: dropdown still requires approved + FMV + unused-by-both-ledgers",
  hub.includes("t.approvedAt && !t.contractorPaymentId && !t.expensePaymentId &&") &&
  hub.includes('String(t.valuationMethod || "").toLowerCase() === "fair_market_value" &&'));
ok("hub: Record Payment stays disabled until a valuation is selected for trade_credit",
  hub.includes('(payMethod === "trade_credit" && !payTradeCompId)'));
ok("hub: the misleading 'Create one in Trade Compensation' link is gone from the payment modal",
  !/No approved valuation[\s\S]{0,200}?href="\/app\/trade-compensation"/.test(hub) &&
  !hub.includes('Requires an approved fair-market-value valuation. <a href="/app/trade-compensation"'));

// -- expense / AP payment modal ------------------------------------------
ok("expenses: inline create posts to the trade-compensation create route",
  expenses.includes('await apiRequest("POST", "/api/contractor-trade-compensation", {'));
ok("expenses: inline create then approves the new valuation",
  expenses.includes('await apiRequest("POST", `/api/contractor-trade-compensation/${created.id}/approve`, {})'));
ok("expenses: new valuation is scoped to the expense's company + submitter (payee worker)",
  /handleCreateExpenseValuation[\s\S]{0,900}?companyId: recordPayTarget\.companyId,\s*\n\s*contractorUserId: recordPayTarget\.submitterId,/.test(expenses));
ok("expenses: inline create hard-codes fair_market_value valuation",
  /handleCreateExpenseValuation[\s\S]{0,900}?valuationMethod: "fair_market_value",/.test(expenses));
ok("expenses: inline create only offered when the expense has a worker submitter to anchor to",
  expenses.includes("const canInlineValuation = !!recordPayTarget?.companyId && !!recordPayTarget?.submitterId;") &&
  /showNewExpenseValuation && canInlineValuation && \(/.test(expenses));
ok("expenses: after create it invalidates + refetches + selects the new id",
  /handleCreateExpenseValuation[\s\S]{0,1300}?invalidateQueries\(\{ queryKey: \["\/api\/contractor-trade-compensation"\] \}\)[\s\S]{0,300}?refetchRecordPayTradeComps\(\)[\s\S]{0,260}?tradeCompensationId: created\.id/.test(expenses));
ok("expenses: dropdown filter still strict on the submitter worker id",
  expenses.includes("!!payeeWorkerId && t.contractorUserId === payeeWorkerId"));
ok("expenses: submit stays disabled until a valuation is chosen for trade_credit",
  expenses.includes("(recordPayForm.method === \"trade_credit\" && !recordPayForm.tradeCompensationId)"));
ok("expenses: the misleading 'Create one in Trade Compensation' link is gone from the payment modal",
  !expenses.includes('Create one in <Link href="/app/trade-compensation"') &&
  !expenses.includes('Missing approved trade/barter valuation. Create one in'));
ok("expenses: unused wouter Link import removed",
  !expenses.includes('import { Link } from "wouter";'));

// -- the Trade Compensation (trade_transactions) page link is untouched
//    OUTSIDE the payment modals (it is still the right place for 1099 barter
//    tracking, just not an eligible payment-valuation source) -----------------
ok("hub: TradeSection still links to /app/trade-compensation for 1099 barter tracking",
  hub.includes('data-testid="link-open-trade-comp"'));

// -- no scope creep -------------------------------------------------------
ok("fix does not touch trade_transactions routes or 1099 logic",
  !/(INSERT INTO trade_transactions|UPDATE trade_transactions|calculate1099Summary)/.test(
    hub + expenses));
ok("fix adds no migration / schema change",
  !fs.existsSync("migrations/0025_inline_trade_valuation.sql"));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
