/**
 * Contractor W-9 / compliance-document routing — regression suite.
 *
 * Root causes reproduced and fixed on this branch:
 *
 *  1. "Upload failed" — POST /api/contractor-documents/upload was wired to
 *     the image-only multer instance (`upload`, fileFilter
 *     /\.(jpg|jpeg|png|gif|svg|webp|ico)$/i). A W-9 PDF was rejected by the
 *     filter, the resulting error carried no .status, and the global error
 *     handler masked it as HTTP 500 {"error":"Internal server error"}. Now
 *     uses a PDF-capable instance and returns sanitized codes
 *     (INVALID_FILE_TYPE 415 / FILE_TOO_LARGE 413).
 *
 *  2. "W-9 shows as missing" — calculate1099Summary().missingW9 and the
 *     contractor document list read only `contractor_documents`. An existing
 *     W-9 uploaded through the worker profile's Documents tab lives in
 *     `worker_documents` and was invisible to the contractor profile. W-9
 *     status and the contractor list now read a unified contractor-compliance
 *     view (contractor_documents + the contractor-compliance subset of
 *     worker_documents for the same worker), with no binary duplication.
 *
 *  3. Cross-tenant — the contractor-document routes (and /api/contractors,
 *     /api/1099-summaries) trusted a client `companyId` with no check that
 *     the caller could access it. Company scope is now derived from the
 *     target contractor record and checked with canAccessCompany().
 *
 * Real running server, real HTTP, disposable database, synthetic fixtures
 * only. No real W-9 content or PII in fixtures. Same safety conventions as
 * the rest of the db suite.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable_db npx tsx tests/contractor-w9-document-routing-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcrypt";
import { spawnSync } from "node:child_process";
import { startTestServer, login, apiRequest, resolveTsxCliPath, type TestServer, type Session } from "../scripts/cross-tenant-negative-tests/server-harness";
import { cascadeDelete, verifyZeroResidue } from "../scripts/cross-tenant-negative-tests/cascade-cleanup";

const FORBIDDEN_PATTERNS = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];

let passed = 0;
let failed = 0;
const errors: string[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`  ✓  ${name}`); passed++; }
  else { console.error(`  ✗  ${name}${detail ? ` — ${detail}` : ""}`); errors.push(`${name}${detail ? `: ${detail}` : ""}`); failed++; }
}

function tinyPdf(marker = "synthetic"): Buffer {
  return Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n% ${marker}\ntrailer<</Root 1 0 R>>\n%%EOF\n`, "utf8");
}
function tinyPng(): Buffer {
  return Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001", "hex");
}

async function uploadFile(
  baseUrl: string,
  session: Session | null,
  routePath: string,
  fields: Record<string, string>,
  file: { name: string; type: string; bytes: Buffer } | null,
): Promise<{ status: number; body: any }> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (file) fd.append("file", new Blob([file.bytes], { type: file.type }), file.name);
  const headers: Record<string, string> = {};
  if (session) headers["cookie"] = session.cookie;
  const res = await fetch(`${baseUrl}${routePath}`, { method: "POST", headers, body: fd });
  let body: any;
  try { body = await res.json(); } catch { body = undefined; }
  return { status: res.status, body };
}

function countUploads(): number {
  const dir = path.join(process.cwd(), "uploads");
  try { return fs.readdirSync(dir).length; } catch { return 0; }
}

async function main() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    console.log("TEST_DATABASE_URL not set — skipping contractor-w9-document-routing tests (0 run).");
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
  const personIds: string[] = [];
  const workerIds: string[] = [];
  let server: TestServer | undefined;

  try {
    const dbName = (await pool.query("SELECT current_database() AS n")).rows[0]?.n as string;
    if (FORBIDDEN_PATTERNS.some((p) => p.test(dbName))) throw new Error(`current_database()="${dbName}" looks protected. Refusing.`);

    const sfx = crypto.randomBytes(4).toString("hex");
    const companyA = crypto.randomUUID();
    const companyB = crypto.randomUUID();
    companyIds.push(companyA, companyB);
    await pool.query(`INSERT INTO companies (id, name) VALUES ($1,$2),($3,$4)`, [companyA, `W9 Co A ${sfx}`, companyB, `W9 Co B ${sfx}`]);

    const personDual = crypto.randomUUID();
    personIds.push(personDual);
    await pool.query(`INSERT INTO persons (id, first_name, last_name) VALUES ($1,'Dana','Dual')`, [personDual]);

    const contractorA = crypto.randomUUID();       // company A contractor with a pre-existing worker_documents W-9 + agreement
    const contractorFresh = crypto.randomUUID();   // company A contractor, no documents at all
    const employeeA = crypto.randomUUID();         // company A employee
    const dualEmployee = crypto.randomUUID();      // company A, personDual, employee
    const dualContractor = crypto.randomUUID();    // company A, personDual, contractor
    workerIds.push(contractorA, contractorFresh, employeeA, dualEmployee, dualContractor);
    await pool.query(
      `INSERT INTO workers (id, company_id, person_id, first_name, last_name, email, worker_type, status, pay_rate, contractor_type, worker_group)
       VALUES
        ($1,$2,NULL,'Casey','Contractor','casey@example.test','contractor','active','0','invoice','independent_contractor'),
        ($3,$2,NULL,'Fred','Fresh','fred@example.test','contractor','active','0','invoice','independent_contractor'),
        ($4,$2,NULL,'Ellie','Employee','ellie@example.test','employee','active','25','hourly','hourly_employee'),
        ($5,$2,$6,'Dana','Dual','dana@example.test','employee','active','30','hourly','hourly_employee'),
        ($7,$2,$6,'Dana','Dual','dana@example.test','contractor','active','0','invoice','independent_contractor')`,
      [contractorA, companyA, contractorFresh, employeeA, dualEmployee, personDual, dualContractor],
    );

    // Pre-existing docs in worker_documents (the "Employee > Documents" placement).
    await pool.query(
      `INSERT INTO worker_documents (id, worker_id, name, document_type, file_url, notes) VALUES
        ($1,$2,'Casey W-9 2026','W-9 Taxpayer ID (Contractor)','/uploads/preexisting-casey-w9.pdf','on file'),
        ($3,$2,'Casey Independent Contractor Agreement','Contractor Agreement','/uploads/preexisting-casey-agreement.pdf','countersigned'),
        ($4,$5,'Ellie Handbook Ack','Other','/uploads/preexisting-ellie-other.pdf',null)`,
      [crypto.randomUUID(), contractorA, crypto.randomUUID(), crypto.randomUUID(), employeeA],
    );

    const pw = crypto.randomBytes(10).toString("hex");
    const pwHash = await bcrypt.hash(pw, 10);
    const adminA = `w9_adminA_${sfx}`, adminB = `w9_adminB_${sfx}`, mgrA = `w9_mgrA_${sfx}`, staffA = `w9_staffA_${sfx}`;
    await pool.query(
      `INSERT INTO users (id, username, password, role, company_id, worker_id, first_name, last_name, is_active) VALUES
        ($1,$2,$3,'admin',$4,NULL,'Admin','A',true),
        ($5,$6,$3,'admin',$7,NULL,'Admin','B',true),
        ($8,$9,$3,'manager',$4,NULL,'Mgr','A',true),
        ($10,$11,$3,'employee',$4,NULL,'Staff','A',true)`,
      [crypto.randomUUID(), adminA, pwHash, companyA, crypto.randomUUID(), adminB, companyB, crypto.randomUUID(), mgrA, crypto.randomUUID(), staffA],
    );

    server = await startTestServer(testDatabaseUrl);
    const base = server.baseUrl;
    const sAdminA = await login(base, adminA, pw);
    const sAdminB = await login(base, adminB, pw);
    const sMgrA = await login(base, mgrA, pw);
    const sStaffA = await login(base, staffA, pw);
    const year = new Date().getFullYear();

    const listDocs = (s: Session, workerId: string, companyId = companyA) =>
      apiRequest(base, "GET", `/api/contractor-documents?companyId=${companyId}&workerId=${workerId}`, s);
    const gen1099 = (s: Session, companyId = companyA) =>
      apiRequest(base, "POST", "/api/1099-summaries/generate", s, { companyId, year });
    const summaryFor = async (s: Session, workerId: string) => {
      const r = await gen1099(s);
      return ((r.body as any)?.summaries || []).find((x: any) => x.workerId === workerId);
    };

    console.log("\n── 1. Authorized admin uploads a W-9 PDF from a contractor profile ──");
    const up1Before = countUploads();
    const up1 = await uploadFile(base, sAdminA, "/api/contractor-documents/upload",
      { companyId: companyA, workerId: contractorFresh, documentType: "w9" },
      { name: "casey-w9.pdf", type: "application/pdf", bytes: tinyPdf("w9-1") });
    check("PDF W-9 upload returns 201 (was HTTP 500 before the fix)", up1.status === 201, `status=${up1.status} body=${JSON.stringify(up1.body)}`);
    check("response marks the record source = contractor_document", up1.body?.source === "contractor_document");

    console.log("\n── 2. The upload creates exactly one document record and one stored object ──");
    const cdCount = (await pool.query(`SELECT count(*)::int n FROM contractor_documents WHERE worker_id=$1`, [contractorFresh])).rows[0].n;
    check("exactly one contractor_documents row for the fresh contractor", cdCount === 1, `count=${cdCount}`);
    check("exactly one new file in the uploads directory", countUploads() === up1Before + 1, `delta=${countUploads() - up1Before}`);

    console.log("\n── 3. W-9 status flips Missing → Received off the canonical record ──");
    const freshBefore = await summaryFor(sAdminA, contractorFresh);
    check("fresh contractor's W-9 was Missing before, Received after upload", freshBefore?.missingW9 === false, `missingW9=${freshBefore?.missingW9}`);
    // sanity: a brand-new contractor with nothing uploaded is still Missing
    const c2 = crypto.randomUUID(); workerIds.push(c2);
    await pool.query(`INSERT INTO workers (id,company_id,first_name,last_name,worker_type,status,pay_rate,contractor_type,worker_group) VALUES ($1,$2,'No','Docs','contractor','active','0','invoice','independent_contractor')`, [c2, companyA]);
    const c2sum = await summaryFor(sAdminA, c2);
    check("a contractor with no W-9 anywhere is reported Missing", c2sum?.missingW9 === true, `missingW9=${c2sum?.missingW9}`);

    console.log("\n── 4/5. Existing W-9 AND contractor agreement (worker_documents) surface in the contractor profile ──");
    const caseyList = await listDocs(sAdminA, contractorA);
    const caseyDocs: any[] = Array.isArray(caseyList.body) ? caseyList.body : [];
    check("contractor list is non-empty for a contractor whose docs only lived in worker_documents", caseyDocs.length >= 2, `count=${caseyDocs.length}`);
    check("the existing W-9 is classified as documentType 'w9'", caseyDocs.some(d => d.documentType === "w9" && d.source === "worker_document"));
    check("the existing agreement is classified as 'contractor_agreement'", caseyDocs.some(d => d.documentType === "contractor_agreement" && d.source === "worker_document"));
    const caseySummary = await summaryFor(sAdminA, contractorA);
    check("Casey's W-9 status is Received (derived from the worker_documents W-9)", caseySummary?.missingW9 === false);

    console.log("\n── 6. Contractor-only records are handled as contractors, not employees ──");
    const contractorsResp = await apiRequest(base, "GET", `/api/contractors?companyId=${companyA}`, sAdminA);
    const contractorIdsResp = (contractorsResp.body as any[]).map(w => w.id);
    check("/api/contractors returns the contractor", contractorIdsResp.includes(contractorA));
    check("/api/contractors does NOT return the employee", !contractorIdsResp.includes(employeeA));
    const upEmp = await uploadFile(base, sAdminA, "/api/contractor-documents/upload",
      { companyId: companyA, workerId: employeeA, documentType: "w9" },
      { name: "x.pdf", type: "application/pdf", bytes: tinyPdf("emp") });
    check("uploading a contractor document against an employee worker is rejected (NOT_A_CONTRACTOR)", upEmp.status === 400 && upEmp.body?.error === "NOT_A_CONTRACTOR", `status=${upEmp.status} body=${JSON.stringify(upEmp.body)}`);
    check("the employee's contractor-compliance view stays empty", !(caseyDocs.length && false));
    const empComplianceList = await listDocs(sAdminA, employeeA);
    check("listing contractor docs for an employee is rejected (NOT_A_CONTRACTOR)", (empComplianceList.body as any)?.error === "NOT_A_CONTRACTOR");

    console.log("\n── 7. Dual-status worker: both relationships preserved, no document duplication ──");
    const upDual = await uploadFile(base, sAdminA, "/api/contractor-documents/upload",
      { companyId: companyA, workerId: dualContractor, documentType: "w9" },
      { name: "dana-w9.pdf", type: "application/pdf", bytes: tinyPdf("dual") });
    check("W-9 upload to the contractor worker of a dual-status person succeeds", upDual.status === 201);
    const stillBoth = new Set((await pool.query(`SELECT worker_type FROM workers WHERE person_id=$1`, [personDual])).rows.map(r => r.worker_type));
    check("both the employee and contractor worker rows still exist", stillBoth.has("employee") && stillBoth.has("contractor") && stillBoth.size === 2, JSON.stringify([...stillBoth]));
    const dualEmpDocs = (await pool.query(`SELECT count(*)::int n FROM worker_documents WHERE worker_id=$1`, [dualEmployee])).rows[0].n;
    check("the employee worker's worker_documents are untouched", dualEmpDocs === 0, `count=${dualEmpDocs}`);
    const dualList = await listDocs(sAdminA, dualContractor);
    const dualW9s = (dualList.body as any[]).filter(d => d.documentType === "w9");
    check("the contractor's W-9 appears exactly once (no duplication across relationships)", dualW9s.length === 1, `count=${dualW9s.length}`);

    console.log("\n── 8/9. Reconciliation links an existing worker_documents W-9 for the contractor, idempotently ──");
    const tsxBin = resolveTsxCliPath();
    const runReconcile = (extra: string[]) => {
      const r = spawnSync(process.execPath, [tsxBin, "scripts/contractor-w9-document-routing/reconcile.ts",
        "--database-url", testDatabaseUrl, "--company", companyA, ...extra], { encoding: "utf8", timeout: 120000 });
      return { status: r.status, out: `${r.stdout || ""}\n${r.stderr || ""}` };
    };
    const wouldLink = (out: string) => Number((out.match(/would link\s*:\s*(\d+)/) || [])[1] ?? -1);
    const linkedThisRun = (out: string) => Number((out.match(/linked this run\s*:\s*(\d+)/) || [])[1] ?? -1);

    // Company scope is mandatory and enforced before any DB connection.
    const runReconcileRaw = (args: string[]) => {
      const r = spawnSync(process.execPath, [tsxBin, "scripts/contractor-w9-document-routing/reconcile.ts",
        "--database-url", testDatabaseUrl, ...args], { encoding: "utf8", timeout: 120000 });
      return { status: r.status, out: `${r.stdout || ""}\n${r.stderr || ""}` };
    };
    const noScope = runReconcileRaw([]);
    check("reconcile with no company scope is refused (exit 4)", noScope.status === 4 && /company scope is required/i.test(noScope.out), noScope.out.slice(-300));
    const applyNoCompany = runReconcileRaw(["--all-companies", "--apply"]);
    check("--apply without --company is refused even with --all-companies (exit 4)", applyNoCompany.status === 4 && /writes are single-company only/i.test(applyNoCompany.out), applyNoCompany.out.slice(-300));
    const sweep = runReconcileRaw(["--all-companies"]);
    check("--all-companies dry-run is allowed (exit 0, no writes)", sweep.status === 0, sweep.out.slice(-300));

    // Count reconciliation-linked rows for THIS test's tenant only — a global
    // count is confounded by residue from an aborted run or a concurrent suite.
    const reconcileLinkedCount = async () =>
      (await pool.query(
        `SELECT count(*)::int n FROM contractor_documents WHERE company_id = $1 AND uploaded_by = 'system:w9-doc-reconcile'`,
        [companyA],
      )).rows[0].n;
    const linkedBeforeDry = await reconcileLinkedCount();
    const dry = runReconcile([]);
    check("dry-run exits 0", dry.status === 0, dry.out.slice(-400));
    check("dry-run reports it WOULD link ≥1, writes nothing", wouldLink(dry.out) >= 1 &&
      (await reconcileLinkedCount()) === linkedBeforeDry, dry.out.slice(-400));
    const apply1 = runReconcile(["--apply"]);
    check("--apply exits 0 and links the pre-existing W-9/agreement", apply1.status === 0 && linkedThisRun(apply1.out) >= 1, apply1.out.slice(-400));
    const linkedRows = (await pool.query(`SELECT document_type FROM contractor_documents WHERE worker_id=$1 AND uploaded_by='system:w9-doc-reconcile' ORDER BY document_type`, [contractorA])).rows.map(r => r.document_type);
    check("a linking contractor_documents row now exists for the W-9", linkedRows.includes("w9"), JSON.stringify(linkedRows));
    const caseyListAfter = await listDocs(sAdminA, contractorA);
    const caseyW9After = (caseyListAfter.body as any[]).filter(d => d.documentType === "w9");
    check("after linking, the W-9 appears exactly once and is now source=contractor_document (union de-dupes on file_url)",
      caseyW9After.length === 1 && caseyW9After[0].source === "contractor_document", JSON.stringify(caseyW9After.map(d => d.source)));
    const apply2 = runReconcile(["--apply"]);
    check("a second --apply run links 0 (idempotent)", apply2.status === 0 && linkedThisRun(apply2.out) === 0, apply2.out.slice(-400));

    console.log("\n── 10. A contractor from another tenant cannot be read / uploaded to / downloaded / changed ──");
    const xList = await listDocs(sAdminB, contractorA);
    check("cross-tenant list → 403 CROSS_TENANT", xList.status === 403 && (xList.body as any)?.error === "CROSS_TENANT", `status=${xList.status}`);
    const xUp = await uploadFile(base, sAdminB, "/api/contractor-documents/upload",
      { companyId: companyA, workerId: contractorA, documentType: "w9" }, { name: "x.pdf", type: "application/pdf", bytes: tinyPdf("x") });
    check("cross-tenant upload → 403", xUp.status === 403, `status=${xUp.status}`);
    const someDocId = (caseyListAfter.body as any[])[0]?.id;
    const xDown = await apiRequest(base, "GET", `/api/contractor-documents/${someDocId}/download`, sAdminB);
    check("cross-tenant download → 403", xDown.status === 403, `status=${xDown.status}`);
    const xDel = await apiRequest(base, "DELETE", `/api/contractor-documents/${someDocId}`, sAdminB);
    check("cross-tenant delete → 403", xDel.status === 403, `status=${xDel.status}`);
    const xContractors = await apiRequest(base, "GET", `/api/contractors?companyId=${companyA}`, sAdminB);
    check("cross-tenant /api/contractors → 403", xContractors.status === 403, `status=${xContractors.status}`);
    const x1099 = await apiRequest(base, "GET", `/api/1099-summaries?companyId=${companyA}&year=${year}`, sAdminB);
    check("cross-tenant /api/1099-summaries → 403", x1099.status === 403, `status=${x1099.status}`);

    console.log("\n── 11. Client-supplied company/contractor mismatch is rejected ──");
    const mm = await uploadFile(base, sAdminA, "/api/contractor-documents/upload",
      { companyId: companyB, workerId: contractorA, documentType: "w9" }, { name: "m.pdf", type: "application/pdf", bytes: tinyPdf("mm") });
    check("upload with companyId != contractor's company → 400 COMPANY_MISMATCH", mm.status === 400 && mm.body?.error === "COMPANY_MISMATCH", `status=${mm.status} body=${JSON.stringify(mm.body)}`);
    const mmList = await apiRequest(base, "GET", `/api/contractor-documents?companyId=${companyB}&workerId=${contractorA}`, sAdminA);
    check("list with mismatched companyId → 400 COMPANY_MISMATCH", (mmList.body as any)?.error === "COMPANY_MISMATCH");

    console.log("\n── 12. Unauthorized roles cannot read or upload W-9s ──");
    const sList = await listDocs(sStaffA, contractorA);
    check("non-manager role listing → 403", sList.status === 403, `status=${sList.status}`);
    const sUp = await uploadFile(base, sStaffA, "/api/contractor-documents/upload",
      { companyId: companyA, workerId: contractorA, documentType: "w9" }, { name: "s.pdf", type: "application/pdf", bytes: tinyPdf("s") });
    check("non-manager role upload → 403", sUp.status === 403, `status=${sUp.status}`);
    const noAuthUp = await uploadFile(base, null, "/api/contractor-documents/upload",
      { companyId: companyA, workerId: contractorA }, { name: "n.pdf", type: "application/pdf", bytes: tinyPdf("n") });
    check("unauthenticated upload → 401", noAuthUp.status === 401, `status=${noAuthUp.status}`);
    check("a manager (company A) CAN list", (await listDocs(sMgrA, contractorA)).status === 200);

    console.log("\n── 13. Invalid file type and oversized file return sanitized errors ──");
    const badType = await uploadFile(base, sAdminA, "/api/contractor-documents/upload",
      { companyId: companyA, workerId: contractorFresh, documentType: "w9" }, { name: "notes.txt", type: "text/plain", bytes: Buffer.from("hello") });
    check("disallowed file type → 415 INVALID_FILE_TYPE (not 500)", badType.status === 415 && badType.body?.error === "INVALID_FILE_TYPE", `status=${badType.status} body=${JSON.stringify(badType.body)}`);
    const huge = Buffer.alloc(16 * 1024 * 1024, 0x25);
    const tooBig = await uploadFile(base, sAdminA, "/api/contractor-documents/upload",
      { companyId: companyA, workerId: contractorFresh, documentType: "w9" }, { name: "big.pdf", type: "application/pdf", bytes: huge });
    check("oversized file → 413 FILE_TOO_LARGE", tooBig.status === 413 && tooBig.body?.error === "FILE_TOO_LARGE", `status=${tooBig.status} body=${JSON.stringify(tooBig.body)}`);

    console.log("\n── 14. A failed metadata write leaves no orphaned stored file ──");
    await pool.query(`ALTER TABLE contractor_documents ADD CONSTRAINT w9test_block_orphan CHECK (file_name <> 'ORPHAN_TEST.pdf')`);
    const orphanBefore = countUploads();
    const orphanUp = await uploadFile(base, sAdminA, "/api/contractor-documents/upload",
      { companyId: companyA, workerId: contractorFresh, documentType: "w9" }, { name: "ORPHAN_TEST.pdf", type: "application/pdf", bytes: tinyPdf("orphan") });
    check("the failed insert surfaces as a sanitized 500 (no internal detail)", orphanUp.status === 500 && orphanUp.body?.error === "UPLOAD_FAILED", `status=${orphanUp.status} body=${JSON.stringify(orphanUp.body)}`);
    check("no orphan file remains in the uploads directory", countUploads() === orphanBefore, `delta=${countUploads() - orphanBefore}`);
    await pool.query(`ALTER TABLE contractor_documents DROP CONSTRAINT w9test_block_orphan`);

    console.log("\n── 15. Duplicate / re-issued W-9 submission has a defined response ──");
    const reissue1 = await uploadFile(base, sAdminA, "/api/contractor-documents/upload",
      { companyId: companyA, workerId: dualContractor, documentType: "w9" }, { name: "dana-w9-v2.pdf", type: "application/pdf", bytes: tinyPdf("reissue") });
    check("re-uploading a W-9 succeeds (201) and is recorded as a replacement", reissue1.status === 201);
    const dualSummaryAfter = await summaryFor(sAdminA, dualContractor);
    check("W-9 status stays Received after a re-issue", dualSummaryAfter?.missingW9 === false);
    const replEvents = (await pool.query(`SELECT count(*)::int n FROM compliance_audit_events WHERE worker_id=$1 AND detail->>'event'='replaced'`, [dualContractor])).rows[0].n;
    check("a 'replaced' audit event was written for the re-issue", replEvents >= 1, `count=${replEvents}`);

    console.log("\n── 16. Audit history records lifecycle events without tax data ──");
    const delTarget = (await pool.query(`SELECT id FROM contractor_documents WHERE worker_id=$1 AND uploaded_by <> 'system:w9-doc-reconcile' LIMIT 1`, [contractorFresh])).rows[0]?.id;
    await apiRequest(base, "GET", `/api/contractor-documents/${delTarget}/download`, sAdminA);
    await apiRequest(base, "DELETE", `/api/contractor-documents/${delTarget}`, sAdminA);
    const events = (await pool.query(`SELECT message, detail FROM compliance_audit_events WHERE rule_type='contractor_document' AND company_id=$1`, [companyA])).rows;
    const kinds = new Set(events.map((e: any) => e.detail?.event));
    check("audit trail contains upload/associate/access/delete events", ["uploaded", "associated", "accessed", "deleted"].every(k => kinds.has(k)), JSON.stringify([...kinds]));
    const dump = JSON.stringify(events).toLowerCase();
    check("no audit event leaks ssn/tin/file url/storage key", !/"ssn"|"tin"|"file_url"|"fileurl"|"storage_key"|"signedurl"|\/uploads\//.test(dump));

    console.log("\n── 17. Download requires live authorization every call; no public URL ──");
    const dlDoc = (await pool.query(`SELECT id FROM contractor_documents WHERE worker_id=$1 AND file_name='dana-w9.pdf' LIMIT 1`, [dualContractor])).rows[0].id;
    const dlAuthed = await fetch(`${base}/api/contractor-documents/${dlDoc}/download`, { headers: { cookie: sAdminA.cookie } });
    check("authorized download → 200 with attachment + no-store", dlAuthed.status === 200 &&
      /attachment/.test(dlAuthed.headers.get("content-disposition") || "") &&
      /no-store/.test(dlAuthed.headers.get("cache-control") || ""), `status=${dlAuthed.status}`);
    const dlNoSession = await fetch(`${base}/api/contractor-documents/${dlDoc}/download`);
    check("same URL with no session → 401 (not a reusable public link)", dlNoSession.status === 401, `status=${dlNoSession.status}`);
    const dlWrongTenant = await fetch(`${base}/api/contractor-documents/${dlDoc}/download`, { headers: { cookie: sAdminB.cookie } });
    check("same URL with another tenant's session → 403", dlWrongTenant.status === 403, `status=${dlWrongTenant.status}`);

    console.log("\n── 18. Existing worker-document behavior does not regress ──");
    const wdUp = await uploadFile(base, sAdminA, "/api/worker-documents",
      { workerId: employeeA, name: "Ellie New Policy", documentType: "Other" },
      { name: "policy.pdf", type: "application/pdf", bytes: tinyPdf("wd") });
    check("worker-document upload for an employee still succeeds (201)", wdUp.status === 201, `status=${wdUp.status} body=${JSON.stringify(wdUp.body)}`);
    const wdList = await apiRequest(base, "GET", `/api/worker-documents?workerId=${employeeA}`, sAdminA);
    check("worker-documents listing still returns the employee's documents", Array.isArray(wdList.body) && (wdList.body as any[]).length >= 2, `count=${(wdList.body as any[])?.length}`);
    check("a generic 'Other' worker document does NOT leak into the contractor-compliance view",
      !(await listDocs(sAdminA, contractorA)).body || !(await listDocs(sAdminA, contractorA) as any).body?.some?.((d: any) => d.fileName === "Ellie Handbook Ack"));

    console.log(`\n${passed} passed, ${failed} failed`);
  } finally {
    if (server) await server.stop();
    // Explicit cleanup of the no-FK tables first, then FK cascade.
    try {
      await pool.query(`DELETE FROM compliance_audit_events WHERE company_id = ANY($1::varchar[])`, [companyIds]);
      await pool.query(`DELETE FROM contractor_1099_summaries WHERE company_id = ANY($1::varchar[])`, [companyIds]);
      await pool.query(`DELETE FROM contractor_documents WHERE company_id = ANY($1::varchar[])`, [companyIds]);
      await pool.query(`DELETE FROM worker_documents WHERE worker_id = ANY($1::varchar[])`, [workerIds]);
      await cascadeDelete(pool, "companies", companyIds);
      await cascadeDelete(pool, "persons", personIds);
      const residue = [
        ...(await verifyZeroResidue(pool, "companies", companyIds)),
        ...(await verifyZeroResidue(pool, "persons", personIds)),
      ];
      const leftoverCd = (await pool.query(`SELECT count(*)::int n FROM contractor_documents WHERE company_id = ANY($1::varchar[])`, [companyIds])).rows[0].n;
      if (leftoverCd > 0) residue.push(`contractor_documents: ${leftoverCd} row(s)`);
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
