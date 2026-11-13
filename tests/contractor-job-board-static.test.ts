/**
 * Contractor Hub job board — static wiring guards (no DB, no server).
 * Run: npx tsx tests/contractor-job-board-static.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const service = fs.readFileSync("server/contractor-jobs/service.ts", "utf8");
const migration = fs.readFileSync("migrations/0029_contractor_job_board.sql", "utf8");
const uploadsAccess = fs.readFileSync("server/uploads-access.ts", "utf8");
const orchestrator = fs.readFileSync("server/workers/orchestrator.ts", "utf8");

let pass = 0, fail = 0;
function t(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); } catch (e) { fail++; console.error(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const start = routes.indexOf("// ── CONTRACTOR HUB JOB BOARD (migration 0029)");
const end = routes.indexOf("// ── CONTRACTOR PROPOSALS ──");
const block = routes.slice(start, end);

// Every app.<verb>(...) registration in the block, with its middleware list (up to the handler).
const regs = Array.from(block.matchAll(/app\.(get|post|patch|put|delete)\(\s*([`"][^`"]+[`"])\s*,([\s\S]*?)(?:jobBoardRoute|postTransition|bidReview)\(/g))
  .map((m) => ({ verb: m[1], path: m[2].slice(1, -1), mw: m[3] }));

t("job-board route block exists before the proposal routes", () => {
  assert.ok(start > 0 && end > start);
  assert.ok(regs.length >= 20, `found ${regs.length} registrations`);
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
    "get /api/contractor-jobs", "post /api/contractor-jobs", "patch /api/contractor-jobs/:id",
    "get /api/contractor-jobs/:id/events", "get /api/contractor-jobs/:id/bids",
    "get /api/contractor-jobs/:id/invitations", "post /api/contractor-jobs/:id/invitations",
    "post /api/contractor-job-invitations/:invitationId/revoke", "post /api/contractor-job-questions/:questionId/answer",
    "post /api/contractor-jobs/:id/attachments", "post /api/contractor-job-bids/:bidId/award",
  ];
  for (const key of adminPaths) {
    const r = regs.find((x) => `${x.verb} ${x.path}` === key);
    assert.ok(r, `missing ${key}`);
    assert.ok(r!.mw.includes('requireRole("admin", "manager")'), `${key} missing requireRole("admin", "manager")`);
  }
  for (const a of ["publish", "pause", "reopen", "close", "archive"]) {
    const r = regs.find((x) => x.verb === "post" && x.path === `/api/contractor-jobs/:id/${a}`);
    assert.ok(r && r.mw.includes('requireRole("admin", "manager")'), `transition ${a} missing or ungated`);
  }
  for (const a of ["review", "shortlist", "request-revision", "reject"]) {
    const r = regs.find((x) => x.verb === "post" && x.path === `/api/contractor-job-bids/:bidId/${a}`);
    assert.ok(r && r.mw.includes('requireRole("admin", "manager")'), `review ${a} missing or ungated`);
  }
  assert.ok(!/app\.(get|post|patch)\(\s*`/.test(block), "every path is a string literal (route inventory must see it)");
});
t("manager gate is requireRole('admin','manager') + canAccessCompany — platform_support/_implementation get no alias", () => {
  assert.ok(!block.includes("JOB_MANAGER"), "inline the role gate so the route inventory records roleArgs");
  assert.ok(/isManager && await canAccessCompany\(user, companyId\)/.test(block), "service authz uses canAccessCompany");
});
t("static paths are registered before /:id", () => {
  const idx = (p: string) => block.indexOf(`"${p}"`);
  assert.ok(idx("/api/contractor-jobs/available") < idx("/api/contractor-jobs/:id"));
  assert.ok(idx("/api/contractor-jobs/summary") < idx("/api/contractor-jobs/:id"));
});
t("award reads the Idempotency-Key header", () => assert.ok(/awardBid\([^)]*req\.get\("Idempotency-Key"\)/.test(block)));
t("attachment download is forced to download, nosniff, no-store", () => {
  assert.ok(block.includes('"Content-Disposition", `attachment;'));
  assert.ok(block.includes('"X-Content-Type-Options", "nosniff"'));
  assert.ok(block.includes('"Cache-Control", "private, no-store"'));
});

t("attachments never use the public /uploads store", () => {
  assert.ok(!/resolvedUploadDir|["'`]\/uploads/.test(service), "service references /uploads");
  assert.ok(!uploadsAccess.includes("contractor_job_attachments"), "uploads-access must not serve job attachments");
  assert.ok(block.includes("multer.memoryStorage()"), "upload buffered in memory, written to the private store by the service");
  assert.ok(service.includes('mode: 0o600, flag: "wx"'));
});
t("service never hard-deletes", () => assert.ok(!/\bDELETE\s+FROM\b/i.test(service)));
t("notifications never include amounts", () => {
  const notes = Array.from(service.matchAll(/notify(?:Workers|CompanyAdmins)\([\s\S]*?\}\);/g)).map((m) => m[0]);
  assert.ok(notes.length >= 10, `found ${notes.length}`);
  for (const n of notes) assert.ok(!/\b(amount|rate|hourly_rate|budget)\b|proposed_|\$\{[^}]*(amount|rate|budget)/i.test(n.replace(/actionUrl[^,]*/g, "")), n.slice(0, 120));
});
t("notifications are in-app only (no email/SMS send)", () => assert.ok(!/sendGenericNotification|sendEmail|sendSms|twilio/i.test(service)));
t("every state change writes an event in the same transaction", () => {
  for (const fn of ["createPost", "updatePost", "transitionPost", "createBid", "updateBid", "submitBid", "withdrawBid", "reviewBid", "awardBid", "inviteContractors", "revokeInvitation", "askQuestion", "answerQuestion", "addPostAttachment", "addBidAttachment", "removeAttachment"]) {
    const s = service.indexOf(`export function ${fn}(`);
    assert.ok(s > 0, fn);
    const next = service.indexOf("\nexport ", s + 10);
    const body = service.slice(s, next > 0 ? next : undefined);
    assert.ok(/await event\(c,/.test(body), `${fn} writes no event`);
    assert.ok(/tx\(deps\.pool/.test(body), `${fn} not transactional`);
  }
});
t("award locks posting then bid, and links the proposal through job_post_id/job_bid_id (not job_id)", () => {
  const s = service.indexOf("export function awardBid(");
  const body = service.slice(s, service.indexOf("\nexport ", s + 10));
  assert.ok(body.indexOf('loadPost(deps, c, peek.job_post_id, "FOR UPDATE")') < body.indexOf('loadBid(deps, c, bidId, "FOR UPDATE")'));
  assert.ok(/job_post_id, job_bid_id\)/.test(body));
  assert.ok(/post\.cost_job_id/.test(body), "job_id receives the cost job only");
});

t("migration is additive (no DROP TABLE/COLUMN, DELETE, TRUNCATE, RENAME)", () => {
  const sql = migration.replace(/--.*$/gm, "");
  assert.ok(!/\bDROP\s+(TABLE|COLUMN|INDEX|SCHEMA)\b/i.test(sql));
  assert.ok(!/\bDELETE\s+FROM\b|\bTRUNCATE\b|\bRENAME\b/i.test(sql));
  const drops = sql.match(/\bDROP\s+\w+[^;]*;/gi) ?? [];
  for (const d of drops) assert.ok(/^DROP TRIGGER IF EXISTS trg_contractor_job_/i.test(d.trim()), d);
  assert.ok(/ADD COLUMN IF NOT EXISTS job_post_id/.test(sql) && /ADD COLUMN IF NOT EXISTS job_bid_id/.test(sql));
  assert.ok(/INSERT INTO paylink_migrations\.applied[\s\S]*'0029'/.test(sql));
  assert.ok(/^BEGIN;/m.test(sql) && /^COMMIT;/m.test(sql));
});
t("migration enforces one active bid, one proposal per bid, immutable audit rows", () => {
  assert.ok(/uq_contractor_job_bids_active ON contractor_job_bids \(job_post_id, contractor_id\) WHERE status <> 'withdrawn'/.test(migration));
  assert.ok(/uq_contractor_proposals_job_bid_id ON contractor_proposals \(job_bid_id\) WHERE job_bid_id IS NOT NULL/.test(migration));
  assert.ok(/BEFORE UPDATE ON contractor_job_bid_events/.test(migration));
  assert.ok(/BEFORE UPDATE ON contractor_job_bid_versions/.test(migration));
  assert.ok(!/BEFORE (UPDATE OR )?DELETE/.test(migration), "DELETE triggers would wedge the demo-tenant purge");
});
t("maintenance job is scheduled in the orchestrator", () => {
  assert.ok(/scheduleJob\("ContractorJobBoard",\s*jobContractorJobBoardMaintenance/.test(orchestrator));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
