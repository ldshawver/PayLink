/**
 * Behavioural tests for the pure parts of contractor access requests (PR 2):
 * public input validation/sanitisation and the in-memory abuse guard. Imports
 * the REAL exported functions the route uses. No DB, no network.
 *
 * Run: npx tsx tests/contractor-access-requests.test.ts
 */
import assert from "node:assert/strict";
import { normalizeAccessRequestInput, isRateLimited } from "../server/identity/contractor-access-requests";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, d?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${d ? ` — ${d}` : ""}`); }
};

console.log("normalizeAccessRequestInput — required fields");
ok("rejects missing name", !normalizeAccessRequestInput({ email: "a@b.com" }).ok);
ok("rejects missing/invalid email", !normalizeAccessRequestInput({ firstName: "A", lastName: "B", email: "nope" }).ok);
ok("rejects empty body", !normalizeAccessRequestInput({}).ok);

console.log("\nnormalizeAccessRequestInput — sanitisation");
{
  const r = normalizeAccessRequestInput({
    firstName: "  Al  ", lastName: "Bongiorno\t", email: "  ALLEN@Example.COM ",
    phone: "555-1234", businessName: "Al's Trades", tradeType: "Electrical",
    licenseNumber: "EL-99", requestedCompany: "Greenfield", message: "hi\u0000\u0007 there",
  });
  assert.ok(r.ok);
  ok("trims + collapses whitespace in names", r.value.firstName === "Al" && r.value.lastName === "Bongiorno");
  ok("lower-cases the email", r.value.email === "allen@example.com");
  ok("keeps optional fields", r.value.businessName === "Al's Trades" && r.value.tradeType === "Electrical" && r.value.licenseNumber === "EL-99");
  ok("maps requestedCompany → requestedCompanyHint", r.value.requestedCompanyHint === "Greenfield");
  ok("strips control chars from message", !/[\u0000-\u001f]/.test(r.value.message || ""));
}
{
  const r = normalizeAccessRequestInput({ firstName: "A", lastName: "B", email: "a@b.com" });
  assert.ok(r.ok);
  ok("empty optional fields normalise to null", r.value.phone === null && r.value.businessName === null && r.value.message === null);
}
{
  const long = "x".repeat(5000);
  const r = normalizeAccessRequestInput({ firstName: "A", lastName: "B", email: "a@b.com", message: long });
  assert.ok(r.ok);
  ok("caps message length", (r.value.message || "").length <= 2000);
}
{
  const r = normalizeAccessRequestInput({ firstName: "A", lastName: "B", email: "a@b.com", licenseNumber: 12345 });
  assert.ok(r.ok);
  ok("non-string optional field → null (no coercion)", r.value.licenseNumber === null);
}

console.log("\nisRateLimited — per-IP window");
{
  const ip = "203.0.113." + Math.floor(Math.random() * 250);
  const hits = [1, 2, 3, 4, 5].map(() => isRateLimited(ip, 5, 60_000));
  ok("first 5 within the window are allowed", hits.every(h => h === false));
  ok("the 6th is blocked", isRateLimited(ip, 5, 60_000) === true);
}
{
  const ip = "198.51.100." + Math.floor(Math.random() * 250);
  ok("a fresh IP starts unblocked", isRateLimited(ip, 5, 60_000) === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
