/**
 * One-time cleanup of the duplicate demo-hierarchy rows that
 * server/seed.ts seedDemoHierarchy() inserted on every boot (fixed in the
 * same change: it no longer runs once any company exists).
 *
 * Each boot added one legal_entities row + two departments rows
 * ("Headquarters"/HQ, "Engineering"/ENG) to whichever company an unordered
 * SELECT returned first. Accumulated, they made GET /api/departments return
 * a ~100 MB body and froze the Add/Edit Employee dialog.
 *
 * What is deleted — ONLY rows that satisfy all of:
 *   departments:    name/code is exactly Headquarters/HQ or Engineering/ENG,
 *                   division_id, parent_id and manager_id all NULL, and at
 *                   least one other row in the same company is identical in
 *                   every column except id/created_at.
 *   legal_entities: at least one other row is identical in every column
 *                   except id/created_at, and type='llc', status='active',
 *                   ein IS NULL (the seeder's shape).
 *   both:           NOT the oldest row of its identical group (the oldest is
 *                   always kept), and its id does not appear in ANY column
 *                   anywhere in the public schema whose name mentions
 *                   "department" / "legal_entit" (UUID tokens are extracted
 *                   from text/list columns too), nor as a departments.parent_id.
 *
 * Default is a DRY RUN: prints counts only (per company id), writes nothing.
 * --apply deletes in batches, each batch in its own transaction, after first
 * writing every to-be-deleted row as JSON lines to --backup-file.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/cleanup-seed-duplicate-hierarchy.ts
 *   DATABASE_URL=... npx tsx scripts/cleanup-seed-duplicate-hierarchy.ts --apply --backup-file=/path/rows.jsonl
 */
import { Pool, type PoolClient } from "pg";
import fs from "node:fs";

const APPLY = process.argv.includes("--apply");
const backupArg = process.argv.find((a) => a.startsWith("--backup-file="));
const BACKUP_FILE = backupArg ? backupArg.slice("--backup-file=".length) : "";
const BATCH = 5000;
const UUID_RE = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

const qi = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

