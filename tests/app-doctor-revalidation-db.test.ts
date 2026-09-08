/**
 * App Doctor issue revalidation — real-Postgres invariants (migration 0023).
 * Raw SQL only; does NOT boot the app.
 *
 * SAFETY: requires TEST_DATABASE_URL pointing at a disposable database. Refuses
 * staging/production-shaped names/hosts, verifies current_database() before any
 * write, never prints a URL, drops fixtures in finally. Skips (exit 0) when
 * TEST_DATABASE_URL is unset.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable npx tsx tests/app-doctor-revalidation-db.test.ts
 */
import { Pool } from "pg";
import assert from "node:assert/strict";
import fs from "node:fs";

const FORBIDDEN = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.log("SKIP: TEST_DATABASE_URL not set — 0023 DB invariants not run (this is not a failure).");
    process.exit(0);
  }
  const parsed = new URL(url);
  const dbName = parsed.pathname.replace(/^\//, "");
  for (const p of FORBIDDEN) {
    if (p.test(dbName) || p.test(parsed.hostname)) throw new Error("Refusing to run against a staging/production-shaped database.");
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) throw new Error("TEST_DATABASE_URL equals this process's DATABASE_URL.");

  const pool = new Pool({ connectionString: url, max: 4 });
  const cur = (await pool.query("SELECT current_database() d")).rows[0].d;
  assert.equal(cur, dbName, "current_database() must match TEST_DATABASE_URL");

  let pass = 0, fail = 0;
  const ok = (n: string, c: boolean) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`); } };
  const ids: string[] = [];

  try {
    // Minimal app_doctor_reports stub with the pre-0023 columns the test touches.
    await pool.query(`CREATE TABLE IF NOT EXISTS app_doctor_reports (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR, user_id VARCHAR,
      source TEXT NOT NULL DEFAULT 'runtime', severity TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'open', title TEXT NOT NULL, error_message TEXT NOT NULL,
      route TEXT, fingerprint TEXT, occurrence_count INTEGER NOT NULL DEFAULT 1,
      ai_summary TEXT,
      created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
    )`);

    const forward = fs.readFileSync("migrations/0023_app_doctor_revalidation.sql", "utf8").split("ROLLBACK")[0];
    await pool.query(forward);
    ok("migration 0023 applies", true);
    ok("migration 0023 is idempotent (re-run is a no-op)", await pool.query(forward).then(() => true).catch(() => false));

    for (const col of ["last_seen_at", "last_revalidated_at", "revalidation_status", "revalidation_evidence",
                       "archived_at", "archived_by_user_id", "archived_reason", "ai_last_error", "ai_last_error_at"]) {
      ok(`column ${col} exists`, (await pool.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name='app_doctor_reports' AND column_name=$1`, [col])).rowCount === 1);
    }
    ok("partial index idx_app_doctor_reports_active exists (WHERE archived_at IS NULL)",
      (await pool.query(`SELECT indexdef FROM pg_indexes WHERE indexname='idx_app_doctor_reports_active'`)).rows[0]?.indexdef?.includes("archived_at IS NULL"));

    const CO = "zzco-appdoctor-reval";
    const mk = async (title: string) => {
      const r = await pool.query(
        `INSERT INTO app_doctor_reports (company_id, source, severity, status, title, error_message, route, fingerprint)
         VALUES ($1,'runtime','high','ai_review_ready',$2,'boom','/app/schedule?tab=marketplace',md5($2)) RETURNING id`,
        [CO, title]);
      ids.push(r.rows[0].id);
      return r.rows[0].id as string;
    };
    const stillValid = await mk("zz reval still-valid");
    const stale = await mk("zz reval stale");
    const aiDown = await mk("zz reval ai-down");

    const activeCount = async () =>
      (await pool.query(`SELECT count(*)::int c FROM app_doctor_reports WHERE company_id=$1 AND archived_at IS NULL`, [CO])).rows[0].c;
    const totalCount = async () =>
      (await pool.query(`SELECT count(*)::int c FROM app_doctor_reports WHERE company_id=$1`, [CO])).rows[0].c;

    ok("3 fresh reports all in the active window", await activeCount() === 3);

    // (1) still-valid issue: refresh review/evidence, stays visible
    await pool.query(`UPDATE app_doctor_reports SET revalidation_status='reproduced', last_seen_at=NOW(),
      last_revalidated_at=NOW(), revalidation_evidence=$2, ai_summary='refreshed local review', updated_at=NOW()
      WHERE id=$1`, [stillValid, JSON.stringify({ decision: "reproduced", reasons: ["newer occurrence"] })]);
    {
      const row = (await pool.query(`SELECT * FROM app_doctor_reports WHERE id=$1`, [stillValid])).rows[0];
      ok("still-valid: revalidation_status='reproduced', archived_at NULL, has refreshed evidence",
        row.revalidation_status === "reproduced" && row.archived_at === null && !!row.revalidation_evidence && !!row.last_seen_at);
    }
    ok("still-valid issue remains in the active window", await activeCount() === 3);

    // (2) stale issue: archive (no hard delete), reason no_longer_reproduces
    await pool.query(`UPDATE app_doctor_reports SET revalidation_status='not_reproduced', last_revalidated_at=NOW(),
      archived_at=NOW(), archived_by_user_id='test-admin', archived_reason='no_longer_reproduces',
      status='resolved', revalidation_evidence=$2, updated_at=NOW() WHERE id=$1`,
      [stale, JSON.stringify({ decision: "not_reproduced", reasons: ["asset hash gone"] })]);
    {
      const row = (await pool.query(`SELECT * FROM app_doctor_reports WHERE id=$1`, [stale])).rows[0];
      ok("stale: archived_at set, reason='no_longer_reproduces', actor recorded, status='resolved'",
        !!row.archived_at && row.archived_reason === "no_longer_reproduces" && row.archived_by_user_id === "test-admin" && row.status === "resolved");
    }
    ok("stale issue removed from the active window", await activeCount() === 2);
    ok("stale issue still present with ?includeArchived (row NOT deleted)", await totalCount() === 3);
    ok("stale issue readable via SELECT * (full history preserved)",
      (await pool.query(`SELECT id FROM app_doctor_reports WHERE id=$1`, [stale])).rowCount === 1);

    // (3) AI outage: recorded separately, issue stays active & valid
    await pool.query(`UPDATE app_doctor_reports SET revalidation_status='reproduced', last_seen_at=NOW(),
      ai_last_error='openai:gpt-4o-mini failed (timeout)', ai_last_error_at=NOW(),
      ai_summary='local rule-engine review', updated_at=NOW() WHERE id=$1`, [aiDown]);
    {
      const row = (await pool.query(`SELECT * FROM app_doctor_reports WHERE id=$1`, [aiDown])).rows[0];
      ok("ai-down: ai_last_error set, but revalidation_status still 'reproduced' and archived_at NULL",
        !!row.ai_last_error && row.revalidation_status === "reproduced" && row.archived_at === null);
      ok("ai-down: local review content is still usable (ai_summary present)", !!row.ai_summary);
    }
    ok("ai-down issue remains in the active window (AI outage never archives)", await activeCount() === 2);

    // active-window query shape used by GET /api/app-doctor/reports
    const windowIds = (await pool.query(
      `SELECT id FROM app_doctor_reports WHERE company_id=$1 AND (false OR archived_at IS NULL) ORDER BY created_at DESC`, [CO]
    )).rows.map((r: any) => r.id);
    ok("active window excludes the archived issue, includes the two live ones",
      windowIds.includes(stillValid) && windowIds.includes(aiDown) && !windowIds.includes(stale));
    const allIds = (await pool.query(
      `SELECT id FROM app_doctor_reports WHERE company_id=$1 AND (true OR archived_at IS NULL) ORDER BY created_at DESC`, [CO]
    )).rows.map((r: any) => r.id);
    ok("?includeArchived=true returns all 3", allIds.length === 3);
  } finally {
    for (const id of ids) await pool.query(`DELETE FROM app_doctor_reports WHERE id=$1`, [id]).catch(() => {});
    await pool.end();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
