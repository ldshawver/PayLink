/**
 * Company-scoped sign-in (migration 0031) — static wiring + pure-function
 * checks. No database, network or server.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let passed = 0;
async function t(name: string, fn: () => void | Promise<void>) { await fn(); passed++; console.log(`  ✓ ${name}`); }
const read = (f: string) => readFileSync(f, "utf8");

async function main() {
  const routes = read("server/routes.ts");
  const signin = read("server/employee-signin.ts");
  const storage = read("server/storage.ts");
  const schema = read("shared/schema.ts");
  const boot = read("server/index.ts");
  const m31 = read("migrations/0031_company_scoped_signin.sql");
  const m32 = read("migrations/0032_clear_plaintext_pins.sql");
  const access = read("server/identity/contractor-access-requests.ts");
  const login = read("client/src/pages/login.tsx");
  const kiosk = read("client/src/pages/time-clock.tsx");
  const marketing = read("client/src/pages/marketing-home.tsx");
  const employee = read("client/src/pages/employee.tsx");
  const settings = read("client/src/pages/settings.tsx");

  console.log("PIN verification");
  await t("no route compares a plaintext PIN or uses the global number+PIN lookup", () => {
    assert.doesNotMatch(routes, /getWorkerByEmployeeNumberAndPin/);
    assert.doesNotMatch(routes, /\.pin !== |\.pin === |worker\.pin\b(?!Hash)/);
  });
  await t("every PIN route authenticates through employee-signin (company-scoped)", () => {
    for (const [path, channel] of [
      ["/api/auth/pin-login", "pin_login"], ["/api/time-clock/auth", "time_clock_auth"], ["/api/time-clock/punch", "time_clock_punch"],
      ["/api/time-clock/clock-in-session", "time_clock_session"], ["/api/time-clock/session-info", "time_clock_session"],
      ["/api/time-clock/clock-out-session", "time_clock_session"], ["/api/time-clock/break-start", "time_clock_break"],
      ["/api/time-clock/break-end", "time_clock_break"],
    ]) {
      const i = routes.indexOf(`app.post("${path}"`);
      assert.ok(i > 0, path);
      const body = routes.slice(i, i + 3000);
      assert.match(body, new RegExp(`authenticateWorkerByPin\\(req, res, \\{[^}]*channel: "${channel}"`), path);
    }
    assert.match(routes, /verifyWorkerSignin\(req, \{ companyCode: req\.body\?\.companyCode, employeeNumber, pin, channel: "time_clock_sign_in" \}\)/);
    assert.match(routes, /channel: "time_clock_punches"/);
  });
  await t("PIN routes are rate limited (none were before)", () => {
    assert.match(routes, /app\.post\("\/api\/auth\/pin-login", pinSigninRateLimit,/);
    for (const p of ["auth", "punch", "sign-in", "clock-in-session", "session-info", "clock-out-session", "break-start", "break-end"]) {
      assert.match(routes, new RegExp(`app\\.post\\("/api/time-clock/${p}", timeClockRateLimit,`), p);
    }
    assert.match(routes, /app\.(get|post)\("\/api\/time-clock\/punches", timeClockRateLimit, recentPunchesHandler\)/);
  });
  await t("generic failure body for every wrong part; dummy bcrypt when nothing to compare", () => {
    assert.match(signin, /GENERIC_SIGNIN_FAILURE = "Invalid company code, employee number, or PIN\."/);
    assert.equal((signin.match(/return fail;/g) ?? []).length, 3);
    assert.match(signin, /burnDummyCompare\(pin\)/);
  });
  await t("never accepts a browser company_id: company only from kiosk / typed code / signed remembered cookie", () => {
    const fn = signin.slice(signin.indexOf("export async function resolveSigninCompany"), signin.indexOf("/** What the sign-in screen may show"));
    assert.doesNotMatch(fn, /companyId\s*[:=]\s*req\.(body|query)/);
    assert.doesNotMatch(fn, /req\.(body|query)/);
    assert.match(fn, /const kiosk = await resolveKiosk\(req\);/);
    assert.match(fn, /c\.code_version === remembered\.codeVersion/);
  });
  await t("PIN-created accounts: unique non-identifying username, random password, PIN-as-password neutralized", () => {
    assert.doesNotMatch(routes, /username: employeeNumber/);
    const fn = routes.slice(routes.indexOf("async function getOrCreatePinUser"), routes.indexOf("async function writeAuditLog"));
    assert.match(fn, /username: pinAccountUsername\(/);
    assert.match(fn, /password: await bcrypt\.hash\(crypto\.randomBytes\(32\)/);
    assert.match(fn, /bcrypt\.compare\(pin, user\.password\)[\s\S]*updateUser\(user\.id, \{ password: await bcrypt\.hash\(crypto\.randomBytes/);
    assert.match(fn, /if \(worker\.companyId && !\(await canAccessStoredCompany\(user as any, worker\.companyId\)\)\) return null;/);
  });
  await t("kiosk username/password fallback: login rate limit, platform/MFA/unverified refused, kiosk company enforced", () => {
    const fn = routes.slice(routes.indexOf("async function kioskPasswordSignIn"), routes.indexOf("async function kioskPasswordSignIn") + 3500);
    assert.match(fn, /loginRateLimit\.hit\(req\)/);
    assert.match(fn, /isPlatformUser\(matchUser\.role\)/);
    assert.match(fn, /emailVerificationRequired && !matchUser\.emailVerifiedAt/);
    assert.match(fn, /mfaRow\?\.mfa_enabled \|\| mfaRow\?\.mfa_enforced_at/);
    assert.match(fn, /ctx\?\.source === "kiosk" && !\(await canAccessCompany\(matchUser, ctx\.companyId\)\)/);
  });
  await t("session punch: own worker, or admin/manager with access to the worker's company (was: any session, any worker)", () => {
    const i = routes.indexOf('app.post("/api/time-clock/punch", timeClockRateLimit');
    const body = routes.slice(i, i + 3000);
    assert.match(body, /const own = sessionUser\.workerId === worker\.id;/);
    assert.match(body, /await canAccessCompany\(sessionUser, worker\.companyId\)/);
    assert.match(body, /if \(!own && !manages\) return res\.status\(404\)/);
    assert.match(body, /const workerId: string = worker\.id;/);
  });

  console.log("PIN storage + exposure");
  await t("storage hashes on every create/update; client pinHash discarded; '' = no change, null = remove", () => {
    assert.match(storage, /const values = await preparePinFields\(data as Record<string, any>\);\n\s+const \[worker\] = await db\.insert\(workers\)/);
    assert.match(storage, /const values = await preparePinFields\(data as Record<string, any>\);\n\s+const \[worker\] = await db\.update\(workers\)/);
    assert.match(schema, /createInsertSchema\(workers\)\.omit\(\{ id: true, createdAt: true, pinHash: true \}\)/);
    assert.match(boot, /ALTER TABLE workers ADD COLUMN IF NOT EXISTS pin_hash TEXT/);
  });
  await t("no /api response carries pin / pinHash / pin_hash (scrubber registered before the API routes)", () => {
    const scrub = routes.indexOf("applyStripCredentialFields(app)");
    assert.ok(scrub > 0);
    const before = routes.slice(0, scrub).match(/app\.(get|post|patch|put|delete)\("\/api\/[^"]+"/g) ?? [];
    assert.deepEqual(before, ['app.get("/api/health"', 'app.get("/api/oauth/tiktok/callback"']);
  });
  const { stripCredentialFields } = await import("../server/middleware/strip-credential-fields");
  await t("scrubber: nested objects/arrays, hasPin flag, untouched otherwise, cycle-safe", () => {
    const cyc: any = { id: "x", pin: "1234" }; cyc.self = cyc;
    const out: any = stripCredentialFields({ workers: [{ id: "a", pin: "1234", pinHash: "$2b$x" }, { id: "b", pin_hash: null, pin: "" }], other: { n: 1 }, cyc });
    assert.deepEqual(out.workers[0], { id: "a", hasPin: true });
    assert.deepEqual(out.workers[1], { id: "b", hasPin: false });
    assert.deepEqual(out.other, { n: 1 });
    assert.equal(JSON.stringify(out.workers).includes("1234"), false);
    assert.equal("pin" in out.cyc, false);
    assert.equal(out.cyc.self, out.cyc);
    assert.equal(stripCredentialFields("str"), "str");
    assert.equal(stripCredentialFields(null), null);
  });
  const s = await import("../server/employee-signin");
  await t("preparePinFields semantics", async () => {
    const a: any = await s.preparePinFields({ pin: "4321", pinHash: "evil", x: 1 });
    assert.equal(a.pin, null); assert.match(a.pinHash, /^\$2[aby]\$/); assert.equal(a.x, 1);
    assert.deepEqual(await s.preparePinFields({ pin: "", firstName: "A" }), { firstName: "A" });
    assert.deepEqual(await s.preparePinFields({ pin: null }), { pin: null, pinHash: null });
    assert.deepEqual(await s.preparePinFields({ pin_hash: "evil", hasPin: true }), {});
  });

  console.log("codes + remembered devices");
  await t("codes: 8 random symbols from the unambiguous alphabet; normalize/format round-trip", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) { const c = s.generateSigninCode(); assert.match(c, /^[A-HJ-NP-Z2-9]{8}$/); seen.add(c); }
    assert.ok(seen.size > 495);
    assert.equal(s.normalizeSigninCode(" ab2c-d3ef "), "AB2CD3EF");
    assert.equal(s.normalizeSigninCode("AB2C-D3E0"), null, "0 is not in the alphabet");
    assert.equal(s.normalizeSigninCode(123 as any), null);
    assert.equal(s.formatSigninCode("AB2CD3EF"), "AB2C-D3EF");
  });
  await t("remembered-company token: HMAC-signed, tamper and forgery rejected", () => {
    const tok = s.signRememberToken("company-1", 3);
    assert.deepEqual(s.verifyRememberToken(tok), { companyId: "company-1", codeVersion: 3 });
    const [p, m] = tok.split(".");
    const other = Buffer.from(JSON.stringify({ c: "company-2", v: 3 })).toString("base64url");
    assert.equal(s.verifyRememberToken(`${other}.${m}`), null);
    assert.equal(s.verifyRememberToken(`${p}.${m.slice(0, -2)}AA`), null);
    assert.equal(s.verifyRememberToken("garbage"), null);
    assert.equal(s.verifyRememberToken(undefined), null);
  });
  await t("cookies are HttpOnly, SameSite=Lax, Secure in production; kiosk stores only a token hash", () => {
    assert.match(signin, /httpOnly: true, secure: isProduction, sameSite: "lax"/);
    assert.match(signin, /token_hash, created_by_user_id\)\n\s+VALUES \(\$\{companyId\}, \$\{label\}, \$\{sha256\(token\)\}/);
  });
  await t("admin endpoints: requireAuth + admin + CSRF on mutations + audited; company authorized server-side", () => {
    for (const [m, p] of [["get", "/api/company-signin/code"], ["post", "/api/company-signin/code/rotate"], ["get", "/api/time-clock/kiosks"], ["post", "/api/time-clock/kiosks"], ["post", "/api/time-clock/kiosks/:id/revoke"]]) {
      const re = new RegExp(`app\\.${m}\\("${p.replace(/[/:]/g, (c) => "\\" + c)}", requireAuth, requireRole\\("admin"\\)${m === "post" ? ", requireCsrfToken, blockDemoWrites" : ""},`);
      assert.match(routes, re, `${m} ${p}`);
    }
    assert.equal((routes.match(/changeType: "(company_signin_code_rotated|time_clock_kiosk_bound|time_clock_kiosk_revoked)"/g) ?? []).length, 3);
    assert.match(routes, /: companyId === actor\.companyId;/);
  });
  await t("public context endpoints are exact entries in the auth backstop; kiosk admin routes are not", () => {
    assert.match(routes, /req\.path === "\/auth\/signin-context" \|\| req\.path === "\/auth\/signin-context\/forget" \|\|/);
    assert.doesNotMatch(routes, /req\.path(\.startsWith\(|\s===\s)"\/time-clock\/kiosks/);
  });

  console.log("employee numbers");
  await t("POST /api/workers, CSV imports and access-request approval allocate in the insert's transaction", () => {
    assert.doesNotMatch(routes, /highest > 0 \? highest \+ 1 : 1001/);
    assert.doesNotMatch(access, /highest > 0 \? highest \+ 1 : 1001/);
    assert.ok((routes.match(/createWorkerAllocatingNumber\(/g) ?? []).length >= 3);
    assert.match(access, /createWorkerAllocatingNumber\(\{/);
    const fn = signin.slice(signin.indexOf("export async function createWorkerAllocatingNumber"));
    assert.match(fn, /return db\.transaction\(async \(tx\) => \{[\s\S]*allocateEmployeeNumber\(tx, values\.companyId, now\)[\s\S]*tx\.insert\(workers\)/);
  });
  await t("allocator: counter row FOR UPDATE, never below existing max, skips taken, fails at YY99", () => {
    const fn = signin.slice(signin.indexOf("export async function allocateEmployeeNumber"), signin.indexOf("/** Postgres unique violation"));
    assert.match(fn, /FOR UPDATE/);
    assert.match(fn, /Math\.max\(counter\?\.last_value \?\? 0, maxExisting \?\? 0\) \+ 1/);
    assert.match(fn, /while \(next <= 99\)/);
    assert.match(fn, /throw new EmployeeNumberExhaustedError\(yy\)/);
    assert.match(fn, /pg_advisory_xact_lock/);
  });
  await t("bulk worker import authorizes each row's company", () => {
    assert.match(routes, /if \(importCompanies && !importCompanies\.includes\(records\[i\]\?\.companyId\)\)/);
  });

  console.log("migrations");
  await t("0031: owner guard, duplicate guard, in-database hashing, keeps plaintext, unique index, counters from own data, ledger", () => {
    assert.match(m31, /IF app_owner <> current_user THEN/);
    assert.match(m31, /duplicate \(company_id, employee_number\) pairs exist/);
    assert.match(m31, /SET pin_hash = crypt\(pin, gen_salt\('bf', 10\)\)/);
    assert.doesNotMatch(m31, /SET pin = NULL|DROP TABLE|DELETE FROM|TRUNCATE/i);
    assert.match(m31, /CREATE UNIQUE INDEX IF NOT EXISTS uq_workers_company_employee_number\s+ON workers \(company_id, employee_number\) WHERE employee_number IS NOT NULL/);
    assert.match(m31, /max\(substr\(w\.employee_number, 3, 2\)::int\)[\s\S]*GROUP BY w\.company_id/);
    assert.match(m31, /VALUES \('0031', 'company_scoped_signin'\)\s+ON CONFLICT \(version\) DO NOTHING/);
    assert.match(m31, /IF b < 248 THEN/);
  });
  await t("0032 (not applied by this PR): requires 0031 and full hash coverage before clearing plaintext", () => {
    assert.match(m32, /requires migration 0031 first/);
    assert.match(m32, /plaintext PIN but no pin_hash/);
    assert.match(m32, /UPDATE workers SET pin = NULL WHERE pin IS NOT NULL;/);
  });

  console.log("client");
  await t("company code field on every PIN sign-in surface; codes sent only when required", () => {
    for (const [name, src] of [["login", login], ["time-clock", kiosk], ["marketing", marketing]] as const) {
      assert.match(src, /<CompanySigninCodeField/, name);
      assert.match(src, /needsCompanyCode\(/, name);
    }
    assert.equal((login.match(/<CompanySigninCodeField/g) ?? []).length, 2, "employee tab + time-clock tab");
  });
  await t("PIN never placed in a URL; never pre-filled in the employee form", () => {
    assert.doesNotMatch(login, /&pin=\$\{/);
    assert.match(login, /apiRequest\("POST", "\/api\/time-clock\/punches"/);
    assert.doesNotMatch(employee, /pin: worker\.pin/);
    assert.match(employee, /hasPin/);
  });
  await t("Settings shows the Employee sign-in card", () => {
    assert.match(settings, /<EmployeeSigninSettings \/>/);
  });

  console.log(`\ncompany sign-in static: ${passed} passed`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
