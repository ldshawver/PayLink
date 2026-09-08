/**
 * Contractor W-9 upload lifecycle — regression suite for the two defects found
 * during PR #100 staging acceptance, plus the scoped log-redaction fix:
 *
 *  1. Re-uploading a W-9 accumulated a second `contractor_documents` row (the
 *     contractor profile then showed the W-9 twice). It must now atomically
 *     supersede the prior native W-9 so exactly one current W-9 is visible,
 *     with a `replaced` audit event, and the superseded blob removed only when
 *     nothing else references it.
 *
 *  2. DELETE /api/contractor-documents/:id removed the DB row but left the
 *     stored blob on disk. It must now remove the blob when unreferenced, keep
 *     it when a worker_documents (or other contractor_documents) row still
 *     points at the same canonical file, resolve paths safely beneath the
 *     uploads root, and reject path traversal.
 *
 *  3. The request logger echoed fileName / fileUrl for contractor-document
 *     responses. Those two fields are now redacted for that path prefix only.
 *
 * Real running server, real HTTP, disposable database, synthetic fixtures only.
 * No real W-9 content or PII. Same safety conventions as the rest of the db suite.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable_db npx tsx tests/contractor-w9-upload-lifecycle-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import bcrypt from "bcrypt";
import { spawnManagedProcess, resolveTsxCliPath, login, apiRequest, type Session } from "../scripts/cross-tenant-negative-tests/server-harness";
import { cascadeDelete, verifyZeroResidue } from "../scripts/cross-tenant-negative-tests/cascade-cleanup";

const FORBIDDEN_PATTERNS = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];

let passed = 0;
let failed = 0;
const errors: string[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✓  ${name}`); passed++; }
  else { console.error(`  ✗  ${name}${detail ? ` — ${detail}` : ""}`); errors.push(`${name}${detail ? `: ${detail}` : ""}`); failed++; }
}

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const FNAME_MARK = "FNAMEMARKER";
const PDF_BODY_MARK = "PDFBODYMARKER";
const FAKE_TIN = "123-45-6789";
function markedPdf(tag: string): Buffer {
  return Buffer.from(
    `%PDF-1.4\n% ${PDF_BODY_MARK} ${tag} SSN ${FAKE_TIN}\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`,
    "utf8",
  );
}
function listUploads(): string[] {
  try { return fs.readdirSync(UPLOAD_DIR); } catch { return []; }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const p = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(p));
    });
  });
}

/** Like startTestServer, but also captures the child's stdout+stderr so the log-redaction assertions can inspect them. */
async function startServerCapturingLogs(testDatabaseUrl: string) {
  const port = await freePort();
  const { child, managed } = spawnManagedProcess(process.execPath, [resolveTsxCliPath(), "server/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: testDatabaseUrl,
      SESSION_SECRET: "contractor-w9-upload-lifecycle-test-secret",
      NODE_ENV: "development",
      PORT: String(port),
      APP_ENV: "development",
    },
  });
  let logs = "";
  child.stdout?.on("data", (c: Buffer) => { logs += c.toString(); });
  child.stderr?.on("data", (c: Buffer) => { logs += c.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;
  const exitedEarly = new Promise<never>((_, rej) => {
    child.once("exit", (code, sig) => rej(new Error(`server exited early code=${code} sig=${sig}\n${logs.slice(-2000)}`)));
  });
  const healthy = (async () => {
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${baseUrl}/health`)).ok) return; } catch { /* not up yet */ }
      await new Promise(r => setTimeout(r, 300));
    }
    throw new Error("server did not become healthy");
  })();
  try { await Promise.race([healthy, exitedEarly]); }
  catch (e) { await managed.stop(); throw e; }
  return { baseUrl, stop: managed.stop, getLogs: () => logs, clearLogs: () => { logs = ""; } };
}

async function uploadW9(baseUrl: string, session: Session | null, fields: Record<string, string>, file: { name: string; bytes: Buffer } | null) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (file) fd.append("file", new Blob([file.bytes], { type: "application/pdf" }), file.name);
  const headers: Record<string, string> = {};
  if (session) headers["cookie"] = session.cookie;
  const res = await fetch(`${baseUrl}/api/contractor-documents/upload`, { method: "POST", headers, body: fd });
  let body: any; try { body = await res.json(); } catch { body = undefined; }
  return { status: res.status, body };
}
const listDocs = (baseUrl: string, s: Session, companyId: string, workerId: string) =>
  apiRequest(baseUrl, "GET", `/api/contractor-documents?companyId=${companyId}&workerId=${workerId}`, s);
const genSummaries = (baseUrl: string, s: Session, companyId: string, year: number) =>
  apiRequest(baseUrl, "POST", `/api/1099-summaries/generate`, s, { companyId, year });

async function main() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    console.log("TEST_DATABASE_URL not set — skipping contractor-w9-upload-lifecycle tests (0 run).");
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
  const workerIds: string[] = [];
  const externalSentinels: string[] = [];
  let server: Awaited<ReturnType<typeof startServerCapturingLogs>> | undefined;
  let triggerInstalled = false;

  try {
    const dbName = (await pool.query("SELECT current_database() AS n")).rows[0]?.n as string;
    if (FORBIDDEN_PATTERNS.some((p) => p.test(dbName))) throw new Error(`current_database()="${dbName}" looks protected. Refusing.`);

    const sfx = crypto.randomBytes(4).toString("hex");
    const companyA = crypto.randomUUID();
    const companyB = crypto.randomUUID();
    companyIds.push(companyA, companyB);
    await pool.query(`INSERT INTO companies (id, name) VALUES ($1,$2),($3,$4)`, [companyA, `W9L Co A ${sfx}`, companyB, `W9L Co B ${sfx}`]);

    const cx = crypto.randomUUID();       // replacement + failure-rollback
    const cshared = crypto.randomUUID();  // delete-with-shared-file
    const cconc = crypto.randomUUID();    // concurrency
    const cmisc = crypto.randomUUID();    // traversal
    workerIds.push(cx, cshared, cconc, cmisc);
    await pool.query(
      `INSERT INTO workers (id, company_id, person_id, first_name, last_name, worker_type, status, pay_rate, contractor_type, worker_group)
       VALUES
        ($1,$5,NULL,'Cx','Contractor','contractor','active','0','invoice','independent_contractor'),
        ($2,$5,NULL,'Shared','Contractor','contractor','active','0','invoice','independent_contractor'),
        ($3,$5,NULL,'Conc','Contractor','contractor','active','0','invoice','independent_contractor'),
        ($4,$5,NULL,'Misc','Contractor','contractor','active','0','invoice','independent_contractor')`,
      [cx, cshared, cconc, cmisc, companyA],
    );

    const pw = crypto.randomBytes(10).toString("hex");
    const pwHash = await bcrypt.hash(pw, 10);
    const adminAId = crypto.randomUUID();
    const adminA = `w9l_adminA_${sfx}`, adminB = `w9l_adminB_${sfx}`;
    await pool.query(
      `INSERT INTO users (id, username, password, role, company_id, is_active) VALUES
        ($1,$2,$3,'admin',$4,true),
        ($5,$6,$3,'admin',$7,true)`,
      [adminAId, adminA, pwHash, companyA, crypto.randomUUID(), adminB, companyB],
    );

    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    server = await startServerCapturingLogs(testDatabaseUrl);
    const base = server.baseUrl;
    const sA = await login(base, adminA, pw);
    const sB = await login(base, adminB, pw);
    const year = new Date().getFullYear();
    const w9RowCount = async (companyId: string, workerId: string) =>
      (await pool.query(`SELECT count(*)::int n FROM contractor_documents WHERE company_id=$1 AND worker_id=$2 AND document_type='w9'`, [companyId, workerId])).rows[0].n;

    console.log("\n── 1. First W-9 upload ──");
    const up1 = await uploadW9(base, sA, { companyId: companyA, workerId: cx, documentType: "w9" }, { name: `${FNAME_MARK}-v1.pdf`, bytes: markedPdf("v1") });
    check("first W-9 upload succeeds (201)", up1.status === 201 && !!up1.body?.id, `status=${up1.status} body=${JSON.stringify(up1.body)}`);
    const firstId = up1.body?.id;
    const firstUrl: string = up1.body?.fileUrl || "";
    const firstBase = path.basename(firstUrl);
    check("exactly one contractor_documents W-9 row after first upload", (await w9RowCount(companyA, cx)) === 1);
    check("first W-9 blob is on disk", fs.existsSync(path.join(UPLOAD_DIR, firstBase)), firstBase);
    const l1 = await listDocs(base, sA, companyA, cx);
    check("contractor profile shows exactly one W-9 after first upload",
      Array.isArray(l1.body) && (l1.body as any[]).filter(d => d.documentType === "w9").length === 1);

    console.log("\n── 2/3/4/5. Re-upload replaces (one current W-9, status stays current, replaced audit, old blob gone) ──");
    const g1 = await genSummaries(base, sA, companyA, year);
    check("W-9 status current before re-upload", (g1.body.summaries || []).find((s: any) => s.workerId === cx)?.missingW9 === false);
    const up2 = await uploadW9(base, sA, { companyId: companyA, workerId: cx, documentType: "w9" }, { name: `${FNAME_MARK}-v2.pdf`, bytes: markedPdf("v2") });
    check("re-upload succeeds (201)", up2.status === 201 && !!up2.body?.id, `status=${up2.status} body=${JSON.stringify(up2.body)}`);
    const secondId = up2.body?.id;
    const secondBase = path.basename(up2.body?.fileUrl || "");
    check("re-upload leaves exactly one contractor_documents W-9 row", (await w9RowCount(companyA, cx)) === 1, `count=${await w9RowCount(companyA, cx)}`);
    const priorGone = (await pool.query(`SELECT count(*)::int n FROM contractor_documents WHERE id=$1`, [firstId])).rows[0].n === 0;
    check("the prior W-9 row was removed (atomic replace, not accumulation)", priorGone && secondId !== firstId);
    const l2 = await listDocs(base, sA, companyA, cx);
    const l2w9 = Array.isArray(l2.body) ? (l2.body as any[]).filter(d => d.documentType === "w9") : [];
    check("contractor profile shows exactly one current W-9 after re-upload", l2w9.length === 1 && l2w9[0].id === secondId, JSON.stringify(l2w9.map(d => d.id)));
    const g2 = await genSummaries(base, sA, companyA, year);
    check("compliance status stays current after re-upload", (g2.body.summaries || []).find((s: any) => s.workerId === cx)?.missingW9 === false);
    const replCount = (await pool.query(`SELECT count(*)::int n FROM compliance_audit_events WHERE worker_id=$1 AND detail->>'event'='replaced'`, [cx])).rows[0].n;
    check("a 'replaced' audit event exists for the re-upload", replCount >= 1, `count=${replCount}`);
    check("the superseded W-9 blob was removed from disk", !fs.existsSync(path.join(UPLOAD_DIR, firstBase)));
    check("the current W-9 blob is still on disk", fs.existsSync(path.join(UPLOAD_DIR, secondBase)));

    console.log("\n── 6. Deleting an unshared document removes its row and stored file ──");
    const delUnshared = await apiRequest(base, "DELETE", `/api/contractor-documents/${secondId}`, sA);
    check("delete unshared W-9 → 200", delUnshared.status === 200 && delUnshared.body?.ok === true, JSON.stringify(delUnshared.body));
    check("delete response reports fileCleanup=removed", delUnshared.body?.fileCleanup === "removed", JSON.stringify(delUnshared.body));
    check("the contractor_documents row is gone", (await w9RowCount(companyA, cx)) === 0);
    check("the stored file is gone from disk", !fs.existsSync(path.join(UPLOAD_DIR, secondBase)));

    console.log("\n── 7. Deleting a shared association retains the canonical file ──");
    const sharedName = `${FNAME_MARK}-shared-w9.pdf`;
    const sharedUrl = `/uploads/${sharedName}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, sharedName), markedPdf("shared"));
    const wdSharedId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO worker_documents (id, worker_id, name, document_type, file_url, notes) VALUES ($1,$2,'Shared W-9','W-9 Taxpayer ID (Contractor)',$3,'shared')`,
      [wdSharedId, cshared, sharedUrl],
    );
    const cdSharedId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO contractor_documents (id, company_id, worker_id, document_type, file_name, file_url, uploaded_by) VALUES ($1,$2,$3,'w9','Shared W-9',$4,$5)`,
      [cdSharedId, companyA, cshared, sharedUrl, adminAId],
    );
    const delShared = await apiRequest(base, "DELETE", `/api/contractor-documents/${cdSharedId}`, sA);
    check("delete shared contractor_documents row → 200", delShared.status === 200 && delShared.body?.ok === true, JSON.stringify(delShared.body));
    check("delete response reports fileCleanup=retained", delShared.body?.fileCleanup === "retained", JSON.stringify(delShared.body));
    check("the contractor_documents row is gone", (await pool.query(`SELECT count(*)::int n FROM contractor_documents WHERE id=$1`, [cdSharedId])).rows[0].n === 0);
    check("the worker_documents row that shares the file is intact", (await pool.query(`SELECT count(*)::int n FROM worker_documents WHERE id=$1`, [wdSharedId])).rows[0].n === 1);
    check("the canonical file is retained on disk (still referenced by worker_documents)", fs.existsSync(path.join(UPLOAD_DIR, sharedName)));

    console.log("\n── 8. Cross-tenant deletion is rejected ──");
    const cdCrossId = crypto.randomUUID();
    const crossName = `${FNAME_MARK}-cross.pdf`;
    fs.writeFileSync(path.join(UPLOAD_DIR, crossName), markedPdf("cross"));
    await pool.query(
      `INSERT INTO contractor_documents (id, company_id, worker_id, document_type, file_name, file_url, uploaded_by) VALUES ($1,$2,$3,'w9','Cross',$4,$5)`,
      [cdCrossId, companyA, cmisc, `/uploads/${crossName}`, adminAId],
    );
    const delCross = await apiRequest(base, "DELETE", `/api/contractor-documents/${cdCrossId}`, sB);
    check("another tenant's admin cannot delete a company-A document (403)", delCross.status === 403, `status=${delCross.status}`);
    check("the cross-tenant target row is untouched", (await pool.query(`SELECT count(*)::int n FROM contractor_documents WHERE id=$1`, [cdCrossId])).rows[0].n === 1);
    check("the cross-tenant target file is untouched", fs.existsSync(path.join(UPLOAD_DIR, crossName)));
    await pool.query(`DELETE FROM contractor_documents WHERE id=$1`, [cdCrossId]);
    fs.rmSync(path.join(UPLOAD_DIR, crossName), { force: true });

    console.log("\n── 9. Path traversal cannot delete or serve outside the upload root ──");
    const sentinel = path.join(process.cwd(), `w9l-traversal-sentinel-${sfx}.txt`);
    fs.writeFileSync(sentinel, "SENTINEL MUST SURVIVE");
    externalSentinels.push(sentinel);
    const cdTravId = crypto.randomUUID();
    const travUrl = `/uploads/../w9l-traversal-sentinel-${sfx}.txt`;
    await pool.query(
      `INSERT INTO contractor_documents (id, company_id, worker_id, document_type, file_name, file_url, uploaded_by) VALUES ($1,$2,$3,'w9','Traversal',$4,$5)`,
      [cdTravId, companyA, cmisc, travUrl, adminAId],
    );
    const travDl = await fetch(`${base}/api/contractor-documents/${cdTravId}/download`, { headers: { cookie: sA.cookie } });
    const travDlText = await travDl.text();
    check("download of a traversal file_url → 404 (does not serve outside the root)", travDl.status === 404 && !travDlText.includes("SENTINEL"), `status=${travDl.status}`);
    const delTrav = await apiRequest(base, "DELETE", `/api/contractor-documents/${cdTravId}`, sA);
    check("delete of a traversal file_url → 200, row removed, no external unlink", delTrav.status === 200 && delTrav.body?.fileCleanup === "deferred", JSON.stringify(delTrav.body));
    check("the external sentinel file still exists (traversal rejected)", fs.existsSync(sentinel));

    console.log("\n── 10. A DB failure during replace does not silently produce inconsistent success ──");
    // Restore a valid current W-9 for cx first.
    const upRestore = await uploadW9(base, sA, { companyId: companyA, workerId: cx, documentType: "w9" }, { name: `${FNAME_MARK}-restore.pdf`, bytes: markedPdf("restore") });
    check("baseline W-9 re-established for failure test (201)", upRestore.status === 201);
    const restoreBase = path.basename(upRestore.body?.fileUrl || "");
    const restoreId = upRestore.body?.id;
    await pool.query(`CREATE OR REPLACE FUNCTION _w9l_force_fail() RETURNS trigger AS $$ BEGIN IF NEW.file_name = 'FORCE_DB_FAILURE.pdf' THEN RAISE EXCEPTION 'forced test failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE TRIGGER _w9l_force_fail BEFORE INSERT ON contractor_documents FOR EACH ROW EXECUTE FUNCTION _w9l_force_fail()`);
    triggerInstalled = true;
    const uploadsBeforeFail = listUploads().length;
    const failUp = await uploadW9(base, sA, { companyId: companyA, workerId: cx, documentType: "w9" }, { name: "FORCE_DB_FAILURE.pdf", bytes: markedPdf("fail") });
    check("upload whose DB write fails → not 201", failUp.status !== 201, `status=${failUp.status}`);
    check("failed upload response is sanitized (no path / stack)", !/\/(home|var|uploads)\/|stack|node_modules/i.test(JSON.stringify(failUp.body || {})), JSON.stringify(failUp.body));
    check("failed replace left exactly one W-9 row (the prior one), never zero or two", (await w9RowCount(companyA, cx)) === 1);
    check("the prior W-9 row id is unchanged after the failed replace", (await pool.query(`SELECT count(*)::int n FROM contractor_documents WHERE id=$1`, [restoreId])).rows[0].n === 1);
    check("the rejected upload's file was discarded (no orphan)", listUploads().length === uploadsBeforeFail);
    check("the prior W-9 blob is still present", fs.existsSync(path.join(UPLOAD_DIR, restoreBase)));
    await pool.query(`DROP TRIGGER _w9l_force_fail ON contractor_documents`);
    await pool.query(`DROP FUNCTION _w9l_force_fail()`);
    triggerInstalled = false;

    console.log("\n── 11. Concurrent re-uploads converge to exactly one current W-9 ──");
    const conc = await Promise.all([1, 2, 3, 4].map(n =>
      uploadW9(base, sA, { companyId: companyA, workerId: cconc, documentType: "w9" }, { name: `${FNAME_MARK}-c${n}.pdf`, bytes: markedPdf(`c${n}`) })));
    check("all concurrent uploads return 201", conc.every(r => r.status === 201), JSON.stringify(conc.map(r => r.status)));
    check("exactly one contractor_documents W-9 row after concurrent uploads", (await w9RowCount(companyA, cconc)) === 1, `count=${await w9RowCount(companyA, cconc)}`);
    const lc = await listDocs(base, sA, companyA, cconc);
    check("contractor profile shows exactly one W-9 after concurrent uploads",
      Array.isArray(lc.body) && (lc.body as any[]).filter(d => d.documentType === "w9").length === 1);

    console.log("\n── 12. Logs do not contain filenames, URLs, contents, TINs, or credentials ──");
    const logs = server.getLogs();
    check("logs do not contain the uploaded fileName marker", !logs.includes(FNAME_MARK), "FNAME_MARK leaked");
    check("logs do not contain a stored /uploads/<file> path for a contractor document", !/\/uploads\/\d+-\d+\.pdf/.test(logs));
    check("logs do not contain W-9 document body content", !logs.includes(PDF_BODY_MARK));
    check("logs do not contain a TIN/SSN pattern", !new RegExp(FAKE_TIN.replace(/[-]/g, "\\-")).test(logs) && !/\b\d{3}-\d{2}-\d{4}\b/.test(logs));
    check("logs do not contain the test session secret", !logs.includes("contractor-w9-upload-lifecycle-test-secret"));
    check("contractor-document responses were still logged (redacted, not suppressed)", /\/api\/contractor-documents/.test(logs) && /\[redacted\]/.test(logs));

    console.log(`\n${passed} passed, ${failed} failed`);
  } finally {
    if (server) await server.stop();
    try {
      if (triggerInstalled) {
        await pool.query(`DROP TRIGGER IF EXISTS _w9l_force_fail ON contractor_documents`).catch(() => {});
        await pool.query(`DROP FUNCTION IF EXISTS _w9l_force_fail()`).catch(() => {});
      }
      await pool.query(`DELETE FROM compliance_audit_events WHERE company_id = ANY($1::varchar[])`, [companyIds]);
      await pool.query(`DELETE FROM contractor_1099_summaries WHERE company_id = ANY($1::varchar[])`, [companyIds]);
      await pool.query(`DELETE FROM contractor_documents WHERE company_id = ANY($1::varchar[])`, [companyIds]);
      await pool.query(`DELETE FROM worker_documents WHERE worker_id = ANY($1::varchar[])`, [workerIds]);
      await cascadeDelete(pool, "companies", companyIds);
      const residue = [...(await verifyZeroResidue(pool, "companies", companyIds))];
      const leftoverCd = (await pool.query(`SELECT count(*)::int n FROM contractor_documents WHERE company_id = ANY($1::varchar[])`, [companyIds])).rows[0].n;
      if (leftoverCd > 0) residue.push(`contractor_documents: ${leftoverCd} row(s)`);
      // Remove synthetic upload blobs this test created.
      for (const f of listUploads()) {
        if (f.includes(FNAME_MARK)) fs.rmSync(path.join(UPLOAD_DIR, f), { force: true });
      }
      for (const s of externalSentinels) fs.rmSync(s, { force: true });
      const strayBlob = listUploads().some(f => f.includes(FNAME_MARK));
      if (strayBlob) residue.push("upload blob(s) with test marker remain");
      if (residue.length) { console.error("CLEANUP RESIDUE:", residue.join("; ")); failed++; }
      else console.log("cleanup: zero residue confirmed");
    } catch (e) {
      console.error("cleanup error:", (e as Error).message);
      failed++;
    }
    await pool.end();
  }

  if (failed > 0) {
    console.error(`\nFAILURES:\n${errors.map((e) => ` - ${e}`).join("\n")}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
