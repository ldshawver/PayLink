/**
 * Behavioural tests for the shared identity resolver
 * (server/identity/identity-resolver.ts) and the invite-token hygiene helpers
 * (server/identity/identity-db.ts). PR 1 — SaaS identity/onboarding.
 *
 * These import and call the REAL exported functions the routes use, so the
 * test and the implementation cannot drift. Pure — no DB, no network.
 *
 * Run: npx tsx tests/identity-resolver.test.ts
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  resolveSignerEmail,
  hasAnySignerEmail,
  normalizeEmail,
  type SignerEmailSources,
} from "../server/identity/identity-resolver";
import { hashInviteToken, generateInviteToken, INVITE_TTL_MS } from "../server/identity/identity-db";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("resolveSignerEmail — deterministic precedence");
{
  // canonical workers.email wins over everything
  const r = resolveSignerEmail({
    workerEmail: "canon@ex.com", workerWorkEmail: "work@ex.com",
    linkedUserEmail: "user@ex.com", linkedPersonEmail: "person@ex.com",
  });
  ok("workers.email is the top of the precedence order", r.email === "canon@ex.com" && r.source === "worker_email", JSON.stringify(r));
}
{
  // Allen Bongiorno case: no workers.email / work_email, but the linked login
  // account has one — must resolve, NOT report "no email on file".
  const r = resolveSignerEmail({ workerEmail: null, workerWorkEmail: null, linkedUserEmail: "allen@adiken.com" });
  ok("falls back to the linked user account email", r.email === "allen@adiken.com" && r.source === "linked_user_email", JSON.stringify(r));
  ok("hasAnySignerEmail is true for that case (drives the 'No email on file' UI)", hasAnySignerEmail({ linkedUserEmail: "allen@adiken.com" }));
}
{
  const r = resolveSignerEmail({ workerEmail: null, workerWorkEmail: null, linkedUserEmail: null, linkedPersonEmail: "p@ex.com" });
  ok("falls back to the linked global person email last", r.email === "p@ex.com" && r.source === "linked_person_email");
}
{
  const r = resolveSignerEmail({ workerWorkEmail: "w@ex.com", workerHomeEmail: "h@ex.com" });
  ok("work email beats home email", r.email === "w@ex.com" && r.source === "worker_work_email");
}

console.log("\nresolveSignerEmail — conflicts (reported, never merged, never blocking)");
{
  const r = resolveSignerEmail({ workerEmail: "canon@ex.com", linkedUserEmail: "different@ex.com" });
  ok("still returns one deterministic answer", r.email === "canon@ex.com");
  ok("reports the conflicting value for later cleanup", r.conflicts.includes("different@ex.com"));
}
{
  const r = resolveSignerEmail({ workerEmail: "a@ex.com", workerWorkEmail: "A@EX.COM  " });
  ok("case/whitespace-only differences are NOT a conflict", r.conflicts.length === 0, JSON.stringify(r.conflicts));
}
{
  const r = resolveSignerEmail({});
  ok("no source at all → null / no email / no conflicts", r.email === null && r.hasEmail === false && r.conflicts.length === 0);
}

console.log("\nresolveSignerEmail — never matches on name");
{
  // The resolver has no name inputs at all — a first/last name cannot influence
  // the result. This asserts the shape: the only keys are email sources.
  const keys = Object.keys({ workerEmail: 1, workerWorkEmail: 1, workerHomeEmail: 1, linkedUserEmail: 1, linkedPersonEmail: 1 } satisfies Record<keyof SignerEmailSources, number>);
  ok("SignerEmailSources exposes only email fields (no name field)", keys.every(k => k.toLowerCase().includes("email")));
}

console.log("\nnormalizeEmail");
ok("lower-cases and trims", normalizeEmail("  Foo@Bar.COM ") === "foo@bar.com");
ok("null/undefined → ''", normalizeEmail(null) === "" && normalizeEmail(undefined) === "");

console.log("\ninvite token hygiene");
{
  const raw = generateInviteToken();
  ok("generated token is URL-safe and long", /^[A-Za-z0-9_-]{20,}$/.test(raw));
  const h = hashInviteToken(raw);
  ok("hashInviteToken is sha256 hex (never the raw token)", /^[0-9a-f]{64}$/.test(h) && h !== raw);
  ok("hashing is deterministic", hashInviteToken(raw) === h);
  ok("matches a plain sha256 of the raw token", h === crypto.createHash("sha256").update(raw).digest("hex"));
  ok("two tokens differ", generateInviteToken() !== generateInviteToken());
}
ok("invite TTL is 14 days", INVITE_TTL_MS === 14 * 24 * 60 * 60 * 1000);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
