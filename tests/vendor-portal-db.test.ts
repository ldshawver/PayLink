/**
 * PR 3 — vendor portal: real-Postgres invariants
 * (migrations/0021_vendor_portal.sql). Raw SQL only; does NOT boot the app. The
 * full HTTP flow (admin create vendor → invite → accept → vendor login → portal
 * scoping → admin review) runs as the staging synthetic acceptance.
 *
 * SAFETY: requires TEST_DATABASE_URL pointing at a disposable database. Refuses
 * staging/production-shaped names/hosts, verifies current_database() before any
 * write, never prints a URL, drops fixtures in finally. Skips (exit 0) when
 * TEST_DATABASE_URL is unset.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable npx tsx tests/vendor-portal-db.test.ts
 */
import { Pool } from "pg";
import assert from "node:assert/strict";
import fs from "node:fs";

const FORBIDDEN = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.log("SKIP: TEST_DATABASE_URL not set — PR 3 DB invariants not run (this is not a failure).");
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

  const cleanup: string[] = [];
  try {
    // identity_links is a PR 1 table — the vendor invite links into it. Create it
    // (and a users stub) if this disposable DB doesn't already have them.
    await pool.query(`CREATE TABLE IF NOT EXISTS users (id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), username TEXT, company_id VARCHAR, is_active BOOLEAN DEFAULT TRUE)`);
    const idl019 = fs.readFileSync("migrations/0019_identity_links_and_invites.sql", "utf8").split("-- ─────────────────────────────────────────────────────────────────────────────\n-- ROLLBACK")[0];
    await pool.query(idl019).catch(() => { /* parts may already exist / depend on users columns; the identity_links CREATE is what we need */ });
    await pool.query(`CREATE TABLE IF NOT EXISTS identity_links (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), user_id VARCHAR NOT NULL, subject_type TEXT NOT NULL,
      subject_id VARCHAR NOT NULL, company_id VARCHAR, link_status TEXT NOT NULL DEFAULT 'active',
      verified_email TEXT, linked_by_user_id VARCHAR, created_at TIMESTAMP DEFAULT NOW(), revoked_at TIMESTAMP)`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_identity_links_user_subject ON identity_links (user_id, subject_type, subject_id)`);

    const migration = fs.readFileSync("migrations/0021_vendor_portal.sql", "utf8").split("ROLLBACK")[0];
    await pool.query(migration);
    ok("migration 0021 is idempotent (re-run is a no-op)", await pool.query(migration).then(() => true).catch(() => false));

    for (const t of ["vendors", "vendor_documents", "vendor_invoices"]) {
      ok(`table ${t} exists`, (await pool.query(`SELECT to_regclass('public.${t}') t`)).rows[0].t === t);
    }
    ok("idx_vendor_invoices_company_status exists",
      (await pool.query(`SELECT indexname FROM pg_indexes WHERE indexname='idx_vendor_invoices_company_status'`)).rowCount === 1);

    const co = "zz-vp-co-" + Date.now();
    cleanup.push(`DELETE FROM vendors WHERE company_id = '${co}'`);
    cleanup.push(`DELETE FROM vendor_invoices WHERE company_id = '${co}'`);
    cleanup.push(`DELETE FROM vendor_documents WHERE company_id = '${co}'`);
    cleanup.push(`DELETE FROM identity_links WHERE company_id = '${co}'`);
    cleanup.push(`DELETE FROM users WHERE company_id = '${co}'`);

    // 1. vendors.status defaults to 'active'.
    const v1 = await pool.query(`INSERT INTO vendors (company_id, business_name) VALUES ($1,'Acme Supply') RETURNING id, status`, [co]);
    const v2 = await pool.query(`INSERT INTO vendors (company_id, business_name) VALUES ($1,'Beta Tools') RETURNING id`, [co]);
    ok("vendors.status defaults to 'active'", v1.rows[0].status === "active");

    // 2. vendor_invoices defaults: status 'submitted', currency 'USD', amount NULL stays NULL (never coerced to 0).
    const inv = await pool.query(
      `INSERT INTO vendor_invoices (vendor_id, company_id, invoice_number) VALUES ($1,$2,'INV-1') RETURNING id, status, currency, amount`,
      [v1.rows[0].id, co]);
    ok("vendor_invoices defaults: status='submitted', currency='USD', amount IS NULL",
      inv.rows[0].status === "submitted" && inv.rows[0].currency === "USD" && inv.rows[0].amount === null);

    const doc = await pool.query(
      `INSERT INTO vendor_documents (vendor_id, company_id, file_name, file_url, uploaded_by_user_id, notes)
       VALUES ($1,$2,'w9.pdf','/uploads/x.pdf','u-vendor','my upload note') RETURNING id, status, document_type`,
      [v1.rows[0].id, co]);
    ok("vendor_documents defaults: status='received', document_type='w9'",
      doc.rows[0].status === "received" && doc.rows[0].document_type === "w9");
    await pool.query(`UPDATE vendor_documents SET status='approved', review_note='ok', reviewed_by_user_id='u-admin', reviewed_at=NOW() WHERE id=$1`, [doc.rows[0].id]);
    ok("a document review leaves the vendor's own `notes` intact",
      (await pool.query(`SELECT notes, status, review_note FROM vendor_documents WHERE id=$1`, [doc.rows[0].id])).rows[0].notes === "my upload note");

    // 3. A review UPDATE writes ONLY vendor_invoices — vendors + vendor_documents counts unchanged.
    const before = {
      vendors: (await pool.query(`SELECT count(*)::int c FROM vendors WHERE company_id=$1`, [co])).rows[0].c,
      docs: (await pool.query(`SELECT count(*)::int c FROM vendor_documents WHERE company_id=$1`, [co])).rows[0].c,
    };
    await pool.query(`UPDATE vendor_invoices SET status='approved', reviewed_by_user_id='u-admin', reviewed_at=NOW() WHERE id=$1`, [inv.rows[0].id]);
    const after = {
      vendors: (await pool.query(`SELECT count(*)::int c FROM vendors WHERE company_id=$1`, [co])).rows[0].c,
      docs: (await pool.query(`SELECT count(*)::int c FROM vendor_documents WHERE company_id=$1`, [co])).rows[0].c,
      status: (await pool.query(`SELECT status FROM vendor_invoices WHERE id=$1`, [inv.rows[0].id])).rows[0].status,
    };
    ok("review sets vendor_invoices.status and touches nothing else",
      after.status === "approved" && after.vendors === before.vendors && after.docs === before.docs);

    // 4. identity_links accepts a 'vendor' subject, distinct from a 'worker' subject for the same user + id.
    const u = await pool.query(`INSERT INTO users (username, company_id) VALUES ('zz-vp-user','${co}'::varchar) RETURNING id`);
    const uid = u.rows[0].id;
    await pool.query(
      `INSERT INTO identity_links (user_id, subject_type, subject_id, company_id, link_status) VALUES ($1,'vendor',$2,$3,'active')`,
      [uid, v1.rows[0].id, co]);
    await pool.query(
      `INSERT INTO identity_links (user_id, subject_type, subject_id, company_id, link_status) VALUES ($1,'worker',$2,$3,'active')`,
      [uid, v1.rows[0].id, co]);
    ok("same user can hold a 'vendor' AND a 'worker' link for the same subject_id (subject_type is part of the key)",
      (await pool.query(`SELECT count(*)::int c FROM identity_links WHERE user_id=$1`, [uid])).rows[0].c === 2);
    let dup = false;
    try {
      await pool.query(
        `INSERT INTO identity_links (user_id, subject_type, subject_id, company_id, link_status) VALUES ($1,'vendor',$2,$3,'active')`,
        [uid, v1.rows[0].id, co]);
    } catch { dup = true; }
    ok("a duplicate (user, 'vendor', subject_id) link is rejected by uq_identity_links_user_subject", dup);

    // 5. Vendor-scoping: an invoice for vendor A is not visible under vendor B's id.
    ok("a vendor's invoices are isolated by vendor_id",
      (await pool.query(`SELECT count(*)::int c FROM vendor_invoices WHERE vendor_id=$1 AND company_id=$2`, [v2.rows[0].id, co])).rows[0].c === 0
      && (await pool.query(`SELECT count(*)::int c FROM vendor_invoices WHERE vendor_id=$1 AND company_id=$2`, [v1.rows[0].id, co])).rows[0].c === 1);

    // 6. company_id is NOT NULL on all three tables (a vendor row is always tenant-scoped).
    for (const t of ["vendors", "vendor_documents", "vendor_invoices"]) {
      ok(`${t}.company_id is NOT NULL`, (await pool.query(
        `SELECT is_nullable FROM information_schema.columns WHERE table_name='${t}' AND column_name='company_id'`
      )).rows[0].is_nullable === "NO");
    }
  } finally {
    for (const s of cleanup) await pool.query(s).catch(() => {});
    await pool.end();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
