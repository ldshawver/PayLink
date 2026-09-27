/**
 * Employee Add/Edit dialog freeze — regression suite.
 *
 * Reported symptom: "the app freezes whenever an employee is added or edited"
 * (production v2.2.13). Root cause: server/seed.ts seedDemoHierarchy() ran on
 * every boot even when companies already existed (its "Demo Corp" guard never
 * matches a real database) and inserted another legal entity + two
 * departments into whichever tenant an unordered SELECT returned first.
 * Production accumulated ~432k departments rows; GET /api/departments (loaded
 * by the Employee page and rendered as <SelectItem>s in the Add/Edit dialog)
 * returned a ~100 MB body, which blocked the browser main thread.
 *
 * Covered here:
 *   1. Server boot no longer inserts demo-hierarchy rows when companies exist.
 *   2. scripts/cleanup-seed-duplicate-hierarchy.ts: dry run writes nothing;
 *      --apply removes only unreferenced duplicates, keeps the oldest and any
 *      referenced row, never touches another tenant's rows.
 *   3. Tenant scoping on the dialog's data paths: GET /api/departments,
 *      /api/branches, /api/workers; a tenant user with no resolvable company
 *      gets [] / 403 instead of every tenant's rows.
 *   4. Worker POST/PATCH/DELETE cross-company denial; add → edit (non-financial
 *      field) → reload leaves pay rate and wage_history untouched and creates
 *      exactly one worker.
 *   5. /api/employee-contacts (called by the dialog's save path) GET/POST/
 *      PATCH/DELETE ownership checks.
 *
 * Real running server, real HTTP, disposable database, synthetic fixtures only.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable_db npx tsx tests/employee-create-edit-freeze-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import bcrypt from "bcrypt";
import { startTestServer, login, apiRequest, resolveTsxCliPath, type TestServer } from "../scripts/cross-tenant-negative-tests/server-harness";
import { cascadeDelete, verifyZeroResidue } from "../scripts/cross-tenant-negative-tests/cascade-cleanup";

const FORBIDDEN_PATTERNS = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];

let passed = 0, failed = 0;
const errors: string[] = [];
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) { console.log(`  ✓  ${name}`); passed++; }
  else { console.error(`  ✗  ${name}${detail ? ` — ${detail}` : ""}`); errors.push(name); failed++; }
};
const ids = (body: unknown) => (Array.isArray(body) ? (body as any[]).map((r) => r.id) : []);

async function main() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    console.log("TEST_DATABASE_URL not set — skipping employee-create-edit-freeze tests (0 run).");
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
  const sfx = crypto.randomBytes(4).toString("hex");
  const backupFile = path.join(os.tmpdir(), `seed-dup-cleanup-${sfx}.jsonl`);
  let server: TestServer | undefined;

  try {
    const dbName = (await pool.query("SELECT current_database() AS n")).rows[0]?.n as string;
    if (FORBIDDEN_PATTERNS.some((p) => p.test(dbName))) throw new Error(`current_database()="${dbName}" looks protected. Refusing.`);

    const companyA = crypto.randomUUID();
    const companyB = crypto.randomUUID();
    companyIds.push(companyA, companyB);
    await pool.query(`INSERT INTO companies (id, name) VALUES ($1,$2),($3,$4)`,
      [companyA, `EF Co A ${sfx}`, companyB, `EF Co B ${sfx}`]);

    const workerA = crypto.randomUUID(), workerB = crypto.randomUUID();
    await pool.query(
      `INSERT INTO workers (id, company_id, first_name, last_name, worker_type, status, hire_date, pay_rate, pay_type, employee_number, currency, country, gender, is_active, worker_group)
       VALUES
        ($1,$2,'Synthetic','WorkerA','employee','active','2026-01-01','25','hourly','9201','USD','US','unspecified',true,'hourly_employee'),
        ($3,$4,'Synthetic','WorkerB','employee','active','2026-01-01','30','hourly','9202','USD','US','unspecified',true,'hourly_employee')`,
      [workerA, companyA, workerB, companyB]);
    await pool.query(
      `INSERT INTO wage_history (id, worker_id, company_id, wage_type, wage, effective_date, note)
       VALUES ($1,$2,$3,'hourly','25','2026-01-01','synthetic ${sfx}')`,
      [crypto.randomUUID(), workerA, companyA]);

    const contactA = crypto.randomUUID(), contactB = crypto.randomUUID();
    await pool.query(
      `INSERT INTO employee_contacts (id, worker_id, contact_type, name, is_primary) VALUES
        ($1,$2,'emergency','Synthetic Contact A',true), ($3,$4,'emergency','Synthetic Contact B',true)`,
      [contactA, workerA, contactB, workerB]);

    const deptA = crypto.randomUUID(), deptB = crypto.randomUUID();
    await pool.query(`INSERT INTO departments (id, company_id, name) VALUES ($1,$2,'EF Dept A'),($3,$4,'EF Dept B')`,
      [deptA, companyA, deptB, companyB]);
    const branchA = crypto.randomUUID(), branchB = crypto.randomUUID();
    await pool.query(`INSERT INTO branches (id, company_id, name) VALUES ($1,$2,'EF Branch A'),($3,$4,'EF Branch B')`,
      [branchA, companyA, branchB, companyB]);

    // Seeder-shaped duplicates in company A: 3 x HQ + 3 x ENG + 3 legal entities, one
    // non-oldest HQ referenced by a worker and one non-oldest legal entity by a location.
    const dupDepts: string[] = [];
    for (let i = 0; i < 3; i++) {
      for (const [n, c] of [["Headquarters", "HQ"], ["Engineering", "ENG"]]) {
        const id = crypto.randomUUID(); dupDepts.push(id);
        await pool.query(`INSERT INTO departments (id, company_id, name, code, is_active, created_at) VALUES ($1,$2,$3,$4,true, now() + ($5 || ' seconds')::interval)`,
          [id, companyA, n, c, String(i)]);
      }
    }
    const dupLes: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = crypto.randomUUID(); dupLes.push(id);
      await pool.query(`INSERT INTO legal_entities (id, company_id, legal_name, type, status, address, city, state, zip, country, created_at)
        VALUES ($1,$2,$3,'llc','active','100 Demo Way','Austin','TX','78701','US', now() + ($4 || ' seconds')::interval)`,
        [id, companyA, `EF Co A ${sfx}`, String(i)]);
    }
    const referencedHq = dupDepts[4]; // third HQ (not the oldest)
    await pool.query(`UPDATE workers SET default_department_id=$1 WHERE id=$2`, [referencedHq, workerA]);
    await pool.query(`INSERT INTO locations (company_id, legal_entity_id, name) VALUES ($1,$2,'EF ref location')`, [companyA, dupLes[2]]);

    const pw = crypto.randomBytes(10).toString("hex");
    const pwHash = await bcrypt.hash(pw, 10);
    const uA = `ef_adminA_${sfx}`, uB = `ef_adminB_${sfx}`, uOrphan = `ef_orphan_${sfx}`, uPsa = `ef_psa_${sfx}`;
    await pool.query(
      `INSERT INTO users (id, username, password, role, company_id, is_active) VALUES
        ($1,$2,$3,'admin',$4,true), ($5,$6,$3,'admin',$7,true),
        ($8,$9,$3,'admin',NULL,true), ($10,$11,$3,'platform_super_admin',NULL,true)`,
      [crypto.randomUUID(), uA, pwHash, companyA, crypto.randomUUID(), uB, companyB,
       crypto.randomUUID(), uOrphan, crypto.randomUUID(), uPsa]);

    const countRows = async () => (await pool.query(
      `SELECT (SELECT count(*)::int FROM departments) d, (SELECT count(*)::int FROM legal_entities) l`)).rows[0];

    console.log("\n── 1. Server boot does not seed demo hierarchy into existing companies ──");
    const beforeBoot = await countRows();
    server = await startTestServer(testDatabaseUrl);
    const base = server.baseUrl;
    const afterBoot = await countRows();
    check("departments count unchanged by boot", afterBoot.d === beforeBoot.d, `${beforeBoot.d} → ${afterBoot.d}`);
    check("legal_entities count unchanged by boot", afterBoot.l === beforeBoot.l, `${beforeBoot.l} → ${afterBoot.l}`);

    const sA = await login(base, uA, pw);
    const sB = await login(base, uB, pw);
    const sOrphan = await login(base, uOrphan, pw);
    const sPsa = await login(base, uPsa, pw);

    console.log("\n── 2. Lookup endpoints used by the dialog are tenant-scoped ──");
    const dA = await apiRequest(base, "GET", "/api/departments", sA);
    check("admin A sees own department", ids(dA.body).includes(deptA));
    check("admin A does not see B's department", !ids(dA.body).includes(deptB));
    const dB = await apiRequest(base, "GET", "/api/departments", sB);
    check("admin B does not see A's departments", !ids(dB.body).includes(deptA) && !ids(dB.body).some((i) => dupDepts.includes(i)));
    const bA = await apiRequest(base, "GET", "/api/branches", sA);
    check("admin A branches: own only", ids(bA.body).includes(branchA) && !ids(bA.body).includes(branchB));
    for (const p of ["/api/departments", "/api/branches", "/api/workers", "/api/employee-contacts"]) {
      const r = await apiRequest(base, "GET", p, sOrphan);
      check(`no-company tenant admin GET ${p} → [] (was: every tenant's rows)`, r.status === 200 && Array.isArray(r.body) && (r.body as any[]).length === 0,
        `status=${r.status} n=${Array.isArray(r.body) ? (r.body as any[]).length : "?"}`);
    }
    const dPsa = await apiRequest(base, "GET", `/api/departments?companyId=${companyB}`, sPsa);
    check("platform admin can still narrow departments by ?companyId", ids(dPsa.body).includes(deptB) && !ids(dPsa.body).includes(deptA));

    console.log("\n── 3. Worker create/edit/delete: cross-company denial ──");
    const wg = await apiRequest(base, "GET", `/api/workers/${workerB}`, sA);
    check("admin A GET B's worker → 403", wg.status === 403, `status=${wg.status}`);
    const wgo = await apiRequest(base, "GET", `/api/workers/${workerA}`, sOrphan);
    check("no-company tenant admin GET worker → 403", wgo.status === 403, `status=${wgo.status}`);
    const wp1 = await apiRequest(base, "POST", "/api/workers", sA, { companyId: companyB, firstName: "Synthetic", lastName: `Xco${sfx}`, payRate: "20", workerType: "employee" });
    check("admin A POST worker into company B → 403", wp1.status === 403, `status=${wp1.status}`);
    const wp2 = await apiRequest(base, "POST", "/api/workers", sOrphan, { companyId: companyA, firstName: "Synthetic", lastName: `Orph${sfx}`, payRate: "20", workerType: "employee" });
    check("no-company tenant admin POST worker → 403 (guard previously skipped)", wp2.status === 403, `status=${wp2.status}`);
    const wpa = await apiRequest(base, "PATCH", `/api/workers/${workerB}`, sA, { note: "x" });
    check("admin A PATCH B's worker → 403", wpa.status === 403, `status=${wpa.status}`);
    const wpo = await apiRequest(base, "PATCH", `/api/workers/${workerA}`, sOrphan, { note: "x" });
    check("no-company tenant admin PATCH worker → 403", wpo.status === 403, `status=${wpo.status}`);
    const wd = await apiRequest(base, "DELETE", `/api/workers/${workerB}`, sA);
    check("admin A DELETE B's worker → 403", wd.status === 403, `status=${wd.status}`);
    const wdo = await apiRequest(base, "DELETE", `/api/workers/${workerA}`, sOrphan);
    check("no-company tenant admin DELETE worker → 403", wdo.status === 403, `status=${wdo.status}`);
    const acctA = await apiRequest(base, "GET", `/api/workers/${workerB}/account`, sA);
    check("admin A GET B's worker account → 403", acctA.status === 403, `status=${acctA.status}`);
    const acctO = await apiRequest(base, "GET", `/api/workers/${workerA}/account`, sOrphan);
    check("no-company tenant admin GET worker account → 403", acctO.status === 403, `status=${acctO.status}`);
    const stillB = await pool.query(`SELECT note, pay_rate FROM workers WHERE id=$1`, [workerB]);
    check("B's worker unchanged and present", stillB.rowCount === 1 && stillB.rows[0].note !== "x" && stillB.rows[0].pay_rate === "30");

    console.log("\n── 4. Add → edit non-financial field → reload (own tenant) ──");
    const lastName = `Added${sfx}`;
    const bad = await apiRequest(base, "POST", "/api/workers", sA, { companyId: companyA, firstName: "", lastName, payRate: "22", workerType: "employee" });
    check("validation error (blank first name) → 400, nothing created", bad.status === 400 &&
      (await pool.query(`SELECT count(*)::int n FROM workers WHERE last_name=$1`, [lastName])).rows[0].n === 0, `status=${bad.status}`);
    const add = await apiRequest(base, "POST", "/api/workers", sA, { companyId: companyA, firstName: "Synthetic", lastName, payRate: "22", payType: "hourly", workerType: "employee" });
    check("add → 201 in own company", add.status === 201 && (add.body as any)?.companyId === companyA, `status=${add.status}`);
    const newId = (add.body as any)?.id as string;
    const ec = await apiRequest(base, "POST", "/api/employee-contacts", sA, { workerId: newId, contactType: "emergency", name: "Synthetic EC", isPrimary: true });
    check("dialog's emergency-contact POST for own new worker → 201", ec.status === 201, `status=${ec.status}`);
    const wageBefore = (await pool.query(`SELECT count(*)::int n, string_agg(wage::text, ',' ORDER BY id) w FROM wage_history WHERE company_id=$1`, [companyA])).rows[0];
    const edit = await apiRequest(base, "PATCH", `/api/workers/${newId}`, sA, { note: `edited ${sfx}` });
    check("edit non-financial field → 200", edit.status === 200, `status=${edit.status}`);
    const reload = await apiRequest(base, "GET", "/api/workers", sA);
    const mine = (reload.body as any[]).filter((w) => w.lastName === lastName);
    check("reload: exactly one worker (no duplicate)", mine.length === 1, `n=${mine.length}`);
    check("reload: edit persisted, pay rate unchanged", mine[0]?.note === `edited ${sfx}` && mine[0]?.payRate === "22", `note=${mine[0]?.note} payRate=${mine[0]?.payRate}`);
    const wageAfter = (await pool.query(`SELECT count(*)::int n, string_agg(wage::text, ',' ORDER BY id) w FROM wage_history WHERE company_id=$1`, [companyA])).rows[0];
    check("wage_history unchanged by a non-financial edit", wageAfter.n === wageBefore.n && wageAfter.w === wageBefore.w);
    const fail = await apiRequest(base, "PATCH", `/api/workers/${newId}`, sA, { payRate: "-5" });
    const recover = await apiRequest(base, "PATCH", `/api/workers/${newId}`, sA, { note: `recovered ${sfx}` });
    check("failed save (400) then retry → 200 (form recovers)", fail.status === 400 && recover.status === 200, `fail=${fail.status} retry=${recover.status}`);

    console.log("\n── 5. /api/employee-contacts ownership ──");
    const cAll = await apiRequest(base, "GET", "/api/employee-contacts", sA);
    check("admin A GET (no workerId) sees own contact", ids(cAll.body).includes(contactA));
    check("admin A GET (no workerId) does NOT see B's contact", !ids(cAll.body).includes(contactB));
    const cFor = await apiRequest(base, "GET", `/api/employee-contacts?workerId=${workerB}`, sA);
    check("admin A GET ?workerId=<B's worker> → []", cFor.status === 200 && (cFor.body as any[]).length === 0);
    const cPost = await apiRequest(base, "POST", "/api/employee-contacts", sA, { workerId: workerB, contactType: "emergency", name: "Injected" });
    check("admin A POST contact onto B's worker → 403", cPost.status === 403, `status=${cPost.status}`);
    const cPatch = await apiRequest(base, "PATCH", `/api/employee-contacts/${contactB}`, sA, { name: "Hijacked" });
    check("admin A PATCH B's contact → 403", cPatch.status === 403, `status=${cPatch.status}`);
    const cMove = await apiRequest(base, "PATCH", `/api/employee-contacts/${contactA}`, sA, { workerId: workerB });
    check("admin A cannot move own contact onto B's worker → 403", cMove.status === 403, `status=${cMove.status}`);
    const cDel = await apiRequest(base, "DELETE", `/api/employee-contacts/${contactB}`, sA);
    check("admin A DELETE B's contact → 403", cDel.status === 403, `status=${cDel.status}`);
    const cB = await pool.query(`SELECT name, worker_id FROM employee_contacts WHERE id=$1`, [contactB]);
    check("B's contact untouched", cB.rows[0]?.name === "Synthetic Contact B" && cB.rows[0]?.worker_id === workerB);
    const cA = await pool.query(`SELECT worker_id FROM employee_contacts WHERE id=$1`, [contactA]);
    check("A's contact not reassigned", cA.rows[0]?.worker_id === workerA);
    const cOwn = await apiRequest(base, "PATCH", `/api/employee-contacts/${contactA}`, sA, { workerId: workerA, phone: "555-0100" });
    check("admin A PATCH own contact → 200", cOwn.status === 200, `status=${cOwn.status}`);
    const cGone = await apiRequest(base, "DELETE", `/api/employee-contacts/${crypto.randomUUID()}`, sA);
    check("DELETE unknown contact → 404", cGone.status === 404, `status=${cGone.status}`);
    const cPsa = await apiRequest(base, "GET", `/api/employee-contacts?workerId=${workerB}`, sPsa);
    check("platform admin can still read any worker's contacts", ids(cPsa.body).includes(contactB));

    console.log("\n── 6. Duplicate-row cleanup script ──");
    await server.stop(); server = undefined;
    const tsx = resolveTsxCliPath();
    const script = path.join(process.cwd(), "scripts/cleanup-seed-duplicate-hierarchy.ts");
    const env = { ...process.env, DATABASE_URL: testDatabaseUrl };
    const beforeDry = await countRows();
    execFileSync(process.execPath, [tsx, script], { env, stdio: "pipe" });
    const afterDry = await countRows();
    check("dry run deletes nothing", afterDry.d === beforeDry.d && afterDry.l === beforeDry.l);
    execFileSync(process.execPath, [tsx, script, "--apply", `--backup-file=${backupFile}`], { env, stdio: "pipe" });
    const remainingDup = (await pool.query(`SELECT id FROM departments WHERE id = ANY($1::varchar[])`, [dupDepts])).rows.map((r) => r.id);
    check("oldest HQ and oldest ENG kept", remainingDup.includes(dupDepts[0]) && remainingDup.includes(dupDepts[1]));
    check("referenced (non-oldest) HQ kept", remainingDup.includes(referencedHq));
    check("unreferenced duplicates removed (3 of 6 remain)", remainingDup.length === 3, `remaining=${remainingDup.length}`);
    const remainingLe = (await pool.query(`SELECT id FROM legal_entities WHERE id = ANY($1::varchar[])`, [dupLes])).rows.map((r) => r.id);
    check("legal entities: oldest + referenced kept, 1 removed", remainingLe.length === 2 && remainingLe.includes(dupLes[0]) && remainingLe.includes(dupLes[2]), `remaining=${remainingLe.length}`);
    const others = (await pool.query(`SELECT count(*)::int n FROM departments WHERE id = ANY($1::varchar[])`, [[deptA, deptB]])).rows[0].n;
    check("non-seed departments (both tenants) untouched", others === 2);
    const backupLines = fs.readFileSync(backupFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    check("every deleted fixture row was backed up first",
      [dupDepts[2], dupDepts[3], dupDepts[5], dupLes[1]].every((id) => backupLines.some((b) => b.row.id === id)));

    console.log(`\n${passed} passed, ${failed} failed`);
  } finally {
    if (server) await server.stop();
    try { fs.unlinkSync(backupFile); } catch {}
    try {
      await pool.query(`DELETE FROM employee_contacts WHERE worker_id IN (SELECT id FROM workers WHERE company_id = ANY($1::varchar[]))`, [companyIds]).catch(() => {});
      await pool.query(`DELETE FROM wage_history WHERE company_id = ANY($1::varchar[])`, [companyIds]).catch(() => {});
      await pool.query(`DELETE FROM session WHERE sess->>'userId' IN (SELECT id FROM users WHERE username LIKE $1)`, [`ef_%_${sfx}`]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE username LIKE $1`, [`ef_%_${sfx}`]);
      await cascadeDelete(pool, "companies", companyIds);
      const residue = [...(await verifyZeroResidue(pool, "companies", companyIds))];
      const strayUsers = (await pool.query(`SELECT count(*)::int n FROM users WHERE username LIKE $1`, [`ef_%_${sfx}`])).rows[0].n;
      if (strayUsers > 0) residue.push(`test users: ${strayUsers}`);
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
