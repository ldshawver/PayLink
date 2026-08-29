/**
 * POST /api/customers — company-scope + failure-handling regression suite.
 *
 * Production incident: a customer-creation attempt returned HTTP 500
 * ("Failed to create customer"). Root cause: the route passed the request
 * body straight into `db.insert(customers)`. `companyId` came from the
 * client (frontend sends `user.companyId`); when the acting user has no
 * company (a platform admin) or a stale/orphaned company_id, the insert
 * hit a NOT NULL / FK violation on `company_id` and surfaced as an opaque
 * 500 with no partial record and no useful log.
 *
 * Fix: derive company scope from the session (enforceCompanyScope), reject
 * a missing/foreign company with 401/403, reject an orphaned company with a
 * clear 400, and map constraint violations to 400/409 instead of 500.
 *
 * Real running server, real HTTP, disposable database, synthetic fixtures
 * only. No real customer PII.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable_db npx tsx tests/customer-create-company-scope-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { startTestServer, login, apiRequest, type TestServer, type Session } from "../scripts/cross-tenant-negative-tests/server-harness";
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
  let server: TestServer | undefined;

  try {
    const dbName = (await pool.query("SELECT current_database() AS n")).rows[0]?.n as string;
    if (FORBIDDEN_PATTERNS.some((p) => p.test(dbName))) throw new Error(`current_database()="${dbName}" looks protected. Refusing.`);

    const sfx = crypto.randomBytes(4).toString("hex");
    const companyA = crypto.randomUUID();
    const companyB = crypto.randomUUID();
    const orphanCompanyId = crypto.randomUUID(); // never inserted into companies
    companyIds.push(companyA, companyB);
    await pool.query(`INSERT INTO companies (id, name) VALUES ($1,$2),($3,$4)`, [companyA, `Cust Co A ${sfx}`, companyB, `Cust Co B ${sfx}`]);

    const pw = crypto.randomBytes(10).toString("hex");
    const pwHash = await bcrypt.hash(pw, 10);
    const adminA = `cust_adminA_${sfx}`, adminB = `cust_adminB_${sfx}`, noCoAdmin = `cust_noco_${sfx}`, orphanAdmin = `cust_orphan_${sfx}`;
    await pool.query(
      `INSERT INTO users (id, username, password, role, company_id, is_active) VALUES
        ($1,$2,$3,'admin',$4,true),
        ($5,$6,$3,'admin',$7,true),
        ($8,$9,$3,'admin',NULL,true),
        ($10,$11,$3,'admin',$12,true)`,
      [crypto.randomUUID(), adminA, pwHash, companyA,
       crypto.randomUUID(), adminB, companyB,
       crypto.randomUUID(), noCoAdmin,
       crypto.randomUUID(), orphanAdmin, orphanCompanyId],
    );

    server = await startTestServer(testDatabaseUrl);
    const base = server.baseUrl;
    const sA = await login(base, adminA, pw);
    const sB = await login(base, adminB, pw);
    const sNoCo = await login(base, noCoAdmin, pw);
    const sOrphan = await login(base, orphanAdmin, pw);

    const countCustomers = async (companyId: string) =>
      (await pool.query(`SELECT count(*)::int n FROM customers WHERE company_id=$1`, [companyId])).rows[0].n;
    const anyCustomerNamed = async (name: string) =>
      (await pool.query(`SELECT count(*)::int n FROM customers WHERE customer_name=$1`, [name])).rows[0].n;

    const mkPayload = (name: string, extra: Record<string, unknown> = {}) => ({
      customerType: "customer", customerName: name, businessName: "Synthetic Co",
      email: `syn+${sfx}@example.test`, status: "active", defaultPaymentTerms: "net_30", ...extra,
    });

    console.log("\n── 1. Valid create — company comes from the session ──");
    const okName = `Synthetic Alpha ${sfx}`;
    const r1 = await apiRequest(base, "POST", "/api/customers", sA, mkPayload(okName));
    check("valid create → 201", r1.status === 201, `status=${r1.status} body=${JSON.stringify(r1.body)}`);
    check("created customer is scoped to the caller's company", (r1.body as any)?.companyId === companyA, JSON.stringify((r1.body as any)?.companyId));
    check("exactly one customer row for company A", (await countCustomers(companyA)) === 1);

    console.log("\n── 2. Client-supplied companyId cannot override the session (tenant isolation) ──");
    const crossName = `Synthetic Cross ${sfx}`;
    const r2 = await apiRequest(base, "POST", "/api/customers", sA, mkPayload(crossName, { companyId: companyB }));
    check("body companyId = another tenant → 403", r2.status === 403, `status=${r2.status}`);
    check("no customer row created for company B", (await countCustomers(companyB)) === 0);
    check("no customer row leaked under company A either", (await anyCustomerNamed(crossName)) === 0);

    console.log("\n── 3. A session with no company context → clean 400, not 500 ──");
    const r3 = await apiRequest(base, "POST", "/api/customers", sNoCo, mkPayload(`Synthetic NoCo ${sfx}`));
    check("no-company caller → 400 NO_COMPANY_CONTEXT (not 500)",
      r3.status === 400 && (r3.body as any)?.error === "NO_COMPANY_CONTEXT", `status=${r3.status} body=${JSON.stringify(r3.body)}`);
    check("no customer row created", (await anyCustomerNamed(`Synthetic NoCo ${sfx}`)) === 0);

    console.log("\n── 4. A session whose company_id is orphaned → clean 400, not 500 ──");
    const r4 = await apiRequest(base, "POST", "/api/customers", sOrphan, mkPayload(`Synthetic Orphan ${sfx}`));
    check("orphaned-company caller → 400 INVALID_COMPANY_CONTEXT (not 500)",
      r4.status === 400 && (r4.body as any)?.error === "INVALID_COMPANY_CONTEXT", `status=${r4.status} body=${JSON.stringify(r4.body)}`);
    check("no customer row created for the orphaned company", (await countCustomers(orphanCompanyId)) === 0);

    console.log("\n── 5. A rejected create leaves no partial row (rollback / atomicity) ──");
    const beforeBad = await countCustomers(companyA);
    const r5 = await apiRequest(base, "POST", "/api/customers", sA, { customerType: "customer", status: "active" }); // no customerName
    check("missing required field → 400 (not 500)", r5.status === 400, `status=${r5.status} body=${JSON.stringify(r5.body)}`);
    check("no partial customer row was written", (await countCustomers(companyA)) === beforeBad);

    console.log("\n── 6. Duplicate submission has a defined response ──");
    const dupName = `Synthetic Dup ${sfx}`;
    const d1 = await apiRequest(base, "POST", "/api/customers", sA, mkPayload(dupName));
    const d2 = await apiRequest(base, "POST", "/api/customers", sA, mkPayload(dupName));
    check("first duplicate submission → 201", d1.status === 201, `status=${d1.status}`);
    check("second identical submission → defined 201 (no unique constraint; a distinct record)", d2.status === 201, `status=${d2.status}`);
    check("two distinct customer rows exist, both under company A", (await anyCustomerNamed(dupName)) === 2 && (d1.body as any)?.id !== (d2.body as any)?.id);

    console.log("\n── 7. Non-privileged / unauthenticated callers are still rejected ──");
    const anon = await apiRequest(base, "POST", "/api/customers", null, mkPayload(`Synthetic Anon ${sfx}`));
    check("unauthenticated → 401", anon.status === 401, `status=${anon.status}`);

    console.log(`\n${passed} passed, ${failed} failed`);
  } finally {
    if (server) await server.stop();
    try {
      await pool.query(`DELETE FROM customers WHERE company_id = ANY($1::varchar[])`, [companyIds]);
      await cascadeDelete(pool, "companies", companyIds);
      const residue = [...(await verifyZeroResidue(pool, "companies", companyIds))];
      const strayCust = (await pool.query(`SELECT count(*)::int n FROM customers WHERE customer_name LIKE 'Synthetic %'`)).rows[0].n;
      if (strayCust > 0) residue.push(`customers with test marker: ${strayCust}`);
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