async function collectReferencedIds(client: PoolClient, table: "departments" | "legal_entities", pattern: string) {
  await client.query(`CREATE TEMP TABLE IF NOT EXISTS _refs_${table} (id text)`);
  await client.query(`TRUNCATE _refs_${table}`);
  const cols = await client.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name ILIKE $1 AND data_type <> 'boolean'
        AND NOT (table_name = $2 AND column_name = 'id')`,
    [pattern, table],
  );
  const extra = table === "departments" ? [{ table_name: "departments", column_name: "parent_id" }] : [];
  for (const { table_name, column_name } of [...cols.rows, ...extra]) {
    const col = `${qi(table_name)}.${qi(column_name)}`;
    // The raw value (single-id columns) and every UUID-shaped token inside it (list/text columns).
    await client.query(
      `INSERT INTO _refs_${table} (id)
         SELECT ${col}::text FROM ${qi(table_name)} WHERE ${col} IS NOT NULL
         UNION
         SELECT (regexp_matches(${col}::text, '${UUID_RE}', 'g'))[1] FROM ${qi(table_name)} WHERE ${col} IS NOT NULL`,
    );
    console.log(`  reference column scanned: ${table_name}.${column_name}`);
  }
  await client.query(`CREATE INDEX IF NOT EXISTS _refs_${table}_idx ON _refs_${table} (id)`);
  await client.query(`ANALYZE _refs_${table}`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  if (APPLY && !BACKUP_FILE) throw new Error("--apply requires --backup-file=<path> (rows are written there before deletion)");

  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  try {
    const db = (await client.query("SELECT current_database() AS n")).rows[0].n;
    console.log(`database: ${db}   mode: ${APPLY ? "APPLY" : "DRY RUN (no writes)"}`);

    await collectReferencedIds(client, "departments", "%department%");
    await collectReferencedIds(client, "legal_entities", "%legal_entit%");

    await client.query(`
      CREATE TEMP TABLE _dup_departments AS
      SELECT id, company_id FROM (
        SELECT d.id, d.company_id,
               row_number() OVER (PARTITION BY (to_jsonb(d) - 'id' - 'created_at') ORDER BY d.created_at NULLS LAST, d.id) AS rn
          FROM departments d
         WHERE ((d.name = 'Headquarters' AND d.code = 'HQ') OR (d.name = 'Engineering' AND d.code = 'ENG'))
           AND d.division_id IS NULL AND d.parent_id IS NULL AND d.manager_id IS NULL
      ) x
      WHERE rn > 1`);
    await client.query(`CREATE TEMP TABLE _del_departments AS SELECT id, company_id FROM _dup_departments x WHERE NOT EXISTS (SELECT 1 FROM _refs_departments r WHERE r.id = x.id)`);
    await client.query(`
      CREATE TEMP TABLE _dup_legal_entities AS
      SELECT id, company_id FROM (
        SELECT le.id, le.company_id,
               row_number() OVER (PARTITION BY (to_jsonb(le) - 'id' - 'created_at') ORDER BY le.created_at NULLS LAST, le.id) AS rn
          FROM legal_entities le
         WHERE le.type = 'llc' AND le.status = 'active' AND le.ein IS NULL
      ) x
      WHERE rn > 1`);
    await client.query(`CREATE TEMP TABLE _del_legal_entities AS SELECT id, company_id FROM _dup_legal_entities x WHERE NOT EXISTS (SELECT 1 FROM _refs_legal_entities r WHERE r.id = x.id)`);

    for (const t of ["departments", "legal_entities"] as const) {
      const total = (await client.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n;
      const del = await client.query<{ company_id: string | null; n: number }>(
        `SELECT company_id, count(*)::int n FROM _del_${t} GROUP BY 1 ORDER BY 2 DESC`,
      );
      const n = del.rows.reduce((s, r) => s + r.n, 0);
      const dup = (await client.query(`SELECT count(*)::int n FROM _dup_${t}`)).rows[0].n;
      console.log(`\n${t}: ${total} rows total, ${dup} non-oldest seed-shaped duplicates, ${dup - n} kept because referenced, ${n} eligible for deletion, ${total - n} would remain`);
      for (const r of del.rows) console.log(`  company ${r.company_id ?? "(null)"}: ${r.n}`);
    }

    if (!APPLY) {
      console.log("\nDRY RUN — nothing deleted. Re-run with --apply --backup-file=<path> to delete.");
      return;
    }

    const out = fs.openSync(BACKUP_FILE, "wx");
    for (const t of ["departments", "legal_entities"] as const) {
      const rows = await client.query(`SELECT to_jsonb(s) AS r FROM ${t} s WHERE s.id IN (SELECT id FROM _del_${t})`);
      for (const { r } of rows.rows) fs.writeSync(out, JSON.stringify({ table: t, row: r }) + "\n");
      console.log(`backup: ${rows.rowCount} ${t} rows written`);
    }
    fs.closeSync(out);

    for (const t of ["departments", "legal_entities"] as const) {
      let deleted = 0;
      for (;;) {
        await client.query("BEGIN");
        const r = await client.query(
          `WITH b AS (DELETE FROM _del_${t} WHERE id IN (SELECT id FROM _del_${t} LIMIT ${BATCH}) RETURNING id)
           DELETE FROM ${t} WHERE id IN (SELECT id FROM b)`,
        );
        await client.query("COMMIT");
        if (!r.rowCount) {
          if ((await client.query(`SELECT count(*)::int n FROM _del_${t}`)).rows[0].n === 0) break;
          continue;
        }
        deleted += r.rowCount;
      }
      const remaining = (await client.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n;
      console.log(`${t}: deleted ${deleted}, ${remaining} remain`);
    }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
