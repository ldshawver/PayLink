/**
 * Phase 0.5, Branch 2 — tenant_companies.tenant_id FK preflight evidence.
 *
 * This is NOT a route-negative-test file like batches 2-5 or
 * platform-role-boundary-negative-db.test.ts. It exists to empirically prove
 * (against a disposable database and synthetic fixtures only) the claims made
 * in docs/saas-readiness/phase-0.5-tenant-companies-fk-preflight.md:
 *
 *  1. The orphan-creation vector is real: POST /api/tenants/:id/companies
 *     (server/routes.ts, requireSuperAdmin) inserts into tenant_companies
 *     using the URL's :id as tenant_id with NO existence check against
 *     tenants — a nonexistent tenant id in the URL still returns 201 and
 *     creates a row nothing else in the app will ever surface (getTenantIdForCompany,
 *     server/tenant-context.ts:77-104, INNER JOINs tenants and so silently
 *     treats an orphaned row as "no tenant assigned" rather than crashing or
 *     leaking data — the gap is dead/dangling data, not an active leak).
 *  2. scripts/tenant-companies-fk-preflight/check-orphans.ts correctly
 *     detects that orphan (and correctly reports clean once it's resolved).
 *  3. scripts/tenant-companies-fk-preflight/migration.sql applies cleanly
 *     when the table is orphan-free, is purely additive (row count
 *     unchanged), and produces exactly the constraint shape
 *     scripts/tenant-companies-fk-preflight/validate.ts expects
 *     (FOREIGN KEY tenant_id -> tenants.id, ON DELETE CASCADE).
 *  4. The constraint's ON DELETE CASCADE actually cascades (deleting a
 *     tenants row removes its tenant_companies rows) — proving the semantics
 *     chosen in migration.sql's comment, even though no application code
 *     path exercises tenant deletion today.
 *  5. migration.sql is REFUSED by Postgres itself (fails atomically, no
 *     partial state) when an orphan is present — the built-in safety net
 *     behind check-orphans.ts, not just documentation.
 *  6. scripts/tenant-companies-fk-preflight/rollback.sql fully reverses the
 *     migration (constraint gone, zero data changed).
 *
 * SAFETY: same conventions as the rest of Phase 0.5's disposable-database
 * suite — requires TEST_DATABASE_URL, refuses staging/production-shaped
 * names, aborts if TEST_DATABASE_URL equals DATABASE_URL, verifies
 * current_database() before any write, cleans up via the same FK-aware
 * cascade-delete helper, and never touches a real tenant, company, or user.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable_db npx tsx tests/tenant-companies-fk-preflight-db.test.ts
 */
import { Pool } from "pg";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import fs from "node:fs";
import { startTestServer, login, apiRequest, type TestServer } from "../scripts/cross-tenant-negative-tests/server-harness";
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

function runScript(scriptRelPath: string, databaseUrl: string, extraArgs: string[] = []): { status: number; stdout: string } {
  const res = spawnSync("npx", ["tsx", scriptRelPath, ...extraArgs], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
  });
  return { status: res.status ?? -1, stdout: (res.stdout ?? "") + (res.stderr ?? "") };
}

function runSqlFile(pool: Pool, path: string): Promise<void> {
  const sqlText = fs.readFileSync(path, "utf8");
  return pool.query(sqlText).then(() => undefined);
}

