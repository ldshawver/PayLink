/**
 * Behavioral tests for normalizeWorkerPayRate (server/worker-pay-rate.ts),
 * the pure decision logic behind the POST /api/workers 500 fix: workers.pay_rate
 * is NOT NULL, but an explicit null (what a blank Pay Rate field becomes)
 * bypasses the column's own "0" default. Only an invoiced 1099 contractor
 * legitimately has no fixed rate; everyone else must still supply one.
 *
 * Run: npx tsx tests/worker-pay-rate-validation.test.ts
 */
import { normalizeWorkerPayRate } from "../server/worker-pay-rate";

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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
