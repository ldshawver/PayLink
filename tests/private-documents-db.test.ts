/**
 * Contractor onboarding PR 4 — private personnel documents (government ID).
 * Real server (in-process harness) + DISPOSABLE database + a temporary private
 * folder. Covers fail-closed configuration, encryption at rest, type sniffing,
 * ownership and same-company access, non-revealing denials, audited views and
 * downloads, no original file names anywhere, and zero residue.
 *
 *   TEST_DATABASE_URL=<disposable db with 0031, without 0034> npx tsx tests/private-documents-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcrypt";
import { startTestServer } from "../scripts/cross-tenant-negative-tests/server-harness";
import { cascadeDelete, verifyZeroResidue } from "../scripts/cross-tenant-negative-tests/cascade-cleanup";
import { detectType, loadKeys, readAndOpen, sealAndWrite, storeStatus } from "../server/private-documents/store";

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

const MARKER = "SECRET-ID-CONTENT-9F3A";
const jpeg = (n = 2048) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(MARKER), crypto.randomBytes(n)]);
const SENSITIVE_NAME = "Ana_Signer_DL_D1234567_SSN_123-45-6789.jpg";

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) { console.log("TEST_DATABASE_URL not set — skipping private documents DB tests (0 run)."); return; }
  for (const p of FORBIDDEN) if (p.test(url)) throw new Error("TEST_DATABASE_URL looks like staging/production. Refusing.");
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) throw new Error("TEST_DATABASE_URL equals DATABASE_URL. Refusing.");
  const pool = new Pool({ connectionString: url, max: 4 });
  const dbName = (await pool.query("SELECT current_database() n")).rows[0].n as string;
  if (FORBIDDEN.some((p) => p.test(dbName))) throw new Error("protected database name");
  if ((await pool.query(`SELECT to_regclass('public.private_personnel_documents') IS NOT NULL AS ok`)).rows[0].ok) throw new Error("0034 must NOT be applied yet (this test applies it)");
  for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "OPENAI_API_KEY", "XAI_API_KEY", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "DOCUMENSO_URL", "MYPAYLINK_DOCUMENSO_API_KEY", "DOCUMENSO_API_KEY",
                   "PRIVATE_DOCUMENT_ENCRYPTION_KEY", "PRIVATE_DOCUMENT_ENCRYPTION_KEYS_PREVIOUS", "PRIVATE_DOCUMENT_DIR"]) delete process.env[k];

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ppd-test-"));
  const KEY = crypto.randomBytes(32).toString("base64");

  // ── Unit: store (no server) ─────────────────────────────────────────────────
  console.log("\n— store unit —");
  const envOk = { PRIVATE_DOCUMENT_ENCRYPTION_KEY: KEY, PRIVATE_DOCUMENT_DIR: dir } as NodeJS.ProcessEnv;
  check("no key → not configured", (storeStatus({ PRIVATE_DOCUMENT_DIR: dir } as any) as any).reason === "no_key");
  check("short key → not configured", (storeStatus({ PRIVATE_DOCUMENT_ENCRYPTION_KEY: crypto.randomBytes(16).toString("base64"), PRIVATE_DOCUMENT_DIR: dir } as any) as any).reason === "no_key");
  check("no folder → not configured", (storeStatus({ PRIVATE_DOCUMENT_ENCRYPTION_KEY: KEY } as any) as any).reason === "no_dir");
  check("relative folder → not configured", (storeStatus({ PRIVATE_DOCUMENT_ENCRYPTION_KEY: KEY, PRIVATE_DOCUMENT_DIR: "private" } as any) as any).reason === "no_dir");
  check("folder inside public uploads → refused", (storeStatus({ PRIVATE_DOCUMENT_ENCRYPTION_KEY: KEY, PRIVATE_DOCUMENT_DIR: path.resolve("uploads/private") } as any) as any).reason === "dir_public");
  check("key + private folder → configured", storeStatus(envOk).ok === true);
  check("type from bytes: jpeg/png/pdf/heic yes; text, html, svg no",
    detectType(jpeg())?.mime === "image/jpeg" && detectType(Buffer.from("%PDF-1.7\n"))?.mime === "application/pdf"
    && detectType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.mime === "image/png"
    && detectType(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(8)]))?.mime === "image/heic"
    && !detectType(Buffer.from("hello")) && !detectType(Buffer.from("<html><script>")) && !detectType(Buffer.from("<svg onload=x>")));
  const b1 = { documentId: crypto.randomUUID(), companyId: "c1", workerId: "w1", kind: "government_id_front" };
  const plain = jpeg(); const sealed = sealAndWrite(plain, b1, envOk);
  const onDisk = fs.readFileSync(path.join(dir, `${b1.documentId}.bin`));
  check("file on disk is ciphertext (no plaintext marker), mode 600", !onDisk.includes(Buffer.from(MARKER)) && (fs.statSync(path.join(dir, `${b1.documentId}.bin`)).mode & 0o777) === 0o600);
  check("decrypts back to the original", readAndOpen(b1, sealed, envOk).equals(plain));
  let threw = ""; try { readAndOpen({ ...b1, companyId: "c2" }, sealed, envOk); } catch (e: any) { threw = e.message; }
  check("bound to its record: different company → refuses to decrypt", !!threw);
  threw = ""; try { readAndOpen(b1, sealed, { PRIVATE_DOCUMENT_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64"), PRIVATE_DOCUMENT_DIR: dir } as any); } catch (e: any) { threw = e.message; }
  check("wrong key → refuses", /not available/.test(threw), threw);
  const NEW = crypto.randomBytes(32).toString("base64");
  check("key rotation: old file opens with old key listed as previous", readAndOpen(b1, sealed, { PRIVATE_DOCUMENT_ENCRYPTION_KEY: NEW, PRIVATE_DOCUMENT_ENCRYPTION_KEYS_PREVIOUS: KEY, PRIVATE_DOCUMENT_DIR: dir } as any).equals(plain));
  check("key id is a hash prefix, not the key", sealed.keyId === loadKeys(envOk).current!.id && !KEY.includes(sealed.keyId) && sealed.keyId.length === 16);
  threw = ""; try { sealAndWrite(plain, b1, envOk); } catch (e: any) { threw = e.message; }
  check("never overwrites an existing file", /overwrite/.test(threw), threw);
  fs.unlinkSync(path.join(dir, `${b1.documentId}.bin`));

  const sfx = crypto.randomBytes(3).toString("hex");
  const companyIds: string[] = [], userIds: string[] = [], tenantIds: string[] = [];
  const pw = `Pw-${sfx}-ppd`; const pwHash = await bcrypt.hash(pw, 10);
  const co: Record<string, string> = {}; const U: Record<string, string> = {};
  let server: Awaited<ReturnType<typeof startTestServer>> | undefined;
  const mkCompany = async (key: string) => {
    const c = crypto.randomUUID(); co[key] = c; companyIds.push(c);
    await pool.query(`INSERT INTO companies (id, name, subscription_status) VALUES ($1,$2,'active')`, [c, `ZZ PPD ${key} ${sfx}`]);
    const t = (await pool.query(`INSERT INTO tenants (name, slug, status) VALUES ($1,$1,'active') RETURNING id`, [`zz-ppd-${key.toLowerCase()}-${sfx}`])).rows[0].id;
    tenantIds.push(t);
    await pool.query(`INSERT INTO tenant_companies (tenant_id, company_id, is_primary) VALUES ($1,$2,true)`, [t, c]);
  };
  const mkUser = async (key: string, role: string, company: string | null, workerId: string | null = null) => {
    const u = crypto.randomUUID(); U[key] = `zz_ppd_${key}_${sfx}`; userIds.push(u);
    await pool.query(`INSERT INTO users (id, username, password, role, company_id, worker_id, is_active) VALUES ($1,$2,$3,$4,$5,$6,true)`, [u, U[key], pwHash, role, company, workerId]);
    return u;
  };
  const login = async (key: string) => {
    const d = new Device(server!.baseUrl);
    const r = await d.req("POST", "/api/auth/login", { username: U[key], password: pw });
    if (r.status !== 200) throw new Error(`login ${key} ${r.status} ${r.text.slice(0, 200)}`);
    await d.req("GET", "/api/auth/me"); return d;
  };

  try {
    await mkCompany("A"); await mkCompany("B");
    await mkUser("adminA", "admin", co.A); await mkUser("adminB", "admin", co.B); await mkUser("mgrA", "manager", co.A);
    await mkUser("plat", "platform_super_admin", null);

    // ── Server 1: 0034 missing, then no key ───────────────────────────────────
    console.log("\n— fail closed —");
    server = await startTestServer(url);
    let adminA = await login("adminA");
    const mk = async (first: string, last: string) => {
      const r = await adminA.req("POST", "/api/contractor-onboarding", { firstName: first, lastName: last, email: `${first.toLowerCase()}-${sfx}@example.test` });
      if (r.status !== 201) throw new Error("create " + r.text); return r.body as { workerId: string; onboardingId: string };
    };
    const c1 = await mk("Ana", "Signer"), c2 = await mk("Bo", "Other");
    await mkUser("con1", "contractor", co.A, c1.workerId); await mkUser("con2", "contractor", co.A, c2.workerId);
    await mkUser("empA", "employee", co.A, c2.workerId);
    let con1 = await login("con1");
    let r = await con1.upload("/api/my-onboarding/government-id/front", jpeg(), SENSITIVE_NAME);
    check("0034 not applied → 503 naming 0034", r.status === 503 && /0034/.test(r.body?.message), r.body);
    const mig = fs.readFileSync(path.join(process.cwd(), "migrations/0034_private_personnel_documents.sql"), "utf8").replace(/^\\set .*$/m, "");
    await pool.query(mig); await pool.query(mig);
    check("0034 applied twice → ledger ×1", (await pool.query(`SELECT count(*)::int n FROM paylink_migrations.applied WHERE version='0034'`)).rows[0].n === 1);
    r = await con1.upload("/api/my-onboarding/government-id/front", jpeg(), SENSITIVE_NAME);
    check("no encryption key on the server → 503 with administrator message", r.status === 503 && /encryption key missing/.test(r.body?.message), r.body);
    check("…nothing written to the folder", fs.readdirSync(dir).length === 0);
    await server.stop();

    // ── Server 2: configured ──────────────────────────────────────────────────
    Object.assign(process.env, { PRIVATE_DOCUMENT_ENCRYPTION_KEY: KEY, PRIVATE_DOCUMENT_DIR: dir });
    server = await startTestServer(url);
    adminA = await login("adminA"); con1 = await login("con1");
    const con2 = await login("con2"), adminB = await login("adminB"), mgrA = await login("mgrA"), empA = await login("empA"), plat = await login("plat");

    console.log("\n— upload —");
    const front = jpeg(4096);
    r = await con1.upload("/api/my-onboarding/government-id/front", front, SENSITIVE_NAME, { csrf: false });
    check("no CSRF → 403", r.status === 403, r.status);
    r = await con1.upload("/api/my-onboarding/government-id/front", front, SENSITIVE_NAME);
    check("contractor uploads ID front → 201", r.status === 201 && r.body?.kind === "government_id_front" && r.body?.mimeType === "image/jpeg", r.body);
    const doc1 = r.body.id as string;
    check("response carries no file name", !r.text.includes("Ana_Signer") && !("filename" in r.body) && !("originalName" in r.body));
    const row1 = (await pool.query(`SELECT * FROM private_personnel_documents WHERE id=$1`, [doc1])).rows[0];
    check("DB row holds no file name, no plaintext, company + worker bound", !JSON.stringify(row1).includes("Ana_Signer") && !JSON.stringify(row1).includes(MARKER) && row1.company_id === co.A && row1.worker_id === c1.workerId);
    const disk1 = fs.readFileSync(path.join(dir, `${doc1}.bin`));
    check("file on disk is named by random id and encrypted", fs.readdirSync(dir).every((f) => /^[0-9a-f-]{36}\.bin$/.test(f)) && !disk1.includes(Buffer.from(MARKER)));
    const step = (await pool.query(`SELECT status, submitted_at FROM onboarding_steps WHERE onboarding_id=$1 AND step_key='government_id'`, [c1.onboardingId])).rows[0];
    check("government_id step → submitted (awaiting review)", step.status === "submitted" && !!step.submitted_at, step);
    r = await con1.upload("/api/my-onboarding/government-id/back", Buffer.from("just text pretending to be a jpeg"), "id.jpg");
    check("content sniffed: text named .jpg → 415", r.status === 415, r.body);
    r = await con1.upload("/api/my-onboarding/government-id/back", Buffer.from("<svg onload=alert(1)></svg>"), "id.png", { type: "image/png" });
    check("SVG/HTML refused → 415", r.status === 415, r.status);
    r = await con1.upload("/api/my-onboarding/government-id/back", Buffer.alloc(0), "e.jpg");
    check("empty file → 400", r.status === 400, r.status);
    r = await con1.upload("/api/my-onboarding/government-id/back", Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(10 * 1024 * 1024 + 10)]), "big.jpg");
    check("over 10 MB → 413", r.status === 413, r.status);
    for (const side of ["w9", "signed_w9", "..%2F..%2Fetc", "front%00"]) {
      r = await con1.upload(`/api/my-onboarding/government-id/${side}`, jpeg(), "x.jpg");
      check(`not an uploadable kind (${side}) → 404`, r.status === 404, r.status);
    }
    r = await adminA.upload("/api/my-onboarding/government-id/front", jpeg(), "x.jpg");
    check("an admin account cannot use the contractor upload route → 404", r.status === 404, r.status);
    const front2 = jpeg(1024);
    r = await con1.upload("/api/my-onboarding/government-id/front", front2, "second.jpg");
    const doc2 = r.body?.id as string;
    const rows = (await pool.query(`SELECT id, status FROM private_personnel_documents WHERE worker_id=$1 AND document_kind='government_id_front' ORDER BY created_at`, [c1.workerId])).rows;
    check("replace keeps the old file as superseded, one active", r.status === 201 && rows.length === 2 && rows[0].status === "superseded" && rows[1].status === "active" && fs.existsSync(path.join(dir, `${doc1}.bin`)), rows);
    const dup = await pool.query(`INSERT INTO private_personnel_documents (id, company_id, worker_id, document_kind, mime_type, byte_size, ciphertext_sha256, enc_key_id, enc_iv, enc_tag, uploaded_by_user_id) VALUES ($1,$2,$3,'government_id_front','image/jpeg',1,'x','x','x','x','x')`,
      [crypto.randomUUID(), co.A, c1.workerId]).then(() => "inserted", (e) => e.code);
    check("database backstop: second ACTIVE file of a kind refused", dup === "23505", dup);
    const burst = await Promise.all(Array.from({ length: 5 }, () => con1.upload("/api/my-onboarding/government-id/back", jpeg(512), "b.jpg")));
    const backs = (await pool.query(`SELECT status FROM private_personnel_documents WHERE worker_id=$1 AND document_kind='government_id_back'`, [c1.workerId])).rows;
    check("5 concurrent back uploads → all 201, exactly one active", burst.every((x) => x.status === 201) && backs.filter((x: any) => x.status === "active").length === 1 && backs.length === 5, { s: burst.map((x) => x.status), backs });

    console.log("\n— access —");
    const get = (d: Device, id: string, dl = false) => d.req("GET", `/api/private-documents/${id}${dl ? "?download=1" : ""}`);
    r = await get(con1, doc2);
    check("owner views → 200, exact bytes", r.status === 200 && r.buf.equals(front2), r.status);
    check("…no-store, nosniff, sandbox CSP, inline, generic file name", r.headers.get("cache-control")?.includes("no-store") === true && r.headers.get("x-content-type-options") === "nosniff"
      && /sandbox/.test(r.headers.get("content-security-policy") || "") && r.headers.get("content-disposition") === 'inline; filename="government-id-front.jpg"', Object.fromEntries(r.headers));
    r = await get(adminA, doc2, true);
    check("same-company admin downloads → 200 attachment", r.status === 200 && r.buf.equals(front2) && /^attachment/.test(r.headers.get("content-disposition") || ""), r.status);
    r = await get(mgrA, doc2);
    check("same-company manager views → 200", r.status === 200, r.status);
    r = await get(adminA, doc1);
    check("superseded file still opens for the admin (kept, not overwritten)", r.status === 200 && r.buf.equals(front), r.status);
    const random = await get(adminB, crypto.randomUUID());
    for (const [label, d] of [["other company's admin", adminB], ["another contractor, same company", con2], ["employee, same company", empA], ["platform super admin (no implicit access)", plat]] as const) {
      r = await get(d, doc2);
      check(`${label} → 404 byte-identical to a random id`, r.status === 404 && r.text === random.text, [r.status, r.text]);
    }
    for (const bad of ["..%2F..%2Fetc%2Fpasswd", "%2E%2E%2Fserver%2Findex.ts", "not-a-uuid", `${doc2}.bin`]) {
      r = await get(adminA, bad);
      check(`malformed / traversal id (${bad}) → 404 JSON, no file`, r.status === 404 && r.text === random.text, [r.status, r.text.slice(0, 80)]);
    }
    r = await adminA.req("GET", `/api/contractor-onboarding/${c1.onboardingId}/private-documents`);
    check("admin list: metadata only (kinds, sizes, dates — no names, no paths)", r.status === 200 && r.body.documents.length === 2 && !r.text.includes(dir) && !r.text.includes("Ana") && !r.text.includes(".bin"), r.body);
    const lf = await adminB.req("GET", `/api/contractor-onboarding/${c1.onboardingId}/private-documents`);
    const lr = await adminB.req("GET", `/api/contractor-onboarding/${crypto.randomUUID()}/private-documents`);
    check("other company's admin cannot list → 404 identical to random", lf.status === 404 && lf.text === lr.text, [lf.status, lr.status]);
    r = await con2.req("GET", `/api/contractor-onboarding/${c1.onboardingId}/private-documents`);
    check("contractor cannot use the admin list → 403", r.status === 403, r.status);
    r = await con1.req("GET", "/api/my-onboarding");
    check("contractor's own summary lists their documents + steps", r.status === 200 && r.body.documents.length === 2 && r.body.steps.length === 6 && r.headers.get("cache-control") === "no-store", r.body);

    console.log("\n— tamper —");
    const p2 = path.join(dir, `${doc2}.bin`); const orig2 = fs.readFileSync(p2);
    const t = Buffer.from(orig2); t[t.length - 1] ^= 0xff; fs.writeFileSync(p2, t);
    r = await get(adminA, doc2);
    check("flipped byte on disk → refused (500, generic), not served", r.status === 500 && !r.buf.includes(Buffer.from(MARKER)), r.status);
    fs.copyFileSync(path.join(dir, `${doc1}.bin`), p2);
    r = await get(adminA, doc2);
    check("another record's file swapped in → refused", r.status === 500, r.status);
    fs.writeFileSync(p2, orig2);
    check("restored → opens again", (await get(adminA, doc2)).status === 200);

    console.log("\n— audit + privacy —");
    const log = (await pool.query(`SELECT action, outcome, actor_role FROM private_document_access_log WHERE company_id=$1`, [co.A])).rows;
    check("every upload is logged (1 + 1 + 5 = 7 allowed uploads)", log.filter((x: any) => x.action === "upload" && x.outcome === "allowed").length === 7, log.filter((x: any) => x.action === "upload").length);
    check("views/downloads logged allowed", log.some((x: any) => x.action === "view" && x.outcome === "allowed" && x.actor_role === "contractor") && log.some((x: any) => x.action === "download" && x.outcome === "allowed" && x.actor_role === "admin"));
    check("denied attempts logged with the actor's role (contractor, employee, platform)", ["contractor", "employee", "platform_super_admin"].every((role) => log.some((x: any) => x.outcome === "denied" && x.actor_role === role)), log.filter((x: any) => x.outcome === "denied"));
    const logB = (await pool.query(`SELECT count(*)::int n FROM private_document_access_log WHERE actor_user_id IN (SELECT id FROM users WHERE username=$1) AND outcome='denied'`, [U.adminB])).rows[0].n;
    check("other company's attempt is logged as denied", logB >= 1, logB);
    const auditText = JSON.stringify((await pool.query(`SELECT * FROM onboarding_audit_log WHERE company_id=$1 AND event_type='private_document_uploaded'`, [co.A])).rows);
    check("onboarding audit has upload events without names/file names", auditText.includes("government_id_front") && !auditText.includes("Ana") && !auditText.includes(".jpg"));
    const srvLog = server.output();
    check("server log never contains the original file name or file content", srvLog.length > 0 && !srvLog.includes("Ana_Signer") && !srvLog.includes("123-45-6789") && !srvLog.includes(MARKER), srvLog.length);
    check("nothing was written outside the private folder (no file name in uploads/)", !fs.existsSync("uploads") || !fs.readdirSync("uploads", { recursive: true } as any).some((f: any) => String(f).includes("Ana_Signer")));
  } finally {
    if (server) await server.stop();
    const workers = (await pool.query(`SELECT id FROM workers WHERE company_id = ANY($1)`, [companyIds])).rows.map((x: any) => x.id);
    const moreUsers = (await pool.query(`SELECT id FROM users WHERE worker_id = ANY($1) OR company_id = ANY($2)`, [workers, companyIds])).rows.map((x: any) => x.id);
    const allUsers = [...new Set([...userIds, ...moreUsers])];
    await pool.query(`DELETE FROM session WHERE sess->>'userId' = ANY($1)`, [allUsers]).catch(() => {});
    await pool.query(`DELETE FROM private_document_access_log WHERE company_id = ANY($1)`, [companyIds]).catch(() => {});
    await pool.query(`DELETE FROM private_personnel_documents WHERE company_id = ANY($1)`, [companyIds]).catch(() => {});
    await pool.query(`DELETE FROM onboarding_audit_log WHERE company_id = ANY($1)`, [companyIds]);
    await pool.query(`DELETE FROM onboarding_steps WHERE company_id = ANY($1)`, [companyIds]);
    await pool.query(`DELETE FROM worker_onboarding WHERE company_id = ANY($1)`, [companyIds]);
    await pool.query(`DELETE FROM authorization_audit_log WHERE company_id = ANY($1) OR actor_user_id = ANY($2)`, [companyIds, allUsers]).catch(() => {});
    await pool.query(`DELETE FROM employee_number_counters WHERE company_id = ANY($1)`, [companyIds]);
    await pool.query(`DELETE FROM company_signin_codes WHERE company_id = ANY($1)`, [companyIds]).catch(() => {});
    if (allUsers.length) await cascadeDelete(pool, "users", allUsers);
    if (workers.length) await cascadeDelete(pool, "workers", workers);
    await pool.query(`DELETE FROM tenant_companies WHERE company_id = ANY($1)`, [companyIds]);
    if (companyIds.length) await cascadeDelete(pool, "companies", companyIds);
    if (tenantIds.length) await cascadeDelete(pool, "tenants", tenantIds);
    const residue = [
      ...await verifyZeroResidue(pool, "companies", companyIds), ...await verifyZeroResidue(pool, "users", allUsers),
      ...await verifyZeroResidue(pool, "workers", workers), ...await verifyZeroResidue(pool, "tenants", tenantIds),
    ];
    const left = (await pool.query(`SELECT (SELECT count(*) FROM private_personnel_documents WHERE company_id = ANY($1)) + (SELECT count(*) FROM private_document_access_log WHERE company_id = ANY($1)) AS n`, [companyIds]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n;
    fs.rmSync(dir, { recursive: true, force: true });
    check("zero fixture residue (rows + private files)", residue.length === 0 && Number(left) === 0 && !fs.existsSync(dir), { residue, left });
    await pool.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
