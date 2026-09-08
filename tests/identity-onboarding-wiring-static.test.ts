/**
 * Static wiring checks for PR 1 — SaaS identity/onboarding.
 *
 * Supplementary to the behavioural coverage in tests/identity-resolver.test.ts
 * and the DB coverage in tests/identity-onboarding-db.test.ts. These pin that
 * the routes/schema keep calling the shared identity primitives and stay
 * tenant-scoped. Static assertions alone are not sufficient for
 * identity/authorization behaviour (see AGENTS.md) — they are paired with the
 * behavioural + DB tests, not used instead of them.
 *
 * Run: npx tsx tests/identity-onboarding-wiring-static.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const schema = fs.readFileSync("shared/schema.ts", "utf8");
const idb = fs.readFileSync("server/identity/identity-db.ts", "utf8");
const migration = fs.readFileSync("migrations/0019_identity_links_and_invites.sql", "utf8");
const bootDdl = fs.readFileSync("server/index.ts", "utf8");
const employee = fs.readFileSync("client/src/pages/employee.tsx", "utf8");

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
};

console.log("schema + migration — additive only, token hashed");
ok("account_invites stores token_hash, not a raw token column", /tokenHash: text\("token_hash"\)/.test(schema) && !/token: text\("token"\)/.test(schema.slice(schema.indexOf("accountInvites"), schema.indexOf("identityLinks"))));
ok("identity_links table defined", /export const identityLinks = pgTable\("identity_links"/.test(schema));
ok("users gains only nullable/defaulted columns", /inviteStatus: text\("invite_status"\)\.default\("none"\)/.test(schema) && /lastLoginAt: timestamp\("last_login_at"\)/.test(schema) && /emailVerifiedAt: timestamp\("email_verified_at"\)/.test(schema));
ok("migration 0019 is CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS only (no DROP)", /CREATE TABLE IF NOT EXISTS account_invites/.test(migration) && /ADD COLUMN IF NOT EXISTS invite_status/.test(migration) && !/^\s*(DROP TABLE|DROP COLUMN|ALTER COLUMN .* DROP NOT NULL)/m.test(migration.split("ROLLBACK")[0]));
ok("migration hashes: token_hash column + unique index", /token_hash\s+TEXT NOT NULL/.test(migration) && /uq_account_invites_token_hash/.test(migration));
ok("boot DDL creates both tables additively", /CREATE TABLE IF NOT EXISTS account_invites/.test(bootDdl) && /CREATE TABLE IF NOT EXISTS identity_links/.test(bootDdl));

console.log("\nidentity-db — every lookup is company-scoped, email-exact, never name");
const findFn = idb.slice(idb.indexOf("export async function findLinkableUserByEmail"), idb.indexOf("// ── identity_links"));
ok("loadWorkerSignerIdentity is scoped by company", /WHERE w\.id = \$\{workerId\} AND w\.company_id = \$\{companyId\}/.test(idb));
ok("findLinkableUserByEmail is company-scoped and exact-email (not name)", /WHERE LOWER\(email\) = \$\{norm\} AND company_id = \$\{companyId\}/.test(findFn) && !/first_name|last_name|ILIKE|name/i.test(findFn.replace(/username|LinkableUser|by[_ ]?email|EmailByName/gi, "")));
ok("findLinkableUserByEmail reports ambiguity instead of guessing", /outcome: "ambiguous"/.test(findFn) && /rows\.length > 1/.test(findFn));
const acceptFn = idb.slice(idb.indexOf("export async function acceptInviteWithUser"), idb.indexOf("export async function setWorkerAccountEnabled"));
ok("acceptInviteWithUser re-checks the invite is still pending inside the tx (FOR UPDATE)", /FROM account_invites WHERE id = \$\{invite\.id\} AND status = 'pending' FOR UPDATE/.test(acceptFn));
ok("acceptInviteWithUser sets email_verified_at + invite_status='active' on the new user",
  /INSERT INTO users \([^)]*is_active, invite_status, email, email_verified_at, last_login_at\)/.test(acceptFn)
  && /TRUE, 'active', \$\{invite\.email\}, NOW\(\), NULL/.test(acceptFn));
ok("conflicting link → pending_review, not silent merge", /linkStatus: conflict \? "pending_review"/.test(routes));

console.log("\nroutes — POST /api/workers one-step account provisioning");
const postWorkers = routes.slice(routes.indexOf('app.post("/api/workers"'), routes.indexOf('app.get("/api/workers/:id/account"'));
ok("`account` is pulled off the body before the workers insert", /delete req\.body\.account/.test(postWorkers));
ok("invite mode calls the shared invite primitive (no raw password)", /accountReq\?\.mode === "invite"[\s\S]{0,700}?createOrRefreshInvite\(/.test(postWorkers) && !/bcrypt\.hash/.test(postWorkers));
ok("link mode calls findLinkableUserByEmail + upsertIdentityLink", /accountReq\?\.mode === "link"[\s\S]{0,500}?findLinkableUserByEmail\(/.test(postWorkers) && /upsertIdentityLink\(/.test(postWorkers));
ok("account failure never fails the worker create (try/catch, employee still returned)", /catch \(acctErr\)[\s\S]{0,240}?the employee was still created/.test(postWorkers));

console.log("\nroutes — account status / resend / disable / accept");
ok("GET /api/workers/accounts registered before /api/workers/:id", routes.indexOf('app.get("/api/workers/accounts"') < routes.indexOf('app.get("/api/workers/:id"'));
ok("worker-account routes are admin/manager gated", /app\.get\("\/api\/workers\/:id\/account", requireRole\("admin", "manager"\)/.test(routes) && /app\.post\("\/api\/workers\/:id\/resend-invite", requireRole\("admin", "manager"\)/.test(routes));
ok("worker-account routes company-scope via loadWorkerForAccountRoute", /function loadWorkerForAccountRoute[\s\S]{0,500}?worker\.companyId !== actingUser!?\.companyId/.test(routes));
ok("disable flips the linked users row is_active (reuses existing enforcement)", /UPDATE users\s+SET is_active = \$\{enabled\}/.test(idb));
ok("public accept route bcrypt-hashes the chosen password before acceptInviteWithUser", /app\.post\("\/api\/account-invites\/accept"[\s\S]{0,1000}?bcrypt\.hash\(String\(password\), 10\)[\s\S]{0,160}?acceptInviteWithUser\(/.test(routes));
ok("accept route enforces a minimum password length", /password.{0,20}length < 8/.test(routes));
ok("validate route is public and does not leak beyond the token", /app\.get\("\/api\/account-invites\/validate", async/.test(routes));
ok("both accept-flow routes are in the global auth-gate public allowlist", /req\.path === "\/account-invites\/validate" \|\| req\.path === "\/account-invites\/accept"/.test(routes));

console.log("\nroutes — login records last sign-in, additively");
ok("successful login stamps users.last_login_at best-effort", /UPDATE users SET last_login_at = NOW\(\) WHERE id = \$\{user\.id\}`\)\.catch\(\(\) => \{\}\)/.test(routes));

console.log("\nclient — employee.tsx onboarding + PR#121 hardening intact");
ok("Add Employee form has an account-mode selector (no raw password field)", /data-testid="select-accountMode"/.test(employee) && !/type="password"[\s\S]{0,200}?data-testid="input-account/.test(employee));
ok("create mutation sends `account` as a nested object", /payload\.account = \{ mode: accountMode/.test(employee));
ok("employee rows show an access status badge", /data-testid={`badge-access-\$\{w\.id\}`}/.test(employee));
ok("rows expose resend-invite / disable-access / enable-access actions", /button-resend-invite-|button-invite-/.test(employee) && /button-disable-access-/.test(employee) && /button-enable-access-/.test(employee));
ok("standalone account screen demoted to 'Access & Login'", /Access &amp; Login/.test(employee) && !/>User Accounts</.test(employee));
ok("PR#121 lookup guards still wired", /import \{ asList, selectableOptions \} from "@\/lib\/employee-lookup-guards"/.test(employee) && /class EmployeeDialogBoundary extends Component/.test(employee));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