async function main() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    console.log("TEST_DATABASE_URL not set — skipping tenant_companies FK preflight tests (0 run).");
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
  let constraintCurrentlyApplied = false;

  try {
    const dbNameRes = await pool.query("SELECT current_database() AS name");
    const dbName = dbNameRes.rows[0]?.name as string;
    if (FORBIDDEN_PATTERNS.some((p) => p.test(dbName))) {
      throw new Error(`current_database() = "${dbName}" looks like staging/production. Refusing to run.`);
    }

    console.log("\n── 1. Fixtures: two synthetic tenants, two synthetic companies, real memberships ──");
    const suffix = crypto.randomBytes(4).toString("hex");
    const companyA = crypto.randomUUID();
    const companyB = crypto.randomUUID();
    companyIds.push(companyA, companyB);
    await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2), ($3, $4)`, [companyA, `FKPre Company A ${suffix}`, companyB, `FKPre Company B ${suffix}`]);

    const tenantX = crypto.randomUUID();
    const tenantY = crypto.randomUUID();
    tenantIds.push(tenantX, tenantY);
    await pool.query(
      `INSERT INTO tenants (id, name, slug, status) VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
      [tenantX, `FKPre Tenant X ${suffix}`, `fkpre-tenant-x-${suffix}`, tenantY, `FKPre Tenant Y ${suffix}`, `fkpre-tenant-y-${suffix}`],
    );
    await pool.query(
      `INSERT INTO tenant_companies (tenant_id, company_id, is_primary) VALUES ($1, $2, true), ($3, $4, true)`,
      [tenantX, companyA, tenantY, companyB],
    );

    const pwPlain = crypto.randomBytes(12).toString("hex");
    const pwHash = await bcrypt.hash(pwPlain, 10);
    const superAdminId = crypto.randomUUID();
    const superAdminUsername = `fkpre_super_${suffix}`;
    await pool.query(
      `INSERT INTO users (id, username, password, role, company_id, worker_id, first_name, last_name, is_active) VALUES ($1,$2,$3,'platform_super_admin',NULL,NULL,'FKPre','Super', true)`,
      [superAdminId, superAdminUsername, pwHash],
    );

    const beforeOrphanCount = (await pool.query("SELECT COUNT(*)::int AS n FROM tenant_companies")).rows[0].n as number;
    check("fixtures created: 2 clean tenant_companies rows exist, 0 orphans yet", beforeOrphanCount === 2, `count=${beforeOrphanCount}`);

    // ── Schema-drift workaround (test-infra only, not an app-code change) ────
    // tenant_companies' UNIQUE(tenant_id, company_id) is declared only in
    // server/index.ts's own `CREATE TABLE IF NOT EXISTS` bootstrap
    // (server/index.ts:3623-3630), never in shared/schema.ts — so a database
    // built via `drizzle-kit push` (as this disposable database is) gets a
    // tenant_companies table with no such constraint, and the app's own
    // `CREATE TABLE IF NOT EXISTS` is a no-op once the table already exists.
    // POST /api/tenants/:id/companies relies on
    // `ON CONFLICT (tenant_id, company_id) DO UPDATE`, which requires this
    // exact constraint to exist or the upsert 500s regardless of caller —
    // confirmed by reproduction before adding this workaround. This is the
    // same class of gap already tracked as finding D5
    // (docs/saas-readiness/phase-0.5-a-ci-baseline-manifest.md) and already
    // worked around identically for `feature_overrides` in
    // tests/cross-tenant-batch-5-routes-db.test.ts — out of scope for this
    // branch (role-boundary/FK-preflight only) and NOT repaired in
    // application code here. Adding the missing constraint directly to this
    // disposable database is test-infrastructure setup, the same category of
    // action as the `drizzle-kit push` that built this schema in the first
    // place — it does not touch server/, shared/, or storage.ts.
    await pool.query(`ALTER TABLE tenant_companies ADD CONSTRAINT IF NOT EXISTS tenant_companies_tenant_id_company_id_unique UNIQUE (tenant_id, company_id)`).catch(async () => {
      // Older Postgres (<15) lacks "ADD CONSTRAINT IF NOT EXISTS" — fall back to a plain unique index, which ON CONFLICT accepts equally.
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS tenant_companies_tenant_id_company_id_unique_idx ON tenant_companies (tenant_id, company_id)`);
    });

    console.log("\n── 2. Reproduce the orphan-creation vector via the real, running app ──");
    server = await startTestServer(testDatabaseUrl);
    const baseUrl = server.baseUrl;
    const superAdminSession = await login(baseUrl, superAdminUsername, pwPlain);

    const nonexistentTenantId = crypto.randomUUID();
    const rCreateOrphan = await apiRequest(baseUrl, "POST", `/api/tenants/${nonexistentTenantId}/companies`, superAdminSession, { companyId: companyA, isPrimary: false });
    check(
      "POST /api/tenants/:id/companies with a nonexistent tenant id in the URL returns 201, not 404 (server/routes.ts:31450 — no tenant-existence check before the INSERT)",
      rCreateOrphan.status === 201,
      `status=${rCreateOrphan.status}`,
    );
    const afterCreateCount = (await pool.query("SELECT COUNT(*)::int AS n FROM tenant_companies WHERE tenant_id = $1", [nonexistentTenantId])).rows[0].n as number;
    check("that request actually wrote a dangling row (tenant_id refers to nothing)", afterCreateCount === 1, `rows for nonexistentTenantId=${afterCreateCount}`);

    console.log("\n── 3. check-orphans.ts detects it ──");
    const dirtyCheck = runScript("scripts/tenant-companies-fk-preflight/check-orphans.ts", testDatabaseUrl);
    check("check-orphans.ts exits non-zero (not clean) while the orphan exists", dirtyCheck.status !== 0, `exit=${dirtyCheck.status}`);
    check("check-orphans.ts reports exactly 1 orphan row", /orphan rows.*: 1\b/.test(dirtyCheck.stdout), dirtyCheck.stdout.split("\n").find((l) => l.includes("orphan rows")) ?? "(line not found)");
    check("check-orphans.ts prints the orphaned tenant_id for triage", dirtyCheck.stdout.includes(nonexistentTenantId), "expected id not found in output");

    console.log("\n── 4. migration.sql is refused by Postgres while the orphan exists (fails atomically) ──");
    let migrationRejected = false;
    try {
      await runSqlFile(pool, "scripts/tenant-companies-fk-preflight/migration.sql");
    } catch (e: any) {
      migrationRejected = e?.code === "23503" || /violat/i.test(String(e?.message));
    }
    check("ALTER TABLE ... ADD CONSTRAINT is rejected (Postgres itself refuses a FK over existing violations)", migrationRejected);
    const constraintExistsAfterRejectedAttempt = (await pool.query(`
      SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'tenant_companies' AND constraint_name = 'tenant_companies_tenant_id_tenants_id_fk'
    `)).rows.length > 0;
    check("no partial constraint was left behind by the rejected attempt", !constraintExistsAfterRejectedAttempt);
    const orphanStillPresent = (await pool.query("SELECT COUNT(*)::int AS n FROM tenant_companies WHERE tenant_id = $1", [nonexistentTenantId])).rows[0].n as number;
    check("the orphan row itself is untouched by the rejected migration attempt (no silent data loss)", orphanStillPresent === 1, `count=${orphanStillPresent}`);

    console.log("\n── 5. Resolve the orphan, re-check clean ──");
    await pool.query("DELETE FROM tenant_companies WHERE tenant_id = $1", [nonexistentTenantId]);
    const cleanCheck = runScript("scripts/tenant-companies-fk-preflight/check-orphans.ts", testDatabaseUrl);
    check("check-orphans.ts exits 0 (clean) once the orphan is resolved", cleanCheck.status === 0, `exit=${cleanCheck.status}`);
    check("check-orphans.ts reports 0 orphan rows", /orphan rows.*: 0\b/.test(cleanCheck.stdout));

    console.log("\n── 6. migration.sql applies cleanly once orphan-free ──");
    const beforeMigrationCount = (await pool.query("SELECT COUNT(*)::int AS n FROM tenant_companies")).rows[0].n as number;
    await runSqlFile(pool, "scripts/tenant-companies-fk-preflight/migration.sql");
    constraintCurrentlyApplied = true;
    console.log("  (applied)");

    console.log("\n── 7. validate.ts confirms constraint shape + additivity ──");
    const validateRes = runScript("scripts/tenant-companies-fk-preflight/validate.ts", testDatabaseUrl, [`--before-count=${beforeMigrationCount}`]);
    check("validate.ts exits 0", validateRes.status === 0, validateRes.stdout);
    check("validate.ts confirms ON DELETE CASCADE", validateRes.stdout.includes("ON DELETE CASCADE"));
    check("validate.ts confirms row count unchanged (purely additive migration)", validateRes.stdout.includes("row count unchanged"));

    console.log("\n── 8. ON DELETE CASCADE actually cascades ──");
    await pool.query("DELETE FROM tenants WHERE id = $1", [tenantY]);
    const cascadedRows = (await pool.query("SELECT COUNT(*)::int AS n FROM tenant_companies WHERE tenant_id = $1", [tenantY])).rows[0].n as number;
    check("deleting a tenant automatically removes its tenant_companies row(s)", cascadedRows === 0, `remaining=${cascadedRows}`);
    const companyBUntouched = (await pool.query("SELECT 1 FROM companies WHERE id = $1", [companyB])).rows.length > 0;
    check("the cascade does not touch the companies row itself — only the join row", companyBUntouched);
    // tenantY is gone now; remove it from the cleanup list so the later
    // tenant cleanup step doesn't attempt to delete an already-gone row.
    tenantIds.splice(tenantIds.indexOf(tenantY), 1);

    console.log("\n── 9. rollback.sql fully reverses the migration ──");
    await runSqlFile(pool, "scripts/tenant-companies-fk-preflight/rollback.sql");
    constraintCurrentlyApplied = false;
    const constraintGone = (await pool.query(`
      SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'tenant_companies' AND constraint_name = 'tenant_companies_tenant_id_tenants_id_fk'
    `)).rows.length === 0;
    check("constraint no longer exists after rollback.sql", constraintGone);
    const rowsUnchangedAfterRollback = (await pool.query("SELECT COUNT(*)::int AS n FROM tenant_companies")).rows[0].n as number;
    check("rollback did not change any data (only removed the constraint)", rowsUnchangedAfterRollback === beforeMigrationCount - 1 /* tenantY's row was cascade-removed in step 8, before rollback */, `rows=${rowsUnchangedAfterRollback}`);

    console.log(`\n${passed} checks passed, ${failed} checks failed`);
  } finally {
    // If a prior assertion failed mid-run, make sure the disposable database
    // isn't left with the constraint applied — cleanup below deletes rows
    // directly and must not fight a FK that's no longer this test's concern.
    if (constraintCurrentlyApplied) {
      try {
        await runSqlFile(pool, "scripts/tenant-companies-fk-preflight/rollback.sql");
      } catch (e) {
        console.error("Failed to roll back constraint during cleanup:", e);
      }
    }
    if (server) {
      try {
        await server.stop();
      } catch (e) {
        harnessOk = false;
        console.error("Failed to stop test server cleanly:", e);
      }
    }
    try {
      // Any leftover tenant_companies rows referencing our synthetic
      // companies are removed by the companies-rooted cascade (company_id
      // has a real FK). tenants rows are not reachable from that cascade
      // (tenant_id carries no FK by design pre-migration/post-rollback), so
      // deleted directly, same pattern as batch 5's cleanup.
      const deletions = await cascadeDelete(pool, "companies", companyIds);
      const leftovers = await verifyZeroResidue(pool, "companies", companyIds);
      if (leftovers.length > 0) throw new Error(`Cleanup verification failed — leftover rows: ${leftovers.join("; ")}`);
      if (tenantIds.length > 0) {
        await pool.query("DELETE FROM tenant_companies WHERE tenant_id = ANY($1::varchar[])", [tenantIds]);
        await pool.query("DELETE FROM tenants WHERE id = ANY($1::varchar[])", [tenantIds]);
        const tenantLeftovers = await pool.query("SELECT id FROM tenants WHERE id = ANY($1::varchar[])", [tenantIds]);
        if (tenantLeftovers.rows.length > 0) throw new Error(`Cleanup verification failed — leftover synthetic tenants: ${tenantLeftovers.rows.map((r) => r.id).join(", ")}`);
      }
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
