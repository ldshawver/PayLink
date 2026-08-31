/**
 * Release B2 — vendor/expense Cut Check static guards.
 * Run: npx tsx tests/vendor-expense-cut-check-static.test.ts
 *
 * Proves — by reading the committed source — that B2 is the smallest complete
 * change: additive migration, atomic issuance, preview/reprint with zero
 * financial writes, idempotency exactly-once, void/reissue that never delete
 * history, no contractor-payment / payroll / 1099 changes.
 */
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const bootDDL = fs.readFileSync("server/index.ts", "utf8");
const schema = fs.readFileSync("shared/schema.ts", "utf8");
const migration = fs.readFileSync("migrations/0017_expense_payments.sql", "utf8");
const mod = fs.readFileSync("server/expense-payments.ts", "utf8");
const client = fs.readFileSync("client/src/pages/expenses.tsx", "utf8");

// The B2 route block: from the lifecycle-helpers comment to the contractor-invoice module banner.
const b2 = routes.slice(
  routes.indexOf("Expense payment lifecycle helpers (Release B2)"),
  routes.indexOf("CONTRACTOR INVOICE MODULE"),
);
if (!b2 || b2.length < 2000) throw new Error("could not isolate the B2 route block");

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
};

console.log("=== Release B2 — vendor/expense Cut Check (static) ===\n");

// ── migration is additive + reversible ─────────────────────────────
const migNoComments = migration.replace(/^--.*$/gm, "");
ok("migration only CREATEs a new table + indexes (no DROP/ALTER/RENAME/DELETE/UPDATE of live data)",
  !/\b(DROP\s+(TABLE|COLUMN|INDEX)|ALTER\s+TABLE|ALTER\s+COLUMN|RENAME|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w)\b/i.test(migNoComments));
ok("migration never touches the expenses table",
  !/\bexpenses\b/i.test(migNoComments.replace(/REFERENCES expenses\(id\)/g, "")));
ok("new table is guarded with IF NOT EXISTS (safe re-apply)",
  migration.includes("CREATE TABLE IF NOT EXISTS expense_payments"));
ok("FKs to companies + expenses, no cascade on financial history",
  migration.includes("company_id             VARCHAR NOT NULL REFERENCES companies(id)") &&
  migration.includes("expense_id             VARCHAR NOT NULL REFERENCES expenses(id)") &&
  !/ON DELETE CASCADE/i.test(migration));
ok("company-scoped partial unique index on idempotency_key",
  migration.includes("CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_payments_company_idempotency_key\n  ON expense_payments (company_id, idempotency_key)\n  WHERE idempotency_key IS NOT NULL"));
ok("active-only check-number uniqueness per funding account",
  migration.includes("uq_expense_payments_funding_check_number\n  ON expense_payments (remittance_source_id, reference_number)\n  WHERE status <> 'void' AND reference_number IS NOT NULL AND remittance_source_id IS NOT NULL"));
ok("migration documents a pg_dump backup + a full DROP INDEX/TABLE rollback block",
  migration.includes('pg_dump "$DATABASE_URL"') &&
  migration.includes("DROP INDEX IF EXISTS uq_expense_payments_company_idempotency_key") &&
  migration.includes("DROP TABLE IF EXISTS expense_payments"));

// ── boot DDL mirrors the migration (the repo's established deploy requirement) ──
ok("server/index.ts boot DDL creates the same table via runInv",
  bootDDL.includes('runInv("expense_payments table"') &&
  bootDDL.includes("CREATE TABLE IF NOT EXISTS expense_payments"));
ok("boot DDL mirrors both partial unique indexes",
  bootDDL.includes("CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_payments_company_idempotency_key ON expense_payments (company_id, idempotency_key) WHERE idempotency_key IS NOT NULL") &&
  bootDDL.includes("CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_payments_funding_check_number ON expense_payments (remittance_source_id, reference_number) WHERE status <> 'void' AND reference_number IS NOT NULL AND remittance_source_id IS NOT NULL"));
ok("boot DDL block is placed after the contractor 0016 block (not interleaved)",
  bootDDL.indexOf('runInv("expense_payments table"') > bootDDL.indexOf("uq_contractor_payments_company_idempotency_key"));

