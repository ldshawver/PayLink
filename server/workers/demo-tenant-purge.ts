/**
 * Tenant-scoped purge of ONE expired demo company, for DemoCleanup.
 *
 * Why: provisioned demos own rows in tables whose foreign keys to `companies`
 * are NO ACTION (e.g. accrual_accounts_company_id_companies_id_fk, seeded by
 * provisionDemoTenant; expense_payments_company_id_fkey once a visitor records a
 * payment), so deleting just the company row is rejected for every provisioned
 * demo and expired demos accumulate (and stay loginable).
 *
 * How (all inside the caller's transaction — any refusal or error rolls back
 * everything, so a demo is either fully removed or left exactly as it was):
 *   1. Re-assert the demo-expiry predicate on the company row FOR UPDATE.
 *   2. Collect the exact rows that depend on it — starting from the company row
 *      and the demo's own users (users.company_id has no foreign key) — by
 *      walking foreign keys from parent to CHILD only (NO ACTION / RESTRICT / CASCADE edges, read from
 *      pg_catalog) to a fixpoint. Shared parents (roles, enterprises, …) are
 *      never reached because edges are never followed child → parent.
 *   3. Refuse (throw) if any collected row — or any row an ON DELETE SET NULL
 *      edge would modify, or any access grant of a collected user — carries a
 *      different company_id. Another tenant's data is never deleted or changed.
 *   4. Delete every collected row in ONE statement (data-modifying CTEs), so
 *      NO ACTION checks run once at the end of the statement and table order
 *      does not matter. No constraint, cascade or trigger is altered.
 *   5. Remove the demo's tenant-core rows, which have no foreign keys
 *      (company_user_access, onboarding_progress, tenant_license_events,
 *      tenant_licenses, tenant_companies) and its own 'demo' tenant once no
 *      company is linked to it. Seeded tenants are never removed.
 *
 * Deliberately retained: rows in tables that carry company_id but have no
 * foreign key into the demo (e.g. authorization_audit_log) — audit history is
 * not deleted here.
 */
import { sql } from "drizzle-orm";

type Tx = { execute: (q: any) => Promise<{ rows: any[]; rowCount?: number | null }> };

export class DemoPurgeRefusedError extends Error {}

export interface DemoPurgeResult {
  companiesRemoved: number;
  rowsRemoved: number;
  byTable: Record<string, number>;
}

const MAX_ROWS = 250_000;
const MAX_PASSES = 25;
const PROTECTED_TENANT_SLUGS = ["demo-tenant", "alavont-holding"];

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;
const lit = (value: string) => `'${value.replace(/'/g, "''")}'`;
/** One text[] parameter (drizzle would expand a JS array into a parameter list). */
const textArray = (values: string[]) => sql`${"{" + values.map((v) => `"${v.replace(/["\\]/g, "\\$&")}"`).join(",") + "}"}::text[]`;
const purgeRows = (table: string) => `ARRAY(SELECT rid FROM _demo_purge WHERE tbl = ${lit(table)})`;

interface FkEdge {
  child: string;
  parent: string;
  act: string;
  child_cols: string[];
  parent_cols: string[];
}

