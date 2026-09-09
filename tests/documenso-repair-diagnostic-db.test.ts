/**
 * Documenso contract diagnostic — real-Postgres invariant.
 *
 * An email-less contract_signers row (the legacy "No email" placeholder) must
 * NOT count toward the diagnostic's recipient totals, so a contract whose real
 * recipients all have documenso_recipient_id set is reported healthy — not
 * "recipient IDs missing / sync_recipients".
 *
 * SAFETY: requires TEST_DATABASE_URL pointing at a disposable database. Refuses
 * staging/production-shaped names/hosts, verifies current_database() before any
 * write, drops fixtures in finally, never prints a URL. Skips (exit 0) when
 * TEST_DATABASE_URL is unset.
 *
 * Run: TEST_DATABASE_URL=postgresql://user:pass@host:port/disposable npx tsx tests/documenso-repair-diagnostic-db.test.ts
 */
import { Pool } from "pg";
import assert from "node:assert/strict";

const FORBIDDEN = [/staging/i, /production/i, /^prod$/i, /apppaylinkstaging/i, /apppaylinkmain/i];

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) { console.log("SKIP: TEST_DATABASE_URL not set (not a failure)."); process.exit(0); }
  const parsed = new URL(url);
  const dbName = parsed.pathname.replace(/^\//, "");
  for (const p of FORBIDDEN) if (p.test(dbName) || p.test(parsed.hostname)) throw new Error("Refusing staging/production-shaped DB.");
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) throw new Error("TEST_DATABASE_URL equals this process's DATABASE_URL.");

  const pool = new Pool({ connectionString: url, max: 4 });
  assert.equal((await pool.query("SELECT current_database() d")).rows[0].d, dbName);

  let pass = 0, fail = 0;
  const ok = (n: string, c: boolean) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`); } };
  const CID = "zzc-doc-repair";

  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS contractor_contracts (id VARCHAR PRIMARY KEY, company_id VARCHAR)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS contract_signers (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), contract_id VARCHAR, company_id VARCHAR,
      email TEXT, status TEXT, documenso_recipient_id TEXT, documenso_signing_url TEXT)`);
    await pool.query(`DELETE FROM contract_signers WHERE contract_id=$1`, [CID]);
    await pool.query(`DELETE FROM contractor_contracts WHERE id=$1`, [CID]);
    await pool.query(`INSERT INTO contractor_contracts (id, company_id) VALUES ($1,'co1')`, [CID]);

    // 2 real recipients (with recipient ids) + 1 email-less placeholder + 1 canceled
    await pool.query(`INSERT INTO contract_signers (contract_id, company_id, email, status, documenso_recipient_id, documenso_signing_url) VALUES
      ($1,'co1','a@x.com','signed','66','https://d/sign/a'),
      ($1,'co1','b@x.com','signed','67','https://d/sign/b'),
      ($1,'co1',NULL,'signed',NULL,NULL),
      ($1,'co1','','signed',NULL,NULL),
      ($1,'co1','c@x.com','canceled','68','https://d/sign/c')`, [CID]);

    // OLD join (bug): counts email-less rows
    const oldRow = (await pool.query(`
      SELECT COUNT(cs.id)::int lrc, COUNT(cs.id) FILTER (WHERE cs.documenso_recipient_id IS NOT NULL)::int lric
      FROM contractor_contracts c
      LEFT JOIN contract_signers cs ON cs.contract_id=c.id AND cs.status NOT IN ('canceled','cancelled','replaced')
      WHERE c.id=$1 GROUP BY c.id`, [CID])).rows[0];
    ok("(regression witness) old join: recipient_count=4, id_count=2 → recipientIdsExist=false",
      oldRow.lrc === 4 && oldRow.lric === 2 && !(oldRow.lrc > 0 && oldRow.lric >= oldRow.lrc));

    // NEW join (fix): email IS NOT NULL AND btrim(email) <> ''
    const newRow = (await pool.query(`
      SELECT COUNT(cs.id)::int lrc, COUNT(cs.id) FILTER (WHERE cs.documenso_recipient_id IS NOT NULL)::int lric
      FROM contractor_contracts c
      LEFT JOIN contract_signers cs ON cs.contract_id=c.id
        AND cs.status NOT IN ('canceled','cancelled','replaced')
        AND cs.email IS NOT NULL AND btrim(cs.email) <> ''
      WHERE c.id=$1 GROUP BY c.id`, [CID])).rows[0];
    ok("new join: recipient_count=2 (email-less rows excluded), id_count=2",
      newRow.lrc === 2 && newRow.lric === 2);
    ok("new join → recipientIdsExist=true (no false 'sync_recipients' repair flag)",
      newRow.lrc > 0 && newRow.lric >= newRow.lrc);
    ok("canceled signer still excluded by the status filter", newRow.lrc === 2);
  } finally {
    await pool.query(`DELETE FROM contract_signers WHERE contract_id=$1`, [CID]).catch(() => {});
    await pool.query(`DELETE FROM contractor_contracts WHERE id=$1`, [CID]).catch(() => {});
    await pool.end();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
