/**
 * Wiring checks for the per-user password reset and the retired shared token.
 * Run: npx tsx tests/password-reset-static.test.ts
 */
import fs from "node:fs";
import assert from "node:assert/strict";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const index = fs.readFileSync("server/index.ts", "utf8");
const login = fs.readFileSync("client/src/pages/login.tsx", "utf8");
const app = fs.readFileSync("client/src/App.tsx", "utf8");
const migration = fs.readFileSync("migrations/0038_password_reset_tokens.sql", "utf8");
const resetPage = fs.readFileSync("client/src/pages/reset-password.tsx", "utf8");

function ok(name: string, condition: boolean) {
  assert.equal(condition, true, name);
  console.log(`PASS: ${name}`);
}

ok("forgot-password route is rate-limited", /app\.post\("\/api\/auth\/forgot-password",\s*forgotPasswordRateLimit/.test(routes));
ok("reset-password route is rate-limited", /app\.post\("\/api\/auth\/reset-password",\s*resetPasswordRateLimit/.test(routes));
ok("both public reset routes are on the auth allowlist", /req\.path === "\/auth\/forgot-password"/.test(routes) && /req\.path === "\/auth\/reset-password"/.test(routes));
ok("forgot-password returns the generic message", /FORGOT_PASSWORD_MESSAGE/.test(routes));
ok("reset tokens are created and looked up by hash", /createPasswordReset\(/.test(routes) && /getLivePasswordReset\(/.test(routes));
ok("shared RECOVERY_TOKEN comparison is gone from the server", !/RECOVERY_TOKEN/.test(routes) && !/recoveryToken !== envToken/.test(routes));
ok("POST /api/auth/recover is retired with 410", /app\.post\("\/api\/auth\/recover"[\s\S]{0,400}?status\(410\)/.test(routes));
ok("platform admin can email a reset without choosing the password", /app\.post\("\/api\/platform\/users\/:userId\/send-password-reset",\s*requireAuth,\s*requirePlatformAdminRole\(\)/.test(routes));
ok("platform admin password set is audited and CSRF-protected", /setPasswordByPlatformAdmin\(/.test(routes) && /requireCsrfToken/.test(routes) && /platform\/users\/:userId\/set-password/.test(routes));

ok("login page no longer asks for a shared recovery token", !/RECOVERY_TOKEN/.test(login) && /\/api\/auth\/forgot-password/.test(login));
ok("reset page posts the token and a new password", /\/api\/auth\/reset-password/.test(resetPage) && /data-testid="input-reset-password"/.test(resetPage));
ok("App.tsx routes /reset-password", /location === "\/reset-password"/.test(app));

ok("migration 0038 creates the hashed token table", /CREATE TABLE IF NOT EXISTS password_reset_tokens/.test(migration) && /token_hash/.test(migration));
ok("migration 0038 does not drop or delete data", !/\bDROP\s+(TABLE|COLUMN)\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i.test(migration));
ok("startup DDL creates password_reset_tokens", /password_reset_tokens table/.test(index) && /CREATE TABLE IF NOT EXISTS password_reset_tokens/.test(index));

console.log("\nPassword reset wiring checks passed.");
