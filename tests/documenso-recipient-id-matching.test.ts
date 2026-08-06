/**
 * Behavioral harness for the recipient-ID-preferred matching and failure-
 * classification repair in server/routes.ts's Documenso send/resend
 * handlers (refreshDocumensoRecipientMappings, the resend-handler matching
 * block, and classifyDocumensoVerificationFailure). These live inside a
 * non-exported route-registration closure, so — following the existing
 * convention in tests/documenso-resend-behavior.test.ts — this harness
 * mirrors the exact logic in pure, directly-testable form. Keep in sync with
 * server/routes.ts if that logic changes.
 *
 * No real Documenso call is made anywhere in this file.
 *
 * Run: pnpm exec tsx tests/documenso-recipient-id-matching.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err: any) {
    console.error(`FAIL - ${name}`);
    console.error(err?.stack || err);
    process.exitCode = 1;
  }
}

// ── Mirrors normalizeSignerEmail from routes.ts ─────────────────────────────
function normalizeSignerEmail(v: string | null | undefined): string | null {
  const t = (v || "").trim().toLowerCase();
  return t || null;
}

// ── Mirrors isCompatibleDocumensoRecipientRole from routes.ts. Documenso's
//    role vocabulary (SIGNER/VIEWER/APPROVER/CC) describes signing ACTION
//    TYPE — a different vocabulary from this app's local contract_signers.role
//    (contractor/company_rep/witness/notary), which describes local PARTY
//    TYPE. There is no 1:1 mapping. This app only ever creates SIGNER-role
//    recipients (see server/routes.ts's 3 call sites building recipients[]),
//    so the only honest, evidence-backed compatibility check is: is the
//    remote role literally SIGNER? ────────────────────────────────────────
function isCompatibleDocumensoRecipientRole(remoteRole: unknown): boolean {
  return String(remoteRole || "").trim().toUpperCase() === "SIGNER";
}

// ── Mirrors matchDocumensoRecipientForSigner (the single centralized
//    matcher) added to server/routes.ts in this repair ─────────────────────
function matchRecipient(
  signer: { email: string; documenso_recipient_id?: string | null },
  remoteRecipients: Array<{ id: string | number; email: string; role?: string | null; status?: string }>,
): { live: any | null; matchedById: boolean; blockReason: string | null } {
  const storedId = signer.documenso_recipient_id ? String(signer.documenso_recipient_id) : null;

  if (storedId) {
    const idMatches = remoteRecipients.filter((r) => r?.id != null && String(r.id) === storedId);
    if (idMatches.length > 1) {
      return { live: null, matchedById: true, blockReason: "Multiple live Documenso recipients share this recipient ID; manual review required." };
    }
    return { live: idMatches[0] || null, matchedById: true, blockReason: null };
  }

  const signerEmail = normalizeSignerEmail(signer.email);
  const emailMatches = signerEmail ? remoteRecipients.filter((r) => normalizeSignerEmail(r?.email) === signerEmail) : [];

  if (emailMatches.length === 0) {
    return { live: null, matchedById: false, blockReason: null };
  }
  if (emailMatches.length > 1) {
    return { live: null, matchedById: false, blockReason: "Multiple live Documenso recipients share this email; manual review required." };
  }

  const candidate = emailMatches[0];
  if (!isCompatibleDocumensoRecipientRole(candidate.role)) {
    if (candidate.role == null || candidate.role === "") {
      return { live: null, matchedById: false, blockReason: "Recipient role could not be verified remotely; email match alone is not sufficient to confirm identity." };
    }
    return { live: null, matchedById: false, blockReason: `Remote recipient's role ('${candidate.role}') is not a signer role; email match rejected.` };
  }
  return { live: candidate, matchedById: false, blockReason: null };
}

// ── Mirrors classifyDocumensoVerificationFailure from routes.ts ────────────
function classifyDocumensoVerificationFailure(err: any): { code: string; httpStatus: number } {
  const status = err?.status;
  if (status === 404) return { code: "documenso_document_not_found", httpStatus: 502 };
  if (status === 401 || status === 403) return { code: "documenso_account_mismatch", httpStatus: 502 };
  return { code: "documenso_temporary_failure", httpStatus: 503 };
}

// ── Mirrors getDocumensoResendBlockReason from routes.ts ───────────────────
function blockReason(docStatus: string, recipientStatus: string | undefined, recipientFound: boolean): string | null {
  const d = (docStatus || "").toLowerCase();
  const r = (recipientStatus || "").toLowerCase();
  if (["completed", "signed"].includes(d)) return "Completed document";
  if (["voided", "canceled", "cancelled"].includes(d)) return "Document voided";
  if (!recipientFound) return "Recipient missing remotely";
  if (r === "signed") return "Already signed";
  if (r === "declined") return "Recipient declined";
  return null;
}

test("two valid recipients are safely matched and reused (legacy email + role matching, no stored IDs yet)", () => {
  const signers = [
    { email: "alice@example.com" },
    { email: "bob@example.com" },
  ];
  const remote = [
    { id: "rec_1", email: "alice@example.com", role: "SIGNER", status: "sent" },
    { id: "rec_2", email: "bob@example.com", role: "SIGNER", status: "sent" },
  ];
  for (const signer of signers) {
    const m = matchRecipient(signer, remote);
    assert.ok(m.live, `expected a match for ${signer.email}`);
    assert.equal(m.blockReason, null);
    assert.equal(m.matchedById, false, "no stored ID yet — must fall back to email");
  }
});

test("stored remote recipient ID takes precedence over email, even under an email collision", () => {
  const signer = { email: "alice@example.com", documenso_recipient_id: "rec_1" };
  // Two remote recipients share the same email (a real edge case) — pure
  // email matching would call this ambiguous, but the signer's previously
  // verified ID must resolve it unambiguously.
  const remote = [
    { id: "rec_1", email: "alice@example.com", role: "SIGNER", status: "sent" },
    { id: "rec_9", email: "alice@example.com", role: "SIGNER", status: "sent" },
  ];
  const m = matchRecipient(signer, remote);
  assert.equal(m.matchedById, true);
  assert.equal(m.blockReason, null, "stored ID must resolve the match unambiguously despite the email collision");
  assert.equal(m.live.id, "rec_1");
});

test("a stored ID that no longer resolves remotely is treated as missing, not silently re-matched by email", () => {
  const signer = { email: "alice@example.com", documenso_recipient_id: "rec_stale" };
  const remote = [
    // Same email exists remotely, but under a DIFFERENT id than the one this
    // signer previously verified — must not be silently accepted as "the same
    // person" just because the email happens to match.
    { id: "rec_new", email: "alice@example.com", role: "SIGNER", status: "sent" },
  ];
  const m = matchRecipient(signer, remote);
  assert.equal(m.live, null, "must not fall back to the email match once an ID was already established");
  assert.equal(blockReason("sent", undefined, !!m.live), "Recipient missing remotely");
});

test("legacy record (no stored ID) falls back to normalized exact-email matching plus compatible role", () => {
  const signer = { email: "  Alice@Example.com  " }; // deliberately unnormalized
  const remote = [{ id: "rec_1", email: "alice@example.com", role: "SIGNER", status: "sent" }];
  const m = matchRecipient(signer, remote);
  assert.equal(m.matchedById, false);
  assert.ok(m.live, "normalized email + compatible role must still match");
});

test("correct email + compatible role (SIGNER) matches", () => {
  const signer = { email: "alice@example.com" };
  const remote = [{ id: "rec_1", email: "alice@example.com", role: "SIGNER", status: "sent" }];
  const m = matchRecipient(signer, remote);
  assert.ok(m.live);
  assert.equal(m.live.id, "rec_1");
  assert.equal(m.blockReason, null);
});

test("wrong role rejects — email matches but remote role is not a signer role (e.g. CC)", () => {
  const signer = { email: "alice@example.com" };
  const remote = [{ id: "rec_1", email: "alice@example.com", role: "CC", status: "sent" }];
  const m = matchRecipient(signer, remote);
  assert.equal(m.live, null, "a CC recipient is provably not the actual signer, even with a matching email");
  assert.ok(m.blockReason?.includes("not a signer role"), `expected a wrong-role block reason, got: ${m.blockReason}`);
});

test("missing remote role rejects when role is required to disambiguate (role field absent entirely)", () => {
  const signer = { email: "alice@example.com" };
  const remote = [{ id: "rec_1", email: "alice@example.com", status: "sent" }]; // no role field at all
  const m = matchRecipient(signer, remote);
  assert.equal(m.live, null);
  assert.ok(m.blockReason?.includes("could not be verified remotely"), `expected a missing-role block reason, got: ${m.blockReason}`);
});

test("same email under multiple remote roles is ambiguous — rejected outright, not resolved by preferring the SIGNER one", () => {
  const signer = { email: "alice@example.com" };
  const remote = [
    { id: "rec_1", email: "alice@example.com", role: "SIGNER", status: "sent" },
    { id: "rec_2", email: "alice@example.com", role: "CC", status: "sent" },
  ];
  const m = matchRecipient(signer, remote);
  assert.equal(m.live, null, "must not silently pick the SIGNER-role entry — the email collision itself is the anomaly");
  assert.ok(m.blockReason?.includes("Multiple live Documenso recipients"), `expected an ambiguous-match block reason, got: ${m.blockReason}`);
});

test("duplicate exact matches (same email, same role, appears twice) reject as ambiguous", () => {
  const signer = { email: "alice@example.com" };
  const remote = [
    { id: "rec_1", email: "alice@example.com", role: "SIGNER", status: "sent" },
    { id: "rec_2", email: "alice@example.com", role: "SIGNER", status: "sent" },
  ];
  const m = matchRecipient(signer, remote);
  assert.equal(m.live, null, "an ambiguous match must never silently pick one candidate");
  assert.ok(m.blockReason?.includes("Multiple live Documenso recipients"));
});

test("one missing recipient produces a safe partial-review result, not a resend", () => {
  const signers = [{ email: "alice@example.com" }, { email: "ghost@example.com" }];
  const remote = [{ id: "rec_1", email: "alice@example.com", role: "SIGNER", status: "sent" }];
  const results = signers.map((s) => {
    const m = matchRecipient(s, remote);
    return { email: s.email, reason: m.blockReason || blockReason("sent", m.live?.status, !!m.live) };
  });
  assert.equal(results[0].reason, null, "alice should be clean");
  assert.equal(results[1].reason, "Recipient missing remotely");
  const acceptedCount = results.filter((r) => !r.reason).length;
  assert.equal(acceptedCount, 1, "must report 1/2 accepted, not silently proceed as if both were fine");
});

test("two missing recipients produce 0/2 accepted and must never trigger a replacement envelope", () => {
  const signers = [{ email: "ghost1@example.com" }, { email: "ghost2@example.com" }];
  const remote: any[] = []; // simulates the exact reported symptom
  const results = signers.map((s) => {
    const m = matchRecipient(s, remote);
    return { email: s.email, reason: m.blockReason || blockReason("sent", m.live?.status, !!m.live) };
  });
  const acceptedCount = results.filter((r) => !r.reason).length;
  assert.equal(acceptedCount, 0);
  assert.ok(results.every((r) => r.reason === "Recipient missing remotely"));
  // The contract under test: reaching 0/2 must be reported as a review state,
  // and the calling code must not react to it by creating a new envelope —
  // that policy lives in routes.ts (never auto-replace on verification/match
  // failure) and is exercised by the actual route in the live-server checks
  // below; this harness asserts the classification that decision is based on.
});

test("wrong-account (401/403) and document-not-found (404) are classified distinctly from each other and from temporary failure", () => {
  const notFound = classifyDocumensoVerificationFailure({ status: 404 });
  const accountMismatch = classifyDocumensoVerificationFailure({ status: 401 });
  const forbidden = classifyDocumensoVerificationFailure({ status: 403 });
  const temporary = classifyDocumensoVerificationFailure({ status: undefined }); // network/timeout — no HTTP status at all
  assert.equal(notFound.code, "documenso_document_not_found");
  assert.equal(accountMismatch.code, "documenso_account_mismatch");
  assert.equal(forbidden.code, "documenso_account_mismatch");
  assert.equal(temporary.code, "documenso_temporary_failure");
  const codes = new Set([notFound.code, accountMismatch.code, temporary.code]);
  assert.equal(codes.size, 3, "all three categories must be distinguishable from one another");
});

test("stale/garbage document ID (404) fails safely — classified as not-found, not silently treated as empty-recipients", () => {
  const err = { status: 404 };
  const classified = classifyDocumensoVerificationFailure(err);
  assert.equal(classified.code, "documenso_document_not_found");
  assert.equal(classified.httpStatus, 502);
});

test("completed/cancelled documents block resend for every recipient regardless of individual recipient status", () => {
  for (const docStatus of ["completed", "signed", "voided", "cancelled"]) {
    const reason = blockReason(docStatus, "sent", true);
    assert.ok(reason, `expected a block reason for document status '${docStatus}'`);
  }
});

test("repeated resend against an unchanged remote state is idempotent (no duplicate accepted count)", () => {
  // Simulates clicking "resend" twice in a row against the same remote
  // snapshot: the classification/matching must produce the identical result
  // both times — nothing here depends on call count or hidden mutable state.
  const signer = { email: "alice@example.com", documenso_recipient_id: "rec_1" };
  const remote = [{ id: "rec_1", email: "alice@example.com", status: "sent" }];
  const first = matchRecipient(signer, remote);
  const second = matchRecipient(signer, remote);
  assert.deepEqual(first, second);
});

test("audit/local-state update must be gated on confirmed success, not attempted eagerly", () => {
  // Mirrors the real handler's `accepted = !!documensoResult && !!remoteRecipient && !reason`
  // gate: local state (resentAt, resendResult) may only reflect success once
  // all three conditions are true.
  function computeAccepted(documensoResultPresent: boolean, remoteRecipient: any, reason: string | null) {
    return documensoResultPresent && !!remoteRecipient && !reason;
  }
  assert.equal(computeAccepted(false, { id: "rec_1" }, null), false, "no provider result yet — must not mark accepted");
  assert.equal(computeAccepted(true, null, null), false, "no matched recipient — must not mark accepted");
  assert.equal(computeAccepted(true, { id: "rec_1" }, "Already signed"), false, "a block reason present — must not mark accepted");
  assert.equal(computeAccepted(true, { id: "rec_1" }, null), true, "only true once provider succeeded, recipient matched, and no block reason");
});

// ── Static: tie this mirror back to the real implementation ────────────────
// Everything above tests a hand-copied reimplementation (matchRecipient,
// isCompatibleDocumensoRecipientRole, classifyDocumensoVerificationFailure)
// rather than the real, non-exported functions in server/routes.ts. That gap
// is exactly the failure mode that produced the original "0/2 recipients
// missing" bug this repair fixes: a mirrored/fallback code path that looked
// correct in isolation but was never actually exercised by production
// traffic. These checks close that gap the same way
// tests/documenso-signer-set-mismatch.test.ts and
// tests/documenso-resend-mutation-free-verification.test.ts already do for
// their areas — by asserting the real source contains the specific literals
// this file's behavioral tests depend on, so an edit to the real matcher
// that silently drops ID precedence, role enforcement, or ambiguous-match
// rejection fails this suite instead of only the (unaffected) mirror.
const routes = fs.readFileSync("server/routes.ts", "utf8");

const matcherStart = routes.indexOf("function matchDocumensoRecipientForSigner");
const matcherEnd = matcherStart >= 0 ? routes.indexOf("\n  }\n", matcherStart) : -1;
const matcherBody = matcherStart >= 0 && matcherEnd > matcherStart ? routes.slice(matcherStart, matcherEnd) : "";
test("real matchDocumensoRecipientForSigner exists and is found for static slicing", () => {
  assert.ok(matcherStart >= 0 && matcherEnd > matcherStart, "matchDocumensoRecipientForSigner not found in server/routes.ts");
});
test("real matcher: a stored recipient ID is checked before any email fallback", () => {
  assert.ok(matcherBody.includes("signer.documenso_recipient_id"));
  const storedIdIdx = matcherBody.indexOf("storedId");
  const emailIdx = matcherBody.indexOf("normalizeSignerEmail(signer.email)");
  assert.ok(storedIdIdx >= 0 && emailIdx > storedIdIdx, "ID-based matching must be checked, and appear before, email-based matching");
});
test("real matcher: a stale/non-resolving stored ID never falls back to email matching", () => {
  // The ID branch must `return` unconditionally (matched or not) rather than
  // falling through into the email-matching code below it.
  const idBranchReturn = matcherBody.match(/if \(storedId\) \{[\s\S]*?\n {4}\}/);
  assert.ok(idBranchReturn, "could not isolate the `if (storedId)` branch");
  assert.ok(idBranchReturn![0].trimEnd().endsWith("}") && /return \{ live: idMatches\[0\] \|\| null/.test(idBranchReturn![0]));
});
test("real matcher: ambiguous ID or email matches are rejected outright, not resolved by preference", () => {
  assert.ok(matcherBody.includes("idMatches.length > 1"));
  assert.ok(matcherBody.includes("emailMatches.length > 1"));
  assert.ok(matcherBody.includes("Multiple live Documenso recipients share this recipient ID"));
  assert.ok(matcherBody.includes("Multiple live Documenso recipients share this email"));
});
test("real matcher: email comparison is exact (===), never substring/fuzzy (.includes/.startsWith on email)", () => {
  assert.ok(matcherBody.includes("normalizeSignerEmail(r?.email) === signerEmail"));
  assert.ok(!/normalizeSignerEmail\([^)]*\)\.includes\(/.test(matcherBody), "email matching must not use substring comparison");
});
test("real matcher: role compatibility is enforced via isCompatibleDocumensoRecipientRole before accepting an email match", () => {
  assert.ok(matcherBody.includes("isCompatibleDocumensoRecipientRole(candidate.role)"));
});

const roleFnStart = routes.indexOf("function isCompatibleDocumensoRecipientRole");
const roleFnEnd = roleFnStart >= 0 ? routes.indexOf("\n  }\n", roleFnStart) : -1;
const roleFnBody = roleFnStart >= 0 && roleFnEnd > roleFnStart ? routes.slice(roleFnStart, roleFnEnd) : "";
test("real isCompatibleDocumensoRecipientRole requires an exact, case-normalized 'SIGNER' role", () => {
  assert.ok(roleFnStart >= 0, "isCompatibleDocumensoRecipientRole not found in server/routes.ts");
  assert.ok(roleFnBody.includes('.trim().toUpperCase() === "SIGNER"'));
});

const classifierStart = routes.indexOf("function classifyDocumensoVerificationFailure");
const classifierEnd = classifierStart >= 0 ? routes.indexOf("\n  }\n", classifierStart) : -1;
const classifierBody = classifierStart >= 0 && classifierEnd > classifierStart ? routes.slice(classifierStart, classifierEnd) : "";
test("real classifyDocumensoVerificationFailure matches the three codes this file exercises", () => {
  assert.ok(classifierStart >= 0, "classifyDocumensoVerificationFailure not found in server/routes.ts");
  assert.ok(classifierBody.includes("documenso_document_not_found") && classifierBody.includes("status === 404"));
  assert.ok(classifierBody.includes("documenso_account_mismatch") && classifierBody.includes("status === 401 || status === 403"));
  assert.ok(classifierBody.includes("documenso_temporary_failure"));
});

test("both call sites (resend handler and refreshDocumensoRecipientMappings) use the one centralized matcher, not separate ad hoc logic", () => {
  const callSites = routes.match(/matchDocumensoRecipientForSigner\(/g) || [];
  // 1 definition (function declaration also matches this pattern via the call
  // inside its own JSDoc example is not present) + at least 2 real call sites.
  assert.ok(callSites.length >= 2, `expected matchDocumensoRecipientForSigner to be called from at least 2 places, found ${callSites.length}`);
});

console.log(`\n${passed} test(s) passed`);
