/**
 * Contractor onboarding PR 2 — expiring account-setup invitation.
 * Real server (in-process harness) + DISPOSABLE database + an in-test SMTP
 * sink on 127.0.0.1 that captures every message (and can be told to fail).
 * No real email can leave: the server's only SMTP route is the sink.
 *
 * Covers: role/CSRF/tenant gates (non-revealing 404), concurrent sends → one
 * email, cooldown idempotency, resend rotates the token (one live link),
 * send failure → nothing live + retry works, email content (link only, no
 * password/PIN, escaped name), hashed token at rest, concurrent accepts → one
 * account, account_setup step completion in the same transaction, reuse and
 * expiry refused, worker stays inactive, audit without personal data, zero
 * residue.
 *
 * Run: TEST_DATABASE_URL=postgresql://…/disposable npx tsx tests/contractor-onboarding-invite-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import net from "node:net";
import bcrypt from "bcrypt";
import { startTestServer } from "../scripts/cross-tenant-negative-tests/server-harness";
import { cascadeDelete, verifyZeroResidue } from "../scripts/cross-tenant-negative-tests/cascade-cleanup";

const FORBIDDEN = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i, /paylinkapp/i];
let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  ✓  ${name}`); }
  else { failed++; console.error(`  ✗  ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ""}`); }
}

/** Minimal SMTP sink: EHLO/AUTH/MAIL/RCPT/DATA. mode "fail" answers 451 to DATA. */
function startSmtpSink(): Promise<{ port: number; messages: { rcpt: string[]; raw: string }[]; setMode(m: "ok" | "fail"): void; close(): Promise<void> }> {
  const messages: { rcpt: string[]; raw: string }[] = [];
  let mode: "ok" | "fail" = "ok";
  const server = net.createServer((sock) => {
    let buf = "", inData = false, authStep = 0; let cur = { rcpt: [] as string[], raw: "" };
    sock.write("220 sink.local ESMTP\r\n");
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buf.indexOf("\r\n.\r\n"); if (end < 0) return;
          cur.raw = buf.slice(0, end); buf = buf.slice(end + 5); inData = false;
          if (mode === "fail") sock.write("451 4.3.0 try again later\r\n"); else { messages.push(cur); sock.write("250 2.0.0 queued\r\n"); }
          cur = { rcpt: [], raw: "" }; continue;
        }
        const i = buf.indexOf("\r\n"); if (i < 0) return;
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (authStep === 1) { authStep = 2; sock.write("334 UGFzc3dvcmQ6\r\n"); continue; }
        if (authStep === 2) { authStep = 0; sock.write("235 2.7.0 ok\r\n"); continue; }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO") sock.write("250-sink.local\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n");
        else if (cmd === "HELO") sock.write("250 sink.local\r\n");
        else if (cmd === "AUTH") { if (/LOGIN/i.test(line)) { authStep = 1; sock.write("334 VXNlcm5hbWU6\r\n"); } else sock.write("235 2.7.0 ok\r\n"); }
        else if (cmd === "RCPT") { cur.rcpt.push(line); sock.write("250 2.1.5 ok\r\n"); }
        else if (cmd === "DATA") { inData = true; sock.write("354 go\r\n"); }
        else if (cmd === "QUIT") { sock.write("221 bye\r\n"); sock.end(); }
        else sock.write("250 ok\r\n");
      }
    });
    sock.on("error", () => {});
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as net.AddressInfo).port;
    resolve({ port, messages, setMode: (m) => { mode = m; }, close: () => new Promise((r) => server.close(() => r())) });
  }));
}
/** Decode the message body (quoted-printable / base64 parts) to plain text for inspection. */
function decodeMail(raw: string): string {
  let out = raw.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  for (const m of raw.matchAll(/Content-Transfer-Encoding: base64\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)/g)) out += "\n" + Buffer.from(m[1].replace(/\s+/g, ""), "base64").toString("utf8");
  return out;
}
const tokenFrom = (text: string) => /\/accept-invite\?token=([A-Za-z0-9_\-%]+)/.exec(text)?.[1];

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
  if (!url) { console.log("TEST_DATABASE_URL not set — skipping contractor onboarding invite DB tests (0 run)."); return; }
  for (const p of FORBIDDEN) if (p.test(url)) throw new Error("TEST_DATABASE_URL looks like staging/production. Refusing.");
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) throw new Error("TEST_DATABASE_URL equals DATABASE_URL. Refusing.");
  const pool = new Pool({ connectionString: url, max: 4 });
  const dbName = (await pool.query("SELECT current_database() n")).rows[0].n as string;
  if (FORBIDDEN.some((p) => p.test(dbName))) throw new Error("protected database name");
  if (!(await pool.query(`SELECT to_regclass('public.employee_number_counters') IS NOT NULL AS ok`)).rows[0].ok) throw new Error("apply migration 0031 first");
  const smtpRows = (await pool.query(`SELECT count(*)::int n FROM smtp_config WHERE is_configured`)).rows[0].n;
  if (smtpRows > 0) throw new Error("smtp_config has a configured row — refusing (mail must only reach the in-test sink)");

  const sink = await startSmtpSink();
  // The ONLY mail route for the server under test: the local sink.
  Object.assign(process.env, { SMTP_HOST: "127.0.0.1", SMTP_PORT: String(sink.port), SMTP_USER: "sink", SMTP_PASS: "sink", SMTP_FROM: "noreply@sink.local", SMTP_TLS: "false", APP_BASE_URL: "http://onboarding.invalid" });
  for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "DOCUMENSO_API_KEY", "OPENAI_API_KEY", "XAI_API_KEY"]) delete process.env[k];

  const sfx = crypto.randomBytes(3).toString("hex");
  const companyIds: string[] = [], userIds: string[] = [], tenantIds: string[] = [];
  const pw = crypto.randomBytes(10).toString("hex");
  const pwHash = await bcrypt.hash(pw, 10);
  const co: Record<string, string> = {}; const U: Record<string, string> = {};
  let server: Awaited<ReturnType<typeof startTestServer>> | undefined;
  const mkCompany = async (key: string) => {
    const c = crypto.randomUUID(); co[key] = c; companyIds.push(c);
    await pool.query(`INSERT INTO companies (id, name, subscription_status) VALUES ($1,$2,'active')`, [c, `ZZ INV ${key} ${sfx}`]);
    const t = (await pool.query(`INSERT INTO tenants (name, slug, status) VALUES ($1,$1,'active') RETURNING id`, [`zz-inv-${key.toLowerCase()}-${sfx}`])).rows[0].id;
    tenantIds.push(t);
    await pool.query(`INSERT INTO tenant_companies (tenant_id, company_id, is_primary) VALUES ($1,$2,true)`, [t, c]);
  };
  const mkUser = async (key: string, role: string, company: string | null) => {
    const u = crypto.randomUUID(); U[key] = `zz_inv_${key}_${sfx}`; userIds.push(u);
    await pool.query(`INSERT INTO users (id, username, password, role, company_id, is_active) VALUES ($1,$2,$3,$4,$5,true)`, [u, U[key], pwHash, role, company]);
  };
  const login = async (key: string) => {
    const d = new Device(server!.baseUrl);
    const r = await d.req("POST", "/api/auth/login", { username: U[key], password: pw });
    if (r.status !== 200) throw new Error(`login ${key} ${r.status}`);
    await d.req("GET", "/api/auth/me"); return d;
  };
  const pendingInvites = async (workerId: string) => (await pool.query(`SELECT * FROM account_invites WHERE relationship_id=$1 AND status='pending'`, [workerId])).rows;
  const backdateSend = (workerId: string) => pool.query(`UPDATE account_invites SET last_sent_at = now() - interval '5 minutes' WHERE relationship_id=$1 AND status='pending'`, [workerId]);

  try {
    await mkCompany("A"); await mkCompany("B");
    await mkUser("adminA", "admin", co.A); await mkUser("adminB", "admin", co.B); await mkUser("mgrA", "manager", co.A);
    server = await startTestServer(url);
    const adminA = await login("adminA"), adminB = await login("adminB"), mgrA = await login("mgrA");
    const email1 = `ann-${sfx}@example.test`;
    let r = await adminA.req("POST", "/api/contractor-onboarding", { firstName: "Ann<img src=x onerror=alert(1)>", lastName: "Lee", email: email1 });
    if (r.status !== 201) throw new Error("create failed " + r.text);
    const c1 = r.body as { workerId: string; onboardingId: string; employeeNumber: string };
    const path1 = `/api/contractor-onboarding/${c1.onboardingId}/invite`;

    console.log("\n— access —");
    r = await mgrA.req("POST", path1); check("manager cannot send → 403", r.status === 403, r.status);
    r = await adminA.req("POST", path1, undefined, { csrf: false }); check("no CSRF → 403", r.status === 403, r.status);
    const foreign = await adminB.req("POST", path1);
    const random = await adminB.req("POST", `/api/contractor-onboarding/${crypto.randomUUID()}/invite`);
    check("another company's admin → 404, byte-identical to a random id (non-revealing)", foreign.status === 404 && random.status === 404 && foreign.text === random.text, [foreign.status, foreign.text, random.text]);
    check("…and nothing was sent", sink.messages.length === 0);

    console.log("\n— send: concurrent + idempotent —");
    const burst = await Promise.all(Array.from({ length: 6 }, () => adminA.req("POST", path1)));
    const outcomes = burst.map((x) => x.body?.outcome ?? x.status);
    check("6 concurrent sends → exactly one 'sent'", outcomes.filter((o) => o === "sent").length === 1, outcomes);
    check("…the rest are 202 in_progress/already_sent", burst.filter((x) => x.body?.outcome !== "sent").every((x) => x.status === 202 && ["in_progress", "already_sent"].includes(x.body?.outcome)), outcomes);
    check("…exactly one email captured", sink.messages.length === 1, sink.messages.length);
    const m1 = sink.messages[0], t1 = decodeMail(m1.raw);
    const tok1 = decodeURIComponent(tokenFrom(t1) ?? "");
    check("email goes only to the contractor", m1.rcpt.length === 1 && m1.rcpt[0].toLowerCase().includes(email1));
    check("email contains the setup link on APP_BASE_URL", t1.includes("http://onboarding.invalid/accept-invite?token=") && tok1.length >= 32);
    check("email contains no password, PIN or employee number", !/password\s*[:=]|\bpin\b\s*[:=]|temporary password/i.test(t1) && !t1.includes(c1.employeeNumber));
    check("HTML part escapes the admin-entered name (text part is text/plain)", !t1.includes("<p>Hi Ann<img") && t1.includes("<p>Hi Ann&lt;img src=x"));
    const inv1 = await pendingInvites(c1.workerId);
    check("one pending invite; token stored only as sha256", inv1.length === 1 && inv1[0].token_hash === crypto.createHash("sha256").update(tok1).digest("hex") && !JSON.stringify(inv1).includes(tok1));
    const ttlDays = (new Date(inv1[0].expires_at).getTime() - Date.now()) / 86_400_000;
    check("invite expires in ~7 days, role contractor, bound to the worker", ttlDays > 6.9 && ttlDays <= 7.01 && inv1[0].role === "contractor" && inv1[0].company_id === co.A, ttlDays);
    let o = (await pool.query(`SELECT status FROM worker_onboarding WHERE id=$1`, [c1.onboardingId])).rows[0];
    check("onboarding → invited; account_setup → in_progress", o.status === "invited" && (await pool.query(`SELECT status FROM onboarding_steps WHERE onboarding_id=$1 AND step_key='account_setup'`, [c1.onboardingId])).rows[0].status === "in_progress");
    r = await adminA.req("POST", path1);
    check("immediate resend (cooldown) → 202 already_sent, no new email", r.status === 202 && r.body?.outcome === "already_sent" && sink.messages.length === 1, r.body);

    console.log("\n— resend rotates the link —");
    await backdateSend(c1.workerId);
    r = await adminA.req("POST", path1);
    const tok2 = decodeURIComponent(tokenFrom(decodeMail(sink.messages[1]?.raw ?? "")) ?? "");
    check("resend after cooldown → 200 sent, second email", r.status === 200 && r.body?.outcome === "sent" && sink.messages.length === 2 && tok2 && tok2 !== tok1, r.body);
    check("old link is dead, new link valid", (await adminA.req("GET", `/api/account-invites/validate?token=${encodeURIComponent(tok1)}`)).status === 404
      && (await new Device(server.baseUrl).req("GET", `/api/account-invites/validate?token=${encodeURIComponent(tok2)}`)).status === 200);
    check("still exactly one pending invite", (await pendingInvites(c1.workerId)).length === 1);

    console.log("\n— send failure + retry —");
    await backdateSend(c1.workerId); sink.setMode("fail");
    r = await adminA.req("POST", path1);
    check("SMTP 451 → 502 send_failed with a retry message", r.status === 502 && r.body?.code === "send_failed", r);
    check("…nothing captured, no live invite (no undelivered token stays valid)", sink.messages.length === 2 && (await pendingInvites(c1.workerId)).length === 0);
    o = (await pool.query(`SELECT status FROM worker_onboarding WHERE id=$1`, [c1.onboardingId])).rows[0];
    check("…onboarding marked invite_failed", o.status === "invite_failed", o.status);
    sink.setMode("ok");
    r = await adminA.req("POST", path1);
    const tok3 = decodeURIComponent(tokenFrom(decodeMail(sink.messages[2]?.raw ?? "")) ?? "");
    check("immediate retry after failure → 200 sent (no cooldown after a failure)", r.status === 200 && sink.messages.length === 3 && !!tok3, r.body);
    check("…exactly one pending invite again", (await pendingInvites(c1.workerId)).length === 1);

    console.log("\n— accept —");
    const accepts = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      new Device(server!.baseUrl).req("POST", "/api/account-invites/accept", { token: tok3, username: `zz_inv_c1_${i}_${sfx}`, password: `Setup-${sfx}-pw` })));
    const accStatuses = accepts.map((x) => x.status).sort();
    check("8 concurrent accepts of one token → exactly one 201, others 409/400", accStatuses.filter((s) => s === 201).length === 1 && accStatuses.every((s) => [201, 400, 409].includes(s)), accStatuses);
    const linked = (await pool.query(`SELECT id, role, company_id, worker_id FROM users WHERE worker_id=$1`, [c1.workerId])).rows;
    userIds.push(...linked.map((x: any) => x.id));
    check("…exactly one account, role contractor, company A, linked to the worker", linked.length === 1 && linked[0].role === "contractor" && linked[0].company_id === co.A, linked);
    check("…one identity link", (await pool.query(`SELECT count(*)::int n FROM identity_links WHERE subject_id=$1`, [c1.workerId])).rows[0].n === 1);
    o = (await pool.query(`SELECT status, current_step_key FROM worker_onboarding WHERE id=$1`, [c1.onboardingId])).rows[0];
    const setup = (await pool.query(`SELECT status, completed_at FROM onboarding_steps WHERE onboarding_id=$1 AND step_key='account_setup'`, [c1.onboardingId])).rows[0];
    check("account_setup completed and onboarding in_progress (same transaction)", setup.status === "completed" && !!setup.completed_at && o.status === "in_progress" && o.current_step_key === "contractor_agreement", { o, setup });
    const w1 = (await pool.query(`SELECT status, is_active FROM workers WHERE id=$1`, [c1.workerId])).rows[0];
    check("worker stays inactive (account setup ≠ onboarding verified)", w1.is_active === false && w1.status === "inactive_temporary");
    const winner = accepts.find((x) => x.status === 201)!;
    const contractor = new Device(server.baseUrl); r = await contractor.req("POST", "/api/auth/login", { username: winner.body.username, password: `Setup-${sfx}-pw` });
    check("contractor signs in with the password they chose", r.status === 200, r.status);
    r = await new Device(server.baseUrl).req("POST", "/api/account-invites/accept", { token: tok3, username: `zz_inv_again_${sfx}`, password: `Setup-${sfx}-pw` });
    check("used link cannot be reused", r.status === 400 || r.status === 409, r.status);
    r = await adminA.req("POST", path1);
    check("invite after setup → 409 already_set_up, no email", r.status === 409 && r.body?.code === "already_set_up" && sink.messages.length === 3, r.body);

    console.log("\n— expiry —");
    r = await adminA.req("POST", "/api/contractor-onboarding", { firstName: "Bo", lastName: "Exp", email: `bo-${sfx}@example.test` });
    const c2 = r.body;
    r = await adminA.req("POST", `/api/contractor-onboarding/${c2.onboardingId}/invite`);
    const tokE = decodeURIComponent(tokenFrom(decodeMail(sink.messages[3]?.raw ?? "")) ?? "");
    await pool.query(`UPDATE account_invites SET expires_at = now() - interval '1 second' WHERE relationship_id=$1 AND status='pending'`, [c2.workerId]);
    check("expired link: validate → 404", (await new Device(server.baseUrl).req("GET", `/api/account-invites/validate?token=${encodeURIComponent(tokE)}`)).status === 404);
    r = await new Device(server.baseUrl).req("POST", "/api/account-invites/accept", { token: tokE, username: `zz_inv_exp_${sfx}`, password: `Setup-${sfx}-pw` });
    check("expired link: accept refused, no account", r.status === 400 && (await pool.query(`SELECT count(*)::int n FROM users WHERE worker_id=$1`, [c2.workerId])).rows[0].n === 0, r.status);

    console.log("\n— audit + isolation —");
    const audit = (await pool.query(`SELECT event_type, actor_type, after_json FROM onboarding_audit_log WHERE company_id=$1 ORDER BY created_at`, [co.A])).rows;
    const auditText = JSON.stringify(audit);
    check("audit has sent / failed / completed events", ["setup_invite_sent", "setup_invite_failed", "account_setup_completed"].every((e) => audit.some((a: any) => a.event_type === e)));
    check("account_setup_completed is attributed to the worker", audit.some((a: any) => a.event_type === "account_setup_completed" && a.actor_type === "worker"));
    check("audit never holds an email, name or token", ![email1, "Ann", "Lee", tok1, tok2, tok3, tokE].some((s) => auditText.includes(s)));
    r = await adminB.req("GET", "/api/contractor-onboarding");
    check("company B's list shows none of A's contractors", r.status === 200 && r.body.length === 0, r.body?.length);
    check("SMTP sink saw 4 messages, all to example.test addresses (nothing else could be sent)", sink.messages.length === 4 && sink.messages.every((m) => m.rcpt.every((x) => /@example\.test/i.test(x))));
  } finally {
    if (server) await server.stop();
    await sink.close();
    const workers = (await pool.query(`SELECT id FROM workers WHERE company_id = ANY($1)`, [companyIds])).rows.map((x: any) => x.id);
    const moreUsers = (await pool.query(`SELECT id FROM users WHERE worker_id = ANY($1) OR company_id = ANY($2)`, [workers, companyIds])).rows.map((x: any) => x.id);
    const allUsers = [...new Set([...userIds, ...moreUsers])];
    await pool.query(`DELETE FROM session WHERE sess->>'userId' = ANY($1)`, [allUsers]).catch(() => {});
    await pool.query(`DELETE FROM identity_links WHERE company_id = ANY($1) OR user_id = ANY($2)`, [companyIds, allUsers]);
    await pool.query(`DELETE FROM account_invites WHERE company_id = ANY($1)`, [companyIds]);
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
    const left = (await pool.query(`SELECT (SELECT count(*) FROM account_invites WHERE company_id = ANY($1)) + (SELECT count(*) FROM worker_onboarding WHERE company_id = ANY($1)) + (SELECT count(*) FROM identity_links WHERE company_id = ANY($1)) AS n`, [companyIds])).rows[0].n;
    check("zero fixture residue (incl. invites, onboarding, identity links)", residue.length === 0 && Number(left) === 0, { residue, left });
    await pool.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