// ── schema.ts mirrors the table ──────────────────────────────────
ok("schema.ts declares expensePayments with the audit + linkage columns",
  schema.includes('export const expensePayments = pgTable("expense_payments"') &&
  schema.includes('idempotencyFingerprint: text("idempotency_fingerprint")') &&
  schema.includes('voidedByUserId: varchar("voided_by_user_id")') &&
  schema.includes('reversesPaymentId: varchar("reverses_payment_id")') &&
  schema.includes('reissuedByPaymentId: varchar("reissued_by_payment_id")'));
ok("schema.ts does not alter the expenses table for B2 (no new expense_payments coupling on `expenses`)",
  !/expense_payments|expensePayment/.test(schema.slice(schema.indexOf('export const expenses = pgTable("expenses"'), schema.indexOf('export const insertExpenseSchema'))));

// ── B2 does NOT touch the contractor ledger ──────────────────────
ok("no vendor/expense row is ever written to contractor_payments",
  !/INSERT INTO contractor_payments/i.test(b2) && !/UPDATE contractor_invoices/i.test(b2));
ok("B2 module reuses contractor-payments money primitives, adds no second cents model",
  mod.includes('} from "./contractor-payments"') && !/function toCents/.test(mod));

// ── pure helpers ────────────────────────────────────────────────
ok("B2 is check-only", mod.includes('EXPENSE_PAYMENT_METHOD = "check"'));
ok("replay fingerprint excludes the live balance (never post-payment balance)",
  mod.includes("Never includes the post-payment balance") &&
  !/balanceDue|amountPaid|paidCents/.test(mod.slice(mod.indexOf("expensePaymentFingerprint"))));
ok("status is recomputed from the ledger sum, not a browser value",
  mod.includes("recomputeExpensePaymentStatus(totalCents: number, paidCents: number)"));

// ── company scope is server-side ────────────────────────────────
ok("check context resolves the company server-side (session + canAccessCompany), never trusts the body",
  b2.includes("const sessionCompanyId = await getSessionCompanyId(req)") &&
  b2.includes("await canAccessCompany(user!, expense.company_id)") &&
  b2.includes('ExpenseRuleError(403, "ACCESS_DENIED"'));
ok("no route reads a company id from req.body / req.query",
  !/req\.(body|query)[^;\n]*company/i.test(b2));

// ── preview + reprint: ZERO financial writes ────────────────────
const stripComments = (s: string) => s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const preview = stripComments(b2.slice(b2.indexOf("const expenseCheckPreview"), b2.indexOf("// POST /api/expenses/:id/cut-check")));
ok("GET|POST print-check is registered as preview only",
  b2.includes('app.get("/api/expenses/:id/print-check", requireAuth') &&
  b2.includes('app.post("/api/expenses/:id/print-check", requireAuth') &&
  b2.includes("PREVIEW ONLY"));
ok("preview handler performs no INSERT / UPDATE and sets X-Preview",
  !/\b(INSERT\s+INTO|UPDATE)\s+\w/i.test(preview) && preview.includes('res.set("X-Preview", "1")'));
const reprint = stripComments(b2.slice(b2.indexOf('app.get("/api/expense-payments/:paymentId/check"'), b2.indexOf('app.post("/api/expense-payments/:id/void"')));
ok("reprint route performs no INSERT / UPDATE, re-renders the original number + amount, sets X-Reprint",
  !/\b(INSERT\s+INTO|UPDATE)\s+\w/i.test(reprint) &&
  reprint.includes("checkNumber: pay.reference_number") && reprint.includes("amount: pay.amount") &&
  reprint.includes('res.set("X-Reprint", "1")'));
ok("the old print-check that did `UPDATE expenses SET payment_status='paid'` on render is gone",
  !/print-check[\s\S]{0,1200}?UPDATE\s+expenses\s+SET[\s\S]{0,120}?payment_status\s*=\s*'paid'/i.test(routes));

