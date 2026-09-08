/**
 * Behavioral + static regression tests for:
 *  - Fix A: /send-for-signature refuses to silently reuse a Documenso envelope
 *    whose live recipient set no longer matches the contract's current signers
 *    (fails closed on verification failure too).
 *  - Fix B: POST /:id/replace-signing-request creates a replacement envelope,
 *    is idempotent, and preserves old request history as 'superseded'.
 *
 * Both handlers are non-exported Express routes inside registerRoutes, so —
 * consistent with tests/documenso-resend-behavior.test.ts and
 * tests/send-for-signature-token-preservation.test.ts already in this repo —
 * this file mirrors their exact control flow as standalone functions and
 * pairs that with static source assertions tying the harness back to the
 * real implementation. Not a full Express/DB integration test.
 *
 * Run: npx tsx tests/documenso-signer-set-mismatch.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";

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

function normalizeSignerEmail(email: string | null | undefined): string | null {
  const v = (email ?? "").trim().toLowerCase();
  return v || null;
}

/** Mirrors the Fix A comparison in /send-for-signature (server/routes.ts). */
function compareSignerSets(localEmailsRaw: string[], remoteEmailsRaw: string[]) {
  const localEmailSet = new Set(localEmailsRaw.map((e) => normalizeSignerEmail(e)).filter((e): e is string => !!e));
  const remoteEmailSet = new Set(remoteEmailsRaw.map((e) => normalizeSignerEmail(e)).filter((e): e is string => !!e));
  const missingRemotely = [...localEmailSet].filter((e) => !remoteEmailSet.has(e)).sort();
  const unexpectedRemotely = [...remoteEmailSet].filter((e) => !localEmailSet.has(e)).sort();
  return { missingRemotely, unexpectedRemotely, matches: missingRemotely.length === 0 && unexpectedRemotely.length === 0 };
}

/** Mirrors the fail-closed /send-for-signature reuse-verification control flow end to end. */
type MintedState = { mutated: boolean; response: any };
function runSendForSignature(opts: {
  isReusingExistingEnvelope: boolean;
  remoteGetThrows?: boolean;
  remoteRecipients?: Array<{ email: string }> | null; // null/undefined => malformed/no recipients
  localEmails: string[];
}): MintedState {
  let mutated = false;
  if (opts.isReusingExistingEnvelope) {
    if (opts.remoteGetThrows) {
      return { mutated, response: { status: 502, code: "documenso_envelope_verification_failed" } };
    }
    const remoteRecipientsList = Array.isArray(opts.remoteRecipients) ? opts.remoteRecipients : null;
    if (!remoteRecipientsList || remoteRecipientsList.length === 0) {
      return { mutated, response: { status: 503, code: "documenso_envelope_verification_unavailable" } };
    }
    const cmp = compareSignerSets(opts.localEmails, remoteRecipientsList.map((r) => r.email));
    if (!cmp.matches) {
      return {
        mutated,
        response: { status: 409, code: "documenso_signer_set_mismatch", missingRemotely: cmp.missingRemotely, unexpectedRemotely: cmp.unexpectedRemotely, replacementRequired: true },
      };
    }
  }
  // Only reached when sets match (or a fresh envelope, no reuse) — minting/persistence would occur here.
  mutated = true;
  return { mutated, response: { status: 200, reused: opts.isReusingExistingEnvelope } };
}

/** Mirrors the /replace-signing-request idempotency + supersede behavior over an in-memory store. */
type SigReqRow = { id: string; documentId: string; status: string };
function runReplaceSigningRequest(store: SigReqRow[], localEmails: string[], remoteEmailsForActiveEnvelope: string[]) {
  const active = [...store].reverse().find((r) => !["voided", "canceled", "cancelled", "deleted", "error", "superseded"].includes(r.status));
  if (active) {
    const cmp = compareSignerSets(localEmails, remoteEmailsForActiveEnvelope);
    if (cmp.matches) {
      return { success: true, alreadyReplaced: true, documentId: active.documentId, createdNewEnvelope: false };
    }
    active.status = "superseded"; // preserved, never deleted
  }
  const newRow: SigReqRow = { id: `req-${store.length + 1}`, documentId: `envelope-${store.length + 1}`, status: "sent_for_signature" };
  store.push(newRow);
  return { success: true, alreadyReplaced: false, documentId: newRow.documentId, createdNewEnvelope: true };
}

console.log("=== Documenso signer-set mismatch: Fix A + Fix B ===\n");

