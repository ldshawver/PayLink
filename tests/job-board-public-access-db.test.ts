/**
 * Job board public discovery + applicant access — real-Postgres acceptance of
 * server/job-board/public-access.ts and the applicant paths in service.ts /
 * employment.ts (migrations 0029 + 0030). Drives the exact SQL the routes run.
 *
 * SAFETY: TEST_DATABASE_URL must be a disposable database (app-table owner).
 * Refuses staging/production-shaped names; removes all fixtures; skips (exit 0)
 * when TEST_DATABASE_URL is unset.
 * Run: TEST_DATABASE_URL=… npx tsx tests/job-board-public-access-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FORBIDDEN = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i, /^paylinkapp$/i];
const strip = (f: string) => fs.readFileSync(f, "utf8").split("\n").filter((l) => !l.startsWith("\\")).join("\n");

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) { console.log("SKIP: TEST_DATABASE_URL not set — public access DB acceptance not run (this is not a failure)."); process.exit(0); }
  const u = new URL(url); const dbName = u.pathname.slice(1);
  for (const p of FORBIDDEN) if (p.test(dbName) || p.test(u.hostname)) throw new Error("Refusing to run against a staging/production-shaped database.");
  const hrDir = fs.mkdtempSync(path.join(os.tmpdir(), "jb-public-hr-"));
  process.env.PRIVATE_HR_STORAGE_DIR = hrDir;
  process.env.PRIVATE_STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "jb-public-priv-"));
  const svc = await import("../server/job-board/service");
  const emp = await import("../server/job-board/employment");
  const pub = await import("../server/job-board/public-access");
  const pool = new Pool({ connectionString: url, max: 6 });
  if ((await pool.query("SELECT current_database() d")).rows[0].d !== dbName) throw new Error("database mismatch");

  let pass = 0, fail = 0;
  const ok = (n: string, c: unknown, x?: unknown) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}${x !== undefined ? "  " + JSON.stringify(x).slice(0, 300) : ""}`); } };
  const okR = (n: string, r: any, st: number) => ok(`${n} (${r.status}${r.ok ? "" : ": " + r.message})`, r.status === st);
  const id = () => crypto.randomUUID();
  const sfx = crypto.randomBytes(3).toString("hex");
  const ids = { coA: id(), coB: id(), adminA: id(), adminB: id(), cA: id(), uCA: id() };
  let tA = "", tB = "";
  const suspended = new Set<string>();
  const deps = {
    pool,
    tenantGate: async (cid: string) => suspended.has(cid) ? { allowed: false, reason: "Account suspended" } : { allowed: true },
    tenantIdForCompany: async (cid: string) => (await pool.query(`SELECT tenant_id FROM tenant_companies WHERE company_id = $1 LIMIT 1`, [cid])).rows[0]?.tenant_id ?? null,
  };
  const admin = (userId: string, co: string) => ({ userId, worker: null, applicant: null, canManageCompany: async (c: string) => c === co });
  const ADMIN_A = admin(ids.adminA, ids.coA), ADMIN_B = admin(ids.adminB, ids.coB);
  const CONTRACTOR_A = { userId: ids.uCA, applicant: null, canManageCompany: async () => false,
    worker: { workerId: ids.cA, companyId: ids.coA, workerType: "contractor", workerGroup: "1099_contractor", status: "active" } };
  const ANON = { userId: id(), worker: null, applicant: null, canManageCompany: async () => false };
  const fin = async (co: string) => (await pool.query(
    `SELECT (SELECT count(*) FROM contractor_proposals WHERE company_id=$1)::int p, (SELECT count(*) FROM contractor_contracts WHERE company_id=$1)::int c,
            (SELECT count(*) FROM invoices WHERE company_id=$1)::int i, (SELECT count(*) FROM contractor_payments WHERE company_id=$1)::int pay`, [co])).rows[0];
  const workerCount = async (co: string) => Number((await pool.query(`SELECT count(*) FROM workers WHERE company_id=$1`, [co])).rows[0].count);
  const ctx = { ipHash: pub.hashIp("203.0.113.9", "salt"), userAgent: "test" };
  const createdUsers: string[] = [];

  try {
    for (const f of ["migrations/0029_job_board.sql", "migrations/0030_job_board_public_access.sql"]) await pool.query(strip(f));
    ok("0029 + 0030 present", await pub.publicAccessSchemaReady(pool));
    for (const [co, L] of [[ids.coA, "A"], [ids.coB, "B"]] as const) {
      await pool.query(`INSERT INTO companies (id, name, subscription_status) VALUES ($1,$2,'active')`, [co, `ZZ JBPUB ${L} ${sfx}`]);
      const t = (await pool.query(`INSERT INTO tenants (name, slug, status) VALUES ($1,$1,'active') RETURNING id`, [`zz-jbpub-${L.toLowerCase()}-${sfx}`])).rows[0].id;
      await pool.query(`INSERT INTO tenant_companies (tenant_id, company_id, is_primary) VALUES ($1,$2,true)`, [t, co]);
      if (L === "A") tA = t; else tB = t;
    }
    await pool.query(`INSERT INTO workers (id, company_id, first_name, last_name, worker_type, worker_group, status) VALUES ($1,$2,'ZZ','Con','contractor','1099_contractor','active')`, [ids.cA, ids.coA]);
    await pool.query(`INSERT INTO users (id, username, password, role, company_id, worker_id) VALUES ($1,$2,'x','contractor',$3,$4)`, [ids.uCA, `zz_jbpub_c_${sfx}`, ids.coA, ids.cA]);

    // ── Settings + code ──
    console.log("board settings");
    let r: any = await pub.updateBoardSettings(deps, ADMIN_A, ids.coA, { boardEnabled: true });
    okR("cannot enable the board before a code exists", r, 409);
    r = await pub.rotateBoardCode(deps, ADMIN_A, ids.coA);
    okR("admin generates a board code (shown once)", r, 200);
    const codeA = r.body.code;
    const srow = (await pool.query(`SELECT * FROM job_board_settings WHERE company_id=$1`, [ids.coA])).rows[0];
    ok("only the SHA-256 lookup hash + 3-char hint are stored (no plaintext code)", srow.code_lookup_hash === pub.codeLookupHash(codeA) && !JSON.stringify(srow).includes(codeA) && srow.code_hint === codeA.slice(-3));
    okR("admin B cannot read/rotate A's board", await pub.rotateBoardCode(deps, ADMIN_B, ids.coA), 404);
    ok("disabled board is not discoverable", (await pub.publicBoard(deps, codeA)) === null);
    r = await pub.updateBoardSettings(deps, ADMIN_A, ids.coA, { boardEnabled: true, displayName: "ZZ Careers", tagline: "Join us", brandColor: "#123456", acceptApplicantRequests: true, acceptContractorRequests: true });
    okR("admin enables the board + branding + request kinds", r, 200);
    okR("brand colour validated", await pub.updateBoardSettings(deps, ADMIN_A, ids.coA, { brandColor: "red" }), 400);
    const codeB = (await pub.rotateBoardCode(deps, ADMIN_B, ids.coB) as any).body.code;
    await pub.updateBoardSettings(deps, ADMIN_B, ids.coB, { boardEnabled: true, acceptApplicantRequests: true });

    // ── Postings ──
    const mk = async (body: Record<string, unknown>) => {
      const c = await svc.createPost(deps, ADMIN_A, ids.coA, body) as any;
      if (c.status !== 201) throw new Error(`create ${JSON.stringify(c)}`);
      await svc.transitionPost(deps, ADMIN_A, c.body.id, "publish", { acknowledgeClassification: true });
      return c.body;
    };
    const E = { workerClassification: "employee", scheduleType: "full_time", compensationType: "salary", compensationMin: 50000, compensationMax: 60000 };
    const pubEmp = await mk({ ...E, title: "Public bookkeeper", summary: "INTERNAL summary", scopeOfWork: "INTERNAL scope", publicVisibility: "public", publicDescription: "Approved public text", requiredSkills: ["QuickBooks"], publicShowCompensation: false, locationText: "123 Private St" });
    ok("new postings default public visibility to access_required (explicit)", (await svc.createPost(deps, ADMIN_A, ids.coA, { ...E, title: "x" }) as any).body.publicVisibility === "access_required");
    const arEmp = await mk({ ...E, title: "Access-required clerk", summary: "s", publicVisibility: "access_required" });
    const invEmp = await mk({ ...E, title: "Invite-only lead", summary: "s", publicVisibility: "invite_only" });
    const pubCon = await mk({ workerClassification: "contractor", scheduleType: "one_time", title: "Public paint job", summary: "s", publicVisibility: "public", publicShowCompensation: true, compensationType: "fixed_bid", compensationMax: 900 });
    const legacy = await mk({ ...E, title: "Legacy internal", summary: "s" });
    await pool.query(`UPDATE job_posts SET public_visibility = NULL WHERE id = $1`, [legacy.id]); // simulate a pre-0030 posting

    // ── Public discovery ──
    console.log("public discovery");
    for (const [label, code] of [["unknown code", "ZZZZZZZZZZ"], ["malformed code", "!!"], ["empty code", ""], ["lowercase+dashes of unknown", "zz-zz-zz-zz"]] as const) {
      ok(`${label} → null (generic)`, (await pub.publicBoard(deps, code)) === null);
    }
    const board = await pub.publicBoard(deps, codeA.toLowerCase().replace(/(.{3})/g, "$1-")) as any;
    ok("code lookup is case/dash-insensitive", !!board && board.branding.displayName === "ZZ Careers");
    const refs = board.postings.map((p: any) => p.ref);
    ok("public board lists only 'public' postings", refs.includes(pubEmp.id) && refs.includes(pubCon.id) && !refs.includes(arEmp.id) && !refs.includes(invEmp.id) && !refs.includes(legacy.id), refs);
    const pp = board.postings.find((p: any) => p.ref === pubEmp.id);
    ok("public projection = exactly the allowlisted fields", JSON.stringify(Object.keys(pp).sort()) === JSON.stringify([...pub.PUBLIC_POST_FIELDS].sort()), Object.keys(pp));
    const raw = JSON.stringify(board);
    ok("no internal summary/scope/location/company/tenant ids in the public payload",
      !raw.includes("INTERNAL") && !raw.includes("123 Private St") && !raw.includes(ids.coA) && !raw.includes(tA) && !raw.includes(ids.adminA));
    ok("public description is the approved text", pp.description === "Approved public text");
    ok("compensation hidden unless the admin enabled it", pp.compensation === null && board.postings.find((p: any) => p.ref === pubCon.id).compensation?.max === "900.00");
    ok("CTA: employee 'Apply', contractor 'Submit Proposal'", pp.cta === "Apply" && board.postings.find((p: any) => p.ref === pubCon.id).cta === "Submit Proposal");
    ok("public posting detail works for a public posting", ((await pub.publicPosting(deps, codeA, pubEmp.id)) as any)?.posting?.ref === pubEmp.id);
    for (const [l, ref] of [["access_required", arEmp.id], ["invite_only", invEmp.id], ["never-chosen (NULL)", legacy.id]] as const) {
      ok(`${l} posting detail → null publicly`, (await pub.publicPosting(deps, codeA, ref)) === null);
    }
    ok("another company's posting via this code → null", (await pub.publicPosting(deps, codeB, pubEmp.id)) === null);
    await pub.updateBoardSettings(deps, ADMIN_A, ids.coA, { boardEnabled: false });
    ok("private (disabled) board → null", (await pub.publicBoard(deps, codeA)) === null);
    await pub.updateBoardSettings(deps, ADMIN_A, ids.coA, { boardEnabled: true });
    suspended.add(ids.coA);
    ok("suspended tenant's board → null", (await pub.publicBoard(deps, codeA)) === null);
    suspended.delete(ids.coA);

    // ── Access requests ──
    console.log("access requests");
    const reqCount = async () => Number((await pool.query(`SELECT count(*) FROM job_board_access_requests WHERE company_id=$1`, [ids.coA])).rows[0].count);
    const appEmail = `zz-app-${sfx}@example.invalid`;
    const body = (over: Record<string, unknown> = {}) => ({ code: codeA, kind: "applicant", firstName: "Zed", lastName: "Applicant", email: appEmail, postingRef: arEmp.id, ...over });
    await pub.submitPublicAccessRequest(deps, body({ code: "UNKNOWNCODE1" }), ctx);
    ok("unknown code → no row (caller still gets the generic ack)", (await reqCount()) === 0);
    await pub.submitPublicAccessRequest(deps, body(), ctx);
    await pub.submitPublicAccessRequest(deps, body({ firstName: "Again" }), ctx);
    ok("one pending applicant request (duplicate silently ignored)", (await reqCount()) === 1);
    const ar1 = (await pool.query(`SELECT * FROM job_board_access_requests WHERE company_id=$1`, [ids.coA])).rows[0];
    ok("request stores IP only as a hash and the posting it came from", ar1.source_ip_hash?.length === 64 && ar1.job_post_id === arEmp.id);
    await pub.updateBoardSettings(deps, ADMIN_A, ids.coA, { acceptContractorRequests: false });
    await pub.submitPublicAccessRequest(deps, body({ kind: "contractor", email: `zz-con-${sfx}@example.invalid` }), ctx);
    ok("closed request kind → no row", (await reqCount()) === 1);
    await pub.updateBoardSettings(deps, ADMIN_A, ids.coA, { acceptContractorRequests: true });
    await pub.submitPublicAccessRequest(deps, body({ kind: "contractor", email: `zz-con-${sfx}@example.invalid`, postingRef: pubCon.id }), ctx);
    suspended.add(ids.coA);
    await pub.submitPublicAccessRequest(deps, body({ email: `zz-susp-${sfx}@example.invalid` }), ctx);
    suspended.delete(ids.coA);
    ok("suspended tenant accepts no access requests", (await reqCount()) === 2);
    ok("input validation only concerns the caller's own fields", !pub.validateAccessRequestInput({ code: "x", kind: "applicant", firstName: "", lastName: "b", email: "e@x.io" }).ok
      && !pub.validateAccessRequestInput({ code: "x", kind: "employee", firstName: "a", lastName: "b", email: "e@x.io" }).ok);
    const reqs = (await pub.listAccessRequests(deps, ADMIN_A, ids.coA, "pending") as any).body;
    const reqApplicant = reqs.find((x: any) => x.kind === "applicant"), reqContractor = reqs.find((x: any) => x.kind === "contractor");
    ok("admin sees both pending requests", !!reqApplicant && !!reqContractor);
    okR("admin B cannot list A's requests", await pub.listAccessRequests(deps, ADMIN_B, ids.coA), 404);
    okR("admin B cannot approve A's request", await pub.approveAccessRequest(deps, ADMIN_B, reqApplicant.id, {}), 404);

    // ── Approval creates no worker ──
    console.log("approval");
    const wA0 = await workerCount(ids.coA); const users0 = Number((await pool.query(`SELECT count(*) FROM users WHERE company_id=$1`, [ids.coA])).rows[0].count);
    r = await pub.approveAccessRequest(deps, ADMIN_A, reqApplicant.id, {}, "https://app.test");
    okR("approve applicant request", r, 200);
    const activationUrl: string = r.body.activationUrl; const token = new URL(activationUrl).searchParams.get("token")!;
    ok("activation link returned once to the admin; no email sent automatically", !!token && /No email was sent/.test(r.body.deliveryNotice));
    ok("approval granted the requested posting", r.body.grantedPostings.includes(arEmp.id));
    const applicantId = r.body.applicantId;
    ok("approval created NO worker and NO login account", (await workerCount(ids.coA)) === wA0 &&
      Number((await pool.query(`SELECT count(*) FROM users WHERE company_id=$1`, [ids.coA])).rows[0].count) === users0);
    const inv = (await pool.query(`SELECT * FROM job_board_invitations WHERE applicant_id=$1`, [applicantId])).rows[0];
    ok("token stored only as a hash", inv.token_hash === pub.tokenHash(token) && !JSON.stringify(inv).includes(token));
    okR("approving twice → 409", await pub.approveAccessRequest(deps, ADMIN_A, reqApplicant.id, {}), 409);
    r = await pub.approveAccessRequest(deps, ADMIN_A, reqContractor.id, {});
    okR("approve contractor request → forwarded to the existing contractor queue", r, 200);
    const car = (await pool.query(`SELECT status, company_id FROM contractor_access_requests WHERE id=$1`, [r.body.contractorAccessRequestId])).rows[0];
    ok("forwarded contractor request is pending in the existing queue; no worker created", car?.status === "pending" && car.company_id === ids.coA && (await workerCount(ids.coA)) === wA0);
    await pub.submitPublicAccessRequest(deps, body({ email: `zz-deny-${sfx}@example.invalid` }), ctx);
    const toDeny = ((await pub.listAccessRequests(deps, ADMIN_A, ids.coA, "pending") as any).body)[0];
    okR("deny", await pub.denyAccessRequest(deps, ADMIN_A, toDeny.id, { note: "Not hiring" }), 200);
    ok("denied request created no applicant", (await pool.query(`SELECT count(*)::int c FROM job_applicants WHERE company_id=$1 AND email_normalized=$2`, [ids.coA, `zz-deny-${sfx}@example.invalid`])).rows[0].c === 0);

    // ── Activation ──
    console.log("activation");
    const hashPw = async (p: string) => "bcrypt-placeholder-" + p.length;
    const good = { token, username: `zz_app_${sfx}`, password: "correct horse battery" };
    r = await pub.activateApplicant(deps, { ...good, token: "x".repeat(40) }, hashPw);
    ok("unknown token → generic failure", !r.ok && r.message === pub.ACTIVATION_FAILED);
    r = await pub.activateApplicant(deps, { ...good, password: "short" }, hashPw);
    ok("weak password rejected before the token is touched", !r.ok && r.status === 400 && r.message !== pub.ACTIVATION_FAILED);
    suspended.add(ids.coA);
    r = await pub.activateApplicant(deps, good, hashPw);
    ok("suspended tenant → generic failure (token not consumed)", !r.ok && r.message === pub.ACTIVATION_FAILED &&
      (await pool.query(`SELECT consumed_at FROM job_board_invitations WHERE id=$1`, [inv.id])).rows[0].consumed_at === null);
    suspended.delete(ids.coA);
    await pool.query(`INSERT INTO users (id, username, password, role) VALUES ($1,$2,'x','employee')`, [id(), `zz_taken_${sfx}`]).then(() => createdUsers.push(`zz_taken_${sfx}`));
    r = await pub.activateApplicant(deps, { ...good, username: `zz_taken_${sfx}` }, hashPw);
    ok("taken username → 409 (says nothing about the email)", !r.ok && r.status === 409 && !/email/i.test(r.message));
    r = await pub.activateApplicant(deps, good, hashPw);
    ok("valid token activates the applicant", r.ok);
    createdUsers.push(good.username);
    const au = (await pool.query(`SELECT * FROM users WHERE username=$1`, [good.username])).rows[0];
    ok("applicant user: role 'applicant', company set, NO worker, email verified", au.role === "applicant" && au.company_id === ids.coA && au.worker_id === null && !!au.email_verified_at);
    ok("applicant identity active + verified, still no worker", (await pool.query(`SELECT status, email_verified_at FROM job_applicants WHERE id=$1`, [applicantId])).rows[0].status === "active" && (await workerCount(ids.coA)) === wA0);
    r = await pub.activateApplicant(deps, { ...good, username: `zz_app2_${sfx}` }, hashPw);
    ok("replayed token → generic failure", !r.ok && r.message === pub.ACTIVATION_FAILED);
    // Expired + revoked tokens (second applicant)
    await pub.submitPublicAccessRequest(deps, body({ email: `zz-app2-${sfx}@example.invalid` }), ctx);
    const req2 = ((await pub.listAccessRequests(deps, ADMIN_A, ids.coA, "pending") as any).body)[0];
    const ap2 = (await pub.approveAccessRequest(deps, ADMIN_A, req2.id, { postingIds: [invEmp.id] }, "https://app.test") as any).body;
    const tok2 = new URL(ap2.activationUrl).searchParams.get("token")!;
    await pool.query(`UPDATE job_board_invitations SET created_at = now() - interval '5 days', expires_at = now() - interval '1 hour' WHERE token_hash=$1`, [pub.tokenHash(tok2)]);
    r = await pub.activateApplicant(deps, { token: tok2, username: `zz_app2_${sfx}`, password: "correct horse battery" }, hashPw);
    ok("expired token → generic failure", !r.ok && r.message === pub.ACTIVATION_FAILED);
    const re = (await pub.reissueActivation(deps, ADMIN_A, ap2.applicantId, "https://app.test") as any);
    const tok3 = new URL(re.body.activationUrl).searchParams.get("token")!;
    const inv3 = (await pool.query(`SELECT id FROM job_board_invitations WHERE token_hash=$1`, [pub.tokenHash(tok3)])).rows[0].id;
    okR("admin revokes the reissued link", await pub.revokeInvitationToken(deps, ADMIN_A, inv3), 200);
    r = await pub.activateApplicant(deps, { token: tok3, username: `zz_app2_${sfx}`, password: "correct horse battery" }, hashPw);
    ok("revoked token → generic failure", !r.ok && r.message === pub.ACTIVATION_FAILED);

    // ── Applicant role ──
    console.log("applicant role");
    const ident = await pub.loadApplicantIdentity(pool, au.id);
    ok("active applicant identity resolves", ident?.applicantId === applicantId && ident.companyId === ids.coA);
    const APP = { userId: au.id, worker: null, applicant: ident, canManageCompany: async () => false };
    let list = (await svc.listAvailablePosts(deps, APP) as any).body.map((p: any) => p.id);
    ok("applicant sees public + access_required employee postings only", list.includes(pubEmp.id) && list.includes(arEmp.id) && !list.includes(invEmp.id) && !list.includes(pubCon.id) && !list.includes(legacy.id), list);
    okR("applicant cannot open contractor work", await svc.getPost(deps, APP, pubCon.id), 404);
    okR("applicant cannot open an invite-only posting without a grant", await svc.getPost(deps, APP, invEmp.id), 404);
    okR("applicant cannot submit a contractor proposal", await svc.createBid(deps, APP, pubCon.id, { proposedAmount: 1 }), 403);
    okR("applicant cannot apply to an invite-only posting without a grant", await emp.createApplication(deps, APP, invEmp.id, {}), 404);
    okR("admin grants the invite-only posting", await pub.grantApplicantPosting(deps, ADMIN_A, invEmp.id, applicantId), 201);
    list = (await svc.listAvailablePosts(deps, APP) as any).body.map((p: any) => p.id);
    ok("…now visible", list.includes(invEmp.id));
    okR("grants are employee-only", await pub.grantApplicantPosting(deps, ADMIN_A, pubCon.id, applicantId), 409);
    r = await emp.createApplication(deps, APP, arEmp.id, { coverMessage: "Hello" });
    okR("applicant applies to an access-required position", r, 201);
    const myApp = r.body;
    ok("application is linked to the applicant identity, not a worker", (await pool.query(`SELECT applicant_id, applicant_worker_id FROM employment_applications WHERE id=$1`, [myApp.id])).rows
      .every((x: any) => x.applicant_id === applicantId && x.applicant_worker_id === null));
    const fd = { originalname: "cv.pdf", mimetype: "application/pdf", size: 9, buffer: Buffer.from("%PDF-1.4\n") };
    const doc = (await emp.addApplicationDocument(deps, APP, myApp.id, fd, "resume") as any).body;
    okR("applicant uploads own résumé", { ok: !!doc?.id, status: doc?.id ? 201 : 500 }, 201);
    okR("applicant submits", await emp.submitApplication(deps, APP, myApp.id, { acknowledgements: { information_accurate: true, privacy_notice: true, no_offer_until_hired: true } }), 200);
    okR("applicant reads own résumé", await emp.authorizeApplicationDocumentDownload(deps, APP, doc.id), 200);
    okR("anonymous/other identity cannot read it", await emp.authorizeApplicationDocumentDownload(deps, ANON, doc.id), 404);
    okR("contractor cannot read it", await emp.authorizeApplicationDocumentDownload(deps, CONTRACTOR_A, doc.id), 404);
    okR("company B admin cannot read it", await emp.authorizeApplicationDocumentDownload(deps, ADMIN_B, doc.id), 404);
    // A second active applicant in the same company cannot see the first one's work.
    await pool.query(`UPDATE job_board_invitations SET revoked_at = now() WHERE applicant_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL`, [ap2.applicantId]);
    const re2 = (await pub.reissueActivation(deps, ADMIN_A, ap2.applicantId, "https://app.test") as any).body;
    await pub.activateApplicant(deps, { token: new URL(re2.activationUrl).searchParams.get("token")!, username: `zz_app2_${sfx}`, password: "correct horse battery" }, hashPw);
    createdUsers.push(`zz_app2_${sfx}`);
    const au2 = (await pool.query(`SELECT id FROM users WHERE username=$1`, [`zz_app2_${sfx}`])).rows[0];
    const APP2 = { userId: au2.id, worker: null, applicant: await pub.loadApplicantIdentity(pool, au2.id), canManageCompany: async () => false };
    okR("applicant cannot read another applicant's application", await emp.getApplication(deps, APP2, myApp.id), 404);
    okR("applicant cannot read another applicant's résumé", await emp.authorizeApplicationDocumentDownload(deps, APP2, doc.id), 404);
    ok("'My Applications' is own-only", ((await emp.listMyApplications(deps, APP2) as any).body.length === 0) && ((await emp.listMyApplications(deps, APP) as any).body.length === 1));
    okR("applicant cannot list applications (admin)", await emp.listApplicationsForPost(deps, APP, arEmp.id), 404);
    okR("applicant cannot hire/convert", await emp.transitionApplication(deps, APP, myApp.id, "review"), 404);
    okR("applicant cannot convert itself to a worker", await emp.convertApplicationToWorker(deps, APP, myApp.id, { confirm: true, workerType: "employee" }), 404);

    // ── Hire + conversion ──
    console.log("hire + conversion");
    const finBefore = await fin(ids.coA);
    for (const s of ["review", "interview", "offer", "hire"] as const) await emp.transitionApplication(deps, ADMIN_A, myApp.id, s);
    const w0 = await workerCount(ids.coA);
    r = await emp.convertApplicationToWorker(deps, ADMIN_A, myApp.id, { confirm: true });
    okR("admin converts the hired applicant", r, 201);
    const wid = r.body.workerId;
    const retry = await emp.convertApplicationToWorker(deps, ADMIN_A, myApp.id, { confirm: true }) as any;
    ok("retry returns the existing worker", retry.status === 200 && retry.body.workerId === wid);
    okR("conflicting classification retry rejected", await emp.convertApplicationToWorker(deps, ADMIN_A, myApp.id, { confirm: true, workerType: "contractor" }), 409);
    ok("exactly one EMPLOYEE worker created", (await workerCount(ids.coA)) === w0 + 1 && (await pool.query(`SELECT worker_type FROM workers WHERE id=$1`, [wid])).rows[0].worker_type === "employee");
    ok("applicant login stays a limited applicant (no worker link)", (await pool.query(`SELECT role, worker_id FROM users WHERE id=$1`, [au.id])).rows[0].role === "applicant" &&
      (await pool.query(`SELECT worker_id FROM users WHERE id=$1`, [au.id])).rows[0].worker_id === null);
    ok("no proposal/contract/invoice/payment from the employee path", JSON.stringify(finBefore) === JSON.stringify(await fin(ids.coA)));

    // ── Contractor proposals unaffected ──
    const b = await svc.createBid(deps, CONTRACTOR_A, pubCon.id, { proposedAmount: 800, estimatedHours: 10, scopeAndDeliverables: "Paint" }) as any;
    await svc.submitBid(deps, CONTRACTOR_A, b.body.id);
    r = await svc.awardBid(deps, ADMIN_A, b.body.id, `k-${sfx}`);
    ok("approved contractor's award still creates exactly one proposal", r.status === 201 && (await pool.query(`SELECT count(*)::int c FROM contractor_proposals WHERE job_bid_id=$1`, [b.body.id])).rows[0].c === 1);

    // ── Disable + suspension ──
    console.log("disable + suspension");
    okR("admin B cannot disable A's applicant", await pub.disableApplicant(deps, ADMIN_B, ap2.applicantId), 404);
    okR("admin disables an applicant", await pub.disableApplicant(deps, ADMIN_A, ap2.applicantId, { reason: "test" }), 200);
    ok("disabled applicant: identity no longer resolves and login is inactive", (await pub.loadApplicantIdentity(pool, au2.id)) === null &&
      (await pool.query(`SELECT is_active FROM users WHERE id=$1`, [au2.id])).rows[0].is_active === false);
    suspended.add(ids.coA);
    ok("suspended tenant: applicant sees no postings", ((await svc.listAvailablePosts(deps, APP) as any).body.length === 0));
    okR("suspended tenant: applicant cannot apply", await emp.createApplication(deps, APP, pubEmp.id, {}), 403);
    suspended.delete(ids.coA);

    // ── Audit ──
    const types = new Set((await pool.query(`SELECT DISTINCT event_type FROM job_board_access_events WHERE company_id=$1`, [ids.coA])).rows.map((x: any) => x.event_type));
    for (const t of ["board_code_rotated", "board_settings_updated", "access_request_submitted", "access_request_approved", "access_request_denied", "applicant_created",
      "invitation_issued", "invitation_consumed", "invitation_revoked", "applicant_activated", "posting_grant_created", "applicant_disabled"]) ok(`audited: ${t}`, types.has(t));
    ok("conversion audited on the application", (await pool.query(`SELECT count(*)::int c FROM employment_application_events WHERE application_id=$1 AND event_type='application_converted_to_worker'`, [myApp.id])).rows[0].c === 1);
  } finally {
    const co = [ids.coA, ids.coB];
    const q = (s: string, p: unknown[] = [co]) => pool.query(s, p).catch((e) => console.error("cleanup:", s.slice(0, 50), e.message));
    await q(`DELETE FROM contractor_notifications WHERE company_id = ANY($1::varchar[])`);
    for (const t of ["job_board_access_events", "job_post_access_grants", "job_board_invitations"]) await q(`DELETE FROM ${t} WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM employment_application_events WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM employment_application_answers WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM employment_application_documents WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM employment_applications WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM job_board_access_requests WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM job_applicants WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM job_board_settings WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM contractor_access_requests WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM contractor_job_bid_events WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM contractor_job_bid_versions WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM proposal_approval_events WHERE proposal_id IN (SELECT id FROM contractor_proposals WHERE company_id = ANY($1::varchar[]))`);
    await q(`DELETE FROM contractor_proposals WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM contractor_job_bids WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM job_screening_questions WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM job_post_events WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM job_posts WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM users WHERE company_id = ANY($1::varchar[]) OR username = ANY($2::text[])`, [co, createdUsers]);
    await q(`DELETE FROM workers WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM tenant_companies WHERE company_id = ANY($1::varchar[])`);
    await q(`DELETE FROM tenants WHERE id = ANY($1::varchar[])`, [[tA, tB].filter(Boolean)]);
    await q(`DELETE FROM companies WHERE id = ANY($1::varchar[])`);
    const left = (await pool.query(`SELECT (SELECT count(*) FROM companies WHERE id = ANY($1::varchar[])) + (SELECT count(*) FROM job_applicants WHERE company_id = ANY($1::varchar[])) + (SELECT count(*) FROM users WHERE username = ANY($2::text[])) AS n`, [co, createdUsers])).rows[0].n;
    console.log(`cleanup: ${Number(left) === 0 ? "zero residue" : "RESIDUE " + left}`);
    await pool.end();
    fs.rmSync(hrDir, { recursive: true, force: true });
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
