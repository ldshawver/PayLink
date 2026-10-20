/**
 * DemoCleanup tenant-scoped purge — DB integration (server/workers/demo-tenant-purge.ts).
 *
 * Uses real provisionDemoTenant seeds (which include accrual_accounts — the NO
 * ACTION foreign key that makes the legacy single-row company DELETE fail) and
 * proves:
 *   1. the legacy company-only DELETE fails on a provisioned demo (reproduction);
 *   2. the purge removes an expired demo and every dependent row atomically,
 *      including user-created expense_payments, its tenant core and its tenant;
 *   3. it touches nothing else — exact per-table row accounting across the DB;
 *   4. it REFUSES (and rolls back completely) when another company's row
 *      depends on the demo;
 *   5. non-expired, canonical and integrity-repair demos are never touched;
 *   6. legacy demos without a tenant core are purged too;
 *   7. concurrent purges of one company remove it exactly once.
 *
 * SAFETY: requires TEST_DATABASE_URL pointing at a disposable database. Refuses
 * staging/production-shaped names/hosts, verifies current_database(), and skips
 * (exit 0, visible message) when TEST_DATABASE_URL is unset.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable npx tsx tests/demo-tenant-purge-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";

const FORBIDDEN = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.log("SKIP: TEST_DATABASE_URL not set — demo purge DB tests not run (this is not a failure).");
    process.exit(0);
  }
  const parsed = new URL(url);
  const dbName = parsed.pathname.replace(/^\//, "");
  for (const p of FORBIDDEN) if (p.test(dbName) || p.test(parsed.hostname)) throw new Error("Refusing to run against a staging/production-shaped database.");
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) throw new Error("TEST_DATABASE_URL equals this process's DATABASE_URL.");

  const pool = new Pool({ connectionString: url, max: 4 });
  const q = (s: string, p: any[] = []) => pool.query(s, p);
  const cur = (await q("SELECT current_database() AS n")).rows[0]?.n;
  if (cur !== dbName || FORBIDDEN.some((p) => p.test(cur))) throw new Error(`current_database()="${cur}" is not the disposable database.`);

  process.env.DATABASE_URL = url;
  const { db } = await import("../server/db");
  const { provisionDemoTenant } = await import("../server/demo-seed");
  const { purgeExpiredDemoCompany, purgeExpiredDemoCompanyInTransaction, DemoPurgeRefusedError } = await import("../server/workers/demo-tenant-purge");
  const { runDemoCleanup } = await import("../server/workers/demo-cleanup");

  const tables = (await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`)).rows.map((r) => r.table_name as string);
  const companyTables = new Set((await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='company_id'`)).rows.map((r) => r.table_name as string));
  async function counts(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const t of tables) out[t] = Number((await q(`SELECT count(*) FROM "${t}"`)).rows[0].count);
    return out;
  }
  const diff = (a: Record<string, number>, b: Record<string, number>) => {
    const d: Record<string, number> = {};
    for (const t of tables) if (a[t] !== b[t]) d[t] = b[t] - a[t];
    return d;
  };
  async function rowsOwnedBy(companyId: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const t of companyTables) {
      if (!tables.includes(t)) continue;
      const n = Number((await q(`SELECT count(*) FROM "${t}" WHERE company_id::text = $1`, [companyId])).rows[0].count);
      if (n) out[t] = n;
    }
    return out;
  }
  const sfx = crypto.randomBytes(3).toString("hex");
  const provision = async (label: string, companyName?: string) => {
    const suffix = `${label}${sfx}`;
    const seed = await db.transaction((tx) => provisionDemoTenant(tx, { suffix, companyName: companyName ?? `ZZPURGE ${label} ${sfx}` }));
    return { ...seed, suffix };
  };
  const expire = (id: string) => q(`UPDATE companies SET trial_end = NOW() - INTERVAL '3 hours' WHERE id = $1`, [id]);
  const companyExists = async (id: string) => (await q(`SELECT 1 FROM companies WHERE id=$1`, [id])).rows.length === 1;
  const tenantOf = async (id: string) => (await q(`SELECT tenant_id FROM tenant_companies WHERE company_id=$1`, [id])).rows[0]?.tenant_id as string | undefined;

  try {
    console.log("\nfixtures");
    const D1 = await provision("a");
    const D2 = await provision("b");
    const D3 = await provision("c");                       // not expired
    const DC = await provision("d", "Demo Corp");         // canonical name
    const DI = await provision("e");                       // integrity-repair parent
    const DL = await provision("f");                       // legacy (no tenant core)
    for (const d of [D1, D2, DC, DI, DL]) await expire(d.companyId);
    await q(`UPDATE companies SET gate_override_reason = 'integrity-repair: test fixture' WHERE id = $1`, [DI.companyId]);
    // Simulate a demo provisioned before tenant core existed.
    for (const t of ["company_user_access", "onboarding_progress", "tenant_license_events", "tenant_licenses"]) await q(`DELETE FROM ${t} WHERE company_id = $1`, [DL.companyId]);
    const dlTenant = await tenantOf(DL.companyId);
    await q(`DELETE FROM tenant_companies WHERE company_id = $1`, [DL.companyId]);
    if (dlTenant) await q(`DELETE FROM tenants WHERE id = $1`, [dlTenant]);
    // A visitor-created expense + expense payment on D1 (the second staging FK).
    const exp = (await q(`INSERT INTO expenses (company_id, submitter_id, expense_date, amount) VALUES ($1,$2,'2026-10-01','12.50') RETURNING id`, [D1.companyId, D1.workerIds[0]])).rows[0].id;
    await q(`INSERT INTO expense_payments (company_id, expense_id, amount) VALUES ($1,$2,'12.50')`, [D1.companyId, exp]);
    check("fixtures: D1 owns accrual_accounts + expense_payments rows", (await rowsOwnedBy(D1.companyId)).accrual_accounts > 0 && (await rowsOwnedBy(D1.companyId)).expense_payments === 1);

    // ── 1. reproduction ───────────────────────────────────────────────────
    console.log("\n1. legacy company-only DELETE fails on a provisioned demo");
    let legacyErr = "";
    try {
      await db.transaction(async (tx: any) => {
        const { sql } = await import("drizzle-orm");
        await tx.execute(sql`DELETE FROM companies WHERE id = ${D1.companyId}`);
      });
    } catch (e: any) { legacyErr = String(e?.cause?.message ?? e?.message ?? e); }
    check("legacy DELETE → foreign-key violation (accrual_accounts / expense_payments)", /foreign key constraint "(accrual_accounts_company_id_companies_id_fk|expense_payments_company_id_fkey)"/.test(legacyErr), legacyErr.slice(0, 160));
    check("…and it deleted nothing (single statement, atomic)", await companyExists(D1.companyId));

    // ── 4. refusal on cross-tenant dependency ─────────────────────────────
    console.log("\n4. refuses when another company's row depends on the demo");
    const crossId = (await q(`INSERT INTO check_print_audit_logs (payroll_run_id, company_id) VALUES ($1,$2) RETURNING id`, [D1.payrollRunId, D2.companyId])).rows[0].id;
    const beforeRefusal = await counts();
    let refused: unknown;
    try { await purgeExpiredDemoCompanyInTransaction(db, D1.companyId); } catch (e) { refused = e; }
    check("purge(D1) throws DemoPurgeRefusedError naming the table", refused instanceof DemoPurgeRefusedError && /check_print_audit_logs/.test((refused as Error).message), String(refused));
    check("…and rolls back completely (every table's row count unchanged)", Object.keys(diff(beforeRefusal, await counts())).length === 0, JSON.stringify(diff(beforeRefusal, await counts())));
    await q(`DELETE FROM check_print_audit_logs WHERE id = $1`, [crossId]);
    const crossUser = (await q(`INSERT INTO check_print_audit_logs (initiated_by_user_id, company_id) VALUES ($1,$2) RETURNING id`, [D1.adminUserId, D2.companyId])).rows[0].id;
    const beforeRefusal2 = await counts();
    let refused2: unknown;
    try { await purgeExpiredDemoCompanyInTransaction(db, D1.companyId); } catch (e) { refused2 = e; }
    check("another company's row referencing a demo USER → refused too", refused2 instanceof DemoPurgeRefusedError, String(refused2));
    check("…rolled back completely", Object.keys(diff(beforeRefusal2, await counts())).length === 0);
    await q(`DELETE FROM check_print_audit_logs WHERE id = $1`, [crossUser]);

    // ── 2/3/5. DemoCleanup end-to-end with the purge ──────────────────────
    console.log("\n2/3/5. DemoCleanup removes expired demos completely and touches nothing else");
    const before = await counts();
    const tenantsBefore = { D1: await tenantOf(D1.companyId), D2: await tenantOf(D2.companyId) };
    const sharedDemoTenant = (await q(`SELECT id FROM tenants WHERE slug='demo-tenant'`)).rows[0]?.id;
    const byTable: Record<string, number> = {};
    const warnings: string[] = [];
    const result = await runDemoCleanup({
      selectCandidates: async () => (await q(`
        SELECT id, name, gate_override_reason FROM companies
        WHERE is_demo = TRUE AND trial_end IS NOT NULL AND trial_end < NOW() - INTERVAL '2 hours'
          AND name NOT IN ('Demo Corp', '__demo_provision__')`)).rows,
      deleteCompany: async (id) => {
        const r = await purgeExpiredDemoCompanyInTransaction(db, id);
        for (const [t, n] of Object.entries(r.byTable)) byTable[t] = (byTable[t] ?? 0) + n;
        return r.companiesRemoved;
      },
      log: () => {},
      warn: (m) => warnings.push(m),
      throttle: { lastProtectedSignature: null },
    });
    check("removed D1, D2 and the legacy demo; integrity parent skipped; no failures", result.removed === 3 && result.protectedSkipped === 1 && result.failed === 0, `${JSON.stringify(result)} ${warnings.join(" | ")}`);
    check("D1, D2, legacy demo gone", !(await companyExists(D1.companyId)) && !(await companyExists(D2.companyId)) && !(await companyExists(DL.companyId)));
    check("not-expired, canonical 'Demo Corp' and integrity-repair demos untouched", (await companyExists(D3.companyId)) && (await companyExists(DC.companyId)) && (await companyExists(DI.companyId)));
    const after = await counts();
    const d = diff(before, after);
    const unexplained = tables.filter((t) => (d[t] ?? 0) !== -(byTable[t] ?? 0));
    check("exact accounting: every table changed by exactly the rows the purge reported", unexplained.length === 0, JSON.stringify(unexplained.map((t) => [t, d[t] ?? 0, byTable[t] ?? 0])));
    check("purge removed the previously blocking rows (accrual_accounts, expense_payments)", (byTable.accrual_accounts ?? 0) > 0 && (byTable.expense_payments ?? 0) === 1, JSON.stringify({ accrual_accounts: byTable.accrual_accounts, expense_payments: byTable.expense_payments }));
    let leftover: Record<string, number> = {};
    for (const id of [D1.companyId, D2.companyId, DL.companyId]) {
      for (const [t, n] of Object.entries(await rowsOwnedBy(id))) leftover[t] = (leftover[t] ?? 0) + n;
    }
    const coreLeft = ["company_user_access", "onboarding_progress", "tenant_licenses", "tenant_license_events", "tenant_companies"].filter((t) => leftover[t]);
    check("no tenant-core rows left for removed demos", coreLeft.length === 0, JSON.stringify(leftover));
    const fkLeft = Object.keys(leftover).filter((t) => byTable[t] !== undefined);
    check("no rows left in any table the purge walked", fkLeft.length === 0, JSON.stringify(fkLeft));
    console.log(`    rows left in tables with company_id but no foreign key: ${JSON.stringify(leftover)}`);
    check("no users left for removed demos", !leftover.users, JSON.stringify(leftover));
    check("only audit history is retained (authorization_audit_log)", Object.keys(leftover).every((t) => t === "authorization_audit_log"), JSON.stringify(leftover));
    const tenantsLeft = (await q(`SELECT count(*) FROM tenants WHERE id = ANY($1)`, [[tenantsBefore.D1, tenantsBefore.D2].filter(Boolean)])).rows[0].count;
    check("removed demos' own tenants removed", Number(tenantsLeft) === 0);
    if (sharedDemoTenant) check("seeded shared 'demo-tenant' untouched", (await q(`SELECT 1 FROM tenants WHERE id=$1`, [sharedDemoTenant])).rows.length === 1);
    check("demo users gone (cannot log in)", (await q(`SELECT count(*) FROM users WHERE username LIKE $1 OR username LIKE $2`, [`%_a${sfx}`, `%_b${sfx}`])).rows[0].count === "0");
    const survivors = [D3, DC, DI].map((x) => x.companyId);
    const survivorRows = await Promise.all(survivors.map((id) => rowsOwnedBy(id)));
    check("surviving demos keep their full data (accrual + payroll + tenant core)", survivorRows.every((r) => r.accrual_accounts > 0 && r.payroll_runs > 0 && r.company_user_access === 1 && r.tenant_licenses === 1));

    // ── 6b. never a paying / trial / converted tenant ─────────────────────
    console.log("\n6b. non-demo, billing, trial-tenant and licensed companies are preserved");
    const NP = await provision("p");                       // converted to a real company (is_demo = FALSE)
    const NB = await provision("q");                       // billing configured
    const NT = await provision("r");                       // linked to a trial tenant
    const NL = await provision("s");                       // holds a trial-signup license
    const NU = await provision("u");                       // has a platform account
    for (const x of [NP, NB, NT, NL, NU]) await expire(x.companyId);
    await q(`UPDATE companies SET is_demo = FALSE WHERE id = $1`, [NP.companyId]);
    await q(`UPDATE companies SET billing_active = TRUE WHERE id = $1`, [NB.companyId]);
    await q(`UPDATE tenants SET status = 'trial' WHERE id = $1`, [await tenantOf(NT.companyId)]);
    await q(`UPDATE tenant_licenses SET source = 'trial_signup', status = 'trialing' WHERE company_id = $1`, [NL.companyId]);
    await q(`UPDATE users SET role = 'platform_admin' WHERE id = $1`, [NU.adminUserId]);
    const ownedBefore = await Promise.all([NP, NB, NT, NL, NU].map((x) => rowsOwnedBy(x.companyId)));
    const beforeNeg = await counts();
    const np = await purgeExpiredDemoCompanyInTransaction(db, NP.companyId);
    check("non-demo company (expired trial_end): purge is a no-op", np.companiesRemoved === 0 && np.rowsRemoved === 0);
    for (const [label, x, re] of [
      ["billing_active", NB, /billing/],
      ["trial tenant", NT, /'trial' tenant/],
      ["trial-signup license", NL, /non-demo license/],
      ["platform account", NU, /platform account/],
    ] as const) {
      let err: unknown;
      try { await purgeExpiredDemoCompanyInTransaction(db, x.companyId); } catch (e) { err = e; }
      check(`${label}: refused`, err instanceof DemoPurgeRefusedError && re.test((err as Error).message), String(err));
    }
    let rcErr: unknown;
    try { await db.transaction((tx) => purgeExpiredDemoCompany(tx, NB.companyId)); } catch (e) { rcErr = e; }
    check("READ COMMITTED caller: refused before touching anything", rcErr instanceof DemoPurgeRefusedError && /REPEATABLE READ/.test((rcErr as Error).message), String(rcErr));
    const negWarnings: string[] = [];
    const negRun = await runDemoCleanup({
      selectCandidates: async () => (await q(`
        SELECT id, name, gate_override_reason FROM companies
        WHERE is_demo = TRUE AND trial_end IS NOT NULL AND trial_end < NOW() - INTERVAL '2 hours'
          AND name NOT IN ('Demo Corp', '__demo_provision__') AND id = ANY($1)`, [[NP, NB, NT, NL, NU].map((x) => x.companyId)])).rows,
      deleteCompany: async (id) => (await purgeExpiredDemoCompanyInTransaction(db, id)).companiesRemoved,
      log: () => {},
      warn: (m) => negWarnings.push(m),
      throttle: { lastProtectedSignature: null },
    });
    check("DemoCleanup: non-demo never selected, the 4 guarded demos refused, none removed", negRun.removed === 0 && negRun.failed === 4, JSON.stringify(negRun));
    check("every table's row count unchanged", Object.keys(diff(beforeNeg, await counts())).length === 0, JSON.stringify(diff(beforeNeg, await counts())));
    const ownedAfter = await Promise.all([NP, NB, NT, NL, NU].map((x) => rowsOwnedBy(x.companyId)));
    check("all five companies keep every owned row", JSON.stringify(ownedAfter) === JSON.stringify(ownedBefore));

    // ── 7. concurrency ────────────────────────────────────────────────────
    console.log("\n7. concurrent purges of one company");
    const D5 = await provision("g");
    await expire(D5.companyId);
    const race = await Promise.allSettled([1, 2, 3].map(() => purgeExpiredDemoCompanyInTransaction(db, D5.companyId)));
    const removedCounts = race.map((r) => (r.status === "fulfilled" ? r.value.companiesRemoved : -1));
    check("exactly one purge removes it, the others see nothing to do, no errors", removedCounts.filter((n) => n === 1).length === 1 && removedCounts.filter((n) => n === 0).length === 2, JSON.stringify(race.map((r) => r.status === "fulfilled" ? r.value.companiesRemoved : String((r as any).reason))));
    const again = await purgeExpiredDemoCompanyInTransaction(db, D5.companyId);
    check("purging an already-removed company is a no-op", again.companiesRemoved === 0 && again.rowsRemoved === 0);
    const live = await purgeExpiredDemoCompanyInTransaction(db, D3.companyId);
    check("purging a non-expired demo directly is a no-op", live.companiesRemoved === 0 && (await companyExists(D3.companyId)));
  } finally {
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
