/**
 * Company-scoped employee / time-clock sign-in, per-company employee numbers
 * and hashed PINs (migration 0031) — end to end against the REAL server
 * (server/index.ts via the shared harness), real sessions, real CSRF.
 *
 * Phase A (before 0031, legacy data with plaintext PINs): the legacy sign-in
 *   path keeps working (deploy-before-migration), responses never carry PINs,
 *   an employee session is created that must survive the migration.
 * Migration: refuses on a within-company duplicate; applies as the table
 *   owner (pgcrypto created by the owner); hashes PINs in-database; keeps
 *   plaintext (until 0032); seeds per-company counters; idempotent rerun.
 * Phase B (after 0031): company code + number + PIN, generic failures,
 *   cross-company collisions, remembered company, kiosk binding, code
 *   rotation, lockout + audit (no PINs), per-IP limit, atomic numbering under
 *   concurrency, per-company uniqueness, existing numbers unchanged, PIN
 *   hashing/lazy upgrade/no exposure, PIN-as-password neutralization,
 *   time-clock tenant isolation, kiosk manager fallback hardening.
 *
 * Synthetic fixtures only; refuses staging/production URLs; zero residue.
 * Run: TEST_DATABASE_URL=postgresql://…/disposable npx tsx tests/company-signin-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import bcrypt from "bcrypt";
import { startTestServer } from "../scripts/cross-tenant-negative-tests/server-harness";
import { cascadeDelete, verifyZeroResidue } from "../scripts/cross-tenant-negative-tests/cascade-cleanup";

const FORBIDDEN = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i, /paylinkapp/i];
let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  ✓  ${name}`); }
  else { failed++; console.error(`  ✗  ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ""}`); }
}

/** A browser/device: its own cookie jar. */
class Device {
  jar = new Map<string, string>();
  constructor(public base: string) {}
  cookieHeader() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "); }
  absorb(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const i = pair.indexOf("=");
      const k = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim();
      const expired = attrs.some((a) => /expires=thu, 01 jan 1970/i.test(a) || /max-age=0\b/i.test(a.trim()));
      if (expired || v === "") this.jar.delete(k); else this.jar.set(k, v);
    }
  }
  get csrf() { const v = this.jar.get("csrf_token"); return v ? decodeURIComponent(v) : undefined; }
  async req(method: string, path: string, body?: unknown, opts: { csrf?: boolean } = {}) {
    const headers: Record<string, string> = {};
    const ck = this.cookieHeader();
    if (ck) headers.cookie = ck;
    if (body !== undefined) headers["content-type"] = "application/json";
    if (opts.csrf !== false && method !== "GET" && this.csrf) headers["x-csrf-token"] = this.csrf;
    const res = await fetch(`${this.base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
    this.absorb(res);
    const text = await res.text();
    let json: any; try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: res.status, body: json, text };
  }
  /** Touch an authenticated GET so the CSRF cookie is issued. */
  async primeCsrf() { await this.req("GET", "/api/auth/me"); }
}

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) { console.log("TEST_DATABASE_URL not set — skipping company sign-in DB tests (0 run)."); return; }
  for (const p of FORBIDDEN) if (p.test(url)) throw new Error("TEST_DATABASE_URL looks like staging/production. Refusing.");
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) throw new Error("TEST_DATABASE_URL equals DATABASE_URL. Refusing.");
  const pool = new Pool({ connectionString: url, max: 6 });
  const dbName = (await pool.query("SELECT current_database() n")).rows[0].n as string;
  if (FORBIDDEN.some((p) => p.test(dbName))) throw new Error("protected database name");
  const already = (await pool.query(`SELECT to_regclass('paylink_migrations.applied') IS NOT NULL AND EXISTS (SELECT 1 FROM paylink_migrations.applied WHERE version='0031') AS a`)).rows[0].a;
  if (already) throw new Error("0031 already applied to this database — use a fresh disposable copy (the test exercises the migration itself).");

  const sfx = crypto.randomBytes(3).toString("hex");
  const companyIds: string[] = [], userIds: string[] = [], workerIds: string[] = [], tenantIds: string[] = [];
  let server: Awaited<ReturnType<typeof startTestServer>> | undefined;
  const pw = crypto.randomBytes(10).toString("hex");
  const pwHash = await bcrypt.hash(pw, 10);
  const id = () => crypto.randomUUID();
  const co: Record<string, string> = {};
  const W: Record<string, string> = {};
  const U: Record<string, { id: string; username: string }> = {};

  const mkCompany = async (key: string) => {
    const c = id(); co[key] = c; companyIds.push(c);
    await pool.query(`INSERT INTO companies (id, name, subscription_status) VALUES ($1,$2,'active')`, [c, `ZZ SIGNIN ${key} ${sfx}`]);
    const t = (await pool.query(`INSERT INTO tenants (name, slug, status) VALUES ($1,$1,'active') RETURNING id`, [`zz-signin-${key.toLowerCase()}-${sfx}`])).rows[0].id;
    tenantIds.push(t);
    await pool.query(`INSERT INTO tenant_companies (tenant_id, company_id, is_primary) VALUES ($1,$2,true)`, [t, c]);
  };
  // Legacy-style worker: plaintext PIN exactly like production today.
  const mkWorker = async (key: string, company: string, num: string | null, pin: string | null, type = "employee") => {
    const w = id(); W[key] = w; workerIds.push(w);
    await pool.query(
      `INSERT INTO workers (id, company_id, first_name, last_name, worker_type, worker_group, status, is_active, employee_number, pin)
       VALUES ($1,$2,'ZZ',$3,$4,$5,'active',true,$6,$7)`,
      [w, company, key, type, type === "employee" ? "hourly_employee" : "1099_contractor", num, pin]);
  };
  const mkUser = async (key: string, role: string, company: string | null, workerId: string | null = null) => {
    const u = id(); U[key] = { id: u, username: `zz_signin_${key}_${sfx}` }; userIds.push(u);
    await pool.query(`INSERT INTO users (id, username, password, role, company_id, worker_id, is_active) VALUES ($1,$2,$3,$4,$5,$6,true)`,
      [u, U[key].username, pwHash, role, company, workerId]);
  };
  const adminLogin = async (dev: Device, key: string) => {
    const r = await dev.req("POST", "/api/auth/login", { username: U[key].username, password: pw });
    if (r.status !== 200) throw new Error(`admin login ${key} ${r.status} ${r.text.slice(0, 120)}`);
    await dev.primeCsrf();
  };

  try {
    // ── Fixtures (pre-migration, legacy data) ──
    for (const k of ["A", "B", "C", "D", "E"]) await mkCompany(k);
    for (const n of ["2602", "2605", "2607", "2611"]) await mkWorker(`A${n}`, co.A, n, n === "2605" ? "1234" : "9" + n.slice(1));
    await mkWorker("A1111", co.A, "1111", null);
    for (const n of ["2605", "2612"]) await mkWorker(`B${n}`, co.B, n, n === "2605" ? "1234" : "5555");  // B2605 collides with A2605 (same PIN)
    for (const n of ["1001", "1002", "1003"]) await mkWorker(`C${n}`, co.C, n, "4242");                   // legacy non-YY numbering
    await mkWorker("E2698", co.E, "2698", null);
    await mkUser("adminA", "admin", co.A); await mkUser("adminB", "admin", co.B);
    await mkUser("adminE", "admin", co.E); await mkUser("mgrA", "manager", co.A);
    await mkUser("mgrAmfa", "manager", co.A); await pool.query(`UPDATE users SET mfa_enabled = true WHERE id = $1`, [U.mgrAmfa.id]);
    const numbersBefore = (await pool.query(`SELECT id, employee_number FROM workers WHERE id = ANY($1) ORDER BY id`, [workerIds])).rows;

    // ════════ Phase A — before 0031 (legacy path) ════════
    console.log("\n— phase A: before migration 0031 (legacy behaviour kept) —");
    server = await startTestServer(url);
    let base = server.baseUrl;
    const legacyPhone = new Device(base);
    let r = await legacyPhone.req("POST", "/api/auth/pin-login", { employeeNumber: "2607", pin: "9607" });
    check("legacy PIN login (no company code) still works before the migration", r.status === 200 && r.body?.workerId === W.A2607, r);
    const legacyUserId = r.body?.id as string;
    if (legacyUserId) userIds.push(legacyUserId);
    check("…and the new PIN account's username is not the bare employee number", r.body?.username && r.body.username !== "2607" && !r.body.username.includes(co.A), r.body?.username);
    check("legacy session works", (await legacyPhone.req("GET", "/api/auth/me")).status === 200);
    // Pre-existing legacy account whose password IS its PIN (old flow): A2605
    const legacyPinUser = id(); userIds.push(legacyPinUser);
    await pool.query(`INSERT INTO users (id, username, password, role, company_id, worker_id, is_active) VALUES ($1,$2,$3,'employee',$4,$5,true)`,
      [legacyPinUser, `2605x${sfx}`, await bcrypt.hash("1234", 10), co.A, W.A2605]);
    const adminDevA = new Device(base);
    await adminLogin(adminDevA, "adminA");
    r = await adminDevA.req("GET", `/api/workers?companyId=${co.A}`);
    const listA = Array.isArray(r.body) ? r.body : (r.body?.workers ?? []);
    check("worker list never carries a PIN (legacy plaintext present in DB)", r.status === 200 && listA.length > 0 && !r.text.includes('"pin"') && !r.text.includes("9607") && !r.text.includes("pin_hash"), r.status);
    check("…but exposes hasPin for the admin UI", listA.some((w: any) => w.id === W.A2607 && w.hasPin === true) && listA.some((w: any) => w.id === W.A1111 && w.hasPin === false));
    r = await legacyPhone.req("POST", "/api/time-clock/auth", { employeeNumber: "2607", pin: "9607" });
    check("legacy time-clock auth works and returns no PIN", r.status === 200 && !r.text.includes("9607") && !("pin" in (r.body?.worker ?? {})), r);
    r = await adminDevA.req("POST", "/api/workers", { companyId: co.A, firstName: "ZZ", lastName: `PreMig ${sfx}`, workerType: "employee", payRate: "15" });
    check("pre-migration allocation (advisory lock path) → 2612 for company A", r.status === 201 || r.status === 200 ? r.body?.employeeNumber === "2612" : false, r);
    if (r.body?.id) workerIds.push(r.body.id);
    await server.stop(); server = undefined;

    // ── Migration 0031 ──
    console.log("\n— migration 0031 —");
    const runMigration = () => execFileSync("psql", [url, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "migrations/0031_company_scoped_signin.sql"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const dupW = id(); workerIds.push(dupW);
    await pool.query(`INSERT INTO workers (id, company_id, first_name, last_name, worker_type, status, employee_number) VALUES ($1,$2,'ZZ','Dup','employee','active','2611')`, [dupW, co.A]);
    let migErr = "";
    try { runMigration(); } catch (e: any) { migErr = String(e.stderr || e.message); }
    check("migration refuses while a within-company duplicate exists (nothing renumbered)", /duplicate \(company_id, employee_number\)/.test(migErr), migErr.slice(0, 200));
    check("…and applied nothing", (await pool.query(`SELECT count(*)::int n FROM paylink_migrations.applied WHERE version='0031'`)).rows[0].n === 0 && (await pool.query(`SELECT to_regclass('company_signin_codes') IS NULL AS n`)).rows[0].n === true);
    await pool.query(`DELETE FROM workers WHERE id = $1`, [dupW]);
    runMigration();
    check("migration applied (ledger 0031 ×1)", (await pool.query(`SELECT count(*)::int n FROM paylink_migrations.applied WHERE version='0031'`)).rows[0].n === 1);
    runMigration();
    check("rerun is a no-op (ledger still ×1)", (await pool.query(`SELECT count(*)::int n FROM paylink_migrations.applied WHERE version='0031'`)).rows[0].n === 1);
    const pins = (await pool.query(`SELECT id, pin, pin_hash FROM workers WHERE id = ANY($1) AND pin IS NOT NULL`, [workerIds])).rows;
    check("every plaintext PIN now has a bcrypt hash computed in-database", pins.length >= 8 && pins.every((p: any) => /^\$2[aby]\$/.test(p.pin_hash ?? "")), pins.length);
    const a2607 = (await pool.query(`SELECT pin, pin_hash FROM workers WHERE id=$1`, [W.A2607])).rows[0];
    check("the worker who signed in during phase A was already upgraded lazily (hash, no plaintext)", a2607.pin === null && await bcrypt.compare("9607", a2607.pin_hash));
    check("hashes verify with the application's bcrypt", await bcrypt.compare("1234", pins.find((p: any) => p.id === W.A2605).pin_hash));
    check("plaintext retained until 0032 (rollback window)", pins.every((p: any) => p.pin !== null));
    const codes = (await pool.query(`SELECT company_id, code, code_version FROM company_signin_codes WHERE company_id = ANY($1)`, [companyIds])).rows;
    check("one sign-in code per company, 8 chars from the unambiguous alphabet, unrelated to ids", codes.length === 5 && codes.every((c: any) => /^[A-HJ-NP-Z2-9]{8}$/.test(c.code) && !c.company_id.toUpperCase().includes(c.code)) && new Set(codes.map((c: any) => c.code)).size === 5);
    const code = Object.fromEntries(codes.map((c: any) => [Object.keys(co).find((k) => co[k] === c.company_id)!, c.code as string]));
    const counters = Object.fromEntries((await pool.query(`SELECT company_id, last_value FROM employee_number_counters WHERE company_id = ANY($1)`, [companyIds])).rows.map((r: any) => [r.company_id, r.last_value]));
    check("counters seeded from each company's OWN highest YYNN (A 12, B 12, E 98; C has none)", counters[co.A] === 12 && counters[co.B] === 12 && counters[co.E] === 98 && counters[co.C] === undefined, counters);
    check("unique index on (company_id, employee_number) exists", (await pool.query(`SELECT count(*)::int n FROM pg_indexes WHERE indexname='uq_workers_company_employee_number'`)).rows[0].n === 1);
    check("pgcrypto created by the table owner (no superuser)", (await pool.query(`SELECT count(*)::int n FROM pg_extension WHERE extname='pgcrypto'`)).rows[0].n === 1);

    // ════════ Phase B — after 0031 ════════
    console.log("\n— phase B: company-scoped sign-in —");
    process.env.PIN_SIGNIN_RATE_LIMIT_MAX = "500"; // per-IP limit is exercised separately in phase C
    server = await startTestServer(url);
    base = server.baseUrl;
    legacyPhone.base = base;
    check("an employee session created BEFORE the migration still works", (await legacyPhone.req("GET", "/api/auth/me")).status === 200);

    const phone = new Device(base);
    const generic = "Invalid company code, employee number, or PIN.";
    const attempts: Array<[string, any]> = [
      ["no company code (nothing remembered)", { employeeNumber: "2607", pin: "9607" }],
      ["unknown company code", { companyCode: "ZZZZ-ZZZZ", employeeNumber: "2607", pin: "9607" }],
      ["malformed company code", { companyCode: "nope", employeeNumber: "2607", pin: "9607" }],
      ["right code, unknown number", { companyCode: code.A, employeeNumber: "2699", pin: "9607" }],
      ["right code + number, wrong PIN", { companyCode: code.A, employeeNumber: "2607", pin: "0000" }],
      ["wrong company's code for that number", { companyCode: code.B, employeeNumber: "2607", pin: "9607" }],
    ];
    const bodies = new Set<string>();
    for (const [label, body] of attempts) {
      r = await phone.req("POST", "/api/auth/pin-login", body);
      check(`${label} → 401 generic`, r.status === 401 && r.body?.message === generic, r);
      bodies.add(r.text);
    }
    check("all failures return byte-identical bodies", bodies.size === 1, [...bodies]);
    check("no remembered-company cookie after failures", !phone.jar.has("pl_signin_company"));

    const pwLogin = async (u: string, p: string) => (await new Device(base).req("POST", "/api/auth/login", { username: u, password: p })).status;
    check("legacy account whose password = PIN: username/password login still possible before its next PIN sign-in (transition gap)", (await pwLogin(`2605x${sfx}`, "1234")) === 200);
    r = await phone.req("POST", "/api/auth/pin-login", { companyCode: code.A.toLowerCase().replace(/^(.{4})/, "$1-"), employeeNumber: "2605", pin: "1234" });
    check("collision: code A + 2605 + 1234 → A's worker", r.status === 200 && r.body?.workerId === W.A2605 && r.body?.companyId === co.A, r);
    const phone2 = new Device(base);
    r = await phone2.req("POST", "/api/auth/pin-login", { companyCode: code.B, employeeNumber: "2605", pin: "1234" });
    check("collision: code B + same 2605 + same PIN → B's worker", r.status === 200 && r.body?.workerId === W.B2605 && r.body?.companyId === co.B, r);
    if (r.body?.id) userIds.push(r.body.id);
    check("company remembered on the device after a typed-code success", phone.jar.has("pl_signin_company"));
    r = await phone.req("GET", "/api/auth/signin-context");
    check("signin-context shows the remembered company name, never the code", r.body?.remembered === true && r.body?.companyName === `ZZ SIGNIN A ${sfx}` && !r.text.includes(code.A), r.body);
    await phone.req("POST", "/api/auth/logout");
    r = await phone.req("POST", "/api/auth/pin-login", { employeeNumber: "2611", pin: "9611" });
    check("after logout: remembered device signs in with number + PIN only", r.status === 200 && r.body?.workerId === W.A2611, r);
    if (r.body?.id) userIds.push(r.body.id);
    await phone.req("POST", "/api/auth/logout");
    r = await phone.req("POST", "/api/auth/pin-login", { employeeNumber: "2605", pin: "1234" });
    check("remembered company A never resolves B's colliding worker", r.status === 200 && r.body?.workerId === W.A2605);
    await phone.req("POST", "/api/auth/logout");
    const tampered = new Device(base);
    const forged = Buffer.from(JSON.stringify({ c: co.B, v: 1 })).toString("base64url") + "." + crypto.randomBytes(32).toString("base64url");
    tampered.jar.set("pl_signin_company", forged);
    r = await tampered.req("POST", "/api/auth/pin-login", { employeeNumber: "2605", pin: "1234" });
    check("forged remembered-company cookie → 401 generic", r.status === 401 && r.body?.message === generic);
    const bodyCompany = new Device(base);
    r = await bodyCompany.req("POST", "/api/auth/pin-login", { companyId: co.A, employeeNumber: "2607", pin: "9607" });
    check("browser-supplied companyId is ignored (→ 401, not a sign-in)", r.status === 401);
    r = await phone.req("POST", "/api/auth/signin-context/forget");
    r = await phone.req("POST", "/api/auth/pin-login", { employeeNumber: "2605", pin: "1234" });
    check("'Not your company?' forgets the device's company", r.status === 401 && !phone.jar.has("pl_signin_company"));

    console.log("\n— PIN-as-password neutralization —");
    // phone signed in as A2605 earlier in phase B → that rotated the password
    check("…after a PIN sign-in, PIN-as-password no longer works", (await pwLogin(`2605x${sfx}`, "1234")) === 401);
    check("new PIN accounts never had PIN-as-password", (await pwLogin("2607", "9607")) === 401);

    console.log("\n— lockout + audit —");
    const brute = new Device(base);
    for (let i = 0; i < 10; i++) await brute.req("POST", "/api/auth/pin-login", { companyCode: code.C, employeeNumber: "1001", pin: String(1000 + i) });
    r = await brute.req("POST", "/api/auth/pin-login", { companyCode: code.C, employeeNumber: "1001", pin: "4242" });
    check("after 10 failures for (C, 1001) even the correct PIN is refused (429)", r.status === 429, r);
    r = await new Device(base).req("POST", "/api/auth/pin-login", { companyCode: code.C, employeeNumber: "1002", pin: "4242" });
    check("lockout is per employee number (C 1002 unaffected)", r.status === 200, r);
    if (r.body?.id) userIds.push(r.body.id);
    r = await new Device(base).req("POST", "/api/auth/pin-login", { companyCode: code.B, employeeNumber: "2612", pin: "5555" });
    check("lockout is per company + number (B 2612 unaffected)", r.status === 200, r);
    if (r.body?.id) userIds.push(r.body.id);
    const ev = (await pool.query(`SELECT * FROM employee_signin_events WHERE company_id = ANY($1) OR company_id IS NULL`, [companyIds])).rows;
    check("failed attempts are audited (bad_pin / unknown_number / company_unresolved / locked)", ["bad_pin", "unknown_number", "company_unresolved"].every((x) => ev.some((e: any) => e.reason === x)) && ev.some((e: any) => e.outcome === "locked"));
    const evText = JSON.stringify(ev);
    check("audit never contains a PIN or a company code", !["1234", "9607", "9602", "1003", "0000"].some((p) => new RegExp(`"${p}"`).test(evText)) && !Object.values(code).some((c) => evText.includes(c)));
    check("audit stores only a hashed IP", ev.every((e: any) => !e.ip_hash || /^[0-9a-f]{32}$/.test(e.ip_hash)));

    console.log("\n— code rotation —");
    const remembered = new Device(base);
    r = await remembered.req("POST", "/api/auth/pin-login", { companyCode: code.A, employeeNumber: "2611", pin: "9611" });
    check("employee signs in with code A (device remembers A)", r.status === 200);
    const adminA = new Device(base); await adminLogin(adminA, "adminA");
    r = await adminA.req("GET", "/api/company-signin/code");
    check("admin views the code (formatted XXXX-XXXX)", r.status === 200 && r.body?.code === `${code.A.slice(0, 4)}-${code.A.slice(4)}`, r);
    r = await adminA.req("POST", "/api/company-signin/code/rotate", {}, { csrf: false });
    check("rotate without CSRF → 403", r.status === 403);
    const adminB = new Device(base); await adminLogin(adminB, "adminB");
    r = await adminB.req("GET", `/api/company-signin/code?companyId=${co.A}`);
    check("admin B cannot view A's code via companyId → 404", r.status === 404, r.status);
    r = await adminB.req("POST", "/api/company-signin/code/rotate", { companyId: co.A });
    check("admin B cannot rotate A's code → 404 (A unchanged)", r.status !== 200 && (await pool.query(`SELECT code FROM company_signin_codes WHERE company_id=$1`, [co.A])).rows[0].code === code.A, r.status);
    const empA = new Device(base); r = await empA.req("GET", "/api/company-signin/code");
    check("employees cannot view the admin code endpoint", r.status === 401 || r.status === 403);
    r = await adminA.req("POST", "/api/company-signin/code/rotate", {});
    check("admin rotates (CSRF) → new code", r.status === 200 && r.body?.code && r.body.code.replace("-", "") !== code.A && r.body.sessionsEnded === 0, r);
    const newCodeA = String(r.body?.code ?? "").replace("-", "");
    check("rotation audited without the code", (await pool.query(`SELECT count(*)::int n FROM authorization_audit_log WHERE company_id=$1 AND change_type='company_signin_code_rotated' AND coalesce(after_value,'')||coalesce(note,'') NOT LIKE $2`, [co.A, `%${newCodeA}%`])).rows[0].n === 1);
    check("active employee session survives rotation", (await remembered.req("GET", "/api/auth/me")).status === 200);
    await remembered.req("POST", "/api/auth/logout");
    r = await remembered.req("POST", "/api/auth/pin-login", { employeeNumber: "2611", pin: "9611" });
    check("remembered device is invalidated by rotation (→ 401)", r.status === 401);
    r = await new Device(base).req("POST", "/api/auth/pin-login", { companyCode: code.A, employeeNumber: "2611", pin: "9611" });
    check("old code no longer works", r.status === 401);
    r = await remembered.req("POST", "/api/auth/pin-login", { companyCode: newCodeA, employeeNumber: "2611", pin: "9611" });
    check("new code works", r.status === 200);
    r = await adminA.req("POST", "/api/company-signin/code/rotate", { endEmployeeSessions: true });
    check("rotation with 'sign out employees' ends employee sessions", r.status === 200 && r.body?.sessionsEnded >= 1 && (await remembered.req("GET", "/api/auth/me")).status === 401, r.body);
    check("…but never the administrator's own session", (await adminA.req("GET", "/api/auth/me")).status === 200);
    const codeA3 = String(r.body?.code ?? "").replace("-", "");

    console.log("\n— kiosk binding —");
    const kiosk = new Device(base); await adminLogin(kiosk, "adminA");
    r = await kiosk.req("POST", "/api/time-clock/kiosks", { label: `Front desk ${sfx}` });
    check("admin binds this device as company A's time clock", r.status === 201 && kiosk.jar.has("pl_time_clock_kiosk"), r);
    const kioskId = r.body?.id as string;
    await kiosk.req("POST", "/api/auth/logout");
    r = await kiosk.req("GET", "/api/auth/signin-context");
    check("kiosk context: company A, kiosk=true", r.body?.kiosk === true && r.body?.companyName === `ZZ SIGNIN A ${sfx}`, r.body);
    r = await kiosk.req("POST", "/api/time-clock/auth", { employeeNumber: "2607", pin: "9607" });
    check("kiosk: number + PIN only (no code) → A's worker", r.status === 200 && r.body?.worker?.id === W.A2607, r);
    r = await kiosk.req("POST", "/api/time-clock/auth", { companyCode: code.B, employeeNumber: "2612", pin: "5555" });
    check("kiosk: typing another company's code cannot switch it (B worker refused)", r.status === 401);
    r = await kiosk.req("POST", "/api/auth/signin-context/forget");
    r = await kiosk.req("GET", "/api/auth/signin-context");
    check("kiosk binding cannot be cleared from the device", r.body?.kiosk === true);
    r = await adminB.req("POST", `/api/time-clock/kiosks/${kioskId}/revoke`, {});
    check("admin B cannot revoke A's kiosk → 404", r.status === 404);
    r = await adminB.req("GET", "/api/time-clock/kiosks");
    check("admin B's kiosk list excludes A's device", r.status === 200 && !r.text.includes(kioskId));
    r = await kiosk.req("POST", "/api/time-clock/sign-in", { employeeNumber: U.mgrA.username, pin: pw });
    check("kiosk manager fallback: manager of the kiosk company signs in", r.status === 200 && r.body?.id === U.mgrA.id, r);
    await kiosk.req("POST", "/api/auth/logout");
    r = await kiosk.req("POST", "/api/time-clock/sign-in", { employeeNumber: U.adminB.username, pin: pw });
    check("kiosk manager fallback: another company's admin → 401", r.status === 401, r);
    r = await kiosk.req("POST", "/api/time-clock/sign-in", { employeeNumber: U.mgrAmfa.username, pin: pw });
    check("kiosk manager fallback refuses MFA accounts (use main sign-in) → 403", r.status === 403, r);
    r = await adminA.req("POST", `/api/time-clock/kiosks/${kioskId}/revoke`, {});
    check("admin A revokes the kiosk", r.status === 200);
    r = await kiosk.req("POST", "/api/time-clock/auth", { employeeNumber: "2607", pin: "9607" });
    check("revoked kiosk now requires the company code", r.status === 401);
    check("kiosk events audited", (await pool.query(`SELECT count(*)::int n FROM authorization_audit_log WHERE company_id=$1 AND change_type IN ('time_clock_kiosk_bound','time_clock_kiosk_revoked')`, [co.A])).rows[0].n === 2);

    console.log("\n— time-clock tenant isolation —");
    const empDevA = new Device(base);
    r = await empDevA.req("POST", "/api/auth/pin-login", { companyCode: codeA3, employeeNumber: "2607", pin: "9607" });
    check("employee A2607 signs in", r.status === 200);
    r = await empDevA.req("POST", "/api/time-clock/punch", { workerId: W.B2612, punchType: "clock_in" });
    check("session punch for ANOTHER company's worker → 404 (was accepted before)", r.status === 404, r);
    r = await empDevA.req("POST", "/api/time-clock/punch", { workerId: W.A2611, punchType: "clock_in" });
    check("session punch for a co-worker (not own, not a manager) → 404", r.status === 404, r);
    r = await empDevA.req("POST", "/api/time-clock/punch", { workerId: W.A2611, employeeNumber: "2607", pin: "9607", punchType: "clock_in" });
    check("self-service punch with own PIN but another workerId → 401", r.status === 401, r);
    r = await new Device(base).req("POST", "/api/time-clock/punch", { companyCode: code.B, employeeNumber: "2607", pin: "9607", punchType: "clock_in" });
    check("self-service punch with the wrong company's code → 401", r.status === 401);
    const punchesBefore = (await pool.query(`SELECT count(*)::int n FROM time_punches WHERE worker_id = ANY($1)`, [[W.B2612, W.A2611]])).rows[0].n;
    check("no punch was written for the targeted workers", punchesBefore === 0, punchesBefore);
    r = await new Device(base).req("POST", "/api/time-clock/punches", { companyCode: codeA3, employeeNumber: "2607", pin: "9607", workerId: W.A2611 });
    check("recent punches: another workerId with own PIN → 401", r.status === 401);
    r = await new Device(base).req("POST", "/api/time-clock/session-info", { companyCode: code.B, employeeNumber: "2607", pin: "9607" });
    check("session-info with wrong company → 401 generic", r.status === 401 && r.body?.message === generic);
    r = await new Device(base).req("POST", "/api/time-clock/break-start", { companyCode: code.B, employeeNumber: "2605", pin: "1234" });
    check("break-start for the colliding number resolves only within the named company (B)", r.status !== 401 || r.body?.message === generic);

    console.log("\n— employee numbers —");
    r = await adminA.req("GET", `/api/workers?companyId=${co.A}`);
    const conc = await Promise.all(Array.from({ length: 20 }, (_, i) => adminA.req("POST", "/api/workers", { companyId: co.A, firstName: "ZZ", lastName: `Conc${i} ${sfx}`, workerType: "employee", payRate: "15" })));
    const nums = conc.map((x) => x.body?.employeeNumber as string);
    conc.forEach((x) => x.body?.id && workerIds.push(x.body.id));
    check("20 concurrent creations in company A all succeed", conc.every((x) => x.status === 200 || x.status === 201), conc.map((x) => x.status));
    check("…with 20 distinct numbers", new Set(nums).size === 20, nums);
    check("…continuing after A's 2612: exactly 2613–2632", [...nums].sort().join(",") === Array.from({ length: 20 }, (_, i) => String(2613 + i)).join(","), [...nums].sort());
    const concB = await Promise.all(Array.from({ length: 5 }, (_, i) => adminB.req("POST", "/api/workers", { companyId: co.B, firstName: "ZZ", lastName: `ConcB${i} ${sfx}`, workerType: "employee", payRate: "15" })));
    concB.forEach((x) => x.body?.id && workerIds.push(x.body.id));
    check("company B numbers independently: 2613–2617 (same values as A, different company)", concB.map((x) => x.body?.employeeNumber).sort().join(",") === "2613,2614,2615,2616,2617", concB.map((x) => x.body?.employeeNumber));
    const adminC = new Device(base); await mkUser("adminC", "admin", co.C); await adminLogin(adminC, "adminC");
    r = await adminC.req("POST", "/api/workers", { companyId: co.C, firstName: "ZZ", lastName: `C ${sfx}`, workerType: "employee", payRate: "15" });
    if (r.body?.id) workerIds.push(r.body.id);
    check("company C (legacy 1001–1003, no 26xx) starts its 2026 series at 2601", r.body?.employeeNumber === "2601", r.body?.employeeNumber);
    r = await adminA.req("POST", "/api/workers", { companyId: co.A, firstName: "ZZ", lastName: `Dup ${sfx}`, workerType: "employee", payRate: "15", employeeNumber: "2607" });
    check("manual duplicate number within the company → 409", r.status === 409 && /already in use/.test(r.body?.message ?? ""), r);
    r = await adminB.req("POST", "/api/workers", { companyId: co.B, firstName: "ZZ", lastName: `SameNum ${sfx}`, workerType: "employee", payRate: "15", employeeNumber: "2607" });
    if (r.body?.id) workerIds.push(r.body.id);
    check("same manual number in a DIFFERENT company → allowed", r.status === 200 || r.status === 201, r);
    r = await adminA.req("PATCH", `/api/workers/${W.A2602}`, { employeeNumber: "2611" });
    check("renumbering onto a taken number within the company → 409", r.status === 409, r);
    r = await adminA.req("POST", "/api/workers", { companyId: co.B, firstName: "ZZ", lastName: `X ${sfx}`, workerType: "employee", payRate: "15" });
    check("admin A cannot create a worker in company B → 403", r.status === 403);
    r = await adminA.req("POST", "/api/import/workers", { records: [{ companyId: co.B, firstName: "ZZ", lastName: `Imp ${sfx}`, workerType: "employee", payRate: "15" }] });
    check("bulk import into another company is refused per row", r.status === 200 && r.body?.imported === 0 && /Forbidden/.test((r.body?.errors ?? []).join(" ")), r.body);
    const adminE = new Device(base); await adminLogin(adminE, "adminE");
    r = await adminE.req("POST", "/api/workers", { companyId: co.E, firstName: "ZZ", lastName: `E1 ${sfx}`, workerType: "employee", payRate: "15" });
    if (r.body?.id) workerIds.push(r.body.id);
    check("company E: 2699 is still allocatable", r.body?.employeeNumber === "2699", r.body);
    r = await adminE.req("POST", "/api/workers", { companyId: co.E, firstName: "ZZ", lastName: `E2 ${sfx}`, workerType: "employee", payRate: "15" });
    check("company E exhausted after 2699 → 409 with an actionable message (format never changes, no reuse)", r.status === 409 && /2601–2699|26 ?01.*26 ?99|in use/.test(r.body?.message ?? ""), r);
    const numbersAfter = (await pool.query(`SELECT id, employee_number FROM workers WHERE id = ANY($1) ORDER BY id`, [numbersBefore.map((x: any) => x.id)])).rows;
    check("every pre-existing employee number unchanged", JSON.stringify(numbersAfter) === JSON.stringify(numbersBefore));
    // Year rollover via the allocator itself (same code path as the routes).
    process.env.DATABASE_URL = url;
    const signin = await import("../server/employee-signin");
    const { db } = await import("../server/db");
    const n2027 = await db.transaction((tx) => signin.allocateEmployeeNumber(tx as any, co.A, new Date("2027-01-04T12:00:00Z")));
    check("year rollover: first 2027 number for A is 2701", n2027 === "2701", n2027);
    const n2027b = await db.transaction((tx) => signin.allocateEmployeeNumber(tx as any, co.A, new Date("2027-02-01T12:00:00Z")));
    check("…and the 2027 counter advances (2702)", n2027b === "2702", n2027b);
    check("2026 counter for A unaffected by 2027 allocations", (await pool.query(`SELECT last_value FROM employee_number_counters WHERE company_id=$1 AND year_prefix='26'`, [co.A])).rows[0].last_value === 32);

    console.log("\n— PIN storage —");
    r = await adminA.req("PATCH", `/api/workers/${W.A2602}`, { pin: "4321" });
    const w2602 = (await pool.query(`SELECT pin, pin_hash FROM workers WHERE id=$1`, [W.A2602])).rows[0];
    check("admin sets a PIN → only a bcrypt hash is stored (plaintext NULL)", r.status === 200 && w2602.pin === null && await bcrypt.compare("4321", w2602.pin_hash), w2602.pin);
    check("…and the response carries no PIN material", !r.text.includes("4321") && !r.text.includes("$2") && r.body?.hasPin === true);
    r = await adminA.req("PATCH", `/api/workers/${W.A2602}`, { firstName: "ZZ", pin: "" });
    check("saving the form with a blank PIN keeps the PIN", (await pool.query(`SELECT pin_hash FROM workers WHERE id=$1`, [W.A2602])).rows[0].pin_hash === w2602.pin_hash);
    r = await adminA.req("PATCH", `/api/workers/${W.A2602}`, { pinHash: "$2b$10$attackerattackerattackerattackerattackerattackerattac" });
    check("client-supplied pinHash is discarded", (await pool.query(`SELECT pin_hash FROM workers WHERE id=$1`, [W.A2602])).rows[0].pin_hash === w2602.pin_hash);
    const lazy = id(); workerIds.push(lazy);
    await pool.query(`INSERT INTO workers (id, company_id, first_name, last_name, worker_type, status, is_active, employee_number, pin) VALUES ($1,$2,'ZZ','Lazy','employee','active',true,'2650','7777')`, [lazy, co.D]);
    r = await new Device(base).req("POST", "/api/auth/pin-login", { companyCode: code.D, employeeNumber: "2650", pin: "7777" });
    if (r.body?.id) userIds.push(r.body.id);
    const lz = (await pool.query(`SELECT pin, pin_hash FROM workers WHERE id=$1`, [lazy])).rows[0];
    check("worker with only a legacy plaintext PIN signs in and is upgraded (hash set, plaintext cleared)", r.status === 200 && lz.pin === null && await bcrypt.compare("7777", lz.pin_hash), { status: r.status });
    const empSelf = new Device(base);
    r = await empSelf.req("POST", "/api/auth/pin-login", { companyCode: codeA3, employeeNumber: "2602", pin: "4321" });
    await empSelf.primeCsrf();
    r = await empSelf.req("POST", "/api/my/change-pin", { currentPin: "0000", newPin: "8888", confirmPin: "8888" });
    check("change-pin with a wrong current PIN → 401", r.status === 401);
    r = await empSelf.req("POST", "/api/my/change-pin", { currentPin: "4321", newPin: "8888", confirmPin: "8888" });
    check("change-pin verifies against the hash and stores only a new hash", r.status === 200 && (await pool.query(`SELECT pin FROM workers WHERE id=$1`, [W.A2602])).rows[0].pin === null && await bcrypt.compare("8888", (await pool.query(`SELECT pin_hash FROM workers WHERE id=$1`, [W.A2602])).rows[0].pin_hash), r);
    r = await adminA.req("GET", `/api/workers?companyId=${co.A}`);
    const w2602row = (Array.isArray(r.body) ? r.body : r.body?.workers ?? []).find((w: any) => w.id === W.A2602);
    check("worker list after a PIN change carries no PIN material (hasPin only)", r.status === 200 && !r.text.includes("pin_hash") && !r.text.includes('"pin"') && !r.text.includes("8888") && w2602row?.hasPin === true, { status: r.status, hasPin: w2602row?.hasPin });

    // ════════ Phase C — per-IP rate limit ════════
    console.log("\n— phase C: per-IP rate limit —");
    await server.stop(); server = undefined;
    process.env.PIN_SIGNIN_RATE_LIMIT_MAX = "3";
    server = await startTestServer(url);
    const spray = new Device(server.baseUrl);
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await spray.req("POST", "/api/auth/pin-login", { companyCode: codeA3, employeeNumber: String(2690 + i), pin: "1111" })).status);
    check("spraying different numbers from one IP: first 3 → 401, then 429 (rate limited)", statuses.slice(0, 3).every((x) => x === 401) && statuses.slice(3).every((x) => x === 429), statuses);
    delete process.env.PIN_SIGNIN_RATE_LIMIT_MAX;
  } finally {
    if (server) await server.stop();
    // Remove only this run's fixtures.
    const users = (await pool.query(`SELECT id FROM users WHERE worker_id = ANY($1) OR id = ANY($2)`, [workerIds, userIds])).rows.map((x: any) => x.id);
    const allUsers = [...new Set([...userIds, ...users])];
    await pool.query(`DELETE FROM session WHERE sess->>'userId' = ANY($1)`, [allUsers]).catch(() => {});
    await pool.query(`DELETE FROM employee_signin_events WHERE company_id = ANY($1) OR worker_id = ANY($2)`, [companyIds, workerIds]).catch(() => {});
    await pool.query(`DELETE FROM employee_signin_events WHERE company_id IS NULL AND employee_number IN ('2607','2605','2611','2612','2602','2699','2650')`).catch(() => {});
    await pool.query(`DELETE FROM authorization_audit_log WHERE company_id = ANY($1) OR actor_user_id = ANY($2)`, [companyIds, allUsers]).catch(() => {});
    await pool.query(`DELETE FROM time_clock_kiosk_bindings WHERE company_id = ANY($1)`, [companyIds]).catch(() => {});
    await pool.query(`DELETE FROM employee_number_counters WHERE company_id = ANY($1)`, [companyIds]).catch(() => {});
    await pool.query(`DELETE FROM company_signin_codes WHERE company_id = ANY($1)`, [companyIds]).catch(() => {});
    if (allUsers.length) await cascadeDelete(pool, "users", allUsers);
    if (workerIds.length) await cascadeDelete(pool, "workers", workerIds);
    await pool.query(`DELETE FROM tenant_companies WHERE company_id = ANY($1)`, [companyIds]);
    if (companyIds.length) await cascadeDelete(pool, "companies", companyIds);
    if (tenantIds.length) await cascadeDelete(pool, "tenants", tenantIds);
    const residue = [
      ...await verifyZeroResidue(pool, "companies", companyIds), ...await verifyZeroResidue(pool, "users", allUsers),
      ...await verifyZeroResidue(pool, "workers", workerIds), ...await verifyZeroResidue(pool, "tenants", tenantIds),
    ];
    check("zero fixture residue", residue.length === 0, residue);
    await pool.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
