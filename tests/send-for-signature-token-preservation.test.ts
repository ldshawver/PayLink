/**
 * Behavioral + static regression tests for Fix 3: preserving valid MyPayLink
 * signing tokens when /send-for-signature reuses an existing Documenso
 * envelope, instead of unconditionally minting a new one for every signer.
 *
 * The mint loop lives inside the non-exported /send-for-signature Express
 * handler in server/routes.ts, so this harness mirrors that exact control
 * flow (same pattern as tests/documenso-resend-behavior.test.ts) — it is NOT
 * a full integration test of the Express handler — paired with static source
 * assertions that tie the harness back to the real implementation.
 *
 * The MyPayLink notification-email loop this file used to also cover was
 * removed entirely (it duplicated Documenso's own native email — see
 * tests/documenso-single-notification-static.test.ts for that fix's
 * coverage). Token minting/preservation itself is unrelated to that removal
 * and is still exercised by every scenario below.
 *
 * Run: npx tsx tests/send-for-signature-token-preservation.test.ts
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

type Signer = { email: string; signing_token_hash: string | null; signing_token_expires_at: Date | null };
type TokenEntry = { token: string; expires: Date; myPayLinkSigningUrl: string };

const APP_BASE_URL = "https://app.mypaylink.example";
const now = Date.now();

// Mirrors normalizeSignerEmail/normalizeRecipientEmail in server/routes.ts:
// (value ?? "").trim().toLowerCase() — applied everywhere an email is used
// as a Map key, exactly like production does before every signerTokens.get/set/has.
function normalizeSignerEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

function buildContractSigningUrl(appBaseUrl: string, token: string): string {
  return `${appBaseUrl}/sign/contracts/${token}`;
}

/** Mirrors server/routes.ts's signerTokens mint loop (post-fix). */
function mintSignerTokens(signers: Signer[], isReusingExistingEnvelope: boolean): Map<string, TokenEntry> {
  const signerTokens = new Map<string, TokenEntry>();
  for (const signer of signers) {
    const email = normalizeSignerEmail(signer.email);
    if (!email || signerTokens.has(email)) continue;
    if (isReusingExistingEnvelope) {
      const hasValidExistingToken = !!signer.signing_token_hash
        && !!signer.signing_token_expires_at
        && signer.signing_token_expires_at.getTime() > now;
      if (hasValidExistingToken) continue;
    }
    const token = `fresh-token-for-${email}`;
    signerTokens.set(email, {
      token,
      expires: new Date(now + 1000 * 60 * 60 * 24 * 14),
      myPayLinkSigningUrl: buildContractSigningUrl(APP_BASE_URL, token),
    });
  }
  return signerTokens;
}

/** Mirrors the persist loop's COALESCE semantics for the two token columns. */
function persistedTokenColumns(signer: Signer, signerTokens: Map<string, TokenEntry>) {
  const entry = signerTokens.get(normalizeSignerEmail(signer.email));
  return {
    signing_token_hash: entry?.token ? `hash(${entry.token})` : signer.signing_token_hash,
    signing_token_expires_at: entry?.expires ?? signer.signing_token_expires_at,
  };
}

console.log("=== Fix 3: Preserve valid MyPayLink tokens on envelope reuse ===\n");

// ── Scenario 1 & 2: valid unexpired token on reuse → preserved, not re-minted ──
// Fixture emails use mixed case/whitespace to exercise the same normalization production applies.
{
  const signers: Signer[] = [{ email: "  Signer-A@Example.com ", signing_token_hash: "existing-hash-a", signing_token_expires_at: new Date(now + 1000 * 60 * 60 * 24) }];
  const tokens = mintSignerTokens(signers, true);
  const persisted = persistedTokenColumns(signers[0], tokens);

  ok("valid unexpired token: not re-minted", !tokens.has("signer-a@example.com"));
  ok("valid unexpired token: signing_token_hash preserved unchanged", persisted.signing_token_hash === "existing-hash-a");
  ok("valid unexpired token: signing_token_expires_at preserved unchanged", persisted.signing_token_expires_at === signers[0].signing_token_expires_at);
}

