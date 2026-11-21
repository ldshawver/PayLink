/**
 * Contractor onboarding — welcome email after verified completion.
 * Real server (in-process harness) + DISPOSABLE database + an in-test SMTP sink
 * on 127.0.0.1 (the captured local mailbox — the ONLY mail route). Proves:
 * one message after verified completion; none for incomplete / changes-
 * requested / revoked-document onboardings; replayed and concurrent approvals
 * queue one logical message; delivery failure is never recorded as sent and
 * retries create no duplicate accounts or messages; expired, revoked, replayed,
 * forged, cross-company and wrong-purpose tokens fail generically; a
 * replacement invalidates the prior token; setup consumes a token once;
 * cross-tenant access stays denied; the email carries no password, PIN, tax,
 * ID or private-document data; no external network or SMTP is used.
 *
 *   TEST_DATABASE_URL=<disposable db> npx tsx tests/contractor-welcome-email-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcrypt";
import { startTestServer } from "../scripts/cross-tenant-negative-tests/server-harness";
import { cascadeDelete, verifyZeroResidue } from "../scripts/cross-tenant-negative-tests/cascade-cleanup";
import { startSmtpSink, decodeMail } from "./__fixtures__/smtp-sink";

const FORBIDDEN = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i, /paylinkapp/i];
let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  ✓  ${name}`); }
  else { failed++; console.error(`  ✗  ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ""}`); }
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
  private headers(method: string, json: boolean) {
    const h: Record<string, string> = {};
    if (this.jar.size) h.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (json) h["content-type"] = "application/json";
    const t = this.jar.get("csrf_token");
    if (method !== "GET" && t) h["x-csrf-token"] = decodeURIComponent(t);
    return h;
  }
  async req(method: string, p: string, body?: unknown) {
    const res = await fetch(`${this.base}${p}`, { method, headers: this.headers(method, body !== undefined), body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
    this.absorb(res);
    const text = await res.text(); let json: any; try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: res.status, body: json, text };
  }
  async upload(p: string, file: Buffer, filename: string, type = "image/jpeg") {
    const fd = new FormData(); fd.append("file", new Blob([file], { type }), filename);
    const res = await fetch(`${this.base}${p}`, { method: "POST", headers: this.headers("POST", false), body: fd, redirect: "manual" });
    this.absorb(res);
    const text = await res.text(); let json: any; try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: res.status, body: json, text };
  }
}
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(1500)]);
const tokenIn = (text: string) => /\/contractor-password-setup\?token=([A-Za-z0-9_\-%]+)/.exec(text)?.[1];

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) { console.log("TEST_DATABASE_URL not set — skipping welcome-email DB tests (0 run)."); return; }
  for (const p of FORBIDDEN) if (p.test(url)) throw new Error("TEST_DATABASE_URL looks like staging/production. Refusing.");
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) throw new Error("TEST_DATABASE_URL equals DATABASE_URL. Refusing.");
  const pool = new Pool({ connectionString: url, max: 4 });
  const dbName = (await pool.query("SELECT current_database() n")).rows[0].n as string;
  if (FORBIDDEN.some((p) => p.test(dbName))) throw new Error("protected database name");
  for (const m of ["0033_contractor_onboarding_esign", "0034_private_personnel_documents", "0035_contractor_onboarding_esign_events", "0036_contractor_welcome_email"]) {
    await pool.query(fs.readFileSync(path.join(process.cwd(), `migrations/${m}.sql`), "utf8").replace(/^\\set .*$/m, ""));
  }
  if ((await pool.query(`SELECT count(*)::int n FROM smtp_config WHERE is_configured`)).rows[0].n > 0) throw new Error("smtp_config has a configured row — refusing (mail must only reach the in-test sink)");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "welcome-test-"));
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), "welcome-jobs-"));
  for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "OPENAI_API_KEY", "XAI_API_KEY", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "DOCUMENSO_URL", "MYPAYLINK_DOCUMENSO_API_KEY", "STRIPE_SECRET_KEY", "CONTRACTOR_WELCOME_EMAIL_ENABLED"]) delete process.env[k];
  const sink = await startSmtpSink();
  const BASE = "http://welcome.invalid";
  // The ONLY mail route for both this process and the server under test: the local sink.
  // CONTRACTOR_WELCOME_EMAIL_ENABLED stays unset, so the server's orchestrator never drains; this test drives delivery.
  Object.assign(process.env, {
    PRIVATE_DOCUMENT_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64"), PRIVATE_DOCUMENT_DIR: dir, PRIVATE_STORAGE_DIR: jobDir,
    SMTP_HOST: "127.0.0.1", SMTP_PORT: String(sink.port), SMTP_USER: "sink", SMTP_PASS: "sink", SMTP_FROM: "noreply@sink.local", SMTP_TLS: "false", APP_BASE_URL: BASE,
  });
  process.env.DATABASE_URL = url; // in-process service calls use the same disposable DB
  const W = await import("../server/contractor-onboarding/welcome");
  const { db } = await import("../server/db");
  if (W.welcomeEmailEnabled()) throw new Error("CONTRACTOR_WELCOME_EMAIL_ENABLED must be unset in tests");

  const sfx = crypto.randomBytes(3).toString("hex");
  const companyIds: string[] = [], userIds: string[] = [], tenantIds: string[] = [];
  const pw = `Pw-${sfx}-welcome`; const pwHash = await bcrypt.hash(pw, 10);
  const co: Record<string, string> = {}; const U: Record<string, string> = {}; const UID: Record<string, string> = {};
  let server: Awaited<ReturnType<typeof startTestServer>> | undefined;
  const mkTenant = async (key: string) => (await pool.query(`INSERT INTO tenants (name, slug, status) VALUES ($1,$1,'active') RETURNING id`, [`zz-welcome-${key.toLowerCase()}-${sfx}`])).rows[0].id as string;
  const mkCompany = async (key: string, tenant: string) => {
    const c = crypto.randomUUID(); co[key] = c; companyIds.push(c);
    await pool.query(`INSERT INTO companies (id, name, subscription_status) VALUES ($1,$2,'active')`, [c, `ZZ WELCOME ${key} ${sfx}`]);
    await pool.query(`INSERT INTO tenant_companies (tenant_id, company_id, is_primary) VALUES ($1,$2,true)`, [tenant, c]);
  };
  const mkUser = async (key: string, role: string, company: string | null, workerId: string | null = null) => {
    const u = crypto.randomUUID(); U[key] = `zz_wel_${key}_${sfx}`; UID[key] = u; userIds.push(u);
    await pool.query(`INSERT INTO users (id, username, password, role, company_id, worker_id, is_active) VALUES ($1,$2,$3,$4,$5,$6,true)`, [u, U[key], pwHash, role, company, workerId]);
  };
  const login = async (key: string, password = pw) => {
    const d = new Device(server!.baseUrl);
    const r = await d.req("POST", "/api/auth/login", { username: U[key], password });
    if (r.status !== 200) return { d, ok: false, status: r.status };
    await d.req("GET", "/api/auth/me"); return { d, ok: true, status: 200 };
  };
  const seedSigned = async (c: { workerId: string; onboardingId: string }, company: string, stepKey: string, docType: string, kind: string) => {
    const step = (await pool.query(`SELECT id FROM onboarding_steps WHERE onboarding_id=$1 AND step_key=$2`, [c.onboardingId, stepKey])).rows[0].id;
    const docId = crypto.randomUUID();
    await pool.query(`INSERT INTO private_personnel_documents (id, company_id, worker_id, onboarding_id, document_kind, mime_type, byte_size, ciphertext_sha256, enc_key_id, enc_iv, enc_tag, uploaded_by_user_id)
                      VALUES ($1,$2,$3,$4,$5,'application/pdf',100,'x','x','x','x','system:documenso')`, [docId, company, c.workerId, c.onboardingId, kind]);
    await pool.query(`INSERT INTO documenso_signature_requests (document_type, related_record_id, company_id, status, documenso_document_id, completed_pdf_file_id, completed_at)
                      VALUES ($1,$2,$3,'completed',$4,$5,now())`, [docType, step, company, `env_${docId.slice(0, 8)}`, docId]);
    await pool.query(`UPDATE onboarding_steps SET status='completed', completed_at=now() WHERE id=$1`, [step]);
    return docId;
  };
  const outboxOf = async (onb: string) => (await pool.query(`SELECT * FROM email_outbox WHERE subject_id=$1`, [onb])).rows;
  const tokensOf = async (worker: string) => (await pool.query(`SELECT * FROM contractor_password_setup_tokens WHERE worker_id=$1 ORDER BY created_at`, [worker])).rows;
  const usersOf = async (worker: string) => (await pool.query(`SELECT id FROM users WHERE worker_id=$1`, [worker])).rows.length;
  const mailsTo = (email: string) => sink.messages.filter((m) => m.rcpt.some((r) => r.toLowerCase().includes(email.toLowerCase())));
  // Real time plus a test-controlled offset, so backoff and staleness can be advanced.
  let skew = 0;
  const now = () => Date.now() + skew;
  const drain = (o: { mailer?: any } = {}) => W.drainWelcomeOutbox({ baseUrl: BASE, now, ...o });

  try {
    const tA = await mkTenant("A"), tB = await mkTenant("B"); tenantIds.push(tA, tB);
    await mkCompany("A", tA); await mkCompany("B", tB);
    await mkUser("adminA", "admin", co.A); await mkUser("adminB", "admin", co.B);
    server = await startTestServer(url);
    const adminA = (await login("adminA")).d, adminB = (await login("adminB")).d;

    // ── contractors through the real PR 1–7 API ──────────────────────────────
    const NOTE = `Checked ID in person ${sfx}`;
    const SSN = "123-45-6789";
    const mk = async (first: string) => {
      const email = `${first.toLowerCase()}-${sfx}@example.test`;
      const r = await adminA.req("POST", "/api/contractor-onboarding", { firstName: first, lastName: "Welcome", email });
      if (r.status !== 201) throw new Error("create " + r.text);
      const c = r.body as { workerId: string; onboardingId: string; employeeNumber: string };
      await pool.query(`UPDATE workers SET ssn=$2 WHERE id=$1`, [c.workerId, SSN]).catch(() => {}); // tax value that must never be emailed
      await mkUser(first, "contractor", co.A, c.workerId);
      await pool.query(`UPDATE onboarding_steps SET status='completed', completed_at=now() WHERE onboarding_id=$1 AND step_key='account_setup'`, [c.onboardingId]);
      return { ...c, email, key: first };
    };
    const complete = async (c: { workerId: string; onboardingId: string; key: string }) => {
      const dev = (await login(c.key)).d;
      const agreementDoc = await seedSigned(c, co.A, "contractor_agreement", "contractor_onboarding_agreement", "signed_contractor_agreement");
      const w9Doc = await seedSigned(c, co.A, "w9", "contractor_onboarding_w9", "signed_w9");
      if ((await dev.upload("/api/my-onboarding/government-id/front", jpeg(), "front.jpg")).status !== 201) throw new Error("id upload");
      if ((await dev.req("PUT", "/api/my-onboarding/emergency-contact", { name: "Rae Contact", relationship: "Sibling", phone: "555 010 7777" })).status !== 200) throw new Error("ec");
      return { dev, docs: [agreementDoc, w9Doc] };
    };
    const approve = (onb: string) => adminA.req("POST", `/api/contractor-onboarding/${onb}/review`, { decision: "approve", confirmIdVerified: true, confirmW9Reviewed: true, confirmationPhrase: "APPROVE ONBOARDING", note: NOTE, currentPassword: pw });

    const c1 = await mk("Vera"), c2 = await mk("Uma"), c3 = await mk("Ray"), c4 = await mk("Dee");
    const s1 = await complete(c1); await complete(c3); await complete(c4);

    // ── 2. no message for incomplete or changes-requested onboarding ─────────
    console.log("\n— nothing for incomplete or rejected onboarding —");
    await seedSigned(c2, co.A, "w9", "contractor_onboarding_w9", "signed_w9");
    let r = await approve(c2.onboardingId);
    check("incomplete onboarding cannot be approved (ADI not ready)", r.status === 409 && r.body?.code === "not_ready", r.body);
    r = await adminA.req("POST", `/api/contractor-onboarding/${c2.onboardingId}/review`, { decision: "request_changes", step: "w9", note: "Line 3 is wrong" });
    check("changes requested on c2", r.body?.outcome === "changes_requested", r.body);
    let d = await drain();
    check("incomplete / changes-requested → no outbox row, no message", (await outboxOf(c2.onboardingId)).length === 0 && d.claimed === 0 && sink.messages.length === 0, [d, sink.messages.length]);

    // ── 1/3. one message after verified completion; replays queue nothing new ─
    console.log("\n— verified completion queues exactly one logical message —");
    const fired = await Promise.all([approve(c1.onboardingId), approve(c1.onboardingId), approve(c1.onboardingId)]);
    const outcomes = fired.map((x) => x.body?.outcome).sort();
    check("three concurrent approvals → one verified, two already_verified", outcomes.join(",") === "already_verified,already_verified,verified", outcomes);
    r = await approve(c1.onboardingId);
    check("replayed approval → already_verified", r.body?.outcome === "already_verified", r.body);
    let ob = await outboxOf(c1.onboardingId);
    check("exactly one queued outbox row (no address, body or token stored)", ob.length === 1 && ob[0].status === "queued" && ob[0].company_id === co.A && ob[0].worker_id === c1.workerId
      && !Object.keys(ob[0]).some((k) => /email|body|token|to_address|recipient/.test(k)), ob);
    const q = await db.transaction((tx) => W.queueWelcomeEmail(tx, { companyId: co.A, workerId: c1.workerId, onboardingId: c1.onboardingId, actorUserId: UID.adminA }));
    check("re-queue from a duplicate completion event → already_queued", q === "already_queued" && (await outboxOf(c1.onboardingId)).length === 1, q);

    d = await drain();
    const m1 = mailsTo(c1.email); const t1 = decodeMail(m1[0]?.raw ?? ""); const tok1 = decodeURIComponent(tokenIn(t1) ?? "");
    check("drain delivers exactly one welcome message to the contractor", d.sent === 1 && m1.length === 1 && sink.messages.length === 1, [d, sink.messages.length]);
    ob = await outboxOf(c1.onboardingId);
    check("outbox row is 'sent' with one attempt", ob[0].status === "sent" && ob[0].attempt_count === 1 && !!ob[0].sent_at, ob[0]);
    let toks = await tokensOf(c1.workerId);
    check("one pending token, bound to user + worker + company + onboarding + purpose, stored only as sha256",
      toks.length === 1 && toks[0].status === "pending" && toks[0].user_id === UID[c1.key] && toks[0].company_id === co.A && toks[0].onboarding_id === c1.onboardingId
      && toks[0].purpose === W.SETUP_PURPOSE && toks[0].token_hash === crypto.createHash("sha256").update(tok1).digest("hex") && tok1.length >= 40, toks);
    d = await drain(); await drain();
    check("draining again sends nothing more", d.claimed === 0 && mailsTo(c1.email).length === 1);

    // ── 9. content ────────────────────────────────────────────────────────────
    console.log("\n— email content —");
    const emp1 = (await pool.query(`SELECT employee_number FROM workers WHERE id=$1`, [c1.workerId])).rows[0].employee_number;
    const pinHash = (await pool.query(`SELECT pin_hash FROM workers WHERE id=$1`, [c1.workerId])).rows[0]?.pin_hash;
    const docIds = (await pool.query(`SELECT id FROM private_personnel_documents WHERE worker_id=$1`, [c1.workerId])).rows.map((x: any) => x.id);
    check("includes the employee number and the setup link", !!emp1 && t1.includes(String(emp1)) && t1.includes(`${BASE}/contractor-password-setup?token=`));
    const banned = [pw, SSN, "123456789", NOTE, "Rae Contact", "555 010 7777", "/uploads", "private", "front.jpg", "env_", "ciphertext", ...docIds, ...s1.docs, ...(pinHash ? [pinHash] : [])];
    const leaks = banned.filter((s) => t1.toLowerCase().includes(String(s).toLowerCase()));
    check("no password, PIN, tax value, ID data, document address or reviewer note in the email", leaks.length === 0 && !/\bpin\b/i.test(t1) && !/password:[ \t]*\S|password is/i.test(t1), leaks);
    const built = W.buildWelcomeEmail({ to: "x@example.test", firstName: "<b>Eve</b>", companyName: "A&B", employeeNumber: "2613", link: "https://x.invalid/contractor-password-setup?token=abc", expiresAt: new Date(Date.now() + 72 * 3600e3) });
    check("builder escapes HTML and states a 72-hour expiry", built.html.includes("&lt;b&gt;Eve&lt;/b&gt;") && built.html.includes("A&amp;B") && built.text.includes("72 hours"));

    // ── 4. delivery failure is never "sent"; retries make no duplicates ──────
    console.log("\n— delivery failure and retry —");
    const usersBefore = await usersOf(c3.workerId);
    r = await approve(c3.onboardingId); check("c3 verified", r.body?.outcome === "verified", r.body);
    sink.setMode("fail");
    d = await drain();
    ob = await outboxOf(c3.onboardingId); toks = await tokensOf(c3.workerId);
    check("SMTP failure → outbox 'failed' (not sent), attempt 1, backoff, error code only", d.failed === 1 && ob[0].status === "failed" && !ob[0].sent_at && ob[0].attempt_count === 1
      && ob[0].last_error_code === "send_failed" && new Date(ob[0].next_attempt_at).getTime() > now(), [d, ob[0]]);
    check("…the undelivered token is revoked (no live link)", toks.length === 1 && toks[0].status === "revoked" && toks[0].revoked_reason === "undelivered", toks);
    d = await drain();
    check("…not retried before its backoff", d.claimed === 0 && (await outboxOf(c3.onboardingId))[0].attempt_count === 1);
    sink.setMode("ok"); skew += 2 * 60 * 1000;
    d = await drain();
    ob = await outboxOf(c3.onboardingId); toks = await tokensOf(c3.workerId);
    check("retry after backoff → sent once; still one outbox row", d.sent === 1 && ob.length === 1 && ob[0].status === "sent" && ob[0].attempt_count === 2 && mailsTo(c3.email).length === 1, [d, ob]);
    check("…one live token, the failed one stays revoked, no duplicate account", toks.filter((t: any) => t.status === "pending").length === 1 && toks.length === 2 && (await usersOf(c3.workerId)) === usersBefore);

    r = await approve(c4.onboardingId); check("c4 verified", r.body?.outcome === "verified", r.body);
    sink.setMode("fail");
    for (let i = 0; i < 7; i++) { await drain(); skew += 61 * 60 * 1000; }
    sink.setMode("ok");
    ob = await outboxOf(c4.onboardingId);
    check("persistent failure → 'dead' after max_attempts; never sent; no live token", ob[0].status === "dead" && ob[0].attempt_count === ob[0].max_attempts && !ob[0].sent_at
      && mailsTo(c4.email).length === 0 && (await tokensOf(c4.workerId)).every((t: any) => t.status === "revoked"), ob[0]);
    d = await drain(); skew += 2 * 60 * 60 * 1000; d = await drain();
    check("…dead rows are not retried", (await outboxOf(c4.onboardingId))[0].attempt_count === ob[0].max_attempts && mailsTo(c4.email).length === 0);

    // ── eligibility re-check at send time ────────────────────────────────────
    console.log("\n— not sent while a required document is revoked —");
    await pool.query(`UPDATE email_outbox SET status='queued', attempt_count=0, sent_at=NULL, next_attempt_at=now() - interval '1 minute' WHERE subject_id=$1`, [c3.onboardingId]);
    await pool.query(`UPDATE private_personnel_documents SET status='superseded' WHERE worker_id=$1 AND document_kind='signed_w9'`, [c3.workerId]);
    const before3 = mailsTo(c3.email).length;
    d = await drain();
    ob = await outboxOf(c3.onboardingId);
    check("revoked W-9 → not sent, 'failed' with not_eligible, prior live token withdrawn", mailsTo(c3.email).length === before3 && ob[0].status === "failed" && ob[0].last_error_code === "not_eligible"
      && (await tokensOf(c3.workerId)).every((t: any) => t.status !== "pending") && (await tokensOf(c3.workerId)).some((t: any) => t.revoked_reason === "withdrawn"), ob[0]);
    await pool.query(`UPDATE private_personnel_documents SET status='active' WHERE worker_id=$1 AND document_kind='signed_w9'`, [c3.workerId]);

    // ── 6. replacement invalidates the prior token ───────────────────────────
    console.log("\n— replacement invalidates the prior token —");
    await pool.query(`UPDATE email_outbox SET status='sending', claimed_at = $2 WHERE subject_id=$1`, [c1.onboardingId, new Date(now() - 11 * 60 * 1000)]);
    d = await drain();
    const m1b = mailsTo(c1.email); const tok1b = decodeURIComponent(tokenIn(decodeMail(m1b[1]?.raw ?? "")) ?? "");
    toks = await tokensOf(c1.workerId);
    check("a stale 'sending' claim is retried with a NEW token; the old one is revoked (replaced)", d.sent === 1 && m1b.length === 2 && !!tok1b && tok1b !== tok1
      && toks.length === 2 && toks[0].status === "revoked" && toks[0].revoked_reason === "replaced" && toks[1].status === "pending", toks);
    check("…still one outbox row for c1", (await outboxOf(c1.onboardingId)).length === 1);

    // ── 5. generic failures ──────────────────────────────────────────────────
    console.log("\n— invalid tokens fail generically —");
    const anon = new Device(server.baseUrl);
    const setup = (token: string, password = `New-${sfx}-pw1`) => anon.req("POST", "/api/contractor-onboarding/password-setup", { token, password });
    const generic = (x: { status: number; text: string }) => x.status === 400 && x.text === JSON.stringify({ message: W.GENERIC_INVALID });
    r = await setup(tok1); check("revoked (replaced) token → generic", generic(r), r);
    r = await setup(crypto.randomBytes(32).toString("base64url")); check("forged token → generic", generic(r), r);
    r = await setup("x"); check("malformed token → generic", generic(r), r);
    const inviteTok = crypto.randomBytes(32).toString("base64url");
    await pool.query(`INSERT INTO account_invites (company_id, email, relationship_kind, relationship_id, role, token_hash, status, expires_at)
                      VALUES ($1,$2,'employee',NULL,'employee',$3,'pending', now() + interval '1 day')`, [co.A, `inv-${sfx}@example.test`, crypto.createHash("sha256").update(inviteTok).digest("hex")]);
    r = await setup(inviteTok); check("an account-invite token used here (wrong purpose) → generic", generic(r), r);
    const usersTotal = (await pool.query(`SELECT count(*)::int n FROM users`)).rows[0].n;
    r = await anon.req("POST", "/api/account-invites/accept", { token: tok1b, username: `zz_wel_x_${sfx}`, password: `New-${sfx}-pw1` });
    check("a welcome token used at /api/account-invites/accept → refused, no account created", r.status === 400 && (await pool.query(`SELECT count(*)::int n FROM users`)).rows[0].n === usersTotal, r);
    // wrong purpose stored on the row itself
    const c3tok = (await tokensOf(c3.workerId)).find((t: any) => t.status === "pending");
    const rawP = crypto.randomBytes(32).toString("base64url");
    const purposeRow = (await pool.query(`INSERT INTO contractor_password_setup_tokens (token_hash, purpose, company_id, worker_id, user_id, onboarding_id, expires_at)
       VALUES ($1,'some_other_purpose',$2,$3,$4,$5, now() + interval '1 day') RETURNING id`, [crypto.createHash("sha256").update(rawP).digest("hex"), co.A, c3.workerId, UID[c3.key], c3.onboardingId])).rows[0].id;
    r = await setup(rawP); check("token row with a different purpose → generic", generic(r), r);
    await pool.query(`DELETE FROM contractor_password_setup_tokens WHERE id=$1`, [purposeRow]);
    // expired
    const rawE = crypto.randomBytes(32).toString("base64url");
    await pool.query(`UPDATE contractor_password_setup_tokens SET status='revoked', revoked_reason='replaced' WHERE worker_id=$1 AND status='pending'`, [c4.workerId]);
    await pool.query(`INSERT INTO contractor_password_setup_tokens (token_hash, purpose, company_id, worker_id, user_id, onboarding_id, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6, now() - interval '1 minute')`, [crypto.createHash("sha256").update(rawE).digest("hex"), W.SETUP_PURPOSE, co.A, c4.workerId, UID[c4.key], c4.onboardingId]);
    r = await setup(rawE); check("expired token → generic", generic(r), r);
    // cross-company: the bound user now belongs to another company
    const rawX = crypto.randomBytes(32).toString("base64url");
    await pool.query(`UPDATE contractor_password_setup_tokens SET status='revoked', revoked_reason='replaced' WHERE worker_id=$1 AND status='pending'`, [c4.workerId]);
    await pool.query(`INSERT INTO contractor_password_setup_tokens (token_hash, purpose, company_id, worker_id, user_id, onboarding_id, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6, now() + interval '1 day')`, [crypto.createHash("sha256").update(rawX).digest("hex"), W.SETUP_PURPOSE, co.A, c4.workerId, UID[c4.key], c4.onboardingId]);
    await pool.query(`UPDATE users SET company_id=$2 WHERE id=$1`, [UID[c4.key], co.B]);
    r = await setup(rawX); check("cross-company (user moved to another tenant's company) → generic, password unchanged", generic(r)
      && await bcrypt.compare(pw, (await pool.query(`SELECT password FROM users WHERE id=$1`, [UID[c4.key]])).rows[0].password), r);
    await pool.query(`UPDATE users SET company_id=$2 WHERE id=$1`, [UID[c4.key], co.A]);
    check("…a rejected attempt does not consume the token", (await pool.query(`SELECT status FROM contractor_password_setup_tokens WHERE token_hash=$1`, [crypto.createHash("sha256").update(rawX).digest("hex")])).rows[0].status === "pending");
    r = await setup(tok1b, "short"); check("weak password → 400 (token not consumed)", r.status === 400 && (await tokensOf(c1.workerId))[1].status === "pending", r);

    // ── 7. successful setup consumes the token once ──────────────────────────
    console.log("\n— setup consumes the token once —");
    const live = await login(c1.key);
    check("contractor has a live session before setup", live.ok);
    const NEWPW = `New-${sfx}-pw1`;
    const both = await Promise.all([setup(tok1b, NEWPW), setup(tok1b, NEWPW)]);
    const okCount = both.filter((x) => x.status === 200).length;
    check("two concurrent uses → exactly one succeeds, the other is generic", okCount === 1 && both.some(generic), both.map((x) => x.status));
    toks = await tokensOf(c1.workerId);
    check("token is 'used' with a timestamp", toks[1].status === "used" && !!toks[1].used_at, toks[1]);
    r = await setup(tok1b, NEWPW); check("replayed token → generic", generic(r), r);
    check("new password signs in; old password does not", (await login(c1.key, NEWPW)).ok && !(await login(c1.key, pw)).ok);
    r = await live.d.req("GET", "/api/auth/me");
    check("the pre-existing session was ended by the password change", r.status === 401, r.status);
    check("no account was created by any of this", (await usersOf(c1.workerId)) === 1 && (await usersOf(c3.workerId)) === usersBefore);

    // ── 8. cross-tenant ──────────────────────────────────────────────────────
    console.log("\n— cross-tenant —");
    r = await adminB.req("GET", `/api/contractor-onboarding/${c1.onboardingId}/welcome-status`);
    check("company B admin cannot see A's welcome status → 404", r.status === 404, r.status);
    r = await adminA.req("GET", `/api/contractor-onboarding/${c1.onboardingId}/welcome-status`);
    check("company A admin sees delivery state only (no address, token or error text)", r.status === 200 && r.body?.status === "sent" && !/@|token|sink/.test(r.text), r.text);
    r = await adminB.req("POST", `/api/contractor-onboarding/${c3.onboardingId}/review`, { decision: "approve", confirmIdVerified: true, confirmW9Reviewed: true, confirmationPhrase: "APPROVE ONBOARDING", note: "x", currentPassword: pw });
    check("company B admin cannot approve (and so cannot queue) A's onboarding", r.status === 404, r.status);

    // ── 10 + audit ───────────────────────────────────────────────────────────
    console.log("\n— no network, no secrets in audit —");
    check("every message went to the local sink only", sink.messages.length > 0 && sink.messages.every((m) => m.rcpt.every((x) => /@example\.test/i.test(x))));
    const auditTxt = JSON.stringify((await pool.query(`SELECT event_type, after_json FROM onboarding_audit_log WHERE company_id=$1`, [co.A])).rows);
    const auditEvents = new Set((await pool.query(`SELECT event_type FROM onboarding_audit_log WHERE company_id=$1`, [co.A])).rows.map((x: any) => x.event_type));
    check("queueing, delivery, retry, revocation and token use are audited",
      ["welcome_email_queued", "welcome_email_sent", "welcome_email_failed", "welcome_email_dead", "password_setup_token_issued", "password_setup_token_revoked", "password_setup_completed", "password_setup_rejected"].every((e) => auditEvents.has(e)), [...auditEvents]);
    const auditLeaks = [tok1, tok1b, rawE, rawX, NEWPW, pw, c1.email, SSN, "sink"].filter((s) => auditTxt.includes(s));
    check("audit rows contain no token, password, address or tax value", auditLeaks.length === 0, auditLeaks.map((s) => s.slice(0, 6)));
    const log = server.output();
    check("server log holds no token, password or address", [tok1, tok1b, NEWPW, c1.email].every((s) => !log.includes(s)));
  } finally {
    if (server) await server.stop();
    await sink.close();
    const workers = (await pool.query(`SELECT id FROM workers WHERE company_id = ANY($1)`, [companyIds])).rows.map((x: any) => x.id);
    const moreUsers = (await pool.query(`SELECT id FROM users WHERE worker_id = ANY($1) OR company_id = ANY($2)`, [workers, companyIds])).rows.map((x: any) => x.id);
    const allUsers = [...new Set([...userIds, ...moreUsers])];
    await pool.query(`DELETE FROM session WHERE sess->>'userId' = ANY($1)`, [allUsers]).catch(() => {});
    for (const [q, params] of [
      [`DELETE FROM contractor_password_setup_tokens WHERE company_id = ANY($1)`, [companyIds]],
      [`DELETE FROM email_outbox WHERE company_id = ANY($1)`, [companyIds]],
      [`DELETE FROM account_invites WHERE company_id = ANY($1)`, [companyIds]],
      [`DELETE FROM employee_contacts WHERE worker_id = ANY($1)`, [workers]],
      [`DELETE FROM private_document_access_log WHERE company_id = ANY($1)`, [companyIds]],
      [`DELETE FROM private_personnel_documents WHERE company_id = ANY($1)`, [companyIds]],
      [`DELETE FROM documenso_signature_requests WHERE company_id = ANY($1)`, [companyIds]],
      [`DELETE FROM onboarding_audit_log WHERE company_id = ANY($1)`, [companyIds]],
      [`DELETE FROM onboarding_steps WHERE company_id = ANY($1)`, [companyIds]],
      [`DELETE FROM worker_onboarding WHERE company_id = ANY($1)`, [companyIds]],
      [`DELETE FROM authorization_audit_log WHERE company_id = ANY($1) OR actor_user_id = ANY($2)`, [companyIds, allUsers]],
      [`DELETE FROM employee_number_counters WHERE company_id = ANY($1)`, [companyIds]],
      [`DELETE FROM company_signin_codes WHERE company_id = ANY($1)`, [companyIds]],
    ] as [string, unknown[]][]) await pool.query(q, params).catch((e) => console.error("cleanup:", e.message));
    if (allUsers.length) await cascadeDelete(pool, "users", allUsers);
    if (workers.length) await cascadeDelete(pool, "workers", workers);
    if (companyIds.length) await cascadeDelete(pool, "companies", companyIds);
    await pool.query(`DELETE FROM tenant_companies WHERE company_id = ANY($1)`, [companyIds]);
    if (tenantIds.length) await cascadeDelete(pool, "tenants", tenantIds);
    const residue = [
      ...await verifyZeroResidue(pool, "companies", companyIds), ...await verifyZeroResidue(pool, "users", allUsers),
      ...await verifyZeroResidue(pool, "workers", workers), ...await verifyZeroResidue(pool, "tenants", tenantIds),
    ];
    const outboxLeft = (await pool.query(`SELECT count(*)::int n FROM email_outbox WHERE company_id = ANY($1)`, [companyIds])).rows[0].n;
    fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(jobDir, { recursive: true, force: true });
    check("zero fixture residue", residue.length === 0 && outboxLeft === 0 && !fs.existsSync(dir), residue);
    await pool.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
