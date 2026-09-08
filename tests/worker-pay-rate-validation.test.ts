/**
 * Behavioral tests for shared/worker-pay-rate-rules.ts, the pure decision
 * logic behind the POST /api/workers 500 fix (PR #77): workers.pay_rate is
 * NOT NULL, but an explicit null (what a blank Pay Rate field becomes)
 * bypasses the column's own "0" default. Only an invoiced 1099 contractor
 * legitimately has no fixed rate; everyone else must still supply one.
 *
 * Moved from server/worker-pay-rate.ts into shared/ during the PR #78
 * staging follow-up, after a "Pay rate is required" rejection for a
 * genuine Invoiced Contractor (1099) selection prompted verifying the
 * client's workerGroup -> {workerType, contractorType} mapping actually
 * agreed with this rule. It did (client/src/pages/employee.tsx's Worker
 * Group selector correctly maps "invoiced_contractor" to
 * workerType:"contractor", contractorType:"invoice") — the module is now
 * shared so client and server structurally cannot drift apart on it again,
 * and employee.tsx calls this same function client-side before submitting
 * (see tests/worker-pay-rate-rules-client-wiring.test.ts).
 *
 * Run: npx tsx tests/worker-pay-rate-validation.test.ts
 */
import { normalizeWorkerPayRate, isValidWorkerType, isValidContractorType } from "../shared/worker-pay-rate-rules";

let pass = 0;
let fail = 0;
function ok(name: string, result: boolean, detail?: string) {
  if (result) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("normalizeWorkerPayRate — blank/null/undefined handling");

{
  // The exact failing shape from the PR #76 staging validation report.
  const r = normalizeWorkerPayRate({ workerType: "contractor", contractorType: "invoice", payRate: null });
  ok("blank payRate for an invoiced contractor normalizes to '0'", r.ok === true && r.payRate === "0", JSON.stringify(r));
}
{
  const r = normalizeWorkerPayRate({ workerType: "contractor", contractorType: "invoice", payRate: undefined });
  ok("undefined payRate for an invoiced contractor normalizes to '0'", r.ok === true && r.payRate === "0", JSON.stringify(r));
}
{
  const r = normalizeWorkerPayRate({ workerType: "contractor", contractorType: "invoice", payRate: "" });
  ok("empty-string payRate for an invoiced contractor normalizes to '0'", r.ok === true && r.payRate === "0", JSON.stringify(r));
}

console.log("\nnormalizeWorkerPayRate — blank rejected for everyone else");

{
  const r = normalizeWorkerPayRate({ workerType: "employee", payRate: null });
  ok("blank payRate for an employee is rejected, not zeroed", r.ok === false, JSON.stringify(r));
}
{
  const r = normalizeWorkerPayRate({ workerType: "employee", payRate: "" });
  ok("blank-string payRate for an employee is rejected", r.ok === false, JSON.stringify(r));
}
{
  const r = normalizeWorkerPayRate({ workerType: "contractor", contractorType: "hourly", payRate: null });
  ok("blank payRate for an hourly contractor is rejected (only invoice contractors get the default)", r.ok === false, JSON.stringify(r));
}
{
  // "Salaried Employee (W-2)" maps to workerType "employee" (contractorType
  // is irrelevant/null for employees) — missing compensation is rejected.
  const r = normalizeWorkerPayRate({ workerType: "employee", contractorType: null, payRate: null });
  ok("salaried employee with missing compensation is rejected", r.ok === false, JSON.stringify(r));
}

console.log("\nnormalizeWorkerPayRate — malformed nonblank values rejected, not silently zeroed");

{
  const r = normalizeWorkerPayRate({ workerType: "employee", payRate: "not-a-number" });
  ok("non-numeric payRate is rejected", r.ok === false, JSON.stringify(r));
}
{
  const r = normalizeWorkerPayRate({ workerType: "employee", payRate: "-15" });
  ok("negative payRate is rejected", r.ok === false, JSON.stringify(r));
}
{
  const r = normalizeWorkerPayRate({ workerType: "contractor", contractorType: "invoice", payRate: "NaN" });
  ok("malformed payRate for an invoiced contractor is still rejected, not zeroed", r.ok === false, JSON.stringify(r));
}

console.log("\nnormalizeWorkerPayRate — valid values pass through unchanged");

{
  const r = normalizeWorkerPayRate({ workerType: "employee", payRate: "25.50" });
  ok("valid decimal payRate passes through as-is", r.ok === true && r.payRate === "25.50", JSON.stringify(r));
}
{
  const r = normalizeWorkerPayRate({ workerType: "employee", payRate: "0" });
  ok("explicit '0' payRate (e.g. volunteer) passes through, distinct from blank", r.ok === true && r.payRate === "0", JSON.stringify(r));
}
{
  const r = normalizeWorkerPayRate({ workerType: "contractor", contractorType: "hourly", payRate: "40" });
  ok("valid payRate for an hourly contractor passes through as-is", r.ok === true && r.payRate === "40", JSON.stringify(r));
}

console.log("\nisValidWorkerType / isValidContractorType — independent server-side enum guards");

{
  ok("'employee' is a valid worker type", isValidWorkerType("employee") === true);
  ok("'contractor' is a valid worker type", isValidWorkerType("contractor") === true);
  ok("an arbitrary string is not a valid worker type", isValidWorkerType("manager") === false);
  ok("undefined is not a valid worker type", isValidWorkerType(undefined) === false);
}
{
  ok("'hourly' is a valid contractor type", isValidContractorType("hourly") === true);
  ok("'invoice' is a valid contractor type", isValidContractorType("invoice") === true);
  ok("an arbitrary string is not a valid contractor type", isValidContractorType("salaried") === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
