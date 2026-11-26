/**
 * Contractor onboarding PR 7 — ADI checklist + administrator review queue.
 * Real server (in-process harness) + DISPOSABLE database + a temporary private
 * folder. Covers ADI findings, company isolation of queue/assessment/review,
 * approval gates (admin, CSRF, password re-entry, exact phrase, note, human
 * confirmations, readiness), concurrency/idempotency, request-changes, the
 * legacy /api/worker-onboarding bypass block, no notes/passwords/contact values
 * in audit or logs, and zero residue.
 *
 *   TEST_DATABASE_URL=<disposable db with 0041> npx tsx tests/contractor-onboarding-review-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
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


const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(1500)]);

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) { console.log("TEST_DATABASE_URL not set — skipping review DB tests (0 run)."); return; }
  for (const p of FORBIDDEN) if (p.test(url)) throw new Error("TEST_DATABASE_URL looks like staging/production. Refusing.");
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) throw new Error("TEST_DATABASE_URL equals DATABASE_URL. Refusing.");
  const pool = new Pool({ connectionString: url, max: 4 });
  const dbName = (await pool.query("SELECT current_database() n")).rows[0].n as string;
  if (FORBIDDEN.some((p) => p.test(dbName))) throw new Error("protected database name");
  for (const m of ["0042_contractor_onboarding_esign", "0043_private_personnel_documents", "0044_contractor_onboarding_esign_events"]) {
    await pool.query(fs.readFileSync(path.join(process.cwd(), `migrations/${m}.sql`), "utf8").replace(/^\\set .*$/m, ""));
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rev-test-"));
  for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "OPENAI_API_KEY", "XAI_API_KEY", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "DOCUMENSO_URL", "MYPAYLINK_DOCUMENSO_API_KEY"]) delete process.env[k];
  Object.assign(process.env, { PRIVATE_DOCUMENT_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64"), PRIVATE_DOCUMENT_DIR: dir });

  const sfx = crypto.randomBytes(3).toString("hex");
  const companyIds: string[] = [], userIds: string[] = [], tenantIds: string[] = [];
  const pw = `Pw-${sfx}-rev`; const pwHash = await bcrypt.hash(pw, 10);
  const co: Record<string, string> = {}; const U: Record<string, string> = {}; const UID: Record<string, string> = {};
  let server: Awaited<ReturnType<typeof startTestServer>> | undefined;
  const mkCompany = async (key: string) => {
    const c = crypto.randomUUID(); co[key] = c; companyIds.push(c);
    await pool.query(`INSERT INTO companies (id, name, subscription_status) VALUES ($1,$2,'active')`, [c, `ZZ REV ${key} ${sfx}`]);
    const t = (await pool.query(`INSERT INTO tenants (name, slug, status) VALUES ($1,$1,'active') RETURNING id`, [`zz-rev-${key.toLowerCase()}-${sfx}`])).rows[0].id;
    tenantIds.push(t);
    await pool.query(`INSERT INTO tenant_companies (tenant_id, company_id, is_primary) VALUES ($1,$2,true)`, [t, c]);
  };
  const mkUser = async (key: string, role: string, company: string | null, workerId: string | null = null) => {
    const u = crypto.randomUUID(); U[key] = `zz_rev_${key}_${sfx}`; UID[key] = u; userIds.push(u);
    await pool.query(`INSERT INTO users (id, username, password, role, company_id, worker_id, is_active) VALUES ($1,$2,$3,$4,$5,$6,true)`, [u, U[key], pwHash, role, company, workerId]);
  };
  const login = async (key: string) => {
    const d = new Device(server!.baseUrl);
    const r = await d.req("POST", "/api/auth/login", { username: U[key], password: pw });
    if (r.status !== 200) throw new Error(`login ${key} ${r.status}`);
    await d.req("GET", "/api/auth/me"); return d;
  };
  const steps = (onb: string) => pool.query(`SELECT step_key, status, review_notes, reviewed_by FROM onboarding_steps WHERE onboarding_id=$1`, [onb]).then((r) => Object.fromEntries(r.rows.map((x: any) => [x.step_key, x])));
  /** Seed a signed document exactly as PR 6 leaves it (request completed + private file row). */
  const seedSigned = async (c: { workerId: string; onboardingId: string }, stepKey: string, docType: string, kind: string) => {
    const step = (await pool.query(`SELECT id FROM onboarding_steps WHERE onboarding_id=$1 AND step_key=$2`, [c.onboardingId, stepKey])).rows[0].id;
    const docId = crypto.randomUUID();
    await pool.query(`INSERT INTO private_personnel_documents (id, company_id, worker_id, onboarding_id, document_kind, mime_type, byte_size, ciphertext_sha256, enc_key_id, enc_iv, enc_tag, uploaded_by_user_id)
                      VALUES ($1,$2,$3,$4,$5,'application/pdf',100,'x','x','x','x','system:documenso')`, [docId, co.A, c.workerId, c.onboardingId, kind]);
    await pool.query(`INSERT INTO documenso_signature_requests (document_type, related_record_id, company_id, status, documenso_document_id, completed_pdf_file_id, completed_at)
                      VALUES ($1,$2,$3,'completed',$4,$5,now())`, [docType, step, co.A, `env_${docId.slice(0, 8)}`, docId]);
    await pool.query(`UPDATE onboarding_steps SET status='completed', completed_at=now() WHERE id=$1`, [step]);
    return docId;
  };

  try {
    await mkCompany("A"); await mkCompany("B");
    await mkUser("adminA", "admin", co.A); await mkUser("adminB", "admin", co.B); await mkUser("mgrA", "manager", co.A); await mkUser("adminA2", "admin", co.A);
    server = await startTestServer(url);
    const adminA = await login("adminA"), adminB = await login("adminB"), mgrA = await login("mgrA"), adminA2 = await login("adminA2");
    const APPROVE_NOTE = `Checked ID and W-9 in person (${sfx})`;
    const OK = { decision: "approve", confirmIdVerified: true, confirmW9Reviewed: true, confirmationPhrase: "APPROVE ONBOARDING", note: APPROVE_NOTE, currentPassword: pw };
    const mk = async (first: string, last: string) => {
      const r = await adminA.req("POST", "/api/contractor-onboarding", { firstName: first, lastName: last, email: `${first.toLowerCase()}-${sfx}@example.test` });
      if (r.status !== 201) throw new Error("create " + r.text); return r.body as { workerId: string; onboardingId: string };
    };
    const c1 = await mk("Jo", "Ready"), c2 = await mk("Kai", "Redo");

    console.log("\n— ADI on a new onboarding —");
    let r = await adminA.req("GET", `/api/contractor-onboarding/${c1.onboardingId}/assessment`);
    const codes = (r.body?.findings || []).map((f: any) => f.code);
    check("lists every missing item as blocking; not ready", r.status === 200 && r.body.ready === false &&
      ["account_not_set_up", "agreement_not_signed", "w9_not_signed", "emergency_contact_missing", "government_id_missing"].every((c) => codes.includes(c)), codes);
    check("each finding has a message and guidance", r.body.findings.every((f: any) => f.message && f.guidance));
    check("findings never contain names, emails or numbers", !r.text.includes("Jo") && !r.text.includes("@") && !/\b26\d\d\b/.test(r.text), r.text.slice(0, 200));
    r = await adminA.req("POST", `/api/contractor-onboarding/${c1.onboardingId}/review`, OK);
    check("approve while incomplete → 409 not_ready with the blocking findings", r.status === 409 && r.body.code === "not_ready" && r.body.findings.length >= 5, r.body);
    check("…nothing changed", (await pool.query(`SELECT status FROM worker_onboarding WHERE id=$1`, [c1.onboardingId])).rows[0].status === "invite_pending");

    console.log("\n— building a complete onboarding —");
    for (const c of [c1, c2]) {
      const key = c === c1 ? "con1" : "con2";
      await mkUser(key, "contractor", co.A, c.workerId);
      await pool.query(`UPDATE onboarding_steps SET status='completed', completed_at=now() WHERE onboarding_id=$1 AND step_key='account_setup'`, [c.onboardingId]);
    }
    const con1 = await login("con1"), con2 = await login("con2");
    await pool.query(`UPDATE onboarding_steps SET status='completed' WHERE onboarding_id=$1 AND step_key='contractor_agreement'`, [c1.onboardingId]);
    r = await adminA.req("GET", `/api/contractor-onboarding/${c1.onboardingId}/assessment`);
    check("agreement marked done with no signed copy → agreement_evidence_missing (blocking)", r.body.findings.some((f: any) => f.code === "agreement_evidence_missing" && f.severity === "blocking"), r.body.findings.map((f: any) => f.code));
    await pool.query(`UPDATE onboarding_steps SET status='not_started' WHERE onboarding_id=$1 AND step_key='contractor_agreement'`, [c1.onboardingId]);
    for (const [c, con] of [[c1, con1], [c2, con2]] as const) {
      await seedSigned(c, "contractor_agreement", "contractor_onboarding_agreement", "signed_contractor_agreement");
      await seedSigned(c, "w9", "contractor_onboarding_w9", "signed_w9");
      const up = await con.upload("/api/my-onboarding/government-id/front", jpeg(), "front.jpg");
      if (up.status !== 201) throw new Error("upload " + up.text);
      const ec = await con.req("PUT", "/api/my-onboarding/emergency-contact", { name: "Lee Contact", relationship: "Friend", phone: "555 010 4444" });
      if (ec.status !== 200) throw new Error("ec " + ec.text);
    }
    await pool.query(`UPDATE workers SET mobile_phone='(555) 010-4444' WHERE id=$1`, [c1.workerId]);
    r = await adminA.req("GET", `/api/contractor-onboarding/${c1.onboardingId}/assessment`);
    const f1 = Object.fromEntries(r.body.findings.map((f: any) => [f.code, f.severity]));
    check("complete → ready (no blocking findings)", r.body.ready === true && r.body.counts.blocking === 0, r.body.findings);
    check("human-only checks are review tasks: government ID and W-9", f1.review_government_id === "review" && f1.review_w9 === "review", f1);
    check("conflict detected: emergency contact phone is the contractor's own", f1.emergency_contact_is_self_phone === "review", f1);
    check("info: only the front of the ID", f1.government_id_back_missing === "info", f1);

    console.log("\n— queue —");
    r = await adminA.req("GET", "/api/contractor-onboarding/review-queue");
    check("queue lists both, ready first, with counts only", r.status === 200 && r.body.length === 2 && r.body[0].ready === true && !("findings" in r.body[0]), r.body);
    r = await mgrA.req("GET", "/api/contractor-onboarding/review-queue");
    check("manager can see the queue", r.status === 200 && r.body.length === 2, r.status);
    r = await adminB.req("GET", "/api/contractor-onboarding/review-queue");
    check("other company sees none of A's", r.status === 200 && r.body.length === 0, r.body);
    r = await con1.req("GET", "/api/contractor-onboarding/review-queue");
    check("contractor cannot see the queue → 403", r.status === 403, r.status);
    const fa = await adminB.req("GET", `/api/contractor-onboarding/${c1.onboardingId}/assessment`);
    const fr = await adminB.req("GET", `/api/contractor-onboarding/${crypto.randomUUID()}/assessment`);
    check("other company's admin: assessment → 404 identical to a random id", fa.status === 404 && fa.text === fr.text, [fa.status, fa.text]);

    console.log("\n— approve —");
    const P1 = `/api/contractor-onboarding/${c1.onboardingId}/review`;
    r = await adminA.req("POST", P1, { ...OK, confirmIdVerified: false, confirmW9Reviewed: false });
    check("approve without the two confirmations → 400 confirmation_required", r.status === 400 && r.body.code === "confirmation_required", r.body);
    r = await adminA.req("POST", P1, { ...OK, confirmW9Reviewed: false });
    check("…one confirmation is not enough → 400", r.status === 400, r.status);
    for (const [label, phrase] of [["missing", undefined], ["lower-case", "approve onboarding"], ["extra text", "APPROVE ONBOARDING!"], ["padded", " APPROVE ONBOARDING"]] as const) {
      r = await adminA.req("POST", P1, { ...OK, confirmationPhrase: phrase });
      check(`confirmation phrase ${label} → 400 confirmation_phrase`, r.status === 400 && r.body.code === "confirmation_phrase", r.body);
    }
    for (const [label, note] of [["missing", undefined], ["blank", "   "], ["overlong", "x".repeat(501)], ["control chars", "ok\u0007"]] as const) {
      r = await adminA.req("POST", P1, { ...OK, note });
      check(`reviewer note ${label} → 400`, r.status === 400, r.body);
    }
    r = await adminA.req("POST", P1, { ...OK, currentPassword: undefined });
    check("no password re-entry → 403 reauth_required", r.status === 403 && r.body.code === "reauth_required", r.body);
    r = await adminA.req("POST", P1, { ...OK, currentPassword: pw + "x" });
    check("wrong password → 403 reauth_required", r.status === 403 && r.body.code === "reauth_required", r.body);
    for (let i = 0; i < 5; i++) await adminA2.req("POST", P1, { ...OK, currentPassword: "wrong-" + i });
    r = await adminA2.req("POST", P1, OK);
    check("5 wrong passwords → locked (429) even with the right one; per-user", r.status === 429 && r.body.code === "reauth_locked", r.body);
    check("…nothing changed by any refused approval", (await pool.query(`SELECT status FROM worker_onboarding WHERE id=$1`, [c1.onboardingId])).rows[0].status !== "verified");
    r = await mgrA.req("POST", P1, OK);
    check("manager cannot approve → 403", r.status === 403, r.status);
    r = await adminA.req("POST", P1, OK, { csrf: false });
    check("no CSRF → 403", r.status === 403, r.status);
    const fb = await adminB.req("POST", P1, OK);
    const rb = await adminB.req("POST", `/api/contractor-onboarding/${crypto.randomUUID()}/review`, OK);
    check("other company's admin → 404 identical to a random id", fb.status === 404 && fb.text === rb.text, [fb.status, fb.text]);

    console.log("\n— legacy routes cannot bypass the review —");
    const s1step = (await pool.query(`SELECT id FROM onboarding_steps WHERE onboarding_id=$1 AND step_key='admin_review'`, [c1.onboardingId])).rows[0].id;
    for (const [m, p, b] of [
      ["PATCH", `/api/worker-onboarding/${c1.onboardingId}`, { status: "verified" }],
      ["PATCH", `/api/worker-onboarding/${c1.onboardingId}/steps/${s1step}`, { status: "completed" }],
      ["POST", `/api/worker-onboarding/${c1.onboardingId}/review`, { action: "approve" }],
      ["POST", `/api/worker-onboarding/${c1.onboardingId}/regenerate-token`, {}],
      ["DELETE", `/api/worker-onboarding/${c1.onboardingId}`, undefined],
    ] as const) {
      r = await adminA.req(m, p, b);
      check(`${m} ${p.replace(c1.onboardingId, ":id").replace(s1step, ":stepId")} → 409 for a contractor onboarding`, r.status === 409, [r.status, r.text.slice(0, 120)]);
    }
    const lo = (await pool.query(`SELECT o.status, o.invite_token_hash, s.status AS rs FROM worker_onboarding o JOIN onboarding_steps s ON s.onboarding_id=o.id AND s.step_key='admin_review' WHERE o.id=$1`, [c1.onboardingId])).rows[0];
    check("…onboarding, admin_review step and invite token untouched", lo && lo.status !== "verified" && lo.status !== "approved" && lo.rs !== "completed" && lo.invite_token_hash === null, lo);
    console.log("\n— approve (valid) —");
    const burst = await Promise.all(Array.from({ length: 5 }, () => adminA.req("POST", P1, OK)));
    const outs = burst.map((x) => x.body?.outcome ?? x.status);
    check("5 concurrent approvals → exactly one 'verified', the rest already_verified", outs.filter((o) => o === "verified").length === 1 && outs.filter((o) => o === "already_verified").length === 4, outs);
    const o1 = (await pool.query(`SELECT status, approved_by, approved_at, completion_percent FROM worker_onboarding WHERE id=$1`, [c1.onboardingId])).rows[0];
    const s1 = await steps(c1.onboardingId);
    check("onboarding verified with approver + time, 100%", o1.status === "verified" && o1.approved_by === UID.adminA && !!o1.approved_at && o1.completion_percent === 100, o1);
    check("ID, W-9 and admin review steps completed and marked reviewed by the admin", ["government_id", "w9", "admin_review"].every((k) => s1[k].status === "completed" && s1[k].reviewed_by === UID.adminA), s1);
    check("reviewer note stored on the admin_review step", s1.admin_review.review_notes === APPROVE_NOTE, s1.admin_review);
    r = await con1.req("GET", "/api/my-onboarding");
    check("…and not shown to the contractor", r.status === 200 && !r.text.includes(APPROVE_NOTE));
    check("one onboarding_verified audit (acknowledged review codes only)", (await pool.query(`SELECT after_json FROM onboarding_audit_log WHERE onboarding_id=$1 AND event_type='onboarding_verified'`, [c1.onboardingId])).rows.length === 1);
    check("worker is NOT activated here (welcome + activation is PR 9)", (await pool.query(`SELECT is_active FROM workers WHERE id=$1`, [c1.workerId])).rows[0].is_active === false);
    r = await adminA.req("POST", P1, { decision: "request_changes", step: "w9", note: "x" });
    check("request changes after verification → 409", r.status === 409, r.status);
    r = await adminA.req("POST", P1, OK);
    check("approve again → already_verified, no second audit", r.body?.outcome === "already_verified" && (await pool.query(`SELECT count(*)::int n FROM onboarding_audit_log WHERE onboarding_id=$1 AND event_type='onboarding_verified'`, [c1.onboardingId])).rows[0].n === 1, r.body);
    r = await adminA.req("GET", "/api/contractor-onboarding/review-queue");
    check("verified onboarding leaves the queue", r.body.length === 1 && r.body[0].onboardingId === c2.onboardingId, r.body);

    console.log("\n— request changes —");
    const P2 = `/api/contractor-onboarding/${c2.onboardingId}/review`;
    for (const [label, body] of [["unknown step", { decision: "request_changes", step: "admin_review", note: "x" }], ["empty note", { decision: "request_changes", step: "w9", note: " " }], ["overlong note", { decision: "request_changes", step: "w9", note: "x".repeat(501) }], ["no decision", {}]] as const) {
      r = await adminA.req("POST", P2, body);
      check(`${label} → 400`, r.status === 400, r.body);
    }
    const NOTE = `Wrong tax classification on line 3 (${sfx})`;
    r = await adminA.req("POST", P2, { decision: "request_changes", step: "w9", note: NOTE });
    check("request changes on the W-9 → changes_requested", r.status === 200 && r.body.outcome === "changes_requested", r.body);
    const s2 = await steps(c2.onboardingId);
    check("W-9 step reopened with the note; onboarding changes_requested", s2.w9.status === "not_started" && s2.w9.review_notes === NOTE && (await pool.query(`SELECT status FROM worker_onboarding WHERE id=$1`, [c2.onboardingId])).rows[0].status === "changes_requested", s2.w9);
    const rq = (await pool.query(`SELECT status FROM documenso_signature_requests WHERE company_id=$1 AND document_type='contractor_onboarding_w9' AND related_record_id=(SELECT id FROM onboarding_steps WHERE onboarding_id=$2 AND step_key='w9')`, [co.A, c2.onboardingId])).rows;
    check("the W-9 request is voided so it can be sent again; the signed copy is kept", rq.length === 1 && rq[0].status === "voided" && (await pool.query(`SELECT count(*)::int n FROM private_personnel_documents WHERE worker_id=$1 AND document_kind='signed_w9'`, [c2.workerId])).rows[0].n === 1, rq);
    r = await adminA.req("POST", P2, { decision: "request_changes", step: "w9", note: NOTE });
    check("same request again → already_changes_requested, no second audit", r.status === 200 && r.body.outcome === "already_changes_requested"
      && (await pool.query(`SELECT count(*)::int n FROM onboarding_audit_log WHERE onboarding_id=$1 AND event_type='changes_requested'`, [c2.onboardingId])).rows[0].n === 1, r.body);
    const c3 = await mk("Ola", "New");
    r = await adminA.req("POST", `/api/contractor-onboarding/${c3.onboardingId}/review`, { decision: "request_changes", step: "government_id", note: "Upload again" });
    check("request changes on an item never submitted → 409 nothing_to_reopen", r.status === 409 && r.body.code === "nothing_to_reopen", r.body);
    r = await adminA.req("POST", P2, { decision: "request_changes", step: "contractor_agreement", note: "Please re-sign" }, { csrf: false });
    check("request changes without CSRF → 403", r.status === 403, r.status);
    r = await mgrA.req("POST", P2, { decision: "request_changes", step: "contractor_agreement", note: "Please re-sign" });
    check("manager cannot request changes → 403", r.status === 403, r.status);
    r = await adminB.req("POST", P2, { decision: "request_changes", step: "contractor_agreement", note: "Please re-sign" });
    check("other company's admin cannot request changes → 404", r.status === 404, r.status);
    check("…agreement step untouched by the refused requests", (await steps(c2.onboardingId)).contractor_agreement.status === "completed");
    r = await con2.req("GET", "/api/my-onboarding");
    check("the contractor sees the note on their checklist", r.body.steps.find((s: any) => s.key === "w9")?.note === NOTE, r.body.steps);
    r = await con1.req("GET", "/api/my-onboarding");
    check("…and another contractor does not", !r.text.includes(NOTE));
    r = await adminA.req("GET", `/api/contractor-onboarding/${c2.onboardingId}/assessment`);
    check("ADI now blocks on the W-9 again", r.body.ready === false && r.body.findings.some((f: any) => f.code === "w9_not_signed"), r.body.findings.map((f: any) => f.code));
    const auditText = JSON.stringify((await pool.query(`SELECT after_json FROM onboarding_audit_log WHERE company_id=$1 AND event_type IN ('changes_requested','onboarding_verified')`, [co.A])).rows);
    check("audit never holds the reviewer's notes or password", !auditText.includes("Wrong tax") && !auditText.includes(APPROVE_NOTE) && !auditText.includes(pw) && auditText.includes('step') && auditText.includes('w9'), auditText);
    const log = server.output();
    const leak = ["Wrong tax classification", "Lee Contact", "555 010 4444", APPROVE_NOTE, pw].map((k) => { const i = log.indexOf(k); return i < 0 ? null : log.slice(Math.max(0, i - 300), i + 80); }).filter(Boolean);
    check("server log never holds the note or contact values", log.length > 0 && leak.length === 0, leak);
  } finally {
    if (server) await server.stop();
    const workers = (await pool.query(`SELECT id FROM workers WHERE company_id = ANY($1)`, [companyIds])).rows.map((x: any) => x.id);
    const moreUsers = (await pool.query(`SELECT id FROM users WHERE worker_id = ANY($1) OR company_id = ANY($2)`, [workers, companyIds])).rows.map((x: any) => x.id);
    const allUsers = [...new Set([...userIds, ...moreUsers])];
    await pool.query(`DELETE FROM session WHERE sess->>'userId' = ANY($1)`, [allUsers]).catch(() => {});
    await pool.query(`DELETE FROM employee_contacts WHERE worker_id = ANY($1)`, [workers]);
    await pool.query(`DELETE FROM private_document_access_log WHERE company_id = ANY($1)`, [companyIds]);
    await pool.query(`DELETE FROM private_personnel_documents WHERE company_id = ANY($1)`, [companyIds]);
    await pool.query(`DELETE FROM documenso_signature_requests WHERE company_id = ANY($1)`, [companyIds]);
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
    fs.rmSync(dir, { recursive: true, force: true });
    check("zero fixture residue", residue.length === 0 && !fs.existsSync(dir), residue);
    await pool.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
