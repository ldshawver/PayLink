/**
 * Static wiring checks proving client and server both call the SAME shared
 * pay-rate rule (shared/worker-pay-rate-rules.ts) rather than each keeping
 * its own copy that could silently drift apart again. Deliberately
 * supplementary to tests/worker-pay-rate-validation.test.ts (the real
 * behavioral coverage of the rule itself) — these only prove the wiring,
 * not the logic.
 *
 * Also proves the Worker Group selector's mapping — the thing that was
 * actually in question after "Invoiced Contractor (1099)" + blank Pay Rate
 * was rejected with "Pay rate is required" during PR #78 staging
 * validation — sends the exact enum values the shared rule (and thus the
 * server) requires to treat it as a legitimate no-fixed-rate contractor.
 *
 * Run: npx tsx tests/worker-pay-rate-rules-wiring-static.test.ts
 */
import fs from "node:fs";

const routesSrc = fs.readFileSync("server/routes.ts", "utf8");
const employeeTsxSrc = fs.readFileSync("client/src/pages/employee.tsx", "utf8");

let pass = 0;
let fail = 0;
function ok(name: string, result: boolean) {
  if (result) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("Server: POST /api/workers uses the shared rule");
ok(
  "routes.ts imports normalizeWorkerPayRate/isValidWorkerType/isValidContractorType from shared/worker-pay-rate-rules",
  /from "@shared\/worker-pay-rate-rules"/.test(routesSrc) &&
    /normalizeWorkerPayRate/.test(routesSrc) &&
    /isValidWorkerType/.test(routesSrc) &&
    /isValidContractorType/.test(routesSrc),
);
ok(
  "POST /api/workers independently validates worker_type before calling storage.createWorker",
  /app\.post\("\/api\/workers",[\s\S]{0,2000}?isValidWorkerType\(req\.body\.workerType\)[\s\S]{0,2000}?storage\.createWorker\(/.test(routesSrc),
);
ok(
  "POST /api/workers independently validates contractor_type before calling storage.createWorker",
  /app\.post\("\/api\/workers",[\s\S]{0,2000}?isValidContractorType\(req\.body\.contractorType\)[\s\S]{0,2000}?storage\.createWorker\(/.test(routesSrc),
);
ok(
  "POST /api/workers calls normalizeWorkerPayRate before calling storage.createWorker",
  /app\.post\("\/api\/workers",[\s\S]{0,2000}?normalizeWorkerPayRate\(req\.body\)[\s\S]{0,2000}?storage\.createWorker\(/.test(routesSrc),
);

console.log("\nClient: employee.tsx uses the SAME shared rule, not a local reimplementation");
ok(
  "employee.tsx imports normalizeWorkerPayRate from shared/worker-pay-rate-rules (not a server-only copy)",
  /import\s*\{\s*normalizeWorkerPayRate\s*\}\s*from\s*"@shared\/worker-pay-rate-rules"/.test(employeeTsxSrc),
);
ok(
  "the Add Worker submit handler checks normalizeWorkerPayRate before calling createMutation.mutate",
  /normalizeWorkerPayRate\(submitData\)[\s\S]{0,400}?createMutation\.mutate\(submitData\)/.test(employeeTsxSrc),
);
ok(
  "a failed client-side check shows an error toast and returns without submitting",
  /payRateCheck\.ok[\s\S]{0,200}?toast\(\{[\s\S]{0,150}?variant: "destructive"[\s\S]{0,50}?\}\)[\s\S]{0,50}?return;/.test(employeeTsxSrc),
);

console.log("\nWorker Group selector maps to the exact enum values the shared rule expects");
ok(
  "\"invoiced_contractor\" maps to workerType \"contractor\"",
  /const isContractor = v === "hourly_contractor" \|\| v === "invoiced_contractor";[\s\S]{0,100}?const wType = isContractor \? "contractor"/.test(employeeTsxSrc),
);
ok(
  "\"invoiced_contractor\" maps to contractorType \"invoice\" (the exact string normalizeWorkerPayRate checks for)",
  /const cType = v === "invoiced_contractor" \? "invoice" : "hourly";/.test(employeeTsxSrc),
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
