/**
 * Static wiring checks for tenant licenses (PR 4, migration 0022).
 * Supplementary to the behavioural resolver test
 * (tests/tenant-licenses-resolver.test.ts) and the DB invariants
 * (tests/tenant-licenses-db.test.ts).
 *
 * Pins the load-bearing guarantees of this PR:
 *   - migration 0022 is additive-only;
 *   - the existing enforcement path (checkTenantGate / requireActiveSubscription)
 *     is NOT modified and does NOT depend on tenant_licenses;
 *   - the narrow license gate is wired to EXACTLY the 3 declared non-protected
 *     routes and to NONE of the protected ones (payroll / checks / Documenso /
 *     employee login / contractor access / vendor portal);
 *   - the narrow gate fails open and passes when there is no license row;
 *   - the admin mutation keeps the companies gate columns consistent.
 *
 * Run: npx tsx tests/tenant-licenses-wiring-static.test.ts
 */
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const schema = fs.readFileSync("shared/schema.ts", "utf8");
const resolver = fs.readFileSync("server/licensing/license-resolver.ts", "utf8");
const service = fs.readFileSync("server/licensing/license-service.ts", "utf8");
const gate = fs.readFileSync("server/licensing/license-gate.ts", "utf8");
const tenantEnforcement = fs.readFileSync("server/tenant-enforcement.ts", "utf8");
const migration = fs.readFileSync("migrations/0022_tenant_licenses.sql", "utf8");
const bootDdl = fs.readFileSync("server/index.ts", "utf8");
const app = fs.readFileSync("client/src/App.tsx", "utf8");
const sidebar = fs.readFileSync("client/src/components/platform-sidebar.tsx", "utf8");
const suites = fs.readFileSync("scripts/test-suites.json", "utf8");

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
};

