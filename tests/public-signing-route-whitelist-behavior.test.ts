/**
 * Behavioral test for the /api authentication whitelist gate in server/routes.ts.
 *
 * Root cause under test (fix #1): the public, token-authenticated signing routes
 * (/api/signing/contracts/:token* and /api/public/sign/contracts/:token*) were being
 * rejected with 401 by the global requireAuth gate before their own token-hash lookup
 * ever ran, because they were missing from the gate's path whitelist.
 *
 * Root cause under test (fix #2): the Documenso webhook route
 * (POST /api/webhooks/documenso) was ALSO being rejected by this same gate, because its
 * whitelist entry compared req.path against the literal string "/api/webhooks/documenso",
 * but Express strips the "/api" mount prefix from req.path inside `app.use("/api", ...)`
 * -- the real value at that point is "/webhooks/documenso". Confirmed against the live,
 * deployed application before this fix: POST to the real endpoint returned
 * {"message":"Not authenticated"} (the auth gate's message), not the webhook handler's
 * own {"message":"Invalid Documenso webhook secret"}.
 *
 * This test extracts the CURRENT whitelist condition directly out of server/routes.ts
 * (rather than a hand-copied duplicate that could silently drift) and drives it with
 * real HTTP requests through a real Express server, so it tracks source changes. The
 * webhook signature check uses the REAL exported verifyWebhookSecret function (not a
 * duplicate), so acceptance/rejection is proven against actual signature logic.
 *
 * Run: npx tsx tests/public-signing-route-whitelist-behavior.test.ts
 */
import fs from "node:fs";
import crypto from "node:crypto";
import express from "express";
import http from "http";
import { verifyWebhookSecret } from "../server/services/documenso";

// Isolated test secret -- does not touch or read any real deployment secret.
process.env.DOCUMENSO_WEBHOOK_SECRET = "test-only-webhook-secret-not-real";
delete process.env.MYPAYLINK_DOCUMENSO_WEBHOOK_SECRET;
const TEST_WEBHOOK_SECRET = process.env.DOCUMENSO_WEBHOOK_SECRET;

