/**
 * Private uploads — end to end against the real server and a disposable DB.
 *
 * Real server/index.ts, real login sessions (connect-pg-simple), real
 * ownership registry SQL over real fixture rows, real files under uploads/.
 * Proves the original exposure (anonymous GET /uploads/<W-9>) is gone, the
 * registry resolves owners across the actual schema (relative, legacy and
 * absolute-URL reference forms, text[] screenshot paths), tenant / company /
 * document-level isolation, session expiry & revocation, public logos, and
 * that the DocuSign proposal flow delivers the PDF bytes without any request
 * to /uploads (a local fake DocuSign endpoint captures the envelope).
 *
 * Synthetic fixtures only. Same safety conventions as the rest of the db suite.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable_db npx tsx tests/private-uploads-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import bcrypt from "bcrypt";
import { startTestServer, login, apiRequest, type Session } from "../scripts/cross-tenant-negative-tests/server-harness";
import { cascadeDelete, verifyZeroResidue } from "../scripts/cross-tenant-negative-tests/cascade-cleanup";

const FORBIDDEN_PATTERNS = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];

let passed = 0;
let failed = 0;
const errors: string[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✓  ${name}`); passed++; }
  else { console.error(`  ✗  ${name}${detail ? ` — ${detail}` : ""}`); errors.push(name); failed++; }
}

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

async function main() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    console.log("TEST_DATABASE_URL not set — skipping private-uploads db tests (0 run).");
    return;
  }
  for (const p of FORBIDDEN_PATTERNS) {
    if (p.test(testDatabaseUrl)) throw new Error("TEST_DATABASE_URL looks like staging/production. Refusing to run.");
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is identical to DATABASE_URL. Refusing.");
  }

  const pool = new Pool({ connectionString: testDatabaseUrl, max: 6 });
  const companyIds: string[] = [];
  const userIds: string[] = [];
  const sfx = crypto.randomBytes(4).toString("hex");
  const dirName = `pu-${sfx}`;
  const dir = path.join(UPLOAD_DIR, dirName);
  let server: Awaited<ReturnType<typeof startTestServer>> | undefined;
  let fakeDocuSign: http.Server | undefined;

  try {
    const dbName = (await pool.query("SELECT current_database() AS n")).rows[0]?.n as string;
    if (FORBIDDEN_PATTERNS.some((p) => p.test(dbName))) throw new Error(`current_database()="${dbName}" looks protected. Refusing.`);

    // Boot first: feedback_tickets and the session table are created by server boot DDL.
    server = await startTestServer(testDatabaseUrl);

    // ── Files on disk ──
    fs.mkdirSync(path.join(dir, "signed"), { recursive: true });
    const file = (name: string, body = `BODY:${name}`) => { fs.writeFileSync(path.join(dir, name), body); return `/uploads/${dirName}/${name}`; };
    const w9 = file("w9-cA.pdf");
    const workerDoc = file("workerdoc-eA.pdf");
    const signed = file("signed/agreement-cA.pdf");
    const coBDam = file("coB-dam.pdf");
    const logoA = file("logoA.png");
    const logoB = file("logoB.png");
    const photoId = file("photo-id-eA.png");
    const handbook = file("handbook.pdf");
    const completed = file("completed-signed.pdf");
    const screenshot = file("shot.png");
    const orphan = file("orphan.pdf");
    const rerefTarget = file("reref-eA.pdf");
    const legacyForm = file("legacy-form.pdf");
    fs.writeFileSync(path.join(process.cwd(), `pu-outside-${sfx}.pdf`), "OUTSIDE SECRET");
    fs.symlinkSync(path.join(process.cwd(), `pu-outside-${sfx}.pdf`), path.join(dir, "escape.pdf"));
    const escape = `/uploads/${dirName}/escape.pdf`;

    // ── Fixtures ──
    const coA = crypto.randomUUID(), coB = crypto.randomUUID();
    companyIds.push(coA, coB);
    await pool.query(`INSERT INTO companies (id, name, logo_url) VALUES ($1,$2,$3),($4,$5,$6)`,
      [coA, `PU Co A ${sfx}`, logoA, coB, `PU Co B ${sfx}`, `https://mypaylink.app${logoB}?v=3`]);
    const wC = crypto.randomUUID(), wC2 = crypto.randomUUID(), wE = crypto.randomUUID(), wE2 = crypto.randomUUID(), wB = crypto.randomUUID();
    await pool.query(
      `INSERT INTO workers (id, company_id, first_name, last_name, worker_type, pay_rate, email) VALUES
        ($1,$6,'Cee','Contractor','contractor',0,$7),
        ($2,$6,'Cee2','Contractor','contractor',0,NULL),
        ($3,$6,'Eee','Employee','employee',0,NULL),
        ($4,$6,'Eee2','Employee','employee',0,NULL),
        ($5,$8,'Bee','Contractor','contractor',0,NULL)`,
      [wC, wC2, wE, wE2, wB, coA, `contractor-${sfx}@example.test`, coB],
    );

    const pw = crypto.randomBytes(10).toString("hex");
    const pwHash = await bcrypt.hash(pw, 10);
    const U: Record<string, { id: string; username: string; role: string; companyId: string | null; workerId: string | null }> = {};
    const mk = (key: string, role: string, companyId: string | null, workerId: string | null) => {
      U[key] = { id: crypto.randomUUID(), username: `pu_${key}_${sfx}`, role, companyId, workerId };
      userIds.push(U[key].id);
    };
    mk("adminA", "admin", coA, null);
    mk("supervisorA", "supervisor", coA, null);
    mk("adminB", "admin", coB, null);
    mk("contractorA", "contractor", coA, wC);
    mk("contractorA2", "contractor", coA, wC2);
    mk("employeeA", "employee", coA, wE);
    mk("employeeA2", "employee", coA, wE2);
    mk("platformAdmin", "platform_super_admin", null, null);
    mk("platformSupport", "platform_support", null, null);
    for (const u of Object.values(U)) {
      await pool.query(`INSERT INTO users (id, username, password, role, company_id, worker_id, is_active) VALUES ($1,$2,$3,$4,$5,$6,true)`,
        [u.id, u.username, pwHash, u.role, u.companyId, u.workerId]);
    }

    await pool.query(`INSERT INTO contractor_documents (company_id, worker_id, document_type, file_name, file_url, uploaded_by) VALUES ($1,$2,'w9','w9.pdf',$3,$4)`,
      [coA, wC, w9, U.adminA.id]);
    await pool.query(`INSERT INTO worker_documents (worker_id, name, file_url) VALUES ($1,'Doc',$2),($1,'Photo ID',$3),($1,'Reref',$4)`,
      [wE, workerDoc, photoId, rerefTarget]);
    // A logo column pointed at the employee's photo-ID scan must not make it public.
    await pool.query(`INSERT INTO contractor_branding (worker_id, logo_url) VALUES ($1,$2)`, [wC2, photoId]);
    await pool.query(`INSERT INTO contractor_contracts (id, company_id, contractor_id, contract_number, title, status, signed_pdf_path) VALUES ($1,$2,$3,$4,'Agreement','fully_signed',$5)`,
      [crypto.randomUUID(), coA, wC, `PU-${sfx}`, signed]);
    await pool.query(`INSERT INTO dam_documents (company_id, owner_type, document_type, title, file_path, file_name) VALUES ($1,'company','general','B doc',$2,'b.pdf')`,
      [coB, coBDam]);
    // Re-referencing attack: employeeA2 files their own DAM record pointing at employeeA's document.
    await pool.query(`INSERT INTO dam_documents (company_id, owner_type, document_type, title, file_path, file_name, uploaded_by_user_id) VALUES ($1,'company','general','mine',$2,'x.pdf',$3)`,
      [coA, rerefTarget, U.employeeA2.id]);
    await pool.query(`INSERT INTO documents (company_id, title, file_name, file_url, documenso_completed_pdf_url) VALUES ($1,'Handbook','h.pdf',$2,$3)`,
      [coA, handbook, completed]);
    await pool.query(`INSERT INTO system_documents (title, file_url) VALUES ($1,$2)`, [`PU form ${sfx}`, legacyForm.replace(/^\//, "")]);
    await pool.query(`INSERT INTO feedback_tickets (company_id, submitter_user_id, submitter_name, type, title, description, screenshot_paths) VALUES ($1,$2,'E','bug','t','d',ARRAY[$3]::text[])`,
      [coA, U.employeeA.id, screenshot]);

    const base = server.baseUrl;
    const S: Record<string, Session> = {};
    for (const [k, u] of Object.entries(U)) S[k] = await login(base, u.username, pw);

    const get = async (p: string, s?: Session | null) => {
      const res = await fetch(`${base}${p}`, { headers: s ? { cookie: s.cookie } : {}, redirect: "manual" });
      return { status: res.status, body: await res.text(), headers: res.headers };
    };
    // fetch() applies WHATWG dot-segment normalization ("/uploads/%2e%2e/x" → "/x"), so
    // traversal probes go out raw to make sure the encoded form reaches the server.
    const rawGet = (p: string, s?: Session | null) => new Promise<{ status: number; body: string }>((resolve, reject) => {
      const u = new URL(base);
      const req = http.request({ hostname: u.hostname, port: u.port, path: p, headers: s ? { cookie: s.cookie } : {} }, (res) => {
        let body = ""; res.on("data", (c) => (body += c)); res.on("end", () => resolve({ status: res.statusCode!, body }));
      });
      req.on("error", reject); req.end();
    });

    console.log("\nOriginal exposure closed (anonymous)");
    for (const [label, p] of [["contractor W-9", w9], ["worker document", workerDoc], ["signed contract", signed], ["tenant-B DAM", coBDam], ["feedback screenshot", screenshot]] as const) {
      const r = await get(p);
      check(`anonymous ${label} → 401, no body`, r.status === 401 && !r.body.includes("BODY:"), `${r.status}`);
    }
    check("anonymous orphan → 401", (await get(orphan)).status === 401);

    console.log("\nAuthorized downloads via the real registry");
    let r = await get(w9, S.adminA);
    check("admin A downloads contractor W-9", r.status === 200 && r.body === "BODY:w9-cA.pdf", `${r.status}`);
    check("…served no-store", (r.headers.get("cache-control") || "").includes("no-store"));
    check("contractor downloads own W-9", (await get(w9, S.contractorA)).status === 200);
    check("contractor downloads own signed agreement (signed/ subdir)", (await get(signed, S.contractorA)).status === 200);
    check("employee downloads own worker document", (await get(workerDoc, S.employeeA)).status === 200);
    check("supervisor downloads staff-tier company document", (await get(handbook, S.supervisorA)).status === 200);
    check("admin downloads Documenso completed PDF (documents.documenso_completed_pdf_url)", (await get(completed, S.adminA)).status === 200);
    check("submitter downloads own feedback screenshot (text[] column)", (await get(screenshot, S.employeeA)).status === 200);
    check("legacy 'uploads/…' reference form resolves (system document, any signed-in user)", (await get(legacyForm, S.employeeA2)).status === 200);
    check("platform super admin downloads tenant-B file", (await get(coBDam, S.platformAdmin)).status === 200);

    console.log("\nIsolation");
    check("tenant-B admin → 404 for tenant-A W-9", (await get(w9, S.adminB)).status === 404);
    check("tenant-A admin → 404 for tenant-B file", (await get(coBDam, S.adminA)).status === 404);
    check("other contractor (same company) → 404 for W-9", (await get(w9, S.contractorA2)).status === 404);
    check("employee → 404 for contractor W-9", (await get(w9, S.employeeA)).status === 404);
    check("other employee → 404 for worker document", (await get(workerDoc, S.employeeA2)).status === 404);
    check("supervisor → 404 for restricted W-9", (await get(w9, S.supervisorA)).status === 404);
    check("plain employee → 404 for staff-tier document", (await get(handbook, S.employeeA)).status === 404);
    check("other employee → 404 for feedback screenshot", (await get(screenshot, S.employeeA2)).status === 404);
    check("platform_support → 404 (no broad bypass)", (await get(coBDam, S.platformSupport)).status === 404);
    check("re-referencing attacker → 404", (await get(rerefTarget, S.employeeA2)).status === 404);
    check("orphan file → 404 for platform admin (unknown ownership fails closed)", (await get(orphan, S.platformAdmin)).status === 404);

    console.log("\nPublic logos");
    r = await get(logoA);
    check("company A logo (relative reference) public", r.status === 200 && (r.headers.get("cache-control") || "").startsWith("public"));
    check("company B logo (absolute URL + query reference) public", (await get(logoB)).status === 200);
    r = await get(photoId);
    check("photo-ID referenced by a logo column AND worker_documents → 401 anonymously", r.status === 401 && !r.body.includes("BODY:"));
    check("…404 for the contractor whose branding points at it", (await get(photoId, S.contractorA2)).status === 404);
    check("…subject employee still reads it", (await get(photoId, S.employeeA)).status === 200);

    console.log("\nTraversal / symlink");
    await pool.query(`INSERT INTO dam_documents (company_id, owner_type, document_type, title, file_path, file_name) VALUES ($1,'company','general','esc',$2,'e.pdf')`, [coA, escape]);
    r = await get(escape, S.adminA);
    check("DB-referenced symlink escaping the root → 404", r.status === 404 && !r.body.includes("SECRET"));
    for (const p of [`/uploads/${dirName}/..%2f..%2fpackage.json`, `/uploads/%2e%2e/package.json`, `/uploads/${dirName}/%2e%2e%2f%2e%2e%2fpu-outside-${sfx}.pdf`]) {
      const t = await rawGet(p, S.platformAdmin);
      check(`traversal ${p.slice(0, 50)} → 404`, t.status === 404 && t.body === "Not found", `${t.status}`);
    }

    console.log("\nSession expiry and revocation");
    const exp = await login(base, U.adminA.username, pw);
    check("fresh session works", (await get(w9, exp)).status === 200);
    const sid = decodeURIComponent(exp.cookie.split("=")[1]).replace(/^s:/, "").split(".")[0];
    // express-session touch()es the store asynchronously after a response; let it land
    // first so it cannot re-extend the expiry we force below.
    await new Promise((res) => setTimeout(res, 500));
    const expired = await pool.query(`UPDATE session SET expire = NOW() - INTERVAL '1 minute' WHERE sid = $1`, [sid]);
    check("session row located for expiry", expired.rowCount === 1, `sid rows=${expired.rowCount}`);
    check("expired session (store expiry passed) → 401", (await get(w9, exp)).status === 401);
    const out = await login(base, U.adminA.username, pw);
    await apiRequest(base, "POST", "/api/auth/logout", out);
    check("logged-out session → 401", (await get(w9, out)).status === 401);
    await pool.query(`UPDATE users SET is_active = false WHERE id = $1`, [U.contractorA.id]);
    check("deactivated user's existing session → 401", (await get(w9, S.contractorA)).status === 401);
    await pool.query(`UPDATE users SET is_active = true WHERE id = $1`, [U.contractorA.id]);

    console.log("\nExisting authorized workflows still work");
    const list = await apiRequest(base, "GET", `/api/contractor-documents?companyId=${coA}&workerId=${wC}`, S.adminA);
    const listed = Array.isArray(list.body) ? (list.body as any[]) : [];
    const listedUrl = listed.find((d) => d.fileUrl === w9 || d.file_url === w9);
    check("contractor-documents API still lists the W-9 with its /uploads URL", list.status === 200 && !!listedUrl, `${list.status}`);
    check("…and that URL downloads for the same admin session", (await get(w9, S.adminA)).status === 200);

    console.log("\nDocuSign proposal delivery without a public document URL");
    const envelopes: any[] = [];
    let uploadsHits = 0;
    fakeDocuSign = http.createServer((req, res) => {
      let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
        if ((req.url || "").includes("/uploads")) uploadsHits++;
        if (req.method === "POST" && (req.url || "").endsWith("/envelopes")) {
          envelopes.push(JSON.parse(body || "{}"));
          res.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify({ envelopeId: `env-${sfx}`, status: "sent" }));
        } else {
          res.writeHead(200, { "content-type": "application/json" }).end("{}");
        }
      });
    });
    await new Promise<void>((res) => fakeDocuSign!.listen(0, "127.0.0.1", () => res()));
    const dsPort = (fakeDocuSign.address() as any).port;
    await pool.query(`INSERT INTO product_api_keys (company_id, product_name, api_key, is_active) VALUES ($1,'docusign',$2,true)`,
      [coA, JSON.stringify({ accountId: "acct", accessToken: "test-token", baseUrl: `http://127.0.0.1:${dsPort}/restapi` })]);
    const proposalId = crypto.randomUUID();
    await pool.query(`INSERT INTO contractor_proposals (id, company_id, contractor_id, proposal_number, title, issue_date, status, amount) VALUES ($1,$2,$3,$4,'PU proposal',CURRENT_DATE,'approved','100')`,
      [proposalId, coA, wC, `PUP-${sfx}`]);
    const send = await apiRequest(base, "POST", `/api/contractor-proposals/${proposalId}/request-signature`, S.adminA, { provider: "docusign" });
    check("request-signature via DocuSign succeeds", send.status === 200 || send.status === 201, `${send.status} ${JSON.stringify(send.body).slice(0, 200)}`);
    check("fake DocuSign received exactly one envelope", envelopes.length === 1, `${envelopes.length}`);
    const docB64 = envelopes[0]?.documents?.[0]?.documentBase64 as string | undefined;
    const pdfRow = (await pool.query(`SELECT file_path FROM dam_documents WHERE linked_entity_type='proposal' AND linked_entity_id=$1 ORDER BY created_at DESC LIMIT 1`, [proposalId])).rows[0];
    const onDisk = pdfRow ? fs.readFileSync(path.join(UPLOAD_DIR, String(pdfRow.file_path).replace(/^\/uploads\//, ""))) : null;
    check("envelope carries the generated proposal PDF bytes", !!docB64 && !!onDisk && Buffer.from(docB64, "base64").equals(onDisk));
    check("no request hit /uploads (provider or self-fetch)", uploadsHits === 0);
    check("generated proposal PDF itself is private (anonymous 401)", !!pdfRow && (await get(String(pdfRow.file_path))).status === 401);
    check("…and downloadable by the company admin", !!pdfRow && (await get(String(pdfRow.file_path), S.adminA)).status === 200);
    if (pdfRow) { try { fs.unlinkSync(path.join(UPLOAD_DIR, String(pdfRow.file_path).replace(/^\/uploads\//, ""))); } catch { /* ignore */ } }
  } finally {
    if (server) await server.stop();
    if (fakeDocuSign) fakeDocuSign.close();
    try {
      await pool.query(`DELETE FROM session WHERE sess::text LIKE ANY($1)`, [userIds.map((id) => `%${id}%`)]);
      await cascadeDelete(pool, "users", userIds);
      await pool.query(`DELETE FROM system_documents WHERE title = $1`, [`PU form ${sfx}`]);
      await cascadeDelete(pool, "companies", companyIds);
      const residue = [...await verifyZeroResidue(pool, "companies", companyIds), ...await verifyZeroResidue(pool, "users", userIds)];
      check("zero DB residue", residue.length === 0, residue.join(", "));
    } catch (e) {
      check("cleanup", false, (e as Error).message);
    }
    fs.rmSync(dir, { recursive: true, force: true });
    try { fs.unlinkSync(path.join(process.cwd(), `pu-outside-${sfx}.pdf`)); } catch { /* ignore */ }
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) { console.error(errors.join("\n")); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
