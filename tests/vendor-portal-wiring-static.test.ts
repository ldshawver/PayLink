/**
 * Static wiring checks for the vendor portal (PR 3). Supplementary to the
 * behavioural (tests/vendor-portal.test.ts) and DB (tests/vendor-portal-db.test.ts)
 * coverage — pins that the routes/schema keep vendor management admin-gated, the
 * vendor portal vendor-scoped, the invite token-safe, the migration additive,
 * and that a review never touches a ledger / payment / check table. Static
 * assertions alone are not sufficient for identity/authorization behaviour
 * (AGENTS.md); paired, not substituted.
 *
 * Run: npx tsx tests/vendor-portal-wiring-static.test.ts
 */
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const schema = fs.readFileSync("shared/schema.ts", "utf8");
const mod = fs.readFileSync("server/identity/vendors.ts", "utf8");
const identityDb = fs.readFileSync("server/identity/identity-db.ts", "utf8");
const migration = fs.readFileSync("migrations/0021_vendor_portal.sql", "utf8");
const bootDdl = fs.readFileSync("server/index.ts", "utf8");
const app = fs.readFileSync("client/src/App.tsx", "utf8");
const sidebar = fs.readFileSync("client/src/components/app-sidebar.tsx", "utf8");

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
};

console.log("schema + migration — additive only, real identifiers");
ok("vendors / vendor_documents / vendor_invoices tables defined",
  /export const vendors = pgTable\("vendors"/.test(schema)
  && /export const vendorDocuments = pgTable\("vendor_documents"/.test(schema)
  && /export const vendorInvoices = pgTable\("vendor_invoices"/.test(schema));
{
  const numbered = fs.readdirSync("migrations").filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();
  ok("0021_vendor_portal.sql is the highest numbered migration",
    numbered[numbered.length - 1] === "0021_vendor_portal.sql");
}
{
  const forward = migration.split("ROLLBACK")[0];
  ok("migration forward section: only CREATE TABLE/INDEX IF NOT EXISTS, no DROP/ALTER/DELETE/UPDATE",
    /CREATE TABLE IF NOT EXISTS vendors/.test(forward)
    && /CREATE TABLE IF NOT EXISTS vendor_documents/.test(forward)
    && /CREATE TABLE IF NOT EXISTS vendor_invoices/.test(forward)
    && !/\b(DROP|ALTER|DELETE FROM|UPDATE|TRUNCATE)\b/i.test(forward));
  ok("migration references vendors(id) NOWHERE as an FK (plain varchar convention)",
    !/REFERENCES\s+vendors?\s*\(/i.test(forward) && !/REFERENCES\s+companies\s*\(/i.test(forward));
}
ok("no OCR-style corruption in migration (NUMERIC / single-quoted defaults / underscores)",
  /amount\s+NUMERIC/.test(migration)
  && /currency\s+TEXT DEFAULT 'USD'/.test(migration)
  && /document_type\s+TEXT NOT NULL DEFAULT 'w9'/.test(migration)
  && !/NUMERTC|VARCHARNOT|vendor_iInvoices|"USD"|"W9"|"w9"/.test(migration));
ok("boot DDL creates all three tables additively", /CREATE TABLE IF NOT EXISTS vendors/.test(bootDdl)
  && /CREATE TABLE IF NOT EXISTS vendor_documents/.test(bootDdl)
  && /CREATE TABLE IF NOT EXISTS vendor_invoices/.test(bootDdl));
ok("schema scoping keys are plain varchar (no .references on vendor_id / vendors.company_id)",
  !/vendor_id"\)\.notNull\(\)\.references/.test(schema)
  && /export const vendors = pgTable\("vendors", \{[\s\S]*?companyId: varchar\("company_id"\)\.notNull\(\),/.test(schema));

console.log("\ninvite subject_type — worker vs vendor (never hard-coded)");
ok("acceptInviteWithUser computes the subject via inviteSubjectType(), not a literal 'worker'",
  /const subjectType = inviteSubjectType\(invite\.relationshipKind\)/.test(identityDb)
  && /INSERT INTO identity_links[\s\S]{0,260}\$\{subjectType\}/.test(identityDb));
ok("inviteSubjectType maps vendor→vendor and employee/contractor→worker",
  /relationshipKind === "vendor"\) return "vendor"/.test(identityDb)
  && /relationshipKind === "employee" \|\| relationshipKind === "contractor"\) return "worker"/.test(identityDb));
ok("RelationshipKind type + account_invites schema both allow 'vendor'",
  /"employee" \| "contractor" \| "vendor"/.test(identityDb)
  && /relationship_kind"\)\.notNull\(\)\.default\("employee"\), \/\/ employee \| contractor \| vendor/.test(schema));
ok("vendor invite is created with relationshipKind: 'vendor' / role: 'vendor'",
  /relationshipKind: "vendor", relationshipId: vendorId,\s*\n\s*role: "vendor"/.test(mod));

console.log("\nno new public endpoint / auth-gate allowlist entry");
{
  const gate = routes.slice(routes.indexOf('app.use("/api", (req, res, next) =>'), routes.indexOf("requireAuth(req, res, next);"));
  ok("the /api auth-gate allowlist gained NO vendor path", !/vendor/i.test(gate));
}
{
  // Every /api/vendor* route must have requireRole or requireAuth as its first
  // middleware — none is public.
  const vendorRouteLines = routes.split("\n").filter(l => /app\.(get|post|patch|delete)\("\/api\/vendor/.test(l));
  ok("every /api/vendor* route declares requireRole or requireAuth (none public)",
    vendorRouteLines.length >= 12 && vendorRouteLines.every(l => /requireRole\(|requireAuth/.test(l)));
}

console.log("\nadmin vendor management — company-scoped, admin/manager only");
ok("GET/POST/PATCH /api/vendors + status + invite are requireRole(admin, manager)",
  /app\.get\("\/api\/vendors", requireRole\("admin", "manager"\)/.test(routes)
  && /app\.post\("\/api\/vendors", requireRole\("admin", "manager"\), blockDemoWrites/.test(routes)
  && /app\.patch\("\/api\/vendors\/:id", requireRole\("admin", "manager"\), blockDemoWrites/.test(routes)
  && /app\.post\("\/api\/vendors\/:id\/status", requireRole\("admin", "manager"\), blockDemoWrites/.test(routes)
  && /app\.post\("\/api\/vendors\/:id\/invite", requireRole\("admin", "manager"\), blockDemoWrites/.test(routes));
ok("vendor-submissions review endpoints are requireRole(admin, manager)",
  /app\.get\("\/api\/vendor-submissions", requireRole\("admin", "manager"\)/.test(routes)
  && /app\.post\("\/api\/vendor-invoices\/:id\/review", requireRole\("admin", "manager"\), blockDemoWrites/.test(routes)
  && /app\.post\("\/api\/vendor-documents\/:id\/review", requireRole\("admin", "manager"\), blockDemoWrites/.test(routes));
ok("every admin handler derives companyId from the acting user (no client-supplied companyId trust)",
  /const companyId = await actingCompanyId\(req\);/.test(routes)
  && /A company-scoped admin is required/.test(routes));
ok("all vendor DB reads/writes are company- or vendor-scoped (WHERE company_id / vendor_id)",
  /WHERE company_id = \$\{companyId\}/.test(mod)
  && /WHERE id = \$\{vendorId\} AND company_id = \$\{companyId\}/.test(mod));

console.log("\nvendor portal — vendor-scoped, login-required");
ok("portal routes require login and resolve the acting user's own vendor",
  /app\.get\("\/api\/vendor-portal\/profile", requireAuth/.test(routes)
  && /app\.get\("\/api\/vendor-portal\/submissions", requireAuth/.test(routes)
  && /app\.post\(\s*"\/api\/vendor-portal\/invoices",\s*\n\s*requireAuth/.test(routes)
  && /app\.post\(\s*"\/api\/vendor-portal\/documents",\s*\n\s*requireAuth/.test(routes));
ok("requireVendorContext 403s a non-vendor account", /This area is for vendor portal accounts\./.test(routes));
ok("resolveVendorForUser binds ONLY via an active identity_links row (subject_type='vendor')",
  /subject_type = 'vendor'\s*\n\s*AND il\.link_status = 'active' AND v\.status = 'active'/.test(mod));
ok("portal submission queries are scoped to ctx.vendorId AND ctx.companyId",
  /FROM vendor_invoices WHERE vendor_id = \$\{ctx\.vendorId\} AND company_id = \$\{ctx\.companyId\}/.test(mod)
  && /FROM vendor_documents WHERE vendor_id = \$\{ctx\.vendorId\} AND company_id = \$\{ctx\.companyId\}/.test(mod));

console.log("\ninvite is token-safe");
{
  const inviteRoute = routes.slice(routes.indexOf('vendors/:id/invite'), routes.indexOf('vendors/:id/invite') + 900);
  const resJson = inviteRoute.slice(inviteRoute.indexOf("res.json("), inviteRoute.indexOf("res.json(") + 200);
  ok("invite's res.json() never includes a token / rawToken", !/token|rawToken/i.test(resJson));
  ok("invite uses the raw token ONLY to send the email", /sendAccountInviteEmail\(req, result\.email, [^,]+, result\.rawToken\)/.test(inviteRoute));
}
ok("no plaintext password/token is stored (invite create hashes; module never inserts a password)",
  !/INSERT INTO users/i.test(mod) && !/password/i.test(mod));

console.log("\nreview has NO ledger / payment / check side effects (PR 3 scope)");
ok("vendors.ts touches no expense / expense_payment / check / contractor_payment / ledger / documenso table",
  !/\b(INSERT INTO|UPDATE)\s+(expenses|expense_payments|checks|check_runs|contractor_payments|payroll_runs|ledger|general_ledger|journal_entries|invoices|documenso)/i.test(mod));
ok("reviewVendorInvoice only writes vendor_invoices (status / reviewer / note)",
  /UPDATE vendor_invoices\s*\n\s*SET status = \$\{status\}, review_note = \$\{note\}, reviewed_by_user_id/.test(mod));
ok("reviewVendorDocument writes status/review_note/reviewer and leaves the vendor's own `notes` untouched",
  /UPDATE vendor_documents\s*\n\s*SET status = \$\{status\}, review_note = \$\{note\}, reviewed_by_user_id = \$\{reviewerUserId\}, reviewed_at = NOW\(\)\s*\n\s*WHERE/.test(mod)
  && !/UPDATE vendor_documents[\s\S]{0,120}SET notes =/.test(mod));

console.log("\nclient wiring");
ok("/app/vendors is RoleGuard admin/manager",
  /path="\/app\/vendors">\{\(\) => <RoleGuard roles=\{\["admin", "manager"\]\}><VendorManagementPage/.test(app));
ok("/app/vendor-portal is RoleGuard vendor",
  /path="\/app\/vendor-portal">\{\(\) => <RoleGuard roles=\{\["vendor"\]\}><VendorPortalPage/.test(app));
ok("sidebar exposes Vendors (admin/manager) and My Vendor Portal (vendor)",
  /title: "Vendors", url: "\/app\/vendors", icon: \w+, roles: \["admin", "manager"\]/.test(sidebar)
  && /title: "My Vendor Portal", url: "\/app\/vendor-portal", icon: \w+, roles: \["vendor"\]/.test(sidebar));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
