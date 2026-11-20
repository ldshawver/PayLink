/**
 * Contractor onboarding PR 6 — verified Documenso completion.
 * Real server + DISPOSABLE database + local Documenso STAND-IN + temporary
 * private folder. The webhook is only a trigger; every completion is checked
 * against the stand-in's document (status, template, recipient, signed PDF).
 *
 *   TEST_DATABASE_URL=<disposable db with 0031> npx tsx tests/contractor-onboarding-esign-complete-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcrypt";
import { startTestServer } from "../scripts/cross-tenant-negative-tests/server-harness";
import { cascadeDelete, verifyZeroResidue } from "../scripts/cross-tenant-negative-tests/cascade-cleanup";

const FORBIDDEN = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i, /paylinkapp/i];
let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  ✓  ${name}`); }
  else { failed++; console.error(`  ✗  ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ""}`); }
}
const PDF = (tag: string) => Buffer.from(`%PDF-1.7\n% signed ${tag}\n${crypto.randomBytes(64).toString("hex")}\n%%EOF\n`);

type Doc = { id: string; status: string; templateId: number | null; recipients: any[]; pdf: Buffer | null };
/** Documenso v2 stand-in: /template/use, GET /envelope/:id, GET /envelope/item/:id/download. */
function startStandIn(): Promise<{ url: string; docs: Map<string, Doc>; calls: string[]; close(): Promise<void> }> {
  return new Promise((resolve) => {
    const docs = new Map<string, Doc>(); const calls: string[] = []; let n = 0;
    const server = http.createServer((req, res) => {
      let raw = ""; req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const p = (req.url || "").replace(/^\/api\/v2/, ""); calls.push(`${req.method} ${p}`);
        const send = (s: number, j: unknown, type = "application/json") => { res.writeHead(s, { "content-type": type }); res.end(type === "application/json" ? JSON.stringify(j) : j as Buffer); };
        if (req.method === "POST" && p === "/template/use") {
          const body = JSON.parse(raw || "{}"); const id = `env_${++n}`;
          docs.set(id, { id, status: "PENDING", templateId: body.templateId, recipients: body.recipients.map((r: any, i: number) => ({ id: 900 + i, email: r.email, name: r.name, token: `tok${n}`, signingStatus: "NOT_SIGNED" })), pdf: null });
          const d = docs.get(id)!; return send(200, { id, status: d.status, recipients: d.recipients });
        }
        let m = /^\/envelope\/item\/item_([^/]+)\/download$/.exec(p);
        if (req.method === "GET" && m && docs.has(m[1])) { const d = docs.get(m[1])!; return d.pdf ? send(200, d.pdf, "application/pdf") : send(404, { message: "no file" }); }
        m = /^\/envelope\/([^/]+)$/.exec(p);
        if (req.method === "GET" && m && docs.has(m[1])) {
          const d = docs.get(m[1])!;
          return send(200, { id: d.id, status: d.status, templateId: d.templateId, recipients: d.recipients, envelopeItems: [{ id: `item_${d.id}` }] });
        }
        return send(404, { message: "not found" });
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server.address() as any).port}`, docs, calls, close: () => new Promise((r) => server.close(() => r())) }));
  });
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
  async req(method: string, p: string, body?: unknown, opts: { csrf?: boolean } = {}) {
    const headers: Record<string, string> = {};
    if (this.jar.size) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (body !== undefined) headers["content-type"] = "application/json";
    const csrf = this.jar.get("csrf_token");
    if (opts.csrf !== false && method !== "GET" && csrf) headers["x-csrf-token"] = decodeURIComponent(csrf);
    const res = await fetch(`${this.base}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
    this.absorb(res);
    const text = await res.text();
    let json: any; try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: res.status, body: json, text, headers: res.headers };
  }
}


