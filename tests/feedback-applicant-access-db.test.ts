/**
 * Applicant feedback access (v2.2.21) — end to end against the REAL server
 * (server/index.ts via the shared harness), real login sessions, real CSRF
 * double-submit cookie, real feedback SQL and multer uploads.
 *
 * Proves, for the limited job-board `applicant` role:
 *   1. an authenticated applicant can submit valid feedback (with a screenshot)
 *   2. anonymous requests get 401
 *   3. missing / wrong CSRF token → 403, and no upload is written
 *   4. the applicant sees only its own submissions and public reviewer comments
 *   5. cross-applicant and cross-tenant access → 404 (existence not revealed)
 *   6. internal comments are never returned (and an applicant cannot create one)
 *   7. protected fields in the request are ignored (owner, company, status, …)
 *   8. feedback administration (queue, single ticket, PATCH) stays denied
 *   9. unrelated /api paths stay denied (full manifest sweep is in the static test)
 *  10. admin / manager / employee / contractor / vendor feedback behaviour unchanged
 * plus: a disabled applicant's live session loses access; logout → 401.
 *
 * Synthetic fixtures only (example.invalid); refuses staging/production URLs;
 * removes every fixture row and uploaded file; proves zero residue.
 * Run: TEST_DATABASE_URL=postgresql://…/disposable_db npx tsx tests/feedback-applicant-access-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcrypt";
import { startTestServer } from "../scripts/cross-tenant-negative-tests/server-harness";
import { cascadeDelete, verifyZeroResidue } from "../scripts/cross-tenant-negative-tests/cascade-cleanup";

const FORBIDDEN_PATTERNS = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i, /paylinkapp/i];
const UPLOAD_DIR = path.join(process.cwd(), "uploads");

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) { console.log(`  ✓  ${name}`); passed++; }
  else { console.error(`  ✗  ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ""}`); failed++; }
}

interface Sess { cookie: string; csrf: string; userId: string; role: string }

async function login(base: string, username: string, password: string): Promise<Sess> {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`fixture login failed (${res.status})`);
  const set = res.headers.getSetCookie();
  const sid = set.map((c) => c.match(/connect\.sid=[^;]+/)?.[0]).find(Boolean);
  if (!sid) throw new Error("no session cookie");
  const body = (await res.json()) as { id: string; role: string };
  // The CSRF cookie is issued on the next request that carries the session.
  const me = await fetch(`${base}/api/auth/me`, { headers: { cookie: sid } });
  const csrf = me.headers.getSetCookie().map((c) => c.match(/csrf_token=([^;]+)/)?.[1]).find(Boolean)
    ?? set.map((c) => c.match(/csrf_token=([^;]+)/)?.[1]).find(Boolean);
  if (!csrf) throw new Error("no csrf cookie");
  return { cookie: `${sid}; csrf_token=${csrf}`, csrf: decodeURIComponent(csrf), userId: body.id, role: body.role };
}

type Res = { status: number; body: any };
async function call(base: string, method: string, p: string, s: Sess | null, opts: { json?: unknown; form?: FormData; csrf?: string | null } = {}): Promise<Res> {
  const headers: Record<string, string> = {};
  if (s) headers.cookie = s.cookie;
  const csrf = opts.csrf === undefined ? s?.csrf : opts.csrf;
  if (csrf && method !== "GET") headers["x-csrf-token"] = csrf;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.json !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(opts.json); }
  const res = await fetch(`${base}${p}`, { method, headers, body });
  let parsed: any;
  try { parsed = await res.json(); } catch { parsed = undefined; }
  return { status: res.status, body: parsed };
}

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");

function feedbackForm(fields: Record<string, string>, screenshot?: { name: string; bytes: Buffer; type: string }): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (screenshot) fd.append("screenshots", new Blob([screenshot.bytes], { type: screenshot.type }), screenshot.name);
  return fd;
}

const uploadsSnapshot = () => new Set(fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR) : []);

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) { console.log("TEST_DATABASE_URL not set — skipping applicant feedback DB tests (0 run)."); return; }
  for (const p of FORBIDDEN_PATTERNS) if (p.test(url)) throw new Error("TEST_DATABASE_URL looks like staging/production. Refusing.");
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) throw new Error("TEST_DATABASE_URL equals DATABASE_URL. Refusing.");

  const pool = new Pool({ connectionString: url, max: 4 });
  const sfx = crypto.randomBytes(4).toString("hex");
  const companyIds: string[] = [];
  const userIds: string[] = [];
  const tenantIds: string[] = [];
  const workerIds: string[] = [];
  const uploadedFiles = new Set<string>();
  let server: Awaited<ReturnType<typeof startTestServer>> | undefined;
  const before = uploadsSnapshot();

  try {
    const dbName = (await pool.query("SELECT current_database() n")).rows[0].n as string;
    if (FORBIDDEN_PATTERNS.some((p) => p.test(dbName))) throw new Error(`current_database()="${dbName}" looks protected. Refusing.`);
    server = await startTestServer(url);
    const base = server.baseUrl;

    // ── Fixtures ──
    const coA = crypto.randomUUID(), coB = crypto.randomUUID();
    companyIds.push(coA, coB);
    for (const [co, L] of [[coA, "A"], [coB, "B"]] as const) {
      await pool.query(`INSERT INTO companies (id, name, subscription_status) VALUES ($1,$2,'active')`, [co, `ZZ FBAPP ${L} ${sfx}`]);
      const t = (await pool.query(`INSERT INTO tenants (name, slug, status) VALUES ($1,$1,'active') RETURNING id`, [`zz-fbapp-${L.toLowerCase()}-${sfx}`])).rows[0].id;
      tenantIds.push(t);
      await pool.query(`INSERT INTO tenant_companies (tenant_id, company_id, is_primary) VALUES ($1,$2,true)`, [t, co]);
    }
    const [tA, tB] = tenantIds;
    const pw = crypto.randomBytes(12).toString("hex");
    const hash = await bcrypt.hash(pw, 10);
    const U: Record<string, string> = {};
    const mkUser = async (key: string, role: string, co: string, workerId: string | null = null) => {
      const id = crypto.randomUUID();
      U[key] = id; userIds.push(id);
      await pool.query(
        `INSERT INTO users (id, username, password, role, company_id, worker_id, email, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,true)`,
        [id, `zz_fbapp_${key}_${sfx}`, hash, role, co, workerId, `zz-fbapp-${key.toLowerCase()}-${sfx}@example.invalid`]);
    };
    const mkWorker = async (co: string, type: string, group: string) => {
      const id = crypto.randomUUID(); workerIds.push(id);
      await pool.query(`INSERT INTO workers (id, company_id, first_name, last_name, worker_type, worker_group, status) VALUES ($1,$2,'ZZ','FbApp',$3,$4,'active')`, [id, co, type, group]);
      return id;
    };
    await mkUser("adminA", "admin", coA);
    await mkUser("managerA", "manager", coA);
    await mkUser("adminB", "admin", coB);
    await mkUser("employeeA", "employee", coA, await mkWorker(coA, "employee", "w2_employee"));
    await mkUser("contractorA", "contractor", coA, await mkWorker(coA, "contractor", "1099_contractor"));
    await mkUser("vendorA", "vendor", coA);
    for (const [k, co, t] of [["app1", coA, tA], ["app2", coA, tA], ["appB", coB, tB], ["appOff", coA, tA]] as const) {
      await mkUser(k, "applicant", co);
      await pool.query(
        `INSERT INTO job_applicants (tenant_id, company_id, user_id, email_normalized, status, email_verified_at, activated_at) VALUES ($1,$2,$3,$4,'active',now(),now())`,
        [t, co, U[k], `zz-fbapp-${k.toLowerCase()}-${sfx}@example.invalid`]);
    }
    const S: Record<string, Sess> = {};
    for (const k of Object.keys(U)) S[k] = await login(base, `zz_fbapp_${k}_${sfx}`, pw);
    check("all fixture roles log in (admin, manager, employee, contractor, vendor, applicant)", Object.keys(S).length === Object.keys(U).length);

    const submit = (s: Sess | null, fields: Record<string, string>, opts: { csrf?: string | null; shot?: boolean } = {}) =>
      call(base, "POST", "/api/feedback", s, { csrf: opts.csrf, form: feedbackForm(fields, opts.shot ? { name: "shot.png", bytes: PNG, type: "image/png" } : undefined) });
    const valid = (title: string) => ({ type: "bug", severity: "medium", title, description: `desc ${title}`, pageUrl: "https://app.example.invalid/app/my-feedback", consoleErrors: JSON.stringify({ recentErrors: [], clientContext: { path: "/app/my-feedback" } }) });

    // ── 2. anonymous ──
    console.log("\n— anonymous —");
    check("anonymous POST /api/feedback → 401", (await submit(null, valid("anon"))).status === 401);
    check("anonymous GET /api/feedback/mine → 401", (await call(base, "GET", "/api/feedback/mine", null)).status === 401);
    check("anonymous GET /api/feedback/:id/comments → 401", (await call(base, "GET", `/api/feedback/${crypto.randomUUID()}/comments`, null)).status === 401);
    check("anonymous POST /api/feedback/:id/comments → 401", (await call(base, "POST", `/api/feedback/${crypto.randomUUID()}/comments`, null, { json: { body: "x" } })).status === 401);

    // ── 3. CSRF ──
    console.log("\n— CSRF —");
    let snap = uploadsSnapshot();
    let r = await submit(S.app1, valid("no csrf"), { csrf: null, shot: true });
    check("applicant submit WITHOUT CSRF header → 403", r.status === 403 && /CSRF/i.test(r.body?.message ?? ""), r);
    r = await submit(S.app1, valid("bad csrf"), { csrf: "0".repeat(S.app1.csrf.length), shot: true });
    check("applicant submit with WRONG CSRF token → 403", r.status === 403, r);
    r = await submit(S.app1, valid("other session csrf"), { csrf: S.app2.csrf, shot: true });
    check("applicant submit with ANOTHER session's CSRF token → 403", r.status === 403, r);
    check("…and the rejected uploads wrote no file (CSRF runs before multer)", [...uploadsSnapshot()].every((f) => snap.has(f)));
    check("employee submit without CSRF → 403 (same protection for every role)", (await submit(S.employeeA, valid("emp no csrf"), { csrf: null })).status === 403);
    const rowsNoCsrf = await pool.query(`SELECT count(*)::int n FROM feedback_tickets WHERE submitter_user_id = ANY($1)`, [userIds]);
    check("no ticket was created by any rejected request", rowsNoCsrf.rows[0].n === 0, rowsNoCsrf.rows[0]);

    // ── 1 + 7. applicant submits; protected fields ignored ──
    console.log("\n— applicant submit —");
    snap = uploadsSnapshot();
    r = await submit(S.app1, {
      ...valid("app1 ticket"),
      // protected / reviewer-only fields an applicant must not control:
      status: "closed", company_id: coB, companyId: coB, submitter_user_id: U.adminA, submitterUserId: U.adminA,
      assigned_user_id: U.adminA, assignedUserId: U.adminA, priority_fix: "true", priorityFix: "true", tenantId: tB, isInternal: "true",
    }, { shot: true });
    check("applicant submits valid feedback with a screenshot → 201", r.status === 201, r);
    const t1 = r.body?.id as string;
    for (const f of [...uploadsSnapshot()].filter((x) => !snap.has(x))) uploadedFiles.add(f);
    check("exactly one screenshot file stored", uploadedFiles.size === 1, [...uploadedFiles]);
    const leaked = ["company_id", "submitter_user_id", "submitter_email", "assigned_user_id", "browser_info", "console_errors"].filter((k) => r.body && k in r.body);
    check("applicant response omits reviewer/diagnostic fields", leaked.length === 0, leaked);
    const row1 = (await pool.query(`SELECT * FROM feedback_tickets WHERE id = $1`, [t1])).rows[0];
    check("stored owner is the session user (not the body)", row1?.submitter_user_id === U.app1);
    check("stored company is the session company (not the body's company B)", row1?.company_id === coA);
    check("status forced to 'new', not assigned, not priority", row1?.status === "new" && row1?.assigned_user_id === null && !row1?.priority_fix);
    check("page URL and diagnostic context captured", row1?.page_url === "https://app.example.invalid/app/my-feedback" && JSON.parse(row1?.console_errors ?? "{}").clientContext?.path === "/app/my-feedback" && JSON.parse(row1?.browser_info ?? "{}").capturedAt);
    check("screenshot path recorded", Array.isArray(row1?.screenshot_paths) && row1.screenshot_paths.length === 1);
    const shotUrl: string = row1?.screenshot_paths?.[0] ?? "";
    const shotRes = await fetch(`${base}${shotUrl}`, { headers: { cookie: S.app1.cookie } });
    check("applicant can view its own screenshot via the authenticated /uploads check", shotRes.status === 200);
    check("anonymous cannot fetch the screenshot", (await fetch(`${base}${shotUrl}`)).status === 401);
    check("company B admin cannot fetch the screenshot", (await fetch(`${base}${shotUrl}`, { headers: { cookie: S.adminB.cookie } })).status === 404);

    console.log("\n— validation unchanged —");
    check("missing title → 400", (await submit(S.app1, { ...valid("x"), title: "" })).status === 400);
    check("missing description → 400", (await submit(S.app1, { ...valid("x"), description: " " })).status === 400);
    check("invalid type → 400", (await submit(S.app1, { ...valid("x"), type: "admin_override" })).status === 400);
    check("invalid severity → 400", (await submit(S.app1, { ...valid("x"), severity: "urgent" })).status === 400);
    snap = uploadsSnapshot();
    r = await call(base, "POST", "/api/feedback", S.app1, { form: feedbackForm(valid("pdf"), { name: "x.pdf", bytes: Buffer.from("%PDF-1.4"), type: "application/pdf" }) });
    check("non-image screenshot rejected (existing image-only filter), nothing stored", r.status >= 400 && [...uploadsSnapshot()].every((f) => snap.has(f)), r.status);
    check("rejected submissions created no ticket", (await pool.query(`SELECT count(*)::int n FROM feedback_tickets WHERE submitter_user_id = $1`, [U.app1])).rows[0].n === 1);

    // Reviewer comments on app1's ticket: one public, one internal.
    r = await call(base, "POST", `/api/feedback/${t1}/comments`, S.adminA, { json: { body: "public reply", isInternal: false } });
    check("admin adds a public comment → 201", r.status === 201, r);
    r = await call(base, "POST", `/api/feedback/${t1}/comments`, S.adminA, { json: { body: "INTERNAL-ONLY note", isInternal: true } });
    check("admin adds an internal comment → 201", r.status === 201 && r.body?.is_internal === true, r);

    // ── 4 + 6. own submissions + public comments only ──
    console.log("\n— own submissions —");
    r = await call(base, "GET", "/api/feedback/mine", S.app1);
    check("applicant /mine → 200 with exactly its one ticket", r.status === 200 && r.body.length === 1 && r.body[0].id === t1, r);
    check("/mine rows omit reviewer/diagnostic fields", r.body?.[0] && !["assigned_user_id", "company_id", "browser_info", "console_errors", "submitter_email", "submitter_user_id"].some((k) => k in r.body[0]));
    r = await call(base, "GET", `/api/feedback/${t1}/comments`, S.app1);
    check("applicant reads comments on its own ticket → 200", r.status === 200, r);
    check("only the public reviewer comment is returned (internal never)", r.body?.length === 1 && r.body[0].body === "public reply" && !JSON.stringify(r.body).includes("INTERNAL-ONLY"), r.body);
    check("comment rows omit reviewer user ids", r.body?.[0] && !("author_user_id" in r.body[0]));
    r = await call(base, "POST", `/api/feedback/${t1}/comments`, S.app1, { json: { body: "applicant follow-up", isInternal: true } });
    check("applicant adds a comment on its own ticket → 201", r.status === 201, r);
    const c = (await pool.query(`SELECT * FROM feedback_ticket_comments WHERE ticket_id = $1 AND author_user_id = $2`, [t1, U.app1])).rows;
    check("applicant comment stored as NON-internal even when isInternal=true was sent", c.length === 1 && c[0].is_internal === false, c);
    check("applicant comment without CSRF → 403", (await call(base, "POST", `/api/feedback/${t1}/comments`, S.app1, { json: { body: "x" }, csrf: null })).status === 403);
    check("empty applicant comment → 400", (await call(base, "POST", `/api/feedback/${t1}/comments`, S.app1, { json: { body: "  " } })).status === 400);

    // Other roles' tickets for isolation + regression.
    console.log("\n— existing roles unchanged —");
    const ids: Record<string, string> = {};
    for (const k of ["employeeA", "contractorA", "vendorA", "app2", "appB"]) {
      r = await submit(S[k], valid(`${k} ticket`));
      check(`${k} submits feedback → 201`, r.status === 201, r);
      ids[k] = r.body?.id;
    }
    r = await submit(S.employeeA, { ...valid("employee hr"), type: "hr" });
    check("employee submits an HR concern → 201", r.status === 201);
    const hrId = r.body?.id as string;
    r = await call(base, "GET", "/api/feedback/mine", S.employeeA);
    check("employee /mine → own tickets only, full row shape unchanged", r.status === 200 && r.body.length === 2 && r.body.every((t: any) => t.submitter_user_id === U.employeeA && "company_id" in t), r.body?.length);
    r = await call(base, "GET", "/api/feedback", S.adminA);
    const adminSees = new Set((r.body ?? []).map((t: any) => t.id));
    check("admin A queue: all company A tickets incl. applicant + HR, none of company B", r.status === 200 && [t1, ids.employeeA, ids.contractorA, ids.vendorA, ids.app2, hrId].every((i) => adminSees.has(i)) && !adminSees.has(ids.appB), r.status);
    r = await call(base, "GET", "/api/feedback", S.managerA);
    const mgrSees = new Set((r.body ?? []).map((t: any) => t.id));
    check("manager A queue: company A non-HR tickets; HR hidden (unchanged rule)", r.status === 200 && mgrSees.has(t1) && mgrSees.has(ids.employeeA) && !mgrSees.has(hrId) && !mgrSees.has(ids.appB));
    check("admin B cannot open a company A ticket → 403", (await call(base, "GET", `/api/feedback/${t1}`, S.adminB)).status === 403);
    r = await call(base, "PATCH", `/api/feedback/${t1}`, S.adminA, { json: { status: "in_progress" } });
    check("admin A updates status (with CSRF) → 200", r.status === 200 && r.body?.status === "in_progress", r);
    check("admin PATCH without CSRF → 403", (await call(base, "PATCH", `/api/feedback/${t1}`, S.adminA, { json: { status: "reviewed" }, csrf: null })).status === 403);
    check("employee cannot PATCH a ticket → 403", (await call(base, "PATCH", `/api/feedback/${ids.employeeA}`, S.employeeA, { json: { status: "closed" } })).status === 403);
    r = await call(base, "GET", `/api/feedback/${ids.employeeA}`, S.employeeA);
    check("employee opens own ticket → 200", r.status === 200);
    check("employee cannot open the applicant's ticket → 403", (await call(base, "GET", `/api/feedback/${t1}`, S.employeeA)).status === 403);
    check("vendor reads own comments → 200", (await call(base, "GET", `/api/feedback/${ids.vendorA}/comments`, S.vendorA)).status === 200);
    const statusNotif = (await pool.query(`SELECT count(*)::int n FROM notifications WHERE user_id = $1 AND type = 'feedback_status_changed'`, [U.app1])).rows[0].n;
    check("applicant receives the in-app status-change notification (existing behaviour)", statusNotif === 1, statusNotif);

    // ── 5. cross-applicant / cross-tenant ──
    console.log("\n— isolation —");
    for (const [who, label] of [["app2", "same-company applicant"], ["appB", "other-tenant applicant"]] as const) {
      check(`${label}: GET comments on app1's ticket → 404`, (await call(base, "GET", `/api/feedback/${t1}/comments`, S[who])).status === 404);
      check(`${label}: POST comment on app1's ticket → 404`, (await call(base, "POST", `/api/feedback/${t1}/comments`, S[who], { json: { body: "intrude" } })).status === 404);
      r = await call(base, "GET", "/api/feedback/mine", S[who]);
      check(`${label}: /mine shows only its own ticket`, r.status === 200 && r.body.length === 1 && r.body[0].id === ids[who], r.body?.map((t: any) => t.id));
    }
    check("applicant cannot read an employee's ticket comments → 404", (await call(base, "GET", `/api/feedback/${ids.employeeA}/comments`, S.app1)).status === 404);
    check("applicant cannot read the employee HR ticket comments → 404", (await call(base, "GET", `/api/feedback/${hrId}/comments`, S.app1)).status === 404);
    check("applicant: unknown ticket id → 404 (same as not-owned)", (await call(base, "GET", `/api/feedback/${crypto.randomUUID()}/comments`, S.app1)).status === 404);
    check("no intruding comment was stored", (await pool.query(`SELECT count(*)::int n FROM feedback_ticket_comments WHERE body = 'intrude'`)).rows[0].n === 0);

    // ── 8. feedback administration stays denied ──
    console.log("\n— administration denied —");
    for (const [m, p] of [["GET", "/api/feedback"], ["GET", `/api/feedback?companyId=${coA}`], ["GET", `/api/feedback/${t1}`], ["PATCH", `/api/feedback/${t1}`]] as const) {
      r = await call(base, m, p, S.app1, m === "PATCH" ? { json: { status: "closed", assignedUserId: U.app1, priorityFix: true } } : {});
      check(`applicant ${m} ${p.replace(t1, ":own-id").replace(coA, ":co")} → 403`, r.status === 403, r);
    }
    const after = (await pool.query(`SELECT status, assigned_user_id, priority_fix FROM feedback_tickets WHERE id = $1`, [t1])).rows[0];
    check("applicant PATCH changed nothing", after.status === "in_progress" && after.assigned_user_id === null && !after.priority_fix, after);

    // ── 9. unrelated API stays denied ──
    console.log("\n— unrelated /api denied —");
    for (const [m, p] of [
      ["GET", "/api/workers"], ["GET", "/api/companies"], ["GET", "/api/users"], ["GET", "/api/payroll-runs"],
      ["GET", "/api/notifications"], ["GET", "/api/contractor-proposals"], ["GET", "/api/expenses"], ["GET", "/api/invoices"],
      ["GET", "/api/app-doctor/issues"], ["POST", "/api/app-doctor/reports"], ["GET", "/api/job-posts"], ["GET", "/api/messages"],
    ] as const) {
      r = await call(base, m, p, S.app1, m === "POST" ? { json: {} } : {});
      check(`applicant ${m} ${p} → 403`, r.status === 403, r.status);
    }
    check("applicant job-board allowance still works (GET /api/employment-applications/mine)", [200, 503].includes((await call(base, "GET", "/api/employment-applications/mine", S.app1)).status));

    // ── disabled applicant + logout ──
    console.log("\n— disabled applicant / logout —");
    r = await submit(S.appOff, valid("before disable"));
    check("applicant submits before being disabled → 201", r.status === 201);
    const offTicket = r.body?.id as string;
    await pool.query(`UPDATE job_applicants SET status = 'disabled', disabled_at = now() WHERE user_id = $1`, [U.appOff]);
    await pool.query(`UPDATE users SET is_active = false WHERE id = $1`, [U.appOff]);
    check("disabled applicant's live session: submit → 403", (await submit(S.appOff, valid("after disable"))).status === 403);
    check("disabled applicant's live session: /mine → 403", (await call(base, "GET", "/api/feedback/mine", S.appOff)).status === 403);
    check("disabled applicant's live session: comments → 403", (await call(base, "GET", `/api/feedback/${offTicket}/comments`, S.appOff)).status === 403);
    await call(base, "POST", "/api/auth/logout", S.app2);
    check("after logout: /mine → 401", (await call(base, "GET", "/api/feedback/mine", S.app2)).status === 401);
    check("after logout: submit → 401", (await submit(S.app2, valid("after logout"))).status === 401);
  } finally {
    if (server) await server.stop();
    // Every file the server wrote during this run (screenshots), and nothing else.
    for (const f of uploadsSnapshot()) if (!before.has(f)) uploadedFiles.add(f);
    for (const f of uploadedFiles) fs.rmSync(path.join(UPLOAD_DIR, f), { force: true });
    if (userIds.length) {
      await pool.query(`DELETE FROM feedback_ticket_comments WHERE ticket_id IN (SELECT id FROM feedback_tickets WHERE submitter_user_id = ANY($1))`, [userIds]);
      await pool.query(`DELETE FROM feedback_tickets WHERE submitter_user_id = ANY($1)`, [userIds]);
      await pool.query(`DELETE FROM notifications WHERE user_id = ANY($1) OR company_id = ANY($2)`, [userIds, companyIds]);
      await pool.query(`DELETE FROM job_applicants WHERE user_id = ANY($1)`, [userIds]);
      await pool.query(`DELETE FROM session WHERE sess::text LIKE ANY($1)`, [userIds.map((u) => `%${u}%`)]).catch(() => {});
      await cascadeDelete(pool, "users", userIds);
    }
    if (workerIds.length) await cascadeDelete(pool, "workers", workerIds);
    if (companyIds.length) {
      await pool.query(`DELETE FROM tenant_companies WHERE company_id = ANY($1)`, [companyIds]);
      await cascadeDelete(pool, "companies", companyIds);
    }
    if (tenantIds.length) await cascadeDelete(pool, "tenants", tenantIds);
    const residue = [
      ...await verifyZeroResidue(pool, "companies", companyIds), ...await verifyZeroResidue(pool, "users", userIds),
      ...await verifyZeroResidue(pool, "tenants", tenantIds), ...await verifyZeroResidue(pool, "workers", workerIds),
    ];
    const fbLeft = (await pool.query(`SELECT count(*)::int n FROM feedback_tickets WHERE submitter_user_id = ANY($1)`, [userIds])).rows[0].n;
    const filesLeft = [...uploadedFiles].filter((f) => fs.existsSync(path.join(UPLOAD_DIR, f)));
    check("zero fixture residue (rows, feedback, uploaded files)", residue.length === 0 && fbLeft === 0 && filesLeft.length === 0, { residue, fbLeft, filesLeft });
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