export async function purgeExpiredDemoCompany(tx: Tx, companyId: string): Promise<DemoPurgeResult> {
  const none: DemoPurgeResult = { companiesRemoved: 0, rowsRemoved: 0, byTable: {} };
  await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
  await tx.execute(sql`SET LOCAL statement_timeout = '300s'`);

  // 1. Same predicate the DemoCleanup candidate query uses, re-checked under lock.
  const target = await tx.execute(sql`
    SELECT id FROM companies
    WHERE  id         = ${companyId}
      AND  is_demo    = TRUE
      AND  trial_end  IS NOT NULL
      AND  trial_end  < NOW() - INTERVAL '2 hours'
      AND  name NOT IN ('Demo Corp', '__demo_provision__')
      AND  (gate_override_reason IS NULL OR gate_override_reason NOT LIKE 'integrity-repair%')
    FOR UPDATE
  `);
  if (target.rows.length === 0) return none;

  const edges = (await tx.execute(sql`
    SELECT ch.relname AS child, pa.relname AS parent, c.confdeltype AS act,
      ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(n, o)
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n ORDER BY k.o)::text[] AS child_cols,
      ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY k(n, o)
            JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.n ORDER BY k.o)::text[] AS parent_cols
    FROM pg_constraint c
    JOIN pg_class ch ON ch.oid = c.conrelid JOIN pg_namespace nc ON nc.oid = ch.relnamespace
    JOIN pg_class pa ON pa.oid = c.confrelid JOIN pg_namespace np ON np.oid = pa.relnamespace
    WHERE c.contype = 'f' AND nc.nspname = 'public' AND np.nspname = 'public'
  `)).rows as FkEdge[];
  const companyCols = new Set(((await tx.execute(sql`
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t USING (table_schema, table_name)
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.column_name = 'company_id'
  `)).rows as any[]).map((r) => r.table_name as string));

  // 2. Dependent-row closure, child-ward only.
  await tx.execute(sql`CREATE TEMP TABLE _demo_purge (tbl text NOT NULL, rid tid NOT NULL, PRIMARY KEY (tbl, rid)) ON COMMIT DROP`);
  await tx.execute(sql`INSERT INTO _demo_purge SELECT 'companies', ctid FROM companies WHERE id = ${companyId}`);
  // The demo's own login accounts: users.company_id has no foreign key to
  // companies, so they are seeded explicitly (and their dependents walked).
  const seededUsers = await tx.execute(sql`INSERT INTO _demo_purge SELECT 'users', ctid FROM users WHERE company_id = ${companyId}`);
  const walk = edges.filter((e) => e.act === "a" || e.act === "r" || e.act === "c");
  const tables = new Set<string>(["companies", ...((seededUsers.rowCount ?? 0) > 0 ? ["users"] : [])]);
  for (let pass = 0; ; pass++) {
    if (pass >= MAX_PASSES) throw new DemoPurgeRefusedError("dependency walk did not converge");
    let added = 0;
    for (const e of walk) {
      if (!tables.has(e.parent)) continue;
      const childTuple = e.child_cols.map((c) => `c.${ident(c)}`).join(", ");
      const parentTuple = e.parent_cols.map((c) => `p.${ident(c)}`).join(", ");
      const res = await tx.execute(sql.raw(`
        INSERT INTO _demo_purge (tbl, rid)
        SELECT ${lit(e.child)}, c.ctid FROM ${ident(e.child)} c
        WHERE (${childTuple}) IN (SELECT ${parentTuple} FROM ${ident(e.parent)} p WHERE p.ctid = ANY(${purgeRows(e.parent)}))
        ON CONFLICT DO NOTHING
      `));
      const n = res.rowCount ?? 0;
      if (n > 0) { added += n; tables.add(e.child); }
    }
    const total = Number((await tx.execute(sql`SELECT count(*)::int AS n FROM _demo_purge`)).rows[0].n);
    if (total > MAX_ROWS) throw new DemoPurgeRefusedError(`dependent rows exceed ${MAX_ROWS}`);
    if (added === 0) break;
  }

  // 3. Tenant guards — refuse rather than touch another company's rows.
  for (const t of tables) {
    if (t === "companies") {
      const other = await tx.execute(sql.raw(`SELECT 1 FROM companies WHERE ctid = ANY(${purgeRows(t)}) AND id <> ${lit(companyId)} LIMIT 1`));
      if (other.rows.length) throw new DemoPurgeRefusedError("dependency walk reached another company");
    } else if (companyCols.has(t)) {
      const other = await tx.execute(sql.raw(`SELECT 1 FROM ${ident(t)} WHERE ctid = ANY(${purgeRows(t)}) AND company_id IS NOT NULL AND company_id::text <> ${lit(companyId)} LIMIT 1`));
      if (other.rows.length) throw new DemoPurgeRefusedError(`${t} row of another company depends on this demo`);
    }
  }
  for (const e of edges.filter((x) => (x.act === "n" || x.act === "d") && tables.has(x.parent) && companyCols.has(x.child))) {
    const childTuple = e.child_cols.map((c) => `c.${ident(c)}`).join(", ");
    const parentTuple = e.parent_cols.map((c) => `p.${ident(c)}`).join(", ");
    const other = await tx.execute(sql.raw(`
      SELECT 1 FROM ${ident(e.child)} c
      WHERE (${childTuple}) IN (SELECT ${parentTuple} FROM ${ident(e.parent)} p WHERE p.ctid = ANY(${purgeRows(e.parent)}))
        AND c.company_id IS NOT NULL AND c.company_id::text <> ${lit(companyId)} LIMIT 1
    `));
    if (other.rows.length) throw new DemoPurgeRefusedError(`${e.child} row of another company references this demo`);
  }
  const userIds = tables.has("users")
    ? ((await tx.execute(sql.raw(`SELECT id FROM users WHERE ctid = ANY(${purgeRows("users")})`))).rows as any[]).map((r) => r.id as string)
    : [];
  if (userIds.length) {
    const foreignGrant = await tx.execute(sql`
      SELECT 1 FROM company_user_access WHERE user_id = ANY(${textArray(userIds)}) AND company_id <> ${companyId} LIMIT 1
    `);
    if (foreignGrant.rows.length) throw new DemoPurgeRefusedError("a demo user holds access to another company");
  }
  const tenantIds = ((await tx.execute(sql`SELECT tenant_id FROM tenant_companies WHERE company_id = ${companyId}`)).rows as any[])
    .map((r) => r.tenant_id as string);

  // 4. One statement: NO ACTION foreign keys are checked once, at its end.
  const ordered = Array.from(tables);
  const ctes = ordered.map((t, i) => `d${i} AS (DELETE FROM ${ident(t)} WHERE ctid = ANY(${purgeRows(t)}) RETURNING 1)`);
  const counts = ordered.map((_, i) => `(SELECT count(*) FROM d${i})::int AS c${i}`);
  const del = (await tx.execute(sql.raw(`WITH ${ctes.join(",\n")} SELECT ${counts.join(", ")}`))).rows[0] as Record<string, number>;
  const byTable: Record<string, number> = {};
  ordered.forEach((t, i) => { byTable[t] = Number(del[`c${i}`]); });

  // 5. Tenant core (no foreign keys).
  const core = async (table: string, q: any) => {
    const n = (await tx.execute(q)).rowCount ?? 0;
    if (n) byTable[table] = (byTable[table] ?? 0) + n;
  };
  await core("company_user_access", sql`DELETE FROM company_user_access WHERE company_id = ${companyId} OR user_id = ANY(${textArray(userIds)})`);
  await core("onboarding_progress", sql`DELETE FROM onboarding_progress WHERE company_id = ${companyId}`);
  await core("tenant_license_events", sql`DELETE FROM tenant_license_events WHERE company_id = ${companyId}`);
  await core("tenant_licenses", sql`DELETE FROM tenant_licenses WHERE company_id = ${companyId}`);
  await core("tenant_companies", sql`DELETE FROM tenant_companies WHERE company_id = ${companyId}`);
  if (tenantIds.length) {
    await core("tenants", sql`
      DELETE FROM tenants t
      WHERE t.id = ANY(${textArray(tenantIds)}) AND t.status = 'demo' AND t.slug <> ALL(${textArray(PROTECTED_TENANT_SLUGS)})
        AND NOT EXISTS (SELECT 1 FROM tenant_companies tc WHERE tc.tenant_id = t.id)
    `);
  }

  const companiesRemoved = byTable["companies"] ?? 0;
  if (companiesRemoved !== 1) throw new Error(`demo purge removed ${companiesRemoved} company rows (expected 1)`);
  const rowsRemoved = Object.values(byTable).reduce((a, b) => a + b, 0);
  return { companiesRemoved, rowsRemoved, byTable };
}
