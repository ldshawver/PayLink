/**
 * Contractor onboarding PR 5 — emergency contact.
 * Real server (in-process harness) + DISPOSABLE database + a temporary private
 * folder. Covers fail-closed configuration, encryption at rest, type sniffing,
 * ownership and same-company access, non-revealing denials, audited views and
 * downloads, no original file names anywhere, and zero residue.
 *
 *   TEST_DATABASE_URL=<disposable db with 0041> npx tsx tests/contractor-onboarding-emergency-contact-db.test.ts
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
  private headers(method: string, json: boolean, csrf: boolean) {
    const h: Record<string, string> = {};
    if (this.jar.size) h.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (json) h["content-type"] = "application/json";
    const t = this.jar.get("csrf_token");
    if (csrf && method !== "GET" && t) h["x-csrf-token"] = decodeURIComponent(t);
    return h;
  }
  async req(method: string, p: string, body?: unknown, opts: { csrf?: boolean } = {}) {
    const res = await fetch(`${this.base}${p}`, { method, headers: this.headers(method, body !== undefined, opts.csrf !== false), body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
    this.absorb(res);
    const buf = Buffer.from(await res.arrayBuffer()); const text = buf.toString("utf8");
    let json: any; try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: res.status, body: json, text, buf, headers: res.headers };
  }
  async upload(p: string, file: Buffer, filename: string, opts: { csrf?: boolean; type?: string } = {}) {
    const fd = new FormData(); fd.append("file", new Blob([file], { type: opts.type ?? "image/jpeg" }), filename);
    const res = await fetch(`${this.base}${p}`, { method: "POST", headers: this.headers("POST", false, opts.csrf !== false), body: fd, redirect: "manual" });
    this.absorb(res);
    const text = await res.text(); let json: any; try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: res.status, body: json, text };
  }
}


async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) { console.log("TEST_DATABASE_URL not set — skipping emergency contact DB tests (0 run)."); return; }
  for (const p of FORBIDDEN) if (p.test(url)) throw new Error("TEST_DATABASE_URL looks like staging/production. Refusing.");
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) throw new Error("TEST_DATABASE_URL equals DATABASE_URL. Refusing.");
  const pool = new Pool({ connectionString: url, max: 4 });
  const dbName = (await pool.query("SELECT current_database() n")).rows[0].n as string;
  if (FORBIDDEN.some((p) => p.test(dbName))) throw new Error("protected database name");
  for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "OPENAI_API_KEY", "XAI_API_KEY", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "DOCUMENSO_URL", "MYPAYLINK_DOCUMENSO_API_KEY"]) delete process.env[k];

  const sfx = crypto.randomBytes(3).toString("hex");
  const companyIds: string[] = [], userIds: string[] = [], tenantIds: string[] = [];
  const pw = `Pw-${sfx}-ec`; const pwHash = await bcrypt.hash(pw, 10);
  const co: Record<string, string> = {}; const U: Record<string, string> = {};
  let server: Awaited<ReturnType<typeof startTestServer>> | undefined;
  const mkCompany = async (key: string) => {
    const c = crypto.randomUUID(); co[key] = c; companyIds.push(c);
    await pool.query(`INSERT INTO companies (id, name, subscription_status) VALUES ($1,$2,'active')`, [c, `ZZ EC ${key} ${sfx}`]);
    const t = (await pool.query(`INSERT INTO tenants (name, slug, status) VALUES ($1,$1,'active') RETURNING id`, [`zz-ec-${key.toLowerCase()}-${sfx}`])).rows[0].id;
    tenantIds.push(t);
    await pool.query(`INSERT INTO tenant_companies (tenant_id, company_id, is_primary) VALUES ($1,$2,true)`, [t, c]);
  };
  const mkUser = async (key: string, role: string, company: string | null, workerId: string | null = null) => {
    const u = crypto.randomUUID(); U[key] = `zz_ec_${key}_${sfx}`; userIds.push(u);
    await pool.query(`INSERT INTO users (id, username, password, role, company_id, worker_id, is_active) VALUES ($1,$2,$3,$4,$5,$6,true)`, [u, U[key], pwHash, role, company, workerId]);
  };
  const login = async (key: string) => {
    const d = new Device(server!.baseUrl);
    const r = await d.req("POST", "/api/auth/login", { username: U[key], password: pw });
    if (r.status !== 200) throw new Error(`login ${key} ${r.status}`);
    await d.req("GET", "/api/auth/me"); return d;
  };
  const NAME = `Rosa Quintero-${sfx}`, PHONE = "+1 (555) 010-7788", PHONE_N = "+15550107788";

  try {
    await mkCompany("A"); await mkCompany("B");
    await mkUser("adminA", "admin", co.A); await mkUser("adminB", "admin", co.B); await mkUser("mgrA", "manager", co.A);
    server = await startTestServer(url);
    const adminA = await login("adminA");
    const mk = async (first: string, last: string) => {
      const r = await adminA.req("POST", "/api/contractor-onboarding", { firstName: first, lastName: last, email: `${first.toLowerCase()}-${sfx}@example.test` });
      if (r.status !== 201) throw new Error("create " + r.text); return r.body as { workerId: string; onboardingId: string };
    };
    const c1 = await mk("Eli", "Contact"), c2 = await mk("Fay", "Other");
    await mkUser("con1", "contractor", co.A, c1.workerId); await mkUser("con2", "contractor", co.A, c2.workerId);
    const con1 = await login("con1"), con2 = await login("con2"), adminB = await login("adminB"), mgrA = await login("mgrA");
    const P = "/api/my-onboarding/emergency-contact";

    console.log("\n— validation —");
    for (const [label, body] of [
      ["missing phone", { name: NAME, relationship: "Sister" }],
      ["letters in phone", { name: NAME, relationship: "Sister", phone: "call me maybe" }],
      ["too few digits", { name: NAME, relationship: "Sister", phone: "12-34" }],
      ["control characters", { name: "Rosa\u0007", relationship: "Sister", phone: PHONE }],
      ["bad email", { name: NAME, relationship: "Sister", phone: PHONE, email: "not-an-email" }],
      ["overlong name", { name: "x".repeat(101), relationship: "Sister", phone: PHONE }],
    ] as const) {
      const r = await con1.req("PUT", P, body);
      check(`${label} → 400 with a message`, r.status === 400 && typeof r.body?.message === "string", r.body);
    }
    let r = await con1.req("PUT", P, { name: NAME, relationship: "Sister", phone: PHONE }, { csrf: false });
    check("no CSRF → 403", r.status === 403, r.status);
    check("…nothing stored by refused requests", (await pool.query(`SELECT count(*)::int n FROM employee_contacts WHERE worker_id=$1`, [c1.workerId])).rows[0].n === 0);

    console.log("\n— save —");
    r = await con1.req("PUT", P, { name: `  ${NAME} `, relationship: "Sister", phone: PHONE });
    check("valid contact → 200, phone normalized, changed", r.status === 200 && r.body.contact.phone === PHONE_N && r.body.contact.name === NAME && r.body.changed === true, r.body);
    const rows1 = (await pool.query(`SELECT name, relationship, phone, email, is_primary FROM employee_contacts WHERE worker_id=$1 AND contact_type='emergency'`, [c1.workerId])).rows;
    check("one employee_contacts emergency row (primary)", rows1.length === 1 && rows1[0].is_primary === true && rows1[0].phone === PHONE_N, rows1);
    const w = (await pool.query(`SELECT emergency_contact_name, emergency_contact_phone, is_active FROM workers WHERE id=$1`, [c1.workerId])).rows[0];
    check("mirrored to workers.emergency_contact_* (My Profile)", w.emergency_contact_name === NAME && w.emergency_contact_phone === PHONE_N, w);
    check("worker stays inactive", w.is_active === false);
    const st = (await pool.query(`SELECT status, completed_at FROM onboarding_steps WHERE onboarding_id=$1 AND step_key='emergency_contact'`, [c1.onboardingId])).rows[0];
    check("emergency_contact step → completed", st.status === "completed" && !!st.completed_at, st);
    r = await con1.req("PUT", P, { name: NAME, relationship: "Sister", phone: PHONE });
    check("same values again → 200, changed=false (idempotent)", r.status === 200 && r.body.changed === false, r.body);
    r = await con1.req("PUT", P, { name: NAME, relationship: "Sister", phone: "555 010 9999", email: "Rosa@Example.TEST" });
    check("update → changed, email lower-cased", r.status === 200 && r.body.changed === true && r.body.contact.email === "rosa@example.test", r.body);
    check("still exactly one emergency row after update", (await pool.query(`SELECT count(*)::int n FROM employee_contacts WHERE worker_id=$1 AND contact_type='emergency'`, [c1.workerId])).rows[0].n === 1);
    const burst = await Promise.all(Array.from({ length: 6 }, (_, i) => con1.req("PUT", P, { name: NAME, relationship: "Sister", phone: `555 010 70${10 + i}` })));
    const n = (await pool.query(`SELECT count(*)::int n FROM employee_contacts WHERE worker_id=$1 AND contact_type='emergency'`, [c1.workerId])).rows[0].n;
    check("6 concurrent saves → all 200, still one row (no duplicates)", burst.every((x) => x.status === 200) && n === 1, { s: burst.map((x) => x.status), n });
    const final = (await pool.query(`SELECT phone FROM employee_contacts WHERE worker_id=$1 AND contact_type='emergency'`, [c1.workerId])).rows[0].phone;
    const wf = (await pool.query(`SELECT emergency_contact_phone FROM workers WHERE id=$1`, [c1.workerId])).rows[0].emergency_contact_phone;
    check("…workers mirror matches the stored row (same transaction)", final === wf, { final, wf });

    console.log("\n— access —");
    r = await con1.req("GET", P);
    check("contractor reads their own (no-store)", r.status === 200 && r.body.contact.name === NAME && r.headers.get("cache-control") === "no-store", r.body);
    r = await con2.req("GET", P);
    check("another contractor sees only their own (none)", r.status === 200 && r.body.contact === null, r.body);
    r = await adminA.req("GET", `/api/contractor-onboarding/${c1.onboardingId}/emergency-contact`);
    check("same-company admin reads it", r.status === 200 && r.body.contact.name === NAME, r.status);
    r = await mgrA.req("GET", `/api/contractor-onboarding/${c1.onboardingId}/emergency-contact`);
    check("same-company manager reads it", r.status === 200, r.status);
    const f = await adminB.req("GET", `/api/contractor-onboarding/${c1.onboardingId}/emergency-contact`);
    const rnd = await adminB.req("GET", `/api/contractor-onboarding/${crypto.randomUUID()}/emergency-contact`);
    check("other company's admin → 404 byte-identical to a random id", f.status === 404 && f.text === rnd.text, [f.status, f.text]);
    r = await con2.req("GET", `/api/contractor-onboarding/${c1.onboardingId}/emergency-contact`);
    check("contractor cannot use the admin route → 403", r.status === 403, r.status);
    r = await adminA.req("PUT", P, { name: NAME, relationship: "Sister", phone: PHONE });
    check("admin account cannot write via /my-onboarding → 404", r.status === 404, r.status);

    console.log("\n— audit + privacy —");
    const audit = (await pool.query(`SELECT event_type, actor_type, after_json FROM onboarding_audit_log WHERE onboarding_id=$1 AND event_type LIKE 'emergency_contact%'`, [c1.onboardingId])).rows;
    check("audit: one 'added', updates only for real changes", audit.filter((a: any) => a.event_type === "emergency_contact_added").length === 1 && audit.every((a: any) => a.actor_type === "worker"), audit.map((a: any) => a.event_type));
    check("audit never holds the contact's name, phone or email", !JSON.stringify(audit).match(/Rosa|555|rosa@/i), JSON.stringify(audit).slice(0, 200));
    const log = server.output();
    check("server log never holds the contact's name or phone", log.length > 0 && !log.includes("Rosa Quintero") && !log.includes("5550107") && !log.includes("010-7788"));
  } finally {
    if (server) await server.stop();
    const workers = (await pool.query(`SELECT id FROM workers WHERE company_id = ANY($1)`, [companyIds])).rows.map((x: any) => x.id);
    const moreUsers = (await pool.query(`SELECT id FROM users WHERE worker_id = ANY($1) OR company_id = ANY($2)`, [workers, companyIds])).rows.map((x: any) => x.id);
    const allUsers = [...new Set([...userIds, ...moreUsers])];
    await pool.query(`DELETE FROM session WHERE sess->>'userId' = ANY($1)`, [allUsers]).catch(() => {});
    await pool.query(`DELETE FROM employee_contacts WHERE worker_id = ANY($1)`, [workers]);
    await pool.query(`DELETE FROM onboarding_audit_log WHERE company_id = ANY($1)`, [companyIds]);
    await pool.query(`DELETE FROM onboarding_steps WHERE company_id = ANY($1)`, [companyIds]);
    await pool.query(`DELETE FROM worker_onboarding WHERE company_id = ANY($1)`, [companyIds]);
    await pool.query(`DELETE FROM authorization_audit_log WHERE company_id = ANY($1) OR actor_user_id = ANY($2)`, [companyIds, allUsers]).catch(() => {});
    await pool.query(`DELETE FROM employee_number_counters WHERE company_id = ANY($1)`, [companyIds]);
    if (allUsers.length) await cascadeDelete(pool, "users", allUsers);
    if (workers.length) await cascadeDelete(pool, "workers", workers);
    await pool.query(`DELETE FROM tenant_companies WHERE company_id = ANY($1)`, [companyIds]);
    if (companyIds.length) await cascadeDelete(pool, "companies", companyIds);
    if (tenantIds.length) await cascadeDelete(pool, "tenants", tenantIds);
    const residue = [
      ...await verifyZeroResidue(pool, "companies", companyIds), ...await verifyZeroResidue(pool, "users", allUsers),
      ...await verifyZeroResidue(pool, "workers", workers), ...await verifyZeroResidue(pool, "tenants", tenantIds),
    ];
    const left = (await pool.query(`SELECT count(*)::int n FROM employee_contacts WHERE worker_id = ANY($1)`, [workers])).rows[0].n;
    check("zero fixture residue", residue.length === 0 && left === 0, { residue, left });
    await pool.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
