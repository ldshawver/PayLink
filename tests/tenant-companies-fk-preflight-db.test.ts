/**
 * Phase 0.5, Branch 2 — tenant_companies.tenant_id FK preflight evidence.
 *
 * This is NOT a route-negative-test file like batches 2-5 or
 * platform-role-boundary-negative-db.test.ts. It exists to empirically prove
 * (against a disposable database and synthetic fixtures only) the claims made
 * in docs/saas-readiness/phase-0.5-tenant-companies-fk-preflight.md:
 *
 *  1. An orphaned tenant_companies row (tenant_id referring to nothing in
 *     tenants) is a real, reachable state, not a theoretical one — until
 *     saas/phase0.5-tenant-company-membership-guard, POST
 *     /api/tenants/:id/companies (server/routes.ts, requireSuperAdmin)
 *     inserted using the URL's :id as tenant_id with NO existence check
 *     against tenants, and a nonexistent tenant id in the URL returned 201
 *     and created exactly this row. That application-level vector is now
 *     closed (see that branch for the route-level fix and its own
 *     regression tests) — this file no longer reproduces it via HTTP, and
 *     instead manufactures a synthetic orphan directly via SQL, since this
 *     file's job is to prove the DB-level tooling below behaves correctly
 *     given an orphan, however one might arise (a stale manual data fix, a
 *     future bug elsewhere, direct administrative SQL — the tooling must be
 *     correct regardless of cause). getTenantIdForCompany
 *     (server/tenant-context.ts:77-104) INNER JOINs tenants and so silently
 *     treats any orphaned row as "no tenant assigned" rather than crashing
 *     or leaking data — the gap this FK closes is dead/dangling data, not
 *     an active leak.
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
 *  7. tenant_id's existing NOT NULL constraint (independent of this FK) still
 *     rejects a NULL tenant_id outright — the FK never has to think about a
 *     NULL case because the column-level constraint already forecloses it.
 *  8. migration.sql is not one-shot: it can be reapplied cleanly after
 *     rollback.sql has removed the constraint.
 *  9. migrations/0015_tenant_companies_tenant_id_fk.sql — the versioned,
 *     canonical migration file this branch (saas/phase0.5-tenant-companies-fk-apply)
 *     adds to integrate this FK with the repository's real migration
 *     mechanism (the migrations/ directory, applied manually the same way
 *     0004/0013/etc. are per DEPLOYMENT.md) — produces the exact same
 *     constraint shape as migration.sql and is equally reversible by the
 *     same rollback.sql. Deliberately NOT wired into shared/schema.ts,
 *     drizzle-kit push, or server/index.ts's auto-apply-on-startup DDL
 *     block — see that file's own header for why.
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
import fs from "node:fs";
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

    const beforeOrphanCount = (await pool.query("SELECT COUNT(*)::int AS n FROM tenant_companies")).rows[0].n as number;
    check("fixtures created: 2 clean tenant_companies rows exist, 0 orphans yet", beforeOrphanCount === 2, `count=${beforeOrphanCount}`);

    console.log("\n── 2. Manufacture a synthetic orphan directly via SQL ──");
    // Previously reproduced via a real HTTP call to POST
    // /api/tenants/:id/companies — that application-level vector is now
    // closed by saas/phase0.5-tenant-company-membership-guard (the route
    // loads and validates the tenant before inserting anything, and 404s on
    // a nonexistent one), so this file no longer boots the server or exists
    // to demonstrate that vector. It manufactures the same DB state directly
    // instead, since everything downstream in this file (check-orphans.ts,
    // migration.sql, validate.ts, rollback.sql) only cares that an orphan
    // row exists, not how it got there.
    const nonexistentTenantId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO tenant_companies (tenant_id, company_id, is_primary) VALUES ($1, $2, false)`,
      [nonexistentTenantId, companyA],
    );
    const afterCreateCount = (await pool.query("SELECT COUNT(*)::int AS n FROM tenant_companies WHERE tenant_id = $1", [nonexistentTenantId])).rows[0].n as number;
    check("synthetic orphan row exists (tenant_id refers to nothing in tenants)", afterCreateCount === 1, `rows for nonexistentTenantId=${afterCreateCount}`);

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

    console.log("\n── 10. NULL handling: tenant_id's own NOT NULL constraint rejects NULL regardless of the FK ──");
    let nullRejected = false;
    try {
      await pool.query(`INSERT INTO tenant_companies (tenant_id, company_id, is_primary) VALUES (NULL, $1, false)`, [companyA]);
    } catch (e: any) {
      nullRejected = e?.code === "23502"; // not_null_violation
    }
    check("inserting a NULL tenant_id is rejected outright (23502 not_null_violation), not silently accepted", nullRejected);
    const nullRows = (await pool.query("SELECT COUNT(*)::int AS n FROM tenant_companies WHERE tenant_id IS NULL")).rows[0].n as number;
    check("no NULL-tenant_id row exists after the rejected insert", nullRows === 0, `count=${nullRows}`);

    console.log("\n── 11. migration.sql can be reapplied cleanly after rollback.sql (the pair is not one-shot) ──");
    const beforeReapplyCount = (await pool.query("SELECT COUNT(*)::int AS n FROM tenant_companies")).rows[0].n as number;
    await runSqlFile(pool, "scripts/tenant-companies-fk-preflight/migration.sql");
    constraintCurrentlyApplied = true;
    const reapplyValidate = runScript("scripts/tenant-companies-fk-preflight/validate.ts", testDatabaseUrl, [`--before-count=${beforeReapplyCount}`]);
    check("validate.ts confirms the reapplied constraint has the correct shape", reapplyValidate.status === 0, reapplyValidate.stdout);
    check("validate.ts confirms row count unchanged on reapply", reapplyValidate.stdout.includes("row count unchanged"));

    console.log("\n── 12. migrations/0015_tenant_companies_tenant_id_fk.sql is equivalent to migration.sql ──");
    await runSqlFile(pool, "scripts/tenant-companies-fk-preflight/rollback.sql");
    constraintCurrentlyApplied = false;
    const beforeVersionedCount = (await pool.query("SELECT COUNT(*)::int AS n FROM tenant_companies")).rows[0].n as number;
    await runSqlFile(pool, "migrations/0015_tenant_companies_tenant_id_fk.sql");
    constraintCurrentlyApplied = true;
    const versionedValidate = runScript("scripts/tenant-companies-fk-preflight/validate.ts", testDatabaseUrl, [`--before-count=${beforeVersionedCount}`]);
    check("validate.ts confirms migrations/0015 produces the identical constraint shape (FK, tenants.id, ON DELETE CASCADE)", versionedValidate.status === 0, versionedValidate.stdout);
    check("validate.ts confirms migrations/0015 is purely additive too", versionedValidate.stdout.includes("row count unchanged"));
    await runSqlFile(pool, "scripts/tenant-companies-fk-preflight/rollback.sql");
    constraintCurrentlyApplied = false;
    const constraintGoneFinal = (await pool.query(`
      SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'tenant_companies' AND constraint_name = 'tenant_companies_tenant_id_tenants_id_fk'
    `)).rows.length === 0;
    check("constraint removed again after the final rollback — disposable database left clean", constraintGoneFinal);

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