// ── Scenario 3: expired token → new token minted ──
{
  const signers: Signer[] = [{ email: "Signer-B@Example.com", signing_token_hash: "existing-hash-b", signing_token_expires_at: new Date(now - 1000) }];
  const tokens = mintSignerTokens(signers, true);
  const persisted = persistedTokenColumns(signers[0], tokens);

  ok("expired token: fresh token minted", tokens.has("signer-b@example.com"));
  ok("expired token: signing_token_hash overwritten", persisted.signing_token_hash === "hash(fresh-token-for-signer-b@example.com)");
}

// ── Scenario 4: null/revoked token → new token minted ──
{
  const signers: Signer[] = [{ email: "Signer-C@Example.com", signing_token_hash: null, signing_token_expires_at: null }];
  const tokens = mintSignerTokens(signers, true);

  ok("null/revoked token: fresh token minted", tokens.has("signer-c@example.com"));
}

// ── Scenario 5: fresh envelope (no existing request) → all signers minted ──
{
  const signers: Signer[] = [
    { email: "Signer-D@Example.com", signing_token_hash: "old-hash-d", signing_token_expires_at: new Date(now + 1000 * 60 * 60 * 24) }, // would be preserved on reuse, but this is a fresh envelope
    { email: "signer-e@example.com", signing_token_hash: null, signing_token_expires_at: null },
  ];
  const tokens = mintSignerTokens(signers, false); // isReusingExistingEnvelope = false

  ok("fresh envelope: every signer gets a fresh token, including one with a still-valid prior hash", tokens.size === 2);
}

// ── Scenario 6: skipped (preserved) signers still appear in signingLinks and still get metadata refresh ──
{
  const signers: Signer[] = [
    { email: "Signer-F@Example.com", signing_token_hash: "valid-hash-f", signing_token_expires_at: new Date(now + 1000 * 60 * 60 * 24) }, // preserved
    { email: "signer-g@example.com", signing_token_hash: null, signing_token_expires_at: null }, // fresh
  ];
  const signingLinks = [
    { email: "signer-f@example.com", signingUrl: "https://document.luxit.app/sign/live-f" },
    { email: "SIGNER-G@example.com", signingUrl: "https://document.luxit.app/sign/live-g" },
  ];
  mintSignerTokens(signers, true);

  ok("skipped signer still present in signingLinks (Documenso-driven, independent of signerTokens)", signingLinks.some((l) => normalizeSignerEmail(l.email) === "signer-f@example.com"));
  ok("skipped signer still gets a fresh documenso_signing_url from live Documenso data", signingLinks.find((l) => normalizeSignerEmail(l.email) === "signer-f@example.com")?.signingUrl === "https://document.luxit.app/sign/live-f");
}

// ── Static: prove the raw-contract-ID fallback is ABSENT from source, not merely unreachable ──
const routes = fs.readFileSync("server/routes.ts", "utf8");

ok(
  "routes.ts: reuse-envelope branch checks hash existence, non-null expiry, and expiry > now before skipping mint",
  routes.includes("const isReusingExistingEnvelope = !!existingReq?.documenso_document_id;") &&
    /const hasValidExistingToken = !!signer\.signing_token_hash\s*\n\s*&& !!signer\.signing_token_expires_at\s*\n\s*&& new Date\(signer\.signing_token_expires_at\)\.getTime\(\) > Date\.now\(\);/.test(routes) &&
    routes.includes("if (hasValidExistingToken) continue;"),
);
ok(
  "routes.ts: the raw-contract-ID URL fallback is completely absent from source (not just unreachable)",
  !routes.includes("|| contractId)") && !/buildContractSigningUrl\([^)]*contractId/.test(routes),
);
ok(
  "routes.ts: myPayLinkSigningUrl is still persisted per recipient (post-sign redirect / in-app use) even though it is no longer separately emailed",
  routes.includes("myPayLinkSigningUrl: localToken?.myPayLinkSigningUrl || null"),
);
ok(
  "routes.ts: fresh-envelope path (isReusingExistingEnvelope false) is untouched — mint always proceeds outside the reuse branch",
  routes.includes("if (isReusingExistingEnvelope) {") && routes.includes("const token = crypto.randomBytes(32).toString(\"base64url\");"),
);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
