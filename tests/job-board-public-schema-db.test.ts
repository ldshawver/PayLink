/**
 * Migration 0030 (job board public access) — real-Postgres constraint tests.
 * Requires TEST_DATABASE_URL (disposable DB, app-table owner, 0029 applied or
 * applied here). Refuses staging/production-shaped names; removes fixtures.
 * Run: TEST_DATABASE_URL=… npx tsx tests/job-board-public-schema-db.test.ts
 */
import { Pool } from "pg";
import crypto from "node:crypto";
import fs from "node:fs";

const FORBIDDEN = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i, /^paylinkapp$/i];
const strip = (f: string) => fs.readFileSync(f, "utf8").split("\n").filter((l) => !l.startsWith("\\")).join("\n");

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) { console.log("SKIP: TEST_DATABASE_URL not set — 0030 DB tests not run (this is not a failure)."); process.exit(0); }
  const u = new URL(url); const dbName = u.pathname.slice(1);
  for (const p of FORBIDDEN) if (p.test(dbName) || p.test(u.hostname)) throw new Error("Refusing to run against a staging/production-shaped database.");
  const pool = new Pool({ connectionString: url, max: 4 });
  if ((await pool.query("SELECT current_database() d")).rows[0].d !== dbName) throw new Error("database mismatch");

  let pass = 0, fail = 0;
  const ok = (n: string, c: unknown) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`); } };
  const rejects = async (n: string, q: string, p: unknown[] = []) => {
    let threw = false; try { await pool.query(q, p); } catch { threw = true; } ok(n, threw);
  };
  const id = () => crypto.randomUUID();
  const h = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
  const co = id(), coB = id(), tenant = id(), admin = id();
  const sfx = crypto.randomBytes(3).toString("hex");

  try {
    if (!(await pool.query("SELECT to_regclass('public.job_posts') r")).rows[0].r) await pool.query(strip("migrations/0029_job_board.sql"));
    await pool.query(strip("migrations/0030_job_board_public_access.sql"));
    ok("0030 applies", true);
    ok("0030 re-applies as a no-op", await pool.query(strip("migrations/0030_job_board_public_access.sql")).then(() => true).catch((e) => { console.error(e.message); return false; }));
    ok("ledger has exactly one '0030' row", (await pool.query(`SELECT count(*)::int c FROM paylink_migrations.applied WHERE version='0030'`)).rows[0].c === 1);

    for (const [c, n] of [[co, "A"], [coB, "B"]]) await pool.query(`INSERT INTO companies (id, name, subscription_status) VALUES ($1,$2,'active')`, [c, `ZZ 0030 ${n} ${sfx}`]);
    const post = (cls: string) => pool.query(
      `INSERT INTO job_posts (tenant_id, company_id, created_by_user_id, classification_declared_by_user_id, worker_classification, opportunity_type, schedule_type, employment_type, title, number_of_openings)
       VALUES ($1,$2,$3,$3,$4,$5,$6,$7,'ZZ 0030',1) RETURNING id, public_visibility, public_description, public_show_compensation`,
      [tenant, co, admin, cls, cls === "employee" ? "position" : "project", cls === "employee" ? "full_time" : "one_time", cls === "employee" ? "full_time" : null]);
    const emp = (await post("employee")).rows[0]; const con = (await post("contractor")).rows[0];
    ok("new postings default to NULL public visibility (= access_required) and no public fields", emp.public_visibility === null && emp.public_description === null && emp.public_show_compensation === null);
    await rejects("public_visibility rejects unknown values", `UPDATE job_posts SET public_visibility='everyone' WHERE id=$1`, [emp.id]);
    await pool.query(`UPDATE job_posts SET public_visibility='public' WHERE id=$1`, [emp.id]);
    ok("public_visibility accepts 'public'", true);

    // Settings + discovery code
    await pool.query(`INSERT INTO job_board_settings (tenant_id, company_id, code_lookup_hash, code_hint) VALUES ($1,$2,$3,'K7Q')`, [tenant, co, h(`code-${sfx}`)]);
    ok("board defaults to disabled with requests closed", (await pool.query(`SELECT board_enabled, accept_contractor_requests, accept_applicant_requests FROM job_board_settings WHERE company_id=$1`, [co])).rows
      .every((r: any) => !r.board_enabled && !r.accept_contractor_requests && !r.accept_applicant_requests));
    await rejects("one settings row per company", `INSERT INTO job_board_settings (tenant_id, company_id) VALUES ($1,$2)`, [tenant, co]);
    await rejects("a discovery code maps to one company only", `INSERT INTO job_board_settings (tenant_id, company_id, code_lookup_hash, code_hint) VALUES ($1,$2,$3,'K7Q')`, [tenant, coB, h(`code-${sfx}`)]);
    await rejects("plaintext code is not accepted as a lookup hash", `INSERT INTO job_board_settings (tenant_id, company_id, code_lookup_hash, code_hint) VALUES ($1,$2,'ACME-2026','026')`, [tenant, coB]);
    await rejects("hash and hint must be set together", `INSERT INTO job_board_settings (tenant_id, company_id, code_lookup_hash) VALUES ($1,$2,$3)`, [tenant, coB, h("x" + sfx)]);
    await rejects("tenant_id is mandatory", `INSERT INTO job_board_settings (company_id) VALUES ($1)`, [coB]);
    await rejects("brand colour must be #RRGGBB", `INSERT INTO job_board_settings (tenant_id, company_id, brand_color) VALUES ($1,$2,'red; x')`, [tenant, coB]);

    // Applicants
    const email = `zz-${sfx}@example.invalid`;
    const ap = (await pool.query(`INSERT INTO job_applicants (tenant_id, company_id, email_normalized, first_name, last_name) VALUES ($1,$2,$3,'ZZ','Applicant') RETURNING id, status`, [tenant, co, email])).rows[0];
    ok("applicant starts pending_activation", ap.status === "pending_activation");
    await rejects("one applicant identity per email per company", `INSERT INTO job_applicants (tenant_id, company_id, email_normalized) VALUES ($1,$2,$3)`, [tenant, co, email]);
    await pool.query(`INSERT INTO job_applicants (tenant_id, company_id, email_normalized) VALUES ($1,$2,$3)`, [tenant, coB, email]);
    ok("the same email may exist in another company (scoped, non-global)", true);
    await rejects("email must be stored normalized (lower-case)", `INSERT INTO job_applicants (tenant_id, company_id, email_normalized) VALUES ($1,$2,'ZZ-Upper@Example.invalid')`, [tenant, co]);
    await rejects("cannot activate without a verified email + user", `UPDATE job_applicants SET status='active' WHERE id=$1`, [ap.id]);
    await rejects("status rejects unknown values", `UPDATE job_applicants SET status='employee' WHERE id=$1`, [ap.id]);

    // Access requests
    const req = (kind: string, e = email) => pool.query(
      `INSERT INTO job_board_access_requests (tenant_id, company_id, request_kind, email_normalized, first_name, last_name, source_ip_hash) VALUES ($1,$2,$3,$4,'ZZ','Req',$5) RETURNING id`,
      [tenant, co, kind, e, h("127.0.0.1")]);
    const r1 = (await req("applicant")).rows[0];
    await rejects("one pending request per email + kind per company", `INSERT INTO job_board_access_requests (tenant_id, company_id, request_kind, email_normalized, first_name, last_name) VALUES ($1,$2,'applicant',$3,'a','b')`, [tenant, co, email]);
    await req("contractor");
    ok("a contractor request for the same email is a separate lifecycle", true);
    await rejects("approved/denied requires reviewed_at", `UPDATE job_board_access_requests SET status='approved' WHERE id=$1`, [r1.id]);
    await pool.query(`UPDATE job_board_access_requests SET status='denied', reviewed_at=now(), reviewed_by_user_id=$2 WHERE id=$1`, [r1.id, admin]);
    await req("applicant");
    ok("after a decision, a new pending request is allowed", true);
    await rejects("an applicant request cannot link a contractor access request", `UPDATE job_board_access_requests SET contractor_access_request_id='x' WHERE id=$1`, [r1.id]);
    await rejects("request_kind rejects unknown kinds", `INSERT INTO job_board_access_requests (tenant_id, company_id, request_kind, email_normalized, first_name, last_name) VALUES ($1,$2,'employee',$3,'a','b')`, [tenant, co, `x${sfx}@example.invalid`]);

    // Invitations
    const tok = h(`token-${sfx}`);
    const inv = (await pool.query(
      `INSERT INTO job_board_invitations (tenant_id, company_id, purpose, applicant_id, email_normalized, token_hash, expires_at) VALUES ($1,$2,'applicant_activation',$3,$4,$5, now() + interval '2 days') RETURNING id`,
      [tenant, co, ap.id, email, tok])).rows[0];
    await rejects("token hashes are unique", `INSERT INTO job_board_invitations (tenant_id, company_id, purpose, email_normalized, token_hash, expires_at) VALUES ($1,$2,'posting_invitation',$3,$4, now() + interval '1 day')`, [tenant, co, email, tok]);
    await rejects("only one live activation token per applicant", `INSERT INTO job_board_invitations (tenant_id, company_id, purpose, applicant_id, email_normalized, token_hash, expires_at) VALUES ($1,$2,'applicant_activation',$3,$4,$5, now() + interval '1 day')`, [tenant, co, ap.id, email, h("t2" + sfx)]);
    await rejects("a plaintext token is not accepted", `INSERT INTO job_board_invitations (tenant_id, company_id, purpose, email_normalized, token_hash, expires_at) VALUES ($1,$2,'posting_invitation',$3,'abc', now() + interval '1 day')`, [tenant, co, email]);
    await rejects("expiry must be after creation", `INSERT INTO job_board_invitations (tenant_id, company_id, purpose, email_normalized, token_hash, expires_at) VALUES ($1,$2,'posting_invitation',$3,$4, now() - interval '1 minute')`, [tenant, co, email, h("t3" + sfx)]);
    await pool.query(`UPDATE job_board_invitations SET consumed_at = now() WHERE id=$1`, [inv.id]);
    await rejects("a consumed token cannot also be revoked", `UPDATE job_board_invitations SET revoked_at = now() WHERE id=$1`, [inv.id]);
    await pool.query(`INSERT INTO job_board_invitations (tenant_id, company_id, purpose, applicant_id, email_normalized, token_hash, expires_at) VALUES ($1,$2,'applicant_activation',$3,$4,$5, now() + interval '1 day')`, [tenant, co, ap.id, email, h("t4" + sfx)]);
    ok("after consumption, a new activation token may be issued", true);

    // Grants
    await pool.query(`INSERT INTO job_post_access_grants (tenant_id, company_id, job_post_id, applicant_id, grant_source) VALUES ($1,$2,$3,$4,'access_approval')`, [tenant, co, emp.id, ap.id]);
    await rejects("one active grant per applicant per posting", `INSERT INTO job_post_access_grants (tenant_id, company_id, job_post_id, applicant_id, grant_source) VALUES ($1,$2,$3,$4,'invitation')`, [tenant, co, emp.id, ap.id]);
    await rejects("applicant grants cannot reference contractor postings (trigger)", `INSERT INTO job_post_access_grants (tenant_id, company_id, job_post_id, applicant_id, grant_source) VALUES ($1,$2,$3,$4,'invitation')`, [tenant, co, con.id, ap.id]);
    await pool.query(`UPDATE job_post_access_grants SET revoked_at = now() WHERE job_post_id=$1 AND applicant_id=$2`, [emp.id, ap.id]);
    await pool.query(`INSERT INTO job_post_access_grants (tenant_id, company_id, job_post_id, applicant_id, grant_source) VALUES ($1,$2,$3,$4,'invitation')`, [tenant, co, emp.id, ap.id]);
    ok("after revocation, a new grant may be issued", true);

    // Applications link + audit
    ok("employment_applications.applicant_id exists and is nullable",
      (await pool.query(`SELECT is_nullable FROM information_schema.columns WHERE table_name='employment_applications' AND column_name='applicant_id'`)).rows[0]?.is_nullable === "YES");
    await pool.query(`INSERT INTO job_board_access_events (tenant_id, company_id, event_type, applicant_id, actor_user_id) VALUES ($1,$2,'access_request_denied',$3,$4)`, [tenant, co, ap.id, admin]);
    await rejects("access events are immutable (UPDATE blocked)", `UPDATE job_board_access_events SET event_type='x' WHERE company_id=$1`, [co]);
  } finally {
    const q = (s: string) => pool.query(s, [[co, coB]]).catch((e) => console.error("cleanup:", e.message));
    for (const tbl of ["job_board_access_events", "job_post_access_grants", "job_board_invitations", "job_board_access_requests", "job_applicants", "job_board_settings", "job_post_events", "job_posts"]) {
      await q(`DELETE FROM ${tbl} WHERE company_id = ANY($1::varchar[])`);
    }
    await q(`DELETE FROM companies WHERE id = ANY($1::varchar[])`);
    const left = (await pool.query(`SELECT (SELECT count(*) FROM companies WHERE id = ANY($1::varchar[])) + (SELECT count(*) FROM job_applicants WHERE company_id = ANY($1::varchar[])) AS n`, [[co, coB]])).rows[0].n;
    console.log(`cleanup: ${Number(left) === 0 ? "zero residue" : "RESIDUE " + left}`);
    await pool.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
