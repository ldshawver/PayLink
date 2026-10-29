/**
 * GET /uploads/* access control end to end — real server/index.ts, real login
 * sessions, real ownership SQL over fixture rows, real files under uploads/.
 *
 * Proves the original exposure (anonymous GET of a stored W-9) is closed, every
 * UPLOAD_SOURCES query is valid against the real schema, tenant isolation,
 * unknown ownership, public logos (absolute-URL reference form), traversal and
 * symlinks, logout / deactivation, and that existing authorized download routes
 * still work.
 *
 * Synthetic fixtures only; refuses staging/production URLs; zero residue.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable_db npx tsx tests/uploads-access-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import bcrypt from "bcrypt";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { UPLOAD_SOURCES, findUploadOwners } from "../server/uploads-access";
import { startTestServer, login, apiRequest, type Session } from "../scripts/cross-tenant-negative-tests/server-harness";
import { cascadeDelete, verifyZeroResidue } from "../scripts/cross-tenant-negative-tests/cascade-cleanup";

const FORBIDDEN_PATTERNS = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✓  ${name}`); passed++; }
  else { console.error(`  ✗  ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

async function main() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    console.log("TEST_DATABASE_URL not set — skipping uploads-access db tests (0 run).");
    return;
  }
  for (const p of FORBIDDEN_PATTERNS) {
    if (p.test(testDatabaseUrl)) throw new Error("TEST_DATABASE_URL looks like staging/production. Refusing to run.");
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is identical to DATABASE_URL. Refusing.");
  }

  const pool = new Pool({ connectionString: testDatabaseUrl, max: 4 });
  const companyIds: string[] = [];
  const userIds: string[] = [];
  const sfx = crypto.randomBytes(4).toString("hex");
  const dirName = `ua-${sfx}`;
  const dir = path.join(UPLOAD_DIR, dirName);
  const outside = path.join(process.cwd(), `ua-outside-${sfx}.pdf`);
  let server: Awaited<ReturnType<typeof startTestServer>> | undefined;

  try {
    const dbName = (await pool.query("SELECT current_database() AS n")).rows[0]?.n as string;
    if (FORBIDDEN_PATTERNS.some((p) => p.test(dbName))) throw new Error(`current_database()="${dbName}" looks protected. Refusing.`);

    // Boot first: feedback_tickets and the session table are created by boot DDL.
    server = await startTestServer(testDatabaseUrl);
    const base = server.baseUrl;
    const port = Number(new URL(base).port);

    console.log("\n— every ownership source is valid SQL against the real schema —");
    // Strict executor: a typo'd table/column would surface here instead of being
    // skipped as schema drift.
    const dialect = new PgDialect();
    const strictExec = async (q: SQL) => {
      const { sql: text, params } = dialect.sqlToQuery(q);
      try { return await pool.query(text, params as unknown[]); }
      catch (e: any) { throw new Error(`${e.message} :: ${text.slice(0, 120)}`); }
    };
    const probe = await findUploadOwners(strictExec, "probe/none.png").then(() => "", (e) => e.message);
    check(`all ${UPLOAD_SOURCES.length} ownership source queries execute against the real schema`, probe === "", probe);

    // ── Files ──
    fs.mkdirSync(dir, { recursive: true });
    const file = (name: string) => { fs.writeFileSync(path.join(dir, name), `BODY:${name}`); return `/uploads/${dirName}/${name}`; };
    const w9 = file("w9-a.pdf");
    const workerDoc = file("workerdoc-a.pdf");
    const damB = file("dam-b.pdf");
    const logoB = file("logo-b.png");
    const shot = file("shot-a.png");
    const form = file("form.pdf");
    const orphan = file("orphan.pdf");
    fs.writeFileSync(outside, "OUTSIDE SECRET");
    fs.symlinkSync(outside, path.join(dir, "escape.pdf"));

    // ── Fixtures ──
    const coA = crypto.randomUUID(), coB = crypto.randomUUID();
    companyIds.push(coA, coB);
    await pool.query(`INSERT INTO companies (id, name) VALUES ($1,$2)`, [coA, `UA Co A ${sfx}`]);
    await pool.query(`INSERT INTO companies (id, name, logo_url) VALUES ($1,$2,$3)`, [coB, `UA Co B ${sfx}`, `https://mypaylink.app${logoB}?v=3`]);
    const wA = crypto.randomUUID();
    await pool.query(`INSERT INTO workers (id, company_id, first_name, last_name, worker_type, pay_rate) VALUES ($1,$2,'Cee','Contractor','contractor',0)`, [wA, coA]);

    const pw = crypto.randomBytes(10).toString("hex");
    const pwHash = await bcrypt.hash(pw, 10);
    const U: Record<string, { id: string; username: string }> = {};
    for (const [key, role, co] of [["adminA", "admin", coA], ["adminB", "admin", coB], ["leaver", "admin", coA]] as const) {
      U[key] = { id: crypto.randomUUID(), username: `ua_${key}_${sfx}` };
      userIds.push(U[key].id);
      await pool.query(`INSERT INTO users (id, username, password, role, company_id, is_active) VALUES ($1,$2,$3,$4,$5,true)`, [U[key].id, U[key].username, pwHash, role, co]);
    }

    const cd = await pool.query(`INSERT INTO contractor_documents (company_id, worker_id, document_type, file_name, file_url, uploaded_by) VALUES ($1,$2,'w9','w9.pdf',$3,$4) RETURNING id`, [coA, wA, w9, U.adminA.id]);
    await pool.query(`INSERT INTO worker_documents (worker_id, name, file_url) VALUES ($1,'Doc',$2)`, [wA, workerDoc]);
    const dam = await pool.query(`INSERT INTO dam_documents (company_id, owner_type, document_type, title, file_path, file_name) VALUES ($1,'company','general','B doc',$2,'b.pdf') RETURNING id`, [coB, damB]);
    await pool.query(`INSERT INTO system_documents (title, file_url) VALUES ($1,$2)`, [`UA form ${sfx}`, form.replace(/^\//, "")]);
    await pool.query(`INSERT INTO feedback_tickets (company_id, submitter_user_id, submitter_name, type, title, description, screenshot_paths) VALUES ($1,$2,'A','bug','t','d',ARRAY[$3]::text[])`, [coA, U.adminA.id, shot]);

    const S: Record<string, Session> = {};
    for (const k of Object.keys(U)) S[k] = await login(base, U[k].username, pw);

    const get = (p: string, s?: Session | null) => new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request({ hostname: "127.0.0.1", port, path: p, headers: s ? { cookie: s.cookie } : {} }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode!, body }));
      });
      req.on("error", reject);
      req.end();
    });

    console.log("\n— anonymous —");
    let r = await get(w9);
    check("anonymous W-9 → 401 (original exposure closed)", r.status === 401 && !r.body.includes("BODY"), `${r.status}`);
    check("anonymous worker document (joined source) → 401", (await get(workerDoc)).status === 401);
    check("anonymous feedback screenshot (text[] source) → 401", (await get(shot)).status === 401);
    check("anonymous platform form (legacy 'uploads/…' reference) → 401", (await get(form)).status === 401);

    console.log("\n— authorized / tenant isolation —");
    r = await get(w9, S.adminA);
    check("company A admin gets company A's W-9", r.status === 200 && r.body === "BODY:w9-a.pdf", `${r.status}`);
    check("company A admin gets worker document", (await get(workerDoc, S.adminA)).body === "BODY:workerdoc-a.pdf");
    check("company A admin gets feedback screenshot", (await get(shot, S.adminA)).status === 200);
    check("company B admin → 404 for company A's W-9", (await get(w9, S.adminB)).status === 404);
    check("company B admin → 404 for company A's worker document", (await get(workerDoc, S.adminB)).status === 404);
    check("company A admin → 404 for company B's DAM document", (await get(damB, S.adminA)).status === 404);
    check("company B admin gets its own DAM document", (await get(damB, S.adminB)).status === 200);
    check("platform form → any signed-in user", (await get(form, S.adminB)).status === 200);

    console.log("\n— unknown ownership —");
    check("file on disk, no record → 404 (signed in)", (await get(orphan, S.adminA)).status === 404);
    check("file on disk, no record → not served (anonymous)", (await get(orphan)).status === 401);

    console.log("\n— public logos —");
    r = await get(logoB);
    check("company logo (stored as absolute URL with ?v=) loads anonymously", r.status === 200 && r.body === "BODY:logo-b.png", `${r.status}`);

    console.log("\n— traversal / symlinks —");
    for (const p of [`/uploads/${dirName}/%2e%2e/%2e%2e/ua-outside-${sfx}.pdf`, `/uploads/${dirName}/..%2f..%2fua-outside-${sfx}.pdf`, `/uploads/../package.json`]) {
      r = await get(p, S.adminA);
      check(`${p.replace(sfx, "…")} → 404 from uploads handler`, r.status === 404 && r.body === "Not found", `${r.status} ${r.body.slice(0, 30)}`);
    }
    await pool.query(`INSERT INTO worker_documents (worker_id, name, file_url) VALUES ($1,'Esc',$2)`, [wA, `/uploads/${dirName}/escape.pdf`]);
    r = await get(`/uploads/${dirName}/escape.pdf`, S.adminA);
    check("symlink out of uploads root → 404 even with an owning record", r.status === 404 && !r.body.includes("OUTSIDE"));

    console.log("\n— existing authorized download routes —");
    let api = await apiRequest(base, "GET", `/api/contractor-documents/${cd.rows[0].id}/download`, S.adminA);
    check("GET /api/contractor-documents/:id/download still works for owner admin", api.status === 200, `${api.status}`);
    api = await apiRequest(base, "GET", `/api/contractor-documents/${cd.rows[0].id}/download`, S.adminB);
    check("...and still denies the other company", api.status !== 200, `${api.status}`);
    api = await apiRequest(base, "GET", `/api/dam-documents/${dam.rows[0].id}/download`, S.adminB);
    check("GET /api/dam-documents/:id/download still works for owner admin", api.status === 200, `${api.status}`);

    console.log("\n— session lifecycle —");
    check("user's session works before deactivation", (await get(w9, S.leaver)).status === 200);
    await pool.query(`UPDATE users SET is_active = false WHERE id = $1`, [U.leaver.id]);
    check("deactivated user's live session → 401", (await get(w9, S.leaver)).status === 401);
    await apiRequest(base, "POST", "/api/auth/logout", S.adminA);
    check("after logout → 401", (await get(w9, S.adminA)).status === 401);
  } finally {
    if (server) await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
    if (userIds.length) {
      await pool.query(`DELETE FROM feedback_tickets WHERE submitter_user_id = ANY($1)`, [userIds]);
      await pool.query(`DELETE FROM system_documents WHERE title = $1`, [`UA form ${sfx}`]);
      await cascadeDelete(pool, "users", userIds);
    }
    if (companyIds.length) await cascadeDelete(pool, "companies", companyIds);
    const residue = [...await verifyZeroResidue(pool, "companies", companyIds), ...await verifyZeroResidue(pool, "users", userIds)];
    check("zero fixture residue", residue.length === 0, residue.join(", "));
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
