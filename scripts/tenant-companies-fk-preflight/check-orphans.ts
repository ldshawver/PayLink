/**
 * Read-only orphan check for tenant_companies.tenant_id → tenants.id.
 *
 * Phase 0.5, Branch 2 (docs/saas-readiness/phase-0.5-security-convergence-report.md
 * §"Branch 2 — Tenant-integrity FK preflight/migration"): shared/schema.ts's
 * `tenant_companies.tenant_id` (shared/schema.ts:4690) has no foreign-key
 * constraint to `tenants.id` — unlike the adjacent `company_id`, which does
 * (`.references(() => companies.id, { onDelete: "cascade" })`,
 * shared/schema.ts:4691). This script answers, read-only, the question the
 * original review could not: how many `tenant_companies` rows (if any) are
 * orphaned today, against whichever database it is pointed at.
 *
 * THIS SCRIPT NEVER WRITES. It runs exactly four SELECTs and prints the
 * results. It is intentionally general-purpose (usable against a disposable
 * database now, and against staging/production later by whoever has the
 * access and authorization to do so) — this Phase 0.5 branch itself only
 * ever ran it against a disposable, synthetic-fixture database; see
 * docs/saas-readiness/phase-0.5-tenant-companies-fk-preflight.md for the
 * results of that run and why a real staging/production run was
 * out of scope for this branch.
 *
 * SAFETY: refuses to run against a staging/production-shaped database name
 * or DATABASE_URL host unless FORCE_REAL_DB=1 is explicitly set, so it is
 * never accidentally pointed at live data by a future invocation that
 * forgot to think about it.
 *
 * Usage:
 *   DATABASE_URL=postgresql://user:pass@host:port/db npx tsx scripts/tenant-companies-fk-preflight/check-orphans.ts
 *   FORCE_REAL_DB=1 DATABASE_URL=... npx tsx scripts/tenant-companies-fk-preflight/check-orphans.ts   # only once you mean it
 */
import { Pool } from "pg";

const FORBIDDEN_PATTERNS = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("Usage: DATABASE_URL=postgresql://... npx tsx scripts/tenant-companies-fk-preflight/check-orphans.ts");
    process.exit(2);
  }

  const forceReal = process.env.FORCE_REAL_DB === "1";
  if (!forceReal) {
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(databaseUrl)) {
        console.error(`DATABASE_URL looks like it points at staging/production (matched ${pattern}). Refusing to run without FORCE_REAL_DB=1.`);
        process.exit(1);
      }
    }
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const dbNameRes = await pool.query("SELECT current_database() AS name");
    const dbName = dbNameRes.rows[0]?.name as string;
    if (!forceReal) {
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(dbName)) {
          console.error(`current_database() = "${dbName}" looks like staging/production. Refusing to run without FORCE_REAL_DB=1.`);
          process.exit(1);
        }
      }
    }

    console.log(`Connected to database: ${dbName}${forceReal ? " (FORCE_REAL_DB=1 — real-database run)" : ""}\n`);

    // 1. Total row count
    const totalRes = await pool.query("SELECT COUNT(*)::int AS n FROM tenant_companies");
    const total = totalRes.rows[0].n as number;
    console.log(`tenant_companies total rows: ${total}`);

    // 2. NULL tenant_id count — column is declared NOT NULL in both
    //    shared/schema.ts and server/index.ts's bootstrap CREATE TABLE, so
    //    this should always be 0; checked anyway as a schema-drift sanity
    //    check, the same category of check the security convergence report
    //    found elsewhere in this codebase (companies.status,
    //    feature_registry.key — both unrelated pre-existing bugs, not
    //    fixed by this branch).
    const nullRes = await pool.query("SELECT COUNT(*)::int AS n FROM tenant_companies WHERE tenant_id IS NULL");
    const nullCount = nullRes.rows[0].n as number;
    console.log(`tenant_companies.tenant_id NULL rows: ${nullCount}${nullCount > 0 ? "  ⚠ unexpected — column is declared NOT NULL" : ""}`);

    // 3. Orphan count — tenant_id present but no matching tenants.id
    const orphanRes = await pool.query(`
      SELECT tc.id, tc.tenant_id, tc.company_id, tc.created_at
      FROM tenant_companies tc
      LEFT JOIN tenants t ON t.id = tc.tenant_id
      WHERE t.id IS NULL
      ORDER BY tc.created_at ASC
      LIMIT 50
    `);
    const orphanCountRes = await pool.query(`
      SELECT COUNT(*)::int AS n
      FROM tenant_companies tc
      LEFT JOIN tenants t ON t.id = tc.tenant_id
      WHERE t.id IS NULL
    `);
    const orphanCount = orphanCountRes.rows[0].n as number;
    console.log(`tenant_companies orphan rows (tenant_id not in tenants.id): ${orphanCount}`);
    if (orphanCount > 0) {
      console.log(`First ${Math.min(orphanCount, 50)} orphan row(s) (id, tenant_id, company_id, created_at — no names/PII):`);
      for (const r of orphanRes.rows) {
        console.log(`  ${r.id}  tenant_id=${r.tenant_id}  company_id=${r.company_id}  created_at=${r.created_at}`);
      }
      if (orphanCount > 50) console.log(`  ... and ${orphanCount - 50} more (LIMIT 50 applied)`);
    }

    // 4. Type-compatibility confirmation (both columns must be the same
    //    type for a FK to be addable at all) — already established by
    //    direct source reading (shared/schema.ts: both varchar), confirmed
    //    here against the live information_schema too.
    const typeRes = await pool.query(`
      SELECT table_name, column_name, data_type, character_maximum_length
      FROM information_schema.columns
      WHERE (table_name = 'tenant_companies' AND column_name = 'tenant_id')
         OR (table_name = 'tenants' AND column_name = 'id')
      ORDER BY table_name
    `);
    console.log("\nType compatibility (tenant_companies.tenant_id vs tenants.id):");
    for (const r of typeRes.rows) {
      console.log(`  ${r.table_name}.${r.column_name}: ${r.data_type}${r.character_maximum_length ? `(${r.character_maximum_length})` : ""}`);
    }
    const types = typeRes.rows.map((r: any) => r.data_type);
    const compatible = types.length === 2 && types[0] === types[1];
    console.log(`  compatible: ${compatible ? "yes" : "NO — resolve before attempting the FK migration"}`);

    console.log("\n=== Verdict ===");
    if (orphanCount === 0 && nullCount === 0 && compatible) {
      console.log("Clean: 0 orphans, 0 NULLs, types compatible. The FK migration (see phase-0.5-tenant-companies-fk-preflight.md) can proceed once run against the real target database with this same clean result.");
    } else {
      console.log("NOT clean — do not add the FK constraint until every orphan/NULL/type issue above is resolved or explicitly triaged.");
    }

    process.exitCode = orphanCount === 0 && nullCount === 0 && compatible ? 0 : 1;
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
