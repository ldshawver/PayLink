/**
 * Migration 0030 (job board public access) — static guards. No DB.
 * Run: npx tsx tests/job-board-public-schema-static.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const sql = fs.readFileSync("migrations/0030_job_board_public_access.sql", "utf8");
const schema = fs.readFileSync("shared/schema.ts", "utf8");
const code = sql.replace(/--.*$/gm, "");

let pass = 0, fail = 0;
function t(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); } catch (e) { fail++; console.error(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

t("one transaction, owner guard, requires 0029, ledger '0030'", () => {
  assert.ok(/^BEGIN;/m.test(code) && /^COMMIT;/m.test(code));
  assert.ok(/IF app_owner <> current_user THEN/.test(code));
  assert.ok(/requires migration 0029/.test(code));
  assert.ok(/INSERT INTO paylink_migrations\.applied[\s\S]*'0030'[\s\S]*ON CONFLICT \(version\) DO NOTHING/.test(code));
});
t("additive only: no DROP TABLE/COLUMN/INDEX, DELETE, TRUNCATE, RENAME, UPDATE of existing rows", () => {
  assert.ok(!/\bDROP\s+(TABLE|COLUMN|INDEX|SCHEMA|FUNCTION|CONSTRAINT)\b/i.test(code));
  assert.ok(!/\bDELETE\s+FROM\b|\bTRUNCATE\b|\bRENAME\b/i.test(code));
  assert.ok(!/^\s*UPDATE\s+/im.test(code), "no data rewrite");
  for (const d of code.match(/\bDROP\s+\w+[^;]*;/gi) ?? []) assert.ok(/^DROP TRIGGER IF EXISTS trg_/i.test(d.trim()), d);
});
t("rerunnable: every CREATE/ALTER is IF NOT EXISTS (constraint add is guarded)", () => {
  for (const m of code.match(/CREATE (UNIQUE )?INDEX[^;]*/g) ?? []) assert.ok(/IF NOT EXISTS/.test(m), m);
  for (const m of code.match(/CREATE TABLE[^(]*/g) ?? []) assert.ok(/IF NOT EXISTS/.test(m), m);
  for (const m of code.match(/ALTER TABLE \w+ ADD COLUMN[^;]*/g) ?? []) assert.ok(/IF NOT EXISTS/.test(m), m);
  assert.ok(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = 'ck_job_posts_public_visibility'\)/.test(code));
});
t("new columns on existing tables are NULLable with no default (no row rewrite)", () => {
  for (const m of code.match(/ALTER TABLE (job_posts|employment_applications) ADD COLUMN IF NOT EXISTS [^;]*/g) ?? []) {
    assert.ok(!/NOT NULL|DEFAULT/i.test(m), m);
  }
});
t("does not duplicate 0029 tables", () => {
  for (const tbl of ["employment_applications", "employment_application_answers", "employment_application_events", "employment_application_documents", "contractor_job_invitations"]) {
    assert.ok(!new RegExp(`CREATE TABLE IF NOT EXISTS ${tbl}\\b`).test(code), tbl);
  }
});
t("tenant_id and company_id are mandatory on every new tenant-owned table", () => {
  for (const tbl of ["job_board_settings", "job_applicants", "job_board_access_requests", "job_board_invitations", "job_post_access_grants", "job_board_access_events"]) {
    const body = code.slice(code.indexOf(`CREATE TABLE IF NOT EXISTS ${tbl}`), code.indexOf(");", code.indexOf(`CREATE TABLE IF NOT EXISTS ${tbl}`)));
    assert.ok(/tenant_id\s+VARCHAR NOT NULL/.test(body), `${tbl}.tenant_id`);
    assert.ok(/company_id\s+VARCHAR NOT NULL REFERENCES companies\(id\)/.test(body), `${tbl}.company_id`);
  }
});
t("discovery code and invitation tokens are stored only as SHA-256 hashes", () => {
  assert.ok(/code_lookup_hash ~ '\^\[0-9a-f\]\{64\}\$'/.test(code));
  assert.ok(/token_hash\s+TEXT NOT NULL CHECK \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/.test(code));
  assert.ok(!/\btoken\s+TEXT\b|\bcompany_code\s+TEXT\b|\bplain/i.test(code.replace(/token_hash|code_lookup_hash|code_hint/g, "")));
});
t("tokens expire, are single-use and revocable", () => {
  assert.ok(/expires_at\s+TIMESTAMP NOT NULL/.test(code) && /consumed_at\s+TIMESTAMP/.test(code) && /revoked_at\s+TIMESTAMP/.test(code));
  assert.ok(/ck_job_board_invitations_single_end CHECK \(consumed_at IS NULL OR revoked_at IS NULL\)/.test(code));
  assert.ok(/uq_job_board_invitations_token ON job_board_invitations \(token_hash\)/.test(code));
});
t("applicant identity is distinct from worker/contractor and email uniqueness is company-scoped", () => {
  const body = code.slice(code.indexOf("CREATE TABLE IF NOT EXISTS job_applicants"), code.indexOf("uq_job_applicants_company_email"));
  assert.ok(!/worker_id|contractor_id/.test(body));
  assert.ok(/uq_job_applicants_company_email ON job_applicants \(company_id, email_normalized\)/.test(code));
  assert.ok(!/ON job_applicants \(email_normalized\)/.test(code), "no global email uniqueness");
  assert.ok(/ck_job_applicants_active CHECK \(status <> 'active' OR \(user_id IS NOT NULL AND email_verified_at IS NOT NULL\)\)/.test(code), "active needs verified email");
});
t("required indexes: code lookup, request review, applicant ownership, posting visibility, token expiry", () => {
  for (const ix of ["uq_job_board_settings_code", "idx_job_board_access_requests_review", "idx_job_post_access_grants_applicant",
    "idx_employment_applications_applicant_id", "idx_job_posts_public_board", "idx_job_post_access_grants_post", "idx_job_board_invitations_live"]) {
    assert.ok(new RegExp(`INDEX IF NOT EXISTS ${ix}\\b`).test(code), ix);
  }
});
t("duplicate active requests / grants / activation tokens are prevented", () => {
  assert.ok(/uq_job_board_access_requests_pending[\s\S]*WHERE status = 'pending'/.test(code));
  assert.ok(/uq_job_post_access_grants_active[\s\S]*WHERE revoked_at IS NULL/.test(code));
  assert.ok(/uq_job_board_invitations_live_activation[\s\S]*consumed_at IS NULL AND revoked_at IS NULL/.test(code));
});
t("public visibility values are constrained; NULL = access_required (fail closed)", () => {
  assert.ok(/public_visibility IS NULL OR public_visibility IN \('public','access_required','invite_only'\)/.test(code));
  assert.ok(/NULL means "access_required"/.test(sql));
});
t("visibility grants are employee-postings only; audit is UPDATE-immutable; no DELETE trigger", () => {
  assert.ok(/ON job_post_access_grants\s+FOR EACH ROW EXECUTE FUNCTION job_board_require_classification\('employee'\)/.test(code));
  assert.ok(/BEFORE UPDATE ON job_board_access_events/.test(code));
  assert.ok(!/BEFORE (UPDATE OR )?DELETE/.test(code));
});
t("access requests never store a raw IP", () => {
  assert.ok(/source_ip_hash\s+TEXT/.test(code) && !/source_ip\s+TEXT/.test(code));
});
t("shared/schema.ts mirrors every 0030 table and column", () => {
  for (const tbl of ["job_board_settings", "job_applicants", "job_board_access_requests", "job_board_invitations", "job_post_access_grants", "job_board_access_events"]) {
    assert.ok(schema.includes(`pgTable("${tbl}"`), tbl);
  }
  for (const col of ["public_visibility", "public_description", "public_show_compensation", "applicant_id\").references(() => jobApplicants.id)"]) {
    assert.ok(schema.includes(col), col);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
