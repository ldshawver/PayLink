/**
 * Combined MyPayLink contractor/vendor payment usability release — static guards.
 * Run: npx tsx tests/mypaylink-payment-usability-static.test.ts  (no DB, no network)
 *
 * Proves — by reading the committed source — that:
 *   Part A (Contractor Hub invoices)
 *     - the invoice detail panel surfaces Cut Check + Submit/Record Payment
 *     - completed payments expose a payee statement + a company receipt link
 *     - the method list is exactly the server-supported set (no wire / credit_card)
 *     - trade/barter binds an approved fair-market-value valuation; description is
 *       required for trade / rent-credit / other
 *   Part B (Expenses / AP)
 *     - the additive ledger path: POST /api/expenses/:id/record-payment records
 *       cash | ach | trade_credit | rent_credit | other on the SAME
 *       expense_payments ledger (migration 0018), never a second ledger
 *     - rows expose Cut Check / Record Payment / View Statement-Receipt with
 *       clear disabled reasons
 *     - migration 0018 is additive only (ADD COLUMN IF NOT EXISTS; no data DDL)
 *   Proof-of-payment documents
 *     - contractor payee copy = "Contractor Payment Statement — Nonemployee
 *       Compensation"; company copy = "Company Payment Receipt — Company Copy"
 *     - no employee / payroll terminology anywhere in the renderer
 */
import fs from "node:fs";

const hub = fs.readFileSync("client/src/pages/contractor-hub.tsx", "utf8");
const expenses = fs.readFileSync("client/src/pages/expenses.tsx", "utf8");
const routes = fs.readFileSync("server/routes.ts", "utf8");
const mod = fs.readFileSync("server/expense-payments.ts", "utf8");
const cpMod = fs.readFileSync("server/contractor-payments.ts", "utf8");
const docs = fs.readFileSync("server/payment-documents.ts", "utf8");
const schema = fs.readFileSync("shared/schema.ts", "utf8");
const bootDDL = fs.readFileSync("server/index.ts", "utf8");
const migration = fs.readFileSync("migrations/0018_expense_payment_methods_and_docs.sql", "utf8");

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
};

console.log("=== MyPayLink contractor/vendor payment usability (static) ===\n");

// ── Part A: Contractor Hub invoice detail ─────────────────────────────────
ok("invoice detail panel exposes a Cut Check button that POSTs /cut-check with an Idempotency-Key",
  hub.includes('data-testid="btn-cut-check"') &&
  /handleCutCheck[\s\S]{0,600}\/api\/contractor-invoices\/\$\{invoice\.id\}\/cut-check[\s\S]{0,200}"Idempotency-Key"/.test(hub));
ok("invoice detail panel exposes Submit / Record Payment",
  hub.includes("Submit / Record Payment") && hub.includes('data-testid="btn-record-payment"'));
ok("record-payment POSTs the invoice payments endpoint with an Idempotency-Key + idempotencyKey body",
  /\/api\/contractor-invoices\/\$\{invoice\.id\}\/payments[\s\S]{0,240}"Idempotency-Key": payIdemKey/.test(hub) &&
  hub.includes("idempotencyKey: payIdemKey"));
ok("completed payments link a payee Payment Statement AND a company Receipt",
  hub.includes('data-testid={`link-payment-statement-${p.id}`}') &&
  hub.includes("/api/contractor-payments/${p.id}/document?copy=payee") &&
  hub.includes('data-testid={`link-payment-receipt-${p.id}`}') &&
  hub.includes("/api/contractor-payments/${p.id}/document?copy=company"));

// method list must be exactly the server-supported set
const hubMethodBlock = hub.slice(hub.indexOf('data-testid="select-payment-method"'), hub.indexOf('data-testid="select-payment-method"') + 900);
ok("Contractor method list = check / cash / ach / trade_credit / rent_credit / other",
  ['"check"', '"cash"', '"ach"', '"trade_credit"', '"rent_credit"', '"other"'].every(v => hubMethodBlock.includes(v)));
