/**
 * Phase 0.5 — tenant-company membership guard regression tests.
 *
 * Root cause (docs/saas-readiness/phase-0.5-tenant-companies-fk-preflight.md
 * §2, empirically reproduced there): POST /api/tenants/:id/companies
 * (server/routes.ts) inserted into tenant_companies using the URL's :id as
 * tenant_id with no existence check at all. companyId was (and remains)
 * implicitly validated by its own FK to companies.id; tenant_id carries no
 * FK (that FK is deliberately not applied yet — see the preflight doc), so a
 * stale or mistyped tenant id in the URL silently wrote a dangling
 * tenant_companies row and still returned 201.
 *
 * Fix (this branch, server/routes.ts): the tenant is loaded by the URL's
 * :id before anything is written; a missing tenant now 404s with zero rows
 * written. The company is validated the same way. A body-supplied tenantId
 * that disagrees with the URL is rejected outright rather than silently
 * ignored or silently trusted. No database schema change — the FK itself
 * remains unimplemented (see the preflight doc for why); this is the
 * application-level half of closing the orphan-creation vector.
 *
 * This file proves, against a disposable database and synthetic fixtures
 * only, real running server, real HTTP:
 *   1. Existing tenant + existing company creates the relationship.
 *   2. Missing tenant -> 404, zero rows created.
 *   3. Missing company -> the pre-existing "Company not found" 400 is
 *      preserved, zero rows created.
 *   4. A body-supplied tenantId that disagrees with the URL is rejected,
 *      zero rows created; a body tenantId that agrees with the URL is
 *      harmless and the request still succeeds.
 *   5. Duplicate requests follow the endpoint's existing idempotent/upsert
 *      behavior (ON CONFLICT ... DO UPDATE is_primary) — no error, no
 *      duplicate row, is_primary reflects the latest request.
 *   6. Tenant/platform authorization boundaries are unchanged: a
 *      non-super-admin platform role is blocked, a tenant-scoped admin is
 *      blocked, missing auth is blocked.
 *   7. No partial/duplicate row survives any rejected request (consolidated
 *      check across cases 2-4, plus a fixture-scoped table sweep at the end).
 *
 * SAFETY: same conventions as the rest of Phase 0.5's disposable-database
 * suite — requires TEST_DATABASE_URL, refuses staging/production-shaped
 * names, aborts if TEST_DATABASE_URL equals DATABASE_URL, verifies
 * current_database() before any write, cleans up via the same FK-aware
 * cascade-delete helper, and never touches a real tenant, company, or user.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable_db npx tsx tests/tenant-company-membership-guard-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { startTestServer, login, apiRequest, type TestServer, type Session } from "../scripts/cross-tenant-negative-tests/server-harness";
import { cascadeDelete, verifyZeroResidue } from "../scripts/cross-tenant-negative-tests/cascade-cleanup";

const FORBIDDEN_PATTERNS = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];

let passed = 0;
let failed = 0;
const errors: string[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`  ✓  ${name}`);
    passed++;
  } else {
    console.error(`  ✗  ${name}${detail ? ` — ${detail}` : ""}`);
    errors.push(`${name}${detail ? `: ${detail}` : ""}`);
    failed++;
  }
}

async function main() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    console.log("TEST_DATABASE_URL not set — skipping tenant-company membership guard tests (0 run).");
    return;
  }
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(testDatabaseUrl)) {
      throw new Error("TEST_DATABASE_URL looks like it points at staging/production. Refusing to run.");
    }
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is identical to DATABASE_URL. Refusing to run against what may be the app's real database.");
  }

  const pool = new Pool({ connectionString: testDatabaseUrl, max: 4 });
  const companyIds: string[] = [];
  const tenantIds: string[] = [];
  let server: TestServer | undefined;
  let harnessOk = true;

  try {
    const dbNameRes = await pool.query("SELECT current_database() AS name");
    const dbName = dbNameRes.rows[0]?.name as string;
    if (FORBIDDEN_PATTERNS.some((p) => p.test(dbName))) {
      throw new Error(`current_database() = "${dbName}" looks like staging/production. Refusing to run.`);
    }

    console.log("\n── Fixtures ──");
    const suffix = crypto.randomBytes(4).toString("hex");
    const companyA = crypto.randomUUID();
    const companyB = crypto.randomUUID();
    companyIds.push(companyA, companyB);
    await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2), ($3, $4)`, [companyA, `TCMG Company A ${suffix}`, companyB, `TCMG Company B ${suffix}`]);

    const tenantX = crypto.randomUUID();
    const tenantY = crypto.randomUUID();
    tenantIds.push(tenantX, tenantY);
    await pool.query(
      `INSERT INTO tenants (id, name, slug, status) VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
      [tenantX, `TCMG Tenant X ${suffix}`, `tcmg-tenant-x-${suffix}`, tenantY, `TCMG Tenant Y ${suffix}`, `tcmg-tenant-y-${suffix}`],
    );

    // ── Schema-drift workaround (test-infra only, not an app-code change) ────
    // tenant_companies' UNIQUE(tenant_id, company_id) is declared only in
    // server/index.ts's own `CREATE TABLE IF NOT EXISTS` bootstrap
    // (server/index.ts:3623-3630), never in shared/schema.ts — a database
    // built via `drizzle-kit push` (as this disposable database is) lacks
    // it, and this endpoint's `ON CONFLICT (tenant_id, company_id)` clause
    // 500s without it, regardless of caller. Same gap, same workaround
    // already used in tests/cross-tenant-batch-5-routes-db.test.ts
    // (feature_overrides) and tests/tenant-companies-fk-preflight-db.test.ts
    // (this same table) — not repaired in application code here.
    await pool.query(`ALTER TABLE tenant_companies ADD CONSTRAINT IF NOT EXISTS tenant_companies_tenant_id_company_id_unique UNIQUE (tenant_id, company_id)`).catch(async () => {
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS tenant_companies_tenant_id_company_id_unique_idx ON tenant_companies (tenant_id, company_id)`);
    });

    const pwPlain = crypto.randomBytes(12).toString("hex");
    const pwHash = await bcrypt.hash(pwPlain, 10);
    const superAdminId = crypto.randomUUID();
    const platformAdminId = crypto.randomUUID();
    const tenantAdminId = crypto.randomUUID();
    const superAdminUsername = `tcmg_super_${suffix}`;
    const platformAdminUsername = `tcmg_platadmin_${suffix}`;
    const tenantAdminUsername = `tcmg_tenantadmin_${suffix}`;
    await pool.query(
      `INSERT INTO users (id, username, password, role, company_id, worker_id, first_name, last_name, is_active) VALUES
       ($1,$2,$3,'platform_super_admin',NULL,NULL,'TCMG','Super', true),
       ($4,$5,$3,'platform_admin',NULL,NULL,'TCMG','PlatAdmin', true),
       ($6,$7,$3,'tenant_admin',$8,NULL,'TCMG','TenantAdmin', true)`,
      [superAdminId, superAdminUsername, pwHash, platformAdminId, platformAdminUsername, tenantAdminId, tenantAdminUsername, companyA],
    );

    server = await startTestServer(testDatabaseUrl);
    const baseUrl = server.baseUrl;
    const superAdmin: Session = await login(baseUrl, superAdminUsername, pwPlain);
    const platformAdmin: Session = await login(baseUrl, platformAdminUsername, pwPlain);
    const tenantAdmin: Session = await login(baseUrl, tenantAdminUsername, pwPlain);

    const rowCount = async (tenantId: string, companyId: string) =>
      (await pool.query("SELECT COUNT(*)::int AS n FROM tenant_companies WHERE tenant_id = $1 AND company_id = $2", [tenantId, companyId])).rows[0].n as number;

    console.log("\n── 1. Existing tenant + existing company creates the relationship ──");
    {
      const r = await apiRequest(baseUrl, "POST", `/api/tenants/${tenantX}/companies`, superAdmin, { companyId: companyA, isPrimary: true });
      check("201 Created", r.status === 201, `status=${r.status}`);
      const n = await rowCount(tenantX, companyA);
      check("exactly one row now links tenantX <-> companyA", n === 1, `count=${n}`);
      const row = (await pool.query("SELECT is_primary FROM tenant_companies WHERE tenant_id = $1 AND company_id = $2", [tenantX, companyA])).rows[0];
      check("is_primary reflects the request body", row?.is_primary === true);
    }

    console.log("\n── 2. Missing tenant -> 404, zero rows created ──");
    {
      const nonexistentTenantId = crypto.randomUUID();
      const r = await apiRequest(baseUrl, "POST", `/api/tenants/${nonexistentTenantId}/companies`, superAdmin, { companyId: companyB });
      check("404 Not Found (was 201 before this fix)", r.status === 404, `status=${r.status}`);
      check('response body reports "Tenant not found" (sanitized — no internal detail leaked)', (r.body as any)?.message === "Tenant not found", JSON.stringify(r.body));
      const n = await rowCount(nonexistentTenantId, companyB);
      check("zero rows written for the nonexistent tenant", n === 0, `count=${n}`);
    }

    console.log("\n── 3. Missing company -> the pre-existing sanitized error is preserved, zero rows created ──");
    {
      const nonexistentCompanyId = crypto.randomUUID();
      const r = await apiRequest(baseUrl, "POST", `/api/tenants/${tenantY}/companies`, superAdmin, { companyId: nonexistentCompanyId });
      check("400 Bad Request (unchanged status — this branch does not change the company-missing contract)", r.status === 400, `status=${r.status}`);
      check('response body still reports "Company not found" (the endpoint\'s pre-existing, intended message)', (r.body as any)?.message === "Company not found", JSON.stringify(r.body));
      const n = await rowCount(tenantY, nonexistentCompanyId);
      check("zero rows written for the nonexistent company", n === 0, `count=${n}`);
    }

    console.log("\n── 4. Body-supplied tenantId cannot override the URL's tenant id ──");
    {
      const r = await apiRequest(baseUrl, "POST", `/api/tenants/${tenantX}/companies`, superAdmin, { companyId: companyB, tenantId: tenantY });
      check("mismatched body tenantId is rejected with 400, not silently ignored or silently honored", r.status === 400, `status=${r.status}`);
      const nX = await rowCount(tenantX, companyB);
      const nY = await rowCount(tenantY, companyB);
      check("no row written for the URL's tenant (tenantX) from the rejected request", nX === 0, `count=${nX}`);
      check("no row written for the body's tenant (tenantY) either — the mismatch is rejected outright, not partially honored", nY === 0, `count=${nY}`);

      // A body tenantId that agrees with the URL is harmless and must not
      // block a legitimate request that simply echoes it back.
      const rOk = await apiRequest(baseUrl, "POST", `/api/tenants/${tenantX}/companies`, superAdmin, { companyId: companyB, tenantId: tenantX });
      check("a body tenantId matching the URL is accepted (not treated as a mismatch)", rOk.status === 201, `status=${rOk.status}`);
      const nXAfter = await rowCount(tenantX, companyB);
      check("that accepted request wrote exactly one row", nXAfter === 1, `count=${nXAfter}`);
    }

    console.log("\n── 5. Duplicate requests follow the endpoint's existing idempotent/upsert behavior ──");
    {
      const r1 = await apiRequest(baseUrl, "POST", `/api/tenants/${tenantY}/companies`, superAdmin, { companyId: companyA, isPrimary: false });
      check("first request: 201", r1.status === 201, `status=${r1.status}`);
      const r2 = await apiRequest(baseUrl, "POST", `/api/tenants/${tenantY}/companies`, superAdmin, { companyId: companyA, isPrimary: true });
      check("duplicate request (same tenant+company): 201, not a 409/500 — ON CONFLICT DO UPDATE is preserved", r2.status === 201, `status=${r2.status}`);
      const n = await rowCount(tenantY, companyA);
      check("still exactly one row (upsert, not a duplicate)", n === 1, `count=${n}`);
      const row = (await pool.query("SELECT is_primary FROM tenant_companies WHERE tenant_id = $1 AND company_id = $2", [tenantY, companyA])).rows[0];
      check("is_primary was updated to the second request's value", row?.is_primary === true);
    }

    console.log("\n── 6. Authorization boundaries are unchanged ──");
    {
      const rPlatformAdmin = await apiRequest(baseUrl, "POST", `/api/tenants/${tenantX}/companies`, platformAdmin, { companyId: companyA });
      check("platform_admin (not super_admin) is blocked — requireSuperAdmin() unchanged", rPlatformAdmin.status === 403, `status=${rPlatformAdmin.status}`);
      const rTenantAdmin = await apiRequest(baseUrl, "POST", `/api/tenants/${tenantX}/companies`, tenantAdmin, { companyId: companyA });
      check("tenant-scoped admin is blocked", rTenantAdmin.status === 403, `status=${rTenantAdmin.status}`);
      const rAnon = await apiRequest(baseUrl, "POST", `/api/tenants/${tenantX}/companies`, null, { companyId: companyA });
      check("missing authentication is blocked", rAnon.status === 401, `status=${rAnon.status}`);
    }

    console.log("\n── 7. No partial/duplicate relationship survives any rejected request (consolidated) ──");
    {
      const total = (await pool.query(
        "SELECT COUNT(*)::int AS n FROM tenant_companies WHERE tenant_id = ANY($1::varchar[]) AND company_id = ANY($2::varchar[])",
        [tenantIds, companyIds],
      )).rows[0].n as number;
      // Exactly 3 legitimate rows should exist from the accepted requests above:
      // tenantX-companyA (case 1), tenantX-companyB (case 4's accepted retry),
      // tenantY-companyA (case 5, upserted once). Every rejected request in
      // cases 2-4 is proven above to have written zero rows.
      check("exactly the 3 rows from accepted requests exist — no extra/orphaned/duplicate rows from any rejected attempt", total === 3, `count=${total}`);
    }

    console.log(`\n${passed} checks passed, ${failed} checks failed`);
  } finally {
    if (server) {
      try {
        await server.stop();
      } catch (e) {
        harnessOk = false;
        console.error("Failed to stop test server cleanly:", e);
      }
    }
    try {
      const deletions = await cascadeDelete(pool, "companies", companyIds);
      const leftovers = await verifyZeroResidue(pool, "companies", companyIds);
      if (leftovers.length > 0) throw new Error(`Cleanup verification failed — leftover rows: ${leftovers.join("; ")}`);
      await pool.query("DELETE FROM tenant_companies WHERE tenant_id = ANY($1::varchar[])", [tenantIds]);
      await pool.query("DELETE FROM tenants WHERE id = ANY($1::varchar[])", [tenantIds]);
      const tenantLeftovers = await pool.query("SELECT id FROM tenants WHERE id = ANY($1::varchar[])", [tenantIds]);
      if (tenantLeftovers.rows.length > 0) throw new Error(`Cleanup verification failed — leftover synthetic tenants: ${tenantLeftovers.rows.map((r) => r.id).join(", ")}`);
      console.log(`Cleanup verified: zero synthetic rows remain. Deleted: ${deletions.map((d) => `${d.table}(${d.count})`).join(", ")}`);
    } catch (e) {
      harnessOk = false;
      console.error("Cleanup verification failed:", e);
    }
    await pool.end();
  }

  if (!harnessOk || failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
