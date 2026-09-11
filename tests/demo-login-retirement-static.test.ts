/**
 * Static regression checks for the retirement of the shared /api/demo/login
 * singleton (Concierge Launch blocker: retire unsafe demo singleton).
 * Run: npx tsx tests/demo-login-retirement-static.test.ts
 */
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");

function ok(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

const demoLoginMatch = routes.match(/app\.post\("\/api\/demo\/login",[\s\S]{0,400}?\}\);/);
ok("POST /api/demo/login handler still exists", !!demoLoginMatch);
ok("POST /api/demo/login returns 410 Gone", !!demoLoginMatch && /res\.status\(410\)/.test(demoLoginMatch[0]));
ok("POST /api/demo/login no longer creates the shared singleton demo company", !demoLoginMatch || !/is_demo = TRUE/.test(demoLoginMatch[0]));
ok("POST /api/demo/login no longer uses the hardcoded demo_admin/demo123 credentials", !demoLoginMatch || !/demo_admin/.test(demoLoginMatch[0]));

ok("POST /api/demo/provision handler still exists (per-visitor demo path unaffected)", /app\.post\("\/api\/demo\/provision"/.test(routes));

ok("publicWritePaths no longer exempts the retired /demo/login path", !/publicWritePaths = \[[^\]]*"\/demo\/login"/.test(routes));
ok("publicWritePaths still exempts /demo/provision", /publicWritePaths = \[[^\]]*"\/demo\/provision"/.test(routes));

console.log("\nDemo login retirement checks passed.");