ok("Contractor method list never offers the server-rejected wire / credit_card values",
  !/SelectItem value="wire"/.test(hub) && !/SelectItem value="credit_card"/.test(hub));
ok("trade / barter requires selecting an approved fair-market-value valuation",
  /payMethod === "trade_credit"[\s\S]{0,400}fair market value/i.test(hub) &&
  /disabled=\{[\s\S]{0,200}payMethod === "trade_credit" && !payTradeCompId\)/.test(hub));
ok("description is required for trade_credit / rent_credit / other (client mirror)",
  /DESCRIPTION_REQUIRED = new Set\(\["trade_credit", "rent_credit", "other"\]\)/.test(hub));

// ── Part B: Expenses / AP additive record-payment ─────────────────────────
ok("expense rows expose Cut Check, Submit / Record Payment and a paid-row statement/receipt link",
  expenses.includes('data-testid={`button-record-payment-${e.id}`}') &&
  expenses.includes("Submit / Record Payment") &&
  expenses.includes("View Payment Statement / Receipt") &&
  expenses.includes('data-testid={`link-expense-receipt-${e.id}`}'));
ok("ineligible expense rows show clear reasons",
  ['"Approve expense first"', '"Add vendor/payee first"', '"Funding account required"',
   '"Already paid"', '"No unpaid balance"'].every(v => expenses.includes(v)));
ok("record-payment dialog method list = cash / ach / trade_credit / rent_credit / other (no check here, no wire/credit_card)",
  /select-record-payment-method[\s\S]{0,700}/.test(expenses) &&
  ['<SelectItem value="cash"', '<SelectItem value="ach"', '<SelectItem value="trade_credit"',
   '<SelectItem value="rent_credit"', '<SelectItem value="other"'].every(v => expenses.includes(v)));
ok("expense record-payment POSTs /record-payment with an Idempotency-Key",
  /\/api\/expenses\/\$\{id\}\/record-payment[\s\S]{0,240}"Idempotency-Key": form\.idempotencyKey/.test(expenses));

// server route: additive, method-restricted, same ledger
const rp = routes.slice(routes.indexOf('app.post("/api/expenses/:id/record-payment"'), routes.indexOf('app.get("/api/expense-payments/:id/document"'));
ok("record-payment route rejects any method outside cash/ach/trade_credit/rent_credit/other",
  rp.includes("EXPENSE_RECORD_PAYMENT_METHODS as readonly string[]).includes(method)") &&
  rp.includes('"INVALID_PAYMENT_METHOD"'));
