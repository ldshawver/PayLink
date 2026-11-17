/**
 * Job board — static wiring guards (no DB, no server). Pins the route gates,
 * the separation of the contractor proposal path from the employee
 * application path, the private-HR-document handling, and the additive,
 * classification-enforcing migration.
 * Run: npx tsx tests/contractor-job-board-static.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const service = fs.readFileSync("server/job-board/service.ts", "utf8");
const employment = fs.readFileSync("server/job-board/employment.ts", "utf8");
const migration = fs.readFileSync("migrations/0029_job_board.sql", "utf8");
const uploadsAccess = fs.readFileSync("server/uploads-access.ts", "utf8");
const orchestrator = fs.readFileSync("server/workers/orchestrator.ts", "utf8");

let pass = 0, fail = 0;
function t(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); } catch (e) { fail++; console.error(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/--.*$/gm, "");
const fnBody = (src: string, name: string) => {
  const s = src.indexOf(`export function ${name}(`);
  assert.ok(s > 0, `missing ${name}`);
  const next = src.indexOf("\nexport ", s + 10);
  return src.slice(s, next > 0 ? next : undefined);
};

const start = routes.indexOf("// ── JOB BOARD (migration 0029)");
const end = routes.indexOf("// ── JOB BOARD: public discovery, access requests, applicant identities (migration 0030)");
const block = routes.slice(start, end);

// Every app.<verb>(...) registration in the block, with its middleware list (up to the handler).
const regs = Array.from(block.matchAll(/app\.(get|post|patch|put|delete)\(\s*([`"][^`"]+[`"])\s*,([\s\S]*?)(?:jobBoardRoute|postTransition|bidReview|applicationStep)\(/g))
  .map((m) => ({ verb: m[1], path: m[2].slice(1, -1), mw: m[3] }));
const reg = (key: string) => regs.find((x) => `${x.verb} ${x.path}` === key);
const ADMIN = "JOB_ADMIN";

t("job-board route block exists before the proposal routes", () => {
  assert.ok(start > 0 && end > start);
  assert.ok(regs.length >= 40, `found ${regs.length} registrations`);
  assert.ok(block.includes('const JOB_ADMIN = requireRole("admin", "manager");'));
});
t("no DELETE or PUT routes (no hard delete, no generic update)", () => {
  assert.equal(regs.filter((r) => r.verb === "delete" || r.verb === "put").length, 0);
  assert.ok(!/\/status["`]/.test(block), "no generic /status endpoint");
});
t("every route requires auth and the contractor-hub feature", () => {
  for (const r of regs) {
    assert.ok(r.mw.includes("requireAuth"), `${r.verb} ${r.path} missing requireAuth`);
    assert.ok(r.mw.includes("JOB_FEATURE"), `${r.verb} ${r.path} missing JOB_FEATURE`);
  }
});
t("every mutation carries CSRF protection and the demo write block", () => {
  for (const r of regs.filter((x) => x.verb !== "get")) {
    assert.ok(r.mw.includes("requireCsrfToken"), `${r.verb} ${r.path} missing requireCsrfToken`);
    assert.ok(r.mw.includes("blockDemoWrites"), `${r.verb} ${r.path} missing blockDemoWrites`);
  }
});
t("administrator endpoints are role-gated", () => {
  const adminPaths = [
    "get /api/job-posts", "post /api/job-posts", "patch /api/job-posts/:id", "get /api/job-posts/:id/events",
    "post /api/job-posts/:id/attachments",
    "get /api/job-posts/:id/bids", "get /api/job-posts/:id/invitations", "post /api/job-posts/:id/invitations",
    "post /api/contractor-job-invitations/:invitationId/revoke", "post /api/contractor-job-questions/:questionId/answer",
    "post /api/contractor-job-bids/:bidId/award",
    "get /api/job-posts/:id/applications", "post /api/job-posts/:id/screening-questions",
    "post /api/job-screening-questions/:questionId/archive", "post /api/employment-applications/:applicationId/convert-to-worker",
  ];
  for (const key of adminPaths) {
    const r = reg(key);
    assert.ok(r, `missing ${key}`);
    assert.ok(r!.mw.includes(ADMIN), `${key} missing ${ADMIN}`);
  }
  for (const a of ["publish", "pause", "reopen", "close", "archive"]) {
    const r = reg(`post /api/job-posts/:id/${a}`);
    assert.ok(r && r.mw.includes(ADMIN), `transition ${a} missing or ungated`);
  }
  for (const a of ["review", "shortlist", "request-revision", "reject"]) {
    const r = reg(`post /api/contractor-job-bids/:bidId/${a}`);
    assert.ok(r && r.mw.includes(ADMIN), `proposal review ${a} missing or ungated`);
  }
  for (const a of ["review", "interview", "offer", "hire", "reject"]) {
    const r = reg(`post /api/employment-applications/:applicationId/${a}`);
    assert.ok(r && r.mw.includes(ADMIN), `application step ${a} missing or ungated`);
  }
  assert.ok(!/app\.(get|post|patch)\(\s*`/.test(block), "every path is a string literal (route inventory must see it)");
});
t("manager gate = role + canAccessCompany — platform_support/_implementation get no alias", () => {
  assert.ok(/isManager && await canAccessCompany\(user, companyId\)/.test(block));
});
t("static paths are registered before /:id", () => {
  const idx = (p: string) => block.indexOf(`"${p}"`);
  assert.ok(idx("/api/job-posts/available") < idx("/api/job-posts/:id"));
  assert.ok(idx("/api/job-posts/summary") < idx("/api/job-posts/:id"));
  assert.ok(idx("/api/employment-applications/mine") < idx("/api/employment-applications/:applicationId"));
});
t("award reads the Idempotency-Key header", () => assert.ok(/awardBid\([^)]*req\.get\("Idempotency-Key"\)/.test(block)));
t("publish passes the classification acknowledgement through", () => assert.ok(/acknowledgeClassification: req\.body\?\.acknowledgeClassification === true/.test(block)));
t("private downloads are forced to download, nosniff, no-store", () => {
  assert.ok(block.includes('"Content-Disposition", `attachment;'));
  assert.ok(block.includes('"X-Content-Type-Options", "nosniff"'));
  assert.ok(block.includes('"Cache-Control", "private, no-store"'));
  for (const p of ["get /api/job-post-attachments/:attachmentId/download", "get /api/employment-application-documents/:documentId/download"]) {
    assert.ok(reg(p)?.mw.includes("requireAuth"), `${p} must require auth`);
  }
});

console.log("separation of the two paths");
t("the employee module never touches proposals, contracts, invoices, contractor payments or bids", () => {
  const code = stripComments(employment);
  for (const table of ["contractor_proposals", "contractor_contracts", "invoices", "contractor_payments", "contractor_job_bids", "proposal_approval_events"]) {
    assert.ok(!new RegExp(`\\b${table}\\b`).test(code), `employment.ts references ${table}`);
  }
  assert.ok(!/awardBid|createBid|awardProposalAmount/.test(code));
});
t("the contractor award never reads employment applications", () => {
  assert.ok(!/employment_applications/.test(fnBody(service, "awardBid")));
});
t("every contractor-only operation checks the posting classification", () => {
  for (const fn of ["awardBid", "inviteContractors", "askQuestion", "addBidAttachment"]) {
    assert.ok(/requireContractorPost\(post\)/.test(fnBody(service, fn)), `${fn} lacks requireContractorPost`);
  }
  assert.ok(/requireContractorPost\(post\)/.test(service.slice(service.indexOf("async function assertContractorMayBid"))), "bids check classification");
});
t("every employee operation checks the posting classification", () => {
  assert.ok(/requireEmployeePost\(post\)/.test(employment.slice(employment.indexOf("async function assertMayApply"))));
  for (const fn of ["addScreeningQuestion", "listApplicationsForPost", "transitionApplication", "convertApplicationToWorker", "addApplicationDocument"]) {
    assert.ok(/requireEmployeePost\(post\)/.test(fnBody(employment, fn)), `${fn} lacks requireEmployeePost`);
  }
});
t("conversion takes worker_type from the posting, never from the request", () => {
  const body = fnBody(employment, "convertApplicationToWorker");
  assert.ok(/const workerType = post\.worker_classification;/.test(body));
  assert.ok(/requested != null && requested !== post\.worker_classification/.test(body), "a different requested type is refused");
  assert.ok(/body\?\.confirm !== true/.test(body), "explicit confirmation required");
  assert.ok(/'inactive_temporary',FALSE/.test(body), "new worker starts inactive (outside payroll until onboarding)");
  assert.ok(!/UPDATE workers/.test(body), "an applicant's existing worker record is never modified");
});
t("HR documents use their own private store, never /uploads or the job-attachment store", () => {
  assert.ok(/PRIVATE_HR_STORAGE_DIR/.test(employment));
  assert.ok(!/PRIVATE_STORAGE_DIR\b/.test(employment.replace(/PRIVATE_HR_STORAGE_DIR/g, "")));
  assert.ok(!/["'`]\/uploads/.test(employment));
  assert.ok(!uploadsAccess.includes("employment_application_documents") && !uploadsAccess.includes("job_post_attachments"));
  assert.ok(employment.includes('mode: 0o600, flag: "wx"'));
});
t("every administrator read of an HR document is audited", () => {
  const body = fnBody(employment, "authorizeApplicationDocumentDownload");
  assert.ok(/type: "document_viewed"/.test(body));
  assert.ok(/applicationVisibleToAdmin\(app\)/.test(body), "unsent drafts stay private even from admins");
});

console.log("service hygiene");
t("job attachments never use the public /uploads store", () => {
  assert.ok(!/resolvedUploadDir|["'`]\/uploads/.test(service));
  assert.ok(block.includes("multer.memoryStorage()"));
  assert.ok(service.includes('mode: 0o600, flag: "wx"'));
});
t("neither module hard-deletes", () => {
  assert.ok(!/\bDELETE\s+FROM\b/i.test(service));
  assert.ok(!/\bDELETE\s+FROM\b/i.test(employment));
});
t("notifications are in-app only — no email/SMS sender anywhere in the job board", () => {
  for (const src of [service, employment]) {
    assert.ok(!/sendGenericNotification|sendEmail|sendSms|sendMail|twilio|nodemailer|resend|postmark/i.test(stripComments(src)));
  }
});
t("notifications never include amounts or compensation", () => {
  const notes = [service, employment].flatMap((src) => Array.from(src.matchAll(/notify(?:Workers|CompanyAdmins)\([\s\S]*?\}\);/g)).map((m) => m[0]));
  assert.ok(notes.length >= 14, `found ${notes.length}`);
  for (const n of notes) assert.ok(!/\b(amount|rate|hourly_rate|compensation|salary)\b|proposed_|desired_|\$\{[^}]*(amount|rate|compensation)/i.test(n.replace(/actionUrl[^,]*/g, "")), n.slice(0, 120));
});
t("every posting/proposal state change writes an event in the same transaction", () => {
  for (const fn of ["createPost", "updatePost", "transitionPost", "createBid", "updateBid", "submitBid", "withdrawBid", "reviewBid", "awardBid", "inviteContractors", "revokeInvitation", "askQuestion", "answerQuestion", "addPostAttachment", "addBidAttachment", "removeAttachment"]) {
    const body = fnBody(service, fn);
    assert.ok(/await event\(c,/.test(body), `${fn} writes no event`);
    assert.ok(/tx\(deps\.pool/.test(body), `${fn} not transactional`);
  }
});
t("every application state change writes an event in the same transaction", () => {
  for (const fn of ["createApplication", "updateApplication", "submitApplication", "withdrawApplication", "transitionApplication", "convertApplicationToWorker", "addApplicationDocument", "removeApplicationDocument"]) {
    const body = fnBody(employment, fn);
    assert.ok(/await appEvent\(c,/.test(body), `${fn} writes no event`);
    assert.ok(/tx\(deps\.pool/.test(body), `${fn} not transactional`);
  }
  for (const fn of ["addScreeningQuestion", "archiveScreeningQuestion"]) assert.ok(/await postEvent\(c,/.test(fnBody(employment, fn)), fn);
});
t("classification declarations and changes are audited", () => {
  assert.ok(/type: "classification_declared"/.test(fnBody(service, "createPost")));
  assert.ok(/type: "classification_changed"/.test(fnBody(service, "updatePost")));
  assert.ok(/type: "classification_indicators_acknowledged"/.test(fnBody(service, "transitionPost")));
});
t("award locks posting then bid, and links the proposal through job_post_id/job_bid_id (not job_id)", () => {
  const body = fnBody(service, "awardBid");
  assert.ok(body.indexOf('loadPost(deps, c, peek.job_post_id, "FOR UPDATE")') < body.indexOf('loadBid(deps, c, bidId, "FOR UPDATE")'));
  assert.ok(/job_post_id, job_bid_id\)/.test(body));
  assert.ok(/post\.cost_job_id/.test(body));
});

console.log("migration");
t("migration is additive (no DROP TABLE/COLUMN, DELETE, TRUNCATE, RENAME)", () => {
  const sql = stripComments(migration);
  assert.ok(!/\bDROP\s+(TABLE|COLUMN|INDEX|SCHEMA|FUNCTION)\b/i.test(sql));
  assert.ok(!/\bDELETE\s+FROM\b|\bTRUNCATE\b|\bRENAME\b/i.test(sql));
  for (const d of sql.match(/\bDROP\s+\w+[^;]*;/gi) ?? []) assert.ok(/^DROP TRIGGER IF EXISTS trg_/i.test(d.trim()), d);
  assert.ok(/ADD COLUMN IF NOT EXISTS job_post_id/.test(sql) && /ADD COLUMN IF NOT EXISTS job_bid_id/.test(sql));
  assert.ok(/INSERT INTO paylink_migrations\.applied[\s\S]*'0029'/.test(sql));
  assert.ok(/^BEGIN;/m.test(sql) && /^COMMIT;/m.test(sql));
});
t("classification is required and enforced by CHECKs", () => {
  assert.ok(/worker_classification\s+TEXT NOT NULL CHECK \(worker_classification IN \('contractor','employee'\)\)/.test(migration));
  assert.ok(/ck_job_posts_opportunity_class CHECK \(\(worker_classification = 'employee'\) = \(opportunity_type = 'position'\)\)/.test(migration));
  assert.ok(/ck_job_posts_employment_type/.test(migration) && /ck_job_posts_employee_comp/.test(migration));
});
t("classification frozen after draft by trigger", () => {
  assert.ok(/BEFORE UPDATE OF worker_classification ON job_posts/.test(migration));
  assert.ok(/OLD\.status <> 'draft'/.test(migration));
});
t("submission tables are bound to the right classification by trigger", () => {
  for (const [table, cls] of [["contractor_job_bids", "contractor"], ["contractor_job_invitations", "contractor"], ["contractor_job_questions", "contractor"],
    ["employment_applications", "employee"], ["job_screening_questions", "employee"]]) {
    assert.ok(new RegExp(`ON ${table}\\s+FOR EACH ROW EXECUTE FUNCTION job_board_require_classification\\('${cls}'\\)`).test(migration), `${table} → ${cls}`);
  }
  assert.ok(/ON contractor_proposals\s+FOR EACH ROW WHEN \(NEW\.job_post_id IS NOT NULL\)\s+EXECUTE FUNCTION job_board_require_classification\('contractor'\)/.test(migration));
});
t("application tables have no link to proposals, contracts, invoices or payments", () => {
  const sec = migration.slice(migration.indexOf("EMPLOYEE PATH"), migration.indexOf("Audit immutability"));
  assert.ok(sec.length > 1000);
  assert.ok(!/REFERENCES (contractor_proposals|contractor_contracts|invoices|contractor_payments|contractor_job_bids)/.test(sec));
  assert.ok(/converted_worker_type\s+TEXT CHECK \(converted_worker_type IS NULL OR converted_worker_type = 'employee'\)/.test(sec));
});
t("one active bid / application each; one proposal per bid; immutable audit rows", () => {
  assert.ok(/uq_contractor_job_bids_active ON contractor_job_bids \(job_post_id, contractor_id\) WHERE status <> 'withdrawn'/.test(migration));
  assert.ok(/uq_employment_applications_active ON employment_applications \(job_post_id, applicant_user_id\) WHERE status <> 'withdrawn'/.test(migration));
  assert.ok(/uq_contractor_proposals_job_bid_id ON contractor_proposals \(job_bid_id\) WHERE job_bid_id IS NOT NULL/.test(migration));
  for (const t2 of ["job_post_events", "contractor_job_bid_events", "contractor_job_bid_versions", "employment_application_events"]) {
    assert.ok(new RegExp(`BEFORE UPDATE ON ${t2}\\b`).test(migration), t2);
  }
  assert.ok(!/BEFORE (UPDATE OR )?DELETE/.test(migration), "DELETE triggers would wedge the demo-tenant purge");
});
t("maintenance job is scheduled in the orchestrator", () => {
  assert.ok(/scheduleJob\("ContractorJobBoard",\s*jobContractorJobBoardMaintenance/.test(orchestrator));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