// ── Fix A behavioral: matching sets reuse the envelope ──
{
  const result = runSendForSignature({ isReusingExistingEnvelope: true, remoteRecipients: [{ email: "a@example.com" }, { email: "b@example.com" }], localEmails: ["a@example.com", "b@example.com"] });
  ok("matching local/remote signer sets: envelope is reused (200, mutated)", result.response.status === 200 && result.mutated === true);
}

// ── Fix A behavioral: local signer missing remotely => 409, no mutation ──
{
  const result = runSendForSignature({ isReusingExistingEnvelope: true, remoteRecipients: [{ email: "a@example.com" }], localEmails: ["a@example.com", "b@example.com"] });
  ok("local signer missing remotely: returns 409", result.response.status === 409 && result.response.code === "documenso_signer_set_mismatch");
  ok("local signer missing remotely: reports missingRemotely=[b@example.com]", JSON.stringify(result.response.missingRemotely) === JSON.stringify(["b@example.com"]));
  ok("local signer missing remotely: performs no mutation", result.mutated === false);
}

// ── Fix A behavioral: unexpected remote recipient => 409 ──
{
  const result = runSendForSignature({ isReusingExistingEnvelope: true, remoteRecipients: [{ email: "a@example.com" }, { email: "stranger@example.com" }], localEmails: ["a@example.com"] });
  ok("unexpected remote recipient: returns 409", result.response.status === 409);
  ok("unexpected remote recipient: reports unexpectedRemotely=[stranger@example.com]", JSON.stringify(result.response.unexpectedRemotely) === JSON.stringify(["stranger@example.com"]));
  ok("unexpected remote recipient: performs no mutation", result.mutated === false);
}

// ── Fix A behavioral: fail closed on GET throwing ──
{
  const result = runSendForSignature({ isReusingExistingEnvelope: true, remoteGetThrows: true, localEmails: ["a@example.com"] });
  ok("remote GET throws: returns 502, no mutation", result.response.status === 502 && result.mutated === false);
}

// ── Fix A behavioral: fail closed on no usable recipient list ──
{
  const result1 = runSendForSignature({ isReusingExistingEnvelope: true, remoteRecipients: null, localEmails: ["a@example.com"] });
  ok("remote returns no recipients array: returns 503, no mutation", result1.response.status === 503 && result1.mutated === false);
  const result2 = runSendForSignature({ isReusingExistingEnvelope: true, remoteRecipients: [], localEmails: ["a@example.com"] });
  ok("remote returns empty recipients array: returns 503, no mutation", result2.response.status === 503 && result2.mutated === false);
}

// ── Email comparison is normalized and order-independent ──
{
  const cmp = compareSignerSets(
    ["  Alice@Example.com ", "bob@example.com"],
    ["BOB@EXAMPLE.COM", "alice@example.com  "],
  );
  ok("email comparison normalizes case/whitespace and ignores order", cmp.matches === true, JSON.stringify(cmp));
}
{
  // Order reversed entirely, still matches.
  const cmp = compareSignerSets(["z@example.com", "a@example.com", "m@example.com"], ["M@Example.com", "A@Example.com", "Z@Example.com"]);
  ok("email comparison is order-independent across 3 signers", cmp.matches === true);
}

// ── Fix B behavioral: replacement creates exactly one new envelope ──
{
  const store: SigReqRow[] = [{ id: "req-0", documentId: "envelope-0", status: "sent_for_signature" }];
  const before = store.length;
  const result = runReplaceSigningRequest(store, ["a@example.com", "b@example.com"], ["a@example.com"]); // mismatch: b missing
  ok("replacement creates exactly one new envelope", result.createdNewEnvelope === true && store.length === before + 1);
  ok("replacement returns a new document id, distinct from the superseded one", result.documentId !== "envelope-0" && result.documentId.startsWith("envelope-"));
}

// ── Fix B behavioral: duplicate replacement submission is idempotent ──
{
  const store: SigReqRow[] = [{ id: "req-0", documentId: "envelope-0", status: "sent_for_signature" }];
  const first = runReplaceSigningRequest(store, ["a@example.com", "b@example.com"], ["a@example.com"]); // mismatch -> creates a new envelope
  const countAfterFirst = store.length;
  // Second call: the now-active envelope (envelope-1) matches the current signer set exactly.
  const second = runReplaceSigningRequest(store, ["a@example.com", "b@example.com"], ["a@example.com", "b@example.com"]);
  ok("duplicate replacement submission does not create a second new envelope", second.createdNewEnvelope === false && store.length === countAfterFirst);
  ok("duplicate replacement submission reports alreadyReplaced", second.alreadyReplaced === true && second.documentId === first.documentId);
}

