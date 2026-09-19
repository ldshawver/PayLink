/**
 * POST /api/remittance-sources — company-scope + failure-handling regression suite.
 *
 * Reported symptom (staging, company "Adiken Inc"): creating a remittance
 * source from Payroll → Remittance Sources failed with
 * "Failed to create remittance source" (opaque HTTP 500).
 *
 * Root cause (source trace): the Add dialog initialises `companyId: ""` and the
 * submit button has no validation, so the form posts an empty companyId. The
 * route passed `req.body` straight into `db.insert(remittanceSources)`;
 * `company_id` is NOT NULL + FK to companies, so the insert raised 23503 and the
 * catch-all surfaced a generic 500. The same handler also trusted a
 * client-supplied companyId for ANY company (no tenant check) and let the
 * client set arbitrary columns (`id`, `lastBatchNumber`, ...).
 *
 * Fix: resolve company scope server-side (same contract as POST /api/customers,
 * but a tenant may still act for a company it is entitled to — sibling
 * companies of the same enterprise / company_user_access — via the existing
 * canAccessCompany helper), validate `name`/`lastCheckNumber`, strip server-owned columns (id, createdAt, lastBatchNumber),
 * and map constraint violations to a sanitized 4xx.
 *
 * Real running server, real HTTP, disposable database, synthetic fixtures only.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable_db npx tsx tests/remittance-source-create-company-scope-db.test.ts
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
    console.log("TEST_DATABASE_URL not set — skipping remittance-source-create-company-scope tests (0 run).");
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
    const companyA2 = crypto.randomUUID();           // enterprise sibling of A (same tenant scope)
    const companyB = crypto.randomUUID();            // unrelated tenant
    const orphanCompanyId = crypto.randomUUID();     // never inserted
    const nonexistentCompanyId = crypto.randomUUID(); // never inserted
    const enterpriseId = crypto.randomUUID();
    companyIds.push(companyA, companyA2, companyB);
    await pool.query(
      `INSERT INTO companies (id, name, enterprise_id) VALUES ($1,$2,$7),($3,$4,$7),($5,$6,NULL)`,
      [companyA, `RS Co A ${sfx}`, companyA2, `RS Co A2 ${sfx}`, companyB, `RS Co B ${sfx}`, enterpriseId],
    );

    const pw = crypto.randomBytes(10).toString("hex");
    const pwHash = await bcrypt.hash(pw, 10);
    const uAdminA = `rs_adminA_${sfx}`, uNoCoAdmin = `rs_noco_${sfx}`, uOrphanAdmin = `rs_orphan_${sfx}`,
      uPlatformSuper = `rs_psa_${sfx}`, uPlatformSupport = `rs_psup_${sfx}`, uWorkerA = `rs_worker_${sfx}`;
    await pool.query(
      `INSERT INTO users (id, username, password, role, company_id, is_active) VALUES
        ($1,$2,$3,'admin',$4,true),
        ($5,$6,$3,'admin',NULL,true),
        ($7,$8,$3,'admin',$9,true),
        ($10,$11,$3,'platform_super_admin',NULL,true),
        ($12,$13,$3,'platform_support',NULL,true),
        ($14,$15,$3,'worker',$4,true)`,
      [crypto.randomUUID(), uAdminA, pwHash, companyA,
       crypto.randomUUID(), uNoCoAdmin,
       crypto.randomUUID(), uOrphanAdmin, orphanCompanyId,
       crypto.randomUUID(), uPlatformSuper,
       crypto.randomUUID(), uPlatformSupport,
       crypto.randomUUID(), uWorkerA],
    );

    server = await startTestServer(testDatabaseUrl);
    const base = server.baseUrl;
    const sAdminA = await login(base, uAdminA, pw);
    const sNoCo = await login(base, uNoCoAdmin, pw);
    const sOrphan = await login(base, uOrphanAdmin, pw);
    const sPSA = await login(base, uPlatformSuper, pw);
    const sSupport = await login(base, uPlatformSupport, pw);
    const sWorker = await login(base, uWorkerA, pw);

    const countSources = async (companyId: string) =>
      (await pool.query(`SELECT count(*)::int n FROM remittance_sources WHERE company_id=$1`, [companyId])).rows[0].n;
    const anySourceNamed = async (name: string) =>
      (await pool.query(`SELECT count(*)::int n FROM remittance_sources WHERE name=$1`, [name])).rows[0].n;

    // Exactly what the Add dialog posts (client/src/pages/payroll.tsx createMutation).
    const formPayload = (name: string, extra: Record<string, unknown> = {}) => ({
      companyId: "", name, type: "check", status: "enabled", country: "US", currency: "USD",
      routingNumber: null, accountNumber: null, institution: null, lastCheckNumber: 0, ...extra,
    });

    console.log("\n── 1. Tenant admin, company explicitly selected ──");
    const n1 = `Synthetic Source One ${sfx}`;
    const r1 = await apiRequest(base, "POST", "/api/remittance-sources", sAdminA, formPayload(n1, { companyId: companyA, lastCheckNumber: 1000 }));
    check("create → 201", r1.status === 201, `status=${r1.status} body=${JSON.stringify(r1.body)}`);
    check("scoped to company A", (r1.body as any)?.companyId === companyA);
    check("submitted fields persisted (type, lastCheckNumber)", (r1.body as any)?.type === "check" && (r1.body as any)?.lastCheckNumber === 1000);

    console.log("\n── 2. The reported case: form submitted with NO company selected (companyId \"\") ──");
    const n2 = `Synthetic Source NoSel ${sfx}`;
    const r2 = await apiRequest(base, "POST", "/api/remittance-sources", sAdminA, formPayload(n2));
    check("empty companyId → falls back to the session company, 201 (was opaque 500)", r2.status === 201, `status=${r2.status} body=${JSON.stringify(r2.body)}`);
    check("row scoped to the session company A", (r2.body as any)?.companyId === companyA);

    console.log("\n── 3. companyId omitted entirely ──");
    const n3 = `Synthetic Source Omit ${sfx}`;
    const { companyId: _omit, ...noCo } = formPayload(n3);
    const r3 = await apiRequest(base, "POST", "/api/remittance-sources", sAdminA, noCo);
    check("omitted companyId → 201 under session company", r3.status === 201 && (r3.body as any)?.companyId === companyA, `status=${r3.status}`);

    console.log("\n── 4. Tenant isolation: another tenant's company is refused ──");
    const n4 = `Synthetic Source Cross ${sfx}`;
    const r4 = await apiRequest(base, "POST", "/api/remittance-sources", sAdminA, formPayload(n4, { companyId: companyB }));
    check("tenant admin + company of another tenant → 403", r4.status === 403, `status=${r4.status} body=${JSON.stringify(r4.body)}`);
    check("no source row created for company B", (await countSources(companyB)) === 0);
    check("no source row leaked anywhere", (await anySourceNamed(n4)) === 0);

    console.log("\n── 5. Multi-company tenants keep working: enterprise sibling company ──");
    const n5 = `Synthetic Source Sibling ${sfx}`;
    const r5 = await apiRequest(base, "POST", "/api/remittance-sources", sAdminA, formPayload(n5, { companyId: companyA2 }));
    check("admin of A creating for enterprise sibling A2 → 201", r5.status === 201 && (r5.body as any)?.companyId === companyA2, `status=${r5.status} body=${JSON.stringify(r5.body)}`);

    console.log("\n── 6. Tenant session without a usable company → clean 400 ──");
    const r6a = await apiRequest(base, "POST", "/api/remittance-sources", sNoCo, formPayload(`Synthetic NoCo ${sfx}`));
    check("no-company tenant admin → 400 INVALID_COMPANY_CONTEXT", r6a.status === 400 && (r6a.body as any)?.error === "INVALID_COMPANY_CONTEXT", `status=${r6a.status} body=${JSON.stringify(r6a.body)}`);
    const r6b = await apiRequest(base, "POST", "/api/remittance-sources", sOrphan, formPayload(`Synthetic Orphan ${sfx}`));
    check("orphaned-company tenant admin → 400 INVALID_COMPANY_CONTEXT", r6b.status === 400 && (r6b.body as any)?.error === "INVALID_COMPANY_CONTEXT", `status=${r6b.status} body=${JSON.stringify(r6b.body)}`);
    check("no rows created for either", (await anySourceNamed(`Synthetic NoCo ${sfx}`)) === 0 && (await anySourceNamed(`Synthetic Orphan ${sfx}`)) === 0);

    // Codex review finding (PR #158): canAccessCompany() treats "caller has no
    // companyId" the same as a platform admin (a pre-existing bug in that
    // shared helper, out of scope to fix globally here — see server/routes.ts
    // comment above the fix). A companyless non-platform admin naming an
    // arbitrary company's id in the body must still be rejected, not silently
    // routed through canAccessCompany()'s bypass.
    const r6c = await apiRequest(base, "POST", "/api/remittance-sources", sNoCo, formPayload(`Synthetic NoCo Explicit ${sfx}`, { companyId: companyB }));
    check("companyless admin naming another tenant's company explicitly → still 400, not 201/403-via-bypass", r6c.status === 400 && (r6c.body as any)?.error === "INVALID_COMPANY_CONTEXT", `status=${r6c.status} body=${JSON.stringify(r6c.body)}`);
    check("no row created for company B from the companyless-admin bypass attempt", (await countSources(companyB)) === 0);

    console.log("\n── 7. Platform super-admin: explicit, validated acting company ──");
    const r7a = await apiRequest(base, "POST", "/api/remittance-sources", sPSA, formPayload(`Synthetic PSA ${sfx}`, { companyId: companyB }));
    check("valid acting company → 201 scoped to it", r7a.status === 201 && (r7a.body as any)?.companyId === companyB, `status=${r7a.status} body=${JSON.stringify(r7a.body)}`);
    const r7b = await apiRequest(base, "POST", "/api/remittance-sources", sPSA, formPayload(`Synthetic PSA NoCtx ${sfx}`));
    check("no acting company → 400 INVALID_COMPANY_CONTEXT", r7b.status === 400 && (r7b.body as any)?.error === "INVALID_COMPANY_CONTEXT", `status=${r7b.status}`);
    const r7c = await apiRequest(base, "POST", "/api/remittance-sources", sPSA, formPayload(`Synthetic PSA Ghost ${sfx}`, { companyId: nonexistentCompanyId }));
    check("nonexistent company → 400 INVALID_COMPANY_CONTEXT (not 500)", r7c.status === 400 && (r7c.body as any)?.error === "INVALID_COMPANY_CONTEXT", `status=${r7c.status}`);
    check("no rows for the rejected platform attempts", (await anySourceNamed(`Synthetic PSA NoCtx ${sfx}`)) === 0 && (await anySourceNamed(`Synthetic PSA Ghost ${sfx}`)) === 0);

    console.log("\n── 8. Role gates unchanged ──");
    const r8a = await apiRequest(base, "POST", "/api/remittance-sources", sSupport, formPayload(`Synthetic Support ${sfx}`, { companyId: companyA }));
    check("platform_support → 403", r8a.status === 403, `status=${r8a.status}`);
    const r8b = await apiRequest(base, "POST", "/api/remittance-sources", sWorker, formPayload(`Synthetic Worker ${sfx}`, { companyId: companyA }));
    check("worker → 403", r8b.status === 403, `status=${r8b.status}`);
    const r8c = await apiRequest(base, "POST", "/api/remittance-sources", null, formPayload(`Synthetic Anon ${sfx}`, { companyId: companyA }));
    check("unauthenticated → 401", r8c.status === 401, `status=${r8c.status}`);
    check("no rows for rejected roles", (await anySourceNamed(`Synthetic Support ${sfx}`)) + (await anySourceNamed(`Synthetic Worker ${sfx}`)) + (await anySourceNamed(`Synthetic Anon ${sfx}`)) === 0);

    console.log("\n── 9. Validation: missing/blank name → 400, nothing written ──");
    const beforeBad = await countSources(companyA);
    const r9a = await apiRequest(base, "POST", "/api/remittance-sources", sAdminA, formPayload("   ", { companyId: companyA }));
    check("blank name → 400 (not 500, not a nameless row)", r9a.status === 400, `status=${r9a.status} body=${JSON.stringify(r9a.body)}`);
    const { name: _n, ...noName } = formPayload("x", { companyId: companyA });
    const r9b = await apiRequest(base, "POST", "/api/remittance-sources", sAdminA, noName);
    check("missing name → 400", r9b.status === 400, `status=${r9b.status}`);
    check("no partial row written", (await countSources(companyA)) === beforeBad);
    const r9c = await apiRequest(base, "POST", "/api/remittance-sources", sAdminA, formPayload(`Synthetic BadNum ${sfx}`, { companyId: companyA, lastCheckNumber: -5 }));
    check("negative last check number → 400", r9c.status === 400, `status=${r9c.status}`);
    const r9d = await apiRequest(base, "POST", "/api/remittance-sources", sAdminA, formPayload(`Synthetic NullNum ${sfx}`, { companyId: companyA, lastCheckNumber: null }));
    check("cleared (null) last check number → 201 with default 0, never NULL", r9d.status === 201 && (r9d.body as any)?.lastCheckNumber === 0, `status=${r9d.status} body=${JSON.stringify(r9d.body)}`);

    console.log("\n── 10. Client cannot set server-owned columns ──");
    const forcedId = crypto.randomUUID();
    const r10 = await apiRequest(base, "POST", "/api/remittance-sources", sAdminA, formPayload(`Synthetic Mass ${sfx}`, { companyId: companyA, id: forcedId, lastBatchNumber: 999 }));
    check("create → 201", r10.status === 201, `status=${r10.status}`);
    check("client-supplied id ignored", (r10.body as any)?.id !== forcedId);
    check("client-supplied lastBatchNumber ignored", Number((r10.body as any)?.lastBatchNumber ?? 0) === 0);

    console.log("\n── 11. Existing behaviour preserved: list + update still work for the created row ──");
    const list = await apiRequest(base, "GET", `/api/remittance-sources?companyId=${companyA}`, sAdminA);
    check("GET lists the created rows", list.status === 200 && Array.isArray(list.body) && (list.body as any[]).some((s) => s.name === n1));
    const patch = await apiRequest(base, "PATCH", `/api/remittance-sources/${(r1.body as any)?.id}`, sAdminA, { institution: "Synthetic Bank" });
    check("PATCH still works", patch.status === 200 && (patch.body as any)?.institution === "Synthetic Bank", `status=${patch.status}`);

    console.log(`\n${passed} passed, ${failed} failed`);
  } finally {
    if (server) await server.stop();
    try {
      await pool.query(`DELETE FROM authorization_audit_log WHERE actor_user_id IN (SELECT id FROM users WHERE username LIKE $1)`, [`rs_%_${sfx}`]).catch(() => {});
      await pool.query(`DELETE FROM remittance_sources WHERE company_id = ANY($1::varchar[])`, [companyIds]);
      await pool.query(`DELETE FROM session WHERE sess->>'userId' IN (SELECT id FROM users WHERE username LIKE $1)`, [`rs_%_${sfx}`]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE username LIKE $1`, [`rs_%_${sfx}`]);
      await cascadeDelete(pool, "companies", companyIds);
      const residue = [...(await verifyZeroResidue(pool, "companies", companyIds))];
      const strayRs = (await pool.query(`SELECT count(*)::int n FROM remittance_sources WHERE name LIKE 'Synthetic %' AND name LIKE $1`, [`%${sfx}`])).rows[0].n;
      if (strayRs > 0) residue.push(`remittance_sources with test marker: ${strayRs}`);
      const strayUsers = (await pool.query(`SELECT count(*)::int n FROM users WHERE username LIKE $1`, [`rs_%_${sfx}`])).rows[0].n;
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
