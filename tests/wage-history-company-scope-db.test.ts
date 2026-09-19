/**
 * GET/POST/PATCH/DELETE /api/wage-history — company-scope regression suite,
 * plus PATCH /api/workers/:id pay-rate validation parity.
 *
 * Reported symptom: "editing my salary in production freezes." Traced to the
 * Wages tab (client/src/pages/employee.tsx WagesTab — the actual editor for a
 * dated salary/wage change, distinct from the Employee tab's plain pay-rate
 * field) calling `GET /api/wage-history` with no `workerId`. The server's
 * manager/admin branch fell through to `storage.getWageHistory(undefined)`,
 * which ran with no WHERE clause at all — every wage_history row for every
 * tenant in the database, unpaginated, rendered into one unvirtualized table
 * client-side. On a platform that accumulates rows across many tenants (real
 * companies + self-service demo signups), this is large enough to both leak
 * another tenant's salary data into the table and to lock up the tab
 * rendering it — "freezes," not a caught error, because nothing throws.
 *
 * Fix: GET now resolves the caller's own company (same pattern as
 * GET /api/workers) and scopes storage.getWageHistory() to it whenever no
 * explicit workerId is given. PATCH/DELETE /api/wage-history/:id gained the
 * company-ownership guard that PATCH /api/workers/:id already had (there was
 * none at all before — any admin/manager could edit or delete any other
 * tenant's wage_history row by id). POST resolves company scope server-side
 * instead of trusting the client-sent value (mirrors POST
 * /api/remittance-sources, PR #158) and rejects a worker/company mismatch.
 * Separately, PATCH /api/workers/:id gained the same normalizeWorkerPayRate
 * validation POST already had — PATCH silently accepted a blank or negative
 * pay rate.
 *
 * Real running server, real HTTP, disposable database, synthetic fixtures only.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable_db npx tsx tests/wage-history-company-scope-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { startTestServer, login, apiRequest, type TestServer } from "../scripts/cross-tenant-negative-tests/server-harness";
import { cascadeDelete, verifyZeroResidue } from "../scripts/cross-tenant-negative-tests/cascade-cleanup";

const FORBIDDEN_PATTERNS = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];

let passed = 0, failed = 0;
const errors: string[] = [];
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) { console.log(`  ✓  ${name}`); passed++; }
  else { console.error(`  ✗  ${name}${detail ? ` — ${detail}` : ""}`); errors.push(name); failed++; }
};

async function main() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    console.log("TEST_DATABASE_URL not set — skipping wage-history-company-scope tests (0 run).");
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
  let server: TestServer | undefined;

  try {
    const dbName = (await pool.query("SELECT current_database() AS n")).rows[0]?.n as string;
    if (FORBIDDEN_PATTERNS.some((p) => p.test(dbName))) throw new Error(`current_database()="${dbName}" looks protected. Refusing.`);

    const companyA = crypto.randomUUID();
    const companyB = crypto.randomUUID();
    companyIds.push(companyA, companyB);
    await pool.query(
      `INSERT INTO companies (id, name) VALUES ($1,$2),($3,$4)`,
      [companyA, `WH Co A ${sfx}`, companyB, `WH Co B ${sfx}`],
    );

    const workerA = crypto.randomUUID();
    const workerB = crypto.randomUUID();
    await pool.query(
      `INSERT INTO workers (id, company_id, first_name, last_name, worker_type, status, hire_date, pay_rate, pay_type, employee_number, currency, country, gender, is_active, worker_group)
       VALUES
        ($1,$2,'Synthetic','WorkerA','employee','active','2026-01-01','18720','salary','9101','USD','US','unspecified',true,'salaried_employee'),
        ($3,$4,'Synthetic','WorkerB','employee','active','2026-01-01','60000','salary','9102','USD','US','unspecified',true,'salaried_employee')`,
      [workerA, companyA, workerB, companyB],
    );

    const wageA = crypto.randomUUID();
    const wageB = crypto.randomUUID();
    await pool.query(
      `INSERT INTO wage_history (id, worker_id, company_id, wage_type, wage, effective_date, note)
       VALUES
        ($1,$2,$3,'salary','18720','2026-01-01','synthetic ${sfx}'),
        ($4,$5,$6,'salary','60000','2026-01-01','synthetic ${sfx}')`,
      [wageA, workerA, companyA, wageB, workerB, companyB],
    );

    const pw = crypto.randomBytes(10).toString("hex");
    const pwHash = await bcrypt.hash(pw, 10);
    const uAdminA = `wh_adminA_${sfx}`, uAdminB = `wh_adminB_${sfx}`, uPlatformSuper = `wh_psa_${sfx}`;
    await pool.query(
      `INSERT INTO users (id, username, password, role, company_id, is_active) VALUES
        ($1,$2,$3,'admin',$4,true),
        ($5,$6,$3,'admin',$7,true),
        ($8,$9,$3,'platform_super_admin',NULL,true)`,
      [crypto.randomUUID(), uAdminA, pwHash, companyA,
       crypto.randomUUID(), uAdminB, companyB,
       crypto.randomUUID(), uPlatformSuper],
    );

    server = await startTestServer(testDatabaseUrl);
    const base = server.baseUrl;
    const sAdminA = await login(base, uAdminA, pw);
    const sAdminB = await login(base, uAdminB, pw);
    const sPSA = await login(base, uPlatformSuper, pw);

    console.log("\n── 1. GET /api/wage-history with no workerId is company-scoped (the leak) ──");
    const g1 = await apiRequest(base, "GET", "/api/wage-history", sAdminA);
    check("admin A → 200", g1.status === 200, `status=${g1.status}`);
    const g1rows = (g1.body as any[]) || [];
    check("admin A sees own company's row", g1rows.some((r) => r.id === wageA));
    check("admin A does NOT see company B's row", !g1rows.some((r) => r.id === wageB), `rows=${JSON.stringify(g1rows.map((r) => r.id))}`);

    const g2 = await apiRequest(base, "GET", "/api/wage-history", sAdminB);
    const g2rows = (g2.body as any[]) || [];
    check("admin B sees own company's row, not A's", g2rows.some((r) => r.id === wageB) && !g2rows.some((r) => r.id === wageA));

    console.log("\n── 2. Explicit cross-tenant workerId still returns [] (pre-existing guard, unaffected) ──");
    const g3 = await apiRequest(base, "GET", `/api/wage-history?workerId=${workerB}`, sAdminA);
    check("admin A querying B's workerId → []", g3.status === 200 && Array.isArray(g3.body) && (g3.body as any[]).length === 0);

    console.log("\n── 3. PATCH cross-tenant → 403, row unchanged ──");
    const p1 = await apiRequest(base, "PATCH", `/api/wage-history/${wageB}`, sAdminA, { wage: "999999" });
    check("admin A PATCHing B's row → 403", p1.status === 403, `status=${p1.status}`);
    const stillB = await pool.query(`SELECT wage FROM wage_history WHERE id=$1`, [wageB]);
    check("B's row untouched", stillB.rows[0]?.wage === "60000", `wage=${stillB.rows[0]?.wage}`);

    console.log("\n── 4. DELETE cross-tenant → 403, row still exists ──");
    const d1 = await apiRequest(base, "DELETE", `/api/wage-history/${wageB}`, sAdminA);
    check("admin A deleting B's row → 403", d1.status === 403, `status=${d1.status}`);
    const stillExists = await pool.query(`SELECT 1 FROM wage_history WHERE id=$1`, [wageB]);
    check("B's row still exists", (stillExists.rowCount ?? 0) === 1);

    console.log("\n── 5. Own-tenant PATCH still works; companyId is immutable through this endpoint ──");
    const p2 = await apiRequest(base, "PATCH", `/api/wage-history/${wageA}`, sAdminA, { wage: "19500", companyId: companyB });
    check("own-tenant PATCH → 200", p2.status === 200, `status=${p2.status}`);
    check("wage updated", (p2.body as any)?.wage === "19500", `wage=${(p2.body as any)?.wage}`);
    check("companyId ignored, not reassigned", (p2.body as any)?.companyId === companyA, `companyId=${(p2.body as any)?.companyId}`);

    console.log("\n── 6. POST resolves company server-side; blank/wrong client companyId ignored ──");
    const post1 = await apiRequest(base, "POST", "/api/wage-history", sAdminA, {
      workerId: workerA, companyId: "", wageType: "salary", wage: "21000", effectiveDate: "2026-02-01",
    });
    check("blank companyId still creates (server resolves it) → 201", post1.status === 201, `status=${post1.status} body=${JSON.stringify(post1.body)}`);
    check("server-resolved companyId is caller's own company", (post1.body as any)?.companyId === companyA);

    const post2 = await apiRequest(base, "POST", "/api/wage-history", sAdminA, {
      workerId: workerA, companyId: companyB, wageType: "salary", wage: "22000", effectiveDate: "2026-03-01",
    });
    check("client-supplied foreign companyId ignored → still A", post2.status === 201 && (post2.body as any)?.companyId === companyA, `status=${post2.status} companyId=${(post2.body as any)?.companyId}`);

    console.log("\n── 7. POST rejects a worker that does not belong to the resolved company ──");
    const post3 = await apiRequest(base, "POST", "/api/wage-history", sAdminA, {
      workerId: workerB, companyId: companyA, wageType: "salary", wage: "23000", effectiveDate: "2026-04-01",
    });
    check("admin A cannot create a wage entry for B's worker → 403", post3.status === 403, `status=${post3.status}`);

    console.log("\n── 8. Platform admin: GET with no workerId/companyId scoping stays unscoped by design (matches GET /api/workers) ──");
    const g4 = await apiRequest(base, "GET", "/api/wage-history", sPSA);
    const g4rows = (g4.body as any[]) || [];
    check("platform admin sees both companies' rows (existing /api/workers convention)", g4rows.some((r) => r.id === wageA) && g4rows.some((r) => r.id === wageB));
    const g5 = await apiRequest(base, "GET", `/api/wage-history?companyId=${companyA}`, sPSA);
    const g5rows = (g5.body as any[]) || [];
    check("platform admin can narrow with ?companyId", g5rows.some((r) => r.id === wageA) && !g5rows.some((r) => r.id === wageB));

    console.log("\n── 9. PATCH /api/workers/:id — pay-rate validation parity with POST ──");
    const w1 = await apiRequest(base, "PATCH", `/api/workers/${workerA}`, sAdminA, { payRate: "-500" });
    check("negative payRate on PATCH → 400 (previously silently accepted)", w1.status === 400, `status=${w1.status}`);
    const stillA = await pool.query(`SELECT pay_rate FROM workers WHERE id=$1`, [workerA]);
    check("rejected PATCH did not change the stored pay rate", stillA.rows[0]?.pay_rate === "18720", `pay_rate=${stillA.rows[0]?.pay_rate}`);
    const w2 = await apiRequest(base, "PATCH", `/api/workers/${workerA}`, sAdminA, { payRate: "19500" });
    check("valid payRate PATCH after a rejected one → 200 (form recovers)", w2.status === 200 && (w2.body as any)?.payRate === "19500", `status=${w2.status}`);

    console.log(`\n${passed} passed, ${failed} failed`);
  } finally {
    if (server) await server.stop();
    try {
      await pool.query(`DELETE FROM wage_history WHERE company_id = ANY($1::varchar[])`, [companyIds]).catch(() => {});
      await pool.query(`DELETE FROM session WHERE sess->>'userId' IN (SELECT id FROM users WHERE username LIKE $1)`, [`wh_%_${sfx}`]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE username LIKE $1`, [`wh_%_${sfx}`]);
      await cascadeDelete(pool, "companies", companyIds);
      const residue = [...(await verifyZeroResidue(pool, "companies", companyIds))];
      const strayWh = (await pool.query(`SELECT count(*)::int n FROM wage_history WHERE note LIKE $1`, [`%${sfx}%`])).rows[0].n;
      if (strayWh > 0) residue.push(`wage_history with test marker: ${strayWh}`);
      const strayUsers = (await pool.query(`SELECT count(*)::int n FROM users WHERE username LIKE $1`, [`wh_%_${sfx}`])).rows[0].n;
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
