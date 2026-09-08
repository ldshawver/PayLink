/**
 * Static wiring checks for contractor access requests (PR 2). Supplementary to
 * the behavioural (tests/contractor-access-requests.test.ts) and DB
 * (tests/contractor-access-requests-db.test.ts) coverage — pins that the
 * routes/schema keep the public endpoint allowlisted, tenant-scoped, token-safe,
 * and admin-gated. Static assertions alone are not sufficient for
 * identity/authorization behaviour (AGENTS.md); paired, not substituted.
 *
 * Run: npx tsx tests/contractor-access-requests-wiring-static.test.ts
 */
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const schema = fs.readFileSync("shared/schema.ts", "utf8");
const mod = fs.readFileSync("server/identity/contractor-access-requests.ts", "utf8");
const migration = fs.readFileSync("migrations/0020_contractor_access_requests.sql", "utf8");
const bootDdl = fs.readFileSync("server/index.ts", "utf8");
const app = fs.readFileSync("client/src/App.tsx", "utf8");

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
};

console.log("schema + migration — additive only");
ok("contractor_access_requests table defined", /export const contractorAccessRequests = pgTable\("contractor_access_requests"/.test(schema));
ok("migration 0020 is CREATE TABLE IF NOT EXISTS + indexes only (no DROP/ALTER in forward section)",
  /CREATE TABLE IF NOT EXISTS contractor_access_requests/.test(migration)
  && !/^\s*(DROP TABLE|DROP COLUMN|ALTER TABLE)/m.test(migration.split("ROLLBACK")[0]));
ok("migration has the pending-email unique index (public re-submit dedup)", /uq_contractor_access_requests_pending_email[\s\S]{0,120}WHERE status = 'pending'/.test(migration));
ok("boot DDL creates the table additively", /CREATE TABLE IF NOT EXISTS contractor_access_requests/.test(bootDdl));

console.log("\npublic endpoint — allowlisted, guarded, non-leaky");
ok("POST /api/contractor-signup is in the global /api auth-gate allowlist (exact path)", /req\.path === "\/contractor-signup"/.test(routes));
const pub = routes.slice(routes.indexOf('app.post("/api/contractor-signup"'), routes.indexOf('app.get("/api/contractor-access-requests"'));
ok("public handler runs the IP abuse guard first", /isRateLimited\(ip\)[\s\S]{0,120}?return res\.status\(429\)/.test(pub));
ok("public handler validates + sanitises via normalizeAccessRequestInput", /normalizeAccessRequestInput\(req\.body/.test(pub));
ok("public handler never creates an account (no bcrypt / users insert)", !/bcrypt|INSERT INTO users/i.test(pub));
ok("public response is generic — no id / status-exists signal", !/existing\.id|request\.id|\.id\b/.test(pub.replace(/req\.socket|req\.headers/g, "")));
ok("submitAccessRequest coalesces onto an existing pending row (no duplicate spam)", /SELECT id FROM contractor_access_requests\s+WHERE LOWER\(email\) = \$\{input\.email\} AND status = 'pending'/.test(mod));

console.log("\nadmin endpoints — company-scoped, token-safe");
ok("list + approve + reject are all requireRole(admin, manager)",
  /app\.get\("\/api\/contractor-access-requests", requireRole\("admin", "manager"\)/.test(routes)
  && /app\.post\("\/api\/contractor-access-requests\/:id\/approve", requireRole\("admin", "manager"\)/.test(routes)
  && /app\.post\("\/api\/contractor-access-requests\/:id\/reject", requireRole\("admin", "manager"\)/.test(routes));
ok("approve/reject require a company-scoped admin (403 otherwise)", /A company-scoped admin is required to approve/.test(routes) && /A company-scoped admin is required to reject/.test(routes));
ok("list is scoped to the acting user's company (+ unassigned pending only)",
  /WHERE \(company_id = \$\{companyId\} OR \(company_id IS NULL AND status = 'pending'\)\)/.test(mod));
{
  const approveRoute = routes.slice(routes.indexOf('contractor-access-requests/:id/approve'), routes.indexOf('contractor-access-requests/:id/reject'));
  const resJson = approveRoute.slice(approveRoute.indexOf("res.json("), approveRoute.indexOf("res.json(") + 300);
  ok("approve's res.json() NEVER includes a token / rawToken / invite object", !/token|rawToken|invite\b/i.test(resJson));
  ok("approve DOES use the raw token only to send the invite email", /sendAccountInviteEmail\(req, result\.email, [^,]+, result\.invite\.rawToken\)/.test(approveRoute));
}
ok("approve re-checks pending under FOR UPDATE (double-approve guard)", /FROM contractor_access_requests WHERE id = \$\{id\} FOR UPDATE/.test(mod));
ok("reject keeps the row (status='rejected' + reason, no DELETE)", /SET status = 'rejected', rejection_reason/.test(mod) && !/DELETE FROM contractor_access_requests/.test(mod));

console.log("\napprove — safe identity handling (reuses PR 1 primitives, never name-matches, tenant-scoped)");
ok("worker match is company + exact-email (never name)", /WHERE company_id = \$\{companyId\} AND worker_type = 'contractor'\s+AND LOWER\(COALESCE\(email, work_email, ''\)\) = \$\{email\}/.test(mod));
ok("account lookup is the PR 1 company-scoped findLinkableUserByEmail", /findLinkableUserByEmail\(email, companyId\)/.test(mod));
ok("single unbound account → identity_link + set worker_id (link, no invite)", /lookup\.outcome === "found" && !lookup\.alreadyLinkedWorkerId[\s\S]{0,300}?upsertIdentityLink\(/.test(mod));
ok("account bound elsewhere OR ambiguous → needs_review + fresh invite (no auto-link)", /already linked to another worker[\s\S]{0,200}?outcome = "needs_review"/.test(mod) && /accounts share this email[\s\S]{0,200}?outcome = "needs_review"/.test(mod));
ok("no account → fresh contractor invite via createOrRefreshInvite", /relationshipKind: "contractor", relationshipId: workerId,\s*\n\s*role: "contractor"/.test(mod));

console.log("\nclient wiring");
ok("public /contractor-signup route registered before the unauth→login redirect",
  app.indexOf('location === "/contractor-signup"') > 0
  && app.indexOf('location === "/contractor-signup"') < app.indexOf("<RedirectToLogin />"));
ok("admin /app/contractor-access-requests route is RoleGuard admin/manager", /path="\/app\/contractor-access-requests">\{\(\) => <RoleGuard roles=\{\["admin", "manager"\]\}>/.test(app));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