// ── cut-check: atomic issuance ─────────────────────────────────
const cut = b2.slice(b2.indexOf('app.post("/api/expenses/:id/cut-check"'), b2.indexOf('app.get("/api/expense-payments/:paymentId/check"'));
ok("cut-check requires an Idempotency-Key", cut.includes('requireIdempotencyKey(req.get("Idempotency-Key")') && cut.includes('"IDEMPOTENCY_KEY_REQUIRED"'));
ok("cut-check runs inside db.transaction", /await db\.transaction\(async \(tx\) => \{/.test(cut));
ok("the expense row is locked SELECT ... FOR UPDATE inside the tx",
  cut.includes("SELECT * FROM expenses WHERE id = ${expenseId} FOR UPDATE"));
ok("the funding-account / check-counter row is locked FOR UPDATE",
  cut.includes("SELECT id, last_check_number FROM remittance_sources WHERE id = ${ctx.remittanceSource.id} FOR UPDATE"));
ok("balance is recomputed from the authoritative non-void ledger SUM inside the tx",
  cut.includes("SELECT COALESCE(SUM(amount), 0)::numeric AS paid FROM expense_payments WHERE expense_id = ${expenseId} AND status <> 'void'"));
ok("zero / negative / over-balance is rejected via checkPaymentAmount (no JS float compare)",
  cut.includes("checkPaymentAmount(amtInput, balanceDueCents)") && cut.includes("toCents(") && !/parseFloat\([^)]*\)\s*[<>]=?/.test(cut));
ok("exactly one expense_payments row is inserted per issuance",
  (cut.match(/INSERT INTO\s+expense_payments/g) || []).length === 1);
ok("the check number is allocated by incrementing the funding account counter",
  cut.includes("UPDATE remittance_sources SET last_check_number = ${nextCheckNum} WHERE id = ${ctx.remittanceSource.id}") &&
  cut.includes("formatCheckNumber(nextCheckNum)"));
ok("the expense payment status + check number are updated in the same tx",
  /UPDATE\s+expenses\s+SET[\s\S]{0,400}?payment_status = \$\{newStatus\}/.test(cut));
ok("a check_issued audit row is written in the same tx",
  cut.includes("INSERT INTO expense_approval_actions") && cut.includes("'check_issued'"));
ok("eligibility is re-checked against the LOCKED row inside the tx",
  /FOR UPDATE[\s\S]{0,200}?checkExpenseEligibility\(/.test(cut));

// ── idempotency ───────────────────────────────────────────────
ok("same key + no/equal amount re-renders the original with zero new writes",
  cut.includes("if (priorByKey)") && cut.includes("X-Payment-Id") &&
  !/if \(priorByKey\)[\s\S]{0,600}?(INSERT INTO|UPDATE expenses)/.test(cut));
ok("same key + explicitly different amount → 409 IDEMPOTENCY_KEY_REUSED",
  cut.includes("requestedCents !== null && toCents(priorByKey.amount) !== requestedCents") &&
  cut.includes('"IDEMPOTENCY_KEY_REUSED"'));
ok("a concurrent unique-index conflict fetches + returns the committed original",
  cut.includes("isUniqueConstraintViolation(txErr)") &&
  cut.includes("SELECT * FROM expense_payments WHERE company_id = ${ctx.companyId} AND idempotency_key = ${idem.key}"));
ok("replay fingerprint uses a FULL_BALANCE_SENTINEL, not the live balance",
  cut.includes("FULL_BALANCE_SENTINEL = -1") && cut.includes("requestedCents ?? FULL_BALANCE_SENTINEL"));
ok("the check number is not used as the idempotency key",
  !/idempotency_key.{0,40}(checkNumber|reference_number|last_check_number)/.test(cut));

// ── void: never deletes, restores once, idempotent ────────────
const voidR = b2.slice(b2.indexOf('app.post("/api/expense-payments/:id/void"'), b2.indexOf('app.post("/api/expense-payments/:id/reissue"'));
ok("void requires a reason", voidR.includes('"REASON_REQUIRED"'));
ok("void never deletes the original row", !/DELETE FROM expense_payments/i.test(voidR));
ok("void keeps the original + records who / when / reason",
  voidR.includes("SET status = 'void', voided_at = NOW(), voided_by_user_id = ${req.session.userId}, void_reason = ${reason}"));
ok("void restores the balance exactly once (UPDATE ... AND status <> 'void')",
  voidR.includes("WHERE id = ${paymentId} AND status <> 'void' RETURNING *"));
ok("void recomputes the expense status from the ledger",
  voidR.includes("recomputeExpensePaymentStatus(totalCents, paidCents)"));
ok("repeated void is idempotent — an already-void payment makes no financial change",
  voidR.includes('if (pay.status === "void")') && voidR.includes("alreadyVoid: true") &&
  !/if \(pay\.status === "void"\)[\s\S]{0,300}?(UPDATE expenses|INSERT INTO expense_payments)/.test(voidR));
ok("void writes a check_voided audit row + surfaces the bank stop-payment warning",
  voidR.includes("'check_voided'") && voidR.includes("EXPENSE_VOID_STOP_PAYMENT_NOTE"));

// ── reissue: one linked replacement, replay-safe ──────────────
const reissue = b2.slice(b2.indexOf('app.post("/api/expense-payments/:id/reissue"'), b2.length);
ok("reissue requires an Idempotency-Key + a reason",
  reissue.includes('"IDEMPOTENCY_KEY_REQUIRED"') && reissue.includes('"REASON_REQUIRED"'));
ok("reissue voids the original + inserts exactly one replacement in one tx",
  /await db\.transaction/.test(reissue) &&
  (reissue.match(/INSERT INTO\s+expense_payments/g) || []).length === 1 &&
  reissue.includes("SET status = 'void'"));
ok("the replacement links back to the original (reverses_payment_id + reissued_by_payment_id)",
  reissue.includes("reverses_payment_id)") &&
  reissue.includes("UPDATE expense_payments SET reissued_by_payment_id = ${replacement.id} WHERE id = ${originalId}"));
ok("the replacement gets a NEW check number",
  reissue.includes("UPDATE remittance_sources SET last_check_number = ${nextCheckNum}") &&
  reissue.includes("formatCheckNumber(nextCheckNum)"));
ok("replaying the same reissue creates no second replacement",
  reissue.includes('if (o.reissued_by_payment_id) throw new ExpenseRuleError(409, "ALREADY_REISSUED"') &&
  reissue.includes("priorByKey.idempotency_fingerprint === fingerprint"));

// ── notifications: after commit, no sensitive data ────────────
ok("notification fires only AFTER db.transaction resolves",
  /await db\.transaction[\s\S]{0,6000}?\}\);\s*\n[\s\S]{0,600}?notifyExpenseAfterCommit/.test(cut));