console.log("migration + schema — additive only");
{
  const numbered = fs.readdirSync("migrations").filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  // 0022 is the tenant-licenses migration; later PRs add higher-numbered files.
  ok("0022_tenant_licenses.sql exists and is not renumbered", numbered.includes("0022_tenant_licenses.sql"));
}
{
  const forward = migration.split("ROLLBACK")[0];
  ok("forward section creates tenant_licenses + tenant_license_events via CREATE TABLE IF NOT EXISTS",
    /CREATE TABLE IF NOT EXISTS tenant_licenses/.test(forward)
    && /CREATE TABLE IF NOT EXISTS tenant_license_events/.test(forward));
  ok("forward section: no DROP / ALTER / DELETE / UPDATE / TRUNCATE",
    !/\b(DROP|ALTER|DELETE FROM|UPDATE|TRUNCATE)\b/i.test(forward));
  ok("forward section: only IF NOT EXISTS indexes",
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_licenses_company/.test(forward)
    && !/CREATE INDEX (?!IF NOT EXISTS)/.test(forward));
  ok("no foreign-key REFERENCES (plain varchar scoping convention)",
    !/REFERENCES\s+\w+\s*\(/i.test(forward));
  ok("no backfill / no writes to companies or any other table",
    !/INSERT INTO(?!\s+tenant_licenses| tenant_license_events)/i.test(forward)
    && !/companies/i.test(forward.replace(/-- .*/g, "")));
  ok("no OCR-style corruption (real identifiers, single-quoted defaults)",
    /status\s+TEXT NOT NULL DEFAULT 'active'/.test(migration)
    && /source\s+TEXT NOT NULL DEFAULT 'system'/.test(migration)
    && !/tenant_iicenses|VARCHARNOT|"active"|"system"/.test(migration));
}
ok("schema.ts defines tenantLicenses + tenantLicenseEvents pgTable",
  /export const tenantLicenses = pgTable\("tenant_licenses"/.test(schema)
  && /export const tenantLicenseEvents = pgTable\("tenant_license_events"/.test(schema));
ok("boot DDL mirrors both tables additively",
  /CREATE TABLE IF NOT EXISTS tenant_licenses/.test(bootDdl)
  && /CREATE TABLE IF NOT EXISTS tenant_license_events/.test(bootDdl)
  && /uq_tenant_licenses_company/.test(bootDdl));

console.log("\nexisting enforcement path is untouched");
ok("tenant-enforcement.ts does NOT reference tenant_licenses / the resolver / the service",
  !/tenant_licenses/.test(tenantEnforcement)
  && !/license-resolver/.test(tenantEnforcement)
  && !/license-service/.test(tenantEnforcement));
{
  // requireActiveSubscription body must not consult the license model.
  const start = routes.indexOf("async function requireActiveSubscription");
  const body = routes.slice(start, start + 2500);
  ok("requireActiveSubscription does NOT read tenant_licenses / license-service",
    start > -1 && !/tenant_licenses/.test(body) && !/resolveCompanyLicense|getTenantLicenseRow/.test(body));
}
ok("resolver is pure — no db / drizzle / express imports",
  !/from "\.\.\/db"/.test(resolver) && !/drizzle/.test(resolver) && !/express/.test(resolver));

console.log("\nnarrow license gate — exactly the 3 declared non-protected routes");
{
  const gatedPosts = routes
    .split("\n")
    .filter((l) => /app\.(post|put|patch)\(/.test(l) && /requireLicenseNotBlocked/.test(l))
    .map((l) => (l.match(/app\.\w+\("([^"]+)"/) ?? [])[1])
    .filter(Boolean) as string[];
  ok("requireLicenseNotBlocked is on POST /api/customers", gatedPosts.includes("/api/customers"));
  ok("requireLicenseNotBlocked is on POST /api/invoices", gatedPosts.includes("/api/invoices"));
  ok("requireLicenseNotBlocked is on POST /api/documents", gatedPosts.includes("/api/documents"));
  ok("requireLicenseNotBlocked is on NO other route (exactly 3)", gatedPosts.length === 3);
  // and the import must be present exactly once
  ok("requireLicenseNotBlocked imported from ./licensing/license-gate",
    /import \{ requireLicenseNotBlocked \} from "\.\/licensing\/license-gate"/.test(routes));
}
{
  // Protected surfaces must NOT gain the new gate.
  const PROTECTED = [
    "/api/payroll-runs/:id/process",
    "/api/payroll-runs/:id/approve",
    "/api/expenses/:id/cut-check",
    "/api/expenses/:id/print-check",
    "/api/contractor-signup",
    "/api/contractor-access-requests",
    "/api/vendor-portal",
    "/api/vendors",
    "/api/workers",
    "/api/auth/login",
    "/api/documenso",
  ];
  for (const p of PROTECTED) {
    const re = new RegExp(`app\\.\\w+\\("${p.replace(/[/:]/g, "\\$&")}"[^\\n]*requireLicenseNotBlocked`);
    ok(`protected route ${p} did NOT gain requireLicenseNotBlocked`, !re.test(routes));
  }
}
ok("license gate: no tenant_licenses row → passes (never locks out a legacy tenant)",
  /if \(!row\) return next\(\)/.test(gate));
ok("license gate: fails OPEN on error",
  /Fail OPEN/.test(gate) && /catch \(e\)[\s\S]*?return next\(\);\n\s*\}\n\}/.test(gate));
ok("license gate: blocks only on BLOCKING_LICENSE_STATUSES",
  /BLOCKING_LICENSE_STATUSES/.test(gate) && /code: "license_blocked"/.test(gate));

console.log("\nplatform admin surface + no split-brain");
ok("GET /api/license/status is requireAuth (any tenant user, advisory)",
  /app\.get\("\/api\/license\/status", requireAuth/.test(routes));
ok("GET /api/platform/licenses is behind requirePlatformAdminRole()",
  /app\.get\("\/api\/platform\/licenses", requireAuth, requirePlatformAdminRole\(\)/.test(routes));
ok("GET+PUT /api/platform/companies/:companyId/license are behind requirePlatformAdminRole()",
  /app\.get\("\/api\/platform\/companies\/:companyId\/license", requireAuth, requirePlatformAdminRole\(\)/.test(routes)
  && /app\.put\("\/api\/platform\/companies\/:companyId\/license", requireAuth, requirePlatformAdminRole\(\)/.test(routes));
ok("adminUpsertLicense updates the authoritative companies.subscription_status column",
  /UPDATE companies\s*\n\s*SET subscription_status =/.test(service) && /gate_override_reason/.test(service));
ok("adminUpsertLicense runs in a single db.transaction",
  /db\.transaction\(async \(tx\)/.test(service));
ok("adminUpsertLicense writes a tenant_license_events audit row",
  /INSERT INTO tenant_license_events/.test(service));
ok("adminUpsertLicense also writes authorization_audit_log (existing billing convention)",
  /INSERT INTO authorization_audit_log/.test(service) && /license_admin_update/.test(service));
ok("STATUS_TO_COMPANY maps every normalized status to a companies.subscription_status spelling",
  /trialing: "trial_active"/.test(service) && /active: "active_paid"/.test(service)
  && /expired: "trial_expired"/.test(service) && /suspended: "suspended"/.test(service)
  && /cancelled: "cancelled"/.test(service));
ok("adminUpsertLicense validates admin status input STRICTLY (unknown → LicenseValidationError, never coerced to a blocking status)",
  /STRICT_STATUS_INPUT/.test(service)
  && /if \(!\(key in STRICT_STATUS_INPUT\)\)/.test(service)
  && /throw new LicenseValidationError\(\s*`Invalid license status/.test(service));

console.log("\ntrial onboarding + client wiring");
ok("trial signup creates a tenant_licenses row inside its transaction (ensureTrialLicense)",
  /INSERT INTO onboarding_progress[\s\S]{0,600}ensureTrialLicense\(/.test(routes));
ok("ensureTrialLicense uses ON CONFLICT (company_id) DO NOTHING (idempotent, no access change)",
  /ON CONFLICT \(company_id\) DO NOTHING/.test(service));
ok("/api/auth/me payload carries an advisory `license` field",
  /status: view\.resolved\.effectiveStatus/.test(routes) && /tenantGate, license \}\);/.test(routes));
ok("/api/auth/me license block is explicitly advisory (comment) and non-fatal",
  /additive, advisory only/.test(routes) && /license resolve failed \(non-fatal\)/.test(routes));
ok("App.tsx registers /platform/licenses route + lazy page",
  /const PlatformLicensesPage = lazy\(\(\) => import\("@\/pages\/platform-licenses"\)\)/.test(app)
  && /<Route path="\/platform\/licenses" component=\{PlatformLicensesPage\} \/>/.test(app));
ok("platform sidebar has a Tenant Licenses entry",
  /Tenant Licenses/.test(sidebar) && /\/platform\/licenses/.test(sidebar));
ok("App.tsx renders the advisory LicenseStatusBanner",
  /<LicenseStatusBanner \/>/.test(app));

console.log("\ntest suite registration");
ok("resolver + wiring tests are in the required suite",
  /tests\/tenant-licenses-resolver\.test\.ts/.test(suites) && /tests\/tenant-licenses-wiring-static\.test\.ts/.test(suites));
ok("db test is in the db suite (not required)",
  /tests\/tenant-licenses-db\.test\.ts/.test(suites));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
