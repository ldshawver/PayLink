/**
 * Contractor onboarding PR 8 — the server-side marketplace gate.
 * Real server (in-process harness) + DISPOSABLE database + a temporary private
 * folder. Proves: every unmet requirement blocks every gated action (26 routes,
 * contractor- and administrator-initiated); a fully verified contractor
 * proceeds; cross-company/cross-tenant attempts fail; request-supplied identity
 * is ignored; review cases, revoked/rejected documents and replayed completion
 * markers keep the gate closed; employee applications are not routed through
 * it; denials leave no residue; responses and audit rows carry no sensitive
 * values; verified behaviour is unchanged.
 *
 *   TEST_DATABASE_URL=<disposable db> npx tsx tests/contractor-onboarding-gate-db.test.ts
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
const GATE = "CONTRACTOR_ONBOARDING_INCOMPLETE";
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
  private headers(method: string, json: boolean, extra: Record<string, string> = {}) {
    const h: Record<string, string> = { ...extra };
    if (this.jar.size) h.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (json) h["content-type"] = "application/json";
    const t = this.jar.get("csrf_token");
    if (method !== "GET" && t) h["x-csrf-token"] = decodeURIComponent(t);
    return h;
  }
  async req(method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(`${this.base}${p}`, { method, headers: this.headers(method, body !== undefined, headers), body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
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
const pdf = () => Buffer.from("%PDF-1.4\n% gate test\n");

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) { console.log("TEST_DATABASE_URL not set — skipping gate DB tests (0 run)."); return; }
  for (const p of FORBIDDEN) if (p.test(url)) throw new Error("TEST_DATABASE_URL looks like staging/production. Refusing.");
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) throw new Error("TEST_DATABASE_URL equals DATABASE_URL. Refusing.");
  const pool = new Pool({ connectionString: url, max: 4 });
  const dbName = (await pool.query("SELECT current_database() n")).rows[0].n as string;
  if (FORBIDDEN.some((p) => p.test(dbName))) throw new Error("protected database name");
  for (const m of ["0042_contractor_onboarding_esign", "0043_private_personnel_documents", "0044_contractor_onboarding_esign_events"]) {
    await pool.query(fs.readFileSync(path.join(process.cwd(), `migrations/${m}.sql`), "utf8").replace(/^\\set .*$/m, ""));
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-test-"));
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-jobs-"));
  for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "OPENAI_API_KEY", "XAI_API_KEY", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "DOCUMENSO_URL", "MYPAYLINK_DOCUMENSO_API_KEY", "STRIPE_SECRET_KEY"]) delete process.env[k];
  Object.assign(process.env, { PRIVATE_DOCUMENT_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64"), PRIVATE_DOCUMENT_DIR: dir, PRIVATE_STORAGE_DIR: jobDir });

  const sfx = crypto.randomBytes(3).toString("hex");
  const companyIds: string[] = [], userIds: string[] = [], tenantIds: string[] = [];
  const pw = `Pw-${sfx}-gate`; const pwHash = await bcrypt.hash(pw, 10);
  const co: Record<string, string> = {}; const U: Record<string, string> = {}; const UID: Record<string, string> = {};
  let server: Awaited<ReturnType<typeof startTestServer>> | undefined;
  const mkTenant = async (key: string) => (await pool.query(`INSERT INTO tenants (name, slug, status) VALUES ($1,$1,'active') RETURNING id`, [`zz-gate-${key.toLowerCase()}-${sfx}`])).rows[0].id as string;
  const mkCompany = async (key: string, tenant: string, primary = true) => {
    const c = crypto.randomUUID(); co[key] = c; companyIds.push(c);
    await pool.query(`INSERT INTO companies (id, name, subscription_status) VALUES ($1,$2,'active')`, [c, `ZZ GATE ${key} ${sfx}`]);
    await pool.query(`INSERT INTO tenant_companies (tenant_id, company_id, is_primary) VALUES ($1,$2,$3)`, [tenant, c, primary]);
  };
  const mkUser = async (key: string, role: string, company: string | null, workerId: string | null = null) => {
    const u = crypto.randomUUID(); U[key] = `zz_gate_${key}_${sfx}`; UID[key] = u; userIds.push(u);
    await pool.query(`INSERT INTO users (id, username, password, role, company_id, worker_id, is_active) VALUES ($1,$2,$3,$4,$5,$6,true)`, [u, U[key], pwHash, role, company, workerId]);
  };
  const mkWorker = async (company: string, type: string, last: string) => {
    const id = crypto.randomUUID();
    await pool.query(`INSERT INTO workers (id, company_id, first_name, last_name, worker_type, status) VALUES ($1,$2,'ZZ',$3,$4,'active')`, [id, company, `${last}${sfx}`, type]);
    return id;
  };
  const login = async (key: string) => {
    const d = new Device(server!.baseUrl);
    const r = await d.req("POST", "/api/auth/login", { username: U[key], password: pw });
    if (r.status !== 200) throw new Error(`login ${key} ${r.status} ${r.text.slice(0, 200)}`);
    await d.req("GET", "/api/auth/me"); return d;
  };
  const seedSigned = async (c: { workerId: string; onboardingId: string }, company: string, stepKey: string, docType: string, kind: string) => {
    const step = (await pool.query(`SELECT id FROM onboarding_steps WHERE onboarding_id=$1 AND step_key=$2`, [c.onboardingId, stepKey])).rows[0].id;
    const docId = crypto.randomUUID();
    await pool.query(`INSERT INTO private_personnel_documents (id, company_id, worker_id, onboarding_id, document_kind, mime_type, byte_size, ciphertext_sha256, enc_key_id, enc_iv, enc_tag, uploaded_by_user_id)
                      VALUES ($1,$2,$3,$4,$5,'application/pdf',100,'x','x','x','x','system:documenso')`, [docId, company, c.workerId, c.onboardingId, kind]);
    await pool.query(`INSERT INTO documenso_signature_requests (document_type, related_record_id, company_id, status, documenso_document_id, completed_pdf_file_id, completed_at)
                      VALUES ($1,$2,$3,'completed',$4,$5,now())`, [docType, step, company, `env_${docId.slice(0, 8)}`, docId]);
    await pool.query(`UPDATE onboarding_steps SET status='completed', completed_at=now() WHERE id=$1`, [step]);
  };
  /** Row counts for every table with company_id (A), plus contractor-keyed tables — the residue fingerprint. */
  const fingerprint = async (company: string, workerIds: string[]) => {
    const tables = (await pool.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='company_id'
                                       AND table_name NOT IN ('authorization_audit_log') ORDER BY table_name`)).rows.map((r: any) => r.table_name);
    const out: Record<string, number> = {};
    for (const t of tables) out[t] = (await pool.query(`SELECT count(*)::int n FROM "${t}" WHERE company_id = $1`, [company])).rows[0].n;
    for (const t of ["contractor_proposals", "contractor_contracts", "contractor_invoices", "contractor_job_bids", "contractor_payments"]) {
      out[`${t}#contractor`] = (await pool.query(`SELECT count(*)::int n FROM ${t} WHERE contractor_id = ANY($1)`, [workerIds])).rows[0].n;
    }
    out["contractor_job_bid_events#all"] = (await pool.query(`SELECT count(*)::int n FROM contractor_job_bid_events WHERE company_id = $1`, [company])).rows[0].n;
    out["proposal_approval_events#all"] = (await pool.query(`SELECT count(*)::int n FROM proposal_approval_events e JOIN contractor_proposals p ON p.id = e.proposal_id WHERE p.company_id = $1`, [company])).rows[0].n;
    out["private_files"] = fs.readdirSync(jobDir, { recursive: true } as any).length;
    return out;
  };
  const diffFp = (a: Record<string, number>, b: Record<string, number>) => Object.keys({ ...a, ...b }).filter((k) => a[k] !== b[k]).map((k) => `${k}:${a[k]}→${b[k]}`);

  try {
    const tA = await mkTenant("A"), tB = await mkTenant("B"); tenantIds.push(tA, tB);
    await mkCompany("A", tA); await mkCompany("A2", tA, false); await mkCompany("B", tB);
    await mkUser("adminA", "admin", co.A); await mkUser("adminB", "admin", co.B);
    const empW = await mkWorker(co.A, "employee", "Emp"); await mkUser("emp", "employee", co.A, empW);
    const legacyW = await mkWorker(co.A, "contractor", "Legacy"); await mkUser("legacy", "contractor", co.A, legacyW);
    server = await startTestServer(url);
    const adminA = await login("adminA"), adminB = await login("adminB"), emp = await login("emp"), legacy = await login("legacy");

    // ── a fully verified contractor (PR 1–7 flow; activation = PR 9 stand-in) ──
    const mk = async (first: string, last: string) => {
      const r = await adminA.req("POST", "/api/contractor-onboarding", { firstName: first, lastName: last, email: `${first.toLowerCase()}-${sfx}@example.test` });
      if (r.status !== 201) throw new Error("create " + r.text); return r.body as { workerId: string; onboardingId: string };
    };
    const c1 = await mk("Vera", "Verified"), c2 = await mk("Uma", "Unverified");
    for (const [key, c] of [["con1", c1], ["con2", c2]] as const) {
      await mkUser(key, "contractor", co.A, c.workerId);
      await pool.query(`UPDATE onboarding_steps SET status='completed', completed_at=now() WHERE onboarding_id=$1 AND step_key='account_setup'`, [c.onboardingId]);
    }
    const con1 = await login("con1"), con2 = await login("con2");
    await seedSigned(c1, co.A, "contractor_agreement", "contractor_onboarding_agreement", "signed_contractor_agreement");
    await seedSigned(c1, co.A, "w9", "contractor_onboarding_w9", "signed_w9");
    if ((await con1.upload("/api/my-onboarding/government-id/front", jpeg(), "front.jpg")).status !== 201) throw new Error("id upload");
    if ((await con1.req("PUT", "/api/my-onboarding/emergency-contact", { name: "Rae Contact", relationship: "Sibling", phone: "555 010 7777" })).status !== 200) throw new Error("ec");
    const NOTE = `Reviewed in person ${sfx}`;
    let r = await adminA.req("POST", `/api/contractor-onboarding/${c1.onboardingId}/review`, { decision: "approve", confirmIdVerified: true, confirmW9Reviewed: true, confirmationPhrase: "APPROVE ONBOARDING", note: NOTE, currentPassword: pw });
    if (r.body?.outcome !== "verified") throw new Error("approve " + r.text);
    await pool.query(`UPDATE workers SET status='active', is_active=true WHERE id=$1`, [c1.workerId]); // PR 9 activation stand-in

    // ── records the gated actions act on (all owned by c1, company A) ────────
    const deadline = new Date(Date.now() + 7 * 864e5).toISOString();
    const mkPost = async (d: Device, body: Record<string, unknown>) => {
      const p = await d.req("POST", "/api/job-posts", body);
      if (p.status !== 201) throw new Error("post " + p.text);
      const pub = await d.req("POST", `/api/job-posts/${p.body.id}/publish`, {});
      if (pub.status !== 200) throw new Error("publish " + pub.text);
      return p.body.id as string;
    };
    const contractorPost = { workerClassification: "contractor", scheduleType: "one_time", title: "Paint lobby", summary: "Two coats", scopeOfWork: "Lobby walls", compensationType: "fixed_bid", compensationMax: 5000, applicationDeadline: deadline };
    const postA = await mkPost(adminA, contractorPost);
    const postA2 = await mkPost(adminA, { ...contractorPost, title: "Paint hall" });
    const postB = await mkPost(adminB, { ...contractorPost, title: "Paint B" });
    const empPost = await mkPost(adminA, { workerClassification: "employee", scheduleType: "full_time", title: "Bookkeeper", summary: "Full-time", compensationType: "salary", compensationMin: 50000, compensationMax: 60000, applicationDeadline: deadline });

    console.log("\n— verified contractor proceeds (setup through the real API) —");
    r = await con1.req("POST", `/api/job-posts/${postA}/bids`, { scopeAndDeliverables: "Scope", estimatedHours: 10, proposedAmount: "4000" });
    check("verified contractor creates a bid → 201", r.status === 201, r.body);
    const BID = r.body?.id as string;
    const PROP = (await pool.query(`INSERT INTO contractor_proposals (company_id, contractor_id, proposal_number, title, issue_date, status, amount, subtotal) VALUES ($1,$2,$3,'ZZ prop','2026-11-20','submitted',100,100) RETURNING id`, [co.A, c1.workerId, `CP-ZZ-${sfx}`])).rows[0].id;
    const CON = (await pool.query(`INSERT INTO contractor_contracts (company_id, contractor_id, contract_number, title, status) VALUES ($1,$2,$3,'ZZ contract','draft') RETURNING id`, [co.A, c1.workerId, `CON-ZZ-${sfx}`])).rows[0].id;
    const SHARE = crypto.randomBytes(16).toString("hex");
    const PROP_SENT = (await pool.query(`INSERT INTO contractor_proposals (company_id, contractor_id, proposal_number, title, issue_date, status, amount, subtotal, share_token) VALUES ($1,$2,$3,'ZZ sent prop','2026-11-20','sent',100,100,$4) RETURNING id`, [co.A, c1.workerId, `CP-ZS-${sfx}`, SHARE])).rows[0].id;
    const INV = (await pool.query(`INSERT INTO contractor_invoices (company_id, contractor_id, invoice_number, invoice_date, amount, status) VALUES ($1,$2,$3,'2026-11-20',100,'draft') RETURNING id`, [co.A, c1.workerId, `INV-ZZ-${sfx}`])).rows[0].id;

    const PAY = (await pool.query(`INSERT INTO contractor_payments (company_id, contractor_id, invoice_id, amount, status) VALUES ($1,$2,$3,1,'completed') RETURNING id`, [co.A, c1.workerId, INV])).rows[0].id;
    const anon = new Device(server.baseUrl);
    type Act = { name: string; who: "con" | "admin" | "anon"; method: string; path: string; body?: unknown; headers?: Record<string, string>; upload?: boolean };
    const ACTIONS: Act[] = [
      { name: "bid_create", who: "con", method: "POST", path: `/api/job-posts/${postA2}/bids`, body: { scopeAndDeliverables: "S", estimatedHours: 1, proposedAmount: "1" } },
      { name: "bid_update", who: "con", method: "PATCH", path: `/api/contractor-job-bids/${BID}`, body: { proposedAmount: "3999" } },
      { name: "bid_submit", who: "con", method: "POST", path: `/api/contractor-job-bids/${BID}/submit`, body: {} },
      { name: "bid_attachment", who: "con", method: "POST", path: `/api/contractor-job-bids/${BID}/attachments`, upload: true },
      { name: "proposal_create", who: "con", method: "POST", path: `/api/contractor-proposals`, body: { title: "Self proposal", companyId: co.A, issueDate: "2026-11-20" } },
      { name: "proposal_submit", who: "con", method: "POST", path: `/api/contractor-proposals/${PROP}/submit`, body: {} },
      { name: "proposal_send", who: "con", method: "POST", path: `/api/contractor-proposals/${PROP}/send`, body: {} },
      { name: "proposal_accept_counteroffer", who: "con", method: "POST", path: `/api/contractor-proposals/${PROP}/accept-counteroffer`, body: {} },
      { name: "contract_sign", who: "con", method: "POST", path: `/api/contractor-contracts/${CON}/sign`, body: { name: "Vera", signatureData: "data:image/png;base64,AA" } },
      { name: "invoice_create", who: "con", method: "POST", path: `/api/contractor-invoices`, body: { amount: "10", invoiceDate: "2026-11-20" } },
      { name: "invoice_submit", who: "con", method: "POST", path: `/api/contractor-invoices/${INV}/submit`, body: {} },
      { name: "bid_award", who: "admin", method: "POST", path: `/api/contractor-job-bids/${BID}/award`, body: {}, headers: { "Idempotency-Key": `gate-${sfx}` } },
      { name: "proposal_create_admin", who: "admin", method: "POST", path: `/api/contractor-proposals`, body: { contractorId: c1.workerId, title: "Admin proposal", issueDate: "2026-11-20" } },
      { name: "proposal_accept", who: "admin", method: "POST", path: `/api/contractor-proposals/${PROP}/accept`, body: {} },
      { name: "proposal_request_signature", who: "admin", method: "POST", path: `/api/contractor-proposals/${PROP}/request-signature`, body: {} },
      { name: "proposal_convert_to_contract", who: "admin", method: "POST", path: `/api/contractor-proposals/${PROP}/convert-to-contract`, body: {} },
      { name: "proposal_convert_to_invoice", who: "admin", method: "POST", path: `/api/contractor-proposals/${PROP}/convert-to-invoice`, body: {} },
      { name: "contract_create", who: "admin", method: "POST", path: `/api/contractor-contracts`, body: { contractorId: c1.workerId, title: "Admin contract" } },
      { name: "contract_send", who: "admin", method: "POST", path: `/api/contractor-contracts/${CON}/send`, body: { reason: "manual" } },
      { name: "contract_send_for_signature", who: "admin", method: "POST", path: `/api/contractor-contracts/${CON}/send-for-signature`, body: {} },
      { name: "contract_activate", who: "admin", method: "POST", path: `/api/contractor-contracts/${CON}/activate`, body: { reason: "manual" } },
      { name: "invoice_from_proposal", who: "admin", method: "POST", path: `/api/contractor-invoices/from-proposal`, body: { proposalId: PROP } },
      { name: "invoice_approve", who: "admin", method: "POST", path: `/api/contractor-invoices/${INV}/approve`, body: { managerOverride: true } },
      { name: "invoice_payment", who: "admin", method: "POST", path: `/api/contractor-invoices/${INV}/payments`, body: { amount: "1", method: "check" }, headers: { "Idempotency-Key": `pay-${sfx}` } },
      { name: "invoice_cut_check", who: "admin", method: "POST", path: `/api/contractor-invoices/${INV}/cut-check`, body: {}, headers: { "Idempotency-Key": `chk-${sfx}` } },
      { name: "invoice_mark_paid", who: "admin", method: "POST", path: `/api/contractor-invoices/${INV}/mark-paid`, body: {} },
      { name: "invoice_checkout", who: "admin", method: "POST", path: `/api/contractor-invoices/${INV}/stripe-checkout-session`, body: {} },
      { name: "proposal_create_revision", who: "con", method: "POST", path: `/api/contractor-proposals/${PROP}/create-revision`, body: {} },
      { name: "proposal_negotiate", who: "con", method: "POST", path: `/api/contractor-proposals/${PROP}/negotiate`, body: { proposedAmount: "90", counterNotes: "x" } },
      { name: "invoice_request_override", who: "con", method: "POST", path: `/api/contractor-invoices/${INV}/request-override`, body: { overrideReason: "x" } },
      { name: "proposal_repair_contract", who: "admin", method: "POST", path: `/api/contractor-proposals/${PROP}/repair-contract`, body: {} },
      { name: "proposal_mark_negotiated", who: "admin", method: "POST", path: `/api/contractor-proposals/${PROP}/mark-negotiated`, body: {} },
      { name: "contract_reconcile_signing", who: "admin", method: "POST", path: `/api/contractor-contracts/${CON}/reconcile-signing`, body: {} },
      { name: "contract_resend_signing", who: "admin", method: "POST", path: `/api/contractor-contracts/${CON}/resend-signing-request`, body: {} },
      { name: "contract_replace_signing", who: "admin", method: "POST", path: `/api/contractor-contracts/${CON}/replace-signing-request`, body: {} },
      { name: "invoice_restore", who: "admin", method: "POST", path: `/api/contractor-invoices/${INV}/restore`, body: {} },
      { name: "payment_reissue", who: "admin", method: "POST", path: `/api/contractor-payments/${PAY}/reissue`, body: { reason: "x" }, headers: { "Idempotency-Key": `ri-${sfx}` } },
      { name: "proposal_negotiation_respond", who: "con", method: "PATCH", path: `/api/contractor-proposals/${PROP}/negotiations/${crypto.randomUUID()}`, body: { status: "accepted" } },
      { name: "contract_signer_resend", who: "admin", method: "POST", path: `/api/contractor-contracts/${CON}/signers/${crypto.randomUUID()}/resend`, body: {} },
      { name: "proposal_client_approve (portal)", who: "anon", method: "POST", path: `/api/portal/proposals/${PROP_SENT}/approve?token=${SHARE}`, body: { approvalName: "Client", approvalEmail: "client@example.invalid" } },
    ];
    check("40 gated actions on 39 routes under test (15 contractor, 24 administrator, 1 client portal)", ACTIONS.length === 40 && ACTIONS.filter((a) => a.who === "con").length === 15 && ACTIONS.filter((a) => a.who === "anon").length === 1, ACTIONS.length);
    const fire = (a: Act, dev?: Device) => {
      const d = dev ?? (a.who === "con" ? con1 : a.who === "anon" ? anon : adminA);
      return a.upload ? d.upload(a.path, pdf(), "quote.pdf", "application/pdf") : d.req(a.method, a.path, a.body, a.headers);
    };
    const denials: string[] = [];
    const isGateDenial = (x: { status: number; body: any; text: string }, code?: string) => {
      denials.push(x.text);
      return x.status === 403 && x.body?.code === GATE && Array.isArray(x.body.missing) && (!code || x.body.missing.includes(code))
        && Object.keys(x.body).sort().join(",") === "code,guidance,message,missing";
    };

    // ── 1/6/7/8. every unmet requirement blocks every action ────────────────
    const W = c1.workerId, O = c1.onboardingId;
    const BREAKS: [string, string, string, string][] = [
      ["worker inactive", "worker_status", `UPDATE workers SET status='inactive_temporary' WHERE id='${W}'`, `UPDATE workers SET status='active' WHERE id='${W}'`],
      ["worker moved to another company (same tenant)", "company_access", `UPDATE workers SET company_id='${co.A2}' WHERE id='${W}'`, `UPDATE workers SET company_id='${co.A}' WHERE id='${W}'`],
      ["worker moved to another tenant's company", "tenant_access", `UPDATE workers SET company_id='${co.B}' WHERE id='${W}'`, `UPDATE workers SET company_id='${co.A}' WHERE id='${W}'`],
      ["signed agreement revoked from private storage", "contractor_agreement", `UPDATE private_personnel_documents SET status='superseded' WHERE worker_id='${W}' AND document_kind='signed_contractor_agreement'`, `UPDATE private_personnel_documents SET status='active' WHERE worker_id='${W}' AND document_kind='signed_contractor_agreement'`],
      ["W-9 signature request voided (rejected)", "w9", `UPDATE documenso_signature_requests SET status='voided' WHERE company_id='${co.A}' AND document_type='contractor_onboarding_w9' AND related_record_id=(SELECT id FROM onboarding_steps WHERE onboarding_id='${O}' AND step_key='w9')`, `UPDATE documenso_signature_requests SET status='completed' WHERE company_id='${co.A}' AND document_type='contractor_onboarding_w9' AND related_record_id=(SELECT id FROM onboarding_steps WHERE onboarding_id='${O}' AND step_key='w9')`],
      ["government ID approval withdrawn", "government_id", `UPDATE onboarding_steps SET reviewed_by=NULL WHERE onboarding_id='${O}' AND step_key='government_id'`, `UPDATE onboarding_steps SET reviewed_by='${UID.adminA}' WHERE onboarding_id='${O}' AND step_key='government_id'`],
      ["emergency contact removed", "emergency_contact", `UPDATE employee_contacts SET contact_type='other' WHERE worker_id='${W}' AND contact_type='emergency'`, `UPDATE employee_contacts SET contact_type='emergency' WHERE worker_id='${W}' AND contact_type='other'`],
      ["unresolved review case (changes requested)", "review_pending", `UPDATE worker_onboarding SET status='changes_requested' WHERE id='${O}'`, `UPDATE worker_onboarding SET status='verified' WHERE id='${O}'`],
      ["checklist not in final verified state", "admin_review", `UPDATE onboarding_steps SET status='in_progress' WHERE onboarding_id='${O}' AND step_key='admin_review'`, `UPDATE onboarding_steps SET status='completed' WHERE onboarding_id='${O}' AND step_key='admin_review'`],
    ];
    let gateDenials = 0;
    const auditBefore = (await pool.query(`SELECT count(*)::int n FROM authorization_audit_log WHERE change_type='contractor_gate_denied' AND company_id = ANY($1)`, [companyIds])).rows[0].n;
    const fp0 = await fingerprint(co.A, [W, c2.workerId, legacyW]);
    console.log("\n— every unmet requirement blocks every gated action —");
    for (const [label, code, breakSql, restoreSql] of BREAKS) {
      await pool.query(breakSql);
      const bad: string[] = [];
      for (const a of ACTIONS) {
        const x = await fire(a);
        // An administrator naming a contractor who now sits in a company they cannot access gets the
        // non-revealing 404 (no gate details for a foreign contractor) — blocked, never processed.
        const named = a.name === "proposal_create_admin" || a.name === "contract_create";
        // The client portal gets a generic 409 with the gate code and NO step codes (outsiders never learn them).
        const portalOk = a.who === "anon" && x.status === 409 && x.body?.code === GATE && !("missing" in x.body) && Object.keys(x.body).sort().join(",") === "code,message";
        if (a.who === "anon") denials.push(x.text);
        const ok = portalOk || isGateDenial(x, code) || (named && (code === "company_access" || code === "tenant_access") && x.status === 404 && x.text === '{"message":"Contractor not found"}');
        if (ok && (x.status === 403 || portalOk)) gateDenials++;
        if (!ok) bad.push(`${a.name}:${x.status}:${x.text.slice(0, 80)}`);
      }
      await pool.query(restoreSql);
      check(`${label} → all ${ACTIONS.length} actions 403 ${code}`, bad.length === 0, bad);
    }
    console.log("\n— replayed completion markers do not unlock —");
    await pool.query(BREAKS[4][2]);
    await pool.query(`UPDATE onboarding_steps SET status='completed', completed_at=now() WHERE onboarding_id=$1 AND step_key='w9'`, [O]);
    const replayRow = (await pool.query(`INSERT INTO onboarding_audit_log (company_id, worker_id, onboarding_id, actor_type, event_type, after_json) VALUES ($1,$2,$3,'system','esign_completed','{"replay":true}') RETURNING id`, [co.A, W, O])).rows[0].id;
    r = await fire(ACTIONS[1]);
    check("step re-marked completed + duplicate esign_completed event, request still voided → still 403 w9", isGateDenial(r, "w9"), r.body);
    if (r.status === 403) gateDenials++;
    r = await adminA.req("POST", `/api/contractor-onboarding/${O}/review`, { decision: "approve", confirmIdVerified: true, confirmW9Reviewed: true, confirmationPhrase: "APPROVE ONBOARDING", note: NOTE, currentPassword: pw });
    check("replayed approval → already_verified (changes nothing)", r.body?.outcome === "already_verified", r.body);
    r = await fire(ACTIONS[1]);
    check("…and the gate is still closed", isGateDenial(r, "w9"), r.body);
    if (r.status === 403) gateDenials++;
    await pool.query(BREAKS[4][3]);
    await pool.query(`DELETE FROM onboarding_audit_log WHERE id=$1`, [replayRow]); // the simulated replay marker itself is test input, not residue

    const fp1 = await fingerprint(co.A, [W, c2.workerId, legacyW]);
    check(`denials left no residue (bids, proposals, contracts, invoices, payments, events, attachments, any company table)`, diffFp(fp0, fp1).length === 0, diffFp(fp0, fp1));
    const auditRows = (await pool.query(`SELECT actor_user_id, target_resource, after_value FROM authorization_audit_log WHERE change_type='contractor_gate_denied' AND company_id = ANY($1)`, [companyIds])).rows;
    check("every gate denial is audited (one row each)", auditRows.length - auditBefore === gateDenials && gateDenials >= BREAKS.length * ACTIONS.length - 4, [auditRows.length - auditBefore, gateDenials]);
    const badAudit = auditRows.filter((x: any) => { const v = JSON.parse(x.after_value); return !(Object.keys(v).sort().join(",") === "action,actor,missing" && Array.isArray(v.missing) && v.missing.every((m: string) => /^[a-z0-9_]+$/.test(m)) && /^worker:[0-9a-f-]{36}$/.test(x.target_resource)); });
    check("audit rows hold only action, actor kind, step codes and the worker id", badAudit.length === 0, badAudit[0]);

    console.log("\n— fully verified contractor proceeds; behaviour unchanged —");
    const notGated: string[] = [];
    const statuses: string[] = [];
    for (const a of ACTIONS) {
      const x = await fire(a);
      statuses.push(`${a.name}=${x.status}`);
      if (x.body?.code === GATE || x.body?.code === "CONTRACTOR_GATE_UNAVAILABLE") notGated.push(`${a.name}:${x.status}`);
    }
    console.log(`     (handler statuses for the verified contractor: ${statuses.join(" ")})`);
    check(`all ${ACTIONS.length} actions pass the gate for the verified contractor`, notGated.length === 0, notGated);
    check("verified contractor's bid was really edited/submitted by the existing service", (await pool.query(`SELECT status FROM contractor_job_bids WHERE id=$1`, [BID])).rows[0].status !== "draft");
    r = await con1.req("POST", "/api/contractor-invoices", { amount: "25", invoiceDate: "2026-11-21", contractorId: legacyW, tenantId: tB, workerId: legacyW, onboardingId: c2.onboardingId });
    check("verified contractor creates an invoice; body worker/tenant/onboarding ids are ignored", r.status === 201 && await (async () => { const x = (await pool.query(`SELECT contractor_id, company_id FROM contractor_invoices WHERE id=$1`, [r.body?.id])).rows[0]; return x?.contractor_id === W && x?.company_id === co.A; })(), r.body);
    r = await con1.req("POST", "/api/contractor-invoices", { amount: "25", invoiceDate: "2026-11-21", companyId: co.B });
    check("…a foreign companyId in the body is rejected, never applied", r.status === 403 && (await pool.query(`SELECT count(*)::int n FROM contractor_invoices WHERE company_id=$1`, [co.B])).rows[0].n === 0, r.body);

    // ── 2/3/4/5. identity, cross-company, cross-tenant, direct API ───────────
    console.log("\n— identity overrides, cross-company and cross-tenant —");
    const legacyInvoicesBefore = (await pool.query(`SELECT count(*)::int n FROM contractor_invoices WHERE contractor_id = ANY($1)`, [[W, legacyW]])).rows[0].n;
    r = await legacy.req("POST", "/api/contractor-invoices", { amount: "10", invoiceDate: "2026-11-20", contractorId: W, companyId: co.A });
    check("legacy contractor (no onboarding) naming the verified contractor in the body → 403 onboarding_not_started", isGateDenial(r, "onboarding_not_started"), r.body);
    r = await legacy.req("POST", `/api/job-posts/${postA2}/bids`, { scopeAndDeliverables: "S", estimatedHours: 1, proposedAmount: "1", contractorId: W, workerId: W });
    check("…bid with someone else's worker id → 403 for the session contractor", isGateDenial(r, "onboarding_not_started"), r.body);
    check("…nothing created for either contractor", (await pool.query(`SELECT count(*)::int n FROM contractor_invoices WHERE contractor_id = ANY($1)`, [[W, legacyW]])).rows[0].n === legacyInvoicesBefore);
    await pool.query(`UPDATE users SET company_id=$1 WHERE id=$2`, [co.A2, UID.con1]);
    const con1b = await login("con1");
    r = await con1b.req("POST", "/api/contractor-invoices", { amount: "10", invoiceDate: "2026-11-20" });
    check("session company differs from the contractor's company → 403 company_access", isGateDenial(r, "company_access") || (r.status === 403 && r.body?.code !== undefined && r.body?.code !== GATE), r.body);
    await pool.query(`UPDATE users SET company_id=$1 WHERE id=$2`, [co.A, UID.con1]);
    r = await con1.req("POST", `/api/job-posts/${postB}/bids`, { scopeAndDeliverables: "S", estimatedHours: 1, proposedAmount: "1" });
    check("verified contractor of A cannot bid on company B's posting (other tenant) → 404", r.status === 404, [r.status, r.text.slice(0, 120)]);
    r = await adminB.req("POST", `/api/contractor-job-bids/${BID}/award`, {}, { "Idempotency-Key": `x-${sfx}` });
    check("company B admin cannot award A's bid → 404, no gate details leaked", r.status === 404 && !("missing" in (r.body ?? {})), [r.status, r.text]);
    r = await adminB.req("POST", "/api/contractor-contracts", { contractorId: W, title: "Cross-tenant contract" });
    check("company B admin naming A's contractor → 404 (no contract created)", r.status === 404 && (await pool.query(`SELECT count(*)::int n FROM contractor_contracts WHERE contractor_id=$1 AND company_id=$2`, [W, co.B])).rows[0].n === 0, [r.status, r.text]);
    r = await adminB.req("POST", "/api/contractor-contracts", { contractorId: W, title: "Cross-tenant contract", companyId: co.B });
    check("…even with companyId = B in the body → 404", r.status === 404, [r.status, r.text]);
    r = await adminB.req("GET", `/api/contractor-proposals/${PROP}`);
    check("company B admin cannot read A's proposal", r.status === 403 || r.status === 404, r.status);

    console.log("\n— direct API cannot bypass; unverified contractors —");
    r = await adminA.req("POST", "/api/contractor-proposals", { contractorId: c2.workerId, title: "For an unverified contractor", issueDate: "2026-11-20" });
    check("admin cannot create a proposal for an unverified contractor → 403 with step codes", isGateDenial(r, "admin_review") && r.body.missing.includes("w9"), r.body);
    r = await adminA.req("POST", "/api/contractor-contracts", { contractorId: legacyW, title: "Legacy contract" });
    check("admin cannot open a contract for a legacy contractor → 403 onboarding_not_started", isGateDenial(r, "onboarding_not_started"), r.body);
    const legacyBid = (await pool.query(`INSERT INTO contractor_job_bids (tenant_id, company_id, job_post_id, contractor_id, submitted_by_user_id, status, scope_and_deliverables, proposed_amount, revision_number, submitted_at)
       VALUES ($1,$2,$3,$4,$5,'submitted','S',10,1,now()) RETURNING id`, [tA, co.A, postA2, legacyW, UID.legacy])).rows[0].id;
    const propsBefore = (await pool.query(`SELECT count(*)::int n FROM contractor_proposals WHERE contractor_id=$1`, [legacyW])).rows[0].n;
    r = await adminA.req("POST", `/api/contractor-job-bids/${legacyBid}/award`, {}, { "Idempotency-Key": `legacy-${sfx}` });
    check("admin cannot award a pre-existing bid of an unverified contractor → 403, no proposal", isGateDenial(r, "onboarding_not_started") && (await pool.query(`SELECT count(*)::int n FROM contractor_proposals WHERE contractor_id=$1`, [legacyW])).rows[0].n === propsBefore
      && (await pool.query(`SELECT status FROM contractor_job_bids WHERE id=$1`, [legacyBid])).rows[0].status === "submitted", r.body);
    const legacyInv = (await pool.query(`INSERT INTO contractor_invoices (company_id, contractor_id, invoice_number, invoice_date, amount, status) VALUES ($1,$2,$3,'2026-11-20',50,'approved') RETURNING id`, [co.A, legacyW, `INV-LG-${sfx}`])).rows[0].id;
    r = await adminA.req("POST", `/api/contractor-invoices/${legacyInv}/payments`, { amount: "50", method: "check" }, { "Idempotency-Key": `lp-${sfx}` });
    check("admin cannot pay a legacy contractor's invoice → 403, no payment row", isGateDenial(r, "onboarding_not_started") && (await pool.query(`SELECT count(*)::int n FROM contractor_payments WHERE invoice_id=$1`, [legacyInv])).rows[0].n === 0, r.body);

    // ── contract progression outside the core families (isolated company L) ──
    console.log("\n— public signing link, send-signing-email, batch repair/backfill —");
    await mkCompany("L", tA, false);
    await mkUser("adminL", "admin", co.L);
    const adminL = await login("adminL");
    const wL = await mkWorker(co.L, "contractor", "LegacyL");
    const invCountL = async () => (await pool.query(`SELECT count(*)::int n FROM contractor_invoices WHERE contractor_id=$1 OR company_id=$2`, [wL, co.L])).rows[0].n;
    const conCountL = async () => (await pool.query(`SELECT count(*)::int n FROM contractor_contracts WHERE contractor_id=$1 OR company_id=$2`, [wL, co.L])).rows[0].n;
    const CONL = (await pool.query(`INSERT INTO contractor_contracts (company_id, contractor_id, contract_number, title, status, total_value) VALUES ($1,$2,$3,'ZZ legacy sent','sent',75) RETURNING id`, [co.L, wL, `CON-LS-${sfx}`])).rows[0].id;
    const TOKL = crypto.randomBytes(32).toString("base64url");
    const SIGNL = (await pool.query(`INSERT INTO contract_signers (contract_id, company_id, contractor_id, name, email, role, status, signing_token_hash, signing_token_expires_at)
       VALUES ($1,$2,$3,'ZZ Signer','signer-${sfx}@example.invalid','contractor','sent',$4, now() + interval '1 day') RETURNING id`, [CONL, co.L, wL, crypto.createHash("sha256").update(TOKL).digest("hex")])).rows[0].id;
    const invL0 = await invCountL(), conL0 = await conCountL();
    for (const p of ["/api/public/sign/contracts", "/api/signing/contracts"]) {
      r = await anon.req("POST", `${p}/${TOKL}/complete`, { signatureData: "data:image/png;base64,AA" });
      check(`${p}/:token/complete for an unverified contractor → 409 generic (no step codes)`, r.status === 409 && r.body?.code === GATE && Object.keys(r.body).sort().join(",") === "code,message", [r.status, r.text.slice(0, 160)]);
      denials.push(r.text);
    }
    const sl = (await pool.query(`SELECT s.status s, s.signed_at, s.signature_data, c.status c FROM contract_signers s JOIN contractor_contracts c ON c.id=s.contract_id WHERE s.id=$1`, [SIGNL])).rows[0];
    check("…signer not signed, contract not progressed, no invoice", sl.s === "sent" && !sl.signed_at && !sl.signature_data && sl.c === "sent" && (await invCountL()) === invL0, sl);
    const hashBefore = (await pool.query(`SELECT signing_token_hash h FROM contract_signers WHERE id=$1`, [SIGNL])).rows[0].h;
    r = await adminL.req("POST", `/api/contractor-hub/contracts/${CONL}/send-signing-email`, {});
    check("send-signing-email for an unverified contractor → 403 onboarding_not_started, token not reissued", isGateDenial(r, "onboarding_not_started")
      && (await pool.query(`SELECT signing_token_hash h, status FROM contract_signers WHERE id=$1`, [SIGNL])).rows[0].h === hashBefore, r.body);
    const PROPL = (await pool.query(`INSERT INTO contractor_proposals (company_id, contractor_id, proposal_number, title, issue_date, status, amount, subtotal) VALUES ($1,$2,$3,'ZZ legacy approved','2026-11-20','approved',60,60) RETURNING id`, [co.L, wL, `CP-LA-${sfx}`])).rows[0].id;
    const PROPL2 = (await pool.query(`INSERT INTO contractor_proposals (company_id, contractor_id, proposal_number, title, issue_date, status, amount, subtotal) VALUES ($1,$2,$3,'ZZ legacy signed','2026-11-20','sent',40,40) RETURNING id`, [co.L, wL, `CP-LF-${sfx}`])).rows[0].id;
    await pool.query(`INSERT INTO contractor_contracts (company_id, contractor_id, proposal_id, contract_number, title, status, total_value, fully_signed_at) VALUES ($1,$2,$3,$4,'ZZ legacy fully signed','fully_signed',40,now())`, [co.L, wL, PROPL2, `CON-LF-${sfx}`]);
    const conL1 = await conCountL();
    r = await adminL.req("POST", "/api/contractor-hub/repair-proposal-contracts", {});
    check("batch repair skips the unverified contractor's approved proposal (no contract)", r.status === 200 && (r.body?.skipped ?? []).some((x: any) => x.proposalId === PROPL && x.reason === "contractor_onboarding_incomplete")
      && !(r.body?.repaired ?? []).some((x: any) => x.proposalId === PROPL) && (await conCountL()) === conL1, [r.status, r.text.slice(0, 200)]);
    r = await adminL.req("POST", "/api/contractor-hub/backfill-documents", {});
    check("backfill creates no contract and no invoice for the unverified contractor", r.status === 200 && r.body?.gateSkipped >= 2 && r.body?.orphanContracts === 0 && r.body?.orphanInvoices === 0
      && (await conCountL()) === conL1 && (await invCountL()) === invL0, [r.status, r.text.slice(0, 240)]);
    check("…and nothing new was created in company L beyond the test's own fixtures", (await conCountL()) === conL0 + 1);

    console.log("\n— unresolved review case (real API) —");
    await seedSigned(c2, co.A, "w9", "contractor_onboarding_w9", "signed_w9");
    r = await adminA.req("POST", `/api/contractor-onboarding/${c2.onboardingId}/review`, { decision: "request_changes", step: "w9", note: "Line 3 is wrong" });
    check("admin requests changes on c2's W-9", r.body?.outcome === "changes_requested", r.body);
    r = await con2.req("POST", "/api/contractor-invoices", { amount: "10", invoiceDate: "2026-11-20" });
    check("c2 is blocked with review_pending + w9, and the reviewer's note is not echoed", isGateDenial(r, "review_pending") && r.body.missing.includes("w9") && !r.text.includes("Line 3"), r.body);
    const g1 = await con2.req("POST", `/api/job-posts/${postA2}/bids`, { scopeAndDeliverables: "S", estimatedHours: 1, proposedAmount: "1" });
    const g2 = await con2.req("POST", `/api/job-posts/${postA2}/bids`, { scopeAndDeliverables: "S", estimatedHours: 1, proposedAmount: "1" });
    check("repeated checks are deterministic (same codes) and read-only", g1.text === g2.text && isGateDenial(g1) && (await pool.query(`SELECT status FROM worker_onboarding WHERE id=$1`, [c2.onboardingId])).rows[0].status === "changes_requested");

    console.log("\n— employee applications stay separate —");
    r = await emp.req("POST", `/api/job-posts/${empPost}/applications`, { coverMessage: "Hello" });
    check("an employee applies to an employee position → 201 (no contractor gate)", r.status === 201, [r.status, r.text.slice(0, 160)]);
    r = await legacy.req("POST", `/api/job-posts/${empPost}/applications`, { coverMessage: "Hi" });
    check("an unverified contractor's employee application is not routed through the contractor gate", r.body?.code !== GATE && r.status !== 403, [r.status, r.text.slice(0, 160)]);
    r = await emp.req("POST", "/api/contractor-invoices", { amount: "10", invoiceDate: "2026-11-20" });
    check("an employee is refused by the existing contractor check, not the onboarding gate", r.status === 403 && r.body?.code !== GATE, r.body);
    r = await emp.req("POST", `/api/job-posts/${postA2}/bids`, { scopeAndDeliverables: "S", estimatedHours: 1, proposedAmount: "1" });
    check("…and cannot bid (existing rule), again without gate codes", r.status === 403 && r.body?.code !== GATE, r.body);

    console.log("\n— nothing sensitive in denials, logs or audit —");
    const sensitive = [NOTE, "Line 3", "Rae Contact", "555 010 7777", "@example.test", "Vera", "Verified", "Uma", "env_", "front.jpg", "ciphertext", pw];
    const leakIn = (txt: string) => sensitive.filter((s) => txt.includes(s));
    check("denial bodies contain no names, emails, notes, contact, document or tax values", denials.every((t) => leakIn(t).length === 0), denials.map(leakIn).find((l) => l.length));
    const auditAll = JSON.stringify((await pool.query(`SELECT * FROM authorization_audit_log WHERE change_type='contractor_gate_denied' AND company_id = ANY($1)`, [companyIds])).rows);
    check("gate audit rows contain no sensitive values", leakIn(auditAll).length === 0, leakIn(auditAll));
    const log = server.output();
    check("server log holds no notes, contact values or password", log.length > 0 && [NOTE, "Line 3", "Rae Contact", "555 010 7777", pw].every((s) => !log.includes(s)));

    // ── tenant-mapping matrix (regression for the unmapped-company correction) ──
    // Company ownership is always enforced; a missing tenant mapping never grants
    // cross-company access; two unmapped companies are never the same tenant.
    console.log("\n— tenant-mapping matrix —");
    const { evaluateContractorGate } = await import("../server/contractor-onboarding/gate");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { markContractorOnboardingVerified } = await import("./__fixtures__/verified-contractor");
    const gx = drizzle(pool);
    const mkUnmapped = async (key: string) => {
      const c = crypto.randomUUID(); co[key] = c; companyIds.push(c);
      await pool.query(`INSERT INTO companies (id, name, subscription_status) VALUES ($1,$2,'active')`, [c, `ZZ GATE ${key} ${sfx}`]);
    };
    await mkUnmapped("U1"); await mkUnmapped("U2");
    check("U1/U2 really have no tenant mapping", (await pool.query(`SELECT count(*)::int n FROM tenant_companies WHERE company_id = ANY($1)`, [[co.U1, co.U2]])).rows[0].n === 0);
    const wU1 = await mkWorker(co.U1, "contractor", "Unmapped");
    await markContractorOnboardingVerified(pool, { companyId: co.U1, workerId: wU1 });
    const ev = (workerId: string, companyId: string, sessionCompanyId?: string | null) => evaluateContractorGate(gx, { workerId, companyId, sessionCompanyId });
    const denies = (g: { allowed: boolean; missing: string[] }, ...codes: string[]) => !g.allowed && codes.every((c) => g.missing.includes(c));
    let g = await ev(wU1, co.U1);
    check("same company without tenant mapping (admin path) → allowed", g.allowed && g.missing.length === 0, g);
    g = await ev(wU1, co.U1, co.U1);
    check("same company without tenant mapping (self path) → allowed", g.allowed, g);
    g = await ev(wU1, co.U2);
    check("different companies, both unmapped → company_access + tenant_access", denies(g, "company_access", "tenant_access"), g);
    g = await ev(wU1, co.U1, co.U2);
    check("unmapped contractor whose session company is another unmapped company → company_access + tenant_access", denies(g, "company_access", "tenant_access"), g);
    g = await ev(c1.workerId, co.A2);
    check("different companies sharing a tenant → company_access (tenant matches, ownership still enforced)", denies(g, "company_access") && !g.missing.includes("tenant_access"), g);
    g = await ev(c1.workerId, co.B);
    check("different tenants → company_access + tenant_access", denies(g, "company_access", "tenant_access"), g);
    g = await ev(c1.workerId, co.U1);
    check("mapped contractor acting in an unmapped company → company_access + tenant_access", denies(g, "company_access", "tenant_access"), g);
    g = await ev(wU1, co.A);
    check("unmapped contractor acting in a mapped company → company_access + tenant_access", denies(g, "company_access", "tenant_access"), g);
    g = await ev(c1.workerId, co.A);
    check("…the verified mapped contractor in its own company is still allowed", g.allowed, g);

    // Forged ids over HTTP from an unmapped company's verified contractor.
    await mkUser("conU1", "contractor", co.U1, wU1);
    const conU1 = await login("conU1");
    const invBefore = (await pool.query(`SELECT count(*)::int n FROM contractor_invoices WHERE company_id = ANY($1) OR contractor_id = ANY($2)`, [[co.A, co.U2], [c1.workerId]])).rows[0].n;
    r = await conU1.req("POST", "/api/contractor-invoices", { amount: "10", invoiceDate: "2026-11-21", contractorId: c1.workerId, workerId: c1.workerId, companyId: co.U2, tenantId: tA, onboardingId: c1.onboardingId });
    check("forged companyId (another unmapped company) + forged worker id → 403", r.status === 403, [r.status, r.text.slice(0, 160)]);
    r = await conU1.req("POST", "/api/contractor-invoices", { amount: "10", invoiceDate: "2026-11-21", contractorId: c1.workerId, workerId: c1.workerId, companyId: co.A });
    check("forged companyId (a mapped company) + forged worker id → 403", r.status === 403, [r.status, r.text.slice(0, 160)]);
    check("…no invoice created for the forged company or worker", (await pool.query(`SELECT count(*)::int n FROM contractor_invoices WHERE company_id = ANY($1) OR contractor_id = ANY($2)`, [[co.A, co.U2], [c1.workerId]])).rows[0].n === invBefore);
    r = await conU1.req("POST", "/api/contractor-invoices", { amount: "10", invoiceDate: "2026-11-21", contractorId: c1.workerId, workerId: c1.workerId });
    const own = r.status === 201 ? (await pool.query(`SELECT contractor_id, company_id FROM contractor_invoices WHERE id=$1`, [r.body?.id])).rows[0] : undefined;
    check("unmapped verified contractor in its own company: invoice is bound to the session worker + company, body ids ignored", own?.contractor_id === wU1 && own?.company_id === co.U1, [r.status, own]);
  } finally {
    if (server) await server.stop();
    const workers = (await pool.query(`SELECT id FROM workers WHERE company_id = ANY($1)`, [companyIds])).rows.map((x: any) => x.id);
    const moreUsers = (await pool.query(`SELECT id FROM users WHERE worker_id = ANY($1) OR company_id = ANY($2)`, [workers, companyIds])).rows.map((x: any) => x.id);
    const allUsers = [...new Set([...userIds, ...moreUsers])];
    await pool.query(`DELETE FROM session WHERE sess->>'userId' = ANY($1)`, [allUsers]).catch(() => {});
    // Each query gets exactly the parameters it references (an unreferenced $n makes Postgres reject the whole statement).
    for (const [q, params] of [
      [`DELETE FROM employee_contacts WHERE worker_id = ANY($1)`, [workers]],
      [`DELETE FROM private_document_access_log WHERE company_id = ANY($1)`, [companyIds]],
      [`DELETE FROM private_personnel_documents WHERE company_id = ANY($1)`, [companyIds]],
      [`DELETE FROM documenso_signature_requests WHERE company_id = ANY($1)`, [companyIds]],
      [`DELETE FROM onboarding_audit_log WHERE company_id = ANY($1)`, [companyIds]],
      [`DELETE FROM onboarding_steps WHERE company_id = ANY($1)`, [companyIds]],
      [`DELETE FROM worker_onboarding WHERE company_id = ANY($1)`, [companyIds]],
      [`DELETE FROM authorization_audit_log WHERE company_id = ANY($1) OR actor_user_id = ANY($2)`, [companyIds, allUsers]],
      [`DELETE FROM employee_number_counters WHERE company_id = ANY($1)`, [companyIds]],
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
    fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(jobDir, { recursive: true, force: true });
    check("zero fixture residue", residue.length === 0 && !fs.existsSync(dir), residue);
    await pool.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
