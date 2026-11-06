/**
 * PR-E2 regression: no console.* path — strings, structured objects, Errors
 * (incl. pg DatabaseError `detail`), causes, util.inspect / JSON text,
 * console.dir/trace, or Node's fatal-exception printer — may write bank
 * account, routing, SSN, EIN or TIN values to PM2 output. Also proves
 * non-sensitive diagnostic context survives.
 *
 * Synthetic identifiers only.
 *
 * Run: npx tsx tests/log-redaction.test.ts
 */
import fs from "node:fs";
import util from "node:util";
import { Console } from "node:console";
import { Writable } from "node:stream";
import { spawnSync } from "node:child_process";
import {
  REDACTED,
  formatRedactedLogLine,
  installConsoleRedaction,
  isSensitiveLogKey,
  redactLogText,
  redactLogValue,
} from "../server/log-redaction";

let pass = 0;
let fail = 0;
function ok(name: string, result: boolean, detail?: string) {
  if (result) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// Synthetic values, shaped like the real fields found in PM2 logs.
const SYN = {
  accountNumber: "000123456789",
  routingNumber: "990000011",
  bankAccountNumber: "5550001112223",
  ssn: "123-45-6789",
  ssnSpaced: "123 45 6789",
  ssnBare: "123456789",
  ein: "00-1230000",
  taxId: "00-4560000",
  tin: "900700001",
};
const SYN_VALUES = Object.values(SYN);
const leaks = (text: string) => SYN_VALUES.filter((v) => text.includes(v));

function captureConsole() {
  const out: string[] = [];
  const err: string[] = [];
  const sink = (buf: string[]) => new Writable({ write(chunk, _enc, cb) { buf.push(String(chunk)); cb(); } });
  const c = new Console({ stdout: sink(out), stderr: sink(err) });
  installConsoleRedaction(c);
  return { c, out, err, all: () => out.join("") + err.join("") };
}

function fakePgError() {
  const e: any = new Error('null value in column "pay_method" of relation "workers" violates not-null constraint');
  e.name = "DatabaseError";
  Object.assign(e, {
    length: 312, severity: "ERROR", code: "23502", table: "workers", column: "pay_method",
    schema: "public", routine: "ExecConstraints",
    detail: `Failing row contains (w_syn_1, c_syn_1, Zed, Synthetic, ${SYN.ssn}, ${SYN.routingNumber}, ${SYN.accountNumber}, null, (1,2)).`,
  });
  return e;
}

console.log("\nKey classification");
for (const k of ["accountNumber", "account_number", "bankAccountNumber", "routingNumber", "routing_number", "ssn", "workerSsn",
  "ein", "companyEin", "employer_ein", "taxId", "tax_id", "tin", "iban", "micrLine", "bankAccount"]) {
  ok(`sensitive: ${k}`, isSensitiveLogKey(k));
}
for (const k of ["accountNumberLast4", "maskedSsn", "accountType", "protein", "accountId", "companyId", "routingStatus",
  "bankName", "id", "status", "einVerified"]) {
  ok(`kept: ${k}`, !isSensitiveLogKey(k));
}

console.log("\nStructured objects");
{
  const { c, all } = captureConsole();
  const record = { id: "w_syn_1", companyId: "c_syn_1", accountType: "checking", accountNumberLast4: "6789", bankName: "Synthetic CU",
    accountNumber: SYN.accountNumber, routingNumber: SYN.routingNumber, ssn: SYN.ssn, ein: SYN.ein, taxId: SYN.taxId, tin: SYN.tin,
    nested: { deeper: [{ bank_account_number: SYN.bankAccountNumber, routing_number: SYN.routingNumber }] }, hours: 40, missingSsn: null };
  c.log("[Workers] create payload:", record);
  c.error("[Workers] create payload json: %s", JSON.stringify(record));
  c.warn(`[Workers] inspected: ${util.inspect(record, { depth: 6 })}`);
  c.info("pretty json", JSON.stringify(record, null, 2));
  c.debug({ wrapper: record });
  c.dir(record, { depth: 6 });
  c.trace("trace with", record);
  const text = all();
  ok("no synthetic value in any method's output", leaks(text).length === 0, `leaked: ${leaks(text).join(",")}`);
  ok("context kept: ids, account type, last4, bank name, hours", ["w_syn_1", "c_syn_1", "checking", "6789", "Synthetic CU", "40"].every((s) => text.includes(s)));
  ok("redaction marker present", text.includes(REDACTED));
  ok("null sensitive field left as null (shows absence)", /missingSsn: null/.test(text));
}

console.log("\nErrors and exception paths");
{
  const { c, out, err } = captureConsole();
  const pgErr = fakePgError();
  c.error("[Workers] insert failed:", pgErr);
  const dup: any = new Error('duplicate key value violates unique constraint "companies_ein_key"');
  Object.assign(dup, { code: "23505", constraint: "companies_ein_key", detail: `Key (ein)=(${SYN.ein}) already exists.` });
  c.error("[Companies] create failed:", dup);
  const wrapped = new Error(`payout failed for routing number ${SYN.routingNumber}`, { cause: { accountNumber: SYN.accountNumber, ssn: SYN.ssn } });
  c.error(wrapped);
  c.error(`[RemittanceSources] create failed: ${pgErr.detail}`);
  const circular: any = { id: "loop_1", ein: SYN.ein };
  circular.self = circular;
  c.log("circular", circular);
  const errText = err.join("");
  const text = out.join("") + errText;
  ok("no synthetic value in error output", leaks(text).length === 0, `leaked: ${leaks(text).join(",")}`);
  ok("pg row detail masked", errText.includes(`Failing row contains (${REDACTED})`));
  ok("pg key detail masked, column name kept", errText.includes(`Key (ein)=(${REDACTED})`));
  ok("pg id-only key detail kept for diagnosis", redactLogText("Key (company_id)=(c_syn_9) is not present") === "Key (company_id)=(c_syn_9) is not present");
  ok("pg mixed key detail masked", redactLogText(`Key (company_id, ein)=(c_syn_9, ${SYN.ein})`) === `Key (company_id, ein)=(${REDACTED})`);
  ok("pg diagnostics kept: code/table/column/constraint/routine", ["23502", "workers", "pay_method", "companies_ein_key", "ExecConstraints"].every((s) => errText.includes(s)));
  ok("error message and stack frames kept", errText.includes("violates not-null constraint") && /\n\s+at /.test(errText));
  ok("cause object redacted", !errText.includes(SYN.accountNumber) && errText.includes("cause"));
  ok("circular object logged without throwing", text.includes("loop_1") && text.includes("[Circular]"));
  ok("errors go to stderr, logs to stdout", errText.includes("[Workers] insert failed") && out.join("").includes("circular"));
  ok("original error object not mutated", pgErr.detail.includes(SYN.ssn));
}

console.log("\nFree-text and shapes");
{
  const t = redactLogText(`ssn=${SYN.ssnBare} EIN ${SYN.ein} routing number: ${SYN.routingNumber} account no ${SYN.accountNumber} tin#${SYN.tin} spaced ${SYN.ssnSpaced}`);
  ok("free-text keyed values and SSN/EIN shapes masked", leaks(t).length === 0, t);
  const urls = [
    `GET /api/workers?ssn=${SYN.ssnBare}&companyId=c_syn_1`,
    `GET /api/x?workerSsn=${SYN.ssnBare}&companyEin=${SYN.tin}`,
    `GET /api/x?account_number=${SYN.accountNumber}&routing_number=${SYN.routingNumber}`,
    `GET /api/x?ssn=123%2D45%2D6789&tax_id=${SYN.tin}`,
    `worker_ssn=${SYN.ssnBare} employer_ein=${SYN.tin} bank_account_number=${SYN.bankAccountNumber}`,
  ].map((u) => redactLogText(u)).join("\n");
  ok("URL query strings and prefixed snake/camel keys masked", leaks(urls).length === 0 && !urls.includes("123%2D45%2D6789"), urls);
  ok("non-sensitive query params kept", urls.includes("companyId=c_syn_1"));
  ok("sensitive keys with null value left alone", redactLogText("workerSsn=null protein=123456789") === "workerSsn=null protein=123456789");
  const keep = redactLogText("[PAYROLL] run=pr_42 worker=w_7 totalHours=38.5 date=2026-11-04 GET /api/workers/123 200 in 14ms");
  ok("ordinary diagnostic line unchanged", keep === "[PAYROLL] run=pr_42 worker=w_7 totalHours=38.5 date=2026-11-04 GET /api/workers/123 200 in 14ms", keep);
  ok("signing-token redaction still applied", !redactLogText("https://x.test/sign/contracts/AbCdEfGh12345678").includes("AbCdEfGh12345678"));
  ok("format specifiers honoured", formatRedactedLogLine(["%s worked %d hours", "w_7", 38]) === "w_7 worked 38 hours");
  const value: any = redactLogValue({ a: { b: { c: { d: { e: { f: { g: { h: { i: { ein: SYN.ein } } } } } } } } } });
  ok("depth-bounded (no runaway recursion)", !JSON.stringify(value).includes(SYN.ein));
}

console.log("\nv2.2.19: 'account' + bare digits");
{
  // Synthetic, never-issuable account values (not used elsewhere in this file).
  const ACCT = ["000777000111", "4440009990", "00011122233"];
  const acctLeaks = (text: string) => [...ACCT, ...SYN_VALUES].filter((v) => text.includes(v));
  const freeText = [
    `payout failed for account ${ACCT[0]}`,
    `Account ${ACCT[1]} rejected by bank`,
    `ACH return: account #${ACCT[2]}`,
    `could not verify account: ${ACCT[0]}`,
    `account=${ACCT[1]} status=failed`,
    `acct ${ACCT[2]} closed`,
    `checking account ${ACCT[0]} at Synthetic CU`,
  ].map((t) => redactLogText(t)).join("\n");
  ok("free text 'account <digits>' masked", acctLeaks(freeText).length === 0, freeText);
  ok("free text keeps surrounding context", freeText.includes("rejected by bank") && freeText.includes("Synthetic CU") && freeText.includes("status=failed"));

  const { c, err } = captureConsole();
  const e1 = new Error(`ACH debit rejected for account ${ACCT[0]}`, { cause: new Error(`upstream: account ${ACCT[1]} frozen`) });
  c.error("[Payments] failed:", e1);
  c.error(e1);
  const e2: any = new Error("transfer failed");
  e2.stack = `Error: transfer failed for account ${ACCT[2]}\n    at pay (synthetic/payments.ts:10:5)`;
  e2.cause = { reason: `account ${ACCT[0]} invalid`, accountId: "a_syn_1" };
  c.error(e2);
  c.error(`[Payments] ${util.inspect(e1)}`);
  const errText = err.join("");
  ok("message/stack/cause/inspect forms masked", acctLeaks(errText).length === 0, `leaked: ${acctLeaks(errText).join(",")}`);
  ok("error context kept", errText.includes("ACH debit rejected") && errText.includes("frozen") && errText.includes("a_syn_1") && /\n\s+at /.test(errText));

  // Negative controls: ordinary operational text and unrelated numbers survive.
  const controls = [
    "account 42 suspended by admin",
    "[Auth] account 1001 locked after 5 failed attempts",
    "accounts: 3 active, 120000 total rows scanned",
    "account_id=123456789 accountId=987654321",
    "Stripe connected account acct_1SynTh3t1c0000 ready",
    "account created in 1250ms; next sync in 300000ms",
    "account ending in 6789",
    "GET /api/accounts/1234567 200 in 12ms",
    "[Billing] invoice 20261106001 total 125000 cents",
  ];
  for (const line of controls) ok(`kept: ${line}`, redactLogText(line) === line, redactLogText(line));
}

console.log("\nv2.2.19: URL-path values keep the trailing HTTP status");
{
  const lines: Array<[string, string, string]> = [
    // [input, sensitive value, expected visible tail]
    [`GET /api/verify?routing=${SYN.routingNumber} 404 in 3ms`, SYN.routingNumber, " 404 in 3ms"],
    [`GET /api/lookup/ein=${SYN.ein} 400 in 2ms`, SYN.ein, " 400 in 2ms"],
    [`GET /api/lookup/ssn:${SYN.ssnBare} 403 in 1ms`, SYN.ssnBare, " 403 in 1ms"],
    [`POST /api/banks/account/${SYN.accountNumber} 422 in 9ms`, SYN.accountNumber, " 422 in 9ms"],
    [`GET /api/x?account=${SYN.accountNumber} 500 in 4ms`, SYN.accountNumber, " 500 in 4ms"],
    [`GET /api/x/tin#${SYN.tin} 401 in 2ms :: {"message":"Unauthorized"}`, SYN.tin, ` 401 in 2ms :: {"message":"Unauthorized"}`],
    [`GET /api/workers/ssn/${SYN.ssn} 404 in 5ms`, SYN.ssn, " 404 in 5ms"],
  ];
  for (const [input, secret, tail] of lines) {
    const r = redactLogText(input);
    ok(`status visible + value masked: ${r}`, !r.includes(secret) && r.endsWith(tail), r);
  }
  // Multi-group values must still be fully masked.
  const spaced = redactLogText(`ssn ${SYN.ssnSpaced} 200 account number 0001 2223 3344 404`);
  ok("spaced SSN / grouped account masked, statuses kept", !spaced.includes("6789") && !spaced.includes("3344") && spaced.includes(" 200 ") && spaced.endsWith(" 404"), spaced);
}

console.log("\nRedaction-failure fallback");
{
  const out: string[] = [];
  const c = new Console({ stdout: new Writable({ write(chunk, _e, cb) { out.push(String(chunk)); cb(); } }), stderr: process.stderr });
  installConsoleRedaction(c);
  const hostile = { label: `account ${SYN.accountNumber}` } as any;
  Object.defineProperty(hostile, "boom", { enumerable: true, get() { throw new Error(`getter leaked ${SYN.ssn}`); } });
  c.log("fallback probe", SYN.routingNumber, hostile);
  const text = out.join("");
  ok("fallback line emitted", text.includes("[log-redaction] log line dropped"), text);
  ok("fallback exposes none of its input", leaks(text).length === 0 && !text.includes("fallback probe"), text);
}

console.log("\nProcess-level install (child process)");
{
  const script = `
    import "../server/install-log-redaction";
    console.log("boot", { routingNumber: "${SYN.routingNumber}", companyId: "c_syn_child" });
    const e = new Error("insert failed");
    Object.assign(e, { code: "23505", detail: "Key (ein)=(${SYN.ein}) already exists. Failing row contains (${SYN.ssn}, ${SYN.accountNumber})." });
    e.message = "insert failed for account ${SYN.bankAccountNumber}";
    e.stack = "Error: insert failed for account ${SYN.bankAccountNumber}\\n    at child (synthetic.ts:1:1)";
    (e as any).cause = new Error("bank said: account ${SYN.bankAccountNumber} closed");
    setTimeout(() => { throw e; }, 0);
  `;
  const tmp = `tests/.log-redaction-child-${process.pid}.ts`;
  fs.writeFileSync(tmp, script);
  try {
    const r = spawnSync(process.execPath, ["--import", "tsx", tmp], { encoding: "utf8", timeout: 60_000 });
    const text = `${r.stdout}${r.stderr}`;
    ok("fatal exception exits with code 1 (default semantics kept)", r.status === 1, `status=${r.status}`);
    ok("fatal exception output redacted", leaks(text).length === 0, `leaked: ${leaks(text).join(",")}`);
    ok("fatal exception still diagnosable", text.includes("[fatal] uncaughtException") && text.includes("insert failed") && text.includes("23505"));
    ok("boot-time console output redacted", text.includes("c_syn_child") && !text.includes(SYN.routingNumber));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

console.log("\nWiring");
{
  const index = fs.readFileSync("server/index.ts", "utf8");
  const firstImport = index.split("\n").find((l) => /^import\b/.test(l));
  ok("install-log-redaction is the first import of server/index.ts", firstImport === 'import "./install-log-redaction";', firstImport);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
