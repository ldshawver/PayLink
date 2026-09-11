/**
 * Static regression checks for trial-signup email verification (Concierge
 * Launch Option A, blocker 5). Before this fix, POST /api/trial/signup could
 * generate a password server-side and echo it back as `temporaryPassword` in
 * the JSON response, and the app never verified a new trial's email address
 * before granting full access.
 * Run: npx tsx tests/trial-signup-email-verification-static.test.ts
 */
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const schema = fs.readFileSync("shared/schema.ts", "utf8");
const index = fs.readFileSync("server/index.ts", "utf8");
const signupHtml = fs.readFileSync("public-site/public/signup.html", "utf8");
const appTsx = fs.readFileSync("client/src/App.tsx", "utf8");

function ok(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

// ── Schema / migration ──────────────────────────────────────────────────────
ok(
  "users.emailVerificationRequired is additive (not null, defaults false)",
  /emailVerificationRequired:\s*boolean\("email_verification_required"\)\.notNull\(\)\.default\(false\)/.test(schema)
);
ok(
  "server/index.ts adds users.email_verification_required via additive startup DDL",
  /ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_required BOOLEAN NOT NULL DEFAULT FALSE/.test(index)
);
ok(
  "server/index.ts creates the email_verifications table additively",
  /CREATE TABLE IF NOT EXISTS email_verifications/.test(index)
);
ok(
  "migrations/0025_email_verification.sql exists as the readable record of the change",
  fs.existsSync("migrations/0025_email_verification.sql")
);

// ── POST /api/trial/signup ──────────────────────────────────────────────────
const signupMatch = routes.match(/app\.post\("\/api\/trial\/signup",[\s\S]*?\n {2}app\.\w/);
ok("POST /api/trial/signup handler exists", !!signupMatch);
ok(
  "trial signup now requires a caller-supplied password (no more server-generated fallback)",
  !!signupMatch && /if \(!password/.test(signupMatch[0]) && !/Math\.random\(\)\.toString\(36\)\.substring\(2, 10\)/.test(signupMatch[0])
);
const signupResponseMatch = signupMatch && signupMatch[0].match(/res\.json\(\{[\s\S]*?\}\);/);
ok(
  "trial signup response no longer echoes a password",
  !!signupResponseMatch && !/temporaryPassword/.test(signupResponseMatch[0])
);
ok(
  "trial signup response no longer returns a ready-to-use loginUrl / auto-login username",
  !!signupResponseMatch && !/loginUrl/.test(signupResponseMatch[0]) && !/username/.test(signupResponseMatch[0])
);
ok(
  "the new user is created with email_verification_required = TRUE",
  !!signupMatch && /email_verification_required\)\s*\n\s*VALUES \([^)]*TRUE\)/.test(signupMatch[0])
);
ok(
  "trial signup sends a verification email via createEmailVerification + sendGenericNotificationEmail",
  !!signupMatch && /createEmailVerification\(userId\)/.test(signupMatch[0]) && /sendGenericNotificationEmail\(/.test(signupMatch[0])
);

// ── Login-time gate ──────────────────────────────────────────────────────────
const loginMatch = routes.match(/app\.post\("\/api\/auth\/login",[\s\S]*?\n {2}app\.\w/);
ok("POST /api/auth/login handler exists", !!loginMatch);
ok(
  "login blocks an unverified account that requires verification (403, not a silent bypass)",
  !!loginMatch && /user\.emailVerificationRequired && !user\.emailVerifiedAt/.test(loginMatch[0]) && /status\(403\)/.test(loginMatch[0])
);

// ── New endpoints + auth-allowlist wiring ───────────────────────────────────
ok("POST /api/auth/verify-email handler exists", /app\.post\("\/api\/auth\/verify-email"/.test(routes));
ok("POST /api/auth/resend-verification handler exists", /app\.post\("\/api\/auth\/resend-verification"/.test(routes));
ok(
  "resend-verification never reveals whether the email exists (same generic response on every path)",
  (routes.match(/If that email has a pending verification, a new link has been sent\./g) || []).length >= 1
);
ok(
  "the global requireAuth gate exempts /auth/verify-email and /auth/resend-verification (no session exists yet)",
  /req\.path === "\/auth\/verify-email" \|\| req\.path === "\/auth\/resend-verification"/.test(routes)
);

// ── Client ───────────────────────────────────────────────────────────────────
ok("client/src/pages/verify-email.tsx exists", fs.existsSync("client/src/pages/verify-email.tsx"));
ok("App.tsx routes /verify-email to VerifyEmailPage", /location === "\/verify-email"/.test(appTsx) && /VerifyEmailPage/.test(appTsx));

ok(
  "signup.html no longer reads signupBody.temporaryPassword",
  !/signupBody\.temporaryPassword/.test(signupHtml)
);
ok(
  "signup.html no longer auto-logs-in with the server-issued/chosen password",
  !/fetch\('\/api\/auth\/login'/.test(signupHtml)
);
ok(
  "signup.html points the new trial user at their inbox instead",
  /credEmail/.test(signupHtml)
);

console.log("\nTrial-signup email-verification checks passed.");
