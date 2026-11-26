/**
 * Contractor onboarding PR 3 — agreement + W-9 through per-company Documenso
 * templates. Real server (in-process harness) + DISPOSABLE database + a local
 * Documenso STAND-IN (HTTP server on 127.0.0.1). No request can reach a real
 * Documenso, mail server or AI provider: DOCUMENSO_URL points at the stand-in,
 * SMTP/Twilio/AI keys are removed, and every outbound Documenso request is
 * captured and inspected.
 *
 * Phases: (1) 0042 missing → fail closed; (2) 0042 applied but sending switched
 * off (default) → fail closed; (3) Documenso URL missing → fail closed;
 * (4) everything on → mapping, gates, idempotency, isolation, failure + retry,
 * signing link, privacy of logs/audit, zero residue.
 *
 *   TEST_DATABASE_URL=<disposable db with 0041> npx tsx tests/contractor-onboarding-esign-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
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

type Captured = { method: string; path: string; auth: string | undefined; body: any };
/** Documenso v2 stand-in: /template/use and /envelope/:id. mode "fail" → 500; delayMs slows /template/use. */
function startDocumensoStandIn(): Promise<{ url: string; calls: Captured[]; setMode(m: "ok" | "fail"): void; setDelay(ms: number): void; close(): Promise<void> }> {
  return new Promise((resolve) => {
    const calls: Captured[] = []; let mode: "ok" | "fail" = "ok"; let delayMs = 0; let n = 0;
    const docs = new Map<string, any>();
    const server = http.createServer((req, res) => {
      let raw = ""; req.on("data", (c) => (raw += c));
      req.on("end", async () => {
        const p = (req.url || "").replace(/^\/api\/v2/, "");
        let body: any; try { body = raw ? JSON.parse(raw) : undefined; } catch { body = raw; }
        calls.push({ method: req.method!, path: p, auth: req.headers.authorization, body });
        const send = (s: number, j: unknown) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
        if (req.method === "POST" && p === "/template/use") {
          if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
          if (mode === "fail") return send(500, { message: `boom for ${body?.recipients?.[0]?.email}` });
          const id = `env_${++n}`;
          const doc = { id, status: "PENDING", recipients: (body.recipients || []).map((r: any, i: number) => ({ id: 900 + i, email: r.email, name: r.name, token: `tok${n}x${i}` })) };
          docs.set(id, doc); return send(200, doc);
        }
        const m = /^\/envelope\/([^/]+)$/.exec(p);
        if (req.method === "GET" && m && docs.has(m[1])) return send(200, docs.get(m[1]));
        return send(404, { message: "not found" });
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as any).port;
      resolve({ url: `http://127.0.0.1:${port}`, calls, setMode: (m) => { mode = m; }, setDelay: (ms) => { delayMs = ms; }, close: () => new Promise((r) => server.close(() => r())) });
    });
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
  if (!url) { console.log("TEST_DATABASE_URL not set — skipping contractor onboarding e-sign DB tests (0 run)."); return; }
  for (const p of FORBIDDEN) if (p.test(url)) throw new Error("TEST_DATABASE_URL looks like staging/production. Refusing.");
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) throw new Error("TEST_DATABASE_URL equals DATABASE_URL. Refusing.");
  const pool = new Pool({ connectionString: url, max: 4 });
  const dbName = (await pool.query("SELECT current_database() n")).rows[0].n as string;
  if (FORBIDDEN.some((p) => p.test(dbName))) throw new Error("protected database name");
  if (!(await pool.query(`SELECT to_regclass('public.employee_number_counters') IS NOT NULL AS ok`)).rows[0].ok) throw new Error("apply migration 0041 first");
  if ((await pool.query(`SELECT to_regclass('public.contractor_onboarding_esign_templates') IS NOT NULL AS ok`)).rows[0].ok) throw new Error("0042 must NOT be applied yet (this test applies it)");

  const standIn = await startDocumensoStandIn();
  for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "OPENAI_API_KEY", "XAI_API_KEY", "SMTP_HOST", "SMTP_USER", "SMTP_PASS",
                   "MYPAYLINK_DOCUMENSO_BASE_URL", "DOCUMENSO_BASE_URL", "MyPayLink_DOCUMENSO_API_KEY", "DOCUMENSO_API_KEY", "DOCUMENSO_ENABLED", "MYPAYLINK_DOCUMENSO_ENABLED"]) delete process.env[k];
  const API_KEY = `standin-${crypto.randomBytes(6).toString("hex")}`;
  const setEnv = (o: { documenso: boolean; enabled: boolean | null }) => {
    if (o.documenso) Object.assign(process.env, { DOCUMENSO_URL: standIn.url, MYPAYLINK_DOCUMENSO_API_KEY: API_KEY });
    else { delete process.env.DOCUMENSO_URL; delete process.env.MYPAYLINK_DOCUMENSO_API_KEY; }
    if (o.enabled === null) delete process.env.CONTRACTOR_ONBOARDING_ESIGN_ENABLED; else process.env.CONTRACTOR_ONBOARDING_ESIGN_ENABLED = String(o.enabled);
  };

  const sfx = crypto.randomBytes(3).toString("hex");
  const companyIds: string[] = [], userIds: string[] = [], tenantIds: string[] = [];
  const pw = `Pw-${sfx}-esign`; const pwHash = await bcrypt.hash(pw, 10);
  const co: Record<string, string> = {}; const U: Record<string, string> = {}; const UID: Record<string, string> = {};
  let server: Awaited<ReturnType<typeof startTestServer>> | undefined;
  const mkCompany = async (key: string) => {
    const c = crypto.randomUUID(); co[key] = c; companyIds.push(c);
    await pool.query(`INSERT INTO companies (id, name, subscription_status) VALUES ($1,$2,'active')`, [c, `ZZ ESIGN ${key} ${sfx}`]);
    const t = (await pool.query(`INSERT INTO tenants (name, slug, status) VALUES ($1,$1,'active') RETURNING id`, [`zz-esign-${key.toLowerCase()}-${sfx}`])).rows[0].id;
    tenantIds.push(t);
    await pool.query(`INSERT INTO tenant_companies (tenant_id, company_id, is_primary) VALUES ($1,$2,true)`, [t, c]);
  };
  const mkUser = async (key: string, role: string, company: string | null, workerId: string | null = null) => {
    const u = crypto.randomUUID(); U[key] = `zz_es_${key}_${sfx}`; UID[key] = u; userIds.push(u);
    await pool.query(`INSERT INTO users (id, username, password, role, company_id, worker_id, is_active) VALUES ($1,$2,$3,$4,$5,$6,true)`, [u, U[key], pwHash, role, company, workerId]);
  };
  const login = async (key: string) => {
    const d = new Device(server!.baseUrl);
    const r = await d.req("POST", "/api/auth/login", { username: U[key], password: pw });
    if (r.status !== 200) throw new Error(`login ${key} ${r.status} ${r.text.slice(0, 200)}`);
    await d.req("GET", "/api/auth/me"); return d;
  };
  const boot = async (o: { documenso: boolean; enabled: boolean | null }) => {
    if (server) await server.stop();
    setEnv(o); server = await startTestServer(url);
  };
  const completeSetup = (onboardingId: string) => pool.query(`UPDATE onboarding_steps SET status='completed', completed_at=now() WHERE onboarding_id=$1 AND step_key='account_setup'`, [onboardingId]);
  const templateCalls = () => standIn.calls.filter((c) => c.path === "/template/use");
  const logFile = path.join(process.cwd(), ".esign-test-server.log");

  try {
    await mkCompany("A"); await mkCompany("B");
    await mkUser("adminA", "admin", co.A); await mkUser("adminB", "admin", co.B); await mkUser("mgrA", "manager", co.A);

    // ── Phase 1: 0042 not applied ───────────────────────────────────────────
    console.log("\n— phase 1: migration 0042 not applied —");
    await boot({ documenso: true, enabled: true });
    let adminA = await login("adminA");
    let r = await adminA.req("POST", "/api/contractor-onboarding", { firstName: "Ana", lastName: "Signer", email: `ana-${sfx}@example.test` });
    if (r.status !== 201) throw new Error("create failed " + r.text);
    const c1 = r.body as { workerId: string; onboardingId: string; employeeNumber: string };
    await completeSetup(c1.onboardingId);
    r = await adminA.req("POST", `/api/contractor-onboarding/${c1.onboardingId}/esign/contractor_agreement`);
    check("send → 503 esign_not_configured naming migration 0042", r.status === 503 && r.body?.code === "esign_not_configured" && /0042/.test(r.body?.message), r.body);
    r = await adminA.req("PUT", "/api/contractor-onboarding/esign-templates/contractor_agreement", { templateId: "101", enabled: true });
    check("saving a template → 503 (no table yet)", r.status === 503, r.status);
    r = await adminA.req("GET", "/api/contractor-onboarding/esign-templates");
    check("settings report tablesReady=false", r.status === 200 && r.body.server.tablesReady === false && r.body.templates.length === 2, r.body);

    const mig = fs.readFileSync(path.join(process.cwd(), "migrations/0042_contractor_onboarding_esign.sql"), "utf8").replace(/^\\set .*$/m, "");
    await pool.query(mig); await pool.query(mig);
    check("0042 applied twice → ledger row ×1", (await pool.query(`SELECT count(*)::int n FROM paylink_migrations.applied WHERE version='0042'`)).rows[0].n === 1);
    const before0042Bad = await pool.query(`INSERT INTO contractor_onboarding_esign_templates (company_id, document_kind, template_id, enabled) VALUES ($1,'w9','x',true)`, [co.B]).then(() => "inserted", (e) => e.code);
    check("schema refuses enabled-without-approval (CHECK)", before0042Bad === "23514", before0042Bad);
    const badKind = await pool.query(`INSERT INTO contractor_onboarding_esign_templates (company_id, document_kind, template_id) VALUES ($1,'ssn','x')`, [co.B]).then(() => "inserted", (e) => e.code);
    check("schema refuses an unknown document kind", badKind === "23514", badKind);

    // ── Phase 2: default = sending off ───────────────────────────────────────
    console.log("\n— phase 2: sending off by default —");
    await boot({ documenso: true, enabled: null });
    adminA = await login("adminA");
    r = await adminA.req("POST", `/api/contractor-onboarding/${c1.onboardingId}/esign/contractor_agreement`);
    check("flag unset → 503 esign_disabled with an administrator message", r.status === 503 && r.body?.code === "esign_disabled" && /turned off/i.test(r.body?.message), r.body);
    r = await adminA.req("GET", "/api/contractor-onboarding/esign-templates");
    check("settings report sendingEnabled=false, tablesReady=true", r.body?.server?.sendingEnabled === false && r.body?.server?.tablesReady === true, r.body?.server);

    // ── Phase 3: Documenso not configured ────────────────────────────────────
    console.log("\n— phase 3: Documenso not configured —");
    await boot({ documenso: false, enabled: true });
    adminA = await login("adminA");
    r = await adminA.req("POST", `/api/contractor-onboarding/${c1.onboardingId}/esign/contractor_agreement`);
    check("no Documenso URL/key → 503 esign_not_configured", r.status === 503 && r.body?.code === "esign_not_configured" && /Documenso/.test(r.body?.message), r.body);
    check("…and the stand-in received nothing in phases 1-3", templateCalls().length === 0, standIn.calls.length);

    // ── Phase 4: everything on ───────────────────────────────────────────────
    console.log("\n— phase 4: template mapping —");
    await boot({ documenso: true, enabled: true });
    adminA = await login("adminA"); const adminB = await login("adminB"); const mgrA = await login("mgrA");
    r = await adminA.req("POST", `/api/contractor-onboarding/${c1.onboardingId}/esign/contractor_agreement`);
    check("no mapping → 409 template_not_configured, nothing sent", r.status === 409 && r.body?.code === "template_not_configured" && templateCalls().length === 0, r.body);
    r = await mgrA.req("PUT", "/api/contractor-onboarding/esign-templates/contractor_agreement", { templateId: "101", enabled: true });
    check("manager cannot change templates → 403", r.status === 403, r.status);
    r = await adminA.req("PUT", "/api/contractor-onboarding/esign-templates/contractor_agreement", { templateId: "101", enabled: true }, { csrf: false });
    check("no CSRF → 403", r.status === 403, r.status);
    for (const bad of [{ templateId: "1 OR 1=1", enabled: true }, { templateId: "", enabled: true }, { templateId: "101" }, { templateId: "101", templateRecipientId: "../x", enabled: true }]) {
      r = await adminA.req("PUT", "/api/contractor-onboarding/esign-templates/contractor_agreement", bad);
      check(`invalid input ${JSON.stringify(bad)} → 400`, r.status === 400, r.status);
    }
    r = await adminA.req("PUT", "/api/contractor-onboarding/esign-templates/ssn", { templateId: "1", enabled: true });
    check("unknown document kind → 404", r.status === 404, r.status);
    r = await adminA.req("PUT", "/api/contractor-onboarding/esign-templates/contractor_agreement", { templateId: "101", templateRecipientId: "7", enabled: false });
    check("saved but OFF", r.status === 200 && r.body.enabled === false && r.body.approvedAt === null, r.body);
    r = await adminA.req("POST", `/api/contractor-onboarding/${c1.onboardingId}/esign/contractor_agreement`);
    check("mapping OFF → still 409 template_not_configured", r.status === 409 && r.body?.code === "template_not_configured", r.body);
    r = await adminA.req("PUT", "/api/contractor-onboarding/esign-templates/contractor_agreement", { templateId: "101", templateRecipientId: "7", enabled: true });
    check("turned ON records approval", r.status === 200 && r.body.enabled === true && !!r.body.approvedAt, r.body);
    const tplRow = (await pool.query(`SELECT approved_by_user_id FROM contractor_onboarding_esign_templates WHERE company_id=$1 AND document_kind='contractor_agreement'`, [co.A])).rows[0];
    check("…approved by the acting administrator", tplRow?.approved_by_user_id === UID.adminA, tplRow);
    r = await adminB.req("GET", "/api/contractor-onboarding/esign-templates");
    check("company B does not see company A's template", r.status === 200 && r.body.templates.every((t: any) => t.templateId === null), r.body?.templates);
    const tplAudit = (await pool.query(`SELECT count(*)::int n FROM authorization_audit_log WHERE company_id=$1 AND change_type='contractor_onboarding_esign_template_set'`, [co.A])).rows[0].n;
    check("every saved template change is audited (off, then on = 2; refused attempts write nothing)", tplAudit === 2, tplAudit);

    console.log("\n— phase 4: gates + access —");
    r = await adminA.req("POST", "/api/contractor-onboarding", { firstName: "Ben", lastName: "Pending", email: `ben-${sfx}@example.test` });
    const c2 = r.body as { workerId: string; onboardingId: string };
    r = await adminA.req("POST", `/api/contractor-onboarding/${c2.onboardingId}/esign/contractor_agreement`);
    check("account setup not done → 409 step_blocked", r.status === 409 && r.body?.code === "step_blocked", r.body);
    r = await mgrA.req("POST", `/api/contractor-onboarding/${c1.onboardingId}/esign/contractor_agreement`);
    check("manager cannot send → 403", r.status === 403, r.status);
    const foreign = await adminB.req("POST", `/api/contractor-onboarding/${c1.onboardingId}/esign/contractor_agreement`);
    const random = await adminB.req("POST", `/api/contractor-onboarding/${crypto.randomUUID()}/esign/contractor_agreement`);
    check("other company's admin → 404 byte-identical to a random id", foreign.status === 404 && foreign.text === random.text, [foreign.status, foreign.text, random.text]);
    r = await adminA.req("POST", `/api/contractor-onboarding/${c1.onboardingId}/esign/w9`);
    check("W-9 without its own mapping → 409 template_not_configured (agreement mapping is not reused)", r.status === 409 && r.body?.code === "template_not_configured", r.body);
    check("…nothing reached the stand-in", templateCalls().length === 0, templateCalls().length);

    console.log("\n— phase 4: send, concurrent + idempotent —");
    standIn.setDelay(300);
    const burst = await Promise.all(Array.from({ length: 6 }, () => adminA.req("POST", `/api/contractor-onboarding/${c1.onboardingId}/esign/contractor_agreement`)));
    standIn.setDelay(0);
    const outcomes = burst.map((x) => x.body?.outcome ?? x.status);
    check("6 concurrent sends → exactly one 'sent'", outcomes.filter((o) => o === "sent").length === 1, outcomes);
    check("…others 202 in_progress/already_sent", burst.filter((x) => x.body?.outcome !== "sent").every((x) => x.status === 202), outcomes);
    check("…exactly one Documenso document created", templateCalls().length === 1, templateCalls().length);
    const call = templateCalls()[0];
    check("request uses the CONFIGURED template + recipient slot, API key header", call.body.templateId === 101 && call.body.recipients[0].id === 7 && call.auth === API_KEY && call.body.distributeDocument === true, call.body);
    check("request carries only name + email for the signer (no tax/SSN/field values)", JSON.stringify(Object.keys(call.body.recipients[0]).sort()) === JSON.stringify(["email", "id", "name"]) && Object.keys(call.body).sort().join() === "distributeDocument,recipients,templateId", call.body);
    const reqs = (await pool.query(`SELECT * FROM documenso_signature_requests WHERE company_id=$1 AND document_type='contractor_onboarding_agreement'`, [co.A])).rows;
    check("one request row, status sent_for_signature, document id stored", reqs.length === 1 && reqs[0].status === "sent_for_signature" && reqs[0].documenso_document_id === "env_1", reqs.map((x: any) => x.status));
    check("raw Documenso response / signing token / signer email NOT stored", !reqs[0].raw_response && !reqs[0].documenso_signing_url && !reqs[0].signer_email && !JSON.stringify(reqs[0]).includes("tok1x0"), reqs[0]);
    const step = (await pool.query(`SELECT status FROM onboarding_steps WHERE onboarding_id=$1 AND step_key='contractor_agreement'`, [c1.onboardingId])).rows[0];
    check("agreement step → in_progress", step.status === "in_progress", step);
    const wod = (await pool.query(`SELECT document_type, document_status, storage_key, file_url FROM worker_onboarding_documents WHERE onboarding_id=$1`, [c1.onboardingId])).rows;
    check("one onboarding document row (sent, no file stored yet)", wod.length === 1 && wod[0].document_status === "sent" && !wod[0].storage_key && !wod[0].file_url, wod);
    const dupInsert = await pool.query(`INSERT INTO documenso_signature_requests (document_type, related_record_id, company_id, status) VALUES ('contractor_onboarding_agreement', $1, $2, 'creating')`,
      [(await pool.query(`SELECT id FROM onboarding_steps WHERE onboarding_id=$1 AND step_key='contractor_agreement'`, [c1.onboardingId])).rows[0].id, co.A]).then(() => "inserted", (e) => e.code);
    check("database backstop: a second live request for the step is refused (unique index)", dupInsert === "23505", dupInsert);
    r = await adminA.req("POST", `/api/contractor-onboarding/${c1.onboardingId}/esign/contractor_agreement`);
    check("repeat send → 202 already_sent, no new document", r.status === 202 && r.body?.outcome === "already_sent" && templateCalls().length === 1, r.body);
    r = await adminA.req("GET", "/api/contractor-onboarding/esign-state");
    check("admin list state shows the agreement as sent (no ids/URLs)", r.body?.[c1.onboardingId]?.contractor_agreement === "sent_for_signature" && !r.text.includes("env_1") && !r.text.includes("/sign/"), r.body);

    console.log("\n— phase 4: failure + retry —");
    await adminA.req("PUT", "/api/contractor-onboarding/esign-templates/w9", { templateId: "202", enabled: true });
    standIn.setMode("fail");
    r = await adminA.req("POST", `/api/contractor-onboarding/${c1.onboardingId}/esign/w9`);
    check("Documenso 500 → 502 send_failed with a retry message", r.status === 502 && r.body?.code === "send_failed", r.body);
    check("…error does not echo the signer's email", !r.text.includes(`ana-${sfx}`), r.text);
    const w9err = (await pool.query(`SELECT status FROM documenso_signature_requests WHERE company_id=$1 AND document_type='contractor_onboarding_w9'`, [co.A])).rows;
    check("…request marked error (retryable), no document row", w9err.length === 1 && w9err[0].status === "error" && (await pool.query(`SELECT count(*)::int n FROM worker_onboarding_documents WHERE onboarding_id=$1 AND document_type='w9'`, [c1.onboardingId])).rows[0].n === 0, w9err);
    standIn.setMode("ok");
    r = await adminA.req("POST", `/api/contractor-onboarding/${c1.onboardingId}/esign/w9`);
    check("immediate retry succeeds → 200 sent", r.status === 200 && r.body?.outcome === "sent", r.body);
    check("…W-9 used ITS template (202), not the agreement's", templateCalls().at(-1)?.body.templateId === 202 && !("id" in templateCalls().at(-1)!.body.recipients[0]), templateCalls().at(-1)?.body);

    console.log("\n— phase 4: stale claim —");
    const c1w9step = (await pool.query(`SELECT id FROM onboarding_steps WHERE onboarding_id=$1 AND step_key='w9'`, [c1.onboardingId])).rows[0].id;
    r = await adminA.req("POST", "/api/contractor-onboarding", { firstName: "Cy", lastName: "Stale", email: `cy-${sfx}@example.test` });
    const c3 = r.body as { workerId: string; onboardingId: string }; await completeSetup(c3.onboardingId);
    const c3step = (await pool.query(`SELECT id FROM onboarding_steps WHERE onboarding_id=$1 AND step_key='contractor_agreement'`, [c3.onboardingId])).rows[0].id;
    await pool.query(`INSERT INTO documenso_signature_requests (document_type, related_record_id, company_id, status, updated_at) VALUES ('contractor_onboarding_agreement',$1,$2,'creating', now())`, [c3step, co.A]);
    r = await adminA.req("POST", `/api/contractor-onboarding/${c3.onboardingId}/esign/contractor_agreement`);
    check("fresh 'creating' claim → 202 in_progress, nothing sent", r.status === 202 && r.body?.outcome === "in_progress", r.body);
    await pool.query(`UPDATE documenso_signature_requests SET updated_at = now() - interval '5 minutes' WHERE related_record_id=$1`, [c3step]);
    const callsBefore = templateCalls().length;
    r = await adminA.req("POST", `/api/contractor-onboarding/${c3.onboardingId}/esign/contractor_agreement`);
    check("stale claim (crashed process) → retried, 200 sent, one new document", r.status === 200 && templateCalls().length === callsBefore + 1, r.body);
    void c1w9step;

    console.log("\n— phase 4: contractor's own signing —");
    await mkUser("conA", "contractor", co.A, c1.workerId);
    await mkUser("conC", "contractor", co.A, c3.workerId);
    const conA = await login("conA");
    r = await conA.req("GET", "/api/my-onboarding/esign/contractor_agreement/link");
    check("contractor gets their own live signing link (no-store)", r.status === 200 && r.body?.signingUrl === `${standIn.url}/sign/tok1x0` && r.headers.get("cache-control") === "no-store", r.body);
    r = await conA.req("POST", "/api/my-onboarding/esign/contractor_agreement");
    check("contractor start on an already-sent document → 202 already_sent (no request id leaked)", r.status === 202 && r.body?.outcome === "already_sent" && !("requestId" in (r.body || {})), r.body);
    r = await conA.req("POST", `/api/contractor-onboarding/${c3.onboardingId}/esign/w9`);
    check("contractor cannot use the admin route → 403", r.status === 403, r.status);
    r = await conA.req("GET", "/api/contractor-onboarding/esign-templates");
    check("contractor cannot read template settings → 403", r.status === 403, r.status);
    const conC = await login("conC");
    r = await conC.req("GET", "/api/my-onboarding/esign/w9/link");
    check("another contractor sees nothing for a document they don't have → 404", r.status === 404, r.status);
    r = await adminA.req("GET", "/api/my-onboarding/esign/contractor_agreement/link");
    check("an admin account is not a contractor → 404 on /my-onboarding", r.status === 404, r.status);

    console.log("\n— privacy —");
    const audit = (await pool.query(`SELECT event_type, actor_type, after_json FROM onboarding_audit_log WHERE company_id=$1 AND event_type LIKE 'esign%'`, [co.A])).rows;
    const auditText = JSON.stringify(audit);
    check("audit has esign_sent and esign_send_failed", ["esign_sent", "esign_send_failed"].every((e) => audit.some((a: any) => a.event_type === e)), audit.map((a: any) => a.event_type));
    check("audit never holds names, emails, tokens or URLs", ![`ana-${sfx}`, "Ana", "Signer", "tok1x0", "/sign/", standIn.url].some((s) => auditText.includes(s)), auditText.slice(0, 300));
    const srvLog = server!.output();
    check("server log never holds the signer's email, token or signing URL", !!srvLog && ![`ana-${sfx}`, `cy-${sfx}`, "tok1x0", "/sign/tok"].some((s) => srvLog.includes(s)), srvLog.length);
    check("no request ever left for anything but the stand-in (all captured calls are template/use or envelope)", standIn.calls.every((c) => c.path === "/template/use" || c.path.startsWith("/envelope/")), standIn.calls.map((c) => c.path));
    void logFile;
  } finally {
    if (server) await server.stop();
    await standIn.close();
    const workers = (await pool.query(`SELECT id FROM workers WHERE company_id = ANY($1)`, [companyIds])).rows.map((x: any) => x.id);
    const moreUsers = (await pool.query(`SELECT id FROM users WHERE worker_id = ANY($1) OR company_id = ANY($2)`, [workers, companyIds])).rows.map((x: any) => x.id);
    const allUsers = [...new Set([...userIds, ...moreUsers])];
    await pool.query(`DELETE FROM session WHERE sess->>'userId' = ANY($1)`, [allUsers]).catch(() => {});
    await pool.query(`DELETE FROM worker_onboarding_documents WHERE company_id = ANY($1)`, [companyIds]);
    await pool.query(`DELETE FROM documenso_signature_requests WHERE company_id = ANY($1)`, [companyIds]);
    await pool.query(`DELETE FROM contractor_onboarding_esign_templates WHERE company_id = ANY($1)`, [companyIds]).catch(() => {});
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
    const left = (await pool.query(`SELECT (SELECT count(*) FROM documenso_signature_requests WHERE company_id = ANY($1))
      + (SELECT count(*) FROM worker_onboarding_documents WHERE company_id = ANY($1))
      + (SELECT count(*) FROM worker_onboarding WHERE company_id = ANY($1)) AS n`, [companyIds])).rows[0].n;
    check("zero fixture residue (incl. signature requests, documents, templates)", residue.length === 0 && Number(left) === 0, { residue, left });
    await pool.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
