/**
 * Regression tests for the Documenso recipient id/token mapping defect.
 *
 * Documenso returns two distinct recipient values per signer:
 *   id    = numeric internal Documenso recipient id
 *   token = opaque signing credential embedded in /sign/{token}
 * These were confused in several code paths, causing tokens to be persisted
 * where numeric recipient ids belonged, and vice versa. This file proves the
 * fix behaviorally against the real exported service functions, and
 * statically against the routes.ts persistence paths that cannot be
 * imported directly (they live inside the registerRoutes closure).
 *
 * Run: npx tsx tests/documenso-recipient-canonical.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createDocumensoDocument,
  getDocumensoDocument,
  resendDocumensoDocument,
} from "../server/services/documenso";

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

process.env.DOCUMENSO_URL = "https://document.luxit.app/api/v2";
process.env.MYPAYLINK_DOCUMENSO_API_KEY = "test-api-key";

// Real observed Documenso payload shape from the forensic audit.
const REAL_ID = 56;
const REAL_TOKEN = "-qBCV8NjByCErAvoysajE";
const REAL_SIGNING_URL = `https://document.luxit.app/sign/${REAL_TOKEN}`;

function jsonResponse(body: any): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function mockFetch(handlers: Record<string, any>) {
  return async (input: any) => {
    const url = typeof input === "string" ? input : input.url;
    for (const [pattern, body] of Object.entries(handlers)) {
      if (url.includes(pattern)) return jsonResponse(body);
    }
    throw new Error(`Unhandled fetch URL in test mock: ${url}`);
  };
}

console.log("=== Documenso Recipient Canonical Mapping Tests ===\n");

await (async () => {
  const originalFetch = globalThis.fetch;
  try {
    // ── 1. Fresh-send path (createDocumensoDocument): id and token stay distinct ──
    globalThis.fetch = mockFetch({
      "/envelope/create": { id: "doc-fresh-1" },
      "/envelope/distribute": {
        status: "PENDING",
        recipients: [
          {
            id: REAL_ID,
            token: REAL_TOKEN,
            email: "signer@example.com",
            name: "Signer One",
            signingUrl: REAL_SIGNING_URL,
            signingStatus: "PENDING",
          },
        ],
      },
    }) as any;

    const created = await createDocumensoDocument({
      title: "Test Contract",
      pdfBuffer: Buffer.from("pdf-bytes"),
      recipients: [{ name: "Signer One", email: "signer@example.com" }],
    });
    const freshLink = created.signingLinks[0];

    ok("fresh-send: id and token remain distinct values", freshLink.id !== freshLink.token, `id=${freshLink.id} token=${freshLink.token}`);
    ok("fresh-send: canonical id equals String(56)", freshLink.id === "56", `got ${JSON.stringify(freshLink.id)}`);
    ok("fresh-send: token equals the opaque Documenso token", freshLink.token === REAL_TOKEN);
    ok("fresh-send: signingUrl contains the token", (freshLink.signingUrl || "").includes(REAL_TOKEN));
    ok("fresh-send: signingUrl never degrades to /sign/56", !(freshLink.signingUrl || "").includes("/sign/56"));

    // ── 2. Missing signingUrl falls back to /sign/${token}, never uses id ──
    globalThis.fetch = mockFetch({
      "/envelope/create": { id: "doc-fresh-2" },
      "/envelope/distribute": {
        status: "PENDING",
        recipients: [
          { id: 99, token: "fallback-token-abc", email: "b@example.com", name: "B", signingStatus: "PENDING" },
        ],
      },
    }) as any;
    const fallbackResult = await createDocumensoDocument({
      title: "Fallback Test",
      pdfBuffer: Buffer.from("pdf-bytes"),
      recipients: [{ name: "B", email: "b@example.com" }],
    });
    const fallbackLink = fallbackResult.signingLinks[0];
    ok(
      "missing signingUrl falls back to /sign/${token}",
      fallbackLink.signingUrl === "https://document.luxit.app/sign/fallback-token-abc",
      `got ${fallbackLink.signingUrl}`,
    );

    // ── 3. Missing token: no fake numeric signing URL is ever built ──
    globalThis.fetch = mockFetch({
      "/envelope/create": { id: "doc-fresh-3" },
      "/envelope/distribute": {
        status: "PENDING",
        recipients: [
          { id: 100, email: "c@example.com", name: "C", signingStatus: "PENDING" },
        ],
      },
    }) as any;
    const noTokenResult = await createDocumensoDocument({
      title: "No Token Test",
      pdfBuffer: Buffer.from("pdf-bytes"),
      recipients: [{ name: "C", email: "c@example.com" }],
    });
    const noTokenLink = noTokenResult.signingLinks[0];
    ok("missing token: signingUrl is not fabricated", !noTokenLink.signingUrl, `got ${noTokenLink.signingUrl}`);
    ok("missing token: no /sign/{id} leak", !String(noTokenLink.signingUrl || "").includes("/sign/100"));

    // ── 4. getDocumensoDocument (reused-existing-request path) preserves the same shape ──
    globalThis.fetch = mockFetch({
      "/envelope/doc-fresh-1": {
        id: "doc-fresh-1",
        status: "PENDING",
        recipients: [
          {
            id: REAL_ID,
            token: REAL_TOKEN,
            email: "signer@example.com",
            name: "Signer One",
            signingUrl: REAL_SIGNING_URL,
            signingStatus: "PENDING",
          },
        ],
      },
    }) as any;
    const fetched = await getDocumensoDocument("doc-fresh-1");
    const fetchedRecipient = fetched.recipients[0];
    ok("reused-existing: id and token distinct", String(fetchedRecipient.id) !== fetchedRecipient.token);
    ok("reused-existing: id equals 56", String(fetchedRecipient.id) === "56");
    ok("reused-existing: token equals the opaque token", fetchedRecipient.token === REAL_TOKEN);
    ok("reused-existing: signingUrl contains token, never /sign/56", (fetchedRecipient.signingUrl || "").includes(REAL_TOKEN) && !(fetchedRecipient.signingUrl || "").includes("/sign/56"));

    // Fresh-send and reused-existing paths must agree on the canonical shape for the same recipient.
    ok(
      "fresh-send and reused-existing produce the same canonical {id, token, signingUrl}",
      freshLink.id === String(fetchedRecipient.id) &&
        freshLink.token === fetchedRecipient.token &&
        freshLink.signingUrl === fetchedRecipient.signingUrl,
    );

    // getDocumensoDocument missing signingUrl also falls back to token, never id.
    globalThis.fetch = mockFetch({
      "/envelope/doc-fresh-4": {
        id: "doc-fresh-4",
        status: "PENDING",
        recipients: [{ id: 200, token: "get-doc-fallback-token", email: "d@example.com", name: "D", signingStatus: "PENDING" }],
      },
    }) as any;
    const fetched2 = await getDocumensoDocument("doc-fresh-4");
    ok(
      "getDocumensoDocument missing signingUrl falls back to /sign/${token}",
      fetched2.recipients[0].signingUrl === "https://document.luxit.app/sign/get-doc-fallback-token",
    );

    // ── 5. resendDocumensoDocument: token never falls back to id/recipientId ──
    globalThis.fetch = mockFetch({
      "/envelope/redistribute": {
        status: "PENDING",
        recipients: [
          {
            id: REAL_ID,
            token: REAL_TOKEN,
            email: "signer@example.com",
            name: "Signer One",
            signingUrl: REAL_SIGNING_URL,
            signingStatus: "PENDING",
          },
        ],
      },
    }) as any;
    const resent = await resendDocumensoDocument("doc-fresh-1");
    const resentLink = resent.signingLinks[0];
    ok("resend: id and token remain distinct", resentLink.id !== resentLink.token);
    ok("resend: canonical id equals String(56)", resentLink.id === "56");
    ok("resend: token equals the opaque token", resentLink.token === REAL_TOKEN);

    // Recipient with an id but no token: resend must NOT fall back from token to id.
    globalThis.fetch = mockFetch({
      "/envelope/redistribute": {
        status: "PENDING",
        recipients: [{ id: 77, email: "e@example.com", name: "E", signingUrl: "https://document.luxit.app/sign/something-else", signingStatus: "PENDING" }],
      },
    }) as any;
    const resentNoToken = await resendDocumensoDocument("doc-fresh-1");
    ok(
      "resend: missing token never falls back to r.id",
      resentNoToken.signingLinks[0].token === null,
      `got ${JSON.stringify(resentNoToken.signingLinks[0].token)}`,
    );
    ok("resend: id is preserved independently of token fallback", resentNoToken.signingLinks[0].id === "77");
  } finally {
    globalThis.fetch = originalFetch;
  }
})();

// ── 6. Static checks against routes.ts persistence paths that cannot be imported ──
// (extractDocumensoRecipients, /send-for-signature, per-signer resend, status sync,
//  and signing_token_hash independence all live inside the registerRoutes closure.)
const routes = fs.readFileSync("server/routes.ts", "utf8");

ok(
  "extractDocumensoRecipients derives id from r.id/r.recipientId, not r.token",
  routes.includes("r?.id != null") && routes.includes("signingToken,") && !routes.includes('id: String(r?.token ?? r?.id ?? r?.recipientId ?? r?.recipient_id ?? "") || null'),
);
ok(
  "extractDocumensoRecipients signingUrl falls back to /sign/${signingToken}, never id",
  routes.includes("`${getDocumensoBaseUrlInfo().publicBaseUrl}/sign/${signingToken}`"),
);

ok(
  "/send-for-signature persists recipientId from link.id, not link.token",
  routes.includes("recipientId: link.id || null,") && !routes.includes("recipientId: link.token || null"),
);
ok(
  "/send-for-signature writes documenso_recipient_id from link.id via COALESCE",
  routes.includes("documenso_recipient_id = COALESCE(${link.id || null}, documenso_recipient_id),") &&
    !/documenso_recipient_id = COALESCE\(\$\{link\.token/.test(routes),
);

ok(
  "reused-existing-request docResult uses the same canonical {id, token, signingUrl} shape as a fresh send",
  routes.includes("token: signingToken,") && routes.includes("id:\n                r.id != null"),
);

ok(
  "per-signer resend (Block D) sets latestRecipientId from matchingLink.id, not .token",
  routes.includes("latestRecipientId = matchingLink?.id || latestRecipientId;") && !routes.includes("latestRecipientId = matchingLink?.token"),
);
ok(
  "per-signer resend (Block D) records recipientId from link.id, not link.token",
  /recipientId: link\.id \|\| null,\s*\n\s*signingUrl: link\.signingUrl \|\| null,\s*\n\s*myPayLinkSigningUrl:/.test(routes) && !routes.includes("recipientId: link.token || null,"),
);

ok(
  "syncDocumensoContractStatus (Block E) uses extractDocumensoRecipients instead of an inline id||token fallback chain",
  routes.includes("const canonicalRecipients = extractDocumensoRecipients(remote);") &&
    routes.includes("const recipientId = canonicalRecipients[recipientIdx]?.id ?? null;") &&
    !routes.includes("recipient?.id || recipient?.token || recipient?.recipientId || recipient?.recipient_id"),
);
ok(
  "syncDocumensoContractStatus can match signers by numeric recipient id OR normalized email",
  /documenso_recipient_id = \$\{recipientId\}\s*\n\s*OR \$\{email\} IS NOT NULL AND lower\(trim\(email\)\) = \$\{email\}/.test(routes),
);

ok(
  "MyPayLink signing_token_hash is derived only from the local signerTokens map, never from Documenso's r.token/link.token",
  routes.includes("signerTokens.get(email)?.token ? hashSigningToken(signerTokens.get(email)!.token) : null") &&
    !routes.includes("hashSigningToken(link.token)") &&
    !routes.includes("hashSigningToken(r.token)") &&
    !routes.includes("hashSigningToken(recipient.token)"),
);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
