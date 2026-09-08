/**
 * Generic FK-aware cascade delete for disposable-database test fixtures.
 *
 * Booting the real application server against a fixture database (as
 * tests/cross-tenant-worker-routes-db.test.ts does) can cause the app's own
 * logic to auto-create rows this test never explicitly inserted (e.g.
 * default departments/locations for a new company). A flat, hand-written
 * cleanup list can't anticipate every such side effect, and this codebase's
 * own single-table DELETE-without-cascade bug (Phase 0.5 finding, demo
 * cleanup) is exactly the failure mode to avoid repeating here.
 *
 * Strategy: attempt to delete the root rows; when Postgres reports an FK
 * violation, parse the blocking child table out of the error, look up which
 * column on that child table references the table we just tried to delete,
 * delete every row in the child scoped to the parent ids we're removing, and
 * retry. This reacts to whatever the app's side effects actually are — one
 * or several levels deep — instead of assuming a fixed table list.
 *
 * All ids passed in and discovered here are our own crypto.randomUUID()
 * fixture ids (never user input), so direct SQL interpolation of ids is
 * safe; every table/column name used in a query is one this module itself
 * read out of pg's own catalogs, not caller-supplied.
 */
import { Pool } from "pg";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sqlIdList(ids: string[]): string {
  for (const id of ids) {
    if (!UUID_RE.test(id)) throw new Error(`cascadeDelete: refusing non-UUID id in fixture cleanup: ${JSON.stringify(id)}`);
  }
  return ids.map((id) => `'${id}'`).join(",");
}

interface FkRef {
  childTable: string;
  childColumn: string;
}

async function findReferencingColumn(pool: Pool, blockingTable: string, parentTable: string): Promise<FkRef> {
  const { rows } = await pool.query(
    `
    SELECT kcu.column_name AS child_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
      AND tc.table_name = $1 AND ccu.table_name = $2
    LIMIT 1
    `,
    [blockingTable, parentTable],
  );
  if (rows.length === 0) throw new Error(`cascadeDelete: could not find an FK from "${blockingTable}" to "${parentTable}" (schema may have changed).`);
  return { childTable: blockingTable, childColumn: rows[0].child_column };
}

/**
 * Deletes `rootTable` rows matching `rootIds`, plus whatever transitively
 * references them, discovered reactively from actual FK-violation errors.
 * Returns the deletion order and row counts for logging/verification.
 */
export async function cascadeDelete(pool: Pool, rootTable: string, rootIds: string[], rootIdColumn = "id", maxPasses = 400): Promise<Array<{ table: string; column: string; count: number }>> {
  if (rootIds.length === 0) return [];

  // Stack of pending deletes. `column` is the FK/filter column this entry's
  // own DELETE is scoped by (may not be the table's primary key — e.g.
  // workers is filtered by company_id). `pkColumn` is this table's own
  // primary key, used when a *child* of this table needs to reference "any
  // row we're about to delete here" — those must always be different: using
  // `column` there would chain the wrong values forward (this was a real bug
  // caught in testing: chaining workers.company_id into payroll_items'
  // subquery instead of workers.id caused a silent 0-row delete and an
  // infinite retry loop, since every table here uses "id" as its PK).
  const pending: Array<{ table: string; column: string; pkColumn: string; idListSql: string }> = [
    { table: rootTable, column: rootIdColumn, pkColumn: rootIdColumn, idListSql: sqlIdList(rootIds) },
  ];
  const deletions: Array<{ table: string; column: string; count: number }> = [];
  let passes = 0;

  while (pending.length > 0) {
    if (++passes > maxPasses) {
      throw new Error(`cascadeDelete: exceeded ${maxPasses} passes — possible FK cycle or unexpectedly deep dependency chain. Pending: ${pending.map((p) => p.table).join(" -> ")}`);
    }
    const top = pending[pending.length - 1];
    try {
      const res = await pool.query(`DELETE FROM ${top.table} WHERE ${top.column} IN (${top.idListSql})`);
      deletions.push({ table: top.table, column: top.column, count: res.rowCount ?? 0 });
      pending.pop();
    } catch (e: any) {
      if (e?.code !== "23503") throw e; // not a foreign_key_violation — a real error, don't mask it
      // Postgres's message is "...on table \"<targetTable>\" violates foreign
      // key constraint \"...\" on table \"<blockingChildTable>\"" — the
      // *second* "on table" clause names the actual blocker, so anchor to
      // the text right after "constraint ..." rather than matching the first
      // "on table" (which just repeats the table we tried to delete from).
      const match = /violates foreign key constraint "[^"]+" on table "(\w+)"/.exec(e.message ?? "");
      const blockingTable: string | undefined = match?.[1];
      if (!blockingTable) throw e;
      const ref = await findReferencingColumn(pool, blockingTable, top.table);
      // Scope the blocker to exactly the rows we're about to delete from
      // `top` — via `top`'s own primary key, not its filter column.
      const idListSql = `SELECT ${top.pkColumn} FROM ${top.table} WHERE ${top.column} IN (${top.idListSql})`;
      pending.push({ table: ref.childTable, column: ref.childColumn, pkColumn: "id", idListSql });
    }
  }

  return deletions;
}

/**
 * Re-checks that no row remains in `rootTable` for `rootIds`, and does a
 * one-hop scan of every table with a direct FK to `rootTable` for leftover
 * rows scoped to the same ids — covers the exact side-effect shape this
 * suite has observed (departments/locations directly keyed by company_id).
 */
export async function verifyZeroResidue(pool: Pool, rootTable: string, rootIds: string[], rootIdColumn = "id"): Promise<string[]> {
  if (rootIds.length === 0) return [];
  const leftovers: string[] = [];
  const idListSql = sqlIdList(rootIds);

  const { rows: rootRows } = await pool.query(`SELECT ${rootIdColumn} FROM ${rootTable} WHERE ${rootIdColumn} IN (${idListSql})`);
  if (rootRows.length > 0) leftovers.push(`${rootTable}: ${rootRows.length} row(s)`);

  const { rows: fkRows } = await pool.query(
    `
    SELECT tc.table_name AS child_table, kcu.column_name AS child_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public' AND ccu.table_name = $1
    `,
    [rootTable],
  );
  for (const r of fkRows) {
    const { rows } = await pool.query(`SELECT 1 FROM ${r.child_table} WHERE ${r.child_column} IN (${idListSql}) LIMIT 1`);
    if (rows.length > 0) leftovers.push(`${r.child_table} (via ${r.child_column}, direct FK to ${rootTable})`);
  }
  return leftovers;
}
