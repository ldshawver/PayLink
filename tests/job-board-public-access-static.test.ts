/**
 * Job board public discovery + applicant access — static wiring guards.
 * No DB, no server. Run: npx tsx tests/job-board-public-access-static.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { PUBLIC_POST_FIELDS, projectPostForPublic, normalizeCode, codeLookupHash, tokenHash, generateCode, effectivePublicVisibility } from "../server/job-board/public-access";

const routes = fs.readFileSync("server/routes.ts", "utf8");
const pub = fs.readFileSync("server/job-board/public-access.ts", "utf8");
const vis = fs.readFileSync("server/job-board/applicant-visibility.ts", "utf8");

let pass = 0, fail = 0;
function t(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); } catch (e) { fail++; console.error(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const start = routes.indexOf("// ── JOB BOARD: public discovery, access requests, applicant identities (migration 0030)");
const end = routes.indexOf("// ── CONTRACTOR PROPOSALS ──");
const block = routes.slice(start, end);
const regs = Array.from(block.matchAll(/app\.(get|post|patch|put|delete)\(\s*"([^"]+)"\s*,([\s\S]*?)(?:publicRoute|publicAdminRoute)\(/g))
  .map((m) => ({ verb: m[1], path: m[2], mw: m[3] }));

console.log("routes");
t("route block exists", () => assert.ok(start > 0 && end > start && regs.length >= 16, `found ${regs.length}`));
t("no DELETE/PUT routes", () => assert.equal(regs.filter((r) => r.verb === "delete" || r.verb === "put").length, 0));
t("public routes: POST only (code never in a URL), each rate-limited, never requireAuth", () => {
  const pubRegs = regs.filter((r) => r.path.startsWith("/api/public/job-board/"));
  assert.equal(pubRegs.length, 4);
  for (const r of pubRegs) {
    assert.equal(r.verb, "post", r.path);
    assert.ok(/RateLimit\b/.test(r.mw), `${r.path} not rate limited`);
    assert.ok(!r.mw.includes("requireAuth"), r.path);
  }
});
t("every admin route: auth + feature + admin role; mutations: CSRF + demo block", () => {
  for (const r of regs.filter((x) => !x.path.startsWith("/api/public/"))) {
    for (const m of ["requireAuth", "JOB_FEATURE", "JOB_ADMIN"]) assert.ok(r.mw.includes(m), `${r.verb} ${r.path} missing ${m}`);
    if (r.verb !== "get") for (const m of ["requireCsrfToken", "blockDemoWrites"]) assert.ok(r.mw.includes(m), `${r.verb} ${r.path} missing ${m}`);
  }
});
t("public failures share one generic body + response floor; missing schema is a 404, never 5xx", () => {
  assert.ok(block.includes("res.status(404).json({ message: PUBLIC_NOT_AVAILABLE })"));
  assert.ok((block.match(/responseFloor\(started, PUBLIC_FLOOR_MS\)/g) ?? []).length >= 6);
  assert.ok(/if \(!\(await publicAccessIsReady\(\)\)\) \{ await responseFloor\(started, PUBLIC_FLOOR_MS\); res\.status\(404\)/.test(block));
  assert.ok(!/res\.status\(5\d\d\)/.test(block.slice(0, block.indexOf("// Administrator: board settings"))));
});
t("access requests always answer the same 202 acknowledgement", () => {
  assert.ok(block.includes("res.status(202).json({ message: ACCESS_REQUEST_ACK })"));
  assert.ok(block.includes('.catch((e) => console.error("[job-board-public] access request write failed:"'), "write errors never change the response");
});
t("schema readiness checks share one in-flight probe (no transient 503 under concurrency)", () => {
  assert.ok(routes.includes("if (inflight) return inflight;"));
  assert.ok(routes.includes("const jobBoardIsReady = readinessMemo("));
  assert.ok(routes.includes("const publicAccessIsReady = readinessMemo("));
});
t("admin endpoints answer 503 (not 5xx crash) until 0030 is applied", () => assert.ok(block.includes('res.status(503).json({ message: "The public job board is not enabled yet." })')));
t("approval / rotation / reissue responses are no-store (one-time secrets)", () => {
  assert.ok((block.match(/res\.setHeader\("Cache-Control", "no-store"\);\n\s+sendJobBoard\(res, await (rotateBoardCode|approveJobBoardAccessRequest|reissueActivation)/g) ?? []).length === 3);
});

t("global auth backstop allowlists exactly the four public endpoints (no prefix)", () => {
  for (const p of ["board", "posting", "access-requests", "activate"]) assert.ok(routes.includes(`|| req.path === "/public/job-board/${p}"`), p);
  assert.ok(!routes.includes('req.path.startsWith("/public/job-board'), "no prefix allowlist");
});

console.log("applicant confinement");
const conf = routes.slice(routes.indexOf("// ── Job-board applicant session confinement"), routes.indexOf("// ── Supplied-companyId gate"));
const allowlistSrc = fs.readFileSync("server/job-board/applicant-api-allowlist.ts", "utf8");
t("confinement middleware exists after the vendor one and before the companyId gate", () => assert.ok(conf.includes('if (role !== "applicant") return next();') && conf.includes("if (isApplicantApiAllowed(req.method, req.path)) return next();")));
t("everything not allowlisted is 403", () => assert.ok(conf.includes('return res.status(403).json({ message: "Applicant accounts can only access their job applications." });')));
t("allowlist is narrow: only job-posts reads/apply, own applications, own documents, own feedback, auth, public", () => {
  const entries = Array.from(allowlistSrc.matchAll(/\["(\*|GET|POST|PATCH)", (\/[^\]]+\/|new RegExp\(`[^`]+`\))\]/g)).map((m) => `${m[1]} ${m[2]}`);
  // 13 job-board/auth/public entries + 4 own-feedback entries (v2.2.21; see feedback-button-placement-static).
  assert.equal(entries.length, 17, entries.join("\n"));
  for (const e of entries) assert.ok(/auth|public|job-posts|employment-application|job-post-attachments|feedback/.test(e), e);
  for (const bad of ["workers", "payroll", "invoice", "contractor-hub", "contractor-job-bids", "time", "schedule", "documents/", "admin", "companies"]) {
    assert.ok(!entries.some((e) => e.includes(bad) && !e.includes("employment-application")), `allowlist mentions ${bad}`);
  }
});
t("applicant actor never gets manager rights; identity only from an ACTIVE job_applicants row", () => {
  assert.ok(routes.includes('const isManager = user.role !== "applicant" && (effective.includes("admin") || effective.includes("manager"));'));
  assert.ok(vis.includes('if (!a || a.status !== "active") return null;'));
});

console.log("public projection");
t("projection returns exactly the allowlisted fields", () => {
  const p = projectPostForPublic({ id: "x", title: "T", public_description: "D", summary: "INTERNAL", scope_of_work: "S", company_id: "C", tenant_id: "T1",
    created_by_user_id: "U", cost_job_id: "J", location_text: "addr", worker_classification: "employee", schedule_type: "full_time",
    work_location_type: "onsite", compensation_type: "salary", compensation_min: "1", compensation_max: "2", public_show_compensation: false, required_skills: ["a"] });
  assert.deepEqual(Object.keys(p).sort(), [...PUBLIC_POST_FIELDS].sort());
  assert.ok(!JSON.stringify(p).match(/INTERNAL|addr|"C"|T1|"U"|"J"/));
  assert.equal(p.compensation, null);
});
t("compensation only when the administrator enabled it (and never for undisclosed)", () => {
  assert.ok(projectPostForPublic({ public_show_compensation: true, compensation_type: "hourly", compensation_max: "30", worker_classification: "employee" }).compensation);
  assert.equal(projectPostForPublic({ public_show_compensation: true, compensation_type: "undisclosed", worker_classification: "employee" }).compensation, null);
});
t("NULL public visibility behaves as access_required (fail closed)", () => {
  assert.equal(effectivePublicVisibility({ public_visibility: null }), "access_required");
  assert.equal(effectivePublicVisibility({ public_visibility: "bogus" }), "access_required");
});
t("public board/posting queries only ever select public_visibility = 'public'", () => {
  for (const m of pub.matchAll(/export async function public(Board|Posting)[\s\S]*?\n\}/g)) assert.ok(m[0].includes("public_visibility = 'public'"), m[0].slice(0, 60));
});

console.log("codes + tokens");
t("codes normalize case/separators and reject short/garbage input", () => {
  assert.equal(normalizeCode("ab-cd ef"), "ABCDEF");
  assert.equal(normalizeCode("abc"), null);
  assert.equal(normalizeCode("!!!"), null);
});
t("generated codes avoid ambiguous characters and are ≥ 10 chars", () => {
  for (let i = 0; i < 50; i++) { const c = generateCode(); assert.ok(/^[A-HJ-NP-Z2-9]{10}$/.test(c), c); }
});
t("code and token hashes are domain-separated SHA-256 hex", () => {
  assert.match(codeLookupHash("ABCDEF"), /^[0-9a-f]{64}$/);
  assert.notEqual(codeLookupHash("x"), tokenHash("x"));
});
t("resolveBoard always hashes (even malformed codes) before the lookup — timing", () => assert.ok(pub.includes('codeLookupHash(code ?? "invalid-code-placeholder")')));
t("activation consumes the token under a row lock and fails generically", () => {
  assert.ok(pub.includes("SELECT * FROM job_board_invitations WHERE token_hash = $1 FOR UPDATE"));
  assert.ok((pub.match(/return generic;/g) ?? []).length >= 3);
});
t("activation creates a users row with role 'applicant' and NO worker", () => assert.ok(/VALUES \(\$1,\$2,\$3,'applicant',\$4,NULL,/.test(pub)));
t("approval never inserts into workers/proposals/contracts/invoices/payments", () => {
  const code = strip(pub);
  for (const tbl of ["workers", "contractor_proposals", "contractor_contracts", "invoices", "contractor_payments", "payroll"]) {
    assert.ok(!new RegExp(`INSERT INTO ${tbl}\\b`).test(code), tbl);
  }
});
t("no outbound email/SMS from the public-access module", () => {
  assert.ok(!/sendEmail|sendMail|sendSms|twilio|nodemailer|resend|postmark|sendGenericNotification/i.test(strip(pub)));
});
t("activation link is only ever returned to the approving admin with a delivery notice", () => {
  assert.ok(pub.includes("No email was sent automatically."));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
