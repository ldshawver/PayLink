/**
 * Behavioural tests for the pure parts of the vendor portal (PR 3): vendor +
 * invoice + document input validation/sanitisation, and the invite→subject_type
 * mapping that decides whether an accepted invite links to a `worker` or a
 * `vendor` identity subject. Imports the REAL exported functions the routes and
 * acceptInviteWithUser use. No DB, no network.
 *
 * Run: npx tsx tests/vendor-portal.test.ts
 */
import assert from "node:assert/strict";
import {
  normalizeVendorInput, normalizeVendorPatch, normalizeVendorInvoiceInput, normalizeVendorDocumentType,
} from "../server/identity/vendors";
import { inviteSubjectType } from "../server/identity/identity-db";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, d?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${d ? ` — ${d}` : ""}`); }
};

console.log("normalizeVendorInput — required + sanitisation");
ok("rejects a missing business name", !normalizeVendorInput({}).ok);
ok("rejects a blank business name", !normalizeVendorInput({ businessName: "   " }).ok);
ok("rejects an invalid email", !normalizeVendorInput({ businessName: "Acme", email: "nope" }).ok);
{
  const r = normalizeVendorInput({
    businessName: "  Acme  Supply  ", contactName: "Dana\tLee", email: "  BILLING@Acme.COM ",
    phone: "555-1000", taxId: "12-3456789", serviceType: "Janitorial", notes: "clean\u0000\u0007 up",
  });
  assert.ok(r.ok);
  ok("collapses whitespace in business name", r.value.businessName === "Acme Supply");
  ok("lower-cases the email", r.value.email === "billing@acme.com");
  ok("keeps optional fields", r.value.taxId === "12-3456789" && r.value.serviceType === "Janitorial");
  ok("strips control chars from notes", !/[\u0000-\u001f\u007f]/.test(r.value.notes || ""));
}
{
  const r = normalizeVendorInput({ businessName: "Acme" });
  assert.ok(r.ok);
  ok("empty optional fields normalise to null", r.value.email === null && r.value.phone === null && r.value.notes === null);
}
{
  const r = normalizeVendorInput({ businessName: "Acme", phone: 12345 });
  assert.ok(r.ok);
  ok("non-string optional field → null (no coercion)", r.value.phone === null);
}
{
  const r = normalizeVendorInput({ businessName: "x".repeat(5000) });
  assert.ok(r.ok);
  ok("caps business name length", r.value.businessName.length <= 160);
}

console.log("\nnormalizeVendorPatch — partial, contact-only");
ok("rejects an empty patch", !normalizeVendorPatch({}).ok);
ok("rejects clearing the business name to blank", !normalizeVendorPatch({ businessName: "  " }).ok);
{
  const r = normalizeVendorPatch({ phone: "555-2000", email: "" });
  assert.ok(r.ok);
  ok("only provided keys are present", "phone" in r.value && "email" in r.value && !("city" in r.value));
  ok("explicit empty string clears to null", r.value.email === null);
}
{
  const r = normalizeVendorPatch({ email: "bad@" });
  ok("rejects an invalid email in a patch", !r.ok);
}

console.log("\nnormalizeVendorInvoiceInput — amounts, currency, dates");
{
  const r = normalizeVendorInvoiceInput({ amount: "1234.5", currency: "usd", invoiceDate: "2026-09-01" });
  assert.ok(r.ok);
  ok("amount is a fixed-2 decimal string", r.value.amount === "1234.50");
  ok("currency upper-cased", r.value.currency === "USD");
  ok("valid ISO date kept", r.value.invoiceDate === "2026-09-01");
}
ok("rejects a negative amount", !normalizeVendorInvoiceInput({ amount: "-5" }).ok);
ok("rejects a non-numeric amount", !normalizeVendorInvoiceInput({ amount: "abc" }).ok);
ok("rejects a malformed date", !normalizeVendorInvoiceInput({ dueDate: "09/01/2026" }).ok);
ok("rejects a 4-letter currency", !normalizeVendorInvoiceInput({ currency: "USDD" }).ok);
{
  const r = normalizeVendorInvoiceInput({});
  assert.ok(r.ok);
  ok("empty invoice → null amount (never coerced to 0), USD default", r.value.amount === null && r.value.currency === "USD");
}

console.log("\nnormalizeVendorDocumentType — allowlist");
ok("known type kept", normalizeVendorDocumentType("insurance") === "insurance");
ok("case-insensitive", normalizeVendorDocumentType("W9") === "w9");
ok("unknown type → 'other'", normalizeVendorDocumentType("passport") === "other");
ok("missing → 'w9'", normalizeVendorDocumentType(undefined) === "w9");

console.log("\ninviteSubjectType — worker vs vendor subject");
ok("vendor invite → 'vendor' subject", inviteSubjectType("vendor") === "vendor");
ok("employee invite → 'worker' subject", inviteSubjectType("employee") === "worker");
ok("contractor invite → 'worker' subject", inviteSubjectType("contractor") === "worker");
ok("customer_owner / platform → no subject link", inviteSubjectType("customer_owner") === null && inviteSubjectType("platform") === null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
