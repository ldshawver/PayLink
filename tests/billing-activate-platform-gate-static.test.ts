/**
 * Static regression checks for the billing/activate platform-gate fix
 * (Concierge Launch Option A, blocker 2). Before this fix, any trial
 * company's own tenant admin could self-activate billing for free: the route
 * used requireRole("admin"), which the tenant's own "admin" role satisfies,
 * and the client shipped a self-serve button that called it with zero
 * payment collected anywhere in the flow.
 * Run: npx tsx tests/billing-activate-platform-gate-static.test.ts
 */
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const billingPage = fs.readFileSync("client/src/pages/billing.tsx", "utf8");
const upgradeModal = fs.readFileSync("client/src/components/upgrade-modal.tsx", "utf8");
const platformTenants = fs.readFileSync("client/src/pages/platform-tenants.tsx", "utf8");

function ok(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

const activateMatch = routes.match(/app\.post\("\/api\/billing\/activate",[\s\S]*?\n {2}app\.\w/);
ok("POST /api/billing/activate handler exists", !!activateMatch);
ok(
  "POST /api/billing/activate requires requirePlatformAdminRole(), not the tenant-satisfiable requireRole(\"admin\")",
  !!activateMatch && /requirePlatformAdminRole\(\)/.test(activateMatch[0]) && !/requireRole\("admin"\)/.test(activateMatch[0])
);
ok(
  "POST /api/billing/activate takes the target companyId from the request body (caller is platform staff, not the tenant)",
  !!activateMatch && /\{\s*companyId,\s*note\s*\}\s*=\s*req\.body/.test(activateMatch[0])
);
ok(
  "POST /api/billing/activate 400s when companyId is missing",
  !!activateMatch && /if \(!companyId/.test(activateMatch[0])
);
ok(
  "POST /api/billing/activate writes an audit log entry",
  !!activateMatch && /writeAuditLog\(/.test(activateMatch[0])
);

ok("billing.tsx no longer calls POST /api/billing/activate itself", !/apiRequest\("POST",\s*"\/api\/billing\/activate"/.test(billingPage));
ok("billing.tsx routes the tenant to a human instead (mailto support link)", /mailto:support@mypaylink\.app/.test(billingPage));

ok("upgrade-modal.tsx no longer calls POST /api/billing/activate itself", !/apiRequest\("POST",\s*"\/api\/billing\/activate"/.test(upgradeModal));
ok("upgrade-modal.tsx routes the tenant to a human instead (mailto support link)", /mailto:support@mypaylink\.app/.test(upgradeModal));

ok(
  "platform-tenants.tsx (platform-staff console) gained the staff-facing Activate Billing action",
  /apiRequest\("POST",\s*"\/api\/billing\/activate",\s*\{\s*companyId\s*\}\)/.test(platformTenants)
);

console.log("\nBilling-activate platform-gate checks passed.");
