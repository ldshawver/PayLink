/**
 * Static wiring checks for Concierge Launch Option A, blocker 3 (rate-limit +
 * CSRF middleware). Confirms the shared limiters/CSRF check are actually
 * attached to the routes this batch targets — not just defined and unused.
 * Run: npx tsx tests/csrf-ratelimit-wiring-static.test.ts
 */
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const index = fs.readFileSync("server/index.ts", "utf8");
const queryClient = fs.readFileSync("client/src/lib/queryClient.ts", "utf8");

function ok(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

ok("routes.ts imports the shared rate-limit/CSRF middleware", /from "\.\/security-middleware"/.test(routes));

ok("POST /api/auth/login is rate-limited", /app\.post\("\/api\/auth\/login",\s*loginRateLimit/.test(routes));
ok("POST /api/trial/signup is rate-limited", /app\.post\("\/api\/trial\/signup",\s*trialSignupRateLimit/.test(routes));
ok("POST /api/demo/provision is rate-limited", /app\.post\("\/api\/demo\/provision",\s*demoProvisionRateLimit/.test(routes));
ok(
  "POST /api/billing/activate is rate-limited and CSRF-protected",
  /app\.post\("\/api\/billing\/activate",\s*requireAuth,\s*requireRole\("admin"\),\s*billingActivateRateLimit,\s*requireCsrfToken/.test(routes)
);

ok("server/index.ts issues the CSRF cookie on every request (post-session)", /app\.use\(issueCsrfToken\)/.test(index));

ok(
  "the client's shared apiRequest() wrapper attaches the CSRF header",
  /headers\["x-csrf-token"\]\s*=\s*csrfToken/.test(queryClient)
);

console.log("\nRate-limit / CSRF wiring checks passed.");