ok("a notification failure never rolls back the payment (fire-and-forget, catch-logged)",
  b2.includes("Promise.resolve().then(() => createContractorNotification(input))") &&
  b2.includes(".catch(() => console.warn(`[expense-payment] notification deferred for payment ${paymentId}`))"));
// isolate just the notification payloads + log lines (exclude the check-PDF renderer, which legitimately reads routing/account)
const notifyAndLogLines = b2.split("\n").filter((l) =>
  /notifyExpenseAfterCommit|createContractorNotification|console\.(warn|error|log)|\btitle:|\bbody:/.test(l),
).join("\n");
ok("notification payloads + log lines never contain bank account, routing, MICR or a document path",
  !/routing_number|account_number|routingNumber|accountNumber|micr|file_path|filePath|document_path/i.test(notifyAndLogLines));
ok("logs carry only safe identifiers (payment id / expense id), never interpolated error bodies with secrets",
  b2.includes("notification deferred for payment ${paymentId}") &&
  !b2.includes("notification deferred for payment ${paymentId}: ${"));

// ── contractor-payment + payroll / 1099 / tax boundary untouched ──
ok("B2 does not reference calculate1099Summary / trade_transactions / 1099 thresholds",
  !/calculate1099Summary|trade_transactions|meetsThreshold|[^0-9]600[^0-9].*threshold/i.test(b2));
ok("B2 touches no payroll module",
  !/payroll_run|payrollRun|calculatePayroll|ytd|withholding/i.test(b2));
ok("the contractor cut-check route is unchanged by B2 (still inserts into contractor_payments)",
  routes.includes('app.post("/api/contractor-invoices/:id/cut-check"') &&
  /contractor-invoices\/:id\/cut-check[\s\S]{0,6000}?INSERT INTO contractor_payments/.test(routes));

// ── client: preview separated from issuance ──────────────────
ok("client Cut Check dialog calls POST /cut-check with an Idempotency-Key header",
  client.includes("/cut-check") && client.includes('"Idempotency-Key"'));
ok("client has a separate Preview action hitting print-check?preview=1 (no write)",
  client.includes("previewExpenseCheck") && client.includes("preview") && client.includes("print-check"));
ok("client no longer lets the user type a check number (allocated on issue)",
  client.includes('value="auto — allocated on issue"') || /check.?number[\s\S]{0,120}disabled/i.test(client));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