// ── Fix B behavioral: old request history remains intact and is marked superseded ──
{
  const store: SigReqRow[] = [{ id: "req-0", documentId: "envelope-0", status: "sent_for_signature" }];
  runReplaceSigningRequest(store, ["a@example.com", "b@example.com"], ["a@example.com"]);
  ok("old request row still exists (never deleted)", store.some((r) => r.id === "req-0"));
  ok("old request row is marked superseded, not voided/deleted", store.find((r) => r.id === "req-0")?.status === "superseded");
  ok("exactly one new row was appended alongside the preserved old row", store.length === 2);
}

// ── Static: tie the harness back to the real implementation ──
const routes = fs.readFileSync("server/routes.ts", "utf8");

// Isolate /send-for-signature's body up to (not including) the token-mint loop, to prove the
// fail-closed / mismatch return paths sit strictly before any mutation begins.
const sendForSigStart = routes.indexOf('app.post("/api/contractor-contracts/:id/send-for-signature"');
const mintLoopMarker = routes.indexOf("const signerTokens = new Map", sendForSigStart);
const preMintSlice = sendForSigStart >= 0 && mintLoopMarker > sendForSigStart ? routes.slice(sendForSigStart, mintLoopMarker) : "";

ok("send-for-signature: handler and mint-loop markers both found for static slicing", sendForSigStart >= 0 && mintLoopMarker > sendForSigStart);
ok(
  "send-for-signature: all three fail-closed/mismatch responses occur before token minting begins",
  preMintSlice.includes("documenso_envelope_verification_failed") &&
    preMintSlice.includes("documenso_envelope_verification_unavailable") &&
    preMintSlice.includes("documenso_signer_set_mismatch"),
);
ok(
  "send-for-signature: no INSERT/UPDATE statement occurs before the mismatch checks resolve",
  !/INSERT INTO|UPDATE contract_signers|UPDATE documenso_signature_requests/i.test(preMintSlice),
);
ok(
  "send-for-signature: reuse query excludes superseded requests",
  routes.includes("NOT IN ('voided','canceled','cancelled','deleted','error','superseded')"),
);
ok(
  "send-for-signature: comparison covers all non-removed local signers, not just pending ones",
  routes.includes("status NOT IN ('replaced', 'canceled', 'cancelled', 'voided', 'void', 'declined')"),
);

const replaceRouteStart = routes.indexOf('app.post("/api/contractor-contracts/:id/replace-signing-request"');
ok("replace-signing-request route exists", replaceRouteStart >= 0);
const replaceSlice = replaceRouteStart >= 0 ? routes.slice(replaceRouteStart, replaceRouteStart + 10000) : "";
const replaceRouteDeclarationLine = replaceRouteStart >= 0 ? routes.slice(replaceRouteStart, routes.indexOf("\n", replaceRouteStart)) : "";

ok(
  "replace-signing-request: requires admin/manager role and company-scoped access (assertContractCompanyAccess)",
  replaceRouteDeclarationLine.includes('requireRole("admin", "manager")') &&
    replaceSlice.includes("assertContractCompanyAccess(contractId, req.session.userId!)"),
);
ok(
  "replace-signing-request: requires explicit confirmation before proceeding",
  replaceSlice.includes("confirmation_required") && replaceSlice.includes("req.body?.confirm"),
);
ok(
  "replace-signing-request: never DELETEs the old request row, only marks it superseded",
  replaceSlice.includes("SET status = 'superseded'") && !/DELETE FROM documenso_signature_requests/i.test(replaceSlice),
);
ok(
  "replace-signing-request: records the replacement in the audit trail",
  replaceSlice.includes('actionType: "documenso_envelope_replaced"'),
);
ok(
  "replace-signing-request: is idempotent against duplicate submissions (checks alreadyReplaced before creating)",
  replaceSlice.includes("alreadyReplaced: true") && replaceSlice.includes("missingRemotely.length === 0 && unexpectedRemotely.length === 0"),
);
ok(
  "replace-signing-request: never mutates the old Documenso envelope itself (no void/delete call to Documenso)",
  !/voidDocumensoDocument|voidDocument\(/.test(replaceSlice),
);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
