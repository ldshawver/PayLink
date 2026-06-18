import 'dotenv/config';
import { Client } from 'pg';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const REQUIRED_CONFIRMATION = 'I understand this permanently deletes test workers and dependent records';

const REQUESTED_TARGET_WORKERS = [
  ['Izek', 'Brit'],
  ['Michael', 'Chen'],
  ['Sarah', 'Johnson'],
  ['Michael', 'Chen'],
  ['Emily', 'Rodriguez'],
  ['Sarah', 'Johnson'],
  ['Emily', 'Rodriguez'],
  ['Michael', 'Chen'],
  ['Sarah', 'Johnson'],
  ['Sarah', 'Johnson'],
  ['Emily', 'Rodriguez'],
  ['Michael', 'Chen'],
  ['Sarah', 'Johnson'],
  ['Emily', 'Rodriguez'],
  ['Michael', 'Chen'],
  ['Michael', 'Thompson'],
] as const;

export const TARGET_WORKERS = Array.from(
  new Map(REQUESTED_TARGET_WORKERS.map(([firstName, lastName]) => [`${firstName.toLowerCase()} ${lastName.toLowerCase()}`, [firstName, lastName] as const])).values(),
);

const PROTECTED_TABLE_PATTERNS = [
  /audit/i,
  /check/i,
  /document/i,
  /filing/i,
  /invoice/i,
  /payroll/i,
  /paystub/i,
  /tax/i,
  /w2/i,
  /1099/i,
] as const;

const args = new Set(process.argv.slice(2));
const getArg = (name: string) => {
  const prefix = `${name}=`;
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
};

const execute = args.has('--execute');
const companyId = getArg('--company-id');
const backupFile = getArg('--backup-file');
const confirmation = getArg('--confirm-name-cleanup');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Refusing to run without an explicit database target.');
}

if (!companyId) {
  throw new Error('Pass --company-id=<company_id> so duplicate test names in other tenants cannot be touched.');
}

if (execute && process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to delete data with NODE_ENV=production. Run this only against an approved non-production cleanup target.');
}

if (execute && !backupFile) {
  throw new Error('Pass --backup-file=<path> when using --execute. A database backup is required before deletion.');
}

if (execute && confirmation !== REQUIRED_CONFIRMATION) {
  throw new Error(`Pass --confirm-name-cleanup="${REQUIRED_CONFIRMATION}" to execute this cleanup.`);
}

