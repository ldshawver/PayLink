/**
 * Contractor onboarding PR 1 — administrator creates a pending contractor.
 * Real Express server (in-process harness) against a DISPOSABLE database.
 *
 * Covers: role + CSRF gates, company derived from the session (body companyId
 * ignored), platform account without a company refused, input validation,
 * duplicate email (case-insensitive, same company → 409, other company →
 * independent), concurrent creation (distinct emails → distinct consecutive
 * numbers; same email → exactly one row), company-scoped listing, fail-closed
 * worker state, audit without personal data, no notification/SMS rows, and
 * zero fixture residue.
 *
 * Run: TEST_DATABASE_URL=postgresql://…/disposable npx tsx tests/contractor-onboarding-create-db.test.ts
 * Needs migration 0041 applied (per-company counters + unique index).
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { startTestServer } from "../scripts/cross-tenant-negative-tests/server-harness";
import { cascadeDelete, verifyZeroResidue } from "../scripts/cross-tenant-negative-tests/cascade-cleanup";

const FORBIDDEN = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i, /paylinkapp/i];
let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  ✓  ${name}`); }
  else { failed++; console.error(`  ✗  ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ""}`); }
}

class Device {
  jar = new Map<string, string>();
  constructor(public base: string) {}
  absorb(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";"); const i = pair.indexOf("=");
      const k = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim();
      if (v === "") this.jar.delete(k); else this.jar.set(k, v);
    }
  }
  async req(method: string, path: string, body?: unknown, opts: { csrf?: boolean } = {}) {
    const headers: Record<string, string> = {};
    if (this.jar.size) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (body !== undefined) headers["content-type"] = "application/json";
    const csrf = this.jar.get("csrf_token");
    if (opts.csrf !== false && method !== "GET" && csrf) headers["x-csrf-token"] = decodeURIComponent(csrf);
    const res = await fetch(`${this.base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
    this.absorb(res);
    const text = await res.text();
    let json: any; try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: res.status, body: json, text };
  }
}

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) { console.log("TEST_DATABASE_URL not set — skipping contractor onboarding create DB tests (0 run)."); return; }
  for (const p of FORBIDDEN) if (p.test(url)) throw new Error("TEST_DATABASE_URL looks like staging/production. Refusing.");
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) throw new Error("TEST_DATABASE_URL equals DATABASE_URL. Refusing.");
  const pool = new Pool({ connectionString: url, max: 4 });
  const dbName = (await pool.query("SELECT current_database() n")).rows[0].n as string;
  if (FORBIDDEN.some((p) => p.test(dbName))) throw new Error("protected database name");
  const has0041 = (await pool.query(`SELECT to_regclass('public.employee_number_counters') IS NOT NULL AS ok`)).rows[0].ok;
  if (!has0041) throw new Error("apply migration 0041 to the disposable database first");

  const sfx = crypto.randomBytes(3).toString("hex");
  const companyIds: string[] = [], userIds: string[] = [], tenantIds: string[] = [];
  const pw = crypto.randomBytes(10).toString("hex");
  const pwHash = await bcrypt.hash(pw, 10);
  const co: Record<string, string> = {};
  const U: Record<string, string> = {};
  let server: Awaited<ReturnType<typeof startTestServer>> | undefined;

  const mkCompany = async (key: string) => {
    const c = crypto.randomUUID(); co[key] = c; companyIds.push(c);
    await pool.query(`INSERT INTO companies (id, name, subscription_status) VALUES ($1,$2,'active')`, [c, `ZZ ONB ${key} ${sfx}`]);
    const t = (await pool.query(`INSERT INTO tenants (name, slug, status) VALUES ($1,$1,'active') RETURNING id`, [`zz-onb-${key.toLowerCase()}-${sfx}`])).rows[0].id;
    tenantIds.push(t);
    await pool.query(`INSERT INTO tenant_companies (tenant_id, company_id, is_primary) VALUES ($1,$2,true)`, [t, c]);
  };
  const mkUser = async (key: string, role: string, company: string | null) => {
    const u = crypto.randomUUID(); U[key] = `zz_onb_${key}_${sfx}`; userIds.push(u);
    await pool.query(`INSERT INTO users (id, username, password, role, company_id, is_active) VALUES ($1,$2,$3,$4,$5,true)`, [u, U[key], pwHash, role, company]);
  };
  const login = async (key: string) => {
    const d = new Device(server!.baseUrl);
    const r = await d.req("POST", "/api/auth/login", { username: U[key], password: pw });
    if (r.status !== 200) throw new Error(`login ${key} ${r.status}`);
    await d.req("GET", "/api/auth/me");
    return d;
  };
  const companyWorkers = async (c: string) => (await pool.query(`SELECT * FROM workers WHERE company_id=$1 ORDER BY employee_number`, [c])).rows;

  try {
    for (const k of ["A", "B"]) await mkCompany(k);
    // Company A already has 2611 in use → next allocation must be 2612.
    await pool.query(`INSERT INTO workers (company_id, first_name, last_name, worker_type, status, is_active, employee_number, email)
                      VALUES ($1,'ZZ','Existing','employee','active',true,'2611',$2)`, [co.A, `existing-${sfx}@example.test`]);
    await mkUser("adminA", "admin", co.A); await mkUser("adminB", "admin", co.B);
    await mkUser("mgrA", "manager", co.A); await mkUser("empA", "employee", co.A);
    await mkUser("platform", "platform_super_admin", null);
    server = await startTestServer(url);
    const adminA = await login("adminA"), adminB = await login("adminB"), mgrA = await login("mgrA"), empA = await login("empA");
    const email = `Pat.Contractor+${sfx}@Example.Test`;

    console.log("\n— access control —");
    let r = await new Device(server.baseUrl).req("POST", "/api/contractor-onboarding", { firstName: "Pat", lastName: "Doe", email });
    check("anonymous → 401", r.status === 401, r.status);
    r = await adminA.req("POST", "/api/contractor-onboarding", { firstName: "Pat", lastName: "Doe", email }, { csrf: false });
    check("admin without CSRF token → 403", r.status === 403, r.status);
    r = await mgrA.req("POST", "/api/contractor-onboarding", { firstName: "Pat", lastName: "Doe", email });
    check("manager cannot create → 403", r.status === 403, r.status);
    r = await empA.req("POST", "/api/contractor-onboarding", { firstName: "Pat", lastName: "Doe", email });
    check("employee cannot create → 403", r.status === 403, r.status);
    const platform = await login("platform");
    r = await platform.req("POST", "/api/contractor-onboarding", { firstName: "Pat", lastName: "Doe", email, companyId: co.A });
    check("platform account without a company → 403 (companyId in body not honoured)", r.status === 403, r);
    check("…and nothing was created", (await companyWorkers(co.A)).length === 1);

    console.log("\n— validation —");
    for (const [name, body] of [
      ["missing last name", { firstName: "Pat", email }],
      ["blank first name", { firstName: "   ", lastName: "Doe", email }],
      ["invalid email", { firstName: "Pat", lastName: "Doe", email: "not-an-email" }],
      ["control characters in a name", { firstName: "Pat\u0007", lastName: "Doe", email }],
      ["over-long name", { firstName: "P".repeat(101), lastName: "Doe", email }],
    ] as const) {
      r = await adminA.req("POST", "/api/contractor-onboarding", body);
      check(`${name} → 400`, r.status === 400, r);
    }
    check("…no worker created by rejected input", (await companyWorkers(co.A)).length === 1);

    console.log("\n— create —");
    r = await adminA.req("POST", "/api/contractor-onboarding", { firstName: "Pat", lastName: "Doe", email, companyId: co.B });
    check("another company's companyId in the body → 403 by the tenant guard; nothing created in A or B", r.status === 403 && (await companyWorkers(co.A)).length === 1 && (await companyWorkers(co.B)).length === 0, r.status);
    r = await adminA.req("POST", "/api/contractor-onboarding", { firstName: "  Pat ", lastName: "Doe", email, employeeNumber: "9999", status: "active", isActive: true, workerType: "employee" });
    check("admin A creates → 201", r.status === 201, r);
    const created = r.body;
    check("next company-scoped number after 2611 → 2612", created?.employeeNumber === "2612", created);
    check("response carries only ids, number and status", created && Object.keys(created).sort().join(",") === "employeeNumber,ok,onboardingId,status,workerId", created && Object.keys(created));
    const w = (await pool.query(`SELECT * FROM workers WHERE id=$1`, [created.workerId])).rows[0];
    check("worker is in the ADMIN's company", w?.company_id === co.A, w?.company_id);
    check("client-supplied employeeNumber / status / isActive / workerType ignored", w?.employee_number === "2612" && w?.status === "inactive_temporary");
    check("fail closed: inactive invoiced contractor until verified", w?.is_active === false && w?.worker_type === "contractor" && w?.contractor_type === "invoice");
    check("names trimmed, email lower-cased", w?.first_name === "Pat" && w?.email === email.toLowerCase());
    const onb = (await pool.query(`SELECT * FROM worker_onboarding WHERE id=$1`, [created.onboardingId])).rows[0];
    check("onboarding row: same company + worker, package contractor_hub_v2, invite_pending", onb?.company_id === co.A && onb?.worker_id === created.workerId && onb?.package_key === "contractor_hub_v2" && onb?.status === "invite_pending");
    const steps = (await pool.query(`SELECT step_key, status, required, company_id FROM onboarding_steps WHERE onboarding_id=$1 ORDER BY sequence`, [created.onboardingId])).rows;
    check("checklist: 6 required steps, all not_started, all company A", steps.map((s: any) => s.step_key).join(",") === "account_setup,contractor_agreement,government_id,emergency_contact,w9,admin_review" && steps.every((s: any) => s.status === "not_started" && s.required && s.company_id === co.A), steps);
    const audit = (await pool.query(`SELECT * FROM onboarding_audit_log WHERE onboarding_id=$1`, [created.onboardingId])).rows;
    const auditText = JSON.stringify(audit);
    check("one audit event 'contractor_created'", audit.length === 1 && audit[0].event_type === "contractor_created");
    check("audit carries no name or email", !/pat|doe|example\.test/i.test(auditText), auditText.slice(0, 200));
    const notif = (await pool.query(`SELECT (SELECT count(*) FROM notifications WHERE company_id=$1)::int + (SELECT count(*) FROM sms_messages WHERE company_id=$1)::int AS n`, [co.A]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n;
    check("nothing emailed, notified or texted (PR 1 sends nothing)", notif === 0, notif);

    console.log("\n— duplicates —");
    r = await adminA.req("POST", "/api/contractor-onboarding", { firstName: "Other", lastName: "Name", email: email.toUpperCase() });
    check("same email (different case) in the same company → 409 duplicate_email", r.status === 409 && r.body?.code === "duplicate_email", r);
    check("…409 points to the existing worker/onboarding", r.body?.workerId === created.workerId && r.body?.onboardingId === created.onboardingId);
    r = await adminA.req("POST", "/api/contractor-onboarding", { firstName: "ZZ", lastName: "Dup", email: `existing-${sfx}@example.test` });
    check("email already used by an existing employee in the company → 409", r.status === 409, r.status);
    r = await adminB.req("POST", "/api/contractor-onboarding", { firstName: "Pat", lastName: "Doe", email });
    check("same email in ANOTHER company → 201 (independent record)", r.status === 201, r);
    check("…company B starts its own series (2601) — same number space reused across companies is allowed", r.body?.employeeNumber === "2601", r.body);
    check("…and the response does not reveal company A's record", r.body?.workerId !== created.workerId && !JSON.stringify(r.body).includes(co.A));

    console.log("\n— concurrency —");
    const conc = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      adminA.req("POST", "/api/contractor-onboarding", { firstName: "ZZ", lastName: `Conc${i}`, email: `conc${i}-${sfx}@example.test` })));
    const nums = conc.map((x) => x.body?.employeeNumber).filter(Boolean).sort();
    check("10 concurrent creates (distinct emails) → all 201", conc.every((x) => x.status === 201), conc.map((x) => x.status));
    check("…10 distinct consecutive numbers 2613–2622", nums.join(",") === Array.from({ length: 10 }, (_, i) => String(2613 + i)).join(","), nums);
    const same = await Promise.all(Array.from({ length: 8 }, () =>
      adminA.req("POST", "/api/contractor-onboarding", { firstName: "ZZ", lastName: "Race", email: `race-${sfx}@example.test` })));
    const sameStatuses = same.map((x) => x.status).sort();
    check("8 concurrent creates with the SAME email → exactly one 201, seven 409", sameStatuses.filter((s) => s === 201).length === 1 && sameStatuses.filter((s) => s === 409).length === 7, sameStatuses);
    check("…exactly one worker and one onboarding row for that email", (await pool.query(`SELECT count(*)::int n FROM workers WHERE company_id=$1 AND email=$2`, [co.A, `race-${sfx}@example.test`])).rows[0].n === 1
      && (await pool.query(`SELECT count(*)::int n FROM worker_onboarding o JOIN workers w ON w.id=o.worker_id WHERE w.company_id=$1 AND w.email=$2`, [co.A, `race-${sfx}@example.test`])).rows[0].n === 1);
    const dupNums = (await pool.query(`SELECT employee_number, count(*) FROM workers WHERE company_id=$1 GROUP BY 1 HAVING count(*)>1`, [co.A])).rows;
    check("no duplicate employee number inside company A", dupNums.length === 0, dupNums);

    console.log("\n— listing is company-scoped —");
    r = await adminA.req("GET", "/api/contractor-onboarding");
    check("admin A lists 12 rows (1 + 10 + 1), all company A", r.status === 200 && r.body.length === 12 && !r.text.includes(co.B), r.body?.length);
    check("…each row carries its 6-step checklist", r.body.every((x: any) => x.steps.length === 6));
    r = await adminB.req("GET", "/api/contractor-onboarding");
    check("admin B lists only B's single row", r.status === 200 && r.body.length === 1 && r.body[0].employeeNumber === "2601", r.body?.length);
    r = await mgrA.req("GET", "/api/contractor-onboarding");
    check("manager A can view A's checklist", r.status === 200 && r.body.length === 12);
    r = await empA.req("GET", "/api/contractor-onboarding");
    check("employee cannot view → 403", r.status === 403, r.status);
    r = await platform.req("GET", "/api/contractor-onboarding");
    check("platform account without a company sees nothing", r.status === 200 && Array.isArray(r.body) && r.body.length === 0, r.body);
  } finally {
    if (server) await server.stop();
    const workers = (await pool.query(`SELECT id FROM workers WHERE company_id = ANY($1)`, [companyIds])).rows.map((x: any) => x.id);
    await pool.query(`DELETE FROM session WHERE sess->>'userId' = ANY($1)`, [userIds]).catch(() => {});
    await pool.query(`DELETE FROM onboarding_audit_log WHERE company_id = ANY($1)`, [companyIds]);
    await pool.query(`DELETE FROM onboarding_steps WHERE company_id = ANY($1)`, [companyIds]);
    await pool.query(`DELETE FROM worker_onboarding WHERE company_id = ANY($1)`, [companyIds]);
    await pool.query(`DELETE FROM authorization_audit_log WHERE company_id = ANY($1) OR actor_user_id = ANY($2)`, [companyIds, userIds]).catch(() => {});
    await pool.query(`DELETE FROM employee_number_counters WHERE company_id = ANY($1)`, [companyIds]);
    if (userIds.length) await cascadeDelete(pool, "users", userIds);
    if (workers.length) await cascadeDelete(pool, "workers", workers);
    await pool.query(`DELETE FROM tenant_companies WHERE company_id = ANY($1)`, [companyIds]);
    if (companyIds.length) await cascadeDelete(pool, "companies", companyIds);
    if (tenantIds.length) await cascadeDelete(pool, "tenants", tenantIds);
    const residue = [
      ...await verifyZeroResidue(pool, "companies", companyIds), ...await verifyZeroResidue(pool, "users", userIds),
      ...await verifyZeroResidue(pool, "workers", workers), ...await verifyZeroResidue(pool, "tenants", tenantIds),
    ];
    const onbLeft = (await pool.query(`SELECT count(*)::int n FROM worker_onboarding WHERE company_id = ANY($1)`, [companyIds])).rows[0].n;
    check("zero fixture residue (incl. onboarding rows)", residue.length === 0 && onbLeft === 0, { residue, onbLeft });
    await pool.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
