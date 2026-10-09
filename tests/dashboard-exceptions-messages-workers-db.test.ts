/**
 * Real-HTTP regression test for two pre-existing 500s found during the SaaS PR 2B
 * staging browser acceptance (present on v2.2.15 / d07a21d, not caused by #166):
 *
 *  1. GET /api/dashboard/exceptions 500'd for every manager/admin: the break-
 *     violation queries wrote `INTERVAL '${breakThresholdMinutes} minutes'`. A
 *     drizzle `${}` inside a quoted SQL literal is not a bind placeholder, so
 *     Postgres saw one fewer parameter than was bound (08P01 "bind message
 *     supplies 3 parameters, but prepared statement requires 1"). Now
 *     make_interval(mins => $n).
 *  2. GET /api/messages/workers 500'd for every caller: the recipient_type CASE
 *     compared the worker_type enum {employee, contractor} to literals outside the
 *     enum ('independent_contractor', 'vendor') → "invalid input value for enum".
 *     Now compared as text, and the real 'contractor' value maps to "Contractor".
 *
 * The fixture includes an open break (break_start 2h ago, no break_end) so the
 * fixed interval clause is actually executed and must return the violation, plus
 * a second company whose worker must never appear (scoping unchanged).
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable_db npx tsx tests/dashboard-exceptions-messages-workers-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { startTestServer, login, apiRequest, type TestServer } from "../scripts/cross-tenant-negative-tests/server-harness";
import { cascadeDelete, verifyZeroResidue } from "../scripts/cross-tenant-negative-tests/cascade-cleanup";

const FORBIDDEN_PATTERNS = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) { console.log(`  ✓  ${name}`); passed++; }
  else { console.error(`  ✗  ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
};

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.log("TEST_DATABASE_URL not set — skipping dashboard-exceptions/messages-workers tests (0 run).");
    return;
  }
  for (const p of FORBIDDEN_PATTERNS) if (p.test(url)) throw new Error("TEST_DATABASE_URL looks like staging/production. Refusing to run.");
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) throw new Error("TEST_DATABASE_URL is identical to DATABASE_URL. Refusing.");

  const pool = new Pool({ connectionString: url, max: 4 });
  const q = (s: string, p: any[] = []) => pool.query(s, p);
  const dbName = (await q("SELECT current_database() AS n")).rows[0]?.n as string;
  if (FORBIDDEN_PATTERNS.some((p) => p.test(dbName))) throw new Error(`current_database()="${dbName}" looks protected. Refusing.`);

  const sfx = crypto.randomBytes(4).toString("hex");
  const uid = () => crypto.randomUUID();
  const [C, X] = [uid(), uid()];
  const [empW, conW, otherW] = [uid(), uid(), uid()];
  const users = { admin: uid(), emp: uid() };
  let server: TestServer | undefined;

  try {
    await q(`INSERT INTO companies (id,name,subscription_status,is_demo) VALUES ($1,$2,'active_paid',false),($3,$4,'active_paid',false)`,
      [C, `ZZDX Co ${sfx}`, X, `ZZDX Other ${sfx}`]);
    const mkWorker = (id: string, co: string, last: string, type: string, num: string) =>
      q(`INSERT INTO workers (id,company_id,first_name,last_name,worker_type,pay_rate,pay_type,employee_number,is_active)
         VALUES ($1,$2,'ZZDX',$3,$4,'20.00','hourly',$5,true)`, [id, co, last, type, num]);
    await mkWorker(empW, C, `Emp-${sfx}`, "employee", `ZZDXE${sfx}`);
    await mkWorker(conW, C, `Con-${sfx}`, "contractor", `ZZDXC${sfx}`);
    await mkWorker(otherW, X, `Other-${sfx}`, "employee", `ZZDXO${sfx}`);
    const pw = await bcrypt.hash("Dx!Synthetic", 10);
    await q(`INSERT INTO users (id,username,password,role,company_id,worker_id,is_active) VALUES
      ($1,$2,$3,'admin',$4,NULL,true),($5,$6,$3,'employee',$4,$7,true)`,
      [users.admin, `dx_admin_${sfx}`, pw, C, users.emp, `dx_emp_${sfx}`, empW]);
    // Open break: break_start 2 hours ago, no break_end → a >60 min break violation.
    const punch = uid();
    await q(`INSERT INTO time_punches (id,worker_id,company_id,punch_type,punch_time) VALUES ($1,$2,$3,'break_start', NOW() - INTERVAL '2 hours')`, [punch, empW, C]);

    server = await startTestServer(url);
    const base = server.baseUrl;
    const admin = await login(base, `dx_admin_${sfx}`, "Dx!Synthetic");
    const emp = await login(base, `dx_emp_${sfx}`, "Dx!Synthetic");

    console.log("\n── GET /api/dashboard/exceptions ──");
    let r = await apiRequest(base, "GET", "/api/dashboard/exceptions", admin);
    check("admin → 200 (was 500: 08P01 bind count)", r.status === 200 && Array.isArray(r.body), `status=${r.status}`);
    const items = Array.isArray(r.body) ? (r.body as any[]) : [];
    check("admin sees the open >60 min break as a violation", items.some((i) => i.id === `bv-${punch}` && i.exceptionType === "Break violation (>60 min)"));
    check("admin never sees the other company's worker", !JSON.stringify(items).includes(`Other-${sfx}`));
    r = await apiRequest(base, "GET", "/api/dashboard/exceptions", emp);
    check("employee → 200", r.status === 200 && Array.isArray(r.body), `status=${r.status}`);

    console.log("\n── GET /api/messages/workers ──");
    r = await apiRequest(base, "GET", "/api/messages/workers", admin);
    check("admin → 200 (was 500: invalid input value for enum worker_type)", r.status === 200 && Array.isArray(r.body), `status=${r.status}`);
    const rows = Array.isArray(r.body) ? (r.body as any[]) : [];
    check("contractor labelled Contractor", rows.find((w) => w.id === conW)?.recipient_type === "Contractor", JSON.stringify(rows.find((w) => w.id === conW)));
    check("employee labelled Employee", rows.find((w) => w.id === empW)?.recipient_type === "Employee");
    check("other company's worker not listed", !rows.some((w) => w.id === otherW));
    r = await apiRequest(base, "GET", "/api/messages/workers", emp);
    const er = Array.isArray(r.body) ? (r.body as any[]) : [];
    check("employee → 200, excludes self, includes coworker contractor", r.status === 200 && !er.some((w) => w.id === empW) && er.some((w) => w.id === conW), `status=${r.status}`);
  } finally {
    if (server) await server.stop().catch(() => {});
    try {
      await q(`DELETE FROM session WHERE sess->>'userId' = ANY($1::varchar[])`, [Object.values(users)]).catch(() => {});
      await q(`DELETE FROM users WHERE id = ANY($1::varchar[])`, [Object.values(users)]);
      await cascadeDelete(pool, "companies", [C, X]);
      const residue = await verifyZeroResidue(pool, "companies", [C, X]);
      if (residue.length) { console.error("CLEANUP RESIDUE:", residue.join("; ")); failed++; }
      else console.log("\ncleanup: zero residue confirmed");
    } catch (e) {
      console.error("cleanup error:", (e as Error).message);
      failed++;
    }
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