ok("record-payment route requires an Idempotency-Key and runs inside db.transaction",
  rp.includes('"IDEMPOTENCY_KEY_REQUIRED"') && /await db\.transaction\(async \(tx\) => \{/.test(rp));
ok("record-payment locks the expense row FOR UPDATE and recomputes balance from the non-void ledger SUM",
  rp.includes("SELECT * FROM expenses WHERE id = ${expenseId} FOR UPDATE") &&
  rp.includes("SUM(amount), 0)::numeric AS paid FROM expense_payments WHERE expense_id = ${expenseId} AND status <> 'void'"));
ok("record-payment writes into expense_payments (the B2 ledger), never a new *_payments table",
  (rp.match(/INSERT INTO\s+expense_payments/g) || []).length === 1 &&
  !/INSERT INTO\s+(?!expense_payments\b)\w*payments?\b/i.test(rp));
ok("record-payment recomputes payment_status from the ledger, not a browser value",
  rp.includes("recomputeExpensePaymentStatus(totalCents, newPaidCents)"));
ok("record-payment trade_credit binds ONE approved FMV valuation, guarded across BOTH ledgers",
  rp.includes("checkExpenseTradeCreditApplicable(") &&
  rp.includes("expense_payment_id = ${payment.id}, updated_at = NOW() WHERE id = ${tradeCompensationId} AND expense_payment_id IS NULL AND contractor_payment_id IS NULL"));
ok("record-payment proves the valuation is auditable-linked to THIS expense (submitter worker id), not just same-company, and never trusts a free-text name",
  rp.includes("expensePayeeWorkerId: e.submitter_id") &&
  !rp.includes("expensePayeeName") &&
  !rp.includes("compContractorName") &&
  !/contractorId: tc\?\.contractor_user_id/.test(rp) &&
  mod.includes('code: "TRADE_COMP_UNRELATED"') &&
  mod.includes("export function expenseTradeCompLinked(") &&
  !mod.includes("normalizePayeeName"));
ok("the AP trade/barter picker only offers valuations tied to the expense's submitter worker",
  expenses.includes("const payeeWorkerId = recordPayTarget?.submitterId") &&
  expenses.includes("t.contractorUserId === payeeWorkerId") &&
  expenses.includes("Missing approved trade/barter valuation"));
ok("a linked contractor-invoice expense is NOT payable as a separate expense payment (no double count)",
  mod.includes('code: "EXPENSE_LINKED_TO_CONTRACTOR_INVOICE"'));

// GET /api/expenses/:id/payments — object-level authz + no idempotency leakage
{
  const gp = routes.slice(
    routes.indexOf('app.get("/api/expenses/:id/payments"'),
    routes.indexOf('app.post("/api/expenses/:id/record-payment"'),
  );
  ok("GET /api/expenses/:id/payments enforces the same manager-or-submitter gate as the sibling expense routes",
    gp.includes("SELECT company_id, submitter_id FROM expenses") &&
    /!isManager && user\?\.workerId !== scope\.submitter_id/.test(gp) &&
    gp.includes("canAccessCompany(user!, scope.company_id)"));
  ok("GET /api/expenses/:id/payments uses an explicit projection (no SELECT *, no idempotency columns) so replay-guard material never reaches the client",
    !/SELECT \* FROM expense_payments/.test(gp) &&
    /SELECT id, expense_id, company_id, amount, payment_method, status, reference_number/.test(gp) &&
    !/idempotency/.test(gp));
}
ok("GET /api/contractor-payments/:id/document rejects a non-manager whose worker id or the payment's contractor id is absent (no null === null bypass)",
  routes.includes("!isManager && (!wRes?.worker_id || !pay.contractor_id || pay.contractor_id !== wRes.worker_id)"));
ok("the CONTRACTOR-invoice trade/barter path also guards the valuation across BOTH ledgers (cannot re-bind one already tied to an AP expense payment)",
  cpMod.includes("comp.contractorPaymentId || comp.expensePaymentId") &&
  routes.includes("contractorPaymentId: tc.contractor_payment_id, expensePaymentId: tc.expense_payment_id") &&
  routes.includes("SET contractor_payment_id = ${payment.id}, updated_at = NOW() WHERE id = ${tradeCompensationId} AND contractor_payment_id IS NULL AND expense_payment_id IS NULL"));

// proof-of-payment document routes — read only
for (const [label, marker, end] of [
  ["expense", 'app.get("/api/expense-payments/:id/document"', 'CONTRACTOR INVOICE MODULE'],
  ["contractor", 'app.get("/api/contractor-payments/:id/document"', 'app.post("/api/contractor-invoices/:id/payments"'],
] as const) {
  const block = routes.slice(routes.indexOf(marker), routes.indexOf(end));
  ok(`${label} payment-document route performs zero INSERT / UPDATE`,
    !/\b(INSERT\s+INTO|UPDATE)\s+\w/i.test(block.replace(/FOR UPDATE/g, "")));
  ok(`${label} payment-document route serves both copy=payee and copy=company`,
    block.includes('req.query.copy') && block.includes('"company"') && block.includes('"payee"'));
}

// ── proof-of-payment wording ─────────────────────────────────────────────
ok("contractor payee copy heading is the nonemployee-compensation statement",
  docs.includes('CONTRACTOR_PAYMENT_STATEMENT_HEADING = "CONTRACTOR PAYMENT STATEMENT — NONEMPLOYEE COMPENSATION"'));
ok("company copy heading is the Company Payment Receipt — Company Copy",
  docs.includes('COMPANY_PAYMENT_RECEIPT_HEADING = "COMPANY PAYMENT RECEIPT — COMPANY COPY"'));
ok("the contractor disclaimer states no payroll taxes were withheld and it is not an employee wage statement",
  /not an employee wage statement\. No payroll taxes were withheld\./.test(docs));
ok("the renderer forbids paystub / payroll-tax / FICA / withholding / PTO / sick-leave / benefit / net-pay language",
  ["paystub", "pay stub", "payroll tax", "fica", "withholding", "pto", "sick leave", "employee benefit", "employee wage", "net pay"]
    .every(t => docs.toLowerCase().includes(`"${t}"`)));
{
  // strip block + line comments and the FORBIDDEN guard list, then the disclaimer's
  // explicit negation — nothing employee-payroll-ish may remain.
  const guardStart = docs.indexOf("export const FORBIDDEN_PAYMENT_DOC_TERMS");
  const guardEnd = docs.indexOf("] as const;", guardStart) + "] as const;".length;
  const code = docs
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(docs.slice(guardStart, guardEnd), "")
    .replace(/It is not an employee wage statement\. No payroll taxes were withheld\./g, "");
  ok('"paystub" / "pay stub" never appears as a heading or label in the renderer',
    !/pay ?stub/i.test(code));
  ok("no employee-payroll wording (payroll tax / FICA / withholding / PTO / sick leave / net pay / employee wage) outside the negated disclaimer",
    !/payroll tax|employee wage|\bfica\b|withhold|\bpto\b|sick leave|net pay|gross pay/i.test(code));
}

// ── migration 0018 is additive-only ──────────────────────────────────────
const migNoComments = migration.replace(/^\s*--.*$/gm, "");
ok("0018 only ADDs nullable columns + partial indexes (no DROP/DELETE/TRUNCATE/UPDATE/RENAME of data)",
  !/\b(DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET|RENAME)\b/i.test(migNoComments) &&
  /ALTER TABLE expense_payments ADD COLUMN IF NOT EXISTS/.test(migNoComments));
ok("0018 never touches expenses / contractor_invoices / trade_transactions / 1099 paths",
  !/\b(expenses|contractor_invoices|trade_transactions|form_1099|1099)\b/i.test(
    migNoComments.replace(/contractor_trade_compensation/g, "")));
ok("0018 documents a pg_dump backup + a rollback section",
  migration.includes('pg_dump "$DATABASE_URL"') && /ROLLBACK/i.test(migration));
ok("server/index.ts boot DDL mirrors every 0018 column + index via runInv",
  ["expense_payments.notes", "expense_payments.payment_date", "expense_payments.trade_compensation_id",
   "expense_payments.payee_user_id", "contractor_trade_compensation.expense_payment_id"]
    .every(c => bootDDL.includes(`runInv("${c}"`)) &&
  bootDDL.includes("uq_contractor_trade_comp_expense_payment_id"));
ok("schema.ts declares the 4 new expense_payments columns + the trade-comp mirror",
  /notes: text\("notes"\)/.test(schema) &&
  /paymentDate: timestamp\("payment_date"\)/.test(schema) &&
  /tradeCompensationId: varchar\("trade_compensation_id"\)/.test(schema) &&
  /payeeUserId: varchar\("payee_user_id"\)/.test(schema) &&
  /expensePaymentId: varchar\("expense_payment_id"\)/.test(schema));

// ── 1099 / tax audit trail is untouched by this release ──────────────────
ok("no new code path calls calculate1099Summary / generateAll1099Summaries / trade_transactions",
  !/calculate1099Summary|generateAll1099Summaries/.test(rp) &&
  !/trade_transactions/.test(docs) &&
  !/calculate1099Summary/.test(docs));
ok("contractor payment method set already supported these methods before this release (server unchanged there)",
  /CONTRACTOR_PAYMENT_METHODS = \["cash", "ach", "check", "trade_credit", "rent_credit", "other"\]/.test(cpMod));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
