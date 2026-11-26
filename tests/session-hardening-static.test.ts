/**
 * Static wiring checks for session hardening. Confirms the helpers are
 * actually used on the login paths and that production no longer falls
 * through to the development session secret.
 * Run: npx tsx tests/session-hardening-static.test.ts
 */
import fs from "node:fs";
import assert from "node:assert/strict";

const index = fs.readFileSync("server/index.ts", "utf8");
const routes = fs.readFileSync("server/routes.ts", "utf8");
const client = fs.readFileSync("client/src/hooks/use-auth.tsx", "utf8");
const migration = fs.readFileSync("migrations/0037_session_hardening.sql", "utf8");
const schema = fs.readFileSync("shared/schema.ts", "utf8");

function ok(name: string, condition: boolean) {
  assert.equal(condition, true, name);
  console.log(`PASS: ${name}`);
}

ok("index.ts resolves the session secret instead of falling back inline", /resolveSessionSecret\(/.test(index));
ok("index.ts does not fall back to the development session secret", !/SESSION_SECRET\s*\|\|\s*"paylink-dev-secret"/.test(index));
ok("index.ts exits when production secret resolution throws", /process\.exit\(1\)/.test(index) && /resolveSessionSecret/.test(index));
ok("rolling idle control is mounted for API requests", /enforceSessionControls\(/.test(index));

ok("login rotates the session before storing the user", /grantAuthenticatedSession\(req,\s*\{\s*userId:\s*user\.id/.test(routes));
ok("login rotates the session before the pending MFA challenge", /grantPendingMfaSession\(req,\s*user\.id\)/.test(routes));
ok("MFA completion rotates the session", /app\.post\("\/api\/auth\/mfa\/login-verify"[\s\S]*?grantAuthenticatedSession\(/.test(routes));
ok("PIN login rotates the session", /app\.post\("\/api\/auth\/pin-login"[\s\S]*?grantAuthenticatedSession\(/.test(routes));
ok("email verification rotates the session", /app\.post\("\/api\/auth\/verify-email"[\s\S]*?grantAuthenticatedSession\(/.test(routes));
ok("login consults the account and IP lockout", /loginLockout\.inspect\(/.test(routes) && /loginLockout\.recordFailure\(/.test(routes));
ok("session policy is readable without a session", /app\.get\("\/api\/auth\/session-policy"/.test(routes));
ok("session policy is on the auth allowlist", /req\.path === "\/auth\/session-policy"/.test(routes));
ok("session touch is not on the anonymous allowlist", !/req\.path === "\/auth\/session\/touch"/.test(routes));

ok("client idle sign-out is not limited to the employee role", !/user\.role !== "employee"/.test(client));
ok("client idle timer reads the server policy", /\/api\/auth\/session-policy/.test(client));
ok("client activity rolls the server idle clock", /\/api\/auth\/session\/touch/.test(client));

ok("migration 0037 only adds users.active_session_id", /ADD COLUMN IF NOT EXISTS active_session_id TEXT/.test(migration));
ok("migration 0037 is additive", !/\bDROP\b|\bTRUNCATE\b|\bDELETE\b/i.test(migration.replace(/--.*$/gm, "")));
ok("users schema records active_session_id", /activeSessionId:\s*text\("active_session_id"\)/.test(schema));
ok("startup DDL adds users.active_session_id", /users\.active_session_id/.test(index) && /ADD COLUMN IF NOT EXISTS active_session_id/.test(index));

console.log("\nSession hardening wiring checks passed.");
