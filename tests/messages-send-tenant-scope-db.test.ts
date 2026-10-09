/**
 * Real-HTTP regression test: POST /api/messages tenant scoping.
 *
 * Before: any tenant admin/manager/supervisor could send scope "sitewide" (every
 * worker on the platform, every tenant, by email/SMS when chosen), and any sender
 * could address scope "one" to an arbitrary worker id in another tenant. The
 * message row was also written before the recipient was validated.
 *
 * After: a non-platform sender only reaches its own company, companies it is
 * granted, and contractors linked to its company by proposal/contract/invoice
 * (the GET /api/messages/workers set). "sitewide" is refused for company
 * accounts; a company-less tenant role cannot send. Rejected sends write nothing.
 *
 * Every send here uses deliveryChannel "app" — no email or SMS is attempted.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable_db npx tsx tests/messages-send-tenant-scope-db.test.ts
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
    console.log("TEST_DATABASE_URL not set — skipping messages send tenant-scope tests (0 run).");
    return;
  }
  for (const p of FORBIDDEN_PATTERNS) if (p.test(url)) throw new Error("TEST_DATABASE_URL looks like staging/production. Refusing to run.");
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) throw new Error("TEST_DATABASE_URL is identical to DATABASE_URL. Refusing.");

  const pool = new Pool({ connectionString: url, max: 4 });
  const q = (s: string, p: any[] = []) => pool.query(s, p);
  const dbName = (await q("SELECT current_database() AS n")).rows[0]?.n as string;
  if (FORBIDDEN_PATTERNS.some((p) => p.test(dbName))) throw new Error(`current_database()="${dbName}" looks protected. Refusing.`);

  const sfx = crypto.randomBytes(4).toString("hex");
  const tag = `ZZMSG-${sfx}`;
  const uid = () => crypto.randomUUID();
  const [C, X] = [uid(), uid()];
  // empC/coC: company C; linkedX: contractor homed in X but under contract with C; otherX: X only.
  const [empC, coC, linkedX, otherX] = [uid(), uid(), uid(), uid()];
  const users = { admin: uid(), emp: uid(), noco: uid(), plat: uid() };
  let server: TestServer | undefined;

  const msgCount = async (subject: string) =>
    Number((await q(`SELECT count(*)::int AS n FROM staff_messages WHERE subject = $1`, [subject])).rows[0].n);
  const recipientsOf = async (subject: string) =>
    (await q(`SELECT r.worker_id FROM staff_message_recipients r JOIN staff_messages m ON m.id = r.message_id WHERE m.subject = $1`, [subject])).rows.map((r) => r.worker_id as string);

  try {
    await q(`INSERT INTO companies (id,name,subscription_status,is_demo) VALUES ($1,$2,'active_paid',false),($3,$4,'active_paid',false)`,
      [C, `ZZMSG Co ${sfx}`, X, `ZZMSG Other ${sfx}`]);
    const mkWorker = (id: string, co: string, last: string, type: string) =>
      q(`INSERT INTO workers (id,company_id,first_name,last_name,worker_type,pay_rate,pay_type,employee_number,is_active)
         VALUES ($1,$2,'ZZMSG',$3,$4,'20.00','hourly',$5,true)`, [id, co, `${last}-${sfx}`, type, `ZZM${last.slice(0, 3)}${sfx}`]);
    await mkWorker(empC, C, "EmpC", "employee");
    await mkWorker(coC, C, "CoworkerC", "employee");
    await mkWorker(linkedX, X, "LinkedX", "contractor");
    await mkWorker(otherX, X, "OtherX", "employee");
    await q(`INSERT INTO contractor_contracts (id,company_id,contractor_id,title) VALUES ($1,$2,$3,$4)`, [uid(), C, linkedX, `${tag} contract`]);
    const pw = await bcrypt.hash("Msg!Synthetic", 10);
    await q(`INSERT INTO users (id,username,password,role,company_id,worker_id,is_active) VALUES
      ($1,$2,$3,'admin',$4,NULL,true),($5,$6,$3,'employee',$4,$7,true),
      ($8,$9,$3,'admin',NULL,NULL,true),($10,$11,$3,'platform_admin',NULL,NULL,true)`,
      [users.admin, `msg_admin_${sfx}`, pw, C, users.emp, `msg_emp_${sfx}`, empC,
       users.noco, `msg_noco_${sfx}`, users.plat, `msg_plat_${sfx}`]);

    server = await startTestServer(url);
    const base = server.baseUrl;
    const admin = await login(base, `msg_admin_${sfx}`, "Msg!Synthetic");
    const emp = await login(base, `msg_emp_${sfx}`, "Msg!Synthetic");
    const noco = await login(base, `msg_noco_${sfx}`, "Msg!Synthetic");
    const plat = await login(base, `msg_plat_${sfx}`, "Msg!Synthetic");
    const send = (s: any, scope: string, subject: string, extra: Record<string, unknown> = {}) =>
      apiRequest(base, "POST", "/api/messages", s, { subject, body: "synthetic", scope, deliveryChannel: "app", ...extra });

    console.log("\n── tenant admin ──");
    let subj = `${tag} sitewide`;
    let r = await send(admin, "sitewide", subj);
    check("admin sitewide → 403", r.status === 403, `status=${r.status}`);
    check("admin sitewide wrote no message", (await msgCount(subj)) === 0);

    subj = `${tag} foreign company`;
    r = await send(admin, "company", subj, { companyId: X });
    check("admin company=X (foreign) → 403", r.status === 403, `status=${r.status}`);
    check("foreign company send wrote no message", (await msgCount(subj)) === 0);

    subj = `${tag} own company`;
    r = await send(admin, "company", subj);
    let rc = await recipientsOf(subj);
    check("admin own company → 200, recipients only company C",
      r.status === 200 && rc.includes(empC) && rc.includes(coC) && !rc.includes(otherX) && !rc.includes(linkedX), `status=${r.status} rc=${rc.length}`);

    subj = `${tag} one foreign`;
    r = await send(admin, "one", subj, { recipientWorkerId: otherX });
    check("admin one → other tenant's worker → 404", r.status === 404, `status=${r.status}`);
    check("rejected one-to-one wrote no message", (await msgCount(subj)) === 0);

    subj = `${tag} one own`;
    r = await send(admin, "one", subj, { recipientWorkerId: empC });
    check("admin one → own worker → 200", r.status === 200 && (await recipientsOf(subj)).includes(empC), `status=${r.status}`);

    subj = `${tag} one linked`;
    r = await send(admin, "one", subj, { recipientWorkerId: linkedX });
    check("admin one → contractor under contract with C → 200", r.status === 200 && (await recipientsOf(subj)).includes(linkedX), `status=${r.status}`);

    subj = `${tag} one missing`;
    r = await send(admin, "one", subj, { recipientWorkerId: uid() });
    check("admin one → unknown worker id → 404, no message", r.status === 404 && (await msgCount(subj)) === 0, `status=${r.status}`);

    console.log("\n── employee ──");
    subj = `${tag} emp foreign`;
    r = await send(emp, "one", subj, { recipientWorkerId: otherX });
    check("employee one → other tenant's worker → 404, no message", r.status === 404 && (await msgCount(subj)) === 0, `status=${r.status}`);
    subj = `${tag} emp coworker`;
    r = await send(emp, "one", subj, { recipientWorkerId: coC });
    check("employee one → coworker → 200", r.status === 200 && (await recipientsOf(subj)).includes(coC), `status=${r.status}`);
    subj = `${tag} emp sitewide`;
    r = await send(emp, "sitewide", subj);
    check("employee sitewide → 403, no message", r.status === 403 && (await msgCount(subj)) === 0, `status=${r.status}`);

    console.log("\n── company-less / platform ──");
    subj = `${tag} noco`;
    r = await send(noco, "one", subj, { recipientWorkerId: empC });
    check("company-less admin one → 403, no message", r.status === 403 && (await msgCount(subj)) === 0, `status=${r.status}`);
    subj = `${tag} plat`;
    r = await send(plat, "one", subj, { recipientWorkerId: otherX });
    check("platform_admin one → any tenant's worker → 200", r.status === 200 && (await recipientsOf(subj)).includes(otherX), `status=${r.status}`);
  } finally {
    if (server) await server.stop().catch(() => {});
    try {
      await q(`DELETE FROM staff_message_recipients WHERE message_id IN (SELECT id FROM staff_messages WHERE subject LIKE $1)`, [`${tag}%`]);
      await q(`DELETE FROM staff_messages WHERE subject LIKE $1`, [`${tag}%`]);
      await q(`DELETE FROM session WHERE sess->>'userId' = ANY($1::varchar[])`, [Object.values(users)]).catch(() => {});
      await q(`DELETE FROM users WHERE id = ANY($1::varchar[])`, [Object.values(users)]);
      await cascadeDelete(pool, "companies", [C, X]);
      const residue = await verifyZeroResidue(pool, "companies", [C, X]);
      const left = Number((await q(`SELECT count(*)::int AS n FROM staff_messages WHERE subject LIKE $1`, [`${tag}%`])).rows[0].n);
      if (residue.length || left) { console.error("CLEANUP RESIDUE:", residue.join("; "), `staff_messages=${left}`); failed++; }
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