let pass = 0, fail = 0;
const log = (name: string, ok: boolean, detail?: string) =>
  ok ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`));

const routesSrc = fs.readFileSync("server/routes.ts", "utf8");

// ── Extract the live whitelist middleware block ────────────────────────────────
const blockStart = routesSrc.indexOf('app.use("/api", (req, res, next) => {\n    if (req.path === "/auth/login"');
if (blockStart === -1) throw new Error("could not locate the /api auth whitelist middleware in server/routes.ts");
const endMarker = "requireAuth(req, res, next);";
const blockEnd = routesSrc.indexOf(endMarker, blockStart) + endMarker.length;
const block = routesSrc.slice(blockStart, blockEnd);

// ── Static guard: exemption stays narrow (exact prefixes only) ────────────────
log(
  "whitelist exempts /signing/contracts/",
  block.includes('req.path.startsWith("/signing/contracts/")'),
);
log(
  "whitelist exempts /public/sign/contracts/",
  block.includes('req.path.startsWith("/public/sign/contracts/")'),
);
log(
  "whitelist does NOT exempt the broader /signing/ namespace",
  !/req\.path\.startsWith\("\/signing\/"\)/.test(block),
);
log(
  "whitelist does NOT exempt the broader /public/ namespace",
  !/req\.path\.startsWith\("\/public\/"\)/.test(block),
);
log(
  "whitelist's Documenso webhook entry uses the mount-stripped path form",
  block.includes('req.path === "/webhooks/documenso"'),
);
log(
  "whitelist no longer contains the unreachable /api-prefixed webhook entry",
  !block.includes('req.path === "/api/webhooks/documenso"'),
);

// ── Static guard: handler-level token rejection is unchanged by this fix ──────
const statusHandlerSrc = routesSrc.slice(
  routesSrc.indexOf("const getPublicContractSigningStatus"),
  routesSrc.indexOf("const completePublicContractSignature"),
);
log(
  "getPublicContractSigningStatus rejects an unmatched token with 404 invalid_link (not 401)",
  /res\.status\(404\)\.json\(\{\s*state:\s*"invalid_link"/.test(statusHandlerSrc),
);
const completeHandlerSrc = routesSrc.slice(
  routesSrc.indexOf("const completePublicContractSignature"),
  routesSrc.indexOf('app.post("/api/public/sign/contracts/:token/complete"'),
);
log(
  "completePublicContractSignature rejects an unmatched token with 404 (not 401)",
  /if \(!signer\) return res\.status\(404\)/.test(completeHandlerSrc),
);

// ── Dynamic test: build the REAL middleware from the extracted source and drive ──
// it with actual HTTP requests, proving the gate itself lets anonymous requests
// through to the intended routes and continues to block everything else.
const conditionMatch = block.match(/if \(([\s\S]*?)\)\s*\{\s*\n\s*return next\(\);/);
if (!conditionMatch) throw new Error("could not extract the whitelist condition expression");
const isWhitelisted = new Function("req", `return (${conditionMatch[1]});`) as (req: { path: string }) => boolean;

const app = express();
app.use("/api", (req, res, next) => {
  if (isWhitelisted(req)) return next();
  return res.status(401).json({ message: "Not authenticated" });
});
// Stub handlers stand in for the real (DB-backed) ones -- this half of the test proves
// the GATE's routing decision; handler-level token validation is covered above.
app.get("/api/signing/contracts/:token", (_req, res) => res.status(200).json({ reached: "handler" }));
app.get("/api/signing/contracts/:token/status", (_req, res) => res.status(200).json({ reached: "handler" }));
app.post("/api/signing/contracts/:token/complete", (_req, res) => res.status(200).json({ reached: "handler" }));
app.get("/api/public/sign/contracts/:token", (_req, res) => res.status(200).json({ reached: "handler" }));
// Mirrors the real handler's ordering (server/routes.ts:25299-25302): signature check
// runs first and is the REAL exported verifyWebhookSecret, not a stand-in.
app.post("/api/webhooks/documenso", express.raw({ type: "*/*" }), (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
  if (!verifyWebhookSecret(req.headers as any, raw)) {
    return res.status(401).json({ message: "Invalid Documenso webhook secret" });
  }
  return res.status(200).json({ reached: "webhook-handler", accepted: true });
});
app.get("/api/contractor-contracts", (_req, res) => res.status(200).json({ reached: "protected-handler" }));
app.get("/api/signing-documents", (_req, res) => res.status(200).json({ reached: "protected-handler" }));

const server = http.createServer(app);
function listen(): Promise<number> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as any).port)));
}
function close(): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

(async () => {
  console.log("=== Public signing route whitelist behavioral tests ===\n");
  const port = await listen();
  const get = (p: string) => fetch(`http://127.0.0.1:${port}${p}`);
  const post = (p: string) => fetch(`http://127.0.0.1:${port}${p}`, { method: "POST" });

  let r = await get("/api/signing/contracts/some-signer-token");
  log("anonymous GET /api/signing/contracts/:token reaches the handler (not 401)", r.status === 200, `got ${r.status}`);

  r = await get("/api/signing/contracts/some-signer-token/status");
  log("anonymous GET /api/signing/contracts/:token/status reaches the handler (not 401)", r.status === 200, `got ${r.status}`);

  r = await post("/api/signing/contracts/some-signer-token/complete");
  log("anonymous POST /api/signing/contracts/:token/complete reaches the handler (not 401)", r.status === 200, `got ${r.status}`);

  r = await get("/api/public/sign/contracts/some-signer-token");
  log("anonymous GET /api/public/sign/contracts/:token reaches the handler (not 401)", r.status === 200, `got ${r.status}`);

  // Anonymous POST with a VALID signature: must reach the handler and be ACCEPTED --
  // proves the gate no longer blocks it, and real verifyWebhookSecret logic passes it.
  const validBody = JSON.stringify({ event: "document.completed", documentId: "doc_123" });
  r = await fetch(`http://127.0.0.1:${port}/api/webhooks/documenso`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-documenso-secret": TEST_WEBHOOK_SECRET },
    body: validBody,
  });
  const validJson = await r.json();
  log(
    "anonymous POST /api/webhooks/documenso with a valid signature reaches the handler and is accepted (not 401 from the gate)",
    r.status === 200 && validJson.accepted === true,
    `got ${r.status} ${JSON.stringify(validJson)}`,
  );

  // Anonymous POST with an INVALID signature: must still reach the handler (past the
  // gate) but be REJECTED by the handler's own signature check -- distinguishable from
  // the gate's rejection by message, proving signature validation still determines
  // acceptance/rejection rather than the request being let through unconditionally.
  r = await fetch(`http://127.0.0.1:${port}/api/webhooks/documenso`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-documenso-secret": "wrong-secret" },
    body: validBody,
  });
  const invalidJson = await r.json();
  log(
    "anonymous POST /api/webhooks/documenso with an invalid signature is rejected by signature validation (401, handler-level message), not silently accepted",
    r.status === 401 && invalidJson.message === "Invalid Documenso webhook secret",
    `got ${r.status} ${JSON.stringify(invalidJson)}`,
  );

  // Anonymous POST with NO signature header at all: same handler-level rejection.
  r = await fetch(`http://127.0.0.1:${port}/api/webhooks/documenso`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: validBody,
  });
  const noSigJson = await r.json();
  log(
    "anonymous POST /api/webhooks/documenso with no signature header is rejected by signature validation (401, handler-level message)",
    r.status === 401 && noSigJson.message === "Invalid Documenso webhook secret",
    `got ${r.status} ${JSON.stringify(noSigJson)}`,
  );

  r = await get("/api/contractor-contracts");
  log("representative protected route still requires auth (401 without a session)", r.status === 401, `got ${r.status}`);

  r = await get("/api/signing-documents");
  log("adjacent /api/signing-documents (distinct from /signing/contracts/) still requires auth", r.status === 401, `got ${r.status}`);

  await close();

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
