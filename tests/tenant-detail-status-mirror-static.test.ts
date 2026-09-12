/**
 * Static regression checks for the tenant-detail correctness fix (two
 * defects found after Concierge Launch Option A blocker 6 shipped):
 *
 *  1. GET /api/tenants/:id joined companies and selected `c.status`, a
 *     column that does not exist on the `companies` table (it has
 *     `subscription_status` — see shared/schema.ts). Any tenant with at
 *     least one assigned company 500'd this endpoint.
 *  2. PATCH /api/tenants/:id let a client-supplied `status` field write
 *     `tenants.status` directly, bypassing the mirror-only invariant PR #148
 *     established (companies.subscription_status is authoritative;
 *     tenants.status is a derived mirror kept in sync exclusively by
 *     mirrorTenantStatusFromCompany() in server/tenant-context.ts).
 *
 * Pure source-text assertions — no DB, no network, no live server. Matches
 * the static-test convention already used for every other Concierge Launch
 * Option A blocker (see tests/tenant-status-mirror.test.ts,
 * tests/billing-activate-platform-gate-static.test.ts, etc.)
 *
 * Run: npx tsx tests/tenant-detail-status-mirror-static.test.ts
 */
import fs from "node:fs";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const routes = fs.readFileSync("server/routes.ts", "utf8");
const platformTenants = fs.readFileSync("client/src/pages/platform-tenants.tsx", "utf8");

const getMatch = routes.match(/app\.get\("\/api\/tenants\/:id",[\s\S]*?\n {2}\}\);/);
const patchMatch = routes.match(/app\.patch\("\/api\/tenants\/:id",[\s\S]*?\n {2}\}\);/);

console.log("GET /api/tenants/:id — no nonexistent-column query");
ok("GET /api/tenants/:id handler exists", !!getMatch);
ok(
  "companies query no longer selects the nonexistent c.status column",
  !!getMatch && !/SELECT\s+c\.id,\s*c\.name,\s*c\.status\b/.test(getMatch[0])
);
ok(
  "companies query selects the real canonical column, c.subscription_status",
  !!getMatch && /c\.subscription_status/.test(getMatch[0])
);
ok(
  "companies query stays scoped to the requested tenant (tc.tenant_id = $1) — tenant/company consistency, no cross-tenant leak",
  !!getMatch && /WHERE tc\.tenant_id = \$1/.test(getMatch[0])
);
ok(
  "response maps each company's canonical status to `subscriptionStatus`, not the nonexistent `status`",
  !!getMatch && /subscriptionStatus:\s*c\.subscription_status/.test(getMatch[0])
);
ok(
  "GET /api/tenants/:id stays platform-role gated (ordinary tenant admin cannot reach it)",
  /app\.get\("\/api\/tenants\/:id",\s*requireAuth,\s*requirePlatformRole\(\)/.test(routes)
);

console.log("\nPATCH /api/tenants/:id — mirror-only invariant");
ok("PATCH /api/tenants/:id handler exists", !!patchMatch);
ok(
  "PATCH /api/tenants/:id stays platform-role gated (ordinary tenant admin cannot change tenant status)",
  /app\.patch\("\/api\/tenants\/:id",\s*requireAuth,\s*requirePlatformRole\(\)/.test(routes)
);
ok(
  "the raw `UPDATE tenants` no longer writes `status` from client input (platform admin cannot directly write the mirror-only tenants.status column)",
  !!patchMatch && !/UPDATE tenants[\s\S]*?status\s*=\s*COALESCE\(\$\d+,\s*status\)/.test(patchMatch[0])
);
ok(
  "a legitimate status change instead resolves the tenant's primary company scoped by tenant_id (cross-tenant authorization preserved — a caller can't reach another tenant's company)",
  !!patchMatch && /SELECT company_id FROM tenant_companies WHERE tenant_id = \$1/.test(patchMatch[0])
);
ok(
  "a legitimate status change updates companies.subscription_status (the canonical field), not tenants.status",
  !!patchMatch && /UPDATE companies SET subscription_status = COALESCE\(\$1, subscription_status\), is_demo = \$2/.test(patchMatch[0])
);
ok(
  "a legitimate status change re-derives the mirror via mirrorTenantStatusFromCompany() — the only sanctioned writer of tenants.status",
  !!patchMatch && /await mirrorTenantStatusFromCompany\(primaryCompanyId, subscriptionStatus, isDemo\)/.test(patchMatch[0])
);
ok(
  "setting status with no assigned company is rejected rather than silently mutating nothing",
  !!patchMatch && /Cannot set status: tenant has no assigned company/.test(patchMatch[0])
);
ok(
  "the tenant/company status vocabulary map lives outside the handler as the single source for this translation",
  /const TENANT_STATUS_TO_SUBSCRIPTION_STATUS: Record<string, string \| null> = \{/.test(routes)
);

console.log("\nPlatform tenant-detail UI contract");
ok(
  "platform-tenants.tsx's TenantDetail type reflects the renamed field (subscriptionStatus, not the nonexistent status)",
  /companies:\s*Array<\{[\s\S]*?subscriptionStatus:\s*string;/.test(platformTenants)
);
ok(
  "platform-tenants.tsx does not read a per-company `.status` field (it was never rendered, and no longer exists on the wire)",
  !/\bc\.status\b/.test(platformTenants)
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  process.exit(1);
}
