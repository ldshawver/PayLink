import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const routes = readFileSync("server/routes.ts", "utf8");

assert.match(
  routes,
  /app\.get\("\/api\/oauth\/tiktok\/callback", async \(req, res\) => \{/,
  "TikTok callback route must be registered as a public OAuth callback handler",
);

const callbackRegistration = routes.match(/app\.get\("\/api\/oauth\/tiktok\/callback",[\s\S]*?\n  \}\);/)?.[0] ?? "";
assert.ok(!callbackRegistration.includes("requireAuth"), "TikTok callback must not be registered with requireAuth/login_required");
assert.ok(callbackRegistration.includes("getTikTokSessionState(req)"), "TikTok callback must validate state from the session");
assert.ok(callbackRegistration.includes("Missing TikTok OAuth code or state"), "Missing code/state must return a safe OAuth error");
assert.ok(callbackRegistration.includes("Invalid or expired TikTok OAuth state"), "Invalid state must return a safe OAuth error");
assert.ok(callbackRegistration.includes("exchangeTikTokOAuthCode(req, code)"), "Valid callback should complete token exchange");
assert.ok(callbackRegistration.includes("req.session.userId"), "Valid callback should link TikTok to the session user who started the flow");

const apiPublicAllowlist = routes.match(/app\.use\("\/api", \(req, res, next\) => \{[\s\S]*?requireAuth\(req, res, next\);\n  \}\);/)?.[0] ?? "";
assert.ok(
  apiPublicAllowlist.includes('req.path === "/oauth/tiktok/callback"'),
  "Unauthenticated direct callback must bypass the blanket /api auth middleware",
);

console.log("TikTok OAuth callback static checks passed");
