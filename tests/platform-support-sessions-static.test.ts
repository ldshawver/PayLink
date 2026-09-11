/**
 * Static regression checks for platform support sessions (Concierge Launch
 * Option A, blocker 1). Before this, no impersonation/support-session
 * mechanism existed at all — platform staff reached tenant data through the
 * existing platform-console routes with no record of when or why.
 * Run: npx tsx tests/platform-support-sessions-static.test.ts
 */
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const schema = fs.readFileSync("shared/schema.ts", "utf8");
const index = fs.readFileSync("server/index.ts", "utf8");
const platformTenants = fs.readFileSync("client/src/pages/platform-tenants.tsx", "utf8");

function ok(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

// ── Schema / migration ──────────────────────────────────────────────────────
ok("shared/schema.ts defines supportSessions", /export const supportSessions = pgTable\("support_sessions"/.test(schema));
ok("server/index.ts creates support_sessions additively", /CREATE TABLE IF NOT EXISTS support_sessions/.test(index));
ok("migrations/0026_support_sessions.sql exists as the readable record", fs.existsSync("migrations/0026_support_sessions.sql"));

// ── Routes: gated to platform staff, audited, rate-limited, CSRF-protected ──
const startMatch = routes.match(/app\.post\("\/api\/platform\/support-sessions",[\s\S]*?\n {2}app\.\w/);
ok("POST /api/platform/support-sessions (start) exists", !!startMatch);
ok(
  "starting a support session requires requirePlatformAdminRole() (not the broader read-only platform role set)",
  !!startMatch && /requirePlatformAdminRole\(\)/.test(startMatch[0])
);
ok(
  "starting a support session is rate-limited and CSRF-protected",
  !!startMatch && /supportSessionRateLimit/.test(startMatch[0]) && /requireCsrfToken/.test(startMatch[0])
);
ok(
  "starting a support session requires a non-trivial reason",
  !!startMatch && /reason\.trim\(\)\.length < 5/.test(startMatch[0])
);
ok(
  "starting a support session writes an audit log entry",
  !!startMatch && /writeAuditLog\(/.test(startMatch[0]) && /support_session_started/.test(startMatch[0])
);
ok(
  "a support session expires on its own (not just manually ended)",
  !!startMatch && /SUPPORT_SESSION_TTL_MS/.test(startMatch[0])
);

const endMatch = routes.match(/app\.post\("\/api\/platform\/support-sessions\/:id\/end",[\s\S]*?\n {2}app\.\w/);
ok("POST /api/platform/support-sessions/:id/end exists", !!endMatch);
ok(
  "ending a support session requires requirePlatformAdminRole()",
  !!endMatch && /requirePlatformAdminRole\(\)/.test(endMatch[0])
);
ok(
  "ending a support session writes an audit log entry",
  !!endMatch && /writeAuditLog\(/.test(endMatch[0]) && /support_session_ended/.test(endMatch[0])
);

ok(
  "GET /api/platform/support-sessions (listing) is gated to platform staff",
  /app\.get\("\/api\/platform\/support-sessions",\s*requireAuth,\s*requirePlatformRole\(\)/.test(routes)
);

// ── Client ───────────────────────────────────────────────────────────────────
ok(
  "platform-tenants.tsx has the Start Support Session action",
  /apiRequest\("POST",\s*"\/api\/platform\/support-sessions",\s*\{\s*companyId,\s*reason\s*\}\)/.test(platformTenants)
);
ok(
  "platform-tenants.tsx can end a support session",
  /apiRequest\("POST",\s*`\/api\/platform\/support-sessions\/\$\{id\}\/end`/.test(platformTenants)
);

console.log("\nPlatform support-session checks passed.");
