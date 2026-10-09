/**
 * Real-HTTP test: multi-company employee administration.
 *
 * A tenant admin administers employees in their home company plus every company
 * they hold an explicit, active, manager-level company_user_access grant for.
 * List, detail, create, update and account-status all use that one set:
 *   - no ?companyId → every administered company; each row carries its own companyId
 *   - ?companyId=<administered> → that company only
 *   - ?companyId=<foreign | employee-level grant | scheduling-only sibling> → 403
 *   - scheduling-only enterprise siblings appear only in the narrow ?scheduling=true
 *     projection, never as full HR records
 *   - employees still see only themselves
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable_db npx tsx tests/multi-company-employee-admin-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { startTestServer, login, apiRequest, type TestServer } from "../scripts/cross-tenant-negative-tests/server-harness";
import { cascadeDelete, verifyZeroResidue } from "../scripts/cross-tenant-negative-tests/cascade-cleanup";

const FORBIDDEN_PATTERNS = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) { console.log(`  ✓  ${name}`); passed++; }
  else { console.error(`  ✗  ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
};

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.log("TEST_DATABASE_URL not set — skipping multi-company employee admin tests (0 run).");
    return;
  }
  for (const p of FORBIDDEN_PATTERNS) if (p.test(url)) throw new Error("TEST_DATABASE_URL looks like staging/production. Refusing to run.");
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) throw new Error("TEST_DATABASE_URL is identical to DATABASE_URL. Refusing.");

  const pool = new Pool({ connectionString: url, max: 4 });
  const q = (s: string, p: any[] = []) => pool.query(s, p);
  const dbName = (await q("SELECT current_database() AS n")).rows[0]?.n as string;
  if (FORBIDDEN_PATTERNS.some((p) => p.test(dbName))) throw new Error(`current_database()="${dbName}" looks protected. Refusing.`);

  const sfx = crypto.randomBytes(4).toString("hex");
  const uid = () => crypto.randomUUID();
  // H home, G manager-level grant, E employee-level grant, S enterprise sibling of H
  // (scheduling-only), X foreign tenant.
  const [H, G, E, S, X] = [uid(), uid(), uid(), uid(), uid()];
  const companyIds = [H, G, E, S, X];
  const ent = uid();
  const W = { H: uid(), G: uid(), E: uid(), S: uid(), X: uid(), self: uid() };
  const users = { admin: uid(), emp: uid(), owner: uid(), adminX: uid() };
  let server: TestServer | undefined;
  const ids = (b: unknown) => (Array.isArray(b) ? (b as any[]).map((w) => w.id as string) : []);

  try {
    await q(`INSERT INTO enterprises (id,name) VALUES ($1,$2)`, [ent, `ZZMCE Ent ${sfx}`]);
    for (const [id, n] of [[H, "Home"], [G, "Granted"], [E, "EmpGrant"], [S, "Sibling"], [X, "Foreign"]] as const) {
      await q(`INSERT INTO companies (id,name,subscription_status,is_demo,enterprise_id) VALUES ($1,$2,'active_paid',false,$3)`,
        [id, `ZZMCE ${n} ${sfx}`, id === H || id === S ? ent : null]);
    }
    const mkWorker = (id: string, co: string, last: string) =>
      q(`INSERT INTO workers (id,company_id,first_name,last_name,worker_type,pay_rate,pay_type,ssn,employee_number,is_active)
         VALUES ($1,$2,'ZZMCE',$3,'employee','20.00','hourly','000-00-0000',$4,true)`, [id, co, `${last}-${sfx}`, `ZZMCE${last}${sfx}`]);
    await mkWorker(W.H, H, "H"); await mkWorker(W.G, G, "G"); await mkWorker(W.E, E, "E");
    await mkWorker(W.S, S, "S"); await mkWorker(W.X, X, "X"); await mkWorker(W.self, H, "Self");
    const pw = await bcrypt.hash("Mce!Synthetic", 10);
    await q(`INSERT INTO users (id,username,password,role,company_id,worker_id,is_active) VALUES
      ($1,$2,$3,'admin',$4,NULL,true),($5,$6,$3,'employee',$4,$7,true),($8,$9,$3,'owner',$4,NULL,true),($10,$11,$3,'admin',$12,NULL,true)`,
      [users.admin, `mce_admin_${sfx}`, pw, H, users.emp, `mce_emp_${sfx}`, W.self, users.owner, `mce_owner_${sfx}`, users.adminX, `mce_adminx_${sfx}`, X]);
    await q(`INSERT INTO company_user_access (user_id,company_id,role,is_default_company,is_active,worker_type) VALUES
      ($1,$2,'admin',false,true,'manager'),($1,$3,'employee',false,true,'employee')`, [users.admin, G, E]);

    server = await startTestServer(url);
    const base = server.baseUrl;
    const admin = await login(base, `mce_admin_${sfx}`, "Mce!Synthetic");
    const emp = await login(base, `mce_emp_${sfx}`, "Mce!Synthetic");
    const owner = await login(base, `mce_owner_${sfx}`, "Mce!Synthetic");
    const adminX = await login(base, `mce_adminx_${sfx}`, "Mce!Synthetic");

    console.log("\n── list ──");
    let r = await apiRequest(base, "GET", "/api/workers", admin);
    let l = ids(r.body);
    check("admin list → home + granted (H, G, self)", r.status === 200 && [W.H, W.G, W.self].every((i) => l.includes(i)), `status=${r.status}`);
    check("admin list excludes employee-level grant, scheduling-only sibling, foreign", ![W.E, W.S, W.X].some((i) => l.includes(i)));
    check("each row carries its own company", (r.body as any[]).find((w) => w.id === W.G)?.companyId === G && (r.body as any[]).find((w) => w.id === W.H)?.companyId === H);
    check("no duplicate rows", new Set(l).size === l.length);
    r = await apiRequest(base, "GET", `/api/workers?companyId=${G}`, admin); l = ids(r.body);
    check("?companyId=G → G only", r.status === 200 && l.includes(W.G) && !l.includes(W.H), `status=${r.status}`);
    r = await apiRequest(base, "GET", `/api/workers?companyId=${H}`, admin); l = ids(r.body);
    check("?companyId=H → H only", r.status === 200 && l.includes(W.H) && !l.includes(W.G), `status=${r.status}`);
    for (const [n, c] of [["foreign X", X], ["employee-level grant E", E], ["scheduling-only sibling S", S]] as const) {
      r = await apiRequest(base, "GET", `/api/workers?companyId=${c}`, admin);
      check(`?companyId=${n} → 403, no rows`, r.status === 403 && ids(r.body).length === 0, `status=${r.status}`);
    }
    r = await apiRequest(base, "GET", "/api/workers?scheduling=true", admin);
    const sRow = Array.isArray(r.body) ? (r.body as any[]).find((w) => w.id === W.S) : undefined;
    check("scheduling picker reaches sibling S only as narrow projection (no ssn/pay)", r.status === 200 && !!sRow && sRow.ssn === undefined && sRow.payRate == null, JSON.stringify(sRow));

    console.log("\n── detail / update / create ──");
    r = await apiRequest(base, "GET", `/api/workers/${W.G}`, admin);
    check("GET granted worker → 200", r.status === 200 && (r.body as any)?.companyId === G, `status=${r.status}`);
    for (const [n, w] of [["E", W.E], ["S", W.S], ["X", W.X]] as const) {
      r = await apiRequest(base, "GET", `/api/workers/${w}`, admin);
      check(`GET ${n} worker → 403`, r.status === 403, `status=${r.status}`);
    }
    r = await apiRequest(base, "PATCH", `/api/workers/${W.G}`, admin, { jobTitle: `ZZMCE edited ${sfx}` });
    check("PATCH granted worker → 200", r.status === 200, `status=${r.status}`);
    r = await apiRequest(base, "PATCH", `/api/workers/${W.G}`, admin, { companyId: H });
    check("PATCH cannot move worker between companies → 403", r.status === 403, `status=${r.status}`);
    r = await apiRequest(base, "PATCH", `/api/workers/${W.E}`, admin, { jobTitle: "x" });
    check("PATCH employee-level-grant worker → 403", r.status === 403, `status=${r.status}`);
    r = await apiRequest(base, "PATCH", `/api/workers/${W.X}`, admin, { jobTitle: "x" });
    check("PATCH foreign worker → 403", r.status === 403, `status=${r.status}`);
    r = await apiRequest(base, "POST", "/api/workers", admin, { companyId: G, firstName: "ZZMCE", lastName: `New-${sfx}`, workerType: "employee", payType: "hourly", payRate: "20.00" });
    const created = (r.body as any)?.id as string | undefined;
    check("POST in granted company → created in G", (r.status === 200 || r.status === 201) && (r.body as any)?.companyId === G, `status=${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    r = await apiRequest(base, "GET", "/api/workers", admin); l = ids(r.body);
    check("new G employee appears exactly once in admin list", !!created && l.filter((i) => i === created).length === 1);
    for (const [n, c] of [["E", E], ["X", X], ["S", S]] as const) {
      r = await apiRequest(base, "POST", "/api/workers", admin, { companyId: c, firstName: "ZZMCE", lastName: `Bad-${n}-${sfx}`, workerType: "employee", payType: "hourly", payRate: "20.00" });
      check(`POST in ${n} → 403`, r.status === 403, `status=${r.status}`);
    }
    const strays = Number((await q(`SELECT count(*)::int n FROM workers WHERE last_name LIKE $1`, [`Bad-%-${sfx}`])).rows[0].n);
    check("rejected creates wrote no worker rows", strays === 0, `rows=${strays}`);

    console.log("\n── account status ──");
    r = await apiRequest(base, "GET", "/api/workers/accounts", admin);
    check("accounts (no filter) → 200", r.status === 200 && typeof r.body === "object", `status=${r.status}`);
    r = await apiRequest(base, "GET", `/api/workers/accounts?companyId=${G}`, admin);
    check("accounts ?companyId=G → 200", r.status === 200, `status=${r.status}`);
    for (const [n, c] of [["X", X], ["E", E]] as const) {
      r = await apiRequest(base, "GET", `/api/workers/accounts?companyId=${c}`, admin);
      check(`accounts ?companyId=${n} → 403`, r.status === 403, `status=${r.status}`);
    }

    console.log("\n── administered-company set (Employee page filter + Add form) ──");
    r = await apiRequest(base, "GET", "/api/workers/admin-companies", admin);
    const set = ((r.body as any)?.companyIds ?? []) as string[];
    check("admin admin-companies = {H, G}", r.status === 200 && set.length === 2 && set.includes(H) && set.includes(G), JSON.stringify(r.body));
    r = await apiRequest(base, "GET", "/api/workers/admin-companies", emp);
    check("employee admin-companies = []", r.status === 200 && Array.isArray((r.body as any)?.companyIds) && (r.body as any).companyIds.length === 0, JSON.stringify(r.body));
    r = await apiRequest(base, "GET", "/api/workers/admin-companies", adminX);
    check("Tenant X admin admin-companies = {X}", r.status === 200 && JSON.stringify((r.body as any)?.companyIds) === JSON.stringify([X]), JSON.stringify(r.body));

    console.log("\n── other roles ──");
    r = await apiRequest(base, "GET", "/api/workers", emp); l = ids(r.body);
    check("employee list → self only", r.status === 200 && l.length === 1 && l[0] === W.self, `status=${r.status} n=${l.length}`);
    r = await apiRequest(base, "GET", `/api/workers/${W.H}`, emp);
    check("employee GET coworker → 403", r.status === 403, `status=${r.status}`);
    r = await apiRequest(base, "GET", "/api/workers", owner); l = ids(r.body);
    check("owner (no grants) list → home only", r.status === 200 && l.includes(W.H) && !l.includes(W.G), `status=${r.status}`);
    r = await apiRequest(base, "POST", "/api/workers", owner, { companyId: H, firstName: "ZZMCE", lastName: `Owner-${sfx}`, workerType: "employee", payType: "hourly", payRate: "20.00" });
    check("owner POST in home company still allowed", r.status === 200 || r.status === 201, `status=${r.status}`);
    r = await apiRequest(base, "POST", "/api/workers", owner, { companyId: G, firstName: "ZZMCE", lastName: `Bad-OG-${sfx}`, workerType: "employee", payType: "hourly", payRate: "20.00" });
    check("owner POST in G (no grant) → 403", r.status === 403, `status=${r.status}`);
    r = await apiRequest(base, "GET", "/api/workers", adminX); l = ids(r.body);
    check("Tenant X admin → X only", r.status === 200 && l.includes(W.X) && ![W.H, W.G, W.E, W.S].some((i) => l.includes(i)), `status=${r.status}`);
  } finally {
    if (server) await server.stop().catch(() => {});
    try {
      await q(`DELETE FROM session WHERE sess->>'userId' = ANY($1::varchar[])`, [Object.values(users)]).catch(() => {});
      await q(`DELETE FROM company_user_access WHERE user_id = ANY($1::varchar[]) OR company_id = ANY($2::varchar[])`, [Object.values(users), companyIds]);
      await q(`DELETE FROM authorization_audit_log WHERE company_id = ANY($1::varchar[]) OR actor_user_id = ANY($2::varchar[])`, [companyIds, Object.values(users)]).catch(() => {});
      await q(`DELETE FROM users WHERE id = ANY($1::varchar[])`, [Object.values(users)]);
      await cascadeDelete(pool, "companies", companyIds);
      await q(`DELETE FROM enterprises WHERE id = $1`, [ent]);
      const residue = await verifyZeroResidue(pool, "companies", companyIds);
      if (residue.length) { console.error("CLEANUP RESIDUE:", residue.join("; ")); failed++; }
      else console.log("\ncleanup: zero residue confirmed");
    } catch (e) {
      console.error("cleanup error:", (e as Error).message);
      failed++;
    }
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