async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) { console.log("TEST_DATABASE_URL not set — skipping e-sign completion DB tests (0 run)."); return; }
  for (const p of FORBIDDEN) if (p.test(url)) throw new Error("TEST_DATABASE_URL looks like staging/production. Refusing.");
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) throw new Error("TEST_DATABASE_URL equals DATABASE_URL. Refusing.");
  const pool = new Pool({ connectionString: url, max: 4 });
  const dbName = (await pool.query("SELECT current_database() n")).rows[0].n as string;
  if (FORBIDDEN.some((p) => p.test(dbName))) throw new Error("protected database name");
  for (const m of ["0033_contractor_onboarding_esign", "0034_private_personnel_documents", "0035_contractor_onboarding_esign_events"]) {
    const sqlText = fs.readFileSync(path.join(process.cwd(), `migrations/${m}.sql`), "utf8").replace(/^\\set .*$/m, "");
    await pool.query(sqlText); await pool.query(sqlText);
  }
  check("0033/0034/0035 applied twice → one ledger row each", (await pool.query(`SELECT count(*)::int n FROM paylink_migrations.applied WHERE version IN ('0033','0034','0035')`)).rows[0].n === 3);

  const standIn = await startStandIn();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "esc-test-"));
  const SECRET = `whsec-${crypto.randomBytes(8).toString("hex")}`;
  for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "OPENAI_API_KEY", "XAI_API_KEY", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "MYPAYLINK_DOCUMENSO_BASE_URL", "DOCUMENSO_BASE_URL", "DOCUMENSO_API_KEY", "MYPAYLINK_DOCUMENSO_WEBHOOK_SECRET"]) delete process.env[k];
  Object.assign(process.env, {
    DOCUMENSO_URL: standIn.url, MYPAYLINK_DOCUMENSO_API_KEY: "standin-key", DOCUMENSO_WEBHOOK_SECRET: SECRET, CONTRACTOR_ONBOARDING_ESIGN_ENABLED: "true",
    PRIVATE_DOCUMENT_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64"), PRIVATE_DOCUMENT_DIR: dir,
  });

  const sfx = crypto.randomBytes(3).toString("hex");
  const companyIds: string[] = [], userIds: string[] = [], tenantIds: string[] = [];
  const pw = `Pw-${sfx}-esc`; const pwHash = await bcrypt.hash(pw, 10);
  const co: Record<string, string> = {}; const U: Record<string, string> = {};
  let server: Awaited<ReturnType<typeof startTestServer>> | undefined;
  const mkCompany = async (key: string) => {
    const c = crypto.randomUUID(); co[key] = c; companyIds.push(c);
    await pool.query(`INSERT INTO companies (id, name, subscription_status) VALUES ($1,$2,'active')`, [c, `ZZ ESC ${key} ${sfx}`]);
    const t = (await pool.query(`INSERT INTO tenants (name, slug, status) VALUES ($1,$1,'active') RETURNING id`, [`zz-esc-${key.toLowerCase()}-${sfx}`])).rows[0].id;
    tenantIds.push(t);
    await pool.query(`INSERT INTO tenant_companies (tenant_id, company_id, is_primary) VALUES ($1,$2,true)`, [t, c]);
  };
  const mkUser = async (key: string, role: string, company: string | null, workerId: string | null = null) => {
    const u = crypto.randomUUID(); U[key] = `zz_esc_${key}_${sfx}`; userIds.push(u);
    await pool.query(`INSERT INTO users (id, username, password, role, company_id, worker_id, is_active) VALUES ($1,$2,$3,$4,$5,$6,true)`, [u, U[key], pwHash, role, company, workerId]);
  };
  const login = async (key: string) => {
    const d = new Device(server!.baseUrl);
    const r = await d.req("POST", "/api/auth/login", { username: U[key], password: pw });
    if (r.status !== 200) throw new Error(`login ${key} ${r.status}`);
    await d.req("GET", "/api/auth/me"); return d;
  };
  let tick = 0;
  const hook = async (event: string, docId: string, o: { secret?: string | null; createdAt?: string | null; raw?: string } = {}) => {
    const body = o.raw ?? JSON.stringify({ event, payload: { id: docId, recipients: [{ email: "attacker@evil.test", signingStatus: "SIGNED" }] },
      createdAt: o.createdAt === null ? undefined : (o.createdAt ?? new Date(Date.now() - (tick++ % 50) * 1000).toISOString()), webhookEndpoint: "x" });
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (o.secret !== null) headers["x-documenso-secret"] = o.secret ?? SECRET;
    const res = await fetch(`${server!.baseUrl}/api/webhooks/documenso/onboarding`, { method: "POST", headers, body });
    const text = await res.text(); let json: any; try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: res.status, body: json, raw: body };
  };
  const reqRow = (docId: string) => pool.query(`SELECT * FROM documenso_signature_requests WHERE documenso_document_id=$1`, [docId]).then((r) => r.rows[0]);
  const stepStatus = (onb: string, key: string) => pool.query(`SELECT status FROM onboarding_steps WHERE onboarding_id=$1 AND step_key=$2`, [onb, key]).then((r) => r.rows[0].status);
  const complete = (docId: string, patch: Partial<Doc> = {}) => {
    const d = standIn.docs.get(docId)!; Object.assign(d, { status: "COMPLETED", pdf: PDF(docId) }, patch);
    if (!patch.recipients) d.recipients = d.recipients.map((r: any) => ({ ...r, signingStatus: "SIGNED" }));
  };

  try {
    await mkCompany("A"); await mkCompany("B");
    await mkUser("adminA", "admin", co.A); await mkUser("adminB", "admin", co.B);
    server = await startTestServer(url);
    const adminA = await login("adminA"), adminB = await login("adminB");
    const mk = async (first: string) => {
      const r = await adminA.req("POST", "/api/contractor-onboarding", { firstName: first, lastName: "Signer", email: `${first.toLowerCase()}-${sfx}@example.test` });
      const c = r.body as { workerId: string; onboardingId: string };
      await pool.query(`UPDATE onboarding_steps SET status='completed', completed_at=now() WHERE onboarding_id=$1 AND step_key='account_setup'`, [c.onboardingId]);
      return c;
    };
    await adminA.req("PUT", "/api/contractor-onboarding/esign-templates/contractor_agreement", { templateId: "101", enabled: true });
    await adminA.req("PUT", "/api/contractor-onboarding/esign-templates/w9", { templateId: "202", enabled: true });
    const c1 = await mk("Gia"), c2 = await mk("Hal");
    const send = async (c: { onboardingId: string }, kind: string) => {
      const r = await adminA.req("POST", `/api/contractor-onboarding/${c.onboardingId}/esign/${kind}`);
      if (r.status !== 200) throw new Error(`send ${kind} ${r.status} ${r.text}`);
      return [...standIn.docs.keys()].at(-1)!;
    };
    let d1 = await send(c1, "contractor_agreement");
    const meta = (await pool.query(`SELECT metadata_json FROM worker_onboarding_documents WHERE onboarding_id=$1`, [c1.onboardingId])).rows[0].metadata_json;
    check("send records the template id used (for later verification)", JSON.parse(meta).templateId === "101", meta);

    console.log("\n— webhook authentication + freshness —");
    let r = await hook("DOCUMENT_COMPLETED", d1, { secret: null });
    check("no secret → 401", r.status === 401, r.status);
    r = await hook("DOCUMENT_COMPLETED", d1, { secret: "wrong" });
    check("wrong secret → 401", r.status === 401, r.status);
    r = await hook("DOCUMENT_COMPLETED", d1, { createdAt: new Date(Date.now() - 20 * 60 * 1000).toISOString() });
    check("event older than 15 min → 400 (expired)", r.status === 400, r.body);
    r = await hook("DOCUMENT_COMPLETED", d1, { createdAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
    check("event from the future → 400", r.status === 400, r.body);
    r = await hook("DOCUMENT_COMPLETED", d1, { createdAt: null });
    check("no createdAt → 400", r.status === 400, r.body);
    r = await hook("", "", { raw: "{not json" });
    check("malformed body → 400", r.status === 400, r.status);
    check("…no refused event was recorded", (await pool.query(`SELECT count(*)::int n FROM contractor_onboarding_esign_events`)).rows[0].n === 0);

    console.log("\n— forged / premature completion —");
    r = await hook("DOCUMENT_COMPLETED", d1);
    check("valid-looking 'completed' while Documenso says PENDING → not_completed", r.status === 200 && r.body.outcome === "not_completed", r.body);
    check("…step stays in progress, request back to sent", (await stepStatus(c1.onboardingId, "contractor_agreement")) === "in_progress" && (await reqRow(d1)).status === "sent_for_signature");
    const replay = await fetch(`${server.baseUrl}/api/webhooks/documenso/onboarding`, { method: "POST", headers: { "content-type": "application/json", "x-documenso-secret": SECRET }, body: r.raw }).then((x) => x.json());
    check("exact replay of a processed body → duplicate, no work", replay.duplicate === true, replay);

    console.log("\n— verification failures —");
    complete(d1, { templateId: 999 });
    r = await hook("DOCUMENT_COMPLETED", d1);
    check("completed from a DIFFERENT template → verification_failed", r.body?.outcome === "verification_failed", r.body);
    check("…request marked error, step not completed, no signed file", (await reqRow(d1)).status === "error" && (await stepStatus(c1.onboardingId, "contractor_agreement")) !== "completed"
      && (await pool.query(`SELECT count(*)::int n FROM private_personnel_documents WHERE worker_id=$1`, [c1.workerId])).rows[0].n === 0);
    d1 = await send(c1, "contractor_agreement");
    complete(d1, { recipients: [{ id: 1, email: "someone-else@example.test", signingStatus: "SIGNED" }] });
    r = await hook("DOCUMENT_COMPLETED", d1);
    check("signed by someone other than the contractor → verification_failed", r.body?.outcome === "verification_failed", r.body);
    d1 = await send(c1, "contractor_agreement");
    complete(d1, { pdf: Buffer.from("<html>not a pdf</html>") });
    r = await hook("DOCUMENT_COMPLETED", d1);
    check("signed PDF missing / not a PDF → pdf_unavailable, left open for retry", r.body?.outcome === "pdf_unavailable" && (await reqRow(d1)).status === "sent_for_signature", r.body);
    const fa = (await pool.query(`SELECT after_json FROM onboarding_audit_log WHERE onboarding_id=$1 AND event_type='esign_verification_failed'`, [c1.onboardingId])).rows.map((x: any) => JSON.parse(x.after_json).reason);
    check("failures audited with reason codes only", fa.includes("template_mismatch") && fa.includes("recipient_mismatch"), fa);

    console.log("\n— verified completion —");
    standIn.docs.get(d1)!.pdf = PDF(d1);
    r = await adminB.req("POST", `/api/contractor-onboarding/${c1.onboardingId}/esign/contractor_agreement/refresh`);
    check("other company's admin cannot trigger completion → 404", r.status === 404, r.status);
    r = await adminA.req("POST", `/api/contractor-onboarding/${c1.onboardingId}/esign/contractor_agreement/refresh`);
    check("admin 'check status' → completed", r.status === 200 && r.body.outcome === "completed", r.body);
    const rq = await reqRow(d1);
    check("request completed with the private document id; step completed", rq.status === "completed" && !!rq.completed_pdf_file_id && (await stepStatus(c1.onboardingId, "contractor_agreement")) === "completed", rq.status);
    const pd = (await pool.query(`SELECT id, document_kind, status FROM private_personnel_documents WHERE worker_id=$1`, [c1.workerId])).rows;
    check("exactly one signed agreement in private storage", pd.length === 1 && pd[0].document_kind === "signed_contractor_agreement" && pd[0].id === rq.completed_pdf_file_id, pd);
    r = await adminA.req("GET", `/api/private-documents/${pd[0].id}`);
    check("stored file is the signed PDF from Documenso (decrypts, exact bytes)", r.status === 200 && r.text.startsWith("%PDF-") && r.text.includes(`signed ${d1}`), r.status);
    check("…and nothing readable on disk", !fs.readFileSync(path.join(dir, `${pd[0].id}.bin`)).includes(Buffer.from(`signed ${d1}`)));
    r = await hook("DOCUMENT_COMPLETED", d1);
    check("later webhook for a completed document → already_completed", r.body?.outcome === "already_completed", r.body);
    r = await adminA.req("POST", `/api/contractor-onboarding/${c1.onboardingId}/esign/contractor_agreement/refresh`);
    check("repeated completion call → 200 already_completed and still one file", r.status === 200 && r.body?.outcome === "already_completed" && (await pool.query(`SELECT count(*)::int n FROM private_personnel_documents WHERE worker_id=$1`, [c1.workerId])).rows[0].n === 1, r.status);

    console.log("\n— concurrent completion (W-9) —");
    const d2 = await send(c1, "w9"); complete(d2);
    const results = await Promise.all([
      ...Array.from({ length: 5 }, () => hook("DOCUMENT_COMPLETED", d2)),
      ...Array.from({ length: 3 }, () => adminA.req("POST", `/api/contractor-onboarding/${c1.onboardingId}/esign/w9/refresh`)),
    ]);
    const outs = results.map((x: any) => x.body?.outcome ?? x.status);
    check("8 concurrent webhooks/refreshes → exactly one 'completed'", outs.filter((o) => o === "completed").length === 1, outs);
    check("…exactly one signed W-9 stored, step completed", (await pool.query(`SELECT count(*)::int n FROM private_personnel_documents WHERE worker_id=$1 AND document_kind='signed_w9'`, [c1.workerId])).rows[0].n === 1 && (await stepStatus(c1.onboardingId, "w9")) === "completed");
    check("…one esign_completed audit for the W-9", (await pool.query(`SELECT count(*)::int n FROM onboarding_audit_log WHERE onboarding_id=$1 AND event_type='esign_completed' AND after_json LIKE '%"w9"%'`, [c1.onboardingId])).rows[0].n === 1);

    console.log("\n— rejection + unknown documents —");
    const d3 = await send(c2, "contractor_agreement"); standIn.docs.get(d3)!.status = "REJECTED";
    r = await hook("DOCUMENT_REJECTED", d3);
    check("rejected in Documenso → declined; step reopened", r.body?.outcome === "declined" && (await reqRow(d3)).status === "declined" && (await stepStatus(c2.onboardingId, "contractor_agreement")) === "not_started", r.body);
    r = await adminA.req("POST", `/api/contractor-onboarding/${c2.onboardingId}/esign/contractor_agreement`);
    check("…and can be sent again", r.status === 200 && r.body.outcome === "sent", r.body);
    r = await hook("DOCUMENT_COMPLETED", "env_does_not_exist");
    check("unknown document → 200 ignored", r.status === 200 && r.body.ignored === true, r.body);
    r = await hook("DOCUMENT_OPENED", d3);
    check("unhandled event type → 200 ignored", r.status === 200 && r.body.ignored === true, r.body);

    console.log("\n— privacy —");
    const ev = (await pool.query(`SELECT * FROM contractor_onboarding_esign_events`)).rows;
    check("event log stores hashes and outcomes only (no payload, no emails)", ev.length > 0 && !JSON.stringify(ev).includes("@") && Object.keys(ev[0]).every((k) => ["id", "body_sha256", "event_type", "documenso_document_id", "outcome", "received_at", "processed_at"].includes(k)), Object.keys(ev[0] || {}));
    const audit = JSON.stringify((await pool.query(`SELECT after_json FROM onboarding_audit_log WHERE company_id=$1 AND event_type LIKE 'esign%'`, [co.A])).rows);
    check("audit has no emails, names or tokens", !audit.includes("@") && !audit.includes("Gia") && !/tok\d/.test(audit));
    const log = server.output();
    check("server log has no emails, tokens or PDF content", log.length > 0 && !log.includes(`gia-${sfx}`) && !log.includes("attacker@") && !/signed env_/.test(log) && !log.includes(SECRET));
  } finally {
    if (server) await server.stop();
    await standIn.close();
    const workers = (await pool.query(`SELECT id FROM workers WHERE company_id = ANY($1)`, [companyIds])).rows.map((x: any) => x.id);
    const moreUsers = (await pool.query(`SELECT id FROM users WHERE worker_id = ANY($1) OR company_id = ANY($2)`, [workers, companyIds])).rows.map((x: any) => x.id);
    const allUsers = [...new Set([...userIds, ...moreUsers])];
    await pool.query(`DELETE FROM session WHERE sess->>'userId' = ANY($1)`, [allUsers]).catch(() => {});
    await pool.query(`DELETE FROM contractor_onboarding_esign_events`).catch(() => {});
    await pool.query(`DELETE FROM private_document_access_log WHERE company_id = ANY($1)`, [companyIds]).catch(() => {});
    await pool.query(`DELETE FROM private_personnel_documents WHERE company_id = ANY($1)`, [companyIds]).catch(() => {});
    await pool.query(`DELETE FROM worker_onboarding_documents WHERE company_id = ANY($1)`, [companyIds]);
    await pool.query(`DELETE FROM documenso_signature_requests WHERE company_id = ANY($1)`, [companyIds]);
    await pool.query(`DELETE FROM contractor_onboarding_esign_templates WHERE company_id = ANY($1)`, [companyIds]).catch(() => {});
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
    fs.rmSync(dir, { recursive: true, force: true });
    const left = (await pool.query(`SELECT (SELECT count(*) FROM documenso_signature_requests WHERE company_id = ANY($1)) + (SELECT count(*) FROM private_personnel_documents WHERE company_id = ANY($1)) + (SELECT count(*) FROM contractor_onboarding_esign_events) AS n`, [companyIds])).rows[0].n;
    check("zero fixture residue (rows, events, private files)", residue.length === 0 && Number(left) === 0 && !fs.existsSync(dir), { residue, left });
    await pool.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
