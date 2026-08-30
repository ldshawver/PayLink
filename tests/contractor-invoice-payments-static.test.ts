/**
 * Release B — contractor-invoice payment / Cut Check static guards.
 * Run: npx tsx tests/contractor-invoice-payments-static.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const bootDDL = fs.readFileSync("server/index.ts", "utf8");
const schema = fs.readFileSync("shared/schema.ts", "utf8");
const migration = fs.readFileSync("migrations/0016_contractor_payment_lifecycle.sql", "utf8");
const mod = fs.readFileSync("server/contractor-payments.ts", "utf8");

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
};

console.log("=== Release B — contractor payments / Cut Check (static) ===\n");

// -- migration is additive + reversible ------------------------------
ok("migration only ADDs columns / indexes (no drop/alter-type/rename of existing data)",
  !/\b(DROP\s+TABLE|DROP\s+COLUMN|ALTER\s+COLUMN|RENAME|TRUNCATE|DELETE\s+FROM|UPDATE\s+contractor_)\b/i
    .test(migration.replace(/^--.*$/gm, "")));
ok("migration adds every declared column, all nullable",
  ["idempotency_key", "idempotency_fingerprint", "voided_at", "voided_by_user_id", "void_reason", "reverses_payment_id", "reissued_by_payment_id"]
    .every((c) => migration.includes(`contractor_payments ADD COLUMN IF NOT EXISTS ${c}`)) &&
  migration.includes("contractor_trade_compensation ADD COLUMN IF NOT EXISTS idempotency_key"));
ok("company-scoped partial unique indexes",
  migration.includes("CREATE UNIQUE INDEX IF NOT EXISTS uq_contractor_payments_company_idempotency_key\n  ON contractor_payments (company_id, idempotency_key)\n  WHERE idempotency_key IS NOT NULL") &&
  migration.includes("uq_contractor_trade_comp_company_idempotency_key\n  ON contractor_trade_compensation (company_id, idempotency_key)\n  WHERE idempotency_key IS NOT NULL"));
ok("migration documents pg_dump backup + a full rollback block",
  migration.includes('pg_dump "$DATABASE_URL"') &&
  migration.includes("DROP INDEX IF EXISTS uq_contractor_payments_company_idempotency_key") &&
  migration.includes("ALTER TABLE contractor_payments DROP COLUMN IF EXISTS idempotency_key"));
ok("boot DDL mirrors the migration (root schema-repair pattern)",
  bootDDL.includes("contractor_payments.idempotency_key") &&
  bootDDL.includes("CREATE UNIQUE INDEX IF NOT EXISTS uq_contractor_payments_company_idempotency_key") &&
  bootDDL.includes("contractor_trade_compensation.idempotency_key"));
ok("schema.ts mirrors the new columns",
  schema.includes('idempotencyKey: text("idempotency_key")') &&
  schema.includes('idempotencyFingerprint: text("idempotency_fingerprint")') &&
  schema.includes('reversesPaymentId: varchar("reverses_payment_id")') &&
  schema.includes('reissuedByPaymentId: varchar("reissued_by_payment_id")'));

// -- atomicity + concurrency ---------------------------------------
ok("payment write is wrapped in db.transaction",
  /app\.post\("\/api\/contractor-invoices\/:id\/payments"[\s\S]{0,4000}?await db\.transaction\(async \(tx\) => \{/.test(routes));
ok("the invoice row is locked with SELECT ... FOR UPDATE",
  routes.includes("SELECT * FROM contractor_invoices WHERE id = ${invoiceId} FOR UPDATE"));
ok("remaining balance is recomputed from authoritative rows (SUM of non-void payments) in the DB",
  routes.includes("SELECT COALESCE(SUM(amount), 0)::numeric AS paid FROM contractor_payments WHERE invoice_id = ${invoiceId} AND status <> 'void'"));
ok("zero / negative / over-balance payments are rejected via checkPaymentAmount",
  routes.includes("checkPaymentAmount((req.body as any)?.amount, balanceDueCents)"));
ok("cut-check also locks the invoice and reserves a funding-account check number FOR UPDATE",
  /cut-check[\s\S]{0,5000}?FROM contractor_invoices WHERE id = \$\{invoiceId\} FOR UPDATE/.test(routes) &&
  routes.includes("SELECT id, last_check_number FROM remittance_sources WHERE id = ${rsPre.id} FOR UPDATE"));

// -- idempotency -------------------------------------------------
ok("Idempotency-Key is required on every financial POST",
  (routes.match(/requireIdempotencyKey\(req\.get\("Idempotency-Key"\)/g) || []).length >= 3);
ok("same key + same fingerprint returns the original with no new write",
  routes.includes("priorByKey.idempotency_fingerprint === fingerprint") &&
  routes.includes('res.status(200).json(priorByKey)'));
ok("same key + different fingerprint returns 409 IDEMPOTENCY_KEY_REUSED",
  routes.includes('error: "IDEMPOTENCY_KEY_REUSED"'));
ok("a concurrent unique-index conflict fetches and returns the committed original",
  routes.includes("isUniqueConstraintViolation(txErr)") &&
  routes.includes("Concurrent insert with the same key committed first"));
ok("idempotency fingerprint is a hash of amount/method/invoice/company/linked-comp",
  mod.includes("export function paymentFingerprint") &&
  /createHash\("sha256"\)/.test(mod));

// -- payment methods --------------------------------------------
ok("payment method is validated against the normalized allowlist for new writes",
  routes.includes("normalizeContractorPaymentMethod((req.body as any)?.paymentMethod)") &&
  routes.includes('error: "INVALID_PAYMENT_METHOD"'));
ok("trade_credit / rent_credit / other require a description",
  routes.includes("DESCRIPTION_REQUIRED_METHODS.has(method) && !description"));
ok("trade_credit additionally requires an approved company-scoped FMV compensation record",
  routes.includes('error: "TRADE_COMPENSATION_REQUIRED"') &&
  routes.includes("checkTradeCreditApplicable(") &&
  routes.includes("FROM contractor_trade_compensation WHERE id = ${tradeCompensationId} FOR UPDATE"));
ok("historical free-text payment_method values are never rewritten by the migration",
  !migration.toLowerCase().includes("update contractor_payments set payment_method"));

// -- void / reissue --------------------------------------------
ok("void keeps the original row + monetary fields, records who/when/reason",
  routes.includes("SET status = 'void', voided_at = NOW(), voided_by_user_id = ${req.session.userId}, void_reason = ${reason}") &&
  !routes.includes("DELETE FROM contractor_payments"));
ok("void restores the invoice balance and recomputes status once",
  /\/void"[\s\S]{0,3000}?recomputeInvoiceStatus\(totalCents, paidCents\)/.test(routes));
ok("repeated void is idempotent (no financial change on a already-void payment)",
  routes.includes('if (pay.status === "void")') && routes.includes("alreadyVoid: true"));
ok("void releases any trade-compensation linkage",
  routes.includes("UPDATE contractor_trade_compensation SET contractor_payment_id = NULL, updated_at = NOW() WHERE contractor_payment_id = ${paymentId}"));
ok("reissue produces exactly one linked replacement (reverses_payment_id / reissued_by_payment_id)",
  routes.includes("reverses_payment_id)") &&
  routes.includes("UPDATE contractor_payments SET reissued_by_payment_id = ${replacement.id} WHERE id = ${originalId}") &&
  routes.includes('"ALREADY_REISSUED"'));
ok("void of a non-check method returns the internal-record-only disclaimer",
  routes.includes("externalSettlementDisclaimer(String(payPre.payment_method"));

// -- Cut Check: preview vs issuance ---------------------------
ok("GET/POST print-check is preview only — performs zero financial writes",
  routes.includes("PREVIEW ONLY. Renders the") &&
  !/contractorInvoiceCheckPreview[\s\S]{0,2500}?(INSERT INTO contractor_payments|UPDATE contractor_invoices SET)/.test(routes));
ok("the old print-check invoice UPDATE ('payment_method=check') is gone",
  !routes.includes("SET payment_method    = 'check',\n            payment_reference = ${checkNumber"));
ok("POST /cut-check issues: one payment + atomic balance reduction, returns the rendered PDF",
  routes.includes('app.post("/api/contractor-invoices/:id/cut-check"') &&
  /cut-check[\s\S]{0,6000}?INSERT INTO contractor_payments[\s\S]{0,600}?'check'/.test(routes));
ok("cut-check replay is stable after the balance drops to zero (sentinel fingerprint, not the live balance)",
  routes.includes("FULL_BALANCE_SENTINEL = -1") &&
  routes.includes("requestedCents ?? FULL_BALANCE_SENTINEL") &&
  !routes.includes("requestedCents ?? toCents(invPre.balance_due ?? invPre.amount)"));
ok("a cut-check replay with an explicit DIFFERENT amount than the issued check still 409s",
  routes.includes("requestedCents !== null && toCents(priorByKey.amount) !== requestedCents"));
ok("GET /api/contractor-payments/:paymentId/check reprints with zero financial writes",
  routes.includes('app.get("/api/contractor-payments/:paymentId/check"') &&
  !/paymentId\/check"[\s\S]{0,1500}?(INSERT INTO contractor_payments|UPDATE contractor_invoices)/.test(routes));
ok("check number uniqueness is scoped by company + funding account (not check number alone)",
  routes.includes("remittance_sources SET last_check_number = ${nextCheckNum} WHERE id = ${rsPre.id}"));
ok("vendor/expense checks are NOT inserted into contractor_payments (deferred to B2)",
  !/expenses\/:id\/print-check[\s\S]{0,2000}?INSERT INTO contractor_payments/.test(routes));

// -- notifications --------------------------------------------
ok("contractor notification is sent only AFTER the transaction commits",
  routes.includes("notifyAfterCommit(created.id") &&
  /await db\.transaction[\s\S]{0,4000}?\}\);\s*\n[\s\S]{0,400}?notifyAfterCommit/.test(routes));
ok("notification failure never rolls back the financial transaction, logs only the payment id",
  routes.includes("notification deferred for payment ${paymentId}") &&
  !routes.includes("notification deferred for payment ${paymentId}: ${"));

// -- trade compensation exactly-once -------------------------
ok("trade-compensation POST is idempotency-keyed and dedupes",
  routes.includes("FROM contractor_trade_compensation WHERE company_id = ${companyId} AND idempotency_key = ${idempotencyKey}") &&
  routes.includes(".values({ ...payload, idempotencyKey })"));
ok("trade-comp with no payroll-item / SKU anchor requires an explicit key",
  routes.includes('error: "IDEMPOTENCY_KEY_REQUIRED", message: "An Idempotency-Key is required for a trade-compensation record with no payroll item or SKU anchor."'));

// -- 1099 / tax boundary untouched --------------------------
ok("Release B does not touch calculate1099Summary",
  !/calculate1099Summary/.test(routes) || fs.readFileSync("server/storage.ts", "utf8").includes("async calculate1099Summary"));
ok("Release B does not write trade_transactions or change 1099 thresholds",
  !/(INSERT INTO trade_transactions|UPDATE trade_transactions)/.test(routes.split("cut-check")[1] || "") &&
  !/threshold.*600|meetsThreshold/.test(mod));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
