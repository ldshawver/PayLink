/**
 * Post-migration validation for scripts/tenant-companies-fk-preflight/migration.sql.
 *
 * Read-only. Confirms:
 *  1. The constraint exists, is a FOREIGN KEY on tenant_companies(tenant_id)
 *     referencing tenants(id), with ON DELETE CASCADE.
 *  2. tenant_companies' row count is unchanged from before the migration
 *     (the migration must be purely additive — this script takes a
 *     `--before-count=N` argument to compare against, since it has no other
 *     way to know the pre-migration count).
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx scripts/tenant-companies-fk-preflight/validate.ts --before-count=123
 */
import { Pool } from "pg";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("Usage: DATABASE_URL=postgresql://... npx tsx scripts/tenant-companies-fk-preflight/validate.ts --before-count=N");
    process.exit(2);
  }
  const beforeCountArg = process.argv.find((a) => a.startsWith("--before-count="));
  const beforeCount = beforeCountArg ? parseInt(beforeCountArg.split("=")[1], 10) : undefined;

  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  let ok = true;
  try {
    const constraintRes = await pool.query(`
      SELECT
        tc.constraint_name,
        tc.constraint_type,
        kcu.column_name,
        ccu.table_name AS referenced_table,
        ccu.column_name AS referenced_column,
        rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
      JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
      WHERE tc.table_name = 'tenant_companies' AND tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name = 'tenant_id'
    `);

    if (constraintRes.rows.length === 0) {
      console.error("FAIL: no FOREIGN KEY constraint found on tenant_companies.tenant_id.");
      ok = false;
    } else {
      const c = constraintRes.rows[0];
      console.log(`Found constraint: ${c.constraint_name}`);
      console.log(`  tenant_companies.${c.column_name} -> ${c.referenced_table}.${c.referenced_column}, ON DELETE ${c.delete_rule}`);
      if (c.referenced_table !== "tenants" || c.referenced_column !== "id") {
        console.error(`FAIL: constraint references ${c.referenced_table}.${c.referenced_column}, expected tenants.id.`);
        ok = false;
      }
      if (c.delete_rule !== "CASCADE") {
        console.error(`FAIL: ON DELETE is ${c.delete_rule}, expected CASCADE.`);
        ok = false;
      }
      if (ok) console.log("PASS: constraint shape is correct.");
    }

    const countRes = await pool.query("SELECT COUNT(*)::int AS n FROM tenant_companies");
    const afterCount = countRes.rows[0].n as number;
    console.log(`tenant_companies row count after migration: ${afterCount}`);
    if (beforeCount !== undefined) {
      if (afterCount === beforeCount) {
        console.log(`PASS: row count unchanged (${beforeCount} -> ${afterCount}) — migration was purely additive.`);
      } else {
        console.error(`FAIL: row count changed (${beforeCount} -> ${afterCount}) — migration should never modify existing rows.`);
        ok = false;
      }
    } else {
      console.log("(no --before-count= given — skipping row-count-unchanged check)");
    }
  } finally {
    await pool.end();
  }

  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
