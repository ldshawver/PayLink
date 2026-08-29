/**
 * POST /api/customers — company-scope + failure-handling regression suite.
 *
 * Production incident: a customer-creation attempt returned HTTP 500
 * ("Failed to create customer"). Root cause: the route passed the request
 * body straight into `db.insert(customers)`. `companyId` came from the
 * client (frontend sends `user.companyId`); when the acting user has no
 * company (a platform admin) or a stale/orphaned company_id, the insert hit
 * a NOT NULL / FK violation on `company_id` and surfaced as an opaque 500
 * with no partial record and no useful log.
 *
 * Fix: resolve company scope server-side.
 *  - Tenant user: company comes exclusively from the session; a body
 *    companyId cannot override it.
 *  - Platform admin (super-admin / admin / owner): must explicitly select an
 *    acting company, which the server validates (exists + the platform role
 *    may act for it) and audits.
 *  - No usable company context: sanitized 400 INVALID_COMPANY_CONTEXT,
 *    nothing created.
 *  - Platform support/implementation/auditor never reach the handler
 *    (requireRole("admin","manager")).
 *
 * Real running server, real HTTP, disposable database, synthetic fixtures
 * only. No real customer PII.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable_db npx tsx tests/customer-create-company-scope-db.test.ts
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
    console.log("TEST_DATABASE_URL not set — skipping customer-create-company-scope tests (0 run).");
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
    const orphanCompanyId = crypto.randomUUID();     // never inserted
    const nonexistentCompanyId = crypto.randomUUID(); // never inserted
    companyIds.push(companyA, companyB);
    await pool.query(`INSERT INTO companies (id, name) VALUES ($1,$2),($3,$4)`, [companyA, `Cust Co A ${sfx}`, companyB, `Cust Co B ${sfx}`]);

    const pw = crypto.randomBytes(10).toString("hex");
    const pwHash = await bcrypt.hash(pw, 10);
    const uAdminA = `cust_adminA_${sfx}`, uAdminB = `cust_adminB_${sfx}`,
      uNoCoAdmin = `cust_noco_${sfx}`, uOrphanAdmin = `cust_orphan_${sfx}`,
      uPlatformSuper = `cust_psa_${sfx}`, uPlatformSupport = `cust_psup_${sfx}`;
    const platformSuperId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, username, password, role, company_id, is_active) VALUES
        ($1,$2,$3,'admin',$4,true),
        ($5,$6,$3,'admin',$7,true),
        ($8,$9,$3,'admin',NULL,true),
        ($10,$11,$3,'admin',$12,true),
        ($13,$14,$3,'platform_super_admin',NULL,true),
        ($15,$16,$3,'platform_support',NULL,true)`,
      [crypto.randomUUID(), uAdminA, pwHash, companyA,
       crypto.randomUUID(), uAdminB, companyB,
       crypto.randomUUID(), uNoCoAdmin,
       crypto.randomUUID(), uOrphanAdmin, orphanCompanyId,
       platformSuperId, uPlatformSuper,
       crypto.randomUUID(), uPlatformSupport],
    );

    server = await startTestServer(testDatabaseUrl);
    const base = server.baseUrl;
    const sAdminA = await login(base, uAdminA, pw);
    const sNoCo = await login(base, uNoCoAdmin, pw);
    const sOrphan = await login(base, uOrphanAdmin, pw);
    const sPSA = await login(base, uPlatformSuper, pw);
    const sSupport = await login(base, uPlatformSupport, pw);

    const countCustomers = async (companyId: string) =>
      (await pool.query(`SELECT count(*)::int n FROM customers WHERE company_id=$1`, [companyId])).rows[0].n;
    const anyCustomerNamed = async (name: string) =>
      (await pool.query(`SELECT count(*)::int n FROM customers WHERE customer_name=$1`, [name])).rows[0].n;

    const mkPayload = (name: string, extra: Record<string, unknown> = {}) => ({
      customerType: "customer", customerName: name, businessName: "Synthetic Co",
      email: `syn+${sfx}@example.test`, status: "active", defaultPaymentTerms: "net_30", ...extra,
    });

    console.log("\n── 1. Tenant admin creates under the session company ──");
    const okName = `Synthetic Alpha ${sfx}`;
    const r1 = await apiRequest(base, "POST", "/api/customers", sAdminA, mkPayload(okName));
    check("tenant admin create → 201", r1.status === 201, `status=${r1.status} body=${JSON.stringify(r1.body)}`);
    check("created customer is scoped to the session company", (r1.body as any)?.companyId === companyA);
    check("exactly one customer row for company A", (await countCustomers(companyA)) === 1);

    console.log("\n── 2. A client-supplied companyId cannot override the session (tenant isolation) ──");
    const crossName = `Synthetic Cross ${sfx}`;
    const r2 = await apiRequest(base, "POST", "/api/customers", sAdminA, mkPayload(crossName, { companyId: companyB }));
    check("tenant admin + body companyId of another tenant → 403", r2.status === 403, `status=${r2.status}`);
    check("no customer row created for company B", (await countCustomers(companyB)) === 0);
    check("no customer row leaked under company A either", (await anyCustomerNamed(crossName)) === 0);

    console.log("\n── 3. A tenant session with no company context → clean 400, not 500 ──");
    const r3 = await apiRequest(base, "POST", "/api/customers", sNoCo, mkPayload(`Synthetic NoCo ${sfx}`));
    check("no-company tenant admin → 400 INVALID_COMPANY_CONTEXT (not 500)",
      r3.status === 400 && (r3.body as any)?.error === "INVALID_COMPANY_CONTEXT", `status=${r3.status} body=${JSON.stringify(r3.body)}`);
    check("no customer row created", (await anyCustomerNamed(`Synthetic NoCo ${sfx}`)) === 0);

    console.log("\n── 4. A tenant session whose company_id is orphaned → clean 400, not 500 ──");
    const r4 = await apiRequest(base, "POST", "/api/customers", sOrphan, mkPayload(`Synthetic Orphan ${sfx}`));
    check("orphaned-company tenant admin → 400 INVALID_COMPANY_CONTEXT (not 500)",
      r4.status === 400 && (r4.body as any)?.error === "INVALID_COMPANY_CONTEXT", `status=${r4.status} body=${JSON.stringify(r4.body)}`);
    check("no customer row created for the orphaned company", (await countCustomers(orphanCompanyId)) === 0);

    console.log("\n── 5. Platform super-admin WITH a validated acting company creates successfully ──");
    const psaName = `Synthetic PSA ${sfx}`;
    const r5 = await apiRequest(base, "POST", "/api/customers", sPSA, mkPayload(psaName, { companyId: companyA }));
    check("platform super-admin + valid acting company → 201", r5.status === 201, `status=${r5.status} body=${JSON.stringify(r5.body)}`);
    check("the created customer is scoped to the selected acting company", (r5.body as any)?.companyId === companyA);
    const auditRow = await pool.query(
      `SELECT count(*)::int n FROM authorization_audit_log WHERE actor_user_id=$1 AND change_type='platform_acting_company'`,
      [platformSuperId],
    );
    check("the platform acting-company context was audited", auditRow.rows[0].n >= 1, `count=${auditRow.rows[0].n}`);

    console.log("\n── 6. Platform super-admin WITHOUT an acting company → 400, zero writes ──");
    const before6 = await countCustomers(companyA);
    const r6 = await apiRequest(base, "POST", "/api/customers", sPSA, mkPayload(`Synthetic PSA NoCtx ${sfx}`));
    check("platform super-admin, no acting company → 400 INVALID_COMPANY_CONTEXT",
      r6.status === 400 && (r6.body as any)?.error === "INVALID_COMPANY_CONTEXT", `status=${r6.status} body=${JSON.stringify(r6.body)}`);
    check("no customer row created", (await anyCustomerNamed(`Synthetic PSA NoCtx ${sfx}`)) === 0 && (await countCustomers(companyA)) === before6);

    console.log("\n── 7. Platform super-admin selecting a nonexistent company → 400 ──");
    const r7 = await apiRequest(base, "POST", "/api/customers", sPSA, mkPayload(`Synthetic PSA Ghost ${sfx}`, { companyId: nonexistentCompanyId }));
    check("nonexistent acting company → 400 INVALID_COMPANY_CONTEXT",
      r7.status === 400 && (r7.body as any)?.error === "INVALID_COMPANY_CONTEXT", `status=${r7.status} body=${JSON.stringify(r7.body)}`);
    check("no customer row created", (await anyCustomerNamed(`Synthetic PSA Ghost ${sfx}`)) === 0);

    console.log("\n── 8. Platform support cannot create a customer (no admin authority) ──");
    const r8 = await apiRequest(base, "POST", "/api/customers", sSupport, mkPayload(`Synthetic Support ${sfx}`, { companyId: companyA }));
    check("platform_support → 403 (blocked at requireRole, never reaches the handler)", r8.status === 403, `status=${r8.status}`);
    check("no customer row created", (await anyCustomerNamed(`Synthetic Support ${sfx}`)) === 0);

    console.log("\n── 9. A rejected create leaves no partial row (rollback / atomicity) ──");
    const beforeBad = await countCustomers(companyA);
    const r9 = await apiRequest(base, "POST", "/api/customers", sAdminA, { customerType: "customer", status: "active" }); // no customerName
    check("missing required field → 400 (not 500)", r9.status === 400, `status=${r9.status} body=${JSON.stringify(r9.body)}`);
    check("no partial customer row was written", (await countCustomers(companyA)) === beforeBad);

    console.log("\n── 10. Duplicate submission has a defined response ──");
    const dupName = `Synthetic Dup ${sfx}`;
    const d1 = await apiRequest(base, "POST", "/api/customers", sAdminA, mkPayload(dupName));
    const d2 = await apiRequest(base, "POST", "/api/customers", sAdminA, mkPayload(dupName));
    check("first duplicate submission → 201", d1.status === 201, `status=${d1.status}`);
    check("second identical submission → defined 201 (no unique constraint; a distinct record)", d2.status === 201, `status=${d2.status}`);
    check("two distinct customer rows exist under company A", (await anyCustomerNamed(dupName)) === 2 && (d1.body as any)?.id !== (d2.body as any)?.id);

    console.log("\n── 11. Unauthenticated caller is rejected ──");
    const anon = await apiRequest(base, "POST", "/api/customers", null, mkPayload(`Synthetic Anon ${sfx}`));
    check("unauthenticated → 401", anon.status === 401, `status=${anon.status}`);

    console.log(`\n${passed} passed, ${failed} failed`);
  } finally {
    if (server) await server.stop();
    try {
      await pool.query(`DELETE FROM authorization_audit_log WHERE actor_user_id IN (SELECT id FROM users WHERE username LIKE $1)`, [`cust_%_${sfx}`]).catch(() => {});
      await pool.query(`DELETE FROM customers WHERE company_id = ANY($1::varchar[])`, [companyIds]);
      await pool.query(`DELETE FROM session WHERE sess->>'userId' IN (SELECT id FROM users WHERE username LIKE $1)`, [`cust_%_${sfx}`]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE username LIKE $1`, [`cust_%_${sfx}`]);
      await cascadeDelete(pool, "companies", companyIds);
      const residue = [...(await verifyZeroResidue(pool, "companies", companyIds))];
      const strayCust = (await pool.query(`SELECT count(*)::int n FROM customers WHERE customer_name LIKE 'Synthetic %'`)).rows[0].n;
      if (strayCust > 0) residue.push(`customers with test marker: ${strayCust}`);
      const strayUsers = (await pool.query(`SELECT count(*)::int n FROM users WHERE username LIKE $1`, [`cust_%_${sfx}`])).rows[0].n;
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