function sqlIdent(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function isProtectedTable(tableName: string) {
  return PROTECTED_TABLE_PATTERNS.some((pattern) => pattern.test(tableName));
}

async function main() {
  if (execute && backupFile) {
    const resolvedBackup = resolve(backupFile);
    mkdirSync(dirname(resolvedBackup), { recursive: true });
    const dump = spawnSync('pg_dump', [process.env.DATABASE_URL!, '--format=custom', `--file=${resolvedBackup}`], {
      stdio: 'inherit',
    });
    if (dump.status !== 0 || !existsSync(resolvedBackup)) {
      throw new Error(`Database backup failed; no rows were deleted. Expected backup at ${resolvedBackup}`);
    }
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query('BEGIN');

    const workerResult = await client.query(
      `WITH target_names(first_name, last_name) AS (
        VALUES ${TARGET_WORKERS.map((_, index) => `($${index * 2 + 2}, $${index * 2 + 3})`).join(', ')}
      )
      SELECT w.id AS worker_id,
             w.first_name,
             w.last_name,
             w.email,
             w.company_id,
             w.created_at,
             COALESCE(w.status::text, 'unknown') AS role_status
      FROM workers w
      JOIN target_names t
        ON lower(w.first_name) = lower(t.first_name)
       AND lower(w.last_name) = lower(t.last_name)
      WHERE w.company_id = $1
      ORDER BY w.last_name, w.first_name, w.created_at, w.id`,
      [companyId, ...TARGET_WORKERS.flat()],
    );

    const workerIds = workerResult.rows.map((row) => row.worker_id);
    console.log(`Deduplicated ${REQUESTED_TARGET_WORKERS.length} requested names to ${TARGET_WORKERS.length} unique target name(s).`);
    console.log(`Matched ${workerIds.length} worker row(s) in company ${companyId}:`);
    console.table(workerResult.rows);

    if (workerIds.length === 0) {
      await client.query('ROLLBACK');
      return;
    }

    const fkResult = await client.query(`
      SELECT tc.table_schema, tc.table_name, kcu.column_name,
             EXISTS (
               SELECT 1 FROM information_schema.columns c_company
               WHERE c_company.table_schema = kcu.table_schema
                 AND c_company.table_name = kcu.table_name
                 AND c_company.column_name = 'company_id'
             ) AS has_company_id
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_schema = 'public'
        AND ccu.table_name = 'workers'
        AND ccu.column_name = 'id'
      ORDER BY tc.table_name, kcu.column_name
    `);

    const dependentCounts: Array<{ table: string; column: string; rows: number; protected: boolean }> = [];
    for (const fk of fkResult.rows) {
      const tableRef = `${sqlIdent(fk.table_schema)}.${sqlIdent(fk.table_name)}`;
      const columnRef = sqlIdent(fk.column_name);
      const companyFilter = fk.has_company_id ? ' AND company_id = $2' : '';
      const params = fk.has_company_id ? [workerIds, companyId] : [workerIds];
      const count = await client.query(
        `SELECT count(*)::int AS count FROM ${tableRef} WHERE ${columnRef} = ANY($1::varchar[])${companyFilter}`,
        params,
      );
      dependentCounts.push({
        table: `${fk.table_schema}.${fk.table_name}`,
        column: fk.column_name,
        rows: Number(count.rows[0].count),
        protected: isProtectedTable(fk.table_name),
      });
    }

    const nonZeroDependentCounts = dependentCounts.filter((row) => row.rows > 0);
    const protectedHits = nonZeroDependentCounts.filter((row) => row.protected);
    const totalDependentRows = nonZeroDependentCounts.reduce((sum, row) => sum + row.rows, 0);
    const totalRowsThatWouldBeDeleted = totalDependentRows + workerIds.length;

    console.log('All dependent table counts:');
    console.table(dependentCounts);
    console.log(`Total dependent rows that would be deleted: ${totalDependentRows}`);
    console.log(`Total rows that would be deleted including workers: ${totalRowsThatWouldBeDeleted}`);

    if (protectedHits.length > 0) {
      console.log('BLOCKED: protected payroll, tax, signed document, invoice, check, or audit-related records were found. No rows were deleted.');
      console.table(protectedHits);
      await client.query('ROLLBACK');
      return;
    }

    if (execute) {
      for (const fk of fkResult.rows) {
        if (isProtectedTable(fk.table_name)) continue;
        const tableRef = `${sqlIdent(fk.table_schema)}.${sqlIdent(fk.table_name)}`;
        const columnRef = sqlIdent(fk.column_name);
        const companyFilter = fk.has_company_id ? ' AND company_id = $2' : '';
        const params = fk.has_company_id ? [workerIds, companyId] : [workerIds];
        await client.query(`DELETE FROM ${tableRef} WHERE ${columnRef} = ANY($1::varchar[])${companyFilter}`, params);
      }

      const deletedWorkers = await client.query('DELETE FROM workers WHERE id = ANY($1::varchar[]) AND company_id = $2', [workerIds, companyId]);
      console.log(`Deleted ${deletedWorkers.rowCount ?? 0} worker row(s).`);
      await client.query('COMMIT');
    } else {
      console.log('Dry run only. Re-run with --execute, --backup-file=<path>, and the required --confirm-name-cleanup value after review and approval.');
      await client.query('ROLLBACK');
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
