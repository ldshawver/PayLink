/**
 * Behavioral tests for buildWorkerCreatedConfirmation
 * (client/src/lib/worker-created-confirmation.ts).
 *
 * Root cause this fixes: client/src/pages/employee.tsx's create-worker
 * mutationFn parsed the POST /api/workers response (real UUID, real
 * companyId) but never returned it, so onSuccess showed a hardcoded
 * generic toast with no company, worker type, or UUID — even though the
 * server had already returned all of it (confirmed via a single 201 with
 * the full persisted row during PR #77 staging validation). This is the
 * same "discarded the server response" defect class PR #76 fixed in
 * employees.tsx and contractor-hub.tsx, recurring in a sibling file PR #76
 * never touched.
 *
 * These tests prove the confirmation is derived only from the server
 * response and the authoritative companies list — never a client-side
 * draft/temp value — and that sensitive fields (email, address, ssn, etc.)
 * never reach the confirmation text.
 *
 * Run: npx tsx tests/worker-created-confirmation.test.ts
 */
import { buildWorkerCreatedConfirmation } from "../client/src/lib/worker-created-confirmation";

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

const companies = [
  { id: "42b281dd-6503-4220-94c5-44e4b253b944", name: "Greenfield Solutions" },
  { id: "other-co", name: "Other Co" },
];

console.log("buildWorkerCreatedConfirmation — derives from the real server response");

{
  // The exact shape from the PR #77 staging validation: a real 201 response
  // for an Invoiced Contractor (1099) created in Greenfield Solutions.
  const r = buildWorkerCreatedConfirmation(
    {
      id: "dc26743f-17a8-4f9d-8e15-fcf0bb14f765",
      firstName: "ZZTEST",
      lastName: "PR77-20260820",
      companyId: "42b281dd-6503-4220-94c5-44e4b253b944",
      workerType: "contractor",
    },
    companies,
  );
  ok("includes the persisted worker's name", r.description.includes("ZZTEST PR77-20260820"), r.description);
  ok("resolves the company name from the authoritative companies list", r.description.includes("Greenfield Solutions"), r.description);
  ok("includes a Contractor type label", r.description.includes("Contractor"), r.description);
  ok("includes the real server-returned UUID", r.description.includes("dc26743f-17a8-4f9d-8e15-fcf0bb14f765"), r.description);
}

{
  const r = buildWorkerCreatedConfirmation(
    { id: "11111111-1111-1111-1111-111111111111", firstName: "Jane", lastName: "Doe", companyId: "other-co", workerType: "employee" },
    companies,
  );
  ok("labels an employee worker type correctly", r.description.includes("Employee"), r.description);
  ok("resolves a different company by id, not a hardcoded name", r.description.includes("Other Co"), r.description);
}

console.log("\nbuildWorkerCreatedConfirmation — degrades safely, never fabricates data");

{
  const r = buildWorkerCreatedConfirmation(
    { id: "22222222-2222-2222-2222-222222222222", firstName: "No", lastName: "Company", companyId: "unknown-id", workerType: "contractor" },
    companies,
  );
  ok("an unresolvable companyId shows an explicit unknown marker, not a wrong company", r.description.includes("Unknown company"), r.description);
}

console.log("\nbuildWorkerCreatedConfirmation — never leaks sensitive fields");

{
  const workerWithExtraFields: any = {
    id: "33333333-3333-3333-3333-333333333333",
    firstName: "Sensitive",
    lastName: "Test",
    companyId: "42b281dd-6503-4220-94c5-44e4b253b944",
    workerType: "contractor",
    email: "should-not-appear@example.com",
    ssn: "123-45-6789",
    address: "123 Should Not Appear St",
    payRate: "999999",
  };
  const r = buildWorkerCreatedConfirmation(workerWithExtraFields, companies);
  ok("does not include email even when present on the input object", !r.description.includes("should-not-appear"), r.description);
  ok("does not include ssn even when present on the input object", !r.description.includes("123-45-6789"), r.description);
  ok("does not include address even when present on the input object", !r.description.includes("Should Not Appear"), r.description);
  ok("does not include pay rate/compensation", !r.description.includes("999999"), r.description);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
